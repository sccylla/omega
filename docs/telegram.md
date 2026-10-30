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
