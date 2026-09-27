import {
  readFileSync,
  readdirSync,
  existsSync,
  mkdirSync,
  statSync,
} from 'node:fs';
import { resolve, extname, sep } from 'node:path';
import { Store } from '../lib/storage-v2.ts';
import { FinanceStore } from '../lib/finance-store.ts';
import {
  type FinanceCategory,
  type FinancePlace,
  type FinanceTransaction,
  type FinanceMutation,
} from '../lib/finance-types.ts';
const port = Number(process.env.PREVIEW_PORT || 4352),
  root = resolve(process.env.BUILT_ROOT || '.');
mkdirSync('work/preview-tmp', { recursive: true });
process.env.TEMP = resolve('work/preview-tmp');
process.env.TMP = resolve('work/preview-tmp');
const { Miniflare } = await import('miniflare');
const assetRoot = resolve(root, 'dist/client'),
  state = resolve(
    process.env.PREVIEW_STATE || 'work/local-state-' + port + '-v2',
  );
const types: Record<string, string> = {
  '.html': 'text/html;charset=utf-8',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
  '.wasm': 'application/wasm',
  '.gz': 'application/gzip',
  '.woff2': 'font/woff2',
};
const mf = new Miniflare({
  host: '127.0.0.1',
  port,
  modulesRoot: resolve(root, 'dist/server'),
  modules: [
    'index.js',
    ...readdirSync(resolve(root, 'dist/server'), { recursive: true })
      .map(String)
      .filter((p) => p.endsWith('.js') && p !== 'index.js'),
  ].map((p) => ({
    type: 'ESModule' as const,
    path: resolve(root, 'dist/server', p),
  })),
  compatibilityDate: '2026-05-15',
  compatibilityFlags: ['nodejs_compat'],
  serviceBindings: {
    ASSETS: async (request: Request) => {
      const path = resolve(
        assetRoot,
        '.' + decodeURIComponent(new URL(request.url).pathname),
      );
      if (
        !path.startsWith(assetRoot + sep) ||
        !existsSync(path) ||
        !statSync(path).isFile()
      )
        return new Response('Not found', { status: 404 });
      return new Response(readFileSync(path), {
        headers: {
          'content-type': types[extname(path)] || 'application/octet-stream',
        },
      });
    },
  },
  d1Databases: ['DB'],
  d1Persist: state + '/d1',
  kvNamespaces: ['BACKUPS'],
  kvPersist: state + '/kv',
  bindings: {
    AUTH_MODE: 'local',
    MIGRATION_ENABLED: 'false',
    ...(process.env.PRIVATE_FINANCE_REVIEW
      ? {
          FINANCE_PREVIEW_REVIEW: readFileSync(
            resolve(process.env.PRIVATE_FINANCE_REVIEW),
            'utf8',
          ),
        }
      : {}),
  },
});
const db = await mf.getD1Database('DB');
await db
  .prepare(
    'CREATE TABLE IF NOT EXISTS local_preview_migrations(name TEXT PRIMARY KEY)',
  )
  .run();
for (const name of readdirSync(resolve('drizzle'))
  .filter((x) => x.endsWith('.sql'))
  .sort()) {
  if (
    await db
      .prepare('SELECT name FROM local_preview_migrations WHERE name=?')
      .bind(name)
      .first()
  )
    continue;
  for (const sql of readFileSync(resolve('drizzle', name), 'utf8')
    .split('--> statement-breakpoint')
    .map((s) => s.trim())
    .filter(Boolean))
    await db.prepare(sql).run();
  await db
    .prepare('INSERT INTO local_preview_migrations(name) VALUES(?)')
    .bind(name)
    .run();
}
const store = new Store(db as unknown as D1Database, 'local-qiushan');
await store.initialize('local-test');

const finance = new FinanceStore(db as unknown as D1Database, 'local-qiushan');
const configured = process.env.PRIVATE_FINANCE_CONFIG
  ? JSON.parse(
      readFileSync(resolve(process.env.PRIVATE_FINANCE_CONFIG), 'utf8'),
    )
  : null;
const fallback = {
  categories: [
    { id: 'root', version: 0, name: '演示用途', parentId: null, level: 1 },
    { id: 'sub', version: 0, name: '演示日常', parentId: 'root', level: 2 },
    { id: 'leaf', version: 0, name: '演示消费', parentId: 'sub', level: 3 },
  ],
  places: [
    { id: 'area', version: 0, name: '演示地点', parentId: null },
    { id: 'venue', version: 0, name: '演示餐厅', parentId: 'area' },
  ],
};
if (configured && !(await finance.snapshot('personal')).categories.length) {
  await finance.mutate({
    space: 'personal',
    operationId: 'finance-private-config-v1',
    baseVersion: 0,
    mutation: { type: 'configure', ...configured },
  });
}
if (!(await finance.snapshot('demo')).categories.length) {
  const config = configured || fallback;
  await finance.mutate({
    space: 'demo',
    operationId: 'finance-demo-config-v1',
    baseVersion: 0,
    mutation: { type: 'configure', ...config },
  });
  const date = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10),
    month = date.slice(0, 7),
    limit = Number(date.slice(8)),
    opening = '2026-01-01T00:00:00+08:00';
  const categories = config.categories as FinanceCategory[],
    places = config.places as FinancePlace[],
    leaves = categories.filter((c) => c.level === 3 && !c.other),
    roots = categories.filter((c) => c.level === 1),
    venues = places.filter((p) => p.parentId),
    topOf = (id: string): string => {
      const c = categories.find((c) => c.id === id)!;
      return c.parentId ? topOf(c.parentId) : c.id;
    },
    leafFor = (i: number) =>
      leaves.find((c) => topOf(c.id) === roots[i % roots.length].id)!.id;
  const items: Exclude<FinanceMutation, { type: 'batch' }>[] = [
    {
      type: 'put',
      collection: 'accounts',
      expectedVersion: 0,
      entity: {
        id: 'demo-bank',
        version: 0,
        name: '演示银行卡',
        kind: 'asset',
        openingCents: 800000,
        openingAt: opening,
      },
    },
    {
      type: 'put',
      collection: 'accounts',
      expectedVersion: 0,
      entity: {
        id: 'demo-credit',
        version: 0,
        name: '演示信用账户',
        kind: 'credit',
        openingCents: -100000,
        openingAt: opening,
      },
    },
    {
      type: 'put',
      collection: 'accounts',
      expectedVersion: 0,
      entity: {
        id: 'demo-mealcard',
        version: 0,
        name: '演示饭卡',
        kind: 'asset',
        openingCents: 50000,
        openingAt: opening,
      },
    },
    {
      type: 'put',
      collection: 'activities',
      expectedVersion: 0,
      entity: {
        id: 'demo-event',
        version: 0,
        name: '九月活动 · 演示',
        kind: 'event',
        date: month + '-15',
      },
    },
    {
      type: 'put',
      collection: 'activities',
      expectedVersion: 0,
      entity: {
        id: 'demo-funds',
        version: 0,
        name: '集体活动代管 · 演示',
        kind: 'custody',
        date: month + '-01',
      },
    },
  ];
  const tx = (
    id: string,
    kind: FinanceTransaction['kind'],
    cents: number,
    day: number,
  ): FinanceTransaction => ({
    id,
    version: 0,
    kind,
    accountId: 'demo-bank',
    amountCents: cents,
    occurredAt: month + '-' + String(day).padStart(2, '0') + 'T12:00:00+08:00',
    allocations: [],
    note: '仅供交互验收的合成账例',
  });
  const push = (t: FinanceTransaction) =>
    items.push({ type: 'saveTransaction', transaction: t, expectedVersion: 0 });
  push({
    ...tx('demo-income', 'income', 250000, 1),
    counterparty: '合成资助收入',
  });
  for (let d = 1; d <= limit; d++) {
    const mealKinds = ['breakfast', 'lunch', 'dinner'] as const;
    for (let i = 0; i < 3; i++) {
      const p = venues[(d + i) % Math.max(1, venues.length)] || places[0],
        id = 'demo-meal-' + d + '-' + i,
        zero = d % 7 === 0 && i === 2;
      items.push({
        type: 'put',
        collection: 'meals',
        expectedVersion: 0,
        entity: {
          id,
          version: 0,
          date: month + '-' + String(d).padStart(2, '0'),
          meal: mealKinds[i],
          placeId: p.id,
          companions: d % 3 === 0 ? 'classmates' : 'alone',
          payment: zero ? 'invited' : d % 5 === 0 ? 'aa' : 'self',
          pricePending: d === limit && i === 2,
        },
      });
      if (zero || (d === limit && i === 2)) continue;
      const cents = [650, 1450, 1850][i] + (d % 5) * 100;
      push({
        ...tx(id + '-payment', 'expense', cents, d),
        personalCents: cents,
        mealId: id,
        counterparty: p.name,
        allocations: [
          {
            id: id + '-alloc',
            categoryId: leafFor(0),
            content: '餐饮',
            amountCents: cents,
            nature: 'daily',
            merchantId: p.id,
          },
        ],
      });
    }
  }
  for (let i = 1; i < roots.length; i++) {
    const cents = [0, 182000, 28000, 36900, 78000, 12000, 6000][i] || 5000;
    push({
      ...tx('demo-purpose-' + i, 'expense', cents, Math.min(limit, 3 + i * 2)),
      personalCents: cents,
      counterparty:
        [
          '',
          '合成器材商店',
          '合成聚餐商家',
          '合成工具服务',
          '合成出行服务',
          '合成健康服务',
          '合成必要服务',
        ][i] || '合成商家',
      allocations: [
        {
          id: 'demo-purpose-a-' + i,
          categoryId: leafFor(i),
          content:
            ['', '数码器材', '餐饮', '云服务', '交通', '医疗', '服务'][i] ||
            '其他',
          amountCents: cents,
          nature: i === 1 ? 'durable' : i === 3 ? 'subscription' : 'daily',
          activityId: i === 1 ? 'demo-event' : undefined,
        },
      ],
    });
  }
  push({
    ...tx('demo-aa', 'expense', 12000, Math.min(limit, 14)),
    personalCents: 4000,
    counterparty: '合成 AA 聚餐',
    allocations: [
      {
        id: 'demo-aa-a',
        categoryId: leafFor(0),
        content: '餐饮',
        amountCents: 4000,
        nature: 'daily',
      },
    ],
  });
  push({
    ...tx('demo-aa-collect', 'collect', 5000, Math.min(limit, 15)),
    relatedId: 'demo-aa',
    counterparty: '合成回款',
  });
  push({
    ...tx('demo-topup', 'transfer', 30000, 3),
    targetAccountId: 'demo-mealcard',
    counterparty: '演示饭卡充值',
  });
  push({
    ...tx('demo-custody-in', 'custodyReceive', 100000, 2),
    caseId: 'demo-funds',
  });
  push({
    ...tx('demo-custody-out', 'custodyPay', 60000, Math.min(limit, 10)),
    caseId: 'demo-funds',
  });
  items.push({
    type: 'put',
    collection: 'sponsorships',
    expectedVersion: 0,
    entity: {
      id: 'demo-resource',
      version: 0,
      name: '合成直接赞助',
      categoryId: leafFor(Math.min(1, roots.length - 1)),
      amountCents: 160000,
      date: month + '-05',
      note: '合成资源，不代表真实家庭资助',
    },
  });
  for (let n = 0; n < items.length; n += 10)
    await finance.mutate({
      space: 'demo',
      operationId: 'finance-demo-seed-' + n,
      baseVersion: 0,
      mutation: { type: 'batch', mutations: items.slice(n, n + 10) },
    });
}
console.log(
  'Isolated finance preview:',
  String(await mf.ready),
  'state:',
  state,
);
console.log(
  'Local preview only. Demo data and personal ledger remain isolated.',
);
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.on(signal, () => {
    void mf.dispose().finally(() => process.exit(0));
  });
await new Promise(() => {});
