import test from 'node:test';
import assert from 'node:assert/strict';
import {
  fetchInvestmentSnapshot,
  investmentSeeds,
  refreshInvestmentMarket,
  searchInvestmentInstruments,
  type Instrument,
  type Snapshot,
} from '../lib/investment-market.ts';

const day = () =>
  new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
const dayStamp = () => day().replace(/-/g, '') + '150000';
const instrument = (
  kind: Instrument['kind'],
  exchange: Instrument['exchange'],
  code: string,
  name = '测试品种',
): Instrument => ({
  id: `${kind}:${exchange}:${code}`,
  kind,
  exchange,
  code,
  name,
});

const response = (body: string, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => body,
});

async function withFetch(
  handler: (
    url: string,
  ) => Promise<ReturnType<typeof response>> | ReturnType<typeof response>,
  action: () => Promise<void>,
) {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    return handler(url);
  }) as typeof fetch;
  try {
    await action();
  } finally {
    globalThis.fetch = original;
  }
}

function eastmoneyQuote(code: string, f43 = '12345') {
  return JSON.stringify({
    data: {
      f57: code,
      f58: '测试品种',
      f59: 2,
      f43,
      f44: '12400',
      f45: '12200',
      f46: '12300',
      f47: '',
      f48: '',
      f60: '12000',
      f124: dayStamp(),
      f170: '125',
    },
  });
}

function eastmoneyHistory(date = day()) {
  return JSON.stringify({
    data: { klines: [`${date},12.1,12.3,12.4,12.0,,`] },
  });
}

void test('snapshot preserves nulls, source dates, units and unadjusted history', async () => {
  let snapshot: Snapshot | undefined;
  await withFetch(
    async (url) => {
      if (url.includes('stock/get')) return response(eastmoneyQuote('510300'));
      if (url.includes('kline/get')) return response(eastmoneyHistory());
      throw new Error(`unexpected URL ${url}`);
    },
    async () => {
      snapshot = await fetchInvestmentSnapshot(
        instrument('etf', 'SH', '510300'),
      );
    },
  );
  assert.ok(snapshot);
  assert.equal(snapshot.status, 'fresh');
  assert.equal(snapshot.quote.volume, null);
  assert.equal(snapshot.quote.amount, null);
  assert.equal(snapshot.history[0]?.volume, null);
  assert.equal(snapshot.history[0]?.amount, null);
  assert.deepEqual(snapshot.units, {
    price: '元/份',
    volume: '份',
    amount: '元',
  });
  assert.equal(snapshot.adjustment, 'none');
  assert.equal(snapshot.quote_source, 'eastmoney_quote');
  assert.equal(snapshot.history_source, 'eastmoney_history');
  assert.equal(snapshot.history_as_of, day());
  assert.equal(snapshot.quote_as_of?.slice(0, 10), day());
});

void test('history falls back from Eastmoney to Tencent and keeps the source trail', async () => {
  let snapshot: Snapshot | undefined;
  await withFetch(
    async (url) => {
      if (url.includes('stock/get')) return response(eastmoneyQuote('159915'));
      if (url.includes('fqkline/get'))
        return response(
          JSON.stringify({
            data: {
              sz159915: {
                day: [[day(), '1.00', '1.02', '1.03', '0.99', '12', '34']],
              },
            },
          }),
        );
      if (url.includes('kline/get')) return response('down', 503);
      throw new Error(`unexpected URL ${url}`);
    },
    async () => {
      snapshot = await fetchInvestmentSnapshot(
        instrument('etf', 'SZ', '159915'),
      );
    },
  );
  assert.ok(snapshot);
  assert.equal(snapshot.status, 'fresh');
  assert.equal(snapshot.history_source, 'tencent_history');
  assert.equal(snapshot.history[0]?.volume, 1200);
  assert.equal(snapshot.history[0]?.amount, 34);
  assert.equal(snapshot.adjustment, 'none');
  assert.deepEqual(
    snapshot.source_attempts.map((item) => [item.source, item.status]),
    [
      ['eastmoney_quote', 'ok'],
      ['eastmoney_history', 'error'],
      ['tencent_history', 'ok'],
    ],
  );
});

void test('all upstream failures return a stale cached snapshot without filling nulls', async () => {
  const previous: Snapshot = {
    snapshot_id: 'etf:SH:510300@cached',
    instrument_id: 'etf:SH:510300',
    source: 'eastmoney_history',
    source_url:
      'https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=1.510300',
    quote_source: 'eastmoney_quote',
    quote_source_url:
      'https://push2.eastmoney.com/api/qt/stock/get?secid=1.510300',
    history_source: 'eastmoney_history',
    history_source_url:
      'https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=1.510300',
    quote_as_of: '2026-10-08T15:00:00+08:00',
    as_of: '2026-10-08',
    fetched_at: '2026-10-08T08:00:00.000Z',
    status: 'fresh',
    error: null,
    quote: {
      price: 4.2,
      change_pct: null,
      open: null,
      high: null,
      low: null,
      preclose: null,
      volume: null,
      amount: null,
    },
    history: [
      {
        date: '2026-10-08',
        open: null,
        high: null,
        low: null,
        close: 4.2,
        volume: null,
        amount: null,
      },
    ],
    history_as_of: '2026-10-08',
    history_status: 'fresh',
    units: { price: '元/份', volume: '份', amount: '元' },
    adjustment: 'none',
    valuation_kind: 'market_price',
    metrics: {
      ma20: null,
      ma60: null,
      return_20d: null,
      range_120d: null,
      history_count: 1,
    },
    fundamentals: [],
    evidence: [],
    warnings: [],
    source_attempts: [],
  };
  let snapshot: Snapshot | undefined;
  await withFetch(
    async () => {
      throw new Error('offline');
    },
    async () => {
      snapshot = await fetchInvestmentSnapshot(
        instrument('etf', 'SH', '510300'),
        previous,
      );
    },
  );
  assert.ok(snapshot);
  assert.equal(snapshot.status, 'stale');
  assert.equal(snapshot.snapshot_id, previous.snapshot_id);
  assert.equal(snapshot.quote.price, 4.2);
  assert.equal(snapshot.quote.volume, null);
  assert.match(snapshot.error ?? '', /获取失败/);
  assert.ok(snapshot.source_attempts.some((item) => item.status === 'error'));
});

void test('funds use only the published Eastmoney NAV series', async () => {
  const timestamp = Date.parse(`${day()}T00:00:00+08:00`);
  const script = `var fS_code = "110022"; var fS_name = "易方达消费行业股票"; var Data_netWorthTrend = [{"x":${timestamp},"y":1.2345,"equityReturn":0}];`;
  let snapshot: Snapshot | undefined;
  await withFetch(
    async (url) => {
      assert.match(url, /fund\.eastmoney\.com\/pingzhongdata\/110022\.js/);
      return response(script);
    },
    async () => {
      snapshot = await fetchInvestmentSnapshot(
        instrument('fund', 'OF', '110022'),
      );
    },
  );
  assert.ok(snapshot);
  assert.equal(snapshot.status, 'fresh');
  assert.equal(snapshot.valuation_kind, 'confirmed_nav');
  assert.equal(snapshot.history_source, 'eastmoney_fund_nav');
  assert.equal(snapshot.quote.price, 1.2345);
  assert.equal(snapshot.quote.open, null);
  assert.equal(snapshot.quote.change_pct, null);
  assert.equal(snapshot.history[0]?.volume, null);
  assert.deepEqual(snapshot.units, {
    price: '元/份',
    volume: '份',
    amount: '元',
  });
});

void test('incomplete market response leaves breadth, flow and sentiment empty', async () => {
  let market: Awaited<ReturnType<typeof refreshInvestmentMarket>> | undefined;
  await withFetch(
    async (url) => {
      assert.match(url, /push2\.eastmoney\.com\/api\/qt\/clist\/get/);
      return response(
        JSON.stringify({
          data: {
            total: 2,
            diff: [{ f12: '000001', f3: '1.2', f6: '10', f297: day() }],
          },
        }),
      );
    },
    async () => {
      market = await refreshInvestmentMarket();
    },
  );
  assert.equal(market?.status, 'missing');
  assert.deepEqual(market?.breadth, {
    up: null,
    down: null,
    flat: null,
    total: null,
    amount: null,
  });
  assert.equal(market?.flow.northbound, null);
  assert.equal(market?.flow.main, null);
  assert.equal(market?.sentiment.limit_up, null);
  assert.equal('score' in (market ?? {}), false);
  assert.ok(market?.warnings.some((item) => item.includes('不完整')));
});

void test('search preserves full identities when one numeric code names several kinds', async () => {
  let results:
    | Awaited<ReturnType<typeof searchInvestmentInstruments>>
    | undefined;
  await withFetch(
    async (url) => {
      if (url.includes('88.push2.eastmoney.com'))
        return response(JSON.stringify({ data: { total: 0, diff: [] } }));
      if (url.includes('stock/get'))
        return response(
          JSON.stringify({ data: { f57: '000001', f58: '平安银行' } }),
        );
      if (url.includes('pingzhongdata/000001.js'))
        return response(
          'var fS_code = "000001"; var fS_name = "华夏成长混合";',
        );
      throw new Error(`unexpected URL ${url}`);
    },
    async () => {
      results = await searchInvestmentInstruments('000001');
    },
  );
  const ids = results?.map((item) => item.id) ?? [];
  assert.ok(ids.includes('index:SH:000001'));
  assert.ok(ids.includes('stock:SZ:000001'));
  assert.ok(ids.includes('fund:OF:000001'));
  assert.equal(new Set(ids).size, ids.length);
});

void test('seeds are public observations and remain independently typed', () => {
  const seeds = investmentSeeds();
  assert.deepEqual(
    seeds.filter((item) => item.kind === 'etf').map((item) => item.id),
    ['etf:SH:510300', 'etf:SH:510500', 'etf:SZ:159915'],
  );
  assert.equal(
    seeds.some((item) => item.id === 'fund:OF:000001'),
    true,
  );
  assert.equal(
    seeds.every(
      (item) => item.id === `${item.kind}:${item.exchange}:${item.code}`,
    ),
    true,
  );
});
