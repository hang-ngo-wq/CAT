import { useState } from 'react';
import { Check, Copy, Play } from 'lucide-react';

export function ApiReference() {
  const origin =
    typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000';
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [testResponse, setTestResponse] = useState<string>('');
  const [testing, setTesting] = useState(false);

  const singleCurl = `curl -X POST "${origin}/api/v1/classify" \\
  -H "Content-Type: application/json" \\
  -d '{
    "platform": "indeed",
    "title": "お花を扱うモクモク軽作業",
    "description": "梱包、仕分け・シール貼り、検品を行う軽作業です。",
    "hashMode": "title_and_content"
  }'`;

  const batchCurl = `curl -X POST "${origin}/api/v1/classify-batch" \\
  -H "Content-Type: application/json" \\
  -d '{
    "platform": "indeed",
    "hashMode": "title_and_content",
    "batchSize": 10,
    "jobs": [
      { "id": 1, "title": "不動産法人営業", "description": "法人向けオフィス仲介営業" },
      { "id": 2, "title": "一般事務", "description": "データ入力と電話応対" }
    ]
  }'`;

  const handleCopy = async (id: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(id);
      setTimeout(() => setCopiedKey(null), 1600);
    } catch {
      setCopiedKey(null);
    }
  };

  const handleTestEndpoint = async () => {
    setTesting(true);
    try {
      const resp = await fetch('/api/v1/classify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          platform: 'kyujinbu',
          title: 'お花を扱うモクモク軽作業',
          description: '梱包、仕分け・シール貼り、検品を行う軽作業です。',
          hashMode: 'title_and_content',
        }),
      });
      const json = await resp.json();
      setTestResponse(JSON.stringify(json, null, 2));
    } catch (err: unknown) {
      setTestResponse(
        JSON.stringify(
          { error: err instanceof Error ? err.message : 'Request failed' },
          null,
          2
        )
      );
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight text-slate-900">
          REST API cho hệ thống &amp; tool ngoài
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          Gọi trực tiếp từ Google Apps Script, Python, hoặc pipeline ETL mà không cần sửa mã nguồn cũ.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-base font-semibold text-slate-900">
              POST /api/v1/classify
            </h2>
            <button
              type="button"
              onClick={() => handleCopy('single', singleCurl)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              {copiedKey === 'single' ? (
                <Check className="h-3.5 w-3.5 text-emerald-700" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
              <span>{copiedKey === 'single' ? 'Đã chép' : 'Sao chép cURL'}</span>
            </button>
          </div>
          <p className="text-xs text-slate-600">
            Phân loại đơn lẻ, kiểm tra MD5 Cache trước khi gọi Gemini, tự động áp luật Kanji 100% và map Airwork/JOBOP.
          </p>
          <pre className="overflow-x-auto rounded-lg border border-slate-200 bg-slate-900 p-4 font-mono text-xs leading-relaxed text-slate-100">
            {singleCurl}
          </pre>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-base font-semibold text-slate-900">
              POST /api/v1/classify-batch
            </h2>
            <button
              type="button"
              onClick={() => handleCopy('batch', batchCurl)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              {copiedKey === 'batch' ? (
                <Check className="h-3.5 w-3.5 text-emerald-700" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
              <span>{copiedKey === 'batch' ? 'Đã chép' : 'Sao chép cURL'}</span>
            </button>
          </div>
          <p className="text-xs text-slate-600">
            Gom lô 10–15 công việc trong 1 request, khử trùng lặp nội bộ trước khi gửi AI để tiết kiệm tối đa quota.
          </p>
          <pre className="overflow-x-auto rounded-lg border border-slate-200 bg-slate-900 p-4 font-mono text-xs leading-relaxed text-slate-100">
            {batchCurl}
          </pre>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-base font-semibold text-slate-900">
              Kiểm tra trực tiếp Endpoint
            </h2>
            <p className="text-xs text-slate-600">
              Gửi request thật tới <span className="font-mono">/api/v1/classify</span> (nền tảng 求人部).
            </p>
          </div>
          <button
            type="button"
            onClick={handleTestEndpoint}
            disabled={testing}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-700 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-800 disabled:opacity-60"
          >
            <Play className="h-3.5 w-3.5" aria-hidden="true" />
            <span>{testing ? 'Đang gọi API...' : 'Gửi thử Request'}</span>
          </button>
        </div>

        {testResponse && (
          <pre className="max-h-72 overflow-auto rounded-lg border border-slate-200 bg-slate-50 p-4 font-mono text-xs text-slate-800">
            {testResponse}
          </pre>
        )}
      </div>
    </div>
  );
}
