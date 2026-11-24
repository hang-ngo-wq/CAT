import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

test('Vercel CommonJS handler (api/index.cjs) serves /api/v1/health and /api/v1/master', async () => {
  const vercelHandler = require('../../api/index.cjs') as http.RequestListener;
  const server = http.createServer(vercelHandler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

  try {
    const addr = server.address();
    assert.ok(addr && typeof addr === 'object');
    const baseUrl = `http://127.0.0.1:${addr.port}`;

    const healthResp = await fetch(`${baseUrl}/api/v1/health`);
    assert.equal(healthResp.status, 200);
    const healthJson = (await healthResp.json()) as {
      status: string;
      masterCounts: { indeed: number; kbx: number; kyujinbu: number };
    };
    assert.equal(healthJson.status, 'ok');
    assert.ok(healthJson.masterCounts.indeed > 1000);
    assert.equal(healthJson.masterCounts.kbx, 26);
    assert.ok(healthJson.masterCounts.kyujinbu > 500);

    const masterResp = await fetch(`${baseUrl}/api/v1/master`);
    assert.equal(masterResp.status, 200);
    const masterJson = (await masterResp.json()) as {
      indeed: string[];
      kbx: string[];
      kyujinbu: Array<{ group: string; name: string }>;
    };
    assert.equal(masterJson.kbx.length, 26);
    assert.ok(masterJson.indeed.length > 1000);
    assert.ok(masterJson.kyujinbu.length > 500);

    const badClassify = await fetch(`${baseUrl}/api/v1/classify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ platform: 'indeed', title: '', description: '' }),
    });
    assert.equal(badClassify.status, 400);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve()))
    );
  }
});
