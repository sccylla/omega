# OMEGA TRADER v9 — Adaptive Profit Management

## What changed
- Simplified left navigation: Overview, Demo trader, Find markets, My account, with technical analysis grouped under an expandable Research & tools menu. The mobile navigation displays all four primary destinations.
- Restructured the Overview page around the virtual balance and clear market actions, with the Bitcoin price chart and completed-trade history collapsed by default.
- Split the Demo trader into **Automatic trading** and **Manual trading** tabs, keeping all demo positions below the tabs.
- Added **$10 USD as the minimum virtual position notional**, enforced by the pure browser/Node paper engine, with $10, $25, $50 and $100 manual order presets. Automatic demo notional sizes start at $10 as well.
- Prepared a **$10 notional minimum validation helper** (`lib/trade-limits.js`) for any eventual funded-order system. It has no authority to place orders; real orders remain disabled. Actual instrument limits (including `minNotionalValue`, `minOrderQty`, `qtyStep`) require fetching from Bybit and could be higher than $10.
- Existing positions from dynamically selected futures markets are included when sampling public candles for demo display.

## Safeguards and limitations
- Initial balance is **$10,000 virtual funds**. This is browser-only simulated trading, not a Bybit account balance. Virtual positions, stops, and take profits are monitored only with sampled candles while the browser is active. Funding and withdrawal are not supported.
- $10 is **trade notional**, not a deposit requirement, a guaranteed broker margin requirement, or a guaranteed execution minimum on every trading pair. Automatic trades have no fixed-dollar profit threshold and no timed entry cooldown. They trail profit after an ATR-based favorable move and can close when momentum reverses. Fees are estimated; outcomes are not guaranteed.
- Existing real-account API integration is read-only. **No live order endpoint was added or enabled.** No credentials should be written to any public file.
- The scanner scores are research watchlist signals, not statistically validated win probabilities. No profit guarantee.

## Test and deploy
`node --test tests/*.test.js`

Deploy the static files and Vercel functions to the existing `omega-trader-web` project. Region fra1. Preserve existing environment variable names and values. Do not upload `.env` files, API secrets, or test screenshots.

## Version 9 changes
- Removed the automatic $1 exit and 15-minute cooldown. Manual demo 3% take-profit is unchanged.
- Automatic demo exits now use ATR-based trailing protection after a substantial profitable move, as well as profitable momentum reversal detection; the original stop is preserved.
- One trade per market/side per completed 5-minute bar prevents repeated entries on the same stale signal, not a time cooldown. The existing maximum two positions and 2% simulated daily-loss entry lock remain.
- Closed candles and volume confirmation are required for auto entries. Profitable exits and loss ceilings cannot be guaranteed; the browser must remain open for checks.
