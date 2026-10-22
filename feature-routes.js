import {ObjectId} from 'mongodb';
import {validDate,toCents,SERVICES,weekOf} from './lib.js';
import {rateCode,compositeShift,categoryTotals,EXPENSE_TYPES,BILLING_UNITS} from './care-logic.js';

const id=s=>typeof s==='string'&&ObjectId.isValid(s)&&String(new ObjectId(s))===s.toLowerCase()?new ObjectId(s):null;
const clean=(s,max=200)=>typeof s==='string'?s.trim().slice(0,max):'';

export async function registerCareRoutes(app,{db,csrf,wrap}){
 await db.collection('children').createIndex({familyId:1,nameKey:1},{unique:true});
 app.get('/api/children',wrap(async(req,res)=>{
  res.json(await db.collection('children').find({}).sort({familyId:1,name:1}).toArray());
 }));
 app.post('/api/children',csrf,wrap(async(req,res)=>{
  const familyId=id(req.body?.familyId),family=familyId?await db.collection('families').findOne({_id:familyId}):null;
  const name=clean(req.body?.name,80);
  if(!family||name.length<2)return res.status(400).json({error:'Select a family and enter a child name (at least 2 characters).'});
  try{
   const r=await db.collection('children').insertOne({familyId,name,nameKey:name.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase(),createdAt:new Date()});
   res.status(201).json({ok:true,id:String(r.insertedId)});
  }catch(e){
   if(e.code===11000)return res.status(409).json({error:'This child is already listed for the family.'});
   throw e;
  }
 }));
 async function selectedChildren(body){
  const familyId=id(body.familyId),family=familyId?await db.collection('families').findOne({_id:familyId}):null;
  if(!family)throw Error('Choose a family.');
  const raw=body.childIds;
  if(!Array.isArray(raw)||!raw.length||raw.length>20||new Set(raw).size!==raw.length)throw Error('Select 1–20 distinct children.');
  const ids=raw.map(id);
  if(ids.some(x=>!x))throw Error('Invalid child selection.');
  const selected=await db.collection('children').find({familyId,archived:{$ne:true},_id:{$in:ids}}).toArray();
  if(selected.length!==ids.length)throw Error('One or more children are not in the selected family.');
  const all=await db.collection('children').find({familyId,archived:{$ne:true}}).toArray();
  const allChildren=all.length>1&&all.length===selected.length;
  selected.sort((a,b)=>a.name.localeCompare(b.name,'en-AU',{sensitivity:'base'}));
  return {family,selected,allChildren};
 }
 async function proposedCode(body){
  const {family,selected,allChildren}=await selectedChildren(body);
  if(!validDate(body.effectiveDate))throw Error('Choose a valid effective date.');
  const codes=await db.collection('rates').find({},{projection:{rateId:1}}).toArray();
  const code=rateCode({familyName:family.name,childNames:selected.map(c=>c.name),allChildren,effectiveDate:body.effectiveDate,takenIds:codes.map(c=>c.rateId)});
  return {code,family,selected,allChildren};
 }
 app.post('/api/rates/preview-v2',csrf,wrap(async(req,res)=>{
  try{const {code}=await proposedCode(req.body);res.json({rateId:code});}
  catch(e){res.status(400).json({error:e.message});}
 }));
 app.post('/api/rates/v2',csrf,wrap(async(req,res)=>{
  const body=req.body||{};
  const serviceType=clean(body.serviceType,40),billingUnit=clean(body.billingUnit,30);
  if(!SERVICES.includes(serviceType)||!BILLING_UNITS.includes(billingUnit))
   return res.status(400).json({error:'Select the service type and billing unit.'});
  let rateCents;
  try{rateCents=toCents(body.rate);}catch(e){return res.status(400).json({error:e.message});}
  let selection;
  try{selection=await selectedChildren(body);}catch(e){return res.status(400).json({error:e.message});}
  if(!validDate(body.effectiveDate))return res.status(400).json({error:'Choose a valid effective start date.'});
  const {family,selected,allChildren}=selection;
  const base={
   familyId:family._id,familyName:family.name,
   childIds:selected.map(c=>c._id),
   childrenSnapshot:selected.map(c=>({childId:c._id,name:c.name})),
   profileKind:selected.length===1?'single':allChildren?'all':'subset',
   serviceType,billingUnit,rateCents,effectiveDate:body.effectiveDate,
   childrenCount:selected.length,ages:clean(body.ages,140),notes:clean(body.notes,600),createdAt:new Date()
  };
  for(let attempt=0;attempt<12;attempt++){
   const codes=await db.collection('rates').find({},{projection:{rateId:1}}).toArray();
   const rateId=rateCode({familyName:family.name,childNames:selected.map(c=>c.name),allChildren,effectiveDate:body.effectiveDate,takenIds:codes.map(c=>c.rateId)});
   try{
    await db.collection('rates').insertOne({...base,rateId,rateKey:rateId.toLowerCase()});
    return res.status(201).json({ok:true,rateId});
   }catch(e){if(e.code!==11000||attempt===11)throw e;}
  }
 }));
 app.post('/api/shifts/v2',csrf,wrap(async(req,res)=>{
  const input=req.body||{},familyId=id(input.familyId),family=familyId?await db.collection('families').findOne({_id:familyId}):null;
  if(!family)return res.status(400).json({error:'Choose a family.'});
  if(!Array.isArray(input.segments)||input.segments.length<1||input.segments.length>24)
   return res.status(400).json({error:'Add between 1 and 24 time segments.'});
  const profileIds=input.segments.map(s=>id(s.rateId));
  if(profileIds.some(x=>!x))return res.status(400).json({error:'Select a rate profile in each segment.'});
  const profiles=await db.collection('rates').find({_id:{$in:profileIds},familyId}).toArray();
  const currentChildren=await db.collection('children').find({familyId}).toArray();
  const currentNames=new Map(currentChildren.map(c=>[String(c._id),c.name]));
  const archivedIds=new Set(currentChildren.filter(c=>c.archived).map(c=>String(c._id)));
  const profileMap=new Map(profiles.map(x=>[String(x._id),x]));
  let result;
  try{
   const segments=input.segments.map(s=>{
    const p=profileMap.get(String(s.rateId));
    if(p&&(p.childIds||[]).some(i=>archivedIds.has(String(i))))throw Error('This rate includes an archived child. Choose a current rate profile.');
    if(!p)throw Error('Every segment must use a rate profile belonging to the selected family.');
    if(!validDate(s.workDate)||s.workDate<p.effectiveDate)throw Error('A segment date precedes the profile effective date.');
    const serviceType=p.serviceType||s.serviceType;
    if(!SERVICES.includes(serviceType))throw Error('Select a valid service for each segment.');
    const expected=(p.childIds||[]).map(String).sort();
    if(expected.length){
     if(!Array.isArray(s.childIds)||new Set(s.childIds).size!==s.childIds.length||
        JSON.stringify([...s.childIds].sort())!==JSON.stringify(expected))
      throw Error('Segment child selection must match the saved rate profile.');
    }
    const unit=p.billingUnit||'hour';
    const rateCents=p.rateCents??p.rates?.[serviceType];
    if(!Number.isSafeInteger(rateCents))throw Error('Invalid rate profile.');
    return {
     rateId:p._id,rateCode:p.rateId,serviceType,
     childIds:p.childIds||[],
     childrenSnapshot:(p.childrenSnapshot||[]).map(c=>({...c,name:currentNames.get(String(c.childId))||c.name})),
     rateCents,billingUnit:unit,
     workDate:s.workDate,startTime:s.startTime,endTime:s.endTime,
     breakMinutes:s.breakMinutes||0
    };
   });
   result=compositeShift(segments);
  }catch(e){return res.status(400).json({error:e.message});}
  const overlap=await db.collection('shifts').findOne({familyId,startAt:{$lt:result.endAt},endAt:{$gt:result.startAt}});
  if(overlap)return res.status(409).json({error:'The time range overlaps another shift for this family; no duplicate charges were recorded.'});
  const first=result.careSegments[0];
  const doc={
   familyId,familyName:family.name,rateId:first.rateId,
   rateCode:result.careSegments.length===1?first.rateCode:'MULTIPLE',
   rateCodes:[...new Set(result.careSegments.map(s=>s.rateCode))],
   serviceType:result.careSegments.length===1?first.serviceType:'Multiple services',
   workDate:first.workDate,startTime:first.startTime,
   endTime:result.careSegments.at(-1).endTime,
   breakMinutes:result.careSegments.reduce((n,s)=>n+Number(s.breakMinutes),0),
   hourlyRateCents:result.careSegments.length===1&&first.billingUnit==='hour'?first.rateCents:null,
   notes:clean(input.notes,800),...result,createdAt:new Date()
  };
  const stored=await db.collection('shifts').insertOne(doc);
  res.status(201).json({ok:true,id:String(stored.insertedId),wageCents:doc.wageCents});
 }));
 app.get('/api/expenses/report',wrap(async(req,res)=>{
  const familyId=clean(req.query.familyId,64),period=clean(req.query.period||'all',10),start=clean(req.query.start,10);
  if(familyId&&!id(familyId))return res.status(400).json({error:'Invalid family filter.'});
  if(period==='week'&&weekOf(start)!==start)return res.status(400).json({error:'Select the Monday of the reporting week.'});
  if(period==='month'&&(!validDate(start)||!start.endsWith('-01')))return res.status(400).json({error:'Select the first day of the reporting month.'});
  try{
   const all=await db.collection('expenses').find({}).toArray();
   res.json(categoryTotals(all,{familyId,period,start}));
  }catch(e){res.status(400).json({error:e.message});}
 }));
 app.patch('/api/expenses/:id',csrf,wrap(async(req,res)=>{
  const expenseId=id(req.params.id);
  if(!expenseId)return res.status(400).json({error:'Invalid expense ID.'});
  const item=await db.collection('expenses').findOne({_id:expenseId});
  if(!item)return res.status(404).json({error:'Expense not found.'});
  if(!EXPENSE_TYPES.includes(req.body?.expenseType))return res.status(400).json({error:'Choose an expense type before saving.'});
  if(!validDate(req.body.purchaseDate))return res.status(400).json({error:'Choose a valid purchase date.'});
  const description=clean(req.body.description,250);
  if(!description)return res.status(400).json({error:'Enter an expense description.'});
  let amountCents;
  try{amountCents=toCents(req.body.amount);}catch(e){return res.status(400).json({error:e.message});}
  const familyId=id(req.body.familyId);
  if(!familyId)return res.status(400).json({error:'Choose a family.'});
  const family=await db.collection('families').findOne({_id:familyId});
  if(!family)return res.status(400).json({error:'Family not found.'});
  await db.collection('expenses').updateOne({_id:expenseId},{$set:{
   familyId,familyName:family.name,purchaseDate:req.body.purchaseDate,
   description,amountCents,expenseType:req.body.expenseType,notes:clean(req.body.notes,600),updatedAt:new Date()
  }});
  res.json({ok:true});
 }));
}
