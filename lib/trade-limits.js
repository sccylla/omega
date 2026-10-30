'use strict';
// Shared policy for future funded-order integration. Not connected to any live order path.
const {MIN_LIVE_ORDER_USD}=require('./live-policy');
const MINIMUM_USD_NOTIONAL=MIN_LIVE_ORDER_USD;
function orderMinimum(exchangeMinimumUsd=0){
 const n=Number(exchangeMinimumUsd);
 if(!Number.isFinite(n)||n<0)throw Error('Exchange minimum must be valid');
 return Math.max(MINIMUM_USD_NOTIONAL,n);
}
function validateNotional(usdNotional,exchangeMinimumUsd=0){
 const n=Number(usdNotional),min=orderMinimum(exchangeMinimumUsd);
 if(!Number.isFinite(n)||n<min)throw Error('Order notional must be at least $'+min.toFixed(2));
 return {notionalUsd:n,minimumUsd:min};
}
module.exports={MINIMUM_USD_NOTIONAL,orderMinimum,validateNotional};
