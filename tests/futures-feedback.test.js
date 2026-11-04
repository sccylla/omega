'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const Feedback=require('../static/futures-feedback');
const NOW=Date.UTC(2026,10,4,12),MINUTE=60000;
const request={symbol:'BTCUSDT',side:'BUY',now:NOW};
function trade(id,minutesAgo,net=-1,extra={}){
 return {id,symbol:'BTC',side:'BUY',auto:true,entryEvidence:{strategy:'evidence-v11'},
  net,netRaw:net,openedAt:NOW-(minutesAgo+5)*MINUTE,closedAt:NOW-minutesAgo*MINUTE,...extra};
}
test('zero or one completed Futures loss reports insufficient history without a learned edge',()=>{
 for(const records of [[],[trade('one',5)]]){
  const result=Feedback.assess(records,request);
  assert.equal(result.allowed,true);assert.equal(result.sampleCount,records.length);
  assert.equal(result.pauseUntil,0);assert.match(result.reason,/Insufficient.*no learned edge/);
 }
});
test('two recent same-pair and same-direction losses pause only new entries for 30 minutes',()=>{
 const result=Feedback.assess([trade('new',5,-.72),trade('old',15,-.81)],request);
 assert.equal(result.allowed,false);assert.equal(result.sampleCount,2);assert.equal(result.lossStreak,2);
 assert.equal(result.pauseUntil,NOW+25*MINUTE);assert.equal(result.netUsd,-1.53);
});
test('a winning close in that bucket ends the loss streak; unrelated wins do not',()=>{
 const losses=[trade('old',15),trade('new',5)];
 const unrelated=[trade('other-pair',1,2,{symbol:'ETH'}),trade('other-side',1,2,{side:'SELL'})];
 assert.equal(Feedback.assess([...losses,...unrelated],request).allowed,false);
 const winner=Feedback.assess([...losses,trade('win',2,.5)],request);
 assert.equal(winner.allowed,true);assert.equal(winner.lossStreak,0);assert.equal(winner.sampleCount,3);
 const oneNewLoss=Feedback.assess([...losses,trade('win',3,.5),trade('again',1,-.1)],request);
 assert.equal(oneNewLoss.allowed,true);assert.equal(oneNewLoss.lossStreak,1);
});
test('pause expires exactly 30 minutes after the last loss and the outcome window rolls',()=>{
 const losses=[trade('old',20),trade('new',5)];
 assert.equal(Feedback.assess(losses,{...request,now:NOW+25*MINUTE-1}).allowed,false);
 assert.equal(Feedback.assess(losses,{...request,now:NOW+25*MINUTE}).allowed,true);
 const aged=Feedback.assess([trade('outside',66),trade('recent',5)],request);
 assert.equal(aged.allowed,true);assert.equal(aged.sampleCount,1);
});
test('an established pause survives the first triggering loss aging out of the report window',()=>{
 const records=[trade('first',59,-.8),trade('last',1,-.6)];
 const initial=Feedback.assess(records,request);
 assert.equal(initial.allowed,false);assert.equal(initial.sampleCount,2);
 assert.equal(initial.pauseUntil,NOW+29*MINUTE);
 const later=Feedback.assess(records,{...request,now:NOW+2*MINUTE});
 assert.equal(later.allowed,false);assert.equal(later.pauseUntil,initial.pauseUntil);
 assert.equal(later.sampleCount,1);assert.equal(later.netUsd,-.6);
 assert.equal(later.lossStreak,2);
 assert.equal(Feedback.assess(records,{...request,now:initial.pauseUntil-1}).allowed,false);
 assert.equal(Feedback.assess(records,{...request,now:initial.pauseUntil}).allowed,true);
 const won=Feedback.assess([...records,trade('winner',-1,.5)],{...request,now:NOW+2*MINUTE});
 assert.equal(won.allowed,true);assert.equal(won.lossStreak,0);
});
test('manual, scalper, invalid direction and invalid or unfinished records are excluded',()=>{
 const invalid=[trade('manual',1,-1,{auto:false}),
  trade('scalper',1,-1,{entryEvidence:{strategy:'DEMO_INTELLIGENCE_V1'}}),
  trade('case',1,-1,{side:'Buy'}),trade('nan',1,-1,{netRaw:NaN}),
  trade('infinite',1,-1,{netRaw:Infinity}),trade('future',-1),
  trade('unfinished',1,-1,{openedAt:NOW,closedAt:NOW}),trade('string-time',1,-1,{closedAt:String(NOW)}),
  trade('bad-symbol',1,-1,{symbol:'btc'}),trade('no-metadata',1,-1,{entryEvidence:null})];
 const result=Feedback.assess([trade('real',2),...invalid],request);
 assert.equal(result.allowed,true);assert.equal(result.sampleCount,1);assert.equal(result.netUsd,-1);
});
test('three cross-market and cross-direction losses pause all Futures entries; two do not',()=>{
 const rows=[trade('btc',15,-1),trade('eth',10,-.8,{symbol:'ETH',side:'SELL'}),trade('sol',5,-.7,{symbol:'SOL'})];
 const other={symbol:'ADAUSDT',side:'SELL',now:NOW};
 const two=Feedback.assess(rows.slice(0,2),other);
 assert.equal(two.allowed,true);assert.equal(two.accountLossStreak,2);assert.equal(two.accountPauseUntil,0);
 const three=Feedback.assess(rows,other);
 assert.equal(three.allowed,false);assert.equal(three.accountLossStreak,3);
 assert.equal(three.accountPauseUntil,NOW+55*MINUTE);assert.equal(three.pairPauseUntil,0);
 assert.equal(three.pauseUntil,three.accountPauseUntil);assert.match(three.reason,/account-wide/);
 assert.equal(three.sampleCount,0);assert.equal(three.netUsd,0);assert.equal(three.lossStreak,0);
 const pairToo=Feedback.assess([...rows,trade('sol-again',1,-.5,{symbol:'SOL'})],{...other,symbol:'SOLUSDT',side:'BUY'});
 assert.ok(pairToo.pairPauseUntil>NOW);assert.ok(pairToo.accountPauseUntil>pairToo.pairPauseUntil);
 assert.equal(pairToo.pauseUntil,pairToo.accountPauseUntil);
});
test('the account pause retains its full hour when triggering losses age out of the current window',()=>{
 const rows=[trade('first',59,-1),trade('second',30,-1,{symbol:'ETH'}),trade('last',1,-1,{symbol:'SOL',side:'SELL'})];
 const initial=Feedback.assess(rows,request);
 assert.equal(initial.accountPauseUntil,NOW+59*MINUTE);
 const later=Feedback.assess(rows,{...request,now:NOW+2*MINUTE});
 assert.equal(later.allowed,false);assert.equal(later.accountPauseUntil,initial.accountPauseUntil);
 assert.equal(later.accountLossStreak,3);assert.equal(later.sampleCount,0);
 assert.equal(Feedback.assess(rows,{...request,now:initial.pauseUntil-1}).allowed,false);
 assert.equal(Feedback.assess(rows,{...request,now:initial.pauseUntil}).allowed,true);
 const spaced=[trade('outside',66),trade('middle',30,-1,{symbol:'ETH'}),trade('latest',5,-1,{symbol:'SOL'})];
 assert.equal(Feedback.assess(spaced,request).accountPauseUntil,0);
});
test('a genuine Futures winner resets the account streak; scalper/manual and future winners cannot',()=>{
 const rows=[trade('btc',15),trade('eth',10,-1,{symbol:'ETH'}),trade('sol',5,-1,{symbol:'SOL'})];
 const other={...request,symbol:'ADAUSDT'};
 const ignored=[trade('manual-win',1,5,{auto:false}),trade('scalper-win',1,5,{entryEvidence:{strategy:'DEMO_INTELLIGENCE_V1'}}),trade('future-win',-1,5)];
 const stillPaused=Feedback.assess([...rows,...ignored],other);
 assert.equal(stillPaused.allowed,false);assert.equal(stillPaused.accountLossStreak,3);
 const won=Feedback.assess([...rows,trade('genuine-win',1,.5,{symbol:'XRP',side:'SELL'})],other);
 assert.equal(won.allowed,true);assert.equal(won.accountLossStreak,0);assert.equal(won.accountPauseUntil,0);
});
test('filtered duplicate and non-Futures losses cannot manufacture an account-wide streak',()=>{
 const valid=[trade('btc',10),trade('eth',5,-1,{symbol:'ETH'})];
 const invalid=[{...valid[0]},trade('manual-loss',1,-1,{auto:false}),
  trade('scalper-loss',1,-1,{entryEvidence:{strategy:'DEMO_INTELLIGENCE_V1'}}),trade('bad-net',1,-1,{netRaw:NaN})];
 const result=Feedback.assess([...valid,...invalid],{...request,symbol:'ADAUSDT'});
 assert.equal(result.allowed,true);assert.equal(result.accountLossStreak,2);assert.equal(result.accountPauseUntil,0);
});
test('simultaneous mixed wins and losses reset pair/account streaks independent of IDs and input order',()=>{
 for(const winningId of ['a-winner','z-winner']){
  for(const winNet of [.5,0]){
   const rows=[trade('b-loss',1),trade('c-loss',1),trade('d-loss',1),trade(winningId,1,winNet)];
   for(const records of [rows,[...rows].reverse()]){
    const result=Feedback.assess(records,request);
    assert.equal(result.allowed,true);assert.equal(result.lossStreak,0);assert.equal(result.pairPauseUntil,0);
    assert.equal(result.accountLossStreak,0);assert.equal(result.accountPauseUntil,0);
   }
  }
 }
});
test('simultaneous losses count toward account and pair brakes when the whole close group lost',()=>{
 const rows=[trade('btc-one',1),trade('btc-two',1),trade('eth',1,-1,{symbol:'ETH',side:'SELL'})];
 for(const records of [rows,[...rows].reverse()]){
  const result=Feedback.assess(records,request);
  assert.equal(result.allowed,false);assert.equal(result.lossStreak,2);assert.equal(result.accountLossStreak,3);
  assert.equal(result.pairPauseUntil,NOW+29*MINUTE);assert.equal(result.accountPauseUntil,NOW+59*MINUTE);
 }
});
test('a prior mixed timestamp group breaks older streaks while later genuine losses are counted',()=>{
 const rows=[trade('older-loss',3),trade('b-mixed-loss',2),trade('a-mixed-win',2,.5),trade('new-loss',1)];
 const result=Feedback.assess(rows,request);
 assert.equal(result.allowed,true);assert.equal(result.lossStreak,1);assert.equal(result.accountLossStreak,1);
 assert.equal(result.pairPauseUntil,0);assert.equal(result.accountPauseUntil,0);
});
test('identical duplicate IDs count once, and conflicting or malformed duplicates discard that ID',()=>{
 const one=trade('duplicate',5),other=trade('other',10);
 const identical=Feedback.assess([one,{...one}],request);
 assert.equal(identical.allowed,true);assert.equal(identical.sampleCount,1);
 for(const conflict of [{...one,netRaw:-5},{...one,side:'SELL'},{...one,closedAt:NOW+1}]){
  for(const records of [[one,other,conflict],[conflict,other,one]]){
   const result=Feedback.assess(records,request);
   assert.equal(result.allowed,true);assert.equal(result.sampleCount,1);assert.equal(result.lossStreak,1);
  }
 }
});
test('raw realized accounting takes priority over rounded net, with legacy net fallback',()=>{
 const rows=[trade('tiny',2,0,{netRaw:-.001}),trade('legacy',3,-.5,{netRaw:undefined})];
 const result=Feedback.assess(rows,request);
 assert.equal(result.allowed,false);assert.equal(result.netUsd,-.501);
 const flat=Feedback.assess([...rows,trade('zero',1,0)],request);
 assert.equal(flat.allowed,true);assert.equal(flat.lossStreak,0);
});
test('clock, symbol and direction errors block assessment and source records remain untouched',()=>{
 for(const extra of [{now:NaN},{now:Infinity},{now:0},{side:'LONG'},{symbol:'BTC/usdt'}])
  assert.equal(Feedback.assess([],{...request,...extra}).allowed,false);
 const records=Object.freeze([Object.freeze(trade('b',1)),Object.freeze(trade('a',2))]);
 assert.equal(Feedback.assess(records,request).allowed,false);
 assert.equal(records[0].id,'b');assert.equal(records[1].id,'a');
});
test('only the latest 200 validated outcomes contribute to the bounded rolling assessment',()=>{
 const records=Array.from({length:201},(_,i)=>trade('trade-'+i,59-i*.2,i===0?-100:.5));
 const result=Feedback.assess(records,request);
 assert.equal(result.sampleCount,200);assert.equal(result.netUsd,100);assert.equal(result.allowed,true);
});
