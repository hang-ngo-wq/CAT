import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type {
  CacheEntryItem,
  CacheStats,
  ClassificationResult,
  HashMode,
  Platform,
} from '../../src/types/classifier';

export interface CachedEntry extends CacheEntryItem {}

const LOCAL_CACHE_FILE = path.resolve(
  process.cwd(),
  'server/data/classificationCache.json'
);
const TMP_CACHE_FILE = path.join(
  os.tmpdir(),
  'jobcat-jp',
  'classificationCache.json'
);

function resolveCacheFile(): string {
  if (process.env.VERCEL) return TMP_CACHE_FILE;
  return LOCAL_CACHE_FILE;
}

function writeJsonAtomic(targetPath: string, payload: string): boolean {
  try {
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    const tmp = `${targetPath}.tmp`;
    fs.writeFileSync(tmp, payload, 'utf8');
    fs.renameSync(tmp, targetPath);
    return true;
  } catch {
    return false;
  }
}

class ClassificationCacheStore {
  private map = new Map<string, CachedEntry>();
  private lastUpdatedAt: string | null = null;
  private loaded = false;

  private ensureLoaded(): void {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const target = fs.existsSync(resolveCacheFile())
        ? resolveCacheFile()
        : fs.existsSync(TMP_CACHE_FILE)
        ? TMP_CACHE_FILE
        : null;

      if (target) {
        const raw = fs.readFileSync(target, 'utf8');
        const parsed = JSON.parse(raw) as {
          entries?: Record<string, Partial<CachedEntry>>;
          lastUpdatedAt?: string | null;
        };
        if (parsed.entries) {
          for (const [k, v] of Object.entries(parsed.entries)) {
            const parts = k.split(':');
            const hashMode =
              (v.hashMode as HashMode) ||
              (parts[1] as HashMode) ||
              'title_and_content';
            this.map.set(k, {
              key: k,
              platform: (v.platform as Platform) || 'indeed',
              hashMode,
              hash: v.hash || parts[2] || '',
              title: v.title || '',
              categories: v.categories || [],
              formattedCategory: v.formattedCategory || 'NONE',
              reasoning: v.reasoning || '',
              confidence: typeof v.confidence === 'number' ? v.confidence : 0,
              isNone: Boolean(v.isNone),
              sonotaCount: typeof v.sonotaCount === 'number' ? v.sonotaCount : 0,
              cachedAt: v.cachedAt || new Date().toISOString(),
            });
          }
        }
        this.lastUpdatedAt = parsed.lastUpdatedAt ?? null;
      }
    } catch {
      this.map.clear();
    }
  }

  private persist(): void {
    const payload = JSON.stringify(
      {
        lastUpdatedAt: this.lastUpdatedAt,
        entries: Object.fromEntries(this.map.entries()),
      },
      null,
      2
    );
    const primary = resolveCacheFile();
    if (!writeJsonAtomic(primary, payload) && primary !== TMP_CACHE_FILE) {
      writeJsonAtomic(TMP_CACHE_FILE, payload);
    }
  }

  get(key: string): CachedEntry | undefined {
    this.ensureLoaded();
    return this.map.get(key);
  }

  set(key: string, result: ClassificationResult): void {
    this.ensureLoaded();
    const now = new Date().toISOString();
    this.lastUpdatedAt = now;
    this.map.set(key, {
      key,
      platform: result.platform,
      hashMode: result.hashMode,
      hash: result.hash,
      title: result.title,
      categories: result.categories,
      formattedCategory: result.formattedCategory,
      reasoning: result.reasoning,
      confidence: result.confidence,
      isNone: result.isNone,
      sonotaCount: result.sonotaCount,
      cachedAt: now,
    });
    this.persist();
  }

  setMany(items: Array<{ key: string; result: ClassificationResult }>): void {
    if (items.length === 0) return;
    this.ensureLoaded();
    const now = new Date().toISOString();
    this.lastUpdatedAt = now;
    for (const { key, result } of items) {
      this.map.set(key, {
        key,
        platform: result.platform,
        hashMode: result.hashMode,
        hash: result.hash,
        title: result.title,
        categories: result.categories,
        formattedCategory: result.formattedCategory,
        reasoning: result.reasoning,
        confidence: result.confidence,
        isNone: result.isNone,
        sonotaCount: result.sonotaCount,
        cachedAt: now,
      });
    }
    this.persist();
  }

  listEntries(): CachedEntry[] {
    this.ensureLoaded();
    return Array.from(this.map.values()).sort((a, b) =>
      b.cachedAt.localeCompare(a.cachedAt)
    );
  }

  deleteEntry(key: string): boolean {
    this.ensureLoaded();
    const existed = this.map.delete(key);
    if (existed) {
      this.lastUpdatedAt = new Date().toISOString();
      this.persist();
    }
    return existed;
  }

  getStats(): CacheStats {
    this.ensureLoaded();
    const byPlatform: Record<Platform, number> = {
      indeed: 0,
      kbx: 0,
      kyujinbu: 0,
    };
    let noneEntries = 0;
    for (const entry of this.map.values()) {
      byPlatform[entry.platform] = (byPlatform[entry.platform] ?? 0) + 1;
      if (entry.isNone) noneEntries += 1;
    }
    return {
      totalEntries: this.map.size,
      byPlatform,
      noneEntries,
      lastUpdatedAt: this.lastUpdatedAt,
    };
  }

  clear(): CacheStats {
    this.ensureLoaded();
    this.map.clear();
    this.lastUpdatedAt = new Date().toISOString();
    this.persist();
    return this.getStats();
  }
}

export const cacheStore = new ClassificationCacheStore();
