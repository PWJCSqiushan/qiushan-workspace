# Public investment market adapter sources

`lib/investment-market.ts` is a small, read-only adapter for the investment page. It runs in a Cloudflare Worker and uses only the Worker web platform (`fetch`, Web Crypto, `TextDecoder`, and standard ECMAScript). It carries no login state, account context, cookies, holdings, balances, screenshots, or private runtime data.

## Validated public endpoints

| Role                    | Source label            | Endpoint family                                                                      | Returned fact                                                                                            |
| ----------------------- | ----------------------- | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| Quote primary           | `eastmoney_quote`       | `https://push2.eastmoney.com/api/qt/stock/get`                                       | Eastmoney public quote fields, with source timestamp and explicit unit conversion                        |
| Quote fallback          | `tencent_quote`         | `https://qt.gtimg.cn/q=`                                                             | Tencent public quote text, with source timestamp when present                                            |
| Daily history primary   | `eastmoney_history`     | `https://push2his.eastmoney.com/api/qt/stock/kline/get`                              | Daily OHLCV/amount with `fqt=0` (unadjusted prices)                                                      |
| Daily history fallback  | `tencent_history`       | `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get`                                 | The unadjusted `day` series only; `qfqday` is never read                                                 |
| Stock history fallback  | `sina_history`          | `https://quotes.sina.cn/cn/api/jsonp_v2.php/var%20_data=/CN_MarketData.getKLineData` | Public Sina daily stock history                                                                          |
| OTC fund NAV            | `eastmoney_fund_nav`    | `https://fund.eastmoney.com/pingzhongdata/{six-digit-code}.js`                       | Published `Data_netWorthTrend` unit NAV only; returned as `confirmed_nav`                                |
| ETF identity search     | `eastmoney_etf_list`    | `https://88.push2.eastmoney.com/api/qt/clist/get`                                    | Public ETF directory membership and exchange identity                                                    |
| Optional market breadth | `eastmoney_market_full` | `https://push2.eastmoney.com/api/qt/clist/get`                                       | Breadth is calculated only when the returned row count and unique codes exactly match the declared total |

The endpoint families above are constants. No caller-provided URL is fetched, and cached `source_url` values are never followed. The adapter accepts only six-digit codes and validates `kind`, `exchange`, and the complete `${kind}:${exchange}:${code}` identity.

## Source semantics and limits

- Quote and history provenance are retained separately as `quote_source`, `quote_source_url`, `history_source`, and `history_source_url`. `quote_as_of` and `history_as_of` retain the source dates; `fetched_at` is only the local fetch time.
- `adjustment` is always `none`. The adapter does not use adjusted daily series as an order or valuation price.
- Missing values stay `null`; an absent volume, amount, open, or high/low is never replaced with zero. Daily source volumes are converted from hands to shares/units when the source supplies a number.
- OTC funds do not use a quote endpoint or intraday estimate. Their price comes only from the published Eastmoney NAV series and is marked `valuation_kind: "confirmed_nav"`.
- A timeout or source failure falls back to the previous snapshot as `status: "stale"`, preserving its snapshot identity. With no cache, the result is `status: "missing"` with null fields and source-attempt diagnostics.
- Each instrument collection and market breadth refresh has one shared 11-second budget. The same abort signal covers both the upstream response and body read; once the budget expires, no quote/history fallback request is started.
- Market breadth is null when a complete universe cannot be proven. `flow.northbound` and `flow.main` remain null because the current public interfaces and their measurement definitions were not confirmed. Sentiment fields remain null, and the adapter never emits a synthetic score.
- The `SEEDS` list is copied from the source project's public observation samples. It is not a holdings list and does not contain private account facts. The smoke script exercises four additional public ETFs (`513090`, `588050`, `159300`, `159937`) plus an index, stock, and OTC fund; those identifiers are smoke inputs only and are not holdings or account seeds.

## Upstream and licensing

The parser follows the public field meanings used by the source project's lightweight adapters and by the upstream AKShare implementations. No AKShare source code is bundled or copied into this Worker module.

- AKShare ETF history and public ETF endpoint references: <https://github.com/akfamily/akshare/blob/main/akshare/fund/fund_etf_em.py>
- AKShare public fund NAV endpoint reference: <https://github.com/akfamily/akshare/blob/main/akshare/fund/fund_em.py>
- AKShare stock/Sina history reference: <https://github.com/akfamily/akshare/blob/main/akshare/stock/stock_zh_a_sina.py>
- AKShare license (MIT): <https://github.com/akfamily/akshare/blob/main/LICENSE>

The public providers do not promise an SLA. A successful local fetch is evidence that the source was reachable from that machine at that time; it does not prove that a deployed Worker can reach the same endpoint. `scripts/investment-market-smoke.mjs` reports each instrument's status, source, source-attempt failures, and cache-safe warnings so that deployment verification can distinguish those cases.
