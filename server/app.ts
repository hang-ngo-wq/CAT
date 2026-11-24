import express from 'express';
import type {
  BatchJobInput,
  GroupedCategoryItem,
  HashMode,
  Platform,
} from '../src/types/classifier';
import { cacheStore } from './lib/cacheStore';
import {
  classifyBatchJobs,
  classifySingleJob,
  formatGeminiError,
} from './lib/geminiClassifier';
import { masterStore } from './lib/masterStore';

const VALID_PLATFORMS = new Set<Platform>(['indeed', 'kbx', 'kyujinbu']);
const VALID_HASH_MODES = new Set<HashMode>(['title_and_content', 'title_only']);

function parsePlatform(val: unknown): Platform {
  if (typeof val === 'string' && VALID_PLATFORMS.has(val as Platform)) {
    return val as Platform;
  }
  return 'indeed';
}

function parseHashMode(val: unknown): HashMode {
  if (typeof val === 'string' && VALID_HASH_MODES.has(val as HashMode)) {
    return val as HashMode;
  }
  return 'title_and_content';
}

export function createApiApp(): express.Express {
  const app = express();
  app.use(express.json({ limit: '15mb' }));

  // Never serve service account credentials from public/assets/aistudio
  app.use('/assets/aistudio', (_req, res) => {
    res.status(403).json({ error: 'Access denied' });
  });

  app.get('/api/v1/health', (_req, res) => {
    const master = masterStore.getMasterData();
    const cache = cacheStore.getStats();
    res.json({
      status: 'ok',
      geminiConfigured: Boolean(
        process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEYS
      ),
      masterCounts: {
        indeed: master.indeed.length,
        kbx: master.kbx.length,
        kyujinbu: master.kyujinbu.length,
      },
      cacheEntries: cache.totalEntries,
    });
  });

  app.post('/api/v1/classify', async (req, res) => {
    try {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const platform = parsePlatform(body.platform);
      const hashMode = parseHashMode(body.hashMode);
      const title = typeof body.title === 'string' ? body.title : '';
      const description =
        typeof body.description === 'string' ? body.description : '';

      if (!title.trim() && !description.trim()) {
        res.status(400).json({
          error:
            'Vui lòng nhập ít nhất 職種名 (Tên công việc) hoặc 仕事内容 (Nội dung công việc).',
        });
        return;
      }

      const result = await classifySingleJob({
        platform,
        title,
        description,
        hashMode,
      });
      res.json(result);
    } catch (err: unknown) {
      const statusCode =
        typeof (err as { statusCode?: number }).statusCode === 'number'
          ? (err as { statusCode: number }).statusCode
          : formatGeminiError(err).status;
      const message =
        err instanceof Error ? err.message : formatGeminiError(err).message;
      console.error('[/api/v1/classify] error:', message);
      res.status(statusCode).json({ error: message });
    }
  });

  app.post('/api/v1/classify-batch', async (req, res) => {
    try {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const platform = parsePlatform(body.platform);
      const hashMode = parseHashMode(body.hashMode);
      const batchSize =
        typeof body.batchSize === 'number' ? body.batchSize : 10;
      const jobs = Array.isArray(body.jobs)
        ? (body.jobs as BatchJobInput[])
        : [];

      if (jobs.length === 0) {
        res.status(400).json({ error: 'Danh sách jobs không được để trống.' });
        return;
      }

      const batchOut = await classifyBatchJobs({
        platform,
        jobs,
        hashMode,
        batchSize,
      });

      res.json({
        platform,
        hashMode,
        total: jobs.length,
        processed: batchOut.results.length,
        ...batchOut,
      });
    } catch (err: unknown) {
      const formatted = formatGeminiError(err);
      console.error('[/api/v1/classify-batch] error:', formatted.message);
      res.status(formatted.status).json({ error: formatted.message });
    }
  });

  app.post('/api/v1/classify-batch-stream', async (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    const sendEvent = (data: unknown) => {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    try {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const platform = parsePlatform(body.platform);
      const hashMode = parseHashMode(body.hashMode);
      const batchSize =
        typeof body.batchSize === 'number' ? body.batchSize : 10;
      const jobs = Array.isArray(body.jobs)
        ? (body.jobs as BatchJobInput[])
        : [];

      if (jobs.length === 0) {
        sendEvent({ type: 'error', message: 'Danh sách jobs trống.' });
        res.end();
        return;
      }

      const out = await classifyBatchJobs({
        platform,
        jobs,
        hashMode,
        batchSize,
        onProgress: (ev) => sendEvent(ev),
      });

      sendEvent({
        type: 'complete',
        total: jobs.length,
        processed: out.results.length,
        cacheHits: out.cacheHits,
        aiCalls: out.aiCalls,
        noneCount: out.noneCount,
        errorCount: out.errorCount,
        notice: out.notices.join(' | ') || null,
        results: out.results,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Batch stream error';
      sendEvent({ type: 'error', message });
    } finally {
      res.end();
    }
  });

  app.get('/api/v1/master', (_req, res) => {
    const data = masterStore.getMasterData();
    res.json(data);
  });

  app.post('/api/v1/master', (req, res) => {
    try {
      const body = (req.body ?? {}) as {
        platform?: string;
        items?: string[] | GroupedCategoryItem[];
        source?: string;
      };
      const platform = parsePlatform(body.platform);
      if (!Array.isArray(body.items) || body.items.length === 0) {
        res
          .status(400)
          .json({ error: 'Danh sách danh mục cập nhật không hợp lệ.' });
        return;
      }
      const updated = masterStore.updatePlatformList(
        platform,
        body.items,
        body.source || 'Uploaded Master List'
      );
      res.json(updated);
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'Master update failed';
      res.status(500).json({ error: message });
    }
  });

  app.get('/api/v1/cache/stats', (_req, res) => {
    res.json(cacheStore.getStats());
  });

  app.get('/api/v1/cache/entries', (_req, res) => {
    res.json({
      stats: cacheStore.getStats(),
      entries: cacheStore.listEntries(),
    });
  });

  app.delete('/api/v1/cache/:key', (req, res) => {
    const key = decodeURIComponent(req.params.key || '');
    cacheStore.deleteEntry(key);
    res.json({
      stats: cacheStore.getStats(),
      entries: cacheStore.listEntries(),
    });
  });

  app.delete('/api/v1/cache', (_req, res) => {
    res.json(cacheStore.clear());
  });

  return app;
}
