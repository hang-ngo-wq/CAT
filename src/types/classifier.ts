export type Platform = 'indeed' | 'kbx' | 'kyujinbu';

export type HashMode = 'title_and_content' | 'title_only';

export interface GroupedCategoryItem {
  group: string;
  name: string;
}

export interface MasterData {
  indeed: string[];
  kbx: string[]; // 26 ngành chuẩn
  kyujinbu: GroupedCategoryItem[]; // 574 職種区分 kèm 大分類
  airworkMap: Record<string, string>;
  jobopMap: Record<string, string>;
  updatedAt: string;
  source: string;
}

export interface CategoryMappingDetail {
  category: string;
  airworkCode: string | null;
  jobopCode: string | null;
  groupName: string | null;
  isOther: boolean;
}

export interface ClassificationResult {
  platform: Platform;
  title: string;
  description: string;
  hash: string;
  hashMode: HashMode;
  categories: string[];
  formattedCategory: string;
  mappings: CategoryMappingDetail[];
  reasoning: string;
  confidence: number;
  fromCache: boolean;
  isNone: boolean;
  latencyMs: number;
  sonotaCount: number;
  modelUsed?: string;
  fallbackNotice?: string | null;
  validatedAt: string;
}

export interface BatchJobInput {
  id?: string | number;
  rowIndex?: number;
  title: string;
  description: string;
}

export interface BatchJobResult extends ClassificationResult {
  id?: string | number;
  rowIndex?: number;
  error?: string;
}

export interface BatchResponse {
  platform: Platform;
  hashMode: HashMode;
  total: number;
  processed: number;
  cacheHits: number;
  aiCalls: number;
  noneCount: number;
  errorCount: number;
  notices?: string[];
  results: BatchJobResult[];
}

export interface CacheEntryItem {
  key: string;
  platform: Platform;
  hashMode: HashMode;
  hash: string;
  title: string;
  categories: string[];
  formattedCategory: string;
  reasoning: string;
  confidence: number;
  isNone: boolean;
  sonotaCount: number;
  cachedAt: string;
}

export interface CacheStats {
  totalEntries: number;
  byPlatform: Record<Platform, number>;
  noneEntries: number;
  lastUpdatedAt: string | null;
}
