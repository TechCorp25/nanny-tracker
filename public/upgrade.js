/* Child-specific rates, segmented shifts, receipt capture, optional category reporting. */
let careChildren=[],receiptFile=null,receiptURL='',editingExpense=null,previewSequence=0,enhancementsReady=false;
const c=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"']/g,x=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x]));
const selected=el=>[...el.querySelectorAll('input[type=checkbox]:checked')].map(x=>x.value);
const familyChildren=id=>careChildren.filter(x=>String(x.familyId)===String(id));
const childNames=r=>(r.childrenSnapshot||[]).map(x=>x.name).join(' + ')||r.ages||'Legacy: children not specified';
const rateText=r=>r.rateCents!=null?money(r.rateCents)+(r.billingUnit==='segment'?' / segment':' / hour'):Object.entries(r.rates||{}).map(([k,v])=>k+': '+money(v)+'/hour').join(' · ');
const rateLabel=r=>childNames(r)+' · '+(r.serviceType||'Legacy all services')+' · '+rateText(r)+' · '+r.rateId;
function options(element,values,label,empty='Choose…'){
 const previous=element.value;element.replaceChildren(new Option(empty,''));
 for(const v of values)element.add(new Option(label(v),String(v._id)));
 if([...element.options].some(o=>o.value===previous))element.value=previous;
}
function boxes(familyId,chosen=[],className='child-choice'){
 return familyChildren(familyId).map(x=>'<label class="check-option"><input type="checkbox" class="'+className+'" value="'+esc(x._id)+'" '+(chosen.includes(String(x._id))?'checked':'')+'><span>'+esc(x.name)+'</span></label>').join('')||'<p class="muted">Add children for this family first.</p>';
}
function setUpCare(){
 if(enhancementsReady)return;enhancementsReady=true;
 for(const id of ['new-rate-date','multi-date','report-date'])c(id).value=dateNow();
 c('new-rate-family').addEventListener('change',()=>{renderRateChildren();previewCode();});
 c('new-rate-date').addEventListener('change',previewCode);
 c('profile-child-options').addEventListener('change',previewCode);
 c('child-family').addEventListener('change',renderChildList);
 c('child-entry').addEventListener('submit',saveChild);
 c('new-rate-form').addEventListener('submit',saveNewProfile);
 c('legacy-rate-toggle').addEventListener('click',()=>{
  const hidden=c('rate-form').classList.toggle('hidden');
  c('legacy-rate-toggle').textContent=hidden?'Show legacy rate form':'Hide legacy rate form';
 });
 c('legacy-shift-toggle').addEventListener('click',()=>{
  const hidden=c('work-form').classList.toggle('hidden');
  c('legacy-shift-toggle').textContent=hidden?'Show legacy single-rate form':'Hide legacy single-rate form';
 });
 c('multi-family').addEventListener('change',refreshSegments);
 c('multi-date').addEventListener('change',refreshSegments);
 c('add-segment').addEventListener('click',addSegment);
 c('multi-work-form').addEventListener('submit',saveMultiShift);
 c('multi-segments').addEventListener('click',e=>{
  if(e.target.matches('.segment-remove')){e.target.closest('.segment').remove();renumberSegments();}
 });
 c('multi-segments').addEventListener('change',e=>{
  const section=e.target.closest('.segment');if(!section)return;
  if(e.target.matches('.seg-child'))updateSegmentProfiles(section);
  if(e.target.matches('.seg-rate'))describeSegment(section);
 });
 for(const inputId of ['receipt-upload','receipt-camera'])
  c(inputId).addEventListener('change',e=>useReceipt(e.target.files[0]));
 c('remove-receipt').addEventListener('click',clearReceipt);
 c('expense-cancel').addEventListener('click',cancelEditExpense);
 c('expense-form').addEventListener('submit',saveCareExpense,true);
 c('expense-rows').addEventListener('click',e=>{
  const button=e.target.closest('.edit-expense');
  if(button){const item=expenses.find(x=>String(x._id)===button.dataset.id);if(item)editCareExpense(item);}
 });
 c('report-period').addEventListener('change',()=>c('report-date-wrap').classList.toggle('hidden',c('report-period').value==='all'));
 c('report-run').addEventListener('click',showCategoryReport);
 addSegment();
}
function renderChildList(){
 c('children-list').innerHTML=familyChildren(c('child-family').value).map(x=>'<span class="child-chip">'+esc(x.name)+'</span>').join('');
}
function renderRateChildren(){
 const prior=selected(c('profile-child-options'));
 c('profile-child-options').innerHTML=boxes(c('new-rate-family').value,prior);
}
async function previewCode(){
 const familyId=c('new-rate-family').value;
 const childIds=selected(c('profile-child-options')),effectiveDate=c('new-rate-date').value;
 const seq=++previewSequence;
 if(!familyId||!childIds.length||!effectiveDate){c('new-rate-code').value='Select family, children and date';return;}
 c('new-rate-code').value='Generating…';
 try{
  const out=await api('rates/preview-v2',{method:'POST',data:{familyId,childIds,effectiveDate}});
  if(seq===previewSequence)c('new-rate-code').value=out.rateId;
 }catch(e){if(seq===previewSequence)c('new-rate-code').value=e.message;}
}
async function saveChild(e){
 e.preventDefault();const btn=e.currentTarget.querySelector('[type=submit]');btn.disabled=true;
 try{
  await api('children',{method:'POST',data:{familyId:c('child-family').value,name:c('child-name').value}});
  c('child-name').value='';notice('Child added.');await load();
 }catch(error){notice(error.message,true);}finally{btn.disabled=false;}
}
async function saveNewProfile(e){
 e.preventDefault();const btn=e.currentTarget.querySelector('[type=submit]');btn.disabled=true;
 try{
  const out=await api('rates/v2',{method:'POST',data:{
   familyId:c('new-rate-family').value,childIds:selected(c('profile-child-options')),
   effectiveDate:c('new-rate-date').value,serviceType:c('new-rate-service').value,
   rate:c('new-rate-amount').value,billingUnit:c('new-rate-unit').value,
   ages:c('new-rate-ages').value,notes:c('new-rate-notes').value
  }});
  notice('Saved rate profile '+out.rateId+'.');c('new-rate-amount').value='';await load();
 }catch(error){notice(error.message,true);}finally{btn.disabled=false;}
}
function addSegment(){
 const holder=c('multi-segments'),prior=holder.lastElementChild;
 let day=prior?.querySelector('.seg-date')?.value||c('multi-date').value||dateNow();
 const oldStart=prior?.querySelector('.seg-start')?.value,oldEnd=prior?.querySelector('.seg-end')?.value;
 if(oldStart&&oldEnd&&oldEnd<=oldStart){
  const dt=new Date(day+'T12:00:00Z');dt.setUTCDate(dt.getUTCDate()+1);day=dt.toISOString().slice(0,10);
 }
 const section=document.createElement('section');section.className='segment';
 section.innerHTML='<div class="segment-heading"><h3>Segment</h3><button class="secondary small segment-remove" type="button">Remove segment</button></div>'+
 '<fieldset class="child-fieldset"><legend>Children for this segment</legend><div class="segment-child-options checkbox-grid"></div></fieldset>'+
 '<div class="form-grid">'+
 '<label>Work date<input class="seg-date" type="date" required></label>'+
 '<label>Rate profile<select class="seg-rate" required></select></label>'+
 '<label>Start time<input class="seg-start" type="time" required></label>'+
 '<label>End time<input class="seg-end" type="time" required></label>'+
 '<label>Unpaid break (minutes)<input class="seg-break" min="0" step="1" type="number" value="0" required></label></div>'+
 '<p class="segment-description muted"></p>';
 holder.append(section);section.querySelector('.seg-date').value=day;
 if(oldEnd)section.querySelector('.seg-start').value=oldEnd;
 section.querySelector('.segment-child-options').innerHTML=boxes(c('multi-family').value,[],'seg-child');
 updateSegmentProfiles(section);renumberSegments();
}
function renumberSegments(){
 for(const [i,section] of [...c('multi-segments').children].entries()){
  section.querySelector('h3').textContent='Segment '+(i+1);
  section.querySelector('.segment-remove').disabled=c('multi-segments').children.length<=1;
 }
}
function refreshSegments(){
 for(const section of c('multi-segments').children){
  const prior=selected(section.querySelector('.segment-child-options'));
  section.querySelector('.segment-child-options').innerHTML=boxes(c('multi-family').value,prior,'seg-child');
  updateSegmentProfiles(section);
 }
}
function updateSegmentProfiles(section){
 const familyId=c('multi-family').value,kids=selected(section.querySelector('.segment-child-options')).sort();
 const matching=rates.filter(r=>{
  if(String(r.familyId)!==familyId)return false;
  const ids=(r.childIds||[]).map(String).sort();
  return ids.length?JSON.stringify(ids)===JSON.stringify(kids):!kids.length;
 });
 options(section.querySelector('.seg-rate'),matching,rateLabel,'Choose matching rate profile…');describeSegment(section);
}
function describeSegment(section){
 const rate=rates.find(r=>String(r._id)===section.querySelector('.seg-rate').value);
 section.querySelector('.segment-description').textContent=rate?
  (rate.serviceType||'Legacy rate')+' · '+rateText(rate)+' · '+rate.rateId:
  'Select children and a matching saved rate profile. For legacy profiles, leave children unchecked.';
}
async function saveMultiShift(e){
 e.preventDefault();const btn=e.currentTarget.querySelector('[type=submit]');btn.disabled=true;
 const segments=[...c('multi-segments').children].map(x=>({
  workDate:x.querySelector('.seg-date').value,rateId:x.querySelector('.seg-rate').value,
  childIds:selected(x.querySelector('.segment-child-options')),startTime:x.querySelector('.seg-start').value,
  endTime:x.querySelector('.seg-end').value,breakMinutes:x.querySelector('.seg-break').value
 }));
 try{
  const result=await api('shifts/v2',{method:'POST',data:{familyId:c('multi-family').value,notes:c('multi-notes').value,segments}});
  notice('Shift saved. Total wages: '+money(result.wageCents)+'.');
  c('multi-notes').value='';c('multi-segments').replaceChildren();addSegment();await load();
 }catch(error){notice(error.message,true);}finally{btn.disabled=false;}
}
function clearReceipt(){
 receiptFile=null;if(receiptURL)URL.revokeObjectURL(receiptURL);receiptURL='';
 c('receipt-upload').value='';c('receipt-camera').value='';
 c('receipt-preview').textContent='No receipt selected.';c('remove-receipt').classList.add('hidden');
}
function useReceipt(file){
 if(!file)return;
 if(!['application/pdf','image/jpeg','image/png'].includes(file.type)){
  clearReceipt();notice('Unsupported receipt. Choose PDF, JPG or PNG.',true);return;
 }
 if(file.size>8*1024*1024){
  clearReceipt();notice('Receipt exceeds the 8 MB limit.',true);return;
 }
 clearReceipt();receiptFile=file;receiptURL=URL.createObjectURL(file);
 const host=c('receipt-preview');host.replaceChildren();
 const label=document.createElement('p');label.textContent=file.name+' ('+(file.size/1024/1024).toFixed(2)+' MB)';host.append(label);
 if(file.type.startsWith('image/')){
  const image=document.createElement('img');image.src=receiptURL;image.alt='Selected receipt preview';host.append(image);
 }else{
  const a=document.createElement('a');a.href=receiptURL;a.target='_blank';a.rel='noopener noreferrer';a.textContent='Preview selected PDF';host.append(a);
 }
 c('remove-receipt').classList.remove('hidden');
}
function cancelEditExpense(){
 editingExpense=null;const form=c('expense-form');form.reset();form.elements.purchaseDate.value=dateNow();
 c('receipt-camera').disabled=false;c('receipt-upload').disabled=false;clearReceipt();
 c('expense-save').textContent='Save expense';c('expense-cancel').classList.add('hidden');
}
function editCareExpense(item){
 editingExpense=String(item._id);const form=c('expense-form');
 for(const key of ['familyId','purchaseDate','description','notes'])if(form.elements[key])
  form.elements[key].value=String(item[key]??'');
 form.elements.amount.value=(item.amountCents/100).toFixed(2);
 form.elements.expenseType.value=item.expenseType||'';
 clearReceipt();c('receipt-camera').disabled=true;c('receipt-upload').disabled=true;
 c('receipt-preview').textContent='Editing expense details. Any previously saved receipt remains attached.';
 c('expense-save').textContent='Save expense changes';c('expense-cancel').classList.remove('hidden');
 form.scrollIntoView({behavior:'smooth',block:'start'});
 notice(item.expenseType?'Expense ready to edit.':'Uncategorised expense: select a type before saving.');
}
async function saveCareExpense(e){
 e.preventDefault();e.stopImmediatePropagation();
 const form=e.currentTarget,btn=c('expense-save');btn.disabled=true;
 try{
  const data=new FormData(form);
  if(editingExpense){
   await api('expenses/'+encodeURIComponent(editingExpense),{method:'PATCH',data:Object.fromEntries(data.entries())});
  }else{
   data.delete('receipt');if(receiptFile)data.append('receipt',receiptFile,receiptFile.name);
   await api('expenses',{method:'POST',data,form:true});
  }
  cancelEditExpense();await load();notice('Expense saved.');
 }catch(error){notice(error.message,true);}finally{btn.disabled=false;}
}
async function showCategoryReport(){
 const familyId=c('report-family').value,period=c('report-period').value;
 let start=c('report-date').value||dateNow();
 if(period==='month')start=start.slice(0,7)+'-01';
 if(period==='week'){
  const d=new Date(start+'T12:00:00Z');d.setUTCDate(d.getUTCDate()-(d.getUTCDay()+6)%7);start=d.toISOString().slice(0,10);
 }
 const host=c('report-results');host.textContent='Loading…';
 try{
  const report=await api('expenses/report?'+new URLSearchParams({familyId,period,start}));
  host.replaceChildren();
  const title=document.createElement('p');title.textContent='Total reimbursements: '+money(report.totalCents);title.className='report-total';host.append(title);
  const list=document.createElement('ul');
  for(const row of report.items){const li=document.createElement('li');li.textContent=row.name+' — '+money(row.amountCents);list.append(li);}
  if(report.items.length)host.append(list);else host.append('No expenses for this selection.');
 }catch(error){host.textContent=error.message;}
}
function renderEnhancedTables(){
 const history=c('profile-cards');
 history.innerHTML=rates.map(r=>'<article class="profile-tile"><strong>'+esc(childNames(r))+'</strong><span>'+esc(r.serviceType||'Legacy: multiple services')+'</span><b>'+esc(rateText(r))+'</b><code>'+esc(r.rateId)+'</code><small>'+esc(r.familyName)+' · Effective '+esc(r.effectiveDate)+'</small></article>').join('')||'<p class="muted">No rate profiles yet.</p>';
 const table=c('rate-rows').closest('table');
 table.querySelector('thead tr').innerHTML='<th>Rate ID</th><th>Family</th><th>Children</th><th>Service type</th><th>Rate</th><th>Effective</th>';
 c('rate-rows').innerHTML=rates.map(r=>'<tr><td><code>'+esc(r.rateId)+'</code></td><td>'+esc(r.familyName)+'</td><td>'+esc(childNames(r))+'</td><td>'+esc(r.serviceType||'Legacy: multiple')+'</td><td>'+esc(rateText(r))+'</td><td>'+esc(r.effectiveDate)+'</td></tr>').join('')||'<tr><td class="empty" colspan="6">No rate profiles yet.</td></tr>';
 const oneDetail=s=>{
  const parts=s.careSegments?.length?s.careSegments:[{
   rateCode:s.rateCode,serviceType:s.serviceType,workDate:s.workDate,startTime:s.startTime,
   endTime:s.endTime,wageCents:s.wageCents,childrenSnapshot:[]
  }];
  return '<details><summary>View '+parts.length+' segment'+(parts.length===1?'':'s')+'</summary><ul>'+
   parts.map(p=>'<li>'+esc(p.workDate)+' '+esc(p.startTime)+'–'+esc(p.endTime)+' · '+esc((p.childrenSnapshot||[]).map(x=>x.name).join(', ')||'Legacy')+' · '+esc(p.serviceType)+' · <code>'+esc(p.rateCode)+'</code> · '+esc(money(p.wageCents))+'</li>').join('')+'</ul></details>';
 };
 const ids=s=>s.rateCodes?.length?s.rateCodes:[s.rateCode||'Legacy'];
 c('work-rows').closest('table').querySelector('thead tr').innerHTML='<th>Date</th><th>Family</th><th>Rate IDs</th><th>Service</th><th>Times</th><th>Hours</th><th>Wages</th><th>Details</th>';
 c('work-rows').innerHTML=shifts.map(s=>'<tr><td>'+esc(s.workDate)+'</td><td>'+esc(s.familyName)+'</td><td>'+((ids(s).length>1)?'<b>Multiple rates</b> ':'')+ids(s).map(x=>'<code>'+esc(x)+'</code>').join(' ')+'</td><td>'+esc(s.serviceType)+'</td><td>'+esc(s.startTime)+'–'+esc(s.endTime)+'</td><td>'+esc((s.paidMinutes/60).toFixed(2))+'</td><td>'+esc(money(s.wageCents))+'</td><td>'+oneDetail(s)+' <button class="danger tiny remove" data-kind="shifts" data-id="'+esc(s._id)+'">Delete</button></td></tr>').join('')||'<tr><td colspan="8" class="empty">No shifts yet.</td></tr>';
 c('mobile-shifts').innerHTML=shifts.map(s=>'<article class="shift-tile"><strong>'+esc(s.workDate)+' · '+esc(s.familyName)+'</strong><p>'+esc(money(s.wageCents))+' · '+esc((s.paidMinutes/60).toFixed(2))+' hours</p><p>'+ids(s).map(x=>'<code>'+esc(x)+'</code>').join(' ')+'</p>'+oneDetail(s)+'</article>').join('')||'<p class="muted">No shifts yet.</p>';
 c('expense-rows').closest('table').querySelector('thead tr').innerHTML='<th>Date</th><th>Family</th><th>Expense type</th><th>Description</th><th>Amount</th><th>Receipt</th><th>Actions</th>';
 c('expense-rows').innerHTML=expenses.map(e=>'<tr><td>'+esc(e.purchaseDate)+'</td><td>'+esc(e.familyName)+'</td><td>'+esc(e.expenseType||'Uncategorised')+'</td><td>'+esc(e.description)+'</td><td>'+esc(money(e.amountCents))+'</td><td>'+(e.receiptId?'<a href="/api/receipts/'+esc(e.receiptId)+'">Download</a>':'None')+'</td><td><button type="button" class="secondary tiny edit-expense" data-id="'+esc(e._id)+'">Edit</button> <button class="danger tiny remove" data-kind="expenses" data-id="'+esc(e._id)+'">Delete</button></td></tr>').join('')||'<tr><td colspan="7" class="empty">No expenses yet.</td></tr>';
}
window.renderCareEnhancements=async function(){
 setUpCare();
 for(const key of ['new-rate-family','multi-family','child-family','report-family'])
  options(c(key),families,f=>f.name,key==='report-family'?'All families':'Choose family…');
 renderEnhancedTables();
 try{
  careChildren=await api('children');
  renderChildList();renderRateChildren();refreshSegments();await previewCode();
 }catch(e){notice('Could not refresh children: '+e.message,true);}
};
