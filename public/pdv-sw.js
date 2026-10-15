'use strict';
const CACHE = 'infocore-pdv-offline-v1';
const clear = () => caches.delete(CACHE);
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
let preparation = Promise.resolve();
self.addEventListener('message', event => {
    if (event.data?.type !== 'PREPARE_PDV') return;
    preparation = preparation.catch(() => {}).then(async () => {
        const scope = event.data.scope === 'budgets' ? 'budgets' : 'pdv';
        const pageUrl = '/' + scope;
        const bootstrapUrl = '/api/bootstrap/' + scope;
        const get = async url => {
            const response = await fetch(url, {cache:'no-store', credentials:'same-origin'});
            if (!response.ok || response.redirected) throw new Error('Preparação incompleta');
            return response;
        };
        const [page, bootstrap] = await Promise.all([get(pageUrl), get(bootstrapUrl)]);
        const html = await page.clone().text();
        const data = await bootstrap.json();
        if (!Array.isArray(data.products) || (scope === 'budgets' && !Array.isArray(data.budgets))) throw new Error('Dados indisponíveis');
        const urls = [...new Set([...(event.data.assets || []), ...Array.from(html.matchAll(/(?:src|href)=["']([^"']+)["']/g), match => match[1])])].filter(value => {
            const url = new URL(value, self.location.origin);
            return url.origin === self.location.origin && /^\/(js|css|img)\//.test(url.pathname);
        });
        const responses = await Promise.all(urls.map(async url => [url, await get(url)]));
        const savedAt = new Date().toISOString();
        const saved = {configs:data.configs, products:data.products, customers:[], offlineSavedAt:savedAt};
        if (scope === 'budgets') Object.assign(saved, {budgets:data.budgets, budgetTemplates:data.budgetTemplates || []});
        const cache = await caches.open(CACHE);
        const owner = await cache.match('/__offline-owner');
        if (owner && await owner.text() !== String(event.data.owner || '')) await clear();
        const target = await caches.open(CACHE);
        await Promise.all(responses.map(([url, response]) => target.put(url, response)));
        await target.put(pageUrl, page);
        await target.put(bootstrapUrl, new Response(JSON.stringify(saved), {headers:{'Content-Type':'application/json','X-PDV-Offline':'1'}}));
        await target.put('/__offline-owner', new Response(String(event.data.owner || '')));
        if (event.data.shell) await target.put('/__offline-shell', new Response(event.data.shell, {headers:{'Content-Type':'text/html; charset=utf-8'}}));
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
    const page = ['/pdv', '/budgets'].includes(url.pathname);
    const navigation = event.request.mode === 'navigate' && /^\/(dashboard|pdv|budgets|budget-links|budget-requests|equipment-sales|clients|stock|products|cash-flow|analytics|config|services|attendances)(\/|$)/.test(url.pathname);
    const bootstrap = ['/api/bootstrap/pdv', '/api/bootstrap/budgets'].includes(url.pathname);
    const asset = /^\/(js|css|img)\//.test(url.pathname);
    if (event.request.method !== 'GET' || (!page && !bootstrap && !asset && !navigation)) return;
    event.respondWith((async () => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 5000);
        try {
            const response = await fetch(event.request, {signal:controller.signal});
            if ((page || bootstrap || navigation) && (response.redirected || response.status === 401 || response.status === 403)) { await preparation; await clear(); }
            if (response.status >= 500) throw new Error('Servidor indisponível');
            return response;
        } catch (error) {
            const cache = await caches.open(CACHE);
            const cached = await cache.match(page ? url.pathname : navigation ? '/__offline-shell' : event.request);
            if (cached) return cached;
            if (navigation) { const shell = await cache.match('/__offline-shell'); if (shell) return shell; }
            throw error;
        } finally { clearTimeout(timer); }
    })());
});
