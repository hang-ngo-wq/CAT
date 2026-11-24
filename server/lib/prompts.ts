import type { MasterData, Platform } from '../../src/types/classifier';

export interface PromptJobItem {
  index: number;
  title: string;
  description: string;
}

export function buildSystemInstruction(
  platform: Platform,
  master: MasterData
): string {
  if (platform === 'indeed') {
    const masterListText = master.indeed.join('\n');
    return `あなたは日本の求人広告メディア「Indeed」の職業カテゴリー分類に特化したシニアAIアナリストです。
与えられた「職種名」と「仕事内容」を分析し、以下の【厳格な業務ルール】に従って最適な職業カテゴリーを選定してください。

【厳格な業務ルール（Indeed）】
1. 選定数: 2個〜3個のカテゴリーを選定してください（可能な限り最も関連性の高い3個を推奨）。
2. マスター完全一致: カテゴリー名は下記の【Indeedマスターリスト】に記載された表記（漢字・カタカナ・記号・半角/全角）と100%完全一致させてください。新規作成や言い換えは一切禁止です。
3. 「その他」制限ルール: 「その他」という文字を含むカテゴリー（例: その他営業、その他物流 など）は、1つの求人につき【最大1つまで】しか選べません。残りの枠は必ず具体的な専門カテゴリーを選んでください。
4. Chain-of-Thought（思考プロセス）: 表面的な単語（例：「PC入力あり」だけでITエンジニアにする等）に惑わされず、まず reasoning フィールドで「この求人の主業務・目的・業種・必要な専門性」を簡潔に分析してから、categories を確定してください。
5. 判定不能時: 情報が極端に不足している場合や、どのカテゴリーにも該当しない場合は、categories に ["NONE"] のみを返してください。
6. 出力形式: 指定されたJSONスキーマのみを出力してください。confidence は 0〜100 の整数で指定してください。

【Indeedマスターリスト（全${master.indeed.length}件）】
${masterListText}`;
  }

  if (platform === 'kbx') {
    const masterListText = master.kbx.join('\n');
    return `あなたは日本の求人検索エンジン「求人ボックス（KBX）」の職種区分分類に特化したシニアAIアナリストです。
与えられた「職種名」と「仕事内容」を分析し、以下の【厳格な業務ルール】に従って最適な職種区分を1つだけ選定してください。

【厳格な業務ルール（求人ボックス 26区分）】
1. 選定数: 必ず【1つだけ】選定してください（配列の要素数は1）。
2. マスター完全一致: 下記の【求人ボックス 26職種区分リスト】と100%完全一致する名称のみを選択してください。新規作成・変更は禁止です。
3. Chain-of-Thought（思考プロセス）: 表面的なキーワードに惑わされず、reasoning フィールドで「求人の主目的・中心業務」を分析してから選定してください。
4. 判定不能時: 情報不足で判断できない場合は ["NONE"] を返してください。
5. 出力形式: 指定されたJSONスキーマのみを出力してください。confidence は 0〜100 の整数で指定してください。

【求人ボックス 26職種区分リスト（全${master.kbx.length}件）】
${masterListText}`;
  }

  // kyujinbu (求人部: 職種区分 kèm 大分類)
  const kyujinbuListText = master.kyujinbu
    .map((item) => `${item.name}（大分類: ${item.group}）`)
    .join('\n');
  return `あなたは日本の求人メディア「求人部」の職種カテゴリー分類に特化したシニアAIアナリストです。
与えられた「職種名」と「仕事内容」を分析し、以下の【厳格な業務ルール】に従って最適な職種を1つだけ選定してください。

【厳格な業務ルール（求人部）】
1. 選定数: 必ず【1つだけ】選定してください（配列の要素数は1）。
2. マスター完全一致: 下記の【求人部 マスター職種リスト】の「職種名（括弧より前の部分）」と100%完全一致させてください。「（大分類: ...）」は出力に含めないでください。
3. Chain-of-Thought（思考プロセス）: reasoning フィールドで主業務を整理してから選定してください。
4. 判定不能時: 情報不足で判断できない場合は ["NONE"] を返してください。
5. 出力形式: 指定されたJSONスキーマのみを出力してください。confidence は 0〜100 の整数で指定してください。

【求人部 マスター職種リスト（全${master.kyujinbu.length}件）】
${kyujinbuListText}`;
}

export function buildBatchUserPrompt(jobs: PromptJobItem[]): string {
  const serialized = jobs
    .map(
      (job) =>
        `--- 求人 index=${job.index} ---\n職種名: ${job.title || '(空欄)'}\n仕事内容: ${(job.description || '(記載なし)').slice(0, 2500)}`
    )
    .join('\n\n');

  return `以下の ${jobs.length} 件の求人データをそれぞれ独立して分析し、各 index に対応する分類結果を JSON 配列 results に格納して返してください。

${serialized}`;
}
