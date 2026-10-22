import {ObjectId} from 'mongodb';
const key=name=>name.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
export function validateFamilyEdit(body,existing){
 const name=typeof body.name==='string'?body.name.trim():'';
 if(name.length<2||name.length>100)throw Error('Family name must contain 2–100 characters.');
 if(!Array.isArray(body.children)||body.children.length>100)throw Error('Invalid children list.');
 const ids=new Set(),names=new Set();
 const children=body.children.map(row=>{
  if(!row||typeof row!=='object')throw Error('Invalid child details.');
  const name=typeof row.name==='string'?row.name.trim():'';
  if(name.length<2||name.length>80)throw Error('Child names must contain 2–80 characters.');
  if(row.id&&(!existing.some(c=>String(c._id)===row.id)||ids.has(row.id)))throw Error('Invalid or duplicate child. Refresh and retry.');
  if(row.id)ids.add(row.id);
  const nameKey=key(name);
  if(names.has(nameKey))throw Error('Each child must have a distinct name, including archived children.');
  names.add(nameKey);
  if(!['active','archived','removed'].includes(row.status))throw Error('Invalid child status.');
  return {id:row.id,name,nameKey,status:row.status};
 });
 if(existing.some(c=>!ids.has(String(c._id))))throw Error('Children changed in another window. Refresh and retry.');
 return {name,children};
}
export function registerFamilyRoutes(app,{db,client,csrf,wrap}){
 const familyId=req=>ObjectId.isValid(req.params.id)?new ObjectId(req.params.id):null;
 async function details(fid,session){
  const opts=session?{session}:{};
  const family=await db.collection('families').findOne({_id:fid},opts);
  if(!family)return null;
  const children=await db.collection('children').find({familyId:fid},opts).toArray();
  const rates=await db.collection('rates').find({familyId:fid},opts).toArray();
  const shifts=await db.collection('shifts').find({familyId:fid},opts).toArray();
  return {...family,children:children.map(c=>({...c,linked:rates.some(r=>(r.childIds||[]).some(i=>String(i)===String(c._id)))||shifts.some(s=>[...(s.childIds||[]),...(s.careSegments||[]).flatMap(p=>p.childIds||[])].some(i=>String(i)===String(c._id))),rateCodes:rates.filter(r=>(r.childIds||[]).some(i=>String(i)===String(c._id))).map(r=>r.rateId)}))};
 }
 app.get('/api/families/:id',wrap(async(req,res)=>{
  const fid=familyId(req),detail=fid&&await details(fid);
  if(!detail)return res.status(404).json({error:'Family not found.'});
  res.json(detail);
 }));
 app.patch('/api/families/:id',csrf,wrap(async(req,res)=>{
  const fid=familyId(req);if(!fid)return res.status(400).json({error:'Invalid family.'});
  const session=client.startSession();
  try{
   await session.withTransaction(async()=>{
    const current=await details(fid,session);
    if(!current)throw Error('Family not found.');
    if((req.body.revision??0)!==(current.revision??0))throw Error('Family changed in another window. Reopen the editor before saving.');
    const edit=validateFamilyEdit(req.body,current.children);
    await db.collection('families').updateOne({_id:fid},{$set:{name:edit.name,nameKey:edit.name.toLowerCase(),updatedAt:new Date()},$inc:{revision:1}},{session});
    // Keep all identities as tombstones, including accidental additions. Concurrent
    // profile creation can therefore never leave a dangling child reference.
    for(const child of edit.children){
     const old=current.children.find(c=>String(c._id)===child.id);
     const archived=child.status!=='active';
     const fields={name:child.name,nameKey:child.nameKey,archived,removed:child.status==='removed'&&!old?.linked,updatedAt:new Date()};
     if(old)await db.collection('children').updateOne({_id:old._id},{$set:fields},{session});
     else await db.collection('children').insertOne({...fields,familyId:fid,createdAt:new Date()},{session});
    }
   });
   res.json({ok:true});
  }catch(e){
   if(e.code===11000)return res.status(409).json({error:'That family or child name already exists.'});
   if(e.hasErrorLabel?.('UnknownTransactionCommitResult'))return res.status(503).json({error:'Save status is uncertain. Reopen this family before retrying.'});
   res.status(400).json({error:e.message});
  }finally{await session.endSession();}
 }));
}
