import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Check,
  Database,
  RefreshCw,
  Search,
  Trash2,
  Upload,
} from 'lucide-react';
import type {
  CacheEntryItem,
  CacheStats,
  MasterData,
  Platform,
} from '../types/classifier';

interface MasterManagerProps {
  master: MasterData | null;
  cacheStats: CacheStats | null;
  onMasterUpdated: (next: MasterData) => void;
  onCacheCleared: (next: CacheStats) => void;
}

export function MasterManager({
  master,
  cacheStats,
  onMasterUpdated,
  onCacheCleared,
}: MasterManagerProps) {
  const [viewPlatform, setViewPlatform] = useState<Platform>('indeed');
  const [searchQuery, setSearchQuery] = useState('');
  const [importPlatform, setImportPlatform] = useState<Platform>('indeed');
  const [pasteText, setPasteText] = useState('');
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);

  // MD5 Cache Inspector state
  const [cacheEntries, setCacheEntries] = useState<CacheEntryItem[]>([]);
  const [cacheSearch, setCacheSearch] = useState('');
  const [cachePlatformFilter, setCachePlatformFilter] = useState<
    Platform | 'all'
  >('all');
  const [loadingCache, setLoadingCache] = useState(false);

  const loadCacheEntries = useCallback(async () => {
    setLoadingCache(true);
    try {
      const resp = await fetch('/api/v1/cache/entries');
      if (resp.ok) {
        const data = (await resp.json()) as {
          stats: CacheStats;
          entries: CacheEntryItem[];
        };
        setCacheEntries(data.entries || []);
        if (data.stats) onCacheCleared(data.stats);
      }
    } finally {
      setLoadingCache(false);
    }
  }, [onCacheCleared]);

  useEffect(() => {
    void loadCacheEntries();
  }, [loadCacheEntries]);

  const filteredRows = useMemo(() => {
    if (!master) return [];
    const q = searchQuery.trim().toLowerCase();

    if (viewPlatform === 'indeed') {
      return master.indeed
        .filter((name) => !q || name.toLowerCase().includes(q))
        .slice(0, 150)
        .map((name) => ({
          name,
          sub: name.includes('その他') ? 'その他 (Tối đa 1)' : 'Chuyên biệt',
          airwork: master.airworkMap[name] ?? '—',
          jobop: master.jobopMap[name] ?? '—',
        }));
    }

    if (viewPlatform === 'kbx') {
      return master.kbx
        .filter((name) => !q || name.toLowerCase().includes(q))
        .map((name) => ({
          name,
          sub: '26 ngành chuẩn KBX',
          airwork: '—',
          jobop: '—',
        }));
    }

    // kyujinbu (求人部 kèm nhóm 大分類)
    return master.kyujinbu
      .filter(
        (item) =>
          !q ||
          item.name.toLowerCase().includes(q) ||
          item.group.toLowerCase().includes(q)
      )
      .slice(0, 150)
      .map((item) => ({
        name: item.name,
        sub: item.group,
        airwork: '—',
        jobop: '—',
      }));
  }, [master, viewPlatform, searchQuery]);

  const filteredCacheEntries = useMemo(() => {
    const q = cacheSearch.trim().toLowerCase();
    return cacheEntries.filter((entry) => {
      if (
        cachePlatformFilter !== 'all' &&
        entry.platform !== cachePlatformFilter
      ) {
        return false;
      }
      if (!q) return true;
      return (
        entry.title.toLowerCase().includes(q) ||
        entry.formattedCategory.toLowerCase().includes(q) ||
        entry.hash.toLowerCase().includes(q)
      );
    });
  }, [cacheEntries, cacheSearch, cachePlatformFilter]);

  const handleImportSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const lines = pasteText
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines.length === 0) return;

    setImporting(true);
    setImportMsg(null);
    try {
      const items =
        importPlatform === 'kyujinbu'
          ? lines.map((line) => {
              const parts = line.split(/\t|,/);
              if (parts.length >= 2) {
                return { group: parts[0].trim(), name: parts[1].trim() };
              }
              return { group: 'カスタム', name: line };
            })
          : lines;

      const resp = await fetch('/api/v1/master', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          platform: importPlatform,
          items,
          source: 'Manual Import (UI)',
        }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Import failed');
      onMasterUpdated(data as MasterData);
      setPasteText('');
      setImportMsg(
        `Đã cập nhật ${lines.length} mục cho ${importPlatform.toUpperCase()}.`
      );
    } catch (err: unknown) {
      setImportMsg(
        err instanceof Error ? err.message : 'Lỗi cập nhật danh mục.'
      );
    } finally {
      setImporting(false);
    }
  };

  const handleDeleteCacheEntry = async (key: string) => {
    const resp = await fetch(`/api/v1/cache/${encodeURIComponent(key)}`, {
      method: 'DELETE',
    });
    if (resp.ok) {
      const data = (await resp.json()) as {
        stats: CacheStats;
        entries: CacheEntryItem[];
      };
      setCacheEntries(data.entries || []);
      onCacheCleared(data.stats);
    }
  };

  const handleClearCache = async () => {
    try {
      const resp = await fetch('/api/v1/cache', { method: 'DELETE' });
      const data = (await resp.json()) as CacheStats;
      setCacheEntries([]);
      onCacheCleared(data);
      setConfirmClear(false);
    } catch {
      setConfirmClear(false);
    }
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight text-slate-900">
          Quản lý Danh mục chuẩn &amp; Bộ nhớ đệm (MD5 Cache)
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          Dữ liệu Master từ sheet <span className="font-mono">リスト</span> (Indeed, KBX 26 ngành, 求人部 kèm 大分類) và trình quản trị MD5 Cache.
        </p>
      </div>

      {/* 4-column Summary Strip */}
      <div className="grid grid-cols-2 divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white p-5 sm:grid-cols-4 sm:divide-x sm:divide-y-0">
        <div className="px-3 py-1 first:pl-0">
          <div className="text-xs text-slate-500">Indeed Categories</div>
          <div className="mt-1 font-mono text-2xl font-semibold text-slate-900 tabular-nums">
            {master?.indeed.length.toLocaleString() ?? '0'}
          </div>
          <div className="mt-0.5 text-xs text-slate-500 tabular-nums">
            Map Airwork/JOBOP:{' '}
            {Object.keys(master?.airworkMap ?? {}).length.toLocaleString()}
          </div>
        </div>
        <div className="px-3 py-1">
          <div className="text-xs text-slate-500">求人ボックス (KBX)</div>
          <div className="mt-1 font-mono text-2xl font-semibold text-slate-900 tabular-nums">
            {master?.kbx.length.toLocaleString() ?? '0'}
          </div>
          <div className="mt-0.5 text-xs text-slate-500">26 ngành chuẩn</div>
        </div>
        <div className="px-3 py-1">
          <div className="text-xs text-slate-500">求人部 (職種区分)</div>
          <div className="mt-1 font-mono text-2xl font-semibold text-slate-900 tabular-nums">
            {master?.kyujinbu.length.toLocaleString() ?? '0'}
          </div>
          <div className="mt-0.5 text-xs text-slate-500">Kèm nhóm 大分類</div>
        </div>
        <div className="px-3 py-1">
          <div className="text-xs text-slate-500">Cache nội bộ (MD5)</div>
          <div className="mt-1 font-mono text-2xl font-semibold text-emerald-700 tabular-nums">
            {cacheStats?.totalEntries.toLocaleString() ?? '0'}
          </div>
          <div className="mt-0.5 text-xs text-slate-500 tabular-nums">
            NONE: {cacheStats?.noneEntries ?? 0} mục
          </div>
        </div>
      </div>

      {/* Prominent MD5 Cache Inspector Section */}
      <section
        aria-label="Quản trị Bộ nhớ đệm (MD5 Cache)"
        className="rounded-xl border border-slate-200 bg-white p-6 space-y-4"
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2.5">
            <Database className="h-5 w-5 text-emerald-700" aria-hidden="true" />
            <div>
              <h2 className="font-display text-base font-semibold text-slate-900">
                Quản trị Bộ nhớ đệm (MD5 Cache)
              </h2>
              <p className="text-xs text-slate-600">
                Hiển thị toàn bộ bản ghi đã lưu ({cacheEntries.length} mục) — mỗi công việc trùng mã MD5 được trả về ngay trong 0ms với 0 API calls.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void loadCacheEntries()}
              disabled={loadingCache}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${loadingCache ? 'animate-spin' : ''}`}
                aria-hidden="true"
              />
              <span>Làm mới</span>
            </button>

            {!confirmClear ? (
              <button
                type="button"
                onClick={() => setConfirmClear(true)}
                disabled={cacheEntries.length === 0}
                className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Xóa toàn bộ Cache</span>
              </button>
            ) : (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleClearCache}
                  className="rounded-lg bg-red-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-800"
                >
                  Xác nhận xóa
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmClear(false)}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  Hủy
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Cache filter controls */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1">
            {(
              [
                { id: 'all', label: 'Tất cả' },
                { id: 'indeed', label: 'Indeed' },
                { id: 'kbx', label: '求人ボックス' },
                { id: 'kyujinbu', label: '求人部' },
              ] as Array<{ id: Platform | 'all'; label: string }>
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setCachePlatformFilter(tab.id)}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                  cachePlatformFilter === tab.id
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="relative flex-1 min-w-52 max-w-sm">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400"
              aria-hidden="true"
            />
            <input
              type="text"
              value={cacheSearch}
              onChange={(e) => setCacheSearch(e.target.value)}
              placeholder="Tìm theo tên CV, Category hoặc mã MD5..."
              aria-label="Tìm kiếm trong MD5 Cache"
              className="w-full rounded-lg border border-slate-300 bg-white py-1.5 pl-8 pr-3 text-xs text-slate-900 placeholder:text-slate-400 focus:border-blue-700 focus:outline-none"
            />
          </div>
        </div>

        <div className="max-h-72 overflow-auto rounded-lg border border-slate-200">
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 border-b border-slate-200 bg-slate-50 font-semibold text-slate-600">
              <tr>
                <th className="px-3.5 py-2.5">Mã MD5</th>
                <th className="px-3.5 py-2.5">Nền tảng</th>
                <th className="px-3.5 py-2.5">職種名 (Tên CV)</th>
                <th className="px-3.5 py-2.5">Category đã lưu</th>
                <th className="px-3.5 py-2.5 text-right">Tin cậy</th>
                <th className="px-3.5 py-2.5">Thời gian</th>
                <th className="px-3.5 py-2.5 text-right">Thao tác</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredCacheEntries.length === 0 ? (
                <tr>
                  <td
                    colSpan={7}
                    className="px-4 py-8 text-center text-slate-500"
                  >
                    Chưa có bản ghi Cache MD5 nào khớp bộ lọc.
                  </td>
                </tr>
              ) : (
                filteredCacheEntries.map((entry) => (
                  <tr key={entry.key} className="hover:bg-slate-50">
                    <td className="px-3.5 py-2 font-mono text-slate-600">
                      {entry.hash.slice(0, 12)}
                    </td>
                    <td className="px-3.5 py-2 font-medium text-slate-700 uppercase">
                      {entry.platform}
                    </td>
                    <td className="max-w-48 truncate px-3.5 py-2 text-slate-900">
                      {entry.title || '(Chưa lưu tiêu đề)'}
                    </td>
                    <td
                      className={`max-w-xs truncate px-3.5 py-2 font-medium ${
                        entry.isNone ? 'text-amber-700' : 'text-slate-900'
                      }`}
                    >
                      {entry.formattedCategory}
                    </td>
                    <td className="px-3.5 py-2 text-right font-mono text-slate-700 tabular-nums">
                      {entry.confidence}%
                    </td>
                    <td className="px-3.5 py-2 font-mono text-slate-500 tabular-nums whitespace-nowrap">
                      {new Date(entry.cachedAt).toLocaleString('vi-VN')}
                    </td>
                    <td className="px-3.5 py-2 text-right">
                      <button
                        type="button"
                        onClick={() => void handleDeleteCacheEntry(entry.key)}
                        aria-label={`Xóa cache ${entry.hash.slice(0, 8)}`}
                        className="rounded px-2 py-1 text-red-700 hover:bg-red-50"
                      >
                        Xóa
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Searchable Master Table */}
        <div className="rounded-xl border border-slate-200 bg-white p-6 lg:col-span-7 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1">
              {(
                [
                  { id: 'indeed', label: 'Indeed' },
                  { id: 'kbx', label: '求人ボックス (26)' },
                  { id: 'kyujinbu', label: '求人部 (大分類)' },
                ] as Array<{ id: Platform; label: string }>
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setViewPlatform(tab.id)}
                  className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                    viewPlatform === tab.id
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="relative flex-1 min-w-48 max-w-xs">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400"
                aria-hidden="true"
              />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Tìm danh mục hoặc 大分類..."
                aria-label="Tìm kiếm danh mục chuẩn"
                className="w-full rounded-lg border border-slate-300 bg-white py-1.5 pl-8 pr-3 text-xs text-slate-900 placeholder:text-slate-400 focus:border-blue-700 focus:outline-none"
              />
            </div>
          </div>

          <div className="max-h-96 overflow-y-auto rounded-lg border border-slate-200">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 border-b border-slate-200 bg-slate-50 font-semibold text-slate-600">
                <tr>
                  <th className="px-3.5 py-2.5">Tên danh mục chuẩn</th>
                  <th className="px-3.5 py-2.5">Phân loại / 大分類</th>
                  {viewPlatform === 'indeed' && (
                    <>
                      <th className="px-3.5 py-2.5">Airwork</th>
                      <th className="px-3.5 py-2.5">JOBOP</th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredRows.length === 0 ? (
                  <tr>
                    <td
                      colSpan={4}
                      className="px-4 py-8 text-center text-slate-500"
                    >
                      Không tìm thấy danh mục phù hợp.
                    </td>
                  </tr>
                ) : (
                  filteredRows.map((row) => (
                    <tr
                      key={`${row.name}-${row.sub}`}
                      className="hover:bg-slate-50"
                    >
                      <td className="px-3.5 py-2 font-medium text-slate-900">
                        {row.name}
                      </td>
                      <td className="px-3.5 py-2 text-slate-600">{row.sub}</td>
                      {viewPlatform === 'indeed' && (
                        <>
                          <td className="px-3.5 py-2 font-mono text-slate-600 tabular-nums">
                            {row.airwork}
                          </td>
                          <td className="px-3.5 py-2 font-mono text-slate-600 tabular-nums">
                            {row.jobop}
                          </td>
                        </>
                      )}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-slate-500">
            Hiển thị tối đa 150 dòng khớp đầu tiên · Nguồn: {master?.source ?? '—'}
          </p>
        </div>

        {/* Right: Custom Master Import */}
        <form
          onSubmit={handleImportSubmit}
          className="rounded-xl border border-slate-200 bg-white p-6 lg:col-span-5 space-y-4 self-start"
        >
          <h2 className="font-display text-base font-semibold text-slate-900">
            Cập nhật danh sách Master tùy chỉnh
          </h2>
          <p className="text-xs text-slate-600">
            Dán danh sách danh mục (mỗi dòng 1 mục). Với 求人部 hỗ trợ định dạng{' '}
            <span className="font-mono">大分類,職種名</span> hoặc tab.
          </p>

          <div>
            <label
              htmlFor="import-platform"
              className="block text-xs font-semibold text-slate-700"
            >
              Nền tảng cần thay thế
            </label>
            <select
              id="import-platform"
              value={importPlatform}
              onChange={(e) => setImportPlatform(e.target.value as Platform)}
              className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
            >
              <option value="indeed">Indeed</option>
              <option value="kbx">求人ボックス (26 ngành chuẩn)</option>
              <option value="kyujinbu">求人部 (Kèm nhóm 大分類)</option>
            </select>
          </div>

          <div>
            <label
              htmlFor="paste-master-textarea"
              className="block text-xs font-semibold text-slate-700"
            >
              Nội dung danh mục (1 dòng / mục)
            </label>
            <textarea
              id="paste-master-textarea"
              rows={7}
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              placeholder={'建築法人営業\n建築個人営業\n土木法人営業'}
              className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-xs text-slate-900 placeholder:text-slate-400 focus:border-blue-700 focus:outline-none"
            />
          </div>

          {importMsg && (
            <div className="flex items-center gap-2 text-xs font-medium text-emerald-700">
              <Check className="h-3.5 w-3.5" aria-hidden="true" />
              <span>{importMsg}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={importing || !pasteText.trim()}
            className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Upload className="h-3.5 w-3.5" aria-hidden="true" />
            <span>{importing ? 'Đang lưu...' : 'Cập nhật danh sách Master'}</span>
          </button>
        </form>
      </div>
    </div>
  );
}
