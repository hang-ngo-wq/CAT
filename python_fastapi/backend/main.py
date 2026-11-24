import hashlib
import json
import os
import sqlite3
import time
from pathlib import Path
from typing import Any, Dict, List, Literal, Optional, Tuple

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from google import genai
from google.genai import types
from pydantic import BaseModel, Field

from .prompts import build_batch_prompt, build_system_instruction

Platform = Literal["indeed", "kbx", "kyujinbu"]
HashMode = Literal["title_and_content", "title_only"]

BASE_DIR = Path(__file__).resolve().parent.parent.parent
MASTER_PATH = BASE_DIR / "server" / "data" / "masterCategories.json"
CACHE_DB_PATH = Path(__file__).resolve().parent / "cache.sqlite3"
MODEL_CHAIN = ["gemini-4-hydrogen", "gemini-3.1-flash-lite"]

app = FastAPI(title="JobCat JP Microservice", version="1.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


def init_db() -> None:
    with sqlite3.connect(CACHE_DB_PATH) as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS classification_cache (
                cache_key TEXT PRIMARY KEY,
                platform TEXT NOT NULL,
                md5_hash TEXT NOT NULL,
                categories_json TEXT NOT NULL,
                formatted_category TEXT NOT NULL,
                reasoning TEXT NOT NULL,
                confidence INTEGER NOT NULL,
                is_none INTEGER NOT NULL,
                created_at TEXT NOT NULL
            )
            """
        )
        conn.commit()


init_db()


def load_master() -> Dict[str, Any]:
    if not MASTER_PATH.exists():
        return {"indeed": [], "kbx": [], "kyujinbu": [], "airworkMap": {}, "jobopMap": {}}
    return json.loads(MASTER_PATH.read_text(encoding="utf-8"))


def compute_md5(title: str, description: str, hash_mode: HashMode) -> str:
    t = " ".join((title or "").split())
    d = " ".join((description or "").split())
    payload = t if hash_mode == "title_only" else f"{t}|||{d}"
    return hashlib.md5(payload.encode("utf-8")).hexdigest()


def validate_categories(raw: List[str], platform: Platform, master: Dict[str, Any]) -> Dict[str, Any]:
    cleaned = [c.strip() for c in raw if isinstance(c, str) and c.strip()]
    if not cleaned or (len(cleaned) == 1 and cleaned[0].upper() == "NONE"):
        return {"categories": ["NONE"], "formatted": "NONE", "is_none": True, "sonota_count": 0}

    if platform == "indeed":
        master_set = set(master.get("indeed", []))
        valid: List[str] = []
        sonota_count = 0
        for item in cleaned:
            if item not in master_set or item in valid:
                continue
            is_other = "その他" in item
            if is_other and sonota_count >= 1:
                continue
            if is_other:
                sonota_count += 1
            valid.append(item)
            if len(valid) >= 3:
                break
        if not valid:
            return {"categories": ["NONE"], "formatted": "NONE", "is_none": True, "sonota_count": 0}
        return {
            "categories": valid,
            "formatted": "、".join(valid),
            "is_none": False,
            "sonota_count": sonota_count,
        }

    valid_set = (
        set(master.get("kbx", []))
        if platform == "kbx"
        else {x["name"] for x in master.get("kyujinbu", [])}
    )
    match = next((c for c in cleaned if c in valid_set), None)
    if not match:
        return {"categories": ["NONE"], "formatted": "NONE", "is_none": True, "sonota_count": 0}
    return {
        "categories": [match],
        "formatted": match,
        "is_none": False,
        "sonota_count": 1 if "その他" in match else 0,
    }


class GeminiJobResult(BaseModel):
    index: int
    reasoning: str
    categories: List[str]
    confidence: int


class GeminiBatchResponse(BaseModel):
    results: List[GeminiJobResult]


class ClassifyRequest(BaseModel):
    platform: Platform = "indeed"
    title: str = ""
    description: str = ""
    hashMode: HashMode = "title_and_content"


class BatchJobItem(BaseModel):
    id: Optional[Any] = None
    title: str = ""
    description: str = ""


class ClassifyBatchRequest(BaseModel):
    platform: Platform = "indeed"
    hashMode: HashMode = "title_and_content"
    batchSize: int = Field(default=10, ge=1, le=15)
    jobs: List[BatchJobItem]


def get_api_keys() -> List[str]:
    pool = os.getenv("GEMINI_API_KEYS", "")
    single = os.getenv("GEMINI_API_KEY", "")
    keys = [k.strip() for k in f"{pool}\n{single}".replace(",", "\n").splitlines() if k.strip()]
    if not keys:
        raise HTTPException(status_code=500, detail="GEMINI_API_KEY / GEMINI_API_KEYS is not set.")
    return list(dict.fromkeys(keys))


def call_with_fallback(sys_prompt: str, user_prompt: str) -> Tuple[GeminiBatchResponse, str, Optional[str]]:
    keys = get_api_keys()
    switches: List[str] = []
    last_err: Optional[Exception] = None

    for key_idx, key in enumerate(keys):
        client = genai.Client(api_key=key)
        for model_idx, model in enumerate(MODEL_CHAIN):
            try:
                response = client.models.generate_content(
                    model=model,
                    contents=user_prompt,
                    config=types.GenerateContentConfig(
                        system_instruction=sys_prompt,
                        seed=42,
                        response_mime_type="application/json",
                        response_schema=GeminiBatchResponse,
                    ),
                )
                notice = f"Thông báo chuyển model: {' → '.join(switches)}" if switches else None
                return GeminiBatchResponse.model_validate_json(response.text), model, notice
            except Exception as exc:
                last_err = exc
                msg = str(exc)
                if "429" in msg or "RESOURCE_EXHAUSTED" in msg or "503" in msg:
                    if model_idx + 1 < len(MODEL_CHAIN):
                        switches.append(f"{model} → {MODEL_CHAIN[model_idx + 1]}")
                    elif key_idx + 1 < len(keys):
                        switches.append(f"Key #{key_idx + 1} → Key #{key_idx + 2}")
                    continue
                raise HTTPException(status_code=500, detail=msg)

    raise HTTPException(
        status_code=429,
        detail=f"Đã hết hạn mức trên tất cả các model/key khả dụng ({', '.join(MODEL_CHAIN)}). Chi tiết: {last_err}",
    )


@app.post("/api/v1/classify")
def classify_single(req: ClassifyRequest) -> Dict[str, Any]:
    start = time.time()
    master = load_master()
    md5 = compute_md5(req.title, req.description, req.hashMode)
    cache_key = f"{req.platform}:{req.hashMode}:{md5}"

    with sqlite3.connect(CACHE_DB_PATH) as conn:
        row = conn.execute(
            "SELECT categories_json, formatted_category, reasoning, confidence, is_none "
            "FROM classification_cache WHERE cache_key = ?",
            (cache_key,),
        ).fetchone()
    if row:
        return {
            "platform": req.platform,
            "hash": md5,
            "categories": json.loads(row[0]),
            "formattedCategory": row[1],
            "reasoning": row[2],
            "confidence": row[3],
            "isNone": bool(row[4]),
            "fromCache": True,
            "modelUsed": "MD5 Cache",
            "fallbackNotice": None,
            "latencyMs": 0,
        }

    sys_prompt = build_system_instruction(
        req.platform,
        master.get("indeed", []),
        master.get("kbx", []),
        master.get("kyujinbu", []),
    )
    user_prompt = build_batch_prompt([{"title": req.title, "description": req.description}])
    parsed, model_used, notice = call_with_fallback(sys_prompt, user_prompt)
    first = parsed.results[0] if parsed.results else GeminiJobResult(index=0, reasoning="NONE", categories=["NONE"], confidence=0)
    validated = validate_categories(first.categories, req.platform, master)

    with sqlite3.connect(CACHE_DB_PATH) as conn:
        conn.execute(
            "INSERT OR REPLACE INTO classification_cache VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))",
            (
                cache_key,
                req.platform,
                md5,
                json.dumps(validated["categories"], ensure_ascii=False),
                validated["formatted"],
                first.reasoning,
                max(0, min(100, first.confidence)),
                1 if validated["is_none"] else 0,
            ),
        )
        conn.commit()

    return {
        "platform": req.platform,
        "hash": md5,
        "categories": validated["categories"],
        "formattedCategory": validated["formatted"],
        "reasoning": first.reasoning,
        "confidence": max(0, min(100, first.confidence)),
        "isNone": validated["is_none"],
        "fromCache": False,
        "modelUsed": model_used,
        "fallbackNotice": notice,
        "latencyMs": int((time.time() - start) * 1000),
    }
