'use strict';
const CACHE = 'infocore-pdv-offline-v1';
const clear = () => caches.delete(CACHE);
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
let preparation = Promise.resolve();
self.addEventListener('message', event => {
    if (event.data?.type !== 'PREPARE_PDV') return;
    preparation = preparation.catch(() => {}).then(async () => {
        const urls = [...new Set(event.data.assets || [])].filter(value => {
            const url = new URL(value, self.location.origin);
            return url.origin === self.location.origin && /^\/(js|css|img)\//.test(url.pathname);
        });
        const responses = await Promise.all(['/pdv', '/api/bootstrap/pdv', ...urls].map(async url => {
            const response = await fetch(url, {cache: 'no-store', credentials: 'same-origin'});
            if (!response.ok || response.redirected) throw new Error('Preparação incompleta');
            return [url, response];
        }));
        const data = await responses[1][1].json();
        if (!Array.isArray(data.products)) throw new Error('Catálogo indisponível');
        const savedAt = new Date().toISOString();
        responses[1][1] = new Response(JSON.stringify({configs:data.configs, products:data.products, customers:[], offlineSavedAt:savedAt}), {headers:{'Content-Type':'application/json','X-PDV-Offline':'1'}});
        await clear();
        const cache = await caches.open(CACHE);
        await Promise.all(responses.map(([url, response]) => cache.put(url, response)));
        event.ports[0]?.postMessage({ok:true, savedAt});
    }).catch(() => event.ports[0]?.postMessage({ok:false}));
    event.waitUntil(preparation);
});
self.addEventListener('fetch', event => {
    const url = new URL(event.request.url);
    if (url.origin !== self.location.origin) return;
    if (url.pathname === '/logout' || url.pathname === '/login') {
        event.respondWith((async () => { await preparation; await clear(); return fetch(event.request); })());
        return;
    }
    const page = url.pathname === '/pdv';
    const bootstrap = url.pathname === '/api/bootstrap/pdv';
    const asset = /^\/(js|css|img)\//.test(url.pathname);
    if (event.request.method !== 'GET' || (!page && !bootstrap && !asset)) return;
    event.respondWith((async () => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 5000);
        try {
            const response = await fetch(event.request, {signal:controller.signal});
            if ((page || bootstrap) && (response.redirected || response.status === 401 || response.status === 403)) await clear();
            if (response.status >= 500) throw new Error('Servidor indisponível');
            return response;
        } catch (error) {
            const cache = await caches.open(CACHE);
            const cached = await cache.match(page ? '/pdv' : event.request);
            if (cached) return cached;
            throw error;
        } finally { clearTimeout(timer); }
    })());
});
