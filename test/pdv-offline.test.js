'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
function worker() {
    const handlers = {}, entries = new Map();
    let mode = 'online';
    const cache = {put:async (key, value) => entries.set(key, value.clone()), match:async key => entries.get(typeof key === 'string' ? key : new URL(key.url).pathname)?.clone()};
    vm.runInNewContext(fs.readFileSync('public/pdv-sw.js', 'utf8'), {
        self:{location:{origin:'https://example.test'}, addEventListener:(name, fn) => handlers[name] = fn},
        caches:{delete:async () => entries.clear(), open:async () => cache},
        URL, Response, AbortController, setTimeout, clearTimeout,
        fetch:async input => {
            if (mode === 'offline') throw new Error('Sem rede');
            if (mode === 'unauthorized') return new Response('{}', {status:401});
            const url = typeof input === 'string' ? input : input.url;
            return new Response(url.includes('/api/bootstrap') ? JSON.stringify({products:[{id:'p',price:12}], budgets:[{id:'b',code:'ORC-1',total:100}], customers:[{name:'Privado'}], configs:{currency:'BRL'}}) : 'page');
        }
    });
    return {entries, mode:value => mode = value, prepare:async (scope='pdv', owner='admin') => {
        let pending, result;
        handlers.message({data:{type:'PREPARE_PDV',scope,owner,shell:'offline menu',assets:['/js/pdv.js']},ports:[{postMessage:value => result = value}],waitUntil:value => pending=value});
        await pending; assert.equal(result.ok, true);
    }, request:async (path, method='GET', mode='cors') => {
        let pending;
        handlers.fetch({request:{url:'https://example.test'+path, method, mode},respondWith:value=>pending=value});
        return pending;
    }};
}
test('PDV restores page, assets and prices offline without caching customers', async () => {
    const w = worker(); await w.prepare(); w.mode('offline');
    assert.equal(await (await w.request('/pdv')).text(), 'page');
    const data = await (await w.request('/api/bootstrap/pdv')).json();
    assert.equal(data.products[0].price,12);
    assert.deepEqual(data.customers,[]);
    assert.ok(data.offlineSavedAt);
    assert.equal(await (await w.request('/js/pdv.js')).text(),'page');
    assert.equal(await w.request('/api/sales','POST'),undefined);
    assert.equal(await w.request('/clients'),undefined);
});
test('Authentication rejection and offline logout remove saved data', async () => {
    const w = worker(); await w.prepare(); w.mode('unauthorized');
    assert.equal((await w.request('/api/bootstrap/pdv')).status,401);
    assert.equal(w.entries.size,0);
    w.mode('online'); await w.prepare(); w.mode('offline');
    await assert.rejects(w.request('/logout','POST'));
    assert.equal(w.entries.size,0);
});

test('Preparing budgets preserves PDV, supplies navigation fallback and isolates accounts', async () => {
    const w = worker(); await w.prepare(); await w.prepare('budgets'); w.mode('offline');
    assert.equal(await (await w.request('/pdv')).text(), 'page');
    const data = await (await w.request('/api/bootstrap/budgets')).json();
    assert.equal(data.budgets[0].total,100);
    assert.equal(await (await w.request('/analytics', 'GET', 'navigate')).text(),'offline menu');
    w.mode('online'); await w.prepare('budgets','technician'); w.mode('offline');
    await assert.rejects(w.request('/api/bootstrap/pdv'));
    assert.equal((await (await w.request('/api/bootstrap/budgets')).json()).budgets.length,1);
});
