'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const domain=require('../lib/equipment-contract-domain');
const fixture=require('./helpers/equipment-contract-fixture');
const {buildPdf}=require('../lib/equipment-contract-pdf');
const {install}=require('../lib/equipment-contract-routes');
const DB=require('./helpers/memory-firestore');
function setup(){const db=new DB({'sales/sale1':{code:'VENDA-1',total:2500,cashier:{email:'admin@test'}},'products/p':{qty:5}}),routes=new Map(),app={};for(const m of ['get','put','post'])app[m]=(p,...h)=>routes.set(`${m} ${p}`,h);install(app,{firestore:db,verifyLogin:(q,r,n)=>q.session.user?n():r.status(401).json({error:true})});
return{db,call:async(method,path,body={},role='admin',id='contract-0001')=>{const req={body,params:{id},query:{},session:{user:role?{type:role,name:role,email:role+'@test'}:null}};const res={code:200,headers:{},status(n){this.code=n;return this;},set(k,v){if(typeof k==='object')Object.assign(this.headers,k);else this.headers[k]=v;return this;},json(x){this.body=x;return this;},send(x){this.body=x;return this;}};let i=0;const chain=routes.get(method+' '+path);const next=()=>chain[i++]?.(req,res,next);await next();return res;}};}
test('issuance validates required data, calendar dates, money and delivery results',()=>{
 assert.equal(domain.normalize(fixture(),true).price,2500);
 for(const patch of [{customerName:''},{price:-1},{price:'Infinity'},{price:1.001},{saleDate:'2026-02-30'},{checks:[]},{checks:['exception',...domain.CHECKS.slice(1).map(()=>'ok')],deliveryNotes:''},{condition:'refurbished'},{deliveryDate:'2025-01-01'}])assert.throws(()=>domain.normalize({...fixture(),...patch},true));
 assert.equal(domain.normalize({condition:'used',channel:'store'}).price,'');
 assert.notDeepEqual(domain.clauses(fixture())[1],domain.clauses({...fixture(),condition:'new'})[1]);
});
test('drafts, optimistic locking, immutable issuance, access control and isolated financial records',async()=>{
 const {db,call}=setup();let result=await call('put','/api/equipment-contracts/:id',{...fixture(),saleId:'sale1',revision:0});assert.equal(result.code,200);assert.equal(result.body.contract.revision,1);
 assert.equal((await call('put','/api/equipment-contracts/:id',{...fixture(),revision:0})).code,409);
 assert.equal((await call('get','/api/equipment-contracts/:id',{},'cashier')).code,403);
 assert.equal((await call('get','/api/equipment-contracts/:id',{},'technician')).code,403);
 assert.equal((await call('get','/api/equipment-contracts/:id',{},null)).code,401);
 result=await call('post','/api/equipment-contracts/:id/issue',{revision:1});assert.equal(result.code,200);assert.equal(result.body.contract.status,'issued');assert.equal(result.body.contract.clauses.length,13);
 const issued=structuredClone(result.body.contract);
 assert.equal((await call('put','/api/equipment-contracts/:id',{...fixture(),revision:2})).code,409);
 assert.deepEqual((await call('post','/api/equipment-contracts/:id/issue',{revision:1})).body.contract,issued);
 const pdf=await call('get','/api/equipment-contracts/:id/pdf');assert.equal(pdf.code,200);assert.equal(pdf.body.subarray(0,4).toString(),'%PDF');assert.equal(pdf.headers['Cache-Control'],'no-store');
 assert.equal(db.records.get('products/p').qty,5);assert.equal((await db.collection('sales').get()).size,1);assert.equal((await db.collection('cash_flow').get()).size,0);
});
test('invalid linked sale and incomplete draft cannot be issued',async()=>{
 const {call}=setup();assert.equal((await call('put','/api/equipment-contracts/:id',{...fixture(),saleId:'missing',revision:0})).code,400);
 await call('put','/api/equipment-contracts/:id',{condition:'new',channel:'store',revision:0});assert.equal((await call('post','/api/equipment-contracts/:id/issue',{revision:1})).code,400);
});
test('PDF generation handles long data and both templates without losing the final sections',async()=>{
 for(const condition of ['new','used']){const c={...fixture(),condition,configuration:'Configuração detalhada. '.repeat(65),code:'EQ-DEMO',status:'issued',templateVersion:1};const pdf=await buildPdf(c);assert.equal(pdf.subarray(0,4).toString(),'%PDF');assert.ok(pdf.length>8000);}
});

test('PDF has two contract copies, automatic customer warranty and three blank manual signatures per section',async t=>{
 const {spawnSync}=require('node:child_process');
 const c={...fixture(),code:'EQ-COPIES',status:'issued',witness1Name:'NOME ANTIGO NAO IMPRIMIR',witness1Doc:'99999999999'};
 const fs=require('node:fs'),path=require('node:path');
 const dir=fs.mkdtempSync(path.join(require('node:os').tmpdir(),'equipment-pdf-'));
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const pdfPath=path.join(dir,'contract.pdf');fs.writeFileSync(pdfPath,await buildPdf(c));
 const result=spawnSync('pdftotext',[pdfPath,'-'],{timeout:5000});
 if(result.error?.code==='ENOENT')return t.skip('pdftotext não instalado');
 assert.equal(result.status,0);const text=result.stdout.toString();
 assert.equal((text.match(/Venda de equipamento usado/g)||[]).length,2);
 assert.equal((text.match(/Via do cliente \/ Garantia/g)||[]).length,1);
 assert.ok(text.includes('Via da loja'));
 assert.ok(!text.slice(text.indexOf('Via da loja')).includes('Via do cliente / Garantia'));
 for(const label of ['Assinatura do comprador','Assinatura do representante da loja','Assinatura da testemunha'])assert.equal(text.split(label).length-1,3);
 assert.ok(!text.includes('NOME ANTIGO NAO IMPRIMIR'));
 for(const block of text.matchAll(/Assinaturas obrigatórias[^\f]*/g)){
   assert.ok(!block[0].includes(c.customerName));assert.ok(!block[0].includes(c.customerDoc));assert.ok(!block[0].includes(c.sellerRepresentative));
 }
 assert.ok(text.includes(c.serial));assert.ok(text.includes('Garantia legal de 90 dias'));
});
