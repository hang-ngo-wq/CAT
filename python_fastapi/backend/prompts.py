from typing import List, Dict


def build_system_instruction(
    platform: str,
    indeed_list: List[str],
    kbx_list: List[str],
    kyujinbu_list: List[Dict[str, str]],
) -> str:
    if platform == "indeed":
        master_text = "\n".join(indeed_list)
        return f"""あなたは日本の求人広告メディア「Indeed」の職業カテゴリー分類に特化したシニアAIアナリストです。
与えられた「職種名」と「仕事内容」を分析し、以下の【厳格な業務ルール】に従って最適な職業カテゴリーを選定してください。

【厳格な業務ルール（Indeed）】
1. 選定数: 2個〜3個のカテゴリーを選定してください（可能な限り最も関連性の高い3個を推奨）。
2. マスター完全一致: カテゴリー名は下記の【Indeedマスターリスト】に記載された表記（漢字・カタカナ・記号・半角/全角）と100%完全一致させてください。新規作成や言い換えは一切禁止です。
3. 「その他」制限ルール: 「その他」という文字を含むカテゴリー（例: その他営業、その他物流 など）は、1つの求人につき【最大1つまで】しか選べません。残りの枠は必ず具体的な専門カテゴリーを選んでください。
4. Chain-of-Thought（思考プロセス）: 表面的な単語に惑わされず、まず reasoning フィールドで「この求人の主業務・目的・業種」を分析してから、categories を確定してください。
5. 判定不能時: 情報不足または該当なしの場合は ["NONE"] のみを返してください。

【Indeedマスターリスト（全{len(indeed_list)}件）】
{master_text}"""

    if platform == "kbx":
        master_text = "\n".join(kbx_list)
        return f"""あなたは日本の求人検索エンジン「求人ボックス（KBX）」の職種区分分類に特化したシニアAIアナリストです。
下記の【求人ボックス 26職種区分リスト】の中から、100%完全一致する名称を【必ず1つだけ】選定してください。該当なしは ["NONE"]。

【求人ボックス 26職種区分リスト（全{len(kbx_list)}件）】
{master_text}"""

    kjb_text = "\n".join(f"{item['name']}（大分類: {item.get('group', '')}）" for item in kyujinbu_list)
    return f"""あなたは日本の求人メディア「求人部」の職種カテゴリー分類に特化したシニアAIアナリストです。
下記の【求人部 マスター職種リスト】の職種名（括弧より前の部分）と100%完全一致する名称を【必ず1つだけ】選定してください。該当なしは ["NONE"]。

【求人部 マスター職種リスト（全{len(kyujinbu_list)}件）】
{kjb_text}"""


def build_batch_prompt(jobs: List[Dict[str, str]]) -> str:
    blocks = []
    for idx, job in enumerate(jobs):
        title = (job.get("title") or "").strip() or "(空欄)"
        desc = ((job.get("description") or "").strip() or "(記載なし)")[:2500]
        blocks.append(f"--- 求人 index={idx} ---\n職種名: {title}\n仕事内容: {desc}")
    return (
        f"以下の {len(jobs)} 件の求人データをそれぞれ独立して分析し、"
        f"各 index に対応する分類結果を JSON 配列 results に格納して返してください。\n\n"
        + "\n\n".join(blocks)
    )
