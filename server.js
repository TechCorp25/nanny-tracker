import 'dotenv/config';
import express from 'express';
import session from 'express-session';
import MongoStore from 'connect-mongo';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import bcrypt from 'bcryptjs';
import multer from 'multer';
import {MongoClient,ObjectId,GridFSBucket} from 'mongodb';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {dirname,join} from 'node:path';
import {validDate,validTime,toCents,calculateShift,weekOf,makeReport,SERVICES,STATUSES,generateRateId} from './lib.js';
import {EXPENSE_TYPES} from './care-logic.js';
import {registerCareRoutes} from './feature-routes.js';

const required=['MONGODB_URI','ADMIN_EMAIL','ADMIN_PASSWORD_HASH','SESSION_SECRET'];
const missing=required.filter(k=>!process.env[k]||process.env[k].includes('<'));
if(missing.length){console.error('Missing Render variables: '+missing.join(', '));process.exit(1);}
if(process.env.SESSION_SECRET.length<32||!/^\$2[aby]\$\d{2}\$/.test(process.env.ADMIN_PASSWORD_HASH)){
 console.error('Invalid SESSION_SECRET or ADMIN_PASSWORD_HASH');process.exit(1);
}
const client=new MongoClient(process.env.MONGODB_URI,{serverSelectionTimeoutMS:10000,maxPoolSize:10});
await client.connect();
const db=client.db(process.env.MONGODB_DB||'nanny_wage_tracker');
await Promise.all([
 db.collection('families').createIndex({nameKey:1},{unique:true}),
 db.collection('rates').createIndex({rateKey:1},{unique:true}),
 db.collection('shifts').createIndex({familyId:1,startAt:1,endAt:1}),
 db.collection('expenses').createIndex({familyId:1,purchaseDate:1}),
 db.collection('payments').createIndex({familyId:1,weekOf:1},{unique:true})
]);
const bucket=new GridFSBucket(db,{bucketName:'receipts'});
const app=express();app.disable('x-powered-by');app.set('trust proxy',1);
app.use(helmet({contentSecurityPolicy:{directives:{defaultSrc:["'self'"],scriptSrc:["'self'"],styleSrc:["'self'"],imgSrc:["'self'","data:","blob:"],connectSrc:["'self'"],objectSrc:["'none'"],frameAncestors:["'none'"]}}}));
app.use(express.json({limit:'50kb'}));
app.use(session({
 name:'nanny.sid',
 secret:process.env.SESSION_SECRET,
 store:MongoStore.create({clientPromise:Promise.resolve(client),dbName:db.databaseName,collectionName:'sessions',ttl:604800}),
 resave:false,saveUninitialized:false,rolling:true,
 cookie:{httpOnly:true,sameSite:'lax',secure:process.env.NODE_ENV==='production',maxAge:604800000}
}));
const fail=(res,message,status=400)=>res.status(status).json({error:message});
const wrap=fn=>(req,res,next)=>Promise.resolve(fn(req,res,next)).catch(next);
const id=s=>typeof s==='string'&&ObjectId.isValid(s)&&String(new ObjectId(s))===s.toLowerCase()?new ObjectId(s):null;
const safe=(s,max=300)=>typeof s==='string'?s.trim().slice(0,max):'';
const limitInt=(s,min,max)=>{const n=Number(s);if(!Number.isSafeInteger(n)||n<min||n>max)throw new Error('Invalid whole number.');return n;};
const auth=(req,res,next)=>req.session?.user==='owner'?next():fail(res,'Please sign in.',401);
const csrf=(req,res,next)=>req.session?.csrf&&req.get('X-CSRF-Token')===req.session.csrf?next():fail(res,'Invalid security token. Refresh.',403);
const guard=async(req,res,fn)=>{try{await fn();}catch(e){if(e?.code===11000)return fail(res,'A record with this ID already exists.',409);return fail(res,e.message||'Invalid input.');}};
app.get('/healthz',wrap(async(req,res)=>{await db.command({ping:1});res.json({status:'ok'});}));
app.get('/api/session',(req,res)=>res.json({authenticated:req.session?.user==='owner',csrf:req.session?.user==='owner'?req.session.csrf:null}));
app.post('/api/login',rateLimit({windowMs:900000,limit:8,standardHeaders:'draft-7',legacyHeaders:false}),wrap(async(req,res)=>{
 const email=safe(req.body?.email,200).toLowerCase(),password=typeof req.body?.password==='string'?req.body.password:'';
 if(email!==process.env.ADMIN_EMAIL.trim().toLowerCase()||!await bcrypt.compare(password,process.env.ADMIN_PASSWORD_HASH))return fail(res,'Incorrect credentials.',401);
 req.session.regenerate(err=>{if(err)return fail(res,'Unable to sign in.',500);req.session.user='owner';req.session.csrf=crypto.randomBytes(24).toString('hex');req.session.save(e=>e?fail(res,'Unable to sign in.',500):res.json({authenticated:true,csrf:req.session.csrf}));});
}));
app.use('/api',auth);
app.post('/api/logout',csrf,(req,res)=>req.session.destroy(e=>e?fail(res,'Sign-out error.',500):res.clearCookie('nanny.sid').json({ok:true})));
await registerCareRoutes(app,{db,csrf,wrap});
app.get('/api/families',wrap(async(req,res)=>res.json(await db.collection('families').find({}).sort({name:1}).toArray())));
app.post('/api/families',csrf,wrap(async(req,res)=>guard(req,res,async()=>{
 const name=safe(req.body.name,100);if(name.length<2)throw Error('Family name must contain at least two characters.');
 const doc={name,nameKey:name.toLowerCase(),createdAt:new Date()};
 await db.collection('families').insertOne(doc);res.status(201).json({ok:true});
})));
app.get('/api/rates',wrap(async(req,res)=>res.json(await db.collection('rates').find({}).sort({familyName:1,effectiveDate:-1}).toArray())));
const suggestRateId=async family=>{
 const codes=await db.collection('rates').find({},{projection:{rateId:1,familyId:1}}).toArray();
 return generateRateId(family.name,String(family._id),codes);
};
app.get('/api/rates/next-id',wrap(async(req,res)=>{
 const familyId=id(req.query.familyId),family=familyId?await db.collection('families').findOne({_id:familyId}):null;
 if(!family)return fail(res,'Choose a valid family.');
 res.json({rateId:await suggestRateId(family)});
}));

app.post('/api/rates',csrf,wrap(async(req,res)=>guard(req,res,async()=>{
 const familyId=id(req.body.familyId),family=familyId?await db.collection('families').findOne({_id:familyId}):null;
 if(!family)throw Error('Choose a family.');
 const ages=safe(req.body.ages,140),effectiveDate=req.body.effectiveDate;
 if(!ages||!validDate(effectiveDate))throw Error('Enter the children ages and a valid effective date.');
 const rates={Daytime:toCents(req.body.daytimeRate,true),'Overnight Awake':toCents(req.body.overnightAwakeRate,true),'Overnight Asleep':toCents(req.body.overnightAsleepRate,true)};
 const base={familyId,familyName:family.name,childrenCount:limitInt(req.body.childrenCount,1,20),ages,effectiveDate,rates,notes:safe(req.body.notes,600),createdAt:new Date()};
 // A unique database index prevents duplicate IDs even with concurrent submissions.
 for(let attempt=0;attempt<8;attempt++){
  const rateId=await suggestRateId(family);
  try{
   await db.collection('rates').insertOne({...base,rateId,rateKey:rateId.toLowerCase()});
   return res.status(201).json({ok:true,rateId});
  }catch(error){
   if(error?.code!==11000||attempt===7)throw error;
  }
 }
})));
app.get('/api/shifts',wrap(async(req,res)=>res.json(await db.collection('shifts').find({}).sort({startAt:-1}).limit(800).toArray())));
app.post('/api/shifts',csrf,wrap(async(req,res)=>guard(req,res,async()=>{
 const rateId=id(req.body.rateId),rate=rateId?await db.collection('rates').findOne({_id:rateId}):null;
 if(!rate)throw Error('Choose a rate profile.');
 const serviceType=safe(req.body.serviceType,40),workDate=req.body.workDate,startTime=req.body.startTime,endTime=req.body.endTime;
 if(!SERVICES.includes(serviceType)||!validDate(workDate)||!validTime(startTime)||!validTime(endTime))throw Error('Enter service, date and times.');
 if(workDate<rate.effectiveDate)throw Error('Selected rate was not effective on that date.');
 const result=calculateShift({workDate,startTime,endTime,breakMinutes:req.body.breakMinutes,rateCents:rate.rates[serviceType]});
 const conflict=await db.collection('shifts').findOne({familyId:rate.familyId,startAt:{$lt:result.endAt},endAt:{$gt:result.startAt}});
 if(conflict)throw Error('Shift overlaps an existing entry for this family.');
 await db.collection('shifts').insertOne({familyId:rate.familyId,familyName:rate.familyName,rateId:rate._id,rateCode:rate.rateId,serviceType,workDate,startTime,endTime,breakMinutes:Number(req.body.breakMinutes||0),hourlyRateCents:rate.rates[serviceType],notes:safe(req.body.notes,800),...result,createdAt:new Date()});
 res.status(201).json({ok:true,wageCents:result.wageCents});
})));
app.delete('/api/shifts/:id',csrf,wrap(async(req,res)=>{
 const _id=id(req.params.id);if(!_id)return fail(res,'Invalid ID.');
 const r=await db.collection('shifts').deleteOne({_id});res.json({deleted:r.deletedCount});
}));
const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:8*1024*1024,files:1}}).single('receipt');
const verifyFile=file=>{
 if(!file)return null;
 if(file.mimetype==='application/pdf'&&file.buffer.subarray(0,5).toString()==='%PDF-')return 'application/pdf';
 if(file.mimetype==='image/png'&&file.buffer.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex')))return 'image/png';
 if(file.mimetype==='image/jpeg'&&file.buffer[0]===255&&file.buffer[1]===216&&file.buffer[2]===255)return 'image/jpeg';
 throw Error('Receipt must be PDF, PNG or JPG (8 MB maximum).');
};
app.get('/api/expenses',wrap(async(req,res)=>res.json(await db.collection('expenses').find({}).sort({purchaseDate:-1}).limit(800).toArray())));
app.post('/api/expenses',csrf,upload,wrap(async(req,res)=>{
 let receiptId=null;
 await guard(req,res,async()=>{
  const familyId=id(req.body.familyId),family=familyId?await db.collection('families').findOne({_id:familyId}):null;
  const purchaseDate=req.body.purchaseDate,description=safe(req.body.description,250);
  if(!family||!validDate(purchaseDate)||!description)throw Error('Enter a family, purchase date and description.');
  const amountCents=toCents(req.body.amount);
  const expenseType=safe(req.body.expenseType,70);
  if(!EXPENSE_TYPES.includes(expenseType))throw Error('Choose an expense type.');
  const mime=verifyFile(req.file);
  if(mime){receiptId=new ObjectId();const stream=bucket.openUploadStreamWithId(receiptId,'receipt',{contentType:mime});await new Promise((resolve,reject)=>{stream.on('finish',resolve).on('error',reject);stream.end(req.file.buffer);});}
  await db.collection('expenses').insertOne({familyId,familyName:family.name,purchaseDate,description,amountCents,expenseType,notes:safe(req.body.notes,600),receiptId,createdAt:new Date()});
  res.status(201).json({ok:true});
 });
}));
app.get('/api/receipts/:id',wrap(async(req,res)=>{
 const _id=id(req.params.id);if(!_id)return fail(res,'Invalid receipt.');
 const meta=await db.collection('receipts.files').findOne({_id});if(!meta)return fail(res,'Receipt not found.',404);
 res.set({'Content-Type':meta.contentType||'application/octet-stream','Content-Disposition':'attachment; filename="receipt"','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
 bucket.openDownloadStream(_id).on('error',()=>res.destroy()).pipe(res);
}));
app.delete('/api/expenses/:id',csrf,wrap(async(req,res)=>{
 const _id=id(req.params.id);if(!_id)return fail(res,'Invalid ID.');
 const doc=await db.collection('expenses').findOneAndDelete({_id});
 if(doc?.receiptId)await bucket.delete(doc.receiptId).catch(()=>{});
 res.json({deleted:!!doc});
}));
app.get('/api/dashboard',wrap(async(req,res)=>{
 const [shifts,expenses,payments]=await Promise.all([db.collection('shifts').find({}).toArray(),db.collection('expenses').find({}).toArray(),db.collection('payments').find({}).toArray()]);
 res.json(makeReport(shifts,expenses,payments));
}));
app.post('/api/payment-status',csrf,wrap(async(req,res)=>guard(req,res,async()=>{
 const familyId=id(req.body.familyId),week=req.body.weekOf,status=req.body.status;
 if(!familyId||!validDate(week)||weekOf(week)!==week||!STATUSES.includes(status))throw Error('Invalid family, Monday or status.');
 await db.collection('payments').updateOne({familyId,weekOf:week},{$set:{status,updatedAt:new Date()}},{upsert:true});
 res.json({ok:true});
})));
const csvEscape=s=>{let v=String(s??'');if(/^\s*[=+@-]/.test(v))v="'"+v;return '"'+v.replaceAll('"','""')+'"';};
app.get('/api/export/:type.csv',wrap(async(req,res)=>{
 const type=req.params.type;let headers,rows;
 if(type==='shifts'){
  headers=['Date','Family','Rate IDs','Service','Start','End','Break minutes','Hours','Rate AUD','Wages AUD','Notes','Segment detail'];
  rows=(await db.collection('shifts').find({}).sort({startAt:1}).toArray()).map(s=>[s.workDate,s.familyName,(s.rateCodes||[s.rateCode]).join('; '),s.serviceType,s.startTime,s.endTime,s.breakMinutes,(s.paidMinutes/60).toFixed(2),s.hourlyRateCents==null?'Multiple / flat':(s.hourlyRateCents/100).toFixed(2),(s.wageCents/100).toFixed(2),s.notes,(s.careSegments||[]).map(p=>p.workDate+' '+p.startTime+'-'+p.endTime+' '+p.rateCode).join('; ')]);
 }else if(type==='expenses'){
  headers=['Date','Family','Description','Amount AUD','Expense type','Receipt','Notes'];
  rows=(await db.collection('expenses').find({}).sort({purchaseDate:1}).toArray()).map(e=>[e.purchaseDate,e.familyName,e.description,(e.amountCents/100).toFixed(2),e.expenseType||'Uncategorised',e.receiptId?'Yes':'No',e.notes]);
 }else return fail(res,'Unknown export.',404);
 res.set({'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="nanny-'+type+'.csv"','Cache-Control':'no-store'});
 res.send('\ufeff'+[headers,...rows].map(r=>r.map(csvEscape).join(',')).join('\r\n'));
}));
app.use('/api',(req,res)=>fail(res,'Not found.',404));
app.use(express.static(join(dirname(fileURLToPath(import.meta.url)),'public')));
app.use((err,req,res,next)=>{console.error('Request failed:',err?.name||'error');if(err instanceof multer.MulterError)return fail(res,'Upload exceeds size limit or is invalid.');return fail(res,'Request failed.',500);});
app.listen(Number(process.env.PORT||10000),'0.0.0.0',()=>console.log('Nanny tracker listening'));
