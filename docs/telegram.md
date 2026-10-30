# OMEGA Telegram Demo Controller

The Telegram controller is an optional, DEMO-ONLY interface to a persistent $88 virtual scalper. It does not read real Bybit balances or submit real trades. It uses public USDT-perpetual order books and trades, and records simulated fills in a separate server-side JSON file. A $0.05 net target and $0.08 modeled loss trigger are not guaranteed fills or a validated strategy.

## Where it runs

Telegram Bot API uses long polling in lib/telegram-demo-bot.js. The cloud process must run continuously; Vercel serverless functions alone cannot keep the market stream and long poll alive. A **single** persistent Node.js 24+ instance of scripts/server.js is required (e.g. an explicitly provisioned Render paid service with a mounted /var/data disk). Do not run two instances with the same bot token. No additional npm packages are required.

## Private setup

1. In Telegram, open the official [@BotFather](https://t.me/BotFather), type /newbot, and create a bot. Keep the token private. Do not put it in source control or public chats.
2. In the persistent server's private environment variables set OMEGA_TELEGRAM_BOT_TOKEN to that token. Keep OMEGA_LIVE_ORDERS_ENABLED=false.
3. Start the worker. Open the new bot in a private Telegram chat and send /id for your numeric private chat ID. While the owner ID is unconfigured, this is the only accepted action.
4. Set OMEGA_TELEGRAM_OWNER_CHAT_ID to that numeric ID and restart the worker. Only that private chat can control the DEMO bot.
5. Send /start for the inline menu. /run starts DEMO monitoring; /pause stops it. /status, /balance, /trades and /health show status. When paused, /pairs BTCUSDT,ETHUSDT updates the list (max eight).

The token and owner ID are **not set** in this repository. Until credentials are installed on a persistent worker, Telegram is not connected. Deploying to Vercel does not run a background trader.

## Risk and persistence

- Virtual starting balance $88, one $15 virtual position, +$0.05 estimated net goal and -$0.08 modeled loss trigger, with a $1 daily virtual loss limit.
- No exchange private API, funded orders or live trading activation. A $15 virtual position may be smaller than the real exchange minimum for a contract.
- Fills use public executable VWAP estimates plus simulated fees and slippage, and are not actual broker fills. Fast price movements can exceed stop targets.
- Bybit price data disconnects cause a fresh 60-second warm-up. A position open during feed failure or process restart is marked INCOMPLETE, not claimed as a winning close.
- Telegram offset and wallet are written atomically to OMEGA_WORKER_DATA_DIR/telegram-demo-state.json on the persistent disk. Only one process should own the bot.
- A previously enabled demo can resume scanning after a worker restart. Pausing persists as paused. Hosting may cost money even when idle.

## Tests

Run node --test tests/telegram-demo.test.js or the full suite node --test tests/*.test.js.

The independent funded Bybit worker retains its own stricter live credentials, approvals, account exposure and execution safeguards. Telegram cannot activate or place real-money trades.

## Optional real-money Bybit connection — explicitly confirmed orders only

The Telegram bot supports a separate REAL Bybit account interface. It does NOT automatically trade real funds. Each funded entry requires a fresh preview and a new explicit code confirmation. The demo /run and /pause commands still operate virtual funds only.

Private worker setup:

1. Use a dedicated Bybit Unified Trading Account with sufficient USDT equity. Create a trade-enabled Bybit API key with withdrawal permissions **disabled**. Where practical, restrict access to the worker's fixed outbound IP. Set BYBIT_LIVE_API_KEY and BYBIT_LIVE_API_SECRET in the persistent worker's private environment. Never send credentials via Telegram or GitHub.
2. Configure OMEGA_TELEGRAM_BOT_TOKEN and OMEGA_TELEGRAM_OWNER_CHAT_ID as described above. Do not run more than one bot worker using the same token.
3. Keep OMEGA_TELEGRAM_REAL_ORDERS_ENABLED=false initially. In Telegram run /realstatus, /realbalance, and /realpositions to verify the live account through read-only queries. Those balances are from Bybit, NOT the virtual $88 wallet.
4. After reviewing the live connection and protections, an operator may explicitly set OMEGA_TELEGRAM_REAL_ORDERS_ENABLED=true on the private worker and restart it. This does NOT automatically place an order.
5. To approve an individual funded trade, send /realtrade BUY XRPUSDT or /realtrade SELL XRPUSDT, inspect the price, quantity, estimated costs, exchange TP/SL and risk, and then send /confirmreal CODE within 60 seconds if you intend to trade real funds. Use /realorders to reconcile. An unresolved intent blocks any new order.

Protection rules: intended $15 real notional (maximum $16 after exchange quantity increments), maximum 20% account exposure, minimum $75 account equity to fund that cap, zero other open or pending positions, one intent, one-way USDT perpetuals, real exchange min-notional/quantity validation, 1x leverage, capped entry slippage, attached full-position exchange TP/SL, $1 maximum daily reported loss, and estimated per-trade stop+cost risk <= $0.15 AND <= 0.25% equity. Actual fees, market gaps and stop execution can be worse. Some symbols may disallow $15 orders entirely. The modeled net take-profit goal is $0.05 and no profit is guaranteed.

The existing separate $90 funded web-worker and its $450 equity safeguard remain unchanged. This manually confirmed real-trading route is separately gated. It is not validated to be a profitable seconds-scalping algorithm. Telegram bot chats are not end-to-end encrypted: never share exchange keys, passwords, withdrawal credentials, seed phrases or bot tokens in chat.

A code deployment alone does not create API credentials, turn on funded orders, pay for hosting, or link Telegram. Only the account owner can approve a specific live order after a secure private configuration.
