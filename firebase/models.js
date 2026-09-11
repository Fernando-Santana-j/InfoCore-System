
const db = require('./db.js')

// Navegar entre telas dispara leituras repetidas das mesmas coleções. Um cache
// curto reduz a latência e o custo do Firestore sem esconder alterações: todas
// as escritas feitas por este módulo invalidam a coleção imediatamente.
const collectionCache = new Map();
const pendingReads = new Map();
const configuredCacheTtlMs = Number(process.env.DATA_CACHE_TTL_MS);
const cacheTtlMs = process.env.DATA_CACHE_TTL_MS != null && Number.isFinite(configuredCacheTtlMs)
    ? Math.max(0, configuredCacheTtlMs)
    : 8000;

function copyRows(rows) {
    return rows.map((row) => ({ ...row }));
}

function invalidate(colecao) {
    collectionCache.delete(String(colecao || ''));
}

function clearCache() {
    collectionCache.clear();
}

module.exports = {
    findAll: async (props) => {
        const colecao = String(props.colecao || '');
        const now = Date.now();
        const cached = collectionCache.get(colecao);
        if (cached && cached.expiresAt > now) return copyRows(cached.rows);

        // Compartilha a mesma leitura quando duas partes do bootstrap pedem a
        // mesma coleção simultaneamente.
        if (!pendingReads.has(colecao)) {
            const read = db.collection(colecao).get()
                .then((snap) => {
                    const rows = snap.docs.map((doc) => ({ ...doc.data(), id: doc.id }));
                    if (cacheTtlMs > 0) {
                        collectionCache.set(colecao, { rows, expiresAt: Date.now() + cacheTtlMs });
                    }
                    return rows;
                })
                .finally(() => pendingReads.delete(colecao));
            pendingReads.set(colecao, read);
        }
        return copyRows(await pendingReads.get(colecao));
    },

    findOne: async (props) => {
        let firebaseData = db.collection(props.colecao)
        if (props.hasOwnProperty('doc')) {
            firebaseData = firebaseData.doc(props.doc)
        }
        if (props.hasOwnProperty('where')) {
            firebaseData = firebaseData.where(props.where[0] ,props.where[1],props.where[2])
        }
        return await firebaseData.get().then(async (res) => {
            let data 
            if (props.hasOwnProperty('where')) {
                if (res.docs.length > 0) {
                    const doc = res.docs[0]
                    data = { ...doc.data(), id: doc.id }
                }else{
                    return {error:true,err:'Nenhum dado encontrado'}
                }
            }else{
                data = { ...res.data(), id: res.id }
            }
            data.error = false
            return data
        }).catch((error) => {
            return {error:true,err:error}
            console.error('Erro ao buscar dados do Firestore:', error);
        });

    },
    update: async (colecao, doc, data) => {
        let firebaseData = db.collection(colecao).doc(doc)
        let res = await firebaseData.update(data);
        invalidate(colecao);
        return res
    },
    delete: async (colecao, doc,) => {
        let firebaseData = db.collection(colecao).doc(doc)
        await firebaseData.delete();
        invalidate(colecao);
        return
    },
    create: async (colecao, doc, data) => {
        let firebaseData = db.collection(colecao).doc(doc)
        await firebaseData.set(data);
        invalidate(colecao);
        return
    },
    invalidate,
    clearCache
}
