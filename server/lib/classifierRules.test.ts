import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCacheKey,
  chunkArray,
  clampConfidence,
  computeJobMd5Hash,
  validateAndNormalizeCategories,
} from './classifierRules';
import type { MasterData } from '../../src/types/classifier';

const mockMaster: MasterData = {
  indeed: [
    '梱包/仕分け/検品',
    '倉庫作業/軽作業',
    'その他物流',
    'その他販売/フロアスタッフ',
    '不動産法人営業',
    '不動産個人営業',
    'Webエンジニア',
  ],
  kbx: ['軽作業・倉庫作業', '営業・コールセンター', 'ITエンジニア'],
  kyujinbu: [
    { group: '軽作業・倉庫・物流', name: '仕分け・梱包・検品' },
    { group: '営業・販売従事者', name: '不動産営業従事者' },
  ],
  airworkMap: {
    '梱包/仕分け/検品': 'abc12',
    '不動産法人営業': 'fa76e',
  },
  jobopMap: {
    '梱包/仕分け/検品': '1000201',
    '不動産法人営業': '1000005',
  },
  updatedAt: '2026-11-23T00:00:00.000Z',
  source: 'test',
};

test('computeJobMd5Hash normalizes whitespace and supports title_only mode', () => {
  const h1 = computeJobMd5Hash('軽作業  スタッフ', '梱包\n\n仕分け', 'title_and_content');
  const h2 = computeJobMd5Hash('軽作業 スタッフ', '梱包 仕分け', 'title_and_content');
  assert.equal(h1, h2);

  const t1 = computeJobMd5Hash('軽作業 スタッフ', '説明A', 'title_only');
  const t2 = computeJobMd5Hash('軽作業 スタッフ', '説明B', 'title_only');
  assert.equal(t1, t2);
  assert.notEqual(h1, t1);
});

test('validateAndNormalizeCategories enforces Indeed exact match, max 3, and max 1 その他 rule', () => {
  const res = validateAndNormalizeCategories(
    [
      '梱包/仕分け/検品',
      'その他物流',
      '存在しないカテゴリー',
      'その他販売/フロアスタッフ',
      '倉庫作業/軽作業',
    ],
    'indeed',
    mockMaster
  );

  assert.equal(res.isNone, false);
  assert.deepEqual(res.categories, [
    '梱包/仕分け/検品',
    'その他物流',
    '倉庫作業/軽作業',
  ]);
  assert.equal(res.formattedCategory, '梱包/仕分け/検品、その他物流、倉庫作業/軽作業');
  assert.equal(res.sonotaCount, 1);
  assert.equal(res.mappings[0].airworkCode, 'abc12');
  assert.equal(res.mappings[0].jobopCode, '1000201');
});

test('validateAndNormalizeCategories returns NONE when no valid master match exists', () => {
  const res = validateAndNormalizeCategories(
    ['AIが作った偽カテゴリー'],
    'indeed',
    mockMaster
  );
  assert.equal(res.isNone, true);
  assert.deepEqual(res.categories, ['NONE']);
  assert.equal(res.formattedCategory, 'NONE');
});

test('validateAndNormalizeCategories enforces KBX 26 standard and Kyujinbu with 大分類', () => {
  const kbx = validateAndNormalizeCategories(
    ['軽作業・倉庫作業', 'ITエンジニア'],
    'kbx',
    mockMaster
  );
  assert.deepEqual(kbx.categories, ['軽作業・倉庫作業']);
  assert.equal(kbx.formattedCategory, '軽作業・倉庫作業');

  const kyujinbu = validateAndNormalizeCategories(
    ['不動産営業従事者', '仕分け・梱包・検品'],
    'kyujinbu',
    mockMaster
  );
  assert.deepEqual(kyujinbu.categories, ['不動産営業従事者']);
  assert.equal(kyujinbu.mappings[0].groupName, '営業・販売従事者');
});

test('chunkArray splits batches cleanly into 10-15 item slices', () => {
  const items = Array.from({ length: 25 }, (_, i) => i);
  const chunks = chunkArray(items, 10);
  assert.equal(chunks.length, 3);
  assert.equal(chunks[0].length, 10);
  assert.equal(chunks[2].length, 5);
});

test('buildCacheKey and clampConfidence behave predictably', () => {
  assert.equal(buildCacheKey('indeed', 'title_only', 'abc'), 'indeed:title_only:abc');
  assert.equal(clampConfidence(0.92), 92);
  assert.equal(clampConfidence(145), 100);
  assert.equal(clampConfidence(-5), 0);
});
