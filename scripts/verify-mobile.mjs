// Real Express routes + disposable MongoDB replica set; no production data.
import {MongoMemoryReplSet} from 'mongodb-memory-server';
import {MongoClient,ObjectId} from 'mongodb';
import {chromium,expect} from '@playwright/test';
import {spawn} from 'node:child_process';
import bcrypt from 'bcryptjs';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
const replica=await MongoMemoryReplSet.create({binary:{version:'7.0.14'},replSet:{count:1,args:['--nounixsocket']}});
const client=new MongoClient(replica.getUri());await client.connect();
const db=client.db('mobile_verify');
const fid=new ObjectId(),kid=new ObjectId(),extra=new ObjectId(),rid=new ObjectId(),legacy=new ObjectId();
await db.collection('families').insertOne({_id:fid,name:'Smith family',nameKey:'smith family'});
await db.collection('children').insertMany([{_id:kid,familyId:fid,name:'Clementne',nameKey:'clementne'},{_id:extra,familyId:fid,name:'Accidental child',nameKey:'accidental child'}]);
await db.collection('expenses').insertOne({familyId:fid,familyName:'Smith family',purchaseDate:'2026-10-20',description:'A very long description of art materials, lunch and supplies for the children on their afternoon outing',amountCents:1250,expenseType:'Childcare supplies'});
await db.collection('rates').insertMany([{_id:rid,familyId:fid,familyName:'Smith family',childIds:[kid],childrenSnapshot:[{childId:kid,name:'Clementne'}],rateId:'clem-010126',rateKey:'clem-010126',serviceType:'Daytime',rateCents:3000,billingUnit:'hour',effectiveDate:'2026-01-01'}, {_id:legacy,familyId:fid,familyName:'Smith family',rateId:'SMITH-001',rateKey:'smith-001',rates:{Daytime:3000,'Overnight Awake':3500,'Overnight Asleep':1500},effectiveDate:'2026-01-01',ages:'2 and 6 years'}]);
let logs='';const server=spawn(process.execPath,['server.js'],{env:{...process.env,MONGODB_URI:replica.getUri(),MONGODB_DB:'mobile_verify',ADMIN_EMAIL:'test@example.com',ADMIN_PASSWORD_HASH:await bcrypt.hash('local-test-only',4),SESSION_SECRET:'local-verification-session-secret-only-12345',PORT:'4317',NODE_ENV:'test'}});
server.stdout.on('data',b=>logs+=b);server.stderr.on('data',b=>logs+=b);
const errors=[],checks=[];
try{
 for(let i=0;i<100;i++){try{if((await fetch('http://127.0.0.1:4317/healthz')).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
 for(const [engine,browserType] of [['chromium',chromium]]){
  const browser=await browserType.launch({headless:true});
  try{
   const context=await browser.newContext({viewport:{width:375,height:812},deviceScaleFactor:3,isMobile:true,hasTouch:true});
   const page=await context.newPage();page.setDefaultTimeout(12000);console.log(engine+': signed-in workflow starting');page.on('pageerror',e=>errors.push(engine+': '+e.message));
   await page.goto('http://127.0.0.1:4317');
   await page.locator('[name=email]').fill('test@example.com');await page.locator('[name=password]').fill('local-test-only');await page.locator('#login-form button').click();
   await page.locator('#application').waitFor({state:'visible'});await expect.poll(()=>page.locator('.edit-family').count()).toBe(2);
   const call=(path,data,method='POST')=>page.evaluate(async({path,data,method})=>api(path,{method,data}),{path,data,method});
   const shift={familyId:String(fid),segments:[{rateId:String(rid),childIds:[String(kid)],workDate:engine==='chromium'?'2026-10-20':'2026-10-21',startTime:'09:00',endTime:'10:00',breakMinutes:0}]};
   if(engine==='chromium'){
    await call('shifts/v2',shift);console.log('Seed shift saved');
    const snapshots=JSON.stringify(await db.collection('rates').find({}).toArray());
    const historical=JSON.stringify(await db.collection('shifts').find({}).toArray());
    const expensesBefore=JSON.stringify(await db.collection('expenses').find({}).toArray());
    const totalsBefore=await call('dashboard',null,'GET');
    await page.locator('[data-tab=profiles]').click();await page.locator('.edit-family').first().click();
    await page.locator('#edit-family-name').fill('Smith & Jones family');await page.locator('[data-id="'+kid+'"] .edit-child-name').fill('Clementine');
    await page.locator('[data-id="'+extra+'"] .edit-child-status').selectOption('removed');
    await page.setViewportSize({width:812,height:375});assert.equal(await page.locator('#edit-family-name').inputValue(),'Smith & Jones family');
    await page.locator('#family-edit-form [type=submit]').click();console.log('Family save requested');await page.locator('#family-dialog').waitFor({state:'hidden'});
    assert.equal(JSON.stringify(await db.collection('rates').find({}).toArray()),snapshots);assert.equal(JSON.stringify(await db.collection('shifts').find({}).toArray()),historical);
    assert.equal((await db.collection('children').findOne({_id:kid})).name,'Clementine');assert.equal((await db.collection('children').findOne({_id:extra})).removed,true);
    const detail=await call('families/'+fid,null,'GET');
    const edit={name:detail.name,revision:detail.revision,children:detail.children.map(c=>({id:c._id,name:c.name,status:c._id===String(kid)?'archived':'removed'}))};
    await call('families/'+fid,edit,'PATCH');console.log('Family API edit saved');
    await assert.rejects(()=>call('shifts/v2',{...shift,segments:shift.segments.map(s=>({...s,workDate:'2026-10-22'}))}),/archived/);
    await assert.rejects(()=>call('families/'+fid,edit,'PATCH'),/another window/);
    edit.revision++;edit.children.find(c=>c.id===String(kid)).status='active';await call('families/'+fid,edit,'PATCH');console.log('Family API edit saved');
    assert.equal(JSON.stringify(await db.collection('rates').find({}).toArray()),snapshots);assert.equal(JSON.stringify(await db.collection('shifts').find({}).toArray()),historical);
    assert.equal(JSON.stringify(await db.collection('expenses').find({}).toArray()),expensesBefore);assert.deepEqual(await call('dashboard',null,'GET'),totalsBefore);
    const beforeInvalid=JSON.stringify(await db.collection('families').findOne({_id:fid}));
    await assert.rejects(()=>call('families/'+fid,{...edit,revision:edit.revision+1,children:edit.children.map(c=>({...c,name:'Duplicate'}))},'PATCH'),/distinct/);
    assert.equal(JSON.stringify(await db.collection('families').findOne({_id:fid})),beforeInvalid);
    checks.push('Real Mongo transactions: rename, unlinked removal, archive, restore, stale-edit rejection, archived-profile rejection; rate and shift documents unchanged.');
   }
   await page.evaluate(()=>load());
   for(const [label,width,height] of [['portrait',375,812],['landscape',812,375],['keyboard',375,390],['desktop',1440,900]]){
    await page.setViewportSize({width,height});
    console.log(engine+' '+label);
    for(const tab of ['dashboard','profiles','work','expenses']){
     await page.locator('[data-tab='+tab+']').click();
     if(tab==='work'){
      await page.locator('#multi-family').selectOption(String(fid));await page.locator('.seg-child').first().check();await page.locator('.seg-rate').selectOption(String(rid));
      await page.locator('.seg-start').fill('11:00');await page.locator('.seg-end').fill('12:00');
     }
     if(tab==='profiles'){
      await page.locator('#new-rate-family').selectOption(String(fid));await page.locator('#profile-child-options input').first().check();
     }
     if(tab==='expenses'){
      await page.locator('#expense-family').selectOption(String(fid));await page.locator('[name=description]').fill('Art materials and snacks for an afternoon at the park');
      await page.locator('[name=amount]').fill('12.50');await page.locator('[name=expenseType]').selectOption('Childcare supplies');
      await page.locator('#receipt-camera').setInputFiles({name:'receipt.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a/p8AAAAASUVORK5CYII=','base64')});
     }
     const overflow=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,controls:[...document.querySelectorAll('input,select,textarea,button')].filter(el=>el.getClientRects().length&&el.getBoundingClientRect().right>innerWidth+1).map(el=>el.id||el.className)}));
     assert.ok(overflow.scroll<=width+1,engine+' '+label+' '+tab+' overflow '+JSON.stringify(overflow));assert.deepEqual(overflow.controls,[],engine+' '+label+' '+tab);
     if(label!=='keyboard')await page.screenshot({path:'audit/screenshots/'+engine+'-'+label+'-'+tab+'.png',fullPage:true});
    }
    await page.locator('[data-tab=profiles]').click();await page.locator('.edit-family').first().click();
    assert.ok(await page.locator('#family-dialog').evaluate(el=>el.scrollWidth<=el.clientWidth+1));
    await page.locator('#edit-family-name').fill('Unsaved rotation check');await page.locator('#family-edit-cancel').scrollIntoViewIfNeeded();await page.locator('#family-edit-cancel').click();
    assert.equal((await db.collection('families').findOne({_id:fid})).name,'Smith & Jones family');
    checks.push(engine+' '+label+' '+width+'×'+height+': four views, controls, family dialog and cancel passed');
   }
   await page.setViewportSize({width:375,height:812});await page.locator('.edit-family').first().click();await page.screenshot({path:'audit/screenshots/'+engine+'-family-editor.png'});await page.locator('#family-edit-form [type=submit]').scrollIntoViewIfNeeded();await page.screenshot({path:'audit/screenshots/'+engine+'-family-editor-actions.png'});await page.locator('#family-edit-cancel').click();
   await page.locator('[data-tab=expenses]').click();await page.locator('#expense-save').click();await expect(page.locator('#message')).toHaveText('Expense saved.');assert.ok(await db.collection('expenses').findOne({receiptId:{$exists:true}}));
   await page.locator('[data-tab=work]').click();await page.locator('#multi-date').fill(engine==='chromium'?'2026-10-23':'2026-10-24');await page.locator('#multi-date').dispatchEvent('change');await page.locator('#multi-work-form [type=submit]').click();await expect(page.locator('#message')).toContainText('Shift saved.');
   // The consolidated form must also accept an existing legacy rate.
   await page.locator('#multi-date').fill('2026-10-25');await page.locator('#multi-date').dispatchEvent('change');
   await page.locator('.seg-rate').selectOption(String(legacy));await page.locator('.seg-service').selectOption('Overnight Asleep');
   await page.locator('.seg-start').fill('22:00');await page.locator('.seg-end').fill('23:00');
   await page.locator('#add-segment').click();await page.locator('.seg-rate').nth(1).selectOption(String(legacy));await page.locator('.seg-service').nth(1).selectOption('Overnight Awake');await page.locator('.seg-end').nth(1).fill('23:30');
   await page.locator('#multi-work-form [type=submit]').click();await expect(page.locator('#message')).toContainText('Total wages: $32.50');
   await page.locator('[data-tab=profiles]').click();await page.locator('.edit-family').first().click();await page.locator('#edit-add-child').click();await page.locator('.edit-child-name').last().fill('Oliver');await page.locator('#family-edit-form [type=submit]').click();await expect(page.locator('#family-dialog')).not.toBeVisible();
   for(const checkbox of await page.locator('#profile-child-options input').all())await checkbox.check();await page.locator('#new-rate-service').selectOption('Overnight Awake');await page.locator('#new-rate-amount').fill('40');await page.locator('#new-rate-form [type=submit]').click();await expect(page.locator('#message')).toContainText('Saved rate profile');
   assert.ok(await db.collection('rates').findOne({childrenCount:2,rateCents:4000}));
   await page.locator('[data-tab=expenses]').click();await page.locator('.edit-expense').first().click();await page.locator('[name=expenseType]').selectOption('Food and meals');await page.locator('#expense-save').click();await expect(page.locator('#message')).toHaveText('Expense saved.');
   await page.locator('#report-run').click();await expect(page.locator('#report-results')).toContainText('Total reimbursements');
   const download=await context.request.get('http://127.0.0.1:4317/api/export/shifts.csv');assert.equal(download.status(),200);
   checks.push(engine+': UI expense save with receipt, expense edit, category report, child addition, combination rate creation, segmented and legacy shift saves, CSV export succeeded');
  }finally{await browser.close();}
 }
 assert.deepEqual(errors,[]);await writeFile('audit/verification.json',JSON.stringify({checks,errors},null,2));console.log(checks.join('\n'));
}finally{server.kill();await client.close();await replica.stop();if(errors.length)console.error(errors);if(logs.includes('Error'))console.error(logs);}
