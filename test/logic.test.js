import test from 'node:test';
import assert from 'node:assert/strict';
import {calculateShift,toCents,weekOf,makeReport} from '../lib.js';

test('overnight asleep shift crossing midnight',()=>{
 const s=calculateShift({workDate:'2026-10-20',startTime:'22:00',endTime:'06:00',breakMinutes:0,rateCents:1500});
 assert.equal(s.paidMinutes,480);
 assert.equal(s.wageCents,12000);
 assert.deepEqual(s.segments.map(x=>x.date),['2026-10-20','2026-10-21']);
 assert.deepEqual(s.segments.map(x=>x.wageCents),[3000,9000]);
});
test('unpaid break is removed',()=>{
 const s=calculateShift({workDate:'2026-10-25',startTime:'23:00',endTime:'01:00',breakMinutes:30,rateCents:2400});
 assert.equal(s.paidMinutes,90);
 assert.equal(s.wageCents,3600);
 assert.equal(s.segments.reduce((v,x)=>v+x.wageCents,0),3600);
});
test('invalid breaks are rejected',()=>{
 assert.throws(()=>calculateShift({workDate:'2026-10-21',startTime:'09:00',endTime:'10:00',breakMinutes:70,rateCents:3000}));
});
test('AUD cents are precise',()=>{
 assert.equal(toCents('25.05'),2505);
 assert.throws(()=>toCents('12.345'));
});
test('Melbourne Monday week start',()=>assert.equal(weekOf('2026-10-25'),'2026-10-19'));
test('wages and expenses aggregate by family',()=>{
 const s=calculateShift({workDate:'2026-10-20',startTime:'22:00',endTime:'06:00',rateCents:1500});
 const r=makeReport([{familyId:'f1',familyName:'Example',segments:s.segments}], [{familyId:'f1',familyName:'Example',purchaseDate:'2026-10-21',amountCents:2500}], []);
 assert.equal(r.weekly[0].paidHours,8);
 assert.equal(r.weekly[0].totalCents,14500);
 assert.equal(r.monthly[0].totalCents,14500);
});
test('Sunday shift crossing into Monday becomes separate weeks',()=>{
 const s=calculateShift({workDate:'2026-10-25',startTime:'23:00',endTime:'01:00',rateCents:2000});
 const r=makeReport([{familyId:'f1',familyName:'Example',segments:s.segments}],[],[]);
 assert.equal(r.weekly.length,2);
 assert.equal(r.weekly.reduce((n,x)=>n+x.wagesCents,0),4000);
});
