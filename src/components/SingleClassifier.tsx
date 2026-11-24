import { useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  Check,
  Copy,
  Database,
  Play,
  Sparkles,
} from 'lucide-react';
import type {
  ClassificationResult,
  HashMode,
  MasterData,
  Platform,
} from '../types/classifier';

interface SingleClassifierProps {
  master: MasterData | null;
  onCacheUpdated: () => void;
}

const PLATFORM_META: Record<
  Platform,
  { label: string; ruleSummary: string }
> = {
  indeed: {
    label: 'Indeed',
    ruleSummary:
      'Chọn 2–3 danh mục (khuyến nghị 3) · Khớp Kanji 100% · Tối đa 1 mục その他 · Map Airwork & JOBOP',
  },
  kbx: {
    label: '求人ボックス (26 ngành)',
    ruleSummary:
      'Chọn duy nhất 1 mục trong 26 ngành chuẩn (職種区分) · Trả về NONE nếu thiếu dữ liệu',
  },
  kyujinbu: {
    label: '求人部 (Kèm 大分類)',
    ruleSummary:
      'Chọn duy nhất 1 danh mục 職種 · Khớp 100% kèm nhóm 大分類 · Trả về NONE nếu không khớp',
  },
};

export function SingleClassifier({
  master,
  onCacheUpdated,
}: SingleClassifierProps) {
  const [platform, setPlatform] = useState<Platform>('indeed');
  const [hashMode, setHashMode] = useState<HashMode>('title_and_content');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ClassificationResult | null>(null);
  const [copied, setCopied] = useState(false);

  const handleClassify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() && !description.trim()) {
      setError(
        'Vui lòng nhập Tên công việc (職種名) hoặc Nội dung công việc (仕事内容).'
      );
      return;
    }

    setLoading(true);
    setError(null);
    setCopied(false);

    try {
      const resp = await fetch('/api/v1/classify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          platform,
          title,
          description,
          hashMode,
        }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        throw new Error(data.error || 'Không thể phân loại công việc.');
      }
      setResult(data as ClassificationResult);
      onCacheUpdated();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Lỗi kết nối máy chủ.');
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = async () => {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.formattedCategory);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };

  const masterCount =
    platform === 'indeed'
      ? master?.indeed.length ?? 0
      : platform === 'kbx'
      ? master?.kbx.length ?? 0
      : master?.kyujinbu.length ?? 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-slate-900">
            Phân loại danh mục nghề nghiệp đơn lẻ
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Kiểm tra phân loại chuẩn Kanji với bộ nhớ đệm MD5 (0ms) và suy luận Chain-of-Thought khóa ngẫu nhiên.
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-500 tabular-nums">
          <span>
            Master {PLATFORM_META[platform].label}:{' '}
            {masterCount.toLocaleString()} mục
          </span>
          <span aria-hidden="true">·</span>
          <span>Seed 42</span>
          <span aria-hidden="true">·</span>
          <span>JSON Schema</span>
        </div>
      </div>

      <div className="grid grid-cols-1 items-stretch gap-6 lg:grid-cols-12">
        {/* Left Column: Input Form */}
        <form
          onSubmit={handleClassify}
          className="flex flex-col justify-between rounded-xl border border-slate-200 bg-white p-6 lg:col-span-5"
        >
          <div className="space-y-5">
            <div>
              <span className="block text-xs font-semibold text-slate-700">
                1. Chọn nền tảng tuyển dụng
              </span>
              <div
                role="group"
                aria-label="Chọn nền tảng tuyển dụng"
                className="mt-2 grid grid-cols-1 gap-1 rounded-lg bg-slate-100 p-1 sm:grid-cols-3"
              >
                {(['indeed', 'kbx', 'kyujinbu'] as Platform[]).map((p) => {
                  const active = platform === p;
                  return (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setPlatform(p)}
                      className={`rounded-md px-2.5 py-2 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                        active
                          ? 'bg-white text-slate-900 shadow-xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      {PLATFORM_META[p].label}
                    </button>
                  );
                })}
              </div>
              <p className="mt-2 text-xs text-slate-500 leading-relaxed">
                {PLATFORM_META[platform].ruleSummary}
              </p>
            </div>

            <div>
              <label
                htmlFor="job-title-input"
                className="block text-xs font-semibold text-slate-700"
              >
                2. 職種名 (Tên công việc)
              </label>
              <input
                id="job-title-input"
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Nhập tên công việc tiếng Nhật (VD: 倉庫内軽作業スタッフ)"
                className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-700/15"
              />
            </div>

            <div>
              <label
                htmlFor="job-desc-input"
                className="block text-xs font-semibold text-slate-700"
              >
                3. 仕事内容 (Nội dung công việc)
              </label>
              <textarea
                id="job-desc-input"
                rows={8}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Dán mô tả chi tiết công việc tiếng Nhật tại đây..."
                className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-sm leading-relaxed text-slate-900 placeholder:text-slate-400 focus:border-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-700/15"
              />
            </div>

            <div>
              <span className="block text-xs font-semibold text-slate-700">
                Chế độ băm Cache (MD5 Dedup)
              </span>
              <div className="mt-2 grid grid-cols-2 gap-1 rounded-lg bg-slate-100 p-1">
                <button
                  type="button"
                  onClick={() => setHashMode('title_and_content')}
                  className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                    hashMode === 'title_and_content'
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Tên + Nội dung
                </button>
                <button
                  type="button"
                  onClick={() => setHashMode('title_only')}
                  className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                    hashMode === 'title_only'
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Chỉ Tên công việc
                </button>
              </div>
            </div>
          </div>

          <div className="mt-6 pt-4 border-t border-slate-100">
            <button
              type="submit"
              disabled={loading}
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-blue-700 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-60 whitespace-nowrap shrink-0"
            >
              <Play className="h-4 w-4" aria-hidden="true" />
              <span>{loading ? 'Đang phân tích...' : 'Phân loại ngay'}</span>
            </button>
          </div>
        </form>

        {/* Right Column: Result Panel */}
        <div className="flex flex-col rounded-xl border border-slate-200 bg-white p-6 lg:col-span-7">
          {error && (
            <div
              role="alert"
              className="mb-5 flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
            >
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
              <div>
                <p className="font-semibold">
                  Không thể hoàn thành phân loại (Hết hạn mức / Lỗi API)
                </p>
                <p className="mt-0.5 text-xs text-red-700">{error}</p>
              </div>
            </div>
          )}

          {result?.fallbackNotice && (
            <div
              role="status"
              className="mb-5 flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900"
            >
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
              <div>
                <p className="font-semibold">Đã tự động chuyển Model dự phòng</p>
                <p className="mt-0.5">{result.fallbackNotice}</p>
              </div>
            </div>
          )}

          {loading ? (
            <div className="flex flex-1 flex-col justify-between space-y-6 animate-pulse">
              <div className="space-y-4">
                <div className="h-5 w-48 rounded bg-slate-200" />
                <div className="h-14 w-full rounded-lg bg-slate-100" />
                <div className="h-28 w-full rounded-lg bg-slate-100" />
                <div className="h-24 w-full rounded-lg bg-slate-100" />
              </div>
              <div className="h-4 w-64 rounded bg-slate-100" />
            </div>
          ) : !result ? (
            <div className="flex flex-1 flex-col items-center justify-center py-14 text-center">
              <div className="flex h-11 w-11 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-slate-600">
                <Sparkles className="h-5 w-5" aria-hidden="true" />
              </div>
              <h2 className="mt-4 font-display text-base font-semibold text-slate-900">
                Sẵn sàng phân tích chuẩn Kanji
              </h2>
              <p className="mt-1.5 max-w-md text-sm text-slate-600">
                Nhập <strong className="font-semibold text-slate-800">職種名</strong> và{' '}
                <strong className="font-semibold text-slate-800">仕事内容</strong> rồi nhấn{' '}
                <strong className="font-semibold text-slate-800">Phân loại ngay</strong>. Hệ thống kiểm tra Cache MD5 trước khi gọi AI.
              </p>
            </div>
          ) : (
            <div className="flex flex-1 flex-col justify-between space-y-6">
              <div className="space-y-6">
                {/* Result Header */}
                <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-4">
                  <div className="flex flex-wrap items-center gap-3 text-xs">
                    {result.fromCache ? (
                      <span className="inline-flex items-center gap-1.5 font-semibold text-emerald-700">
                        <Database className="h-3.5 w-3.5" aria-hidden="true" />
                        CACHE HIT · 0ms (0 API calls)
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 font-semibold text-blue-700">
                        <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                        {result.modelUsed || 'GEMINI AI'} · {result.latencyMs}ms
                      </span>
                    )}
                    <span aria-hidden="true" className="text-slate-300">
                      ·
                    </span>
                    <span className="font-mono text-slate-600 tabular-nums">
                      Độ tin cậy: {result.confidence}%
                    </span>
                    <span aria-hidden="true" className="text-slate-300">
                      ·
                    </span>
                    <span className="font-mono text-slate-500">
                      MD5: {result.hash.slice(0, 10)}
                    </span>
                  </div>

                  <button
                    type="button"
                    onClick={handleCopy}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 whitespace-nowrap shrink-0"
                  >
                    {copied ? (
                      <>
                        <Check
                          className="h-3.5 w-3.5 text-emerald-700"
                          aria-hidden="true"
                        />
                        <span className="text-emerald-700">Đã sao chép</span>
                      </>
                    ) : (
                      <>
                        <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>Sao chép kết quả</span>
                      </>
                    )}
                  </button>
                </div>

                {/* Formatted Output */}
                <div>
                  <span className="block text-xs font-semibold text-slate-500">
                    Chuỗi Category chuẩn (Copy-ready)
                  </span>
                  <div
                    data-testid="formatted-category-output"
                    className={`mt-2 rounded-lg border px-4 py-3 font-medium text-base ${
                      result.isNone
                        ? 'border-amber-200 bg-amber-50 text-amber-900'
                        : 'border-slate-200 bg-slate-50 text-slate-900'
                    }`}
                  >
                    {result.formattedCategory}
                  </div>
                </div>

                {/* Structured Mapping Table */}
                <div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-500">
                      Chi tiết đối chiếu Master &amp; Mã liên kết
                    </span>
                    <span className="text-xs text-slate-500 tabular-nums">
                      Số mục その他: {result.sonotaCount}/1
                    </span>
                  </div>

                  {result.mappings.length === 0 ? (
                    <p className="mt-2 text-sm text-amber-800">
                      Không tìm thấy danh mục khớp hợp lệ (NONE). Hãy bổ sung thêm thông tin công việc.
                    </p>
                  ) : (
                    <div className="mt-2 overflow-x-auto rounded-lg border border-slate-200">
                      <table className="w-full text-left text-sm">
                        <thead className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                          <tr>
                            <th className="px-3.5 py-2.5">#</th>
                            <th className="px-3.5 py-2.5">
                              職業カテゴリー (Kanji 100%)
                            </th>
                            {result.platform === 'indeed' ? (
                              <>
                                <th className="px-3.5 py-2.5">Airコード値</th>
                                <th className="px-3.5 py-2.5">JOBOPコード</th>
                              </>
                            ) : result.platform === 'kyujinbu' ? (
                              <th className="px-3.5 py-2.5">大分類 (求人部)</th>
                            ) : (
                              <th className="px-3.5 py-2.5">Chuẩn áp dụng</th>
                            )}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {result.mappings.map((m, idx) => (
                            <tr key={m.category} className="hover:bg-slate-50">
                              <td className="px-3.5 py-2.5 font-mono text-xs text-slate-500 tabular-nums">
                                {idx + 1}
                              </td>
                              <td className="px-3.5 py-2.5 font-medium text-slate-900">
                                {m.category}
                                {m.isOther && (
                                  <span className="ml-2 text-xs font-normal text-amber-700">
                                    (その他)
                                  </span>
                                )}
                              </td>
                              {result.platform === 'indeed' ? (
                                <>
                                  <td className="px-3.5 py-2.5 font-mono text-xs text-slate-700 tabular-nums">
                                    {m.airworkCode ?? '—'}
                                  </td>
                                  <td className="px-3.5 py-2.5 font-mono text-xs text-slate-700 tabular-nums">
                                    {m.jobopCode ?? '—'}
                                  </td>
                                </>
                              ) : result.platform === 'kyujinbu' ? (
                                <td className="px-3.5 py-2.5 text-xs text-slate-600">
                                  {m.groupName ?? '—'}
                                </td>
                              ) : (
                                <td className="px-3.5 py-2.5 text-xs text-slate-600">
                                  26 ngành chuẩn KBX
                                </td>
                              )}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                {/* Chain-of-Thought Reasoning */}
                <div>
                  <span className="block text-xs font-semibold text-slate-500">
                    Lý do phân tích (Chain-of-Thought)
                  </span>
                  <p className="mt-2 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm leading-relaxed text-slate-700">
                    {result.reasoning}
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3 text-xs text-slate-500">
                <span>
                  Xác thực khớp tuyệt đối danh sách Master{' '}
                  {PLATFORM_META[result.platform].label}
                </span>
                <span className="font-mono tabular-nums">
                  {new Date(result.validatedAt).toLocaleTimeString('vi-VN')}
                </span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
