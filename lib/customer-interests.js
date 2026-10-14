'use strict';
const availability = require('./database-availability');
const statuses = new Set(['waiting','contacted','done','cancelled']);
const fail = (message,status=400) => Object.assign(new Error(message),{status});
function normalize(body) {
    const title=String(body.title || '').trim();
    const notes=String(body.notes || '').trim();
    const status=body.status || 'waiting';
    const maxBudget=body.maxBudget === '' || body.maxBudget == null ? null : Number(body.maxBudget);
    if (!title || title.length>120) throw fail('Informe o produto procurado, com até 120 caracteres.');
    if(notes.length>1000) throw fail('Use até 1.000 caracteres nos detalhes.');
    if(!statuses.has(status)) throw fail('Etapa inválida.');
    if(maxBudget!==null && (!Number.isFinite(maxBudget) || maxBudget<0 || maxBudget>10000000)) throw fail('Informe um valor máximo válido.');
    return {title,notes,status,maxBudget:maxBudget===null?null:Math.round(maxBudget*100)/100};
}
module.exports = function install(app,{firestore,models,verifyLogin}) {
    const handle = creating => async (req,res,next) => {
        try {
            if(!['admin','cashier','user'].includes(req.session.user?.type)) return res.status(403).json({error:true,message:'Acesso restrito ao atendimento.'});
            const id=String((creating ? req.body?.id : req.params.interestId) || '');
            if(!/^[a-zA-Z0-9-]{8,80}$/.test(id)) throw fail('Identificador do interesse inválido.');
            const newValue=creating ? normalize(req.body || {}) : null;
            const customer=firestore.collection('customers').doc(req.params.id);
            const now=new Date().toISOString();
            const interests=await availability.run(()=>firestore.runTransaction(async tx=>{
                const snap=await tx.get(customer);
                if(!snap.exists) throw fail('Cliente não encontrado.',404);
                const rows=Array.isArray(snap.data().interests)?snap.data().interests:[];
                const index=rows.findIndex(row=>row.id===id);
                if(creating && index>=0) {
                    if(JSON.stringify(normalize(rows[index]))!==JSON.stringify(newValue)) throw fail('Este interesse já foi salvo. Atualize a lista e use Editar para alterá-lo.',409);
                    return rows; // Retry after a lost response does not duplicate the interest.
                }
                if(!creating && index<0) throw fail('Interesse não encontrado.',404);
                if(creating && rows.length>=100) throw fail('Este cliente já possui 100 interesses registrados.');
                const previous=index>=0?rows[index]:{};
                const value={...previous,...normalize({...previous,...req.body}),id,createdAt:previous.createdAt || now,updatedAt:now};
                const updated=rows.slice();
                if(creating) updated.push(value); else updated[index]=value;
                tx.update(customer,{interests:updated,updatedAt:now});
                return updated;
            }));
            models.invalidate('customers');
            res.json({error:false,customerId:req.params.id,interests});
        } catch(error) {
            if(availability.observe(error)) return availability.respond(error,req,res,next);
            if(error.status) return res.status(error.status).json({error:true,message:error.message});
            next(error);
        }
    };
    app.post('/api/customers/:id/interests',verifyLogin,handle(true));
    app.patch('/api/customers/:id/interests/:interestId',verifyLogin,handle(false));
};
module.exports.normalize=normalize;
