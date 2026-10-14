
const db = require('./db.js')
const availability = require('../lib/database-availability');
const snapshots = require('../lib/local-snapshots');
const readMetrics = {startedAt:new Date().toISOString(),collections:{}};
function metric(name) { return readMetrics.collections[name] ||= {queries:0,documents:0,cacheHits:0,sharedReads:0,failures:0}; }

// Navegar entre telas dispara leituras repetidas das mesmas coleções. Um cache
// curto reduz a latência e o custo do Firestore sem esconder alterações: todas
// as escritas feitas por este módulo invalidam a coleção imediatamente.
const collectionCache = new Map();
const pendingReads = new Map();
const configuredCacheBytes = Number(process.env.DATA_CACHE_MAX_BYTES);
const maxCacheBytes = Number.isFinite(configuredCacheBytes) && configuredCacheBytes > 0 ? configuredCacheBytes : 16 * 1024 * 1024;
const maxCacheCollections = 24;
let cacheBytes = 0;
function dropCache(key) {
    cacheBytes -= collectionCache.get(key)?.bytes || 0;
    collectionCache.delete(key);
}
function pruneCache(now) {
    for (const [key, entry] of collectionCache) if (entry.expiresAt <= now) dropCache(key);
}
function cacheRows(key, rows) {
    dropCache(key);
    // Conservative serialized UTF-16 estimate; this is not a total heap limit.
    const bytes = JSON.stringify(rows).length * 2;
    if (bytes > maxCacheBytes) return;
    while (collectionCache.size >= maxCacheCollections || cacheBytes + bytes > maxCacheBytes) {
        dropCache(collectionCache.keys().next().value);
    }
    collectionCache.set(key, {rows, bytes, loadedAt:Date.now(), expiresAt:Date.now() + cacheTtlMs});
    cacheBytes += bytes;
}
let cacheGeneration = 0;
const configuredCacheTtlMs = Number(process.env.DATA_CACHE_TTL_MS);
const cacheTtlMs = process.env.DATA_CACHE_TTL_MS != null && Number.isFinite(configuredCacheTtlMs)
    ? Math.max(0, configuredCacheTtlMs)
    : 300000;

function copyRows(rows) {
    return rows.map((row) => ({ ...row }));
}

function invalidate(colecao) {
    cacheGeneration++;
    dropCache(String(colecao || ''));
    pendingReads.delete(String(colecao || ''));
}

function clearCache() {
    cacheGeneration++;
    collectionCache.clear();
    cacheBytes = 0;
    pendingReads.clear();
}

module.exports = {
    findAll: async (props) => {
        const colecao = String(props.colecao || '');
        const now = Date.now();
        pruneCache(now);
        const cached = collectionCache.get(colecao);
        if (cached && cached.expiresAt > now && !(props.fresh === true && now - cached.loadedAt >= 5000)) {
            metric(colecao).cacheHits++;
            collectionCache.delete(colecao);
            collectionCache.set(colecao, cached);
            return copyRows(cached.rows);
        }
        if (pendingReads.has(colecao)) metric(colecao).sharedReads++;

        // Compartilha a mesma leitura quando duas partes do bootstrap pedem a
        // mesma coleção simultaneamente.
        if (!pendingReads.has(colecao)) {
            const generation = cacheGeneration;
            metric(colecao).queries++;
            const read = availability.run(() => db.collection(colecao).get())
                .then((snap) => {
                    const rows = snap.docs.map((doc) => ({ ...doc.data(), id: doc.id }));
                    metric(colecao).documents += rows.length;
                    if (generation === cacheGeneration) void snapshots.capture(colecao,rows);
                    if (cacheTtlMs > 0 && generation === cacheGeneration) {
                        cacheRows(colecao, rows);
                    }
                    return rows;
                })
                .catch(error => {metric(colecao).failures++;throw error;})
                .finally(() => { if (pendingReads.get(colecao) === read) pendingReads.delete(colecao); });
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
            firebaseData = firebaseData.where(props.where[0] ,props.where[1],props.where[2]).limit(1)
        }
        return await availability.run(() => firebaseData.get()).then(async (res) => {
            let data 
            if (props.hasOwnProperty('where')) {
                if (res.docs.length > 0) {
                    const doc = res.docs[0]
                    data = { ...doc.data(), id: doc.id }
                }else{
                    return {error:true,err:'Nenhum dado encontrado'}
                }
            }else{
                if (!res.exists) return {error:true,err:'Nenhum dado encontrado'};
                data = { ...res.data(), id: res.id }
            }
            data.error = false
            return data
        });

    },
    update: async (colecao, doc, data) => {
        let firebaseData = db.collection(colecao).doc(doc)
        let res = await availability.run(() => firebaseData.update(data));
        invalidate(colecao);
        return res
    },
    delete: async (colecao, doc,) => {
        let firebaseData = db.collection(colecao).doc(doc)
        await availability.run(() => firebaseData.delete());
        invalidate(colecao);
        return
    },
    create: async (colecao, doc, data) => {
        let firebaseData = db.collection(colecao).doc(doc)
        await availability.run(() => firebaseData.set(data));
        invalidate(colecao);
        return
    },
    invalidate,
    clearCache,
    getReadMetrics: () => {
        pruneCache(Date.now());
        return JSON.parse(JSON.stringify({...readMetrics, cache:{collections:collectionCache.size, estimatedBytes:cacheBytes, maxBytes:maxCacheBytes}}));
    }
}
