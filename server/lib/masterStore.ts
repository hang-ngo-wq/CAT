import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type {
  GroupedCategoryItem,
  MasterData,
  Platform,
} from '../../src/types/classifier';
import { DEFAULT_MASTER_DATA } from '../data/defaultMasterData';

const LOCAL_MASTER_FILE = path.resolve(
  process.cwd(),
  'server/data/masterCategories.json'
);
const TMP_MASTER_FILE = path.join(
  os.tmpdir(),
  'jobcat-jp',
  'masterCategories.json'
);

function resolveReadableOverrideFile(): string | null {
  const candidates = process.env.VERCEL
    ? [TMP_MASTER_FILE, LOCAL_MASTER_FILE]
    : [LOCAL_MASTER_FILE, TMP_MASTER_FILE];

  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch {
      // Ignore inaccessible paths in restricted runtimes
    }
  }
  return null;
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

class MasterStore {
  private data: MasterData | null = null;

  getMasterData(): MasterData {
    if (this.data) return this.data;
    const readableFile = resolveReadableOverrideFile();
    if (readableFile) {
      try {
        const raw = fs.readFileSync(readableFile, 'utf8');
        this.data = JSON.parse(raw) as MasterData;
        return this.data;
      } catch {
        // Fall through to bundled default master data
      }
    }
    this.data = {
      ...DEFAULT_MASTER_DATA,
      indeed: [...DEFAULT_MASTER_DATA.indeed],
      kbx: [...DEFAULT_MASTER_DATA.kbx],
      kyujinbu: [...DEFAULT_MASTER_DATA.kyujinbu],
      airworkMap: { ...DEFAULT_MASTER_DATA.airworkMap },
      jobopMap: { ...DEFAULT_MASTER_DATA.jobopMap },
    };
    return this.data;
  }

  saveMasterData(next: MasterData): MasterData {
    const serialized = JSON.stringify(next, null, 2);
    const primaryTarget = process.env.VERCEL ? TMP_MASTER_FILE : LOCAL_MASTER_FILE;
    if (!writeJsonAtomic(primaryTarget, serialized) && primaryTarget !== TMP_MASTER_FILE) {
      writeJsonAtomic(TMP_MASTER_FILE, serialized);
    }
    this.data = next;
    return next;
  }

  updatePlatformList(
    platform: Platform,
    items: string[] | GroupedCategoryItem[],
    sourceLabel = 'Custom Import'
  ): MasterData {
    const current = this.getMasterData();
    const updated: MasterData = {
      ...current,
      updatedAt: new Date().toISOString(),
      source: sourceLabel,
    };

    if (platform === 'indeed') {
      updated.indeed = Array.from(
        new Set((items as string[]).map((s) => s.trim()).filter(Boolean))
      );
    } else if (platform === 'kbx') {
      updated.kbx = Array.from(
        new Set((items as string[]).map((s) => s.trim()).filter(Boolean))
      );
    } else {
      const seen = new Set<string>();
      const groupedList: GroupedCategoryItem[] = [];
      for (const item of items) {
        if (typeof item === 'string') {
          const name = item.trim();
          if (name && !seen.has(name)) {
            seen.add(name);
            groupedList.push({ group: 'カスタム', name });
          }
        } else if (item && typeof item.name === 'string') {
          const name = item.name.trim();
          const group = (item.group || 'その他').trim();
          if (name && !seen.has(name)) {
            seen.add(name);
            groupedList.push({ group, name });
          }
        }
      }
      updated.kyujinbu = groupedList;
    }

    return this.saveMasterData(updated);
  }
}

export const masterStore = new MasterStore();
