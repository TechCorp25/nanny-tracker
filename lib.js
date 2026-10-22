import {DateTime} from 'luxon';
export const TIME_ZONE='Australia/Melbourne';
export const SERVICES=['Daytime','Overnight Awake','Overnight Asleep'];
export const STATUSES=['Unpaid','Partially Paid','Paid'];
export const validDate=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&DateTime.fromISO(s,{zone:TIME_ZONE}).isValid;
export const validTime=s=>typeof s==='string'&&/^([01]\d|2[0-3]):[0-5]\d$/.test(s);
export function toCents(n,allowZero=false){
 const s=String(n??'');
 if(!/^(0|[1-9]\d{0,6})(?:\.\d{1,2})?$/.test(s))throw new Error('Enter a valid dollar amount with up to two decimal places.');
 const [whole,part='']=s.split('.');
 const x=Number(whole)*100+Number(part.padEnd(2,'0'));
 if(!allowZero&&!x)throw new Error('Amount must be positive.');
 return x;
}
export function calculateShift({workDate,startTime,endTime,breakMinutes=0,rateCents}){
 if(!validDate(workDate)||!validTime(startTime)||!validTime(endTime))throw new Error('Invalid shift date or time.');
 if(startTime===endTime)throw new Error('Start and end must differ; split 24-hour shifts.');
 const start=DateTime.fromISO(workDate+'T'+startTime,{zone:TIME_ZONE});
 let end=DateTime.fromISO(workDate+'T'+endTime,{zone:TIME_ZONE});
 if(endTime<startTime)end=end.plus({days:1});
 if(!start.isValid||!end.isValid||start.toFormat('HH:mm')!==startTime||end.toFormat('HH:mm')!==endTime)throw new Error('Invalid local time, possibly during daylight saving.');
 const total=Math.round(end.diff(start,'minutes').minutes),br=Number(breakMinutes||0);
 if(total<1||total>1440||!Number.isInteger(br)||br<0||br>=total)throw new Error('Shift must be 1–1440 minutes with a smaller nonnegative break.');
 if(!Number.isSafeInteger(rateCents)||rateCents<0)throw new Error('Invalid hourly rate.');
 const paid=total-br,wage=Math.round(paid*rateCents/60);
 const segments=[];let cursor=start;let allocated=0;
 while(cursor<end){
  const next=cursor.startOf('day').plus({days:1});
  const until=next<end?next:end;
  const minutes=until.diff(cursor,'minutes').minutes;
  const paidMinutes=minutes*paid/total;
  let share=Math.round(paidMinutes*rateCents/60);
  if(until.equals(end))share=wage-allocated;
  segments.push({date:cursor.toISODate(),paidMinutes,wageCents:share});
  allocated+=share;cursor=until;
 }
 return {startAt:start.toUTC().toJSDate(),endAt:end.toUTC().toJSDate(),paidMinutes:paid,wageCents:wage,segments};
}
export function weekOf(date){const d=DateTime.fromISO(date,{zone:TIME_ZONE});return d.minus({days:d.weekday-1}).toISODate();}
export const monthOf=date=>date.slice(0,7);
export function makeReport(shifts,expenses,payments){
 const weekly=new Map(),monthly=new Map();
 const ensure=(map,id,name,period)=>{const k=period+'|'+id;if(!map.has(k))map.set(k,{key:k,period,familyId:String(id),familyName:name,paidMinutes:0,wagesCents:0,expensesCents:0});return map.get(k);};
 for(const s of shifts)for(const seg of s.segments||[])for(const [map,p] of [[weekly,weekOf(seg.date)],[monthly,monthOf(seg.date)]]){
  const x=ensure(map,s.familyId,s.familyName,p);x.paidMinutes+=seg.paidMinutes;x.wagesCents+=seg.wageCents;
 }
 for(const e of expenses)for(const [map,p] of [[weekly,weekOf(e.purchaseDate)],[monthly,monthOf(e.purchaseDate)]]){
  ensure(map,e.familyId,e.familyName,p).expensesCents+=e.amountCents;
 }
 const status=new Map(payments.map(p=>[p.weekOf+'|'+p.familyId,p.status]));
 const output=(map,withStatus)=>[...map.values()].map(x=>({
  ...x,paidHours:Math.round(x.paidMinutes/60*100)/100,totalCents:x.wagesCents+x.expensesCents,
  ...(withStatus?{status:status.get(x.key)||'Unpaid'}:{})
 })).sort((a,b)=>b.period.localeCompare(a.period)||a.familyName.localeCompare(b.familyName));
 return {weekly:output(weekly,true),monthly:output(monthly,false)};
}
