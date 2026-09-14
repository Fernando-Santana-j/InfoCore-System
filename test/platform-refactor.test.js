const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ejs = require('ejs');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('shell possui navegação móvel, saída e recuperação de carregamento', () => {
    const layout = read('views/layout.ejs');
    const topbar = read('views/reusable/topbar.ejs');
    const sidebar = read('views/reusable/sidebar.ejs');
    const shared = read('public/js/shared.js');
    assert.match(layout, /pageLoaderRetry/);
    assert.match(layout, /AbortController/);
    assert.match(topbar, /mobileMenuBtn/);
    assert.match(sidebar, /id="appSidebar"/);
    assert.match(sidebar, /id="logoutBtn"/);
    assert.match(shared, /function setMobileMenu/);
    assert.match(shared, /fetch\('\/logout'/);
});

test('avisos globais tratam mensagens como texto, não HTML', () => {
    const shared = read('public/js/shared.js');
    assert.match(shared, /message\.textContent = String\(msg/);
    assert.doesNotMatch(shared, /toast\.innerHTML/);
});

test('análises usam vendas reais e não dados demonstrativos', () => {
    const analytics = read('public/js/analytics.js');
    assert.match(analytics, /window\.appData\?\.sales/);
    assert.match(analytics, /function aggregate/);
    assert.doesNotMatch(analytics, /Coca-Cola|Água Mineral|68,4%|totalVendas \* 4\.2/);
});

test('configurações deixaram de simular salvamentos e possuem endpoints reais', () => {
    const view = read('views/config.ejs');
    const client = read('public/js/config.js');
    const server = read('index.js');
    assert.doesNotMatch(view, /api\.sualoja\.com|sk-xxxxxxxx|Dados salvos com sucesso/);
    assert.match(client, /configRequest\('\/api\/config'/);
    assert.match(client, /configRequest\('\/api\/account\/password'/);
    assert.match(server, /app\.put\('\/api\/config', verifyAdminApi/);
    assert.match(server, /app\.put\('\/api\/account\/password', verifyLogin/);
});

test('custos e áreas financeiras possuem proteção por perfil', () => {
    const server = read('index.js');
    assert.match(server, /function budgetForUser/);
    assert.match(server, /\['stock', 'products', 'analytics', 'config'\]\.includes\(scope\)/);
    assert.match(server, /app\.get\('\/analytics', verifyAdmin/);
    assert.match(server, /productRows\.map\(\(product\) => productForPdv/);
    assert.match(server, /function saleForUser/);
    assert.match(server, /function budgetTemplateForUser/);
    assert.match(server, /preserveSubmittedProductCosts: req\.session\.user\?\.type === 'admin'/);
});

test('dados de autenticação nunca são serializados no appData', () => {
    const server = read('index.js');
    assert.match(server, /function publicSessionUser/);
    assert.match(server, /const \{ pass, password, passwordHash, \.\.\.safe \} = source/);
    assert.match(server, /req\.session\.user = publicSessionUser\(user\)/);
});

test('todas as telas administrativas renderizam sem ids duplicados', async () => {
    const pages = ['dashboard', 'pdv', 'budgets', 'budget-links', 'clients', 'stock', 'services', 'cashflow', 'analytics', 'config'];
    const appData = { user: { name: 'Teste', type: 'admin' }, configs: {}, cart: [], products: [], sales: [], budgets: [], customers: [], clients: [], services: [], cashFlowEntries: [], budgetTemplates: [], showcases: [], serviceWorkTemplates: [], whatsapp: {} };
    for (const body of pages) {
        const html = await ejs.renderFile(path.join(root, 'views/layout.ejs'), { body, bootstrap: body, appData, currentPath: `/${body}` });
        const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
        assert.equal(new Set(ids).size, ids.length, `${body} contém IDs duplicados`);
    }
});
