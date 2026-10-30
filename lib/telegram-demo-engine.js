'use strict';
// Persistent Telegram-controlled DEMO-ONLY scalper. No Bybit private API,
// credentials, leverage, exchange orders, or real balances are used here.
const fs=require('node:fs'),path=require('node:path');
const Engine=require('../static/seconds-engine');
const Signals=require('../static/demo-seconds-signals');
const Guard=require('../static/demo-seconds-guard');
const Intelligence=require('../static/demo-scalp-intelligence');
const Account=require('../static/demo-seconds-account');

const SYMBOLS=['BTCUSDT','ETHUSDT','SOLUSDT','XRPUSDT','DOGEUSDT','BNBUSDT'];
const MAX_PAIRS=8;
const STATE_VERSION=1;
function safeSymbols(raw){
 const symbols=Engine.validSymbols(raw,{maxSymbols:MAX_PAIRS});
 return symbols;
}
function storedAccount(value,now){
 if(!value||value.version!==Account.SMALL_VERSION||value.starting!==88||
  !value.ledger||!Array.isArray(value.ledger.closed))throw Error('Telegram paper account state invalid; manual recovery required');
 const restored=Account.restore(value,now,Account.SMALL_VERSION);
 if(restored.version!==Account.SMALL_VERSION||restored.starting!==88||
  restored.closedTrades!==value.closedTrades||restored.cash!==value.cash)
  throw Error('Telegram paper account integrity check failed; manual recovery required');
 return restored;
}
class TelegramDemoEngine{
 constructor({directory,now=()=>Date.now()}={}){
  if(!directory)throw Error('Persistent state directory is required');
  this.now=now;this.directory=directory;
  fs.mkdirSync(directory,{recursive:true,mode:0o700});
  this.file=path.join(directory,'telegram-demo-state.json');
  this.events=[];
  const raw=fs.existsSync(this.file)?JSON.parse(fs.readFileSync(this.file,'utf8')):null;
  if(raw){
   if(raw.version!==STATE_VERSION||typeof raw.running!=='boolean'||
    !Number.isSafeInteger(raw.telegramOffset)||raw.telegramOffset<0)
    throw Error('Telegram bot state invalid; manual recovery required');
   this.state={version:STATE_VERSION,running:raw.running,
    telegramOffset:raw.telegramOffset,
    symbols:safeSymbols(raw.symbols),
    wallet:storedAccount(raw.wallet,now())};
  }else{
   this.state={version:STATE_VERSION,running:false,telegramOffset:0,
    symbols:[...SYMBOLS],wallet:Account.smallInitial(now())};
  }
  // After any crash we cannot know whether an unobserved simulated stop filled.
  if(this.state.wallet.ledger.open){
   this.state.wallet=Account.interrupt(this.state.wallet,now());
  }
  this.resetFeed();
  this.save();
 }
 save(){
  const tmp=this.file+'.tmp';
  fs.writeFileSync(tmp,JSON.stringify(this.state),{mode:0o600});
  fs.renameSync(tmp,this.file);
 }
 resetFeed(){
  this.engine=Engine.create(this.state.symbols,{maxSymbols:MAX_PAIRS,
   notional:Account.SMALL_TRADE_USD,goalNet:Account.SMALL_TARGET_NET});
  this.intelligence=Intelligence.create();
  this.lastFeedAt=0;
  this.lastResults=[];
 }
 setOffset(next){
  if(!Number.isSafeInteger(next)||next<0)throw Error('Invalid Telegram update offset');
  if(next>this.state.telegramOffset){this.state.telegramOffset=next;this.save()}
 }
 start(){
  if(this.state.running)return 'The DEMO scalper is already running.';
  const eligible=Account.eligibility(this.state.wallet,this.now());
  if(!eligible.allowed)return 'Demo entries blocked: '+eligible.reason+'.';
  this.resetFeed();this.state.running=true;this.save();
  return 'Demo scanning armed. $88 VIRTUAL wallet; $15 simulated position, +$0.05 estimated net goal, -$0.08 modeled trigger, $1 daily limit. Collecting 60 seconds of Bybit prices. No real orders.';
 }
 pause(reason='Paused by owner'){
  if(!this.state.running)return 'Demo is already paused.';
  this.state.running=false;
  if(this.state.wallet.ledger.open)this.state.wallet=Account.interrupt(this.state.wallet,this.now());
  this.resetFeed();this.save();
  return reason+'. Any unverified open virtual trade is marked INCOMPLETE, never booked as a win.';
 }
 setPairs(raw){
  if(this.state.running)throw Error('Pause demo monitoring before changing pairs.');
  const pairs=safeSymbols(raw);
  this.state.symbols=pairs;this.resetFeed();this.save();
  return 'Demo pairs: '+pairs.join(', ')+'. Start again to collect fresh order books.';
 }
 ingest(message,now=this.now()){
  if(!this.state.running)return false;
  const accepted=this.engine.ingest(message,now);
  if(accepted)this.lastFeedAt=now;
  return accepted;
 }
 disconnect(reason='Public Bybit stream interrupted'){
  if(this.state.wallet.ledger.open){
   this.state.wallet=Account.interrupt(this.state.wallet,this.now());
   this.events.push({type:'INCOMPLETE',message:reason});
  }
  this.resetFeed();this.save();
 }
 tick(connected=false,now=this.now()){
  if(!this.state.running||!connected)return [];
  const symbols=this.state.symbols;
  const reviewed=this.intelligence.update(
   symbols.map(s=>Guard.filter(Signals.evaluate(this.engine.observation(s,now)),this.engine.history(s),now)),
   Object.fromEntries(symbols.map(s=>[s,this.engine.history(s)])),
   this.state.wallet.ledger.closed,now);
  this.lastResults=reviewed.signals;
  const quotes=Object.fromEntries(symbols.map(s=>[s,this.engine.execution(s,now)]));
  const step=Account.step(this.state.wallet,{now,signals:reviewed.signals,quotes,connected:true});
  this.state.wallet=step.account;
  if(step.events.length){this.events.push(...step.events);this.save()}
  if(!step.risk.allowed&&!this.state.wallet.ledger.open){
   this.state.running=false;this.save();
   this.events.push({type:'RISK_PAUSE',message:step.risk.reason});
  }
  return step.events;
 }
 takeEvents(){const out=this.events.splice(0);return out}
 health(now=this.now()){
  const rows=this.state.symbols.map(s=>this.engine.diagnostics(s,now));
  const ready=rows.filter(r=>r.reason==='Live market data is ready').length;
  const candidates=this.lastResults.filter(s=>s.state==='WATCH').length;
  const firstBlock=this.lastResults.find(s=>s.state!=='WATCH');
  const risk=Account.eligibility(this.state.wallet,now);
  return {running:this.state.running,connectedAgeSeconds:this.lastFeedAt?
   Math.round((now-this.lastFeedAt)/1000):null,
   ready,all:rows.length,candidates,block:!risk.allowed?risk.reason:
    firstBlock?.reason||'No qualifying setup in recent data',
   rows};
 }
 status(now=this.now()){
  const stats=Account.stats(this.state.wallet,now);
  const health=this.health(now);
  return {stats,health,symbols:[...this.state.symbols],last:[...this.state.wallet.ledger.closed].slice(-5)};
 }
}
module.exports={TelegramDemoEngine,SYMBOLS,MAX_PAIRS};
