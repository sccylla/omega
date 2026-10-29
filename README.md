# OMEGA TRADER v11 — Evidence-driven autopilot

A compact trading desk with browser demo trading and separately activated **Bybit USDT perpetual live automation**. The Demo / Real account switch is always visible. Switching accounts pauses new demo entries; switching the view does not activate or stop the server-side live worker.

## Run and test

Node.js 24+; no npm dependencies or compilation required.

```sh
node --use-env-proxy --use-system-ca scripts/server.js
```

The server defaults to loopback port 3000. `PORT` (or `OMEGA_DEV_PORT`) selects the port; `OMEGA_BIND_HOST` controls binding. Authenticated account operations require **HTTPS**, supplied by a reverse proxy in production. Public pages and demo trading work over local HTTP. Keep configured proxy settings and TLS verification enabled.

```sh
set -e
for test_file in tests/*.test.js; do node "$test_file"; done
```

The existing README command `node --test tests/*.test.js` is also supported. Per-file runs expose individual assertions in the cloud runtime. New strategy and worker tests use deterministic candles and a simulated broker; **they place no real orders**.

## What the bot checks

Automatic entries now use the same server-side `lib/advanced-decision.js` engine in browser demo mode and the persistent live worker. The older two-timeframe helper is retained for arithmetic/legacy tests, not as an automatic-entry fallback. There is no language-model “maximum intelligence” setting: decisions are explicit, testable rules over the data actually obtained.

The public collector reads Bybit market data only:

| Evidence | Use |
| --- | --- |
| 5m, 15m, 1h and 4h OHLCV | Trend agreement, RSI/MACD momentum, ADX regime, ATR volatility, volume and VWAP |
| Order book, ticker and quantity/price filters | Spread, $10 execution depth/impact, exchange minimums and coherent prices |
| Open-interest history | Participation and excessive expansion/unwinding checks |
| Funding history and next funding time | Crowding and imminent funding-cost checks |
| Bitcoin candles | Broad-market shocks, opposing moves and correlated exposure |
| Earlier price history | Direction-specific, chronological, next-open, non-overlapping historical sanity check |

A complete snapshot requires ten evidence streams (BTC reuses its own candles as benchmark), fresh response timestamps, contiguous valid candles and an active USDT perpetual. Failed, stale or inconsistent sources produce **WAIT**. Missing data is never fabricated and there is no fallback to candle-only automatic entries.

The price-only historical check uses the later 40% of the fetched 5m history, as-of completed higher timeframes, at least 20 trades in the proposed direction, conservative stop-first handling when a bar touches both levels, and positive cost-adjusted expectancy/profit factor. It stresses costs at the greater of 26 basis points round trip or the current modeled round-trip execution costs. Current order books, open interest and funding history are **not injected into historical decisions**. This short, fixed-rule sanity check is not a complete backtest of execution, a calibrated probability, independent validation across market regimes, or a guarantee. Insufficient samples block entry.

The Trade action screens the full available Bybit USDT-perpetual ticker/instrument snapshot. Every pair is either rejected by liquidity/spread checks or deeply analyzed; qualified results are ranked across the complete scan, and the highest-ranked available pair is refreshed before entry. Analysis runs with bounded concurrency rather than a shortlist cap. Progress shows total/screened/analyzed counts. Large scans take time and may span multiple price changes; the ranking is not a simultaneous snapshot or a profit prediction. It does not ingest every trade, every exchange, historical order books, news, macro calendars, off-exchange liquidity, on-chain data or unknown future events. An “all market data” or “no losses” claim would be false.

Positions have no automatic holding-time limit in demo or live mode, including previously saved positions with legacy timer metadata. Profit targets and protective stop-loss exits remain active. The historical price check also waits for a target or stop; an unresolved position at the end of available history is reported separately, marked for unrealized P/L and blocks entry eligibility rather than being counted as a win or forcibly closed at the sample boundary. This may produce fewer eligible setups with limited history. Positions can remain open indefinitely, and longer holds can accumulate funding charges; removing the timer does not guarantee a profitable exit. Historical costs reserve another 2 basis points per additional funding interval held, as a stress assumption rather than known historical funding. Legacy demo positions retain their former adaptive exits. Demo entries use the inspected executable book price, and exits require fresh bid/ask liquidation quotes rather than a stale candle close.

Entry plans keep a $10 target notional, at most two positions, no duplicate market or repeated market/side/candle entry, no averaging down or martingale, ATR-sized stops and automatic net-profit exits. Modeled costs include fees, observed spread/impact, slippage allowance and adverse funding; fills may be worse. Concentration checks compare signed Bitcoin exposure (trade direction × measured correlation), including inverse correlations; a second position is blocked if held or new correlation is unknown. Decisions expire after 10 seconds; live orders recheck current quotes, account risk and expiry before submission.

There is no post-trade cooldown, same-candle re-entry ban or three-loss waiting period. Trade starts a full demo scan and entry immediately; repeating Trade during an active scan reports progress instead of submitting a duplicate job. Normal monitoring polls run every 15 seconds, and demo position updates can trigger a new scan immediately. A completed scan may still find no qualifying pair; risk limits and unavailable/stale data always block unsafe entries. In real mode, Trade requests a scan only after the worker has been explicitly activated; it never bypasses live activation.

Use **Analyze only** to inspect a supported market without opening an order. **Scan without trading** evaluates the bounded shortlist without creating an entry. The evidence panel shows every passed/failed gate, source time, cost estimate and historical sample. The live worker exposes its latest entry decisions in its authenticated journal.

The demo account starts with $10,000 virtual funds. Automation starts paused on every page load and runs only while the page is visible. Browser tab locks prevent competing account mutations. Demo entries retain the 2% daily equity-loss and 0.25% estimated per-trade stop-risk checks. The results panel reports actual closed simulated auto trades and sample size, excluding manual/legacy records without an auto flag. Research-page model backtests remain separate from this engine's limited price-only check.

Losses remain possible. More indicators and stricter checks do not establish a higher win rate or positive future returns. Verification for this upgrade uses deterministic fixtures and a simulated broker; real market feeds are still blocked by this cloud environment's network policy, and no real account was activated or traded.

## Live worker: deploy and activate explicitly

Live automation requires one continuously running `scripts/server.js` process and a **durable, private** `OMEGA_WORKER_DATA_DIR` (default `.omega-data/`, ignored by Git). Do not serve, delete, reset, commit or lose that directory while orders may exist. It contains order intents, managed positions, daily risk baseline and candle-entry keys, never API keys. The process takes an exclusive lock; run only one worker per account/data directory. After an abnormal exit, confirm the previous worker is stopped and inspect orders at Bybit before removing a stale `worker.lock` and restarting. Never start another worker against the same account to work around a lock.

Configure actual secrets securely on the worker host, never in public files or chat:

| Variable | Purpose |
| --- | --- |
| `OMEGA_DASHBOARD_PASSWORD` | Dashboard login, at least 16 characters |
| `OMEGA_SESSION_SECRET` | Session signing, at least 32 characters |
| `BYBIT_LIVE_API_KEY` | Dedicated Bybit unified account key with required trade access, no withdrawal permission |
| `BYBIT_LIVE_API_SECRET` | Actual signing secret available locally to the worker for HMAC signing |
| `OMEGA_LIVE_ORDERS_ENABLED` | Defaults off; must explicitly be `true` for new live entries |
| `OMEGA_WORKER_DATA_DIR` | Durable private ledger directory |

A proxy placeholder cannot perform local HMAC signing; use secure host environment-secret injection for signing/session secrets. Prefer a dedicated account without manual or other bot activity. Account must use one-way positions and have at least $50 equity and $10 available margin.

Sign in over HTTPS, switch to **Real account**, review the actual broker balance and worker status, set a daily loss budget from $0.10 to $1.00, type `START REAL $10 BOT`, and activate. The live worker remains paused until this succeeds. OANDA live access remains account observation only.

The worker:

- Sets 1x leverage and rounds entry size down to the $10 estimated notional budget using current exchange quantity steps. Skips instruments whose minimums cannot fit. Market fills and actual notional can differ within the exchange's slippage handling.
- Attaches exchange-managed stop-loss and take-profit orders to every entry, so exits do not depend on the browser. Reconciles fills and confirms finite, correctly directed, non-widened protective levels; missing protection triggers a recorded reduce-only emergency close attempt. Verify emergency closes at Bybit: acceptance does not prove a fill.
- Uses all-account positions, available margin and realized/unrealized losses for risk checks. Rejects incomplete/paginated snapshots and unmanaged exposure. Bounds modeled stop risk to 0.25% of equity and remaining daily budget, including existing position risk.
- Fsyncs an atomic, private ledger **before** submitting each order. It reconciles partial fills through a terminal order state and checks protection even when the order lookup fails. Timeouts pause entries; later cycles reconcile that order using its unique broker link. It never blindly retries an uncertain entry or emergency close.
- Disarms on restart, risk/data failures, or the loss budget. Daily entry checks use the smaller of the configured dollar budget and 2% of the day's starting equity; losses may exceed these thresholds during gaps, slippage, service outages or stop failures.
- **Pause new live entries** stops subsequent submissions while preserving broker TP/SL. A request already in flight may still fill. To flatten or cancel orders, use Bybit directly. Pausing or closing this website does not cancel broker positions. Turning off the server switch also blocks new entries; the worker still attempts reconciliation/protection for its recorded positions.

The worker samples every 15 seconds; it may wait indefinitely for a qualifying setup. A page switch is not a kill switch. On errors, inspect the worker journal and Bybit account before reactivation. No live connectivity, credentials, funded orders, deployment or profitable performance were verified by this change.

## Vercel frontend with an external worker

Vercel functions cannot host the continuous worker or its durable ledger. Keep the existing static/API deployment and run `scripts/server.js` on a separate persistent Node host behind HTTPS. Configure:

- On both frontend and worker: matching `OMEGA_WORKER_TOKEN`, at least 32 random characters, stored securely.
- On Vercel: `OMEGA_WORKER_URL` set to the worker's HTTPS origin. The frontend forwards authenticated, same-origin control requests to `/worker/control` with the private bearer token.
- Matching dashboard/session configuration and live account credentials wherever the account-view API runs. The worker needs the signing credentials itself; do not expose them to the browser.

The worker's control endpoint rejects unauthenticated requests. Do not expose its data directory through your reverse proxy. Preserve existing Vercel project `omega-trader-web`, region `fra1`, and existing variable values. Deployment is a separate action; nothing is published automatically.

Public feeds require HTTPS access to `api.bybit.com` (default), with `www.okx.com` and `api.bitget.com` for alternative chart feeds. Optional legacy demo/OANDA connections retain their existing environment variable names and separate order switches.
