'use strict';
// Every new REAL Bybit position is separately funded and protected. Capacity
// is up to ten only when portfolio-wide exposure and stop budgets allow it.
const MAX_POSITIONS=10,PER_ORDER_USD=100,MAX_ORDER_USD=102;
const MAX_TOTAL_EXPOSURE=.20,MAX_PORTFOLIO_STOP_USD=1,MAX_TRADE_STOP_USD=.75;
const COST_RATE=.0022,MAX_DAILY_LOSS_USD=1;
const failure=m=>{throw Error(m)};
const finite=n=>typeof n==='number'&&Number.isFinite(n);
function validate(snapshot,{symbol=null,ticket=null}={}){
 if(!snapshot||!finite(snapshot.equity)||snapshot.equity<=0||
  !finite(snapshot.available)||snapshot.available<0||!finite(snapshot.pnlToday)||
  !Array.isArray(snapshot.positions)||!Array.isArray(snapshot.pending))
  failure('Incomplete live exchange balance or positions; new entries disabled');
 if(snapshot.pending.length)failure('Pending exchange entry detected. Reconcile before opening another real trade.');
 if(snapshot.positions.length>=MAX_POSITIONS)failure('Real portfolio already has 10 positions. Wait for an exchange-managed exit.');
 if(snapshot.pnlToday<=-MAX_DAILY_LOSS_USD)failure('Real daily closed/unrealized loss threshold reached.');
 let notional=0,stopRisk=0;
 const seen=new Set();
 for(const p of snapshot.positions){
  const size=Number(p.size),mark=Number(p.markPrice),entry=Number(p.avgPrice),
   stop=Number(p.stopLoss),tp=Number(p.takeProfit);
  if(!/^[A-Z0-9]{2,24}USDT$/.test(p.symbol)||!['Buy','Sell'].includes(p.side)||
   seen.has(p.symbol)||!Number.isFinite(size)||size<=0||!Number.isFinite(mark)||mark<=0||
   !Number.isFinite(entry)||entry<=0||!Number.isFinite(stop)||stop<=0||
   !Number.isFinite(tp)||tp<=0||Number(p.positionIdx)!==0)
   failure('An existing Bybit position is incomplete, unprotected or duplicated. No new entries.');
  const direction=p.side==='Buy'?1:-1;
  if(!(direction*(entry-stop)>0&&direction*(tp-entry)>0))
   failure('Existing Bybit position stop/target is not protective. New orders halted.');
  const sizeUsd=Math.max(entry,mark)*size;
  if(!Number.isFinite(sizeUsd))failure('Invalid open position notional');
  seen.add(p.symbol);notional+=sizeUsd;
  stopRisk+=Math.abs(entry-stop)*size+COST_RATE*sizeUsd;
 }
 if(symbol&&seen.has(symbol))failure('An existing position already holds '+symbol+'. Wait for its protective exit.');
 if(notional>snapshot.equity*MAX_TOTAL_EXPOSURE+1e-8)
  failure('Existing positions exceed 20% total equity exposure. No new live entries.');
 const availableBudget=Math.min(snapshot.available,snapshot.equity*MAX_TOTAL_EXPOSURE-notional);
 const remainingLoss=Math.min(MAX_PORTFOLIO_STOP_USD,Math.max(0,MAX_DAILY_LOSS_USD+Math.min(0,snapshot.pnlToday)));
 if(stopRisk>remainingLoss+1e-8)failure('Existing positions consume the remaining $1 modeled loss budget.');
 if(!ticket){
  if(availableBudget+1e-8<PER_ORDER_USD)
   failure('Insufficient remaining total exposure or available margin for another $100 funded position.');
  return {count:snapshot.positions.length,remainingSlots:MAX_POSITIONS-snapshot.positions.length,
   notional,stopRisk,availableBudget,remainingLoss,
   capacity:Math.max(0,Math.min(MAX_POSITIONS-snapshot.positions.length,Math.floor((availableBudget+1e-8)/PER_ORDER_USD)))};
 }
 const n=ticket.notional,qty=Number(ticket.qty),entry=ticket.price,
  stop=Number(ticket.stopLoss),tp=Number(ticket.takeProfit);
 if(!finite(n)||n<PER_ORDER_USD-1e-8||n>MAX_ORDER_USD+1e-8||!finite(entry)||entry<=0||
  !Number.isFinite(qty)||qty<=0||!Number.isFinite(stop)||stop<=0||!Number.isFinite(tp)||tp<=0||
  !finite(ticket.estimatedTakeProfitNetUsd)||ticket.estimatedTakeProfitNetUsd<.05-1e-8)
  failure('Bybit ticket does not meet $100–$102 funding, TP/SL and estimated net target rules.');
 const direction=ticket.side==='Buy'?1:-1;
 if(!['Buy','Sell'].includes(ticket.side)||!(direction*(entry-stop)>0&&direction*(tp-entry)>0))
  failure('Bybit ticket has incorrect protective stop/target direction.');
 if(n>availableBudget+1e-8)failure('Portfolio exposure cap or available balance does not allow this $100 live trade.');
 const rate=Math.max(COST_RATE,Number(ticket.estimatedRoundTripCostRate)||0);
 const newRisk=Math.abs(entry-stop)*qty+n*rate;
 if(!Number.isFinite(newRisk)||newRisk<=0||newRisk>MAX_TRADE_STOP_USD+1e-8||
  newRisk>snapshot.equity*.0025+1e-8||stopRisk+newRisk>remainingLoss+1e-8)
  failure('Trade or portfolio estimated stop+fee risk would exceed the daily risk cap.');
 return {count:snapshot.positions.length,remainingSlots:MAX_POSITIONS-snapshot.positions.length-1,
  notional:notional+n,stopRisk:stopRisk+newRisk,availableBudget:availableBudget-n,
  estimatedStopRiskUsd:newRisk,capacity:Math.max(0,Math.floor((availableBudget-n)/PER_ORDER_USD))};
}
module.exports={validate,MAX_POSITIONS,PER_ORDER_USD,MAX_TOTAL_EXPOSURE};
