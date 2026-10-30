'use strict';
// Real-money Bybit positions: at least $90 actual notional, capped at $91 to
// accommodate exchange quantity steps. Demo has a separate $100 policy.
const MIN_LIVE_ORDER_USD=90;
const MAX_LIVE_ORDER_USD=91;
const MIN_LIVE_EQUITY_USD=450; // Enforces 20% maximum account exposure.
const MAX_EXPOSURE_FRACTION=.20;
const AUTO_NET_PROFIT_TARGET_USD=.50;
module.exports={MIN_LIVE_ORDER_USD,MAX_LIVE_ORDER_USD,MIN_LIVE_EQUITY_USD,MAX_EXPOSURE_FRACTION,AUTO_NET_PROFIT_TARGET_USD};
