import { useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  Download,
  Play,
  Upload,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import type { BatchJobResult, HashMode, Platform } from '../types/classifier';

interface BatchProcessorProps {
  onCacheUpdated: () => void;
}

type RawRow = Record<string, unknown>;

function decodeCsvBuffer(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  const utf8Text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  // If replacement characters appear, fall back to Shift-JIS (common for Japanese Excel CSV exports)
  if (utf8Text.includes('\uFFFD')) {
    try {
      return new TextDecoder('shift_jis').decode(bytes);
    } catch {
      return utf8Text;
    }
  }
  return utf8Text.replace(/^\uFEFF/, '');
}

export function BatchProcessor({ onCacheUpdated }: BatchProcessorProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [fileName, setFileName] = useState<string>('');
  const [rows, setRows] = useState<RawRow[]>([]);
  const [columns, setColumns] = useState<string[]>([]);
  const [titleCol, setTitleCol] = useState<string>('');
  const [descCol, setDescCol] = useState<string>('');
  const [platform, setPlatform] = useState<Platform>('indeed');
  const [hashMode, setHashMode] = useState<HashMode>('title_and_content');
  const [batchSize, setBatchSize] = useState<number>(10);
  const [dragActive, setDragActive] = useState(false);

  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [switchNotices, setSwitchNotices] = useState<string[]>([]);
  const [progress, setProgress] = useState({
    total: 0,
    processed: 0,
    cacheHits: 0,
    aiCalls: 0,
    noneCount: 0,
    errorCount: 0,
  });
  const [results, setResults] = useState<BatchJobResult[]>([]);

  const applyParsedRows = (parsedRows: RawRow[], sourceName: string) => {
    if (parsedRows.length === 0) {
      setError('File không có dữ liệu.');
      return;
    }
    const colSet = new Set<string>();
    for (const r of parsedRows.slice(0, 20)) {
      Object.keys(r).forEach((k) => colSet.add(k));
    }
    const cols = Array.from(colSet);
    setRows(parsedRows);
    setColumns(cols);
    setFileName(sourceName);
    setResults([]);
    setError(null);
    setSwitchNotices([]);
    setProgress({
      total: parsedRows.length,
      processed: 0,
      cacheHits: 0,
      aiCalls: 0,
      noneCount: 0,
      errorCount: 0,
    });

    const autoTitle =
      cols.find((c) => /職種|title|ten|name/i.test(c)) || cols[0] || '';
    const autoDesc =
      cols.find((c) => /仕事|内容|desc|content|body/i.test(c)) ||
      cols[1] ||
      cols[0] ||
      '';
    setTitleCol(autoTitle);
    setDescCol(autoDesc);
  };

  const handleFile = async (file: File) => {
    try {
      const buf = await file.arrayBuffer();
      const lower = file.name.toLowerCase();
      let wb: XLSX.WorkBook;

      if (lower.endsWith('.csv')) {
        const csvText = decodeCsvBuffer(buf);
        wb = XLSX.read(csvText, { type: 'string' });
      } else {
        wb = XLSX.read(buf, { type: 'array' });
      }

      const firstSheet = wb.SheetNames[0];
      if (!firstSheet) {
        setError('Không tìm thấy sheet nào trong file.');
        return;
      }
      const ws = wb.Sheets[firstSheet];
      const jsonRows = XLSX.utils.sheet_to_json<RawRow>(ws, { defval: '' });
      applyParsedRows(jsonRows, file.name);
    } catch (err: unknown) {
      setError(
        err instanceof Error
          ? err.message
          : 'Không thể đọc file Excel / CSV này.'
      );
    }
  };

  const handleRunBatch = async () => {
    if (rows.length === 0 || !titleCol) {
      setError('Vui lòng tải lên file Excel hoặc CSV và chọn cột 職種名.');
      return;
    }

    setProcessing(true);
    setError(null);
    setSwitchNotices([]);
    setResults([]);
    setProgress({
      total: rows.length,
      processed: 0,
      cacheHits: 0,
      aiCalls: 0,
      noneCount: 0,
      errorCount: 0,
    });

    const jobsPayload = rows.map((r, idx) => ({
      rowIndex: idx,
      title: String(r[titleCol] ?? ''),
      description: descCol ? String(r[descCol] ?? '') : '',
    }));

    try {
      const resp = await fetch('/api/v1/classify-batch-stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          platform,
          hashMode,
          batchSize,
          jobs: jobsPayload,
        }),
      });

      if (!resp.ok || !resp.body) {
        const text = await resp.text();
        throw new Error(text || 'Lỗi kết nối batch stream.');
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      const resultMap = new Map<number, BatchJobResult>();
      const noticesSeen = new Set<string>();

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split('\n\n');
        buffer = events.pop() || '';

        for (const evt of events) {
          const line = evt.split('\n').find((l) => l.startsWith('data: '));
          if (!line) continue;
          const payload = JSON.parse(line.slice(6)) as {
            type: 'progress' | 'complete' | 'error';
            total?: number;
            processed?: number;
            cacheHits?: number;
            aiCalls?: number;
            noneCount?: number;
            errorCount?: number;
            notice?: string | null;
            chunkResults?: BatchJobResult[];
            results?: BatchJobResult[];
            message?: string;
          };

          if (payload.type === 'error') {
            throw new Error(payload.message || 'Batch processing error');
          }

          if (payload.notice) {
            noticesSeen.add(payload.notice);
            setSwitchNotices(Array.from(noticesSeen));
          }

          if (payload.chunkResults) {
            for (const item of payload.chunkResults) {
              if (typeof item.rowIndex === 'number') {
                resultMap.set(item.rowIndex, item);
              }
            }
            setResults(
              Array.from(resultMap.values()).sort(
                (a, b) => (a.rowIndex ?? 0) - (b.rowIndex ?? 0)
              )
            );
          }

          if (payload.type === 'complete' && payload.results) {
            setResults(payload.results);
          }

          setProgress({
            total: payload.total ?? rows.length,
            processed: payload.processed ?? 0,
            cacheHits: payload.cacheHits ?? 0,
            aiCalls: payload.aiCalls ?? 0,
            noneCount: payload.noneCount ?? 0,
            errorCount: payload.errorCount ?? 0,
          });
        }
      }

      onCacheUpdated();
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : 'Xử lý hàng loạt thất bại.'
      );
    } finally {
      setProcessing(false);
    }
  };

  const buildExportRows = () => {
    const resultByIdx = new Map<number, BatchJobResult>();
    results.forEach((r) => {
      if (typeof r.rowIndex === 'number') resultByIdx.set(r.rowIndex, r);
    });

    return rows.map((orig, idx) => {
      const res = resultByIdx.get(idx);
      const airCodes =
        res?.mappings
          .map((m) => m.airworkCode)
          .filter(Boolean)
          .join(', ') || '';
      const jobopCodes =
        res?.mappings
          .map((m) => m.jobopCode)
          .filter(Boolean)
          .join(', ') || '';
      const groupName =
        res?.mappings
          .map((m) => m.groupName)
          .filter(Boolean)
          .join(', ') || '';

      return {
        ...orig,
        [`職業カテゴリー (${platform.toUpperCase()})`]:
          res?.formattedCategory ?? '',
        ...(platform === 'indeed'
          ? { Airコード値: airCodes, JOBOPコード: jobopCodes }
          : platform === 'kyujinbu'
          ? { 大分類: groupName }
          : {}),
        信頼度: res ? `${res.confidence}%` : '',
        判定ソース: res?.fromCache
          ? 'CACHE (0ms)'
          : res?.modelUsed || 'GEMINI AI',
        推論理由: res?.reasoning ?? '',
      };
    });
  };

  const handleExportExcel = () => {
    if (results.length === 0) return;
    const ws = XLSX.utils.json_to_sheet(buildExportRows());
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '分類結果');
    const outName = fileName
      ? fileName.replace(/\.(xlsx|xls|csv)$/i, '') +
        `_classified_${platform}.xlsx`
      : `classified_${platform}.xlsx`;
    XLSX.writeFile(wb, outName);
  };

  const handleExportCsv = () => {
    if (results.length === 0) return;
    const ws = XLSX.utils.json_to_sheet(buildExportRows());
    const csv = XLSX.utils.sheet_to_csv(ws);
    const blob = new Blob(['\uFEFF' + csv], {
      type: 'text/csv;charset=utf-8;',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName
      ? fileName.replace(/\.(xlsx|xls|csv)$/i, '') +
        `_classified_${platform}.csv`
      : `classified_${platform}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const percent = useMemo(() => {
    if (progress.total === 0) return 0;
    return Math.min(
      100,
      Math.round((progress.processed / progress.total) * 100)
    );
  }, [progress]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight text-slate-900">
          Xử lý hàng loạt bằng Excel &amp; CSV (.xlsx, .xls, .csv)
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          Nhận đầu vào Excel hoặc CSV (UTF-8 / Shift-JIS), gom lô 10–15 dòng/request và khử trùng MD5 để tiết kiệm tối đa quota.
        </p>
      </div>

      {/* Upload + Config Panel */}
      <div className="rounded-xl border border-slate-200 bg-white p-6 space-y-6">
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragActive(true);
          }}
          onDragLeave={() => setDragActive(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragActive(false);
            const f = e.dataTransfer.files?.[0];
            if (f) void handleFile(f);
          }}
          className={`flex flex-col items-center justify-center rounded-lg border-2 border-dashed px-6 py-8 text-center transition-colors ${
            dragActive
              ? 'border-blue-700 bg-blue-50/40'
              : 'border-slate-300 bg-slate-50/60 hover:border-slate-400'
          }`}
        >
          <Upload className="h-6 w-6 text-slate-500" aria-hidden="true" />
          <p className="mt-2.5 text-sm font-medium text-slate-900">
            {fileName ? (
              <>
                Đã nạp:{' '}
                <span className="font-mono text-blue-700">{fileName}</span> (
                {rows.length} dòng)
              </>
            ) : (
              'Kéo thả file Excel (.xlsx, .xls) hoặc .csv vào đây'
            )}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Hỗ trợ tự nhận diện mã hóa UTF-8 và Shift-JIS đối với file CSV tiếng Nhật.
          </p>
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleFile(f);
            }}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="mt-4 rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 whitespace-nowrap shrink-0"
          >
            Chọn file Excel / CSV từ máy tính
          </button>
        </div>

        {/* Column Mapping & Batch Controls */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <div>
            <label
              htmlFor="col-title-select"
              className="block text-xs font-semibold text-slate-700"
            >
              Cột 職種名 (Tên CV)
            </label>
            <select
              id="col-title-select"
              value={titleCol}
              onChange={(e) => setTitleCol(e.target.value)}
              disabled={columns.length === 0}
              className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 disabled:bg-slate-100"
            >
              {columns.length === 0 ? (
                <option value="">Chưa có file</option>
              ) : (
                columns.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))
              )}
            </select>
          </div>

          <div>
            <label
              htmlFor="col-desc-select"
              className="block text-xs font-semibold text-slate-700"
            >
              Cột 仕事内容 (Nội dung)
            </label>
            <select
              id="col-desc-select"
              value={descCol}
              onChange={(e) => setDescCol(e.target.value)}
              disabled={columns.length === 0}
              className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 disabled:bg-slate-100"
            >
              {columns.length === 0 ? (
                <option value="">Chưa có file</option>
              ) : (
                columns.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))
              )}
            </select>
          </div>

          <div>
            <label
              htmlFor="batch-platform-select"
              className="block text-xs font-semibold text-slate-700"
            >
              Nền tảng đích
            </label>
            <select
              id="batch-platform-select"
              value={platform}
              onChange={(e) => setPlatform(e.target.value as Platform)}
              className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
            >
              <option value="indeed">Indeed (2–3 mục)</option>
              <option value="kbx">求人ボックス (26 ngành chuẩn)</option>
              <option value="kyujinbu">求人部 (Kèm 大分類)</option>
            </select>
          </div>

          <div>
            <label
              htmlFor="batch-hash-select"
              className="block text-xs font-semibold text-slate-700"
            >
              Khử trùng MD5
            </label>
            <select
              id="batch-hash-select"
              value={hashMode}
              onChange={(e) => setHashMode(e.target.value as HashMode)}
              className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
            >
              <option value="title_and_content">Tên + Nội dung</option>
              <option value="title_only">Chỉ Tên công việc</option>
            </select>
          </div>

          <div>
            <label
              htmlFor="batch-size-select"
              className="block text-xs font-semibold text-slate-700"
            >
              Gom lô (Jobs/Request)
            </label>
            <select
              id="batch-size-select"
              value={batchSize}
              onChange={(e) => setBatchSize(Number(e.target.value))}
              className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 tabular-nums"
            >
              <option value={10}>10 dòng / request</option>
              <option value={12}>12 dòng / request</option>
              <option value={15}>15 dòng / request</option>
            </select>
          </div>
        </div>

        {error && (
          <div
            role="alert"
            className="flex items-start gap-2.5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
            <span>{error}</span>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-4 border-t border-slate-100 pt-4">
          <div className="text-xs text-slate-500 tabular-nums">
            {rows.length > 0
              ? `Sẵn sàng xử lý ${rows.length} dòng dữ liệu · Dự kiến ~${Math.max(
                  1,
                  Math.ceil(rows.length / batchSize)
                )} request AI tối đa`
              : 'Vui lòng tải lên file .xlsx, .xls hoặc .csv để bắt đầu.'}
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            {results.length > 0 && (
              <>
                <button
                  type="button"
                  onClick={handleExportCsv}
                  className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-800 transition-colors hover:bg-slate-50 whitespace-nowrap shrink-0"
                >
                  <Download className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Tải CSV (.csv)</span>
                </button>
                <button
                  type="button"
                  onClick={handleExportExcel}
                  className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-800 transition-colors hover:bg-slate-50 whitespace-nowrap shrink-0"
                >
                  <Download className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Tải Excel (.xlsx)</span>
                </button>
              </>
            )}

            <button
              type="button"
              onClick={handleRunBatch}
              disabled={processing || rows.length === 0}
              className="inline-flex items-center gap-2 rounded-lg bg-blue-700 px-5 py-2.5 text-xs font-semibold text-white transition-colors hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-60 whitespace-nowrap shrink-0"
            >
              <Play className="h-3.5 w-3.5" aria-hidden="true" />
              <span>
                {processing
                  ? 'Đang chạy lô AI...'
                  : 'Bắt đầu phân loại hàng loạt'}
              </span>
            </button>
          </div>
        </div>
      </div>

      {/* Progress & 4-Column KPI Strip */}
      {rows.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white p-6 space-y-5">
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs font-medium text-slate-700 tabular-nums">
              <span>
                Tiến độ xử lý: {progress.processed} / {progress.total} dòng (
                {percent}%)
              </span>
              <span className="font-mono text-slate-500">
                API Requests: {progress.aiCalls}
              </span>
            </div>
            <div
              role="progressbar"
              aria-valuenow={percent}
              aria-valuemin={0}
              aria-valuemax={100}
              className="h-2.5 w-full overflow-hidden rounded-full bg-slate-100"
            >
              <div
                className="h-full bg-blue-700 transition-all duration-300"
                style={{ width: `${percent}%` }}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 divide-y divide-slate-200 border-t border-slate-200 pt-4 sm:grid-cols-4 sm:divide-x sm:divide-y-0">
            <div className="px-3 py-1 first:pl-0">
              <div className="text-xs text-slate-500">Tổng số dòng</div>
              <div className="mt-1 font-mono text-xl font-semibold text-slate-900 tabular-nums">
                {progress.total}
              </div>
            </div>
            <div className="px-3 py-1">
              <div className="text-xs text-slate-500">Đã hoàn thành</div>
              <div className="mt-1 font-mono text-xl font-semibold text-blue-700 tabular-nums">
                {progress.processed}
              </div>
            </div>
            <div className="px-3 py-1">
              <div className="text-xs text-slate-500">Lấy từ Cache (0ms)</div>
              <div className="mt-1 font-mono text-xl font-semibold text-emerald-700 tabular-nums">
                {progress.cacheHits}
              </div>
            </div>
            <div className="px-3 py-1">
              <div className="text-xs text-slate-500">
                {progress.errorCount > 0
                  ? 'Lỗi API / Hết hạn mức'
                  : 'Không khớp (NONE)'}
              </div>
              <div
                className={`mt-1 font-mono text-xl font-semibold tabular-nums ${
                  progress.errorCount > 0 ? 'text-red-700' : 'text-amber-700'
                }`}
              >
                {progress.errorCount > 0
                  ? `${progress.errorCount} lỗi`
                  : progress.noneCount}
              </div>
            </div>
          </div>

          {switchNotices.length > 0 && (
            <div
              role="status"
              className="flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900"
            >
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
              <div className="space-y-1">
                {switchNotices.map((n, i) => (
                  <p key={i}>{n}</p>
                ))}
              </div>
            </div>
          )}

          {progress.errorCount > 0 && (
            <div
              role="alert"
              className="flex items-start gap-2.5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-800"
            >
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
              <span>
                Có {progress.errorCount} dòng không thể phân loại do đã hết hạn mức trên các model khả dụng:{' '}
                {results.find((r) => r.error)?.error ||
                  'Vui lòng kiểm tra GEMINI_API_KEY trong biến môi trường máy chủ.'}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Results Table */}
      {results.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
            <h2 className="font-display text-base font-semibold text-slate-900">
              Kết quả phân loại chi tiết ({results.length} dòng)
            </h2>
            <span className="text-xs text-slate-500">
              Khớp 100% Master List · Không tự tạo từ mới
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                <tr>
                  <th className="px-4 py-2.5">Dòng</th>
                  <th className="px-4 py-2.5">職種名 (Tên công việc)</th>
                  <th className="px-4 py-2.5">職業カテゴリー chuẩn</th>
                  <th className="px-4 py-2.5">
                    {platform === 'indeed'
                      ? 'Airwork / JOBOP'
                      : platform === 'kyujinbu'
                      ? '大分類'
                      : 'Chuẩn KBX'}
                  </th>
                  <th className="px-4 py-2.5">Nguồn / Model</th>
                  <th className="px-4 py-2.5 text-right">Tin cậy</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {results.map((r, idx) => {
                  const rowNum = (r.rowIndex ?? idx) + 1;
                  const airList = r.mappings
                    .map((m) => m.airworkCode)
                    .filter(Boolean)
                    .join(', ');
                  const jobopList = r.mappings
                    .map((m) => m.jobopCode)
                    .filter(Boolean)
                    .join(', ');
                  return (
                    <tr
                      key={`${rowNum}-${r.hash}`}
                      className="hover:bg-slate-50"
                    >
                      <td className="px-4 py-2.5 font-mono text-xs text-slate-500 tabular-nums">
                        #{rowNum}
                      </td>
                      <td className="max-w-xs truncate px-4 py-2.5 font-medium text-slate-900">
                        {r.title || '—'}
                      </td>
                      <td
                        className={`px-4 py-2.5 font-medium ${
                          r.isNone ? 'text-amber-700' : 'text-slate-900'
                        }`}
                      >
                        {r.formattedCategory}
                      </td>
                      <td className="px-4 py-2.5 font-mono text-xs text-slate-600 tabular-nums">
                        {r.platform === 'indeed'
                          ? `${airList || '—'} / ${jobopList || '—'}`
                          : r.platform === 'kyujinbu'
                          ? r.mappings[0]?.groupName ?? '—'
                          : r.isNone
                          ? '—'
                          : '26 ngành'}
                      </td>
                      <td className="px-4 py-2.5 text-xs font-medium whitespace-nowrap">
                        {r.fromCache ? (
                          <span className="text-emerald-700">Cache (0ms)</span>
                        ) : r.error ? (
                          <span className="text-red-700">Hết hạn mức / Lỗi</span>
                        ) : (
                          <span className="text-blue-700">
                            {r.modelUsed || 'Gemini AI'}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono text-xs text-slate-700 tabular-nums">
                        {r.confidence}%
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
