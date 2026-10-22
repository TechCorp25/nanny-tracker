import {calculateShift,validDate} from './lib.js';

export const EXPENSE_TYPES=['Food and meals','Transport and mileage','Activities and admission fees','Childcare supplies','Other'];
export const BILLING_UNITS=['hour','segment'];

export function normalName(name){
 return String(name??'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'')
  .replace(/[^a-zA-Z0-9]/g,'').toLowerCase();
}
export function rateCode({familyName,childNames,allChildren=false,effectiveDate,takenIds=[]}){
 if(!validDate(effectiveDate))throw Error('Select a valid effective start date.');
 if(!Array.isArray(childNames)||!childNames.length||childNames.some(n=>!normalName(n)))throw Error('Select at least one named child.');
 const children=[...childNames].sort((a,b)=>normalName(a).localeCompare(normalName(b),'en'));
 const familyStem=normalName(String(familyName).replace(/\s+family\s*$/i,''))||'family';
 const prefix=children.length===1?normalName(children[0]).slice(0,4):
  allChildren?familyStem.slice(0,5):children.map(n=>normalName(n).slice(0,4)).join('-');
 const [year,month,day]=effectiveDate.split('-');
 const base=prefix+'-'+day+month+year.slice(-2);
 const taken=new Set(takenIds.map(x=>String(x).toLowerCase()));
 if(!taken.has(base))return base;
 for(let i=2;i<10000;i++){
  const candidate=base+'-'+String(i).padStart(2,'0');
  if(!taken.has(candidate))return candidate;
 }
 throw Error('Unable to generate a unique Rate ID.');
}

export function compositeShift(inputs){
 if(!Array.isArray(inputs)||inputs.length<1||inputs.length>24)throw Error('A shift must have 1–24 segments.');
 let startAt=null,endAt=null,paidMinutes=0,wageCents=0;
 const careSegments=[],byDate=new Map();
 for(const s of inputs){
  if(!Number.isSafeInteger(s.rateCents)||s.rateCents<0||!BILLING_UNITS.includes(s.billingUnit))
   throw Error('Invalid segment rate or billing unit.');
  const raw=calculateShift({workDate:s.workDate,startTime:s.startTime,endTime:s.endTime,breakMinutes:s.breakMinutes,rateCents:s.billingUnit==='hour'?s.rateCents:0});
  if(startAt===null)startAt=raw.startAt;
  if(careSegments.length&&raw.startAt<careSegments[careSegments.length-1].endAt)
   throw Error('Segments must be in chronological order and may not overlap.');
  if(endAt===null||raw.endAt>endAt)endAt=raw.endAt;
  let wages=raw.wageCents;
  let dates=raw.segments;
  if(s.billingUnit==='segment'){
   wages=s.rateCents;
   let assigned=0;
   dates=raw.segments.map((part,i)=>{
    const amount=i===raw.segments.length-1?wages-assigned:Math.round(wages*part.paidMinutes/raw.paidMinutes);
    assigned+=amount;
    return {...part,wageCents:amount};
   });
  }
  for(const part of dates){
   const aggregate=byDate.get(part.date)||{date:part.date,paidMinutes:0,wageCents:0};
   aggregate.paidMinutes+=part.paidMinutes;
   aggregate.wageCents+=part.wageCents;
   byDate.set(part.date,aggregate);
  }
  paidMinutes+=raw.paidMinutes;wageCents+=wages;
  careSegments.push({
   ...s,startAt:raw.startAt,endAt:raw.endAt,
   paidMinutes:raw.paidMinutes,wageCents:wages,
   allocations:dates
  });
 }
 if(endAt-startAt>48*60*60*1000)throw Error('A shift cannot span more than 48 hours.');
 return {startAt,endAt,paidMinutes,wageCents,careSegments,segments:[...byDate.values()].sort((a,b)=>a.date.localeCompare(b.date))};
}

export function categoryTotals(expenses,{familyId='',period='all',start=''}={}){
 if(!['all','week','month'].includes(period))throw Error('Invalid reporting period.');
 if(period!=='all'&&!validDate(start))throw Error('Choose a valid reporting period start date.');
 const end=period==='week'?new Date(start+'T00:00:00Z').getTime()+7*86400000:null;
 const isoEnd=end?new Date(end).toISOString().slice(0,10):null;
 const startMonth=start.slice(0,7);
 const rows=expenses.filter(e=>{
  if(familyId&&String(e.familyId)!==String(familyId))return false;
  if(period==='week'&&(e.purchaseDate<start||e.purchaseDate>=isoEnd))return false;
  if(period==='month'&&e.purchaseDate.slice(0,7)!==startMonth)return false;
  return true;
 });
 const grouped=new Map();
 for(const e of rows){
  const key=e.expenseType||'Uncategorised';
  grouped.set(key,(grouped.get(key)||0)+e.amountCents);
 }
 return {totalCents:rows.reduce((n,e)=>n+e.amountCents,0),items:[...grouped].map(([name,amountCents])=>({name,amountCents})).sort((a,b)=>b.amountCents-a.amountCents)};
}
