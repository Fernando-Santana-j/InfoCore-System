const test = require('node:test');
const assert = require('node:assert/strict');
const {sanitize} = require('../public/js/budget-permissions');
const {normalizeItem} = require('../lib/budget-domain');
const option = {id:'o',items:[{id:'fixed',qty:3,customerPermissions:{remove:false,decrease:false,increase:false}},{id:'up',qty:4,customerPermissions:{remove:false,decrease:false,increase:true}},{id:'down',qty:4,customerPermissions:{remove:true,decrease:true,increase:false}}]};
test('item restrictions survive normalization and constrain tampered choices',()=>{
 assert.deepEqual(normalizeItem(option.items[0]).customerPermissions,{remove:false,decrease:false,increase:false});
 const result=sanitize({},option,{fixed:{included:false,qty:88},up:{included:false,qty:0},down:{included:false,qty:80},unknown:{qty:8}});
 assert.deepEqual(result,{fixed:{included:true,qty:3},up:{included:true,qty:4},down:{included:false,qty:4}});
 assert.equal(sanitize({},option,{up:{qty:7},down:{qty:2}}).up.qty,7);
 assert.equal(sanitize({},option,{up:{qty:7},down:{qty:2}}).down.qty,2);
});
test('global lock wins over individual rules and old local selections',()=>{
 assert.deepEqual(sanitize({customerCanEdit:false},option,{up:{included:false,qty:99},down:{qty:1}}),{fixed:{included:true,qty:3},up:{included:true,qty:4},down:{included:true,qty:4}});
 assert.deepEqual(sanitize({}, {items:[{id:'legacy',qty:2}]},{legacy:{included:false,qty:5}}),{legacy:{included:false,qty:5}});
});
test('public response route saves only choices allowed by current budget',async()=>{
 const fs=require('node:fs'),vm=require('node:vm');
 const DB=require('./helpers/memory-firestore');
 const db=new DB({'budgets/b':{id:'b',status:'sent',customerCanEdit:false,options:[option]}});
 const source=fs.readFileSync(require.resolve('../index'),'utf8');
 const start=source.indexOf("app.put('/api/public/budgets/:token/response'");
 const end=source.indexOf('const DIAGNOSTIC_SESSION_TTL_MS',start);
 let handler;
 vm.runInNewContext(source.slice(start,end),{app:{put:(path,fn)=>handler=fn},require:path=>require('../'+path),setPrivateShareHeaders:()=>{},findBudgetByPublicToken:async()=>db.records.get('budgets/b'),firestore:db,BUDGET_PUBLIC_RESPONSES_COLLECTION:'responses',BUDGETS_COLLECTION:'budgets',FieldValue:{serverTimestamp:()=>new Date().toISOString()},customerBudgetResponse:r=>r});
 const res={status(code){this.code=code;return this;},json(body){this.body=body;}};
 await handler({params:{token:'token'},body:{selectedOptionId:'o',choices:{fixed:{included:false,qty:90}},finalized:true}},res);
 assert.equal(res.body.error,false);
 assert.equal(db.records.get('responses/b').choices.fixed.qty,3);
 assert.equal(db.records.get('responses/b').choices.fixed.included,true);
});
