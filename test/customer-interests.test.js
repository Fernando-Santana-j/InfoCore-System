const test=require('node:test');
const assert=require('node:assert/strict');
const install=require('../lib/customer-interests');
const DB=require('./helpers/memory-firestore');
function setup(){
 const db=new DB({'customers/c':{name:'Maria',notes:'Preservar',requests:[{id:'old'}]}}),routes={};let invalidations=0;
 install({post:(path,...handlers)=>routes.post=handlers,patch:(path,...handlers)=>routes.patch=handlers},{firestore:db,models:{invalidate:()=>invalidations++},verifyLogin:(req,res,next)=>req.session.user?next():res.status(401).json({error:true})});
 async function call(method,body,role='user',customerId='c',interestId='interest-123'){
  const req={body,params:{id:customerId,interestId},session:{user:role?{type:role}:null}};
  const res={code:200,status(value){this.code=value;return this},json(value){this.body=value;return this}};
  let index=0;const next=error=>{if(error)throw error;return routes[method][index++]?.(req,res,next)};
  await next();return res;
 }
 return {db,call,invalidations:()=>invalidations};
}
const input={id:'interest-123',title:'Notebook',notes:'16 GB',maxBudget:'2000',status:'waiting'};
test('interest validation rejects invalid values and missing titles',()=>{
 for(const body of [{title:''},{title:'a',status:'wrong'},{title:'a',maxBudget:-1},{title:'a',maxBudget:'abc'},{title:'a',notes:'x'.repeat(1001)}])assert.throws(()=>install.normalize(body));
 assert.equal(install.normalize({title:'Notebook'}).maxBudget,null);
});
test('saving an interest preserves client data, retries are idempotent and concurrent additions survive',async()=>{
 const {db,call,invalidations}=setup();
 const results=await Promise.all([call('post',input),call('post',{...input,id:'interest-456',title:'Monitor'})]);
 assert.ok(results.every(r=>r.code===200));
 await call('post',input);
 const client=db.records.get('customers/c');assert.equal(client.interests.length,2);assert.equal(client.notes,'Preservar');assert.equal(client.requests[0].id,'old');assert.equal(invalidations(),3);
 assert.equal((await call('post',{...input,title:'Different'})).code,409);
 assert.equal((await call('patch',{status:'contacted'})).body.interests[0].status,'contacted');
});
test('interests require authorized staff, valid IDs and an existing customer',async()=>{
 const {call}=setup();
 assert.equal((await call('post',input,null)).code,401);
 assert.equal((await call('post',input,'technician')).code,403);
 assert.equal((await call('post',input,'admin','missing')).code,404);
 assert.equal((await call('post',{title:'Notebook'})).code,400);
 assert.equal((await call('patch',{status:'done'})).code,404);
});
