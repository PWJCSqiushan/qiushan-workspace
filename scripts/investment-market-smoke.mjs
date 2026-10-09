// Run with: NODE_USE_ENV_PROXY=1 node --experimental-transform-types scripts/investment-market-smoke.mjs
// This script is a local public-source smoke check. It never reads account files.

const { fetchInvestmentSnapshot, refreshInvestmentMarket } =
  await import('../lib/investment-market.ts');

const instruments = [
  {
    id: 'etf:SH:513090',
    kind: 'etf',
    exchange: 'SH',
    code: '513090',
    name: '香港证券ETF',
  },
  {
    id: 'etf:SH:588050',
    kind: 'etf',
    exchange: 'SH',
    code: '588050',
    name: '科创板ETF',
  },
  {
    id: 'etf:SZ:159300',
    kind: 'etf',
    exchange: 'SZ',
    code: '159300',
    name: '沪深300ETF',
  },
  {
    id: 'etf:SZ:159937',
    kind: 'etf',
    exchange: 'SZ',
    code: '159937',
    name: '黄金ETF',
  },
  {
    id: 'index:SH:000001',
    kind: 'index',
    exchange: 'SH',
    code: '000001',
    name: '上证指数',
  },
  {
    id: 'stock:SH:600519',
    kind: 'stock',
    exchange: 'SH',
    code: '600519',
    name: '贵州茅台',
  },
  {
    id: 'fund:OF:110022',
    kind: 'fund',
    exchange: 'OF',
    code: '110022',
    name: '易方达消费行业股票',
  },
];

const safeAttempts = (attempts = []) =>
  attempts.map(({ source, role, status, error }) => ({
    source,
    role,
    status,
    ...(error ? { error } : {}),
  }));
const startedAt = new Date().toISOString();
const rows = [];
for (const instrument of instruments) {
  try {
    const snapshot = await fetchInvestmentSnapshot(instrument);
    rows.push({
      instrument_id: instrument.id,
      status: snapshot.status,
      as_of: snapshot.as_of,
      history_as_of: snapshot.history_as_of,
      quote_source: snapshot.quote_source,
      history_source: snapshot.history_source,
      valuation_kind: snapshot.valuation_kind,
      units: snapshot.units,
      source_attempts: safeAttempts(snapshot.source_attempts),
      warnings: snapshot.warnings,
    });
  } catch (error) {
    rows.push({
      instrument_id: instrument.id,
      status: 'exception',
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

let market;
try {
  const snapshot = await refreshInvestmentMarket();
  market = {
    status: snapshot.status,
    date: snapshot.date,
    breadth: snapshot.breadth,
    sentiment: snapshot.sentiment,
    flow: snapshot.flow,
    source_attempts: safeAttempts(snapshot.source_attempts),
    warnings: snapshot.warnings,
  };
} catch (error) {
  market = {
    status: 'exception',
    error: error instanceof Error ? error.message : String(error),
  };
}

console.log(
  JSON.stringify(
    {
      smoke: 'investment-market-public-sources',
      started_at: startedAt,
      completed_at: new Date().toISOString(),
      worker_adapter: 'fetch/Web Crypto/TextDecoder only',
      proxy_env_present: Boolean(
        process.env.NODE_USE_ENV_PROXY ||
        process.env.HTTPS_PROXY ||
        process.env.ALL_PROXY,
      ),
      instruments: rows,
      market,
    },
    null,
    2,
  ),
);
