'use strict';
(function(root,factory){const api=factory();if(typeof module!=='undefined'&&module.exports)module.exports=api;if(root)root.OmegaPortfolio=api})(typeof window!=='undefined'?window:null,function(){
 const direction=side=>['BUY','Buy'].includes(side)?1:['SELL','Sell'].includes(side)?-1:NaN;
 function concentrated(side,correlation,positions){
  if(!positions.length)return false;
  if(!Number.isFinite(correlation)||Math.abs(correlation)>1)return true;
  const exposure=direction(side)*correlation;
  return positions.some(p=>{
   const held=p.entryEvidence?.benchmarkCorrelation;
   if(!Number.isFinite(held)||Math.abs(held)>1)return true;
   return exposure*direction(p.side)*held>=.64;
  });
 }
 return {concentrated};
});
