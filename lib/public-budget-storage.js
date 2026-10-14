'use strict';
const {isDeepStrictEqual} = require('node:util');
const fields = ['selectedOptionId', 'choices', 'requestedItems', 'notes', 'customerName', 'customerPhone', 'finalized'];
function sameResponse(previous, next) {
    return !!previous && fields.every(key => isDeepStrictEqual(previous[key], next[key]));
}
async function readResponse(firestore, collection, owner) {
    if (owner.customerResponse) return owner.customerResponse;
    // Compatibility with links saved before responses were embedded in budgets.
    const snap = await firestore.collection(collection).doc(owner.id).get();
    return snap.exists ? snap.data() : {};
}
async function saveResponse(firestore, responseCollection, ownerCollection, owner, payload, update) {
    if (sameResponse(owner.customerResponse, payload)) return owner.customerResponse;
    const batch = firestore.batch();
    batch.set(firestore.collection(responseCollection).doc(owner.id), payload, {merge:true});
    batch.set(firestore.collection(ownerCollection).doc(owner.id), {...update, customerResponse:payload}, {merge:true});
    await batch.commit();
    return payload;
}
function withoutPublicSessions(middleware) {
    return (req, res, next) => {
        const page = /^\/p\/(?:orcamento|escolha|os)\/[a-f0-9-]{32,64}\/?$/i.test(req.path);
        const api = /^\/api\/public\/(?:budgets|showcases)\/[a-f0-9-]{32,64}(?:\/response)?\/?$/i.test(req.path);
        if ((page && ['GET','HEAD'].includes(req.method)) || (api && ['GET','HEAD','PUT'].includes(req.method))) return next();
        return middleware(req, res, next);
    };
}
module.exports = {readResponse, saveResponse, sameResponse, withoutPublicSessions};
