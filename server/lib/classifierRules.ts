import crypto from 'node:crypto';
import type {
  CategoryMappingDetail,
  HashMode,
  MasterData,
  Platform,
} from '../../src/types/classifier';

export function normalizeTextForHash(text: string): string {
  return (text || '').trim().replace(/\s+/g, ' ');
}

export function computeJobMd5Hash(
  title: string,
  description: string,
  hashMode: HashMode = 'title_and_content'
): string {
  const normTitle = normalizeTextForHash(title);
  const normDesc = normalizeTextForHash(description);
  const payload =
    hashMode === 'title_only' ? normTitle : `${normTitle}|||${normDesc}`;
  return crypto.createHash('md5').update(payload, 'utf8').digest('hex');
}

export function buildCacheKey(
  platform: Platform,
  hashMode: HashMode,
  md5: string
): string {
  return `${platform}:${hashMode}:${md5}`;
}

export function chunkArray<T>(items: T[], size: number): T[][] {
  const safeSize = Math.max(1, Math.min(20, Math.floor(size) || 10));
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += safeSize) {
    chunks.push(items.slice(i, i + safeSize));
  }
  return chunks;
}

export interface ValidationOutcome {
  categories: string[];
  formattedCategory: string;
  mappings: CategoryMappingDetail[];
  isNone: boolean;
  sonotaCount: number;
}

export function validateAndNormalizeCategories(
  rawCategories: unknown,
  platform: Platform,
  master: MasterData
): ValidationOutcome {
  const candidates = Array.isArray(rawCategories)
    ? rawCategories
        .map((c) => (typeof c === 'string' ? c.trim() : ''))
        .filter(Boolean)
    : [];

  if (
    candidates.length === 0 ||
    (candidates.length === 1 && candidates[0].toUpperCase() === 'NONE')
  ) {
    return {
      categories: ['NONE'],
      formattedCategory: 'NONE',
      mappings: [],
      isNone: true,
      sonotaCount: 0,
    };
  }

  if (platform === 'indeed') {
    const masterSet = new Set(master.indeed);
    const valid: string[] = [];
    const seen = new Set<string>();
    let sonotaCount = 0;

    for (const item of candidates) {
      if (item.toUpperCase() === 'NONE') continue;
      if (!masterSet.has(item)) continue;
      if (seen.has(item)) continue;

      const isOther = item.includes('その他');
      if (isOther && sonotaCount >= 1) {
        continue;
      }

      if (isOther) sonotaCount += 1;
      seen.add(item);
      valid.push(item);

      if (valid.length >= 3) break;
    }

    if (valid.length === 0) {
      return {
        categories: ['NONE'],
        formattedCategory: 'NONE',
        mappings: [],
        isNone: true,
        sonotaCount: 0,
      };
    }

    const mappings: CategoryMappingDetail[] = valid.map((cat) => ({
      category: cat,
      airworkCode: master.airworkMap[cat] ?? null,
      jobopCode: master.jobopMap[cat] ?? null,
      groupName: null,
      isOther: cat.includes('その他'),
    }));

    return {
      categories: valid,
      formattedCategory: valid.join('、'),
      mappings,
      isNone: false,
      sonotaCount,
    };
  }

  // KBX (求人ボックス): 26 ngành chuẩn
  if (platform === 'kbx') {
    const masterSet = new Set(master.kbx);
    const matched = candidates.find(
      (item) => item.toUpperCase() !== 'NONE' && masterSet.has(item)
    );

    if (!matched) {
      return {
        categories: ['NONE'],
        formattedCategory: 'NONE',
        mappings: [],
        isNone: true,
        sonotaCount: 0,
      };
    }

    return {
      categories: [matched],
      formattedCategory: matched,
      mappings: [
        {
          category: matched,
          airworkCode: null,
          jobopCode: null,
          groupName: null,
          isOther: matched.includes('その他'),
        },
      ],
      isNone: false,
      sonotaCount: matched.includes('その他') ? 1 : 0,
    };
  }

  // Kyujinbu (求人部): 574 職種区分 kèm nhóm 大分類
  const groupByName = new Map<string, string>();
  for (const row of master.kyujinbu) {
    if (!groupByName.has(row.name)) {
      groupByName.set(row.name, row.group);
    }
  }

  const matched = candidates.find(
    (item) => item.toUpperCase() !== 'NONE' && groupByName.has(item)
  );

  if (!matched) {
    return {
      categories: ['NONE'],
      formattedCategory: 'NONE',
      mappings: [],
      isNone: true,
      sonotaCount: 0,
    };
  }

  return {
    categories: [matched],
    formattedCategory: matched,
    mappings: [
      {
        category: matched,
        airworkCode: null,
        jobopCode: null,
        groupName: groupByName.get(matched) ?? null,
        isOther: matched.includes('その他'),
      },
    ],
    isNone: false,
    sonotaCount: matched.includes('その他') ? 1 : 0,
  };
}

export function clampConfidence(value: unknown): number {
  if (typeof value !== 'number' || Number.isNaN(value)) return 0;
  if (value <= 1 && value > 0) {
    return Math.round(value * 100);
  }
  return Math.max(0, Math.min(100, Math.round(value)));
}
