# OMEGA TRADER v10 — Selective autopilot

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

- At least 70 consecutive valid 5-minute candles; only completed candles inform decisions. Stale, missing or inconsistent candles block entries.
- $10M+ daily turnover, spread at most 8 basis points, and funding within ±0.06%.
- Matching 5-minute momentum/trend and completed 15-minute trend, confirmed volume, manageable ATR volatility, and no entry more than 2 ATR from the fast moving average.
- $10 target notional, at most two positions, no duplicate market, no repeated entry on the same market/side/candle. No martingale or averaging down.
- ATR-sized stop, a net profit target of 1.5 times modeled price-stop risk, with estimated execution costs added to the target. Demo positions also use an adaptive profit trail/reversal exit. Stops can close losing trades.

The demo account starts with $10,000 virtual funds. Automation starts paused on every page load; it runs only while the page is visible. The browser uses tab locks and shared-account transactions to prevent competing tabs from opening duplicate entries. Automatic entries need a modern browser with Web Locks (HTTPS or loopback). It pauses entries after three consecutive losses during the current UTC day, and retains the 2% daily equity loss and 0.25% estimated per-trade risk checks. Demo P/L estimates fees plus adverse spread/slippage assumptions; real fills differ.

The results panel shows **observed auto-demo** outcomes, sample size and average net result, from the retained account history (up to 100 recent account trades). It excludes manual trades and legacy records without an auto flag. An early 100% result is not evidence of a dependable strategy. The Research backtests evaluate the existing research model, **not the new autopilot's validated future performance**. No high win rate or profit is promised. These rules have not been validated on live or independent historical exchange data during this change.

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
- Attaches exchange-managed stop-loss and take-profit orders to every entry, so exits do not depend on the browser. Reconciles fills and confirms protective levels; missing protection triggers a recorded reduce-only emergency close attempt. Verify emergency closes at Bybit: acceptance does not prove a fill.
- Uses all-account positions, available margin and realized/unrealized losses for risk checks. Rejects incomplete/paginated snapshots and unmanaged exposure. Bounds modeled stop risk to 0.25% of equity and remaining daily budget, including existing position risk.
- Persists intent **before** submitting each order. Timeouts pause entries; later cycles reconcile that order using its unique broker link. It never blindly retries an uncertain entry or emergency close.
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
