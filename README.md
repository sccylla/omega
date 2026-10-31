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

Automatic entries use the same server-side `lib/advanced-decision.js` engine with explicit policies: `DEMO_FORWARD_TEST` for virtual entries and `LIVE_STRICT` for real execution. All current market, source freshness, execution-cost, exchange-sizing and account-risk checks apply in both. Historical holdout results are advisory only in demo, allowing current setups to be forward-tested without waiting for twenty completed historical trades. A failed or insufficient historical sample is still reported honestly, never relabeled as passed. Real execution retains the required historical gate, and the worker rejects demo-policy plans. The older two-timeframe helper is retained for arithmetic/legacy tests, not as an automatic-entry fallback. There is no language-model “maximum intelligence” setting: decisions are explicit, testable rules over the data actually obtained.

The public collector reads Bybit market data only:

| Evidence | Use |
| --- | --- |
| 5m, 15m, 1h and 4h OHLCV | Trend agreement, RSI/MACD momentum, ADX regime, ATR volatility, volume and VWAP |
| Order book, ticker and quantity/price filters | Spread, budget-specific execution depth/impact ($100 demo, $10 live), exchange minimums and coherent prices |
| Open-interest history | Participation and excessive expansion/unwinding checks |
| Funding history and next funding time | Crowding and imminent funding-cost checks |
| Bitcoin candles | Broad-market shocks, opposing moves and correlated exposure |
| Earlier price history | Direction-specific, chronological, next-open, non-overlapping historical sanity check |

A complete snapshot requires ten evidence streams (BTC reuses its own candles as benchmark), fresh response timestamps, contiguous valid candles and an active USDT perpetual. Failed, stale or inconsistent sources produce **WAIT**. Missing data is never fabricated and there is no fallback to candle-only automatic entries.

The price-only historical check uses the later 40% of the fetched 5m history, as-of completed higher timeframes, at least 20 trades in the proposed direction, conservative stop-first handling when a bar touches both levels, and positive cost-adjusted expectancy/profit factor. It stresses costs at the greater of 26 basis points round trip or the current modeled round-trip execution costs. Current order books, open interest and funding history are **not injected into historical decisions**. This short, fixed-rule sanity check is not a complete backtest of execution, a calibrated probability, independent validation across market regimes, or a guarantee. Insufficient samples block live entry. Demo mode reports this as historical context without vetoing a current qualifying virtual setup.

The Trade action screens the full available Bybit USDT-perpetual ticker/instrument snapshot for liquidity/spread immediately. Demo detailed analysis runs in passes of up to 30 seconds with bounded concurrency, resuming after the last attempted pair on the next pass. Each analysis slot takes its next pair independently, so a stalled request does not block another slot. Once an available qualifying candidate appears, a 1.2-second comparison window collects other completed candidates, then selects and refreshes the highest-ranked one immediately instead of waiting for the pass deadline. Scan-only mode retains the full bounded analysis pass and never enters. The best qualifying pair actually analyzed in the current pass is refreshed with `fresh=1` before entry, bypassing the completed collector cache. A direction change during refresh rejects that candidate in demo and live mode. The executable book price must remain within 0.75 ATR of the signal and 1.8 ATR of its fast trend, preventing a valid old candle from authorizing a chased current fill. These are consistency checks, not evidence of a higher future win rate. Unexamined or timed-out pairs are never treated as qualified. This is a ranking of available evidence, not a claim that every pair was deeply analyzed before an order. Initial market-list loading has a 12-second timeout, individual detailed requests have a 25-second timeout, and the complete demo attempt (including monitoring, loading, refresh and account locking) has a 60-second deadline. Underlying requests are aborted on stop, account changes or a hidden tab; late responses cannot create entries. The last completed result remains visible during subsequent passes, alongside separate screened/analyzed/remaining progress. The persistent live worker retains its full detailed-universe scan before entry. Rankings are not a simultaneous snapshot or a profit prediction. It does not ingest every trade, every exchange, historical order books, news, macro calendars, off-exchange liquidity, on-chain data or unknown future events. An “all market data” or “no losses” claim would be false.

Positions have no automatic holding-time limit in demo or live mode, including previously saved positions with legacy timer metadata. Profit targets and protective stop-loss exits remain active. The historical price check also waits for a target or stop; an unresolved position at the end of available history is reported separately, marked for unrealized P/L and blocks live entry eligibility rather than being counted as a win or forcibly closed at the sample boundary. In demo this remains an advisory warning; it may produce fewer eligible live setups with limited history. Positions can remain open indefinitely, and longer holds can accumulate funding charges; removing the timer does not guarantee a profitable exit. Historical costs reserve another 2 basis points per additional funding interval held, as a stress assumption rather than known historical funding. Legacy demo positions retain their former adaptive exits. Demo entries use the inspected executable book price, and exits require fresh bid/ask liquidation quotes rather than a stale candle close.

Demo entries use a $100 notional with a $100 minimum and one position at a time; they do not exceed available virtual equity. Automatic demo positions close at the greater of $5 net or their volatility-based net target after simulated entry/exit fees and adverse slippage, retaining their protective stop. Existing v7 positions that used the one-cent exit are upgraded in place without resetting balances, history, IDs or stops. A larger target can require a much longer hold and is not a forecast or guaranteed result. Profit monitoring runs every two seconds while the page is visible; closing a position immediately starts a new qualifying-entry scan without a cooldown. The next position uses $100 again, with accumulated profits retained in the account. If a loss reduces flat-account equity below $100, the bot shows BALANCE TOO LOW rather than borrowing or faking a smaller entry. The persistent live worker keeps its separate $10 budget, two-position cap and exchange-managed target/stop policy. Both modes avoid duplicate open markets, averaging down and martingale. Modeled costs include fees, observed spread/impact, slippage allowance and adverse funding; fills may be worse. Concentration checks compare signed Bitcoin exposure (trade direction × measured correlation), including inverse correlations; a second position is blocked if held or new correlation is unknown. Decisions expire after 10 seconds; live orders recheck current quotes, account risk and expiry before submission.

There is no post-trade cooldown, same-candle re-entry ban or three-loss waiting period. Trade starts demo universe screening and a bounded entry-analysis pass immediately; repeating Trade during an active pass reports progress instead of submitting a duplicate job. Normal monitoring polls run every 15 seconds, and demo position updates can trigger a new scan immediately. A completed scan may still find no qualifying pair; risk limits and unavailable/stale data always block unsafe entries. In real mode, Trade requests a scan only after the worker has been explicitly activated; it never bypasses live activation.

Use **Analyze only** to inspect a supported market without opening an order. **Scan without trading** screens the full supported universe and runs a bounded detailed-analysis pass without creating an entry. The evidence panel shows every passed/failed gate, source time, cost estimate and historical sample. The live worker exposes its latest entry decisions in its authenticated journal. Completed scans report failed required checks and unavailable feeds; demo historical advisories and cheap liquidity rejections do not obscure the actual entry blockers. The inspector prioritizes deeply analyzed markets over cheap screening rejections; qualifying setups excluded by held positions or concentration are identified separately. Demo status distinguishes scanning, no entry, scan only and an opened trade rather than displaying SCANNING throughout an armed session.

The demo account starts with $100 virtual funds. Storage key `omega_trader_v7_browser_paper_account` applies this requested reset once when this version is first loaded; the previous v6 ledger remains archived under its old key. Guest results survive reloads in the local ledger; signed-in results are stored in the shared owner ledger described below. Reset demo balance resets the current account to $100, including all signed-in devices when using cloud sync. Automation starts paused on every page load and runs only while the page is visible. Browser tab locks serialize device-local writes; shared cloud updates additionally require an atomic database revision comparison, which prevents competing devices from overwriting accepted trades. Demo entries use a 100% equity notional cap, one position maximum, a 2% estimated per-trade stop-risk ceiling (including two simulated fees), and a 2% daily equity-loss check. These replace the former 20% notional / 0.25% stop-risk limits, which could not fund a $100 entry from $100. Slippage, gaps and sampled quotes can exceed modeled loss estimates. The historical price-only advisory still uses its research target/stop exits; it does not validate the $5-minimum demo profit policy. Funding charges, discontinuous quote sampling and actual exchange fills are not fully reproduced. The results panel reports actual closed simulated auto trades and sample size, excluding manual/legacy records without an auto flag. Research-page model backtests remain separate from this engine's limited price-only check.

Losses remain possible. More indicators and stricter checks do not establish a higher win rate or positive future returns. Verification for this upgrade uses deterministic fixtures and a simulated broker; real market feeds are still blocked by this cloud environment's network policy, and no real account was activated or traded.

## Shared demo account across signed-in devices

Connect the existing Upstash Redis integration to this Vercel project and redeploy with production server variables `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` or `KV_REST_API_URL` / `KV_REST_API_TOKEN`. Never put these values in static files or chat. The token needs read/write and EVAL access; a read-only token cannot save trades. Optional `OMEGA_PAPER_ACCOUNT_ID` chooses a separate ledger namespace (default `owner`). All devices authenticated with this deployment’s existing owner dashboard password share that one account; this is not a multi-user registration system.

Authenticated `GET /api/paper` reads the ledger. Same-origin authenticated POST saves a validated simulated account only if its expected revision still matches. Upstash runs this comparison and update atomically in Redis Lua, across Vercel instances. A stale device gets HTTP 409 plus the latest ledger, without silently retrying an entry or overwriting another device. Private responses are never cached. This is a browser-calculated simulated ledger, not an exchange account or independently verified broker P/L.

The first signed-in device imports its existing v7 demo if the shared ledger does not exist. Thereafter the cloud account wins over stale device copies. If a different device initialized a blank shared ledger first, **Import this device’s previous demo** can import local activity only while the shared account is still empty. It cannot replace an active account. Resetting the shared account does not automatically resurrect archived local trades.

A **Synced account** banner confirms a working connection. Shared views poll every five seconds while visible, and refresh on returning to the tab. Signing out returns to the separate device-only demo. Cloud errors block shared mutations rather than forking an unsynced account; reconnect to resume. Guest demo remains device-local. At least one visible, connected browser must remain open for demo exits, and automatic entries must be explicitly started on the controlling device; visibility on another device does not imply unattended server automation.

The persistent Node server can instead store the shared ledger as private `paper-account.json` in its locked, durable worker data directory. A Vercel frontend can use its existing HTTPS `OMEGA_WORKER_URL` and bearer `OMEGA_WORKER_TOKEN` via `/worker/paper` if Redis is not configured. No Vercel `/tmp` file or process-memory map is used as fake durable cloud storage. Prefer the existing Upstash integration for a Vercel-only deployment.

Verification covers Redis command/authentication and atomic revision behavior, authenticated API access, process restart persistence, and two independent browser sessions sharing an imported position, $5 profit close, replacement entry, stale-write rejection and outage recovery. The deployed Upstash credentials and Vercel deployment completion cannot be verified from this restricted development environment.

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

## Render persistent worker deployment preparation

`render.yaml` describes a **single-instance, paid Render Starter** worker with a 1 GB persistent disk and a public HTTPS control endpoint protected by `OMEGA_WORKER_TOKEN`. This file **does not create a service by itself** and does not turn on real orders. Inspect Render costs before deploying.

1. In Render, choose **New → Blueprint** and select `sccylla/omega` and `render.yaml`. Create only one OMEGA worker service. Never reuse the site-only or unrelated services.
2. Enter `OMEGA_WORKER_TOKEN` (at least 32 cryptographically random characters), Bybit trade-enabled **dedicated account** credentials, and the dashboard/session secrets in Render's protected environment UI. Do not place these values in Git, client scripts, messages or screenshots. Keep withdrawals disabled on the Bybit key.
3. Confirm `GET /healthz` responds. It indicates **liveness only**, not broker authorization, order readiness or profitability. The worker starts paused with `OMEGA_LIVE_ORDERS_ENABLED=false`.
4. In Vercel `omega-trader-web` Production environment variables, add `OMEGA_WORKER_URL` as the deployed HTTPS Render origin and `OMEGA_WORKER_TOKEN` matching the exact private token on Render. Redeploy the frontend.
5. Check the **Real Account → Check live setup** screen and live broker balance. With the dedicated account funded and its positions/pending orders reviewed, verify exchange-side protection, worker state persistence and risk tests against a non-funded/demo environment first. Only after successful verification change `OMEGA_LIVE_ORDERS_ENABLED=true` on the worker host, restart/deploy that service, and then explicitly activate within the authenticated dashboard by entering the existing confirmation phrase. A new worker **never arms itself automatically**.
6. Never operate two workers against one brokerage account or remove the mounted durable state directory; do not redeploy a second worker to circumvent the exclusive lock. Start with no open positions or pending orders in a dedicated account and observe live fills and protective orders through Bybit itself.

Render's Starter service and disk may incur charges. The `autoDeployTrigger: off` setting prevents a subsequent push to GitHub from unexpectedly restarting the armed worker. For maintenance or incident response, pause new entries in the OMEGA dashboard, inspect account risk and Bybit positions, and handle in-flight orders explicitly. Do not treat Vercel or Render as guaranteed zero-outage execution.


## Website-first $88 small-capital trading

OMEGA TRADER is controlled from its website. The $88 / $15 seconds-scalping demo remains separate from the legacy $100 practice wallet. The Real Account dashboard also has an optional manually confirmed $15 USDT-perpetual preview/entry workflow. No Telegram bots, account tokens, or continuous paid Telegram hosting are required. Bybit live API keys, dashboard authentication, current account/market checks, exchange TP/SL and a separately disabled-by-default trade switch are required to place any real order. This is not verified profitable automated scalping.
