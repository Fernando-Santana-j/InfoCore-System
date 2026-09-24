const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../public/js/dashboard.js'), 'utf8');

function render(data = {}) {
    const elements = new Map();
    const node = () => ({ style: {}, textContent: '', innerHTML: '', appendChild() {} });
    const document = {
        readyState: 'loading', addEventListener() {}, createElement: node,
        getElementById(id) {
            if (!elements.has(id)) elements.set(id, node());
            return elements.get(id);
        }
    };
    vm.runInNewContext(`${source}\nDashboard.render();`, {
        document, window: { appData: data }, setTimeout: (fn) => fn(), Intl, Date
    });
    return (id) => elements.get(id);
}

test('dashboard fills currency, quantity and client metrics and renders safe SVG payments', () => {
    const now = new Date().toISOString();
    const get = render({
        sales: [{ id: 'v1', date: now, total: '125.50', payment: 'pix', items: [{ id: 'p1', qty: 3 }] }],
        products: [{ id: 'p1', qty: 8, min: 2, category: 'parts' }, { itemType: 'service', qty: 99 }],
        clients: [{ name: 'Cliente' }],
        configs: { payment_methods: { pix: { name: 'Pix', icon: '<svg onload="alert(1)"></svg>' } } }
    });
    assert.match(get('statTotal').textContent, /125,50/);
    assert.equal(get('statSales').textContent, '1');
    assert.equal(get('statStock').textContent, '8');
    assert.equal(get('statClients').textContent, '1');
    assert.match(get('paymentMethods').innerHTML, /<svg/);
    assert.doesNotMatch(get('paymentMethods').innerHTML, /&lt;svg|onload/);
    assert.match(get('recentSales').innerHTML, /3 itens/);
    assert.match(get('topCategories').innerHTML, /3 unidades/);
    assert.match(get('totalPeriodValue').textContent, /125,50/);
});

test('dashboard handles empty data with visible zero values', () => {
    const get = render();
    assert.match(get('statTotal').textContent, /0,00/);
    assert.equal(get('statSales').textContent, '0');
    assert.match(get('recentSales').innerHTML, /Nenhuma venda/);
});

test('dashboard orders recent sales by date and excludes older sales from today', () => {
    const get = render({ sales: [
        { id: 'older', date: '2020-01-01T12:00:00Z', total: 500, items: [] },
        { id: 'newer', createdAt: new Date().toISOString(), total: 10, items: [] }
    ] });
    assert.equal(get('statSales').textContent, '1');
    assert.match(get('statTotal').textContent, /10,00/);
    assert.ok(get('recentSales').innerHTML.indexOf('#newer') < get('recentSales').innerHTML.indexOf('#older'));
});
