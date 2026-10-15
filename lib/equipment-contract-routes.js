'use strict';
const {randomUUID}=require('node:crypto');
const domain=require('./equipment-contract-domain');
const {buildPdf}=require('./equipment-contract-pdf');
const availability=require('./database-availability');
const COLLECTION='equipment_contracts';
function install(app,{firestore:db,verifyLogin,getConfigs=async()=>({})}) {
  const auth=(req,res,next)=>verifyLogin(req,res,()=>req.session.user.type==='technician'?res.status(403).json({error:true,message:'Acesso restrito à equipe comercial.'}):next());
  const actor=req=>String(req.session.user.email||req.session.user.id||req.session.user.name);
  const access=(req,c)=>{if(req.session.user.type!=='admin'&&c.createdBy!==actor(req))throw domain.fail('Você não tem acesso a este contrato.',403);};
  const wrap=fn=>async(req,res)=>{try{await fn(req,res);}catch(e){if(availability.observe(e))return availability.respond(e,req,res,()=>{});console.error('equipment-contract',e.message);res.status(e.status||500).json({error:true,message:e.status?e.message:'Não foi possível concluir. Tente novamente.'});}};
  const ref=id=>{if(!/^[a-zA-Z0-9_-]{1,150}$/.test(id||''))throw domain.fail('Contrato inválido.');return db.collection(COLLECTION).doc(id);};
  const read=async(req)=>{const s=await ref(req.params.id).get();if(!s.exists)throw domain.fail('Contrato não encontrado.',404);const c={...s.data(),id:s.id};access(req,c);return c;};
  const audit=(tx,req,action,id)=>tx.set(db.collection('audit_events').doc(randomUUID()),{action,targetId:id,actor:actor(req),at:new Date().toISOString()});
  app.get('/api/equipment-contracts/options',auth,wrap(async(req,res)=>{
    const [customers,sales,config]=await Promise.all([db.collection('customers').limit(300).get(),db.collection('sales').orderBy('createdAt','desc').limit(100).get(),getConfigs()]);
    const visibleSales=sales.docs.map(s=>({...s.data(),id:s.id})).filter(s=>req.session.user.type==='admin'||s.cashier?.email===req.session.user.email);
    res.set('Cache-Control','no-store').json({fields:domain.fields,checks:domain.CHECKS,defaults:domain.sellerDefaults(config,req.session.user),customers:customers.docs.map(s=>{const c=s.data();return{id:s.id,name:c.name||'',doc:c.doc||'',phone:c.phone||'',email:c.email||'',address:c.address||''};}),sales:visibleSales.map(s=>({id:s.id,code:s.code||s.id,client:s.client||'',customerId:s.customerId||'',total:Number(s.total)||0,items:(s.items||[]).map(i=>({name:i.name||'',quantity:i.qty||i.quantity||1}))}))});
  }));
  app.get('/api/equipment-contracts',auth,wrap(async(req,res)=>{
    // Owner filtering in memory avoids a composite-index deployment for this bounded list.
    let query=db.collection(COLLECTION);
    if(req.session.user.type!=='admin')query=query.where('createdBy','==',actor(req));
    else query=query.orderBy('updatedAt','desc');
    const snap=await query.limit(200).get();
    res.set('Cache-Control','no-store').json({contracts:snap.docs.map(s=>{const c=s.data();return{id:s.id,code:c.code,status:c.status,condition:c.condition,customerName:c.customerName,model:c.model,serial:c.serial,price:c.price,updatedAt:c.updatedAt};}).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt))});
  }));
  app.get('/api/equipment-contracts/:id',auth,wrap(async(req,res)=>res.set('Cache-Control','no-store').json({contract:await read(req)})));
  app.put('/api/equipment-contracts/:id',auth,wrap(async(req,res)=>{
    const target=ref(req.params.id),data=domain.normalize(req.body),now=new Date().toISOString();
    const contract=await db.runTransaction(async tx=>{
      const previous=await tx.get(target),old=previous.exists?previous.data():null;
      if(old){access(req,old);if(old.status!=='draft')throw domain.fail('Contrato emitido não pode ser alterado. Crie um novo documento.',409);if(req.body.revision!==old.revision)throw domain.fail('Este rascunho mudou em outra aba. Reabra antes de editar.',409);}
      else if(req.body.revision!==0)throw domain.fail('Rascunho não encontrado. Reabra a página.',409);
      let saleSnapshot=null;
      if(data.saleId){const sale=await tx.get(db.collection('sales').doc(data.saleId));if(!sale.exists)throw domain.fail('Venda do PDV não encontrada.');const s=sale.data();if(req.session.user.type!=='admin'&&s.cashier?.email!==req.session.user.email)throw domain.fail('Venda não disponível para este usuário.',403);if(s.cancelled||s.status==='cancelled')throw domain.fail('A venda vinculada foi cancelada.');saleSnapshot={id:sale.id,code:s.code||sale.id,total:Number(s.total)||0};}
      const result={...data,id:target.id,code:old?.code||`EQ-${now.slice(0,4)}-${target.id.slice(0,8).toUpperCase()}`,status:'draft',revision:(old?.revision||0)+1,createdAt:old?.createdAt||now,createdBy:old?.createdBy||actor(req),updatedAt:now,templateVersion:domain.VERSION,saleSnapshot};
      tx.set(target,result);audit(tx,req,'equipment-contract.saved',target.id);return result;
    });res.json({contract});
  }));
  app.post('/api/equipment-contracts/:id/issue',auth,wrap(async(req,res)=>{
    const target=ref(req.params.id);
    const contract=await db.runTransaction(async tx=>{
      const snap=await tx.get(target);if(!snap.exists)throw domain.fail('Salve o rascunho primeiro.',404);
      const c=snap.data();access(req,c);if(c.status==='issued')return c;
      if(req.body.revision!==c.revision)throw domain.fail('O rascunho mudou. Reabra antes de emitir.',409);
      const data=domain.normalize(c,true);
      if(data.saleId){const sale=await tx.get(db.collection('sales').doc(data.saleId));if(!sale.exists||sale.data().cancelled||sale.data().status==='cancelled')throw domain.fail('A venda vinculada não está mais disponível.');}
      const result={...c,...data,status:'issued',clauses:domain.clauses(data),templateVersion:domain.VERSION,issuedAt:new Date().toISOString(),updatedAt:new Date().toISOString(),revision:c.revision+1};
      tx.set(target,result);audit(tx,req,'equipment-contract.issued',target.id);return result;
    });res.json({contract});
  }));
  app.get('/api/equipment-contracts/:id/pdf',auth,wrap(async(req,res)=>{
    const c=await read(req),buffer=await buildPdf(c);
    res.set({'Content-Type':'application/pdf','Content-Disposition':`${req.query.download==='1'?'attachment':'inline'}; filename="${c.code}.pdf"`,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}).send(buffer);
  }));
}
module.exports={install};
