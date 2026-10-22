import test from 'node:test';
import assert from 'node:assert/strict';
import {validateFamilyEdit} from '../family-routes.js';
const existing=[{_id:'one'},{_id:'two'}];
const body={name:'Smith family',children:[{id:'one',name:'Clementine',status:'active'},{id:'two',name:'Oliver',status:'archived'}]};
test('family edit preserves identities while correcting names and changing status',()=>{
 const result=validateFamilyEdit(body,existing);
 assert.equal(result.children[1].id,'two');assert.equal(result.children[1].status,'archived');
 assert.deepEqual(existing,[{_id:'one'},{_id:'two'}]);
});
test('family edits reject missing, foreign, duplicated and ambiguous children',()=>{
 assert.throws(()=>validateFamilyEdit({...body,children:body.children.slice(0,1)},existing),/changed/);
 assert.throws(()=>validateFamilyEdit({...body,children:[...body.children,{id:'other',name:'Other',status:'active'}]},existing),/Invalid/);
 assert.throws(()=>validateFamilyEdit({...body,children:[body.children[0],body.children[0]]},existing),/duplicate/);
 assert.throws(()=>validateFamilyEdit({...body,children:[body.children[0],{...body.children[1],name:'CLÉMENTINE'}]},existing),/distinct/);
 assert.throws(()=>validateFamilyEdit({...body,name:' '},existing),/2–100/);
});
