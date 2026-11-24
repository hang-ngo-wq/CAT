import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import type {
  BatchJobInput,
  BatchJobResult,
  ClassificationResult,
  HashMode,
  MasterData,
  Platform,
} from '../../src/types/classifier';
import { cacheStore } from './cacheStore';
import {
  buildCacheKey,
  chunkArray,
  clampConfidence,
  computeJobMd5Hash,
  validateAndNormalizeCategories,
} from './classifierRules';
import { masterStore } from './masterStore';
import { buildBatchUserPrompt, buildSystemInstruction } from './prompts';

const MODEL_CHAIN = ['gemini-4-hydrogen', 'gemini-3.1-flash-lite'] as const;

function getServerApiKeys(): string[] {
  const poolRaw = process.env.GEMINI_API_KEYS || '';
  const singleRaw = process.env.GEMINI_API_KEY || '';
  const combined = `${poolRaw}\n${singleRaw}`
    .split(/[\n,]+/)
    .map((k) => k.trim())
    .filter(Boolean);
  return Array.from(new Set(combined));
}

function createAiClient(apiKey: string): GoogleGenAI {
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

export function formatGeminiError(
  err: unknown,
  allModelsExhausted = false
): {
  status: number;
  message: string;
} {
  if (allModelsExhausted) {
    return {
      status: 429,
      message:
        'Đã hết hạn mức trên tất cả các model khả dụng (gemini-4-hydrogen, gemini-3.1-flash-lite). Vui lòng đợi reset hạn mức hoặc cập nhật GEMINI_API_KEY / GEMINI_API_KEYS trong biến môi trường máy chủ (Settings > Secrets hoặc Vercel Environment Variables).',
    };
  }
  const raw = err instanceof Error ? err.message : String(err);
  if (raw.includes('429') || raw.includes('RESOURCE_EXHAUSTED')) {
    return {
      status: 429,
      message:
        'API Key hiện tại đã chạm giới hạn lượt gọi miễn phí (429 Quota Exceeded). Đã hết các model dự phòng khả dụng. Vui lòng đợi reset hoặc cập nhật GEMINI_API_KEY / GEMINI_API_KEYS trong biến môi trường máy chủ.',
    };
  }
  if (raw.includes('503') || raw.includes('UNAVAILABLE')) {
    return {
      status: 503,
      message:
        'Hệ thống AI đang quá tải tạm thời (503) trên tất cả các model dự phòng. Vui lòng thử lại sau ít giây.',
    };
  }
  if (raw.includes('403') || raw.includes('PERMISSION_DENIED')) {
    return {
      status: 403,
      message:
        'API Key không có quyền truy cập model Gemini (403). Vui lòng kiểm tra lại GEMINI_API_KEY trong biến môi trường máy chủ.',
    };
  }
  if (raw.includes('API_KEY_INVALID') || raw.includes('400')) {
    return {
      status: 400,
      message:
        'API Key không hợp lệ hoặc tham số gửi lên bị từ chối (400). Vui lòng kiểm tra GEMINI_API_KEY trong biến môi trường máy chủ.',
    };
  }
  return {
    status: 500,
    message: raw.length > 260 ? `${raw.slice(0, 260)}...` : raw,
  };
}

interface RawGeminiItem {
  index: number;
  reasoning: string;
  categories: string[];
  confidence: number;
}

const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    results: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          index: {
            type: Type.INTEGER,
            description: '入力求人のindex番号',
          },
          reasoning: {
            type: Type.STRING,
            description:
              '表面的な単語ではなく、業務の本質と主目的を分析したChain-of-Thought推論',
          },
          categories: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description:
              'マスターリストと100%完全一致するカテゴリー配列、または ["NONE"]',
          },
          confidence: {
            type: Type.INTEGER,
            description: '判定の確信度 (0〜100)',
          },
        },
        required: ['index', 'reasoning', 'categories', 'confidence'],
      },
    },
  },
  required: ['results'],
};

async function invokeModel(
  ai: GoogleGenAI,
  model: string,
  systemInstruction: string,
  userPrompt: string
): Promise<RawGeminiItem[]> {
  const response = await ai.models.generateContent({
    model,
    contents: userPrompt,
    config: {
      systemInstruction,
      seed: 42,
      responseMimeType: 'application/json',
      ...(model === 'gemini-4-hydrogen'
        ? { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } }
        : {}),
      responseSchema: RESPONSE_SCHEMA,
    },
  });

  const rawText = (response.text ?? '{}').trim();
  const parsed = JSON.parse(rawText) as { results?: RawGeminiItem[] };
  return Array.isArray(parsed.results) ? parsed.results : [];
}

interface GeminiInvocationOutput {
  items: RawGeminiItem[];
  modelUsed: string;
  fallbackNotice: string | null;
}

async function callGeminiWithFallback(
  systemInstruction: string,
  userPrompt: string
): Promise<GeminiInvocationOutput> {
  const keys = getServerApiKeys();
  if (keys.length === 0) {
    throw new Error(
      'GEMINI_API_KEY chưa được cấu hình trong biến môi trường máy chủ (Settings > Secrets hoặc Vercel Environment Variables).'
    );
  }

  let lastError: unknown;
  const switchEvents: string[] = [];
  let sawQuotaOrBusy = false;

  for (let keyIdx = 0; keyIdx < keys.length; keyIdx++) {
    const ai = createAiClient(keys[keyIdx]);

    for (let modelIdx = 0; modelIdx < MODEL_CHAIN.length; modelIdx++) {
      const model = MODEL_CHAIN[modelIdx];
      const maxAttempts = modelIdx === 0 ? 1 : 2;

      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        try {
          const items = await invokeModel(ai, model, systemInstruction, userPrompt);
          const fallbackNotice =
            switchEvents.length > 0
              ? `Thông báo chuyển model: ${switchEvents.join(' → ')} (đang dùng ${model}).`
              : null;
          return {
            items,
            modelUsed: model,
            fallbackNotice,
          };
        } catch (err: unknown) {
          lastError = err;
          const msg = err instanceof Error ? err.message : String(err);
          const isQuota = msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED');
          const isBusy = msg.includes('503') || msg.includes('UNAVAILABLE');

          if (isQuota || isBusy) {
            sawQuotaOrBusy = true;
            if (attempt + 1 < maxAttempts) {
              await new Promise((r) => setTimeout(r, 900));
              continue;
            }
            const nextModel = MODEL_CHAIN[modelIdx + 1];
            if (nextModel) {
              switchEvents.push(
                `${model} (${isQuota ? '429 hết hạn mức' : '503 quá tải'}) → chuyển sang ${nextModel}`
              );
            } else if (keyIdx + 1 < keys.length) {
              switchEvents.push(
                `Key #${keyIdx + 1} hết hạn mức → chuyển sang Key #${keyIdx + 2}`
              );
            }
            break;
          }
          // Non-retryable error (400/403 etc.)
          throw err;
        }
      }
    }
  }

  const formatted = formatGeminiError(lastError, sawQuotaOrBusy);
  const err = new Error(formatted.message) as Error & { statusCode?: number };
  err.statusCode = formatted.status;
  throw err;
}

function hydrateResult(
  platform: Platform,
  title: string,
  description: string,
  hash: string,
  hashMode: HashMode,
  rawCategories: string[],
  reasoning: string,
  confidence: number,
  fromCache: boolean,
  latencyMs: number,
  master: MasterData,
  modelUsed?: string,
  fallbackNotice?: string | null
): ClassificationResult {
  const validated = validateAndNormalizeCategories(
    rawCategories,
    platform,
    master
  );
  return {
    platform,
    title,
    description,
    hash,
    hashMode,
    categories: validated.categories,
    formattedCategory: validated.formattedCategory,
    mappings: validated.mappings,
    reasoning,
    confidence: clampConfidence(confidence),
    fromCache,
    isNone: validated.isNone,
    latencyMs,
    sonotaCount: validated.sonotaCount,
    modelUsed,
    fallbackNotice: fallbackNotice ?? null,
    validatedAt: new Date().toISOString(),
  };
}

export async function classifySingleJob(params: {
  platform: Platform;
  title: string;
  description: string;
  hashMode?: HashMode;
}): Promise<ClassificationResult> {
  const start = Date.now();
  const hashMode: HashMode = params.hashMode || 'title_and_content';
  const master = masterStore.getMasterData();
  const title = (params.title || '').trim();
  const description = (params.description || '').trim();
  const hash = computeJobMd5Hash(title, description, hashMode);
  const cacheKey = buildCacheKey(params.platform, hashMode, hash);

  const cached = cacheStore.get(cacheKey);
  if (cached) {
    return hydrateResult(
      params.platform,
      title,
      description,
      hash,
      hashMode,
      cached.categories,
      cached.reasoning,
      cached.confidence,
      true,
      0,
      master,
      'MD5 Cache'
    );
  }

  if (!title && !description) {
    return hydrateResult(
      params.platform,
      title,
      description,
      hash,
      hashMode,
      ['NONE'],
      '職種名と仕事内容が空欄のため判定できません。',
      0,
      false,
      Date.now() - start,
      master
    );
  }

  const systemInstruction = buildSystemInstruction(params.platform, master);
  const userPrompt = buildBatchUserPrompt([{ index: 0, title, description }]);

  const { items, modelUsed, fallbackNotice } = await callGeminiWithFallback(
    systemInstruction,
    userPrompt
  );
  const matched = items.find((i) => i.index === 0) ?? items[0];

  const result = hydrateResult(
    params.platform,
    title,
    description,
    hash,
    hashMode,
    matched?.categories ?? ['NONE'],
    matched?.reasoning ?? '分類結果を取得できませんでした。',
    matched?.confidence ?? 0,
    false,
    Date.now() - start,
    master,
    modelUsed,
    fallbackNotice
  );

  cacheStore.set(cacheKey, result);
  return result;
}

export interface BatchProgressEvent {
  type: 'progress' | 'complete' | 'error';
  total: number;
  processed: number;
  cacheHits: number;
  aiCalls: number;
  noneCount: number;
  errorCount: number;
  notice?: string | null;
  chunkResults?: BatchJobResult[];
  results?: BatchJobResult[];
  message?: string;
}

export async function classifyBatchJobs(params: {
  platform: Platform;
  jobs: BatchJobInput[];
  hashMode?: HashMode;
  batchSize?: number;
  onProgress?: (event: BatchProgressEvent) => void;
}): Promise<{
  results: BatchJobResult[];
  cacheHits: number;
  aiCalls: number;
  noneCount: number;
  errorCount: number;
  notices: string[];
}> {
  const hashMode: HashMode = params.hashMode || 'title_and_content';
  const batchSize = Math.max(1, Math.min(15, params.batchSize || 10));
  const master = masterStore.getMasterData();

  const total = params.jobs.length;
  const outputResults: BatchJobResult[] = new Array(total);
  let processed = 0;
  let cacheHits = 0;
  let aiCalls = 0;
  let noneCount = 0;
  let errorCount = 0;
  const noticeSet = new Set<string>();

  interface PendingJob {
    originalIdx: number;
    job: BatchJobInput;
    title: string;
    description: string;
    hash: string;
    cacheKey: string;
  }

  const uncachedByHash = new Map<string, PendingJob[]>();
  const cachedChunkResults: BatchJobResult[] = [];

  for (let i = 0; i < total; i++) {
    const job = params.jobs[i];
    const title = (job.title || '').trim();
    const description = (job.description || '').trim();
    const hash = computeJobMd5Hash(title, description, hashMode);
    const cacheKey = buildCacheKey(params.platform, hashMode, hash);

    if (!title && !description) {
      const emptyRes: BatchJobResult = {
        ...hydrateResult(
          params.platform,
          title,
          description,
          hash,
          hashMode,
          ['NONE'],
          '職種名・仕事内容が未入力のため NONE と判定しました。',
          100,
          false,
          0,
          master
        ),
        id: job.id,
        rowIndex: job.rowIndex ?? i,
      };
      outputResults[i] = emptyRes;
      cachedChunkResults.push(emptyRes);
      processed += 1;
      noneCount += 1;
      continue;
    }

    const cached = cacheStore.get(cacheKey);
    if (cached) {
      const hitRes: BatchJobResult = {
        ...hydrateResult(
          params.platform,
          title,
          description,
          hash,
          hashMode,
          cached.categories,
          cached.reasoning,
          cached.confidence,
          true,
          0,
          master,
          'MD5 Cache'
        ),
        id: job.id,
        rowIndex: job.rowIndex ?? i,
      };
      outputResults[i] = hitRes;
      cachedChunkResults.push(hitRes);
      processed += 1;
      cacheHits += 1;
      if (hitRes.isNone) noneCount += 1;
      continue;
    }

    const group = uncachedByHash.get(cacheKey) || [];
    group.push({
      originalIdx: i,
      job,
      title,
      description,
      hash,
      cacheKey,
    });
    uncachedByHash.set(cacheKey, group);
  }

  if (cachedChunkResults.length > 0 && params.onProgress) {
    params.onProgress({
      type: 'progress',
      total,
      processed,
      cacheHits,
      aiCalls,
      noneCount,
      errorCount,
      chunkResults: cachedChunkResults,
    });
  }

  const uniqueGroups = Array.from(uncachedByHash.values());
  if (uniqueGroups.length > 0) {
    const systemInstruction = buildSystemInstruction(params.platform, master);
    const chunks = chunkArray(uniqueGroups, batchSize);

    for (const chunk of chunks) {
      const chunkStart = Date.now();
      const promptItems = chunk.map((group, idx) => ({
        index: idx,
        title: group[0].title,
        description: group[0].description,
      }));

      try {
        aiCalls += 1;
        const { items: aiItems, modelUsed, fallbackNotice } =
          await callGeminiWithFallback(
            systemInstruction,
            buildBatchUserPrompt(promptItems)
          );
        if (fallbackNotice) {
          noticeSet.add(fallbackNotice);
        }

        const chunkLatency = Date.now() - chunkStart;
        const toCache: Array<{ key: string; result: ClassificationResult }> = [];
        const emittedChunkResults: BatchJobResult[] = [];

        chunk.forEach((group, idx) => {
          const matched = aiItems.find((r) => r.index === idx);
          const representative = group[0];
          const baseResult = hydrateResult(
            params.platform,
            representative.title,
            representative.description,
            representative.hash,
            hashMode,
            matched?.categories ?? ['NONE'],
            matched?.reasoning ?? 'AI応答に該当インデックスが含まれませんでした。',
            matched?.confidence ?? 0,
            false,
            chunkLatency,
            master,
            modelUsed,
            fallbackNotice
          );

          toCache.push({ key: representative.cacheKey, result: baseResult });

          group.forEach((member, dupIdx) => {
            const isInBatchDup = dupIdx > 0;
            if (isInBatchDup) cacheHits += 1;
            if (baseResult.isNone) noneCount += 1;

            const rowRes: BatchJobResult = {
              ...baseResult,
              title: member.title,
              description: member.description,
              fromCache: isInBatchDup,
              latencyMs: isInBatchDup ? 0 : chunkLatency,
              id: member.job.id,
              rowIndex: member.job.rowIndex ?? member.originalIdx,
            };
            outputResults[member.originalIdx] = rowRes;
            emittedChunkResults.push(rowRes);
            processed += 1;
          });
        });

        cacheStore.setMany(toCache);

        if (params.onProgress) {
          params.onProgress({
            type: 'progress',
            total,
            processed,
            cacheHits,
            aiCalls,
            noneCount,
            errorCount,
            notice: fallbackNotice,
            chunkResults: emittedChunkResults,
          });
        }
      } catch (err: unknown) {
        const msg =
          err instanceof Error ? err.message : formatGeminiError(err).message;
        const failedChunkResults: BatchJobResult[] = [];
        for (const group of chunk) {
          for (const member of group) {
            errorCount += 1;
            processed += 1;
            const failRes: BatchJobResult = {
              ...hydrateResult(
                params.platform,
                member.title,
                member.description,
                member.hash,
                hashMode,
                ['NONE'],
                msg,
                0,
                false,
                0,
                master
              ),
              id: member.job.id,
              rowIndex: member.job.rowIndex ?? member.originalIdx,
              error: msg,
            };
            outputResults[member.originalIdx] = failRes;
            failedChunkResults.push(failRes);
          }
        }
        if (params.onProgress) {
          params.onProgress({
            type: 'progress',
            total,
            processed,
            cacheHits,
            aiCalls,
            noneCount,
            errorCount,
            notice: msg,
            chunkResults: failedChunkResults,
          });
        }
      }
    }
  }

  return {
    results: outputResults,
    cacheHits,
    aiCalls,
    noneCount,
    errorCount,
    notices: Array.from(noticeSet),
  };
}
