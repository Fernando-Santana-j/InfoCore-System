const test = require('node:test');
const assert = require('node:assert/strict');
const {readResponse,saveResponse,withoutPublicSessions} = require('../lib/public-budget-storage');
const DB = require('./helpers/memory-firestore');
const response = {selectedOptionId:'o',choices:{a:{qty:1,included:true}},requestedItems:[],notes:'',customerName:'Cliente',customerPhone:'',finalized:false};
test('embedded public responses cost no extra read; legacy links still load their responses',async()=>{
    let reads=0;
    const db={collection:()=>({doc:()=>({get:async()=>{reads++;return {exists:true,data:()=>response}}})})};
    assert.equal(await readResponse(db,'responses',{id:'b',customerResponse:response}),response);
    assert.equal(reads,0);
    assert.equal(await readResponse(db,'responses',{id:'legacy'}),response);assert.equal(reads,1);
});
test('changed response commits both copies once, identical retry performs zero writes and no reread',async()=>{
    const db=new DB({'budgets/b':{id:'b'}});let batches=0;
    const batch=db.batch.bind(db);db.batch=()=>{batches++;return batch()};
    const first={...response,updatedAt:new Date()};
    await saveResponse(db,'responses','budgets',{id:'b'},first,{status:'sent'});
    assert.equal(batches,1);assert.deepEqual(db.records.get('responses/b'),first);
    const owner=db.records.get('budgets/b');
    await saveResponse(db,'responses','budgets',owner,{...first,updatedAt:new Date(Date.now()+1000)},{});
    assert.equal(batches,1);
    await saveResponse(db,'responses','budgets',owner,{...first,finalized:true},{status:'awaiting'});
    assert.equal(batches,2);assert.equal(db.records.get('budgets/b').status,'awaiting');
});
test('failed batch is propagated without reporting successful save',async()=>{
    const failure=Object.assign(new Error('quota'),{code:8});let writes=0;
    const db={collection:()=>({doc:()=>({})}),batch:()=>({set:()=>writes++,commit:async()=>{throw failure}})};
    await assert.rejects(saveResponse(db,'responses','budgets',{id:'b'},response,{}),e=>e===failure);
    assert.equal(writes,2);
});
test('only exact public routes bypass session; authenticated and similar paths retain their middleware',()=>{
    let sessions=0,nexts=0;const middleware=withoutPublicSessions(()=>sessions++);
    const token='a'.repeat(32);
    for(const path of [`/p/orcamento/${token}`,`/p/escolha/${token}`,`/p/os/${token}`,`/api/public/budgets/${token}`])middleware({path,method:'GET'},{},()=>nexts++);
    middleware({path:`/api/public/budgets/${token}/response`,method:'PUT'},{},()=>nexts++);
    assert.equal(nexts,5);assert.equal(sessions,0);
    for(const path of ['/api/budgets','/dashboard',`/p/os/${token}/admin`,`/api/public/budgets/${token}/admin`])middleware({path,method:'GET'},{},()=>nexts++);
    assert.equal(sessions,4);
});
