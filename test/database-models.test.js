const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const {createAvailability}=require('../lib/database-availability');
function models(db, clock = Date, env = {}) {
    const context={Date:clock,module:{exports:{}},process:{env},require(name){if(name==='./db.js')return db;if(name==='../lib/local-snapshots')return {capture:async()=>{}};if(name==='../lib/database-availability')return createAvailability({log:()=>{}});throw Error(name)}};
    vm.runInNewContext(fs.readFileSync(require.resolve('../firebase/models'),'utf8'),context);
    return context.module.exports;
}
const snapshot=value=>({docs:[{id:'p',data:()=>({value})}]});
test('invalidated in-flight collection read never replaces the new cache',async()=>{
    const pending=[];let reads=0;
    const m=models({collection:()=>({get:()=>{reads++;return new Promise(resolve=>pending.push(resolve))},doc:()=>({update:async()=>{}})})});
    const old=m.findAll({colecao:'products'});
    await m.update('products','p',{value:2});
    const fresh=m.findAll({colecao:'products'});
    pending[1](snapshot(2));assert.equal((await fresh)[0].value,2);
    pending[0](snapshot(1));await old;
    assert.equal((await m.findAll({colecao:'products'}))[0].value,2);assert.equal(reads,2);
});
test('lookup distinguishes a missing document from quota and limits equality queries',async()=>{
    let failure=null,limit=0;
    const reference={get:async()=>{if(failure)throw failure;return {exists:false,docs:[]}}};
    const m=models({collection:()=>({doc:()=>reference,where:()=>({limit:n=>{limit=n;return reference}})})});
    assert.equal((await m.findOne({colecao:'users',doc:'missing'})).error,true);
    await m.findOne({colecao:'users',where:['email','==','a']});assert.equal(limit,1);
    failure=Object.assign(new Error('Quota exceeded'),{code:8});
    await assert.rejects(m.findOne({colecao:'users',doc:'a'}),e=>e===failure);
    await assert.rejects(m.findOne({colecao:'users',doc:'a'}),e=>e.databaseUnavailable===true);
});
test('simultaneous collection reads are shared and failed writes are propagated',async()=>{
    let reads=0;const failure=Object.assign(new Error('unavailable'),{code:14});
    const m=models({collection:()=>({get:async()=>{reads++;return snapshot(1)},doc:()=>({set:async()=>{throw failure}})})});
    await Promise.all(Array.from({length:10},()=>m.findAll({colecao:'products'})));assert.equal(reads,1);
    await assert.rejects(m.create('sales','s',{}),e=>e===failure);
});

test('normal navigation reuses cached collections and records savings without extra database reads',async()=>{
    let reads=0;
    const m=models({collection:()=>({get:async()=>{reads++;return snapshot(1)}})});
    for(let i=0;i<100;i++)await m.findAll({colecao:'budgets'});
    await m.findAll({colecao:'budgets',fresh:true}); // Double clicks inside five seconds reuse data.
    assert.equal(reads,1);
    assert.equal(m.getReadMetrics().collections.budgets.cacheHits,100);
    assert.equal(m.getReadMetrics().collections.budgets.documents,1);
    m.invalidate('customers');
    await m.findAll({colecao:'budgets'});assert.equal(reads,1);
});


test('five-minute cache avoids full collection reads on repeated ten-second navigation',async()=>{
    let time=0,reads=0;
    class Clock extends Date { static now(){return time} }
    const m=models({collection:()=>({get:async()=>{reads++;return snapshot(1)}})},Clock);
    for(time=0;time<300000;time+=10000)await m.findAll({colecao:'budgets'});
    assert.equal(reads,1);
    await m.findAll({colecao:'budgets'});assert.equal(reads,2);
    time+=6000;await m.findAll({colecao:'budgets',fresh:true});assert.equal(reads,3);
});


test('collection cache evicts least recently used data within its memory budget',async()=>{
    let reads=0;
    const m=models({collection:()=>({get:async()=>{reads++;return snapshot('x'.repeat(80))}})},Date,{DATA_CACHE_MAX_BYTES:'500'});
    await m.findAll({colecao:'a'});await m.findAll({colecao:'b'});
    await m.findAll({colecao:'a'});await m.findAll({colecao:'c'});
    assert.equal(m.getReadMetrics().cache.collections,2);
    assert.ok(m.getReadMetrics().cache.estimatedBytes<=500);
    await m.findAll({colecao:'a'});assert.equal(reads,3);
    await m.findAll({colecao:'b'});assert.equal(reads,4);
    m.clearCache();assert.equal(m.getReadMetrics().cache.estimatedBytes,0);
});
test('oversized collections are returned but not retained, expired entries are released on inspection',async()=>{
    let time=0;class Clock extends Date {static now(){return time}}
    const m=models({collection:()=>({get:async()=>snapshot('x'.repeat(100))})},Clock,{DATA_CACHE_MAX_BYTES:'10'});
    assert.equal((await m.findAll({colecao:'large'})).length,1);
    assert.equal(m.getReadMetrics().cache.collections,0);
    const small=models({collection:()=>({get:async()=>snapshot(1)})},Clock);
    await small.findAll({colecao:'small'});time=300001;
    assert.equal(small.getReadMetrics().cache.estimatedBytes,0);
});
