let familyDraft=null;
function renderFamilyList(){
 c('family-list').innerHTML=families.map(f=>'<article class="family-tile"><div class="heading"><strong>'+esc(f.name)+'</strong><button type="button" class="secondary edit-family" data-id="'+esc(f._id)+'">Edit family</button></div><details><summary>Family details</summary><p>'+esc(familyChildren(f._id).map(x=>x.name).join(', ')||'No active children')+'</p><p>'+rates.filter(r=>String(r.familyId)===String(f._id)).length+' saved rate profiles</p><button type="button" class="secondary edit-family" data-id="'+esc(f._id)+'">Edit family</button></details></article>').join('')||'<p>No families yet. Add your first family below.</p>';
}
async function openFamilyEditor(id){
 try{
  familyDraft=await api('families/'+encodeURIComponent(id));
  c('edit-family-name').value=familyDraft.name;c('family-edit-error').textContent='';
  c('edit-children').replaceChildren();
  for(const child of familyDraft.children)addChildEditor(child);
  updateFamilyImpact();c('family-dialog').showModal();c('family-dialog-title').focus();c('family-dialog').scrollTop=0;
 }catch(e){notice(e.message,true);}
}
function addChildEditor(child={}){
 const row=document.createElement('fieldset');row.className='edit-child';row.dataset.id=child._id||'';
 row.innerHTML='<legend>'+esc(child.name||'New child')+'</legend><label>Child name<input class="edit-child-name" required minlength="2" maxlength="80" value="'+esc(child.name||'')+'"></label><label>Status<select class="edit-child-status"><option value="active">Active</option><option value="'+(child.linked?'archived':'removed')+'">'+(child.linked?'Archive — keep linked records':'Remove from family')+'</option></select></label><p class="muted">'+(child.linked?'Linked rates: '+esc(child.rateCodes.join(', ')||'Historical shifts')+'. Archiving prevents these profiles from being selected for new shifts.':'Removal hides this child; their identity is retained safely.')+'</p>';
 if(child.archived)row.querySelector('select').value=child.linked?'archived':'removed';
 c('edit-children').append(row);
}
function updateFamilyImpact(){
 c('family-impact').textContent='Name corrections appear in current family and rate views. Saved Rate IDs, historical names and earnings remain unchanged. Archived children and their profiles remain in history but cannot be selected for new shifts. Changes apply only when you save.';
}
c('family-list').addEventListener('click',e=>{const button=e.target.closest('.edit-family');if(button)openFamilyEditor(button.dataset.id);});
c('edit-add-child').addEventListener('click',()=>{addChildEditor();c('edit-children').lastElementChild.querySelector('input').focus();});
c('family-dialog').addEventListener('cancel',e=>{if(c('family-edit-form').querySelector('[type=submit]').disabled)e.preventDefault();});
c('family-edit-cancel').addEventListener('click',()=>c('family-dialog').close());
c('family-edit-form').addEventListener('submit',async e=>{
 e.preventDefault();const button=e.currentTarget.querySelector('[type=submit]');button.disabled=true;c('family-edit-cancel').disabled=true;c('family-edit-error').textContent='';
 const children=[...c('edit-children').children].map(row=>({id:row.dataset.id||undefined,name:row.querySelector('input').value,status:row.querySelector('select').value})).filter(row=>row.id||row.status==='active');
 try{
  await api('families/'+familyDraft._id,{method:'PATCH',data:{name:c('edit-family-name').value,revision:familyDraft.revision||0,children}});
  c('family-dialog').close();
  try{await load();notice('Family changes saved. Historical records are unchanged.');}
  catch(error){notice('Family saved, but the screen could not refresh. Reload to see your changes. '+error.message,true);}
 }catch(error){c('family-edit-error').textContent=error.message;c('family-edit-error').scrollIntoView({block:'nearest'});}
 finally{button.disabled=false;c('family-edit-cancel').disabled=false;}
});
