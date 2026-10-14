const test = require('node:test');
const assert = require('node:assert/strict');
const {EventEmitter} = require('node:events');
const {createAvailability,databaseFailure} = require('../lib/database-availability');
const quota = () => Object.assign(new Error('8 RESOURCE_EXHAUSTED: Quota exceeded.'),{code:8});
function response() {
    return Object.assign(new EventEmitter(),{statusCode:200,headers:{},setHeader(k,v){this.headers[k]=v},status(n){this.statusCode=n;return this},json(v){this.body=v;return this},type(){return this},send(v){this.body=v;return this}});
}
test('quota blocks repeated attempts, admits a single recovery request, and never replays writes',async()=>{
    let time=100, calls=0;const logs=[];
    const a=createAvailability({now:()=>time,cooldownMs:1000,log:m=>logs.push(m)});
    await assert.rejects(a.run(async()=>{calls++;throw quota()}));
    await assert.rejects(a.run(async()=>{calls++}));assert.equal(calls,1);
    const blocked=response();a.gate({},blocked,e=>a.respond(e,{path:'/api/sales',method:'POST'},blocked,()=>{}));
    assert.equal(blocked.statusCode,503);assert.equal(blocked.headers['Retry-After'],'1');
    time+=1001;
    let next=0;const recovery=response();a.gate({},recovery,e=>{assert.equal(e,undefined);next++});
    a.gate({},response(),e=>assert.equal(e.databaseUnavailable,true));assert.equal(next,1);
    recovery.writableFinished=true;recovery.emit('finish');
    assert.equal(a.state().available,true);assert.equal(calls,1);assert.equal(logs.length,1);
});
test('failed or disconnected recovery keeps circuit open and logs are throttled',()=>{
    let time=0;const logs=[];const a=createAvailability({now:()=>time,cooldownMs:1000,log:m=>logs.push(m)});
    a.observe(quota());a.observe(quota());assert.equal(logs.length,1);
    time=1001;const r=response();a.gate({},r,()=>{});r.emit('close');
    a.gate({},response(),e=>assert.ok(e.databaseUnavailable));assert.equal(a.state().available,false);
});
test('dependency failures have safe JSON and standalone HTML; no stacks or success claims',()=>{
    const a=createAvailability({log:()=>{}});const r=response();
    a.respond(quota(),{path:'/api/test',method:'GET'},r,()=>{});
    assert.equal(r.statusCode,503);assert.equal(r.body.code,'DATABASE_UNAVAILABLE');
    assert.doesNotMatch(JSON.stringify(r.body),/RESOURCE_EXHAUSTED|stack|Seus dados não foram alterados/);
    const html=response();a.respond(quota(),{path:'/dashboard',method:'GET'},html,()=>{});
    assert.match(html.body,/Indisponibilidade temporária/);assert.equal(html.statusCode,503);
    assert.equal(databaseFailure({code:14}),'unavailable');assert.equal(databaseFailure({code:7}),'');
});
test('quota after headers closes only unfinished response and does not delegate repeated stack logs',()=>{
    const a=createAvailability({log:()=>{}});let destroyed=0;
    a.respond(quota(),{}, {headersSent:true,writableEnded:false,destroy(){destroyed++}},()=>assert.fail('unexpected delegation'));
    a.respond(quota(),{}, {headersSent:true,writableEnded:true,destroy(){destroyed++}},()=>assert.fail('unexpected delegation'));
    assert.equal(destroyed,1);
});

test('real Express server stays alive through quota failures and recovers without replaying requests',async(t)=>{
    const express=require('express');let time=0, operations=0, failing=true;
    const a=createAvailability({now:()=>time,cooldownMs:1000,log:()=>{}});
    const app=express();
    app.get('/health/live',(q,r)=>r.json({status:'ok'}));app.use(a.gate);
    app.post('/api/action',async(q,r)=>{operations++;if(failing) throw quota();r.json({ok:true});});
    app.use(a.respond);
    const server=app.listen(0,'127.0.0.1');
    await new Promise((resolve,reject)=>{server.once('listening',resolve);server.once('error',reject)});
    t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections()}));
    const base='http://127.0.0.1:'+server.address().port;
    assert.equal((await fetch(base+'/api/action',{method:'POST'})).status,503);
    for(let i=0;i<4;i++) assert.equal((await fetch(base+'/api/action',{method:'POST'})).status,503);
    assert.equal(operations,1);assert.equal((await fetch(base+'/health/live')).status,200);
    failing=false;time=1001;
    assert.equal((await fetch(base+'/api/action',{method:'POST'})).status,200);assert.equal(operations,2);
});
