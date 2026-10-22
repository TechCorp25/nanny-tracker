import test from 'node:test';
import assert from 'node:assert/strict';
import {rateCode,compositeShift,categoryTotals,normalName} from '../care-logic.js';

const codeFor=(childNames,allChildren=false,takenIds=[],effectiveDate='2026-03-14')=>
 rateCode({familyName:'Johnson Family',childNames,allChildren,effectiveDate,takenIds});

test('single child ID: 4 letters, DDMMYY, lowercase, leading zeroes',()=>{
 assert.equal(codeFor(['Clementine']),'clem-140326');
 assert.equal(codeFor(['Al'],false,[],'2026-01-04'),'al-040126');
});
test('subset of siblings sorts alphabetically; punctuation and accents normalise',()=>{
 assert.equal(codeFor(['Oliver','Clementine']),'clem-oliv-140326');
 assert.equal(codeFor(['Éloïse',"O'Connor"]),'eloi-ocon-140326');
 assert.equal(normalName('  Éloïse  '),'eloise');
});
test('all children use family five-letter prefix, and single child still uses child name',()=>{
 assert.equal(codeFor(['Oliver','Clementine','Amelia'],true),'johns-140326');
 assert.equal(codeFor(['Clementine'],true),'clem-140326');
});
test('colliding profiles get numeric suffixes with two digit padding',()=>{
 assert.equal(codeFor(['Clementine'],false,['clem-140326']),'clem-140326-02');
 assert.equal(codeFor(['Clementine'],false,['clem-140326','clem-140326-02']),'clem-140326-03');
});
test('segmented shift crosses midnight and sums distinct rates correctly',()=>{
 const result=compositeShift([
  {workDate:'2026-03-14',startTime:'23:00',endTime:'01:00',breakMinutes:0,rateCents:2000,billingUnit:'hour',rateCode:'clem-140326'},
  {workDate:'2026-03-15',startTime:'01:00',endTime:'03:00',breakMinutes:0,rateCents:3000,billingUnit:'hour',rateCode:'johns-140326'}
 ]);
 assert.equal(result.wageCents,10000);
 assert.equal(result.paidMinutes,240);
 assert.equal(result.careSegments.length,2);
 assert.equal(result.segments.reduce((n,x)=>n+x.wageCents,0),10000);
 assert.deepEqual(result.segments.map(x=>x.date),['2026-03-14','2026-03-15']);
});
test('overlapping segments are rejected, adjacent segments allowed',()=>{
 const base={workDate:'2026-03-14',breakMinutes:0,rateCents:2000,billingUnit:'hour'};
 assert.throws(()=>compositeShift([
  {...base,startTime:'09:00',endTime:'11:00'},
  {...base,startTime:'10:00',endTime:'12:00'}
 ]),/overlap/);
 assert.equal(compositeShift([
  {...base,startTime:'09:00',endTime:'11:00'},
  {...base,startTime:'11:00',endTime:'12:00'}
 ]).paidMinutes,180);
});
test('flat per-segment rate billed once and allocated across midnight',()=>{
 const result=compositeShift([{workDate:'2026-03-14',startTime:'23:00',endTime:'01:00',rateCents:2500,billingUnit:'segment',breakMinutes:0}]);
 assert.equal(result.wageCents,2500);
 assert.deepEqual(result.segments.map(x=>x.wageCents),[1250,1250]);
});
test('expense types group independently of reimbursement total, including legacy rows',()=>{
 const expenses=[
  {familyId:'f1',purchaseDate:'2026-03-14',amountCents:1000,expenseType:'Food and meals'},
  {familyId:'f1',purchaseDate:'2026-03-15',amountCents:2000},
  {familyId:'f2',purchaseDate:'2026-03-15',amountCents:700,expenseType:'Other'}
 ];
 const one=categoryTotals(expenses,{familyId:'f1'});
 assert.equal(one.totalCents,3000);
 assert.deepEqual(one.items.map(x=>x.name),['Uncategorised','Food and meals']);
 assert.equal(categoryTotals(expenses,{}).totalCents,3700);
});
