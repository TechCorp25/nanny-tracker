let csrf='',families=[],rates=[],shifts=[],expenses=[],report={weekly:[],monthly:[]};
const $=id=>document.getElementById(id);
const money=n=>new Intl.NumberFormat('en-AU',{style:'currency',currency:'AUD'}).format((n||0)/100);
const safe=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const dateNow=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Australia/Melbourne',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const notice=(message,isError=false)=>{const el=$('message');el.textContent=message;el.classList.remove('hidden');el.classList.toggle('error',isError);};
async function api(path,{method='GET',data=null,form=false}={}){
 const headers={};
 if(csrf&&method!=='GET')headers['X-CSRF-Token']=csrf;
 if(data&&!form)headers['Content-Type']='application/json';
 const response=await fetch('/api/'+path,{method,headers,body:data?(form?data:JSON.stringify(data)):undefined,credentials:'same-origin'});
 const body=await response.json().catch(()=>({}));
 if(!response.ok)throw Error(body.error||'Request failed ('+response.status+')');
 return body;
}
const payload=form=>Object.fromEntries(new FormData(form).entries());
async function load(){
 const [f,r,s,e,d]=await Promise.all([api('families'),api('rates'),api('shifts'),api('expenses'),api('dashboard')]);
 families=f;rates=r;shifts=s;expenses=e;report=d;
 draw();
}
function show(tab){
 for(const el of document.querySelectorAll('.view'))el.classList.toggle('hidden',el.id!==tab);
 for(const btn of document.querySelectorAll('.tabs button'))btn.classList.toggle('active',btn.dataset.tab===tab);
}
function selectOptions(id,items,key,label){
 const el=$(id),previous=el.value;el.replaceChildren();
 const empty=document.createElement('option');empty.value='';empty.textContent='Choose…';el.append(empty);
 for(const item of items){const opt=document.createElement('option');opt.value=item[key];opt.textContent=label(item);el.append(opt);}
 if([...el.options].some(o=>o.value===previous))el.value=previous;
}
function emptyRows(id,count,message){
 const row=document.createElement('tr');const cell=document.createElement('td');cell.colSpan=count;cell.className='empty';cell.textContent=message;row.append(cell);$(id).replaceChildren(row);
}
function tableRows(id,rows,columnCount,render){
 const body=$(id);body.replaceChildren();
 if(!rows.length)return emptyRows(id,columnCount,'No entries yet.');
 for(const data of rows){const tr=document.createElement('tr');tr.innerHTML=render(data);body.append(tr);}
}
let ratePreviewRequest=0;
async function refreshRateIdPreview(){
 const input=$('rate-id-preview'),familyId=$('rate-family').value;
 const request=++ratePreviewRequest;
 if(!familyId){input.value='Choose a family';return;}
 input.value='Generating…';
 try{
  const result=await api('rates/next-id?familyId='+encodeURIComponent(familyId));
  if(request===ratePreviewRequest)input.value=result.rateId;
 }catch(error){
  if(request===ratePreviewRequest)input.value='Unavailable: '+error.message;
 }
}
function draw(){
 selectOptions('shift-rate',rates.filter(r=>r.rates),'_id',r=>r.familyName+' · '+r.rateId+' ('+r.ages+')');
 selectOptions('rate-family',families,'_id',f=>f.name);
 void refreshRateIdPreview();
 selectOptions('expense-family',families,'_id',f=>f.name);
 $('family-list').innerHTML=families.length?'<ul>'+families.map(f=>'<li>'+safe(f.name)+'</li>').join('')+'</ul>':'<p class="muted">No families added yet.</p>';
 tableRows('rate-rows',rates,8,r=>'<td>'+safe(r.rateId)+'</td><td>'+safe(r.familyName)+'</td><td>'+safe(r.childrenCount)+'</td><td>'+safe(r.ages)+'</td><td>'+money(r.rates?.Daytime)+'</td><td>'+money(r.rates?.['Overnight Awake'])+'</td><td>'+money(r.rates?.['Overnight Asleep'])+'</td><td>'+safe(r.effectiveDate)+'</td>');
 tableRows('work-rows',shifts,8,s=>'<td>'+safe(s.workDate)+'</td><td>'+safe(s.familyName)+'</td><td>'+safe(s.serviceType)+'</td><td>'+safe(s.startTime)+'–'+safe(s.endTime)+'</td><td>'+safe((s.paidMinutes/60).toFixed(2))+'</td><td>'+money(s.hourlyRateCents)+'</td><td>'+money(s.wageCents)+'</td><td><button class="danger tiny remove" data-kind="shifts" data-id="'+safe(s._id)+'">Delete</button></td>');
 tableRows('expense-rows',expenses,6,e=>'<td>'+safe(e.purchaseDate)+'</td><td>'+safe(e.familyName)+'</td><td>'+safe(e.description)+'</td><td>'+money(e.amountCents)+'</td><td>'+(e.receiptId?'<a href="/api/receipts/'+safe(e.receiptId)+'">Download</a>':'—')+'</td><td><button class="danger tiny remove" data-kind="expenses" data-id="'+safe(e._id)+'">Delete</button></td>');
 tableRows('weekly-rows',report.weekly||[],7,r=>'<td>'+safe(r.period)+'</td><td>'+safe(r.familyName)+'</td><td>'+safe(r.paidHours.toFixed(2))+'</td><td>'+money(r.wagesCents)+'</td><td>'+money(r.expensesCents)+'</td><td><strong>'+money(r.totalCents)+'</strong></td><td><select class="status" data-id="'+safe(r.familyId)+'" data-week="'+safe(r.period)+'">'+['Unpaid','Partially Paid','Paid'].map(x=>'<option'+(r.status===x?' selected':'')+'>'+x+'</option>').join('')+'</select></td>');
 tableRows('monthly-rows',report.monthly||[],6,r=>'<td>'+safe(r.period)+'</td><td>'+safe(r.familyName)+'</td><td>'+safe(r.paidHours.toFixed(2))+'</td><td>'+money(r.wagesCents)+'</td><td>'+money(r.expensesCents)+'</td><td><strong>'+money(r.totalCents)+'</strong></td>');
 const totals=(report.weekly||[]).reduce((a,r)=>({w:a.w+r.wagesCents,e:a.e+r.expensesCents,h:a.h+r.paidHours}),{w:0,e:0,h:0});
 $('totals').innerHTML='<div class="metric"><span>Logged paid hours</span><strong>'+totals.h.toFixed(2)+'</strong></div><div class="metric"><span>Base wages</span><strong>'+money(totals.w)+'</strong></div><div class="metric"><span>Reimbursements</span><strong>'+money(totals.e)+'</strong></div><div class="metric"><span>Total payment</span><strong>'+money(totals.w+totals.e)+'</strong></div>';
 if(typeof window.renderCareEnhancements==='function')void window.renderCareEnhancements();
}
async function submit(form,endpoint,asForm=false){
 const btn=form.querySelector('[type=submit]');btn.disabled=true;
 const newFamilyName=endpoint==='families'?form.elements.namedItem('name').value.trim():null;
 try{
  const result=await api(endpoint,{method:'POST',data:asForm?new FormData(form):payload(form),form:asForm});
  form.reset();
  const today=dateNow();
  for(const inp of form.querySelectorAll('input[type=date]'))inp.value=today;
  notice(endpoint==='rates'&&result.rateId?'Rate profile '+result.rateId+' saved.':'Entry saved.');
  await load();
  if(newFamilyName){
   const family=families.find(f=>f.name.toLowerCase()===newFamilyName.toLowerCase());
   if(family){$('rate-family').value=family._id;await refreshRateIdPreview();}
  }
 }catch(e){notice(e.message,true);}finally{btn.disabled=false;}
}
function attach(){
 for(const btn of document.querySelectorAll('.tabs button'))btn.addEventListener('click',()=>show(btn.dataset.tab));
 $('refresh').addEventListener('click',()=>load().then(()=>notice('Updated.')).catch(e=>notice(e.message,true)));
 $('family-form').addEventListener('submit',e=>{e.preventDefault();submit(e.currentTarget,'families');});
 $('rate-form').addEventListener('submit',e=>{e.preventDefault();submit(e.currentTarget,'rates');});
 $('rate-family').addEventListener('change',()=>refreshRateIdPreview());
 $('work-form').addEventListener('submit',e=>{e.preventDefault();submit(e.currentTarget,'shifts');});
 $('expense-form').addEventListener('submit',e=>{e.preventDefault();submit(e.currentTarget,'expenses',true);});
 document.addEventListener('click',async e=>{
  if(!e.target.matches('button.remove'))return;
  const {kind,id}=e.target.dataset;
  if(!confirm('Delete this record permanently?'))return;
  try{await api(kind+'/'+id,{method:'DELETE'});notice('Entry deleted.');await load();}
  catch(err){notice(err.message,true);}
 });
 document.addEventListener('change',async e=>{
  if(!e.target.matches('select.status'))return;
  const el=e.target;
  try{await api('payment-status',{method:'POST',data:{familyId:el.dataset.id,weekOf:el.dataset.week,status:el.value}});notice('Payment status saved.');await load();}
  catch(err){notice(err.message,true);}
 });
 $('logout').addEventListener('click',async()=>{
  try{await api('logout',{method:'POST'});location.reload();}catch(e){notice(e.message,true);}
 });
 $('login-form').addEventListener('submit',async e=>{
  e.preventDefault();const form=e.currentTarget,btn=form.querySelector('button');btn.disabled=true;
  try{const r=await api('login',{method:'POST',data:payload(form)});csrf=r.csrf;await activate();}
  catch(err){notice(err.message,true);}finally{btn.disabled=false;}
 });
}
async function activate(){
 $('login-panel').classList.add('hidden');
 $('application').classList.remove('hidden');$('logout').classList.remove('hidden');
 await load();
}
async function init(){
 attach();
 for(const inp of document.querySelectorAll('input[type=date]'))inp.value=dateNow();
 try{
  const s=await api('session');csrf=s.csrf||'';
  if(s.authenticated)await activate();
 }catch(e){notice(e.message,true);}
}
init();
