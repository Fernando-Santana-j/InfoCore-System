const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

function source(file) {
    return fs.readFileSync(path.join(root, file), 'utf8');
}

test('arquivos estáticos são servidos antes da sessão remota', () => {
    const server = source('index.js');
    const staticPosition = server.indexOf("app.use(express.static(path.join(__dirname, 'public')");
    const sessionPosition = server.indexOf("app.use(require('./lib/public-budget-storage').withoutPublicSessions(session({");
    assert.ok(staticPosition >= 0, 'middleware estático não encontrado');
    assert.ok(sessionPosition >= 0, 'middleware de sessão não encontrado');
    assert.ok(staticPosition < sessionPosition, 'arquivos estáticos voltaram a consultar o Firestore');
});

test('loader não impõe atraso mínimo artificial', () => {
    assert.match(source('public/js/shared.js'), /const MIN_LOADER_MS = 0;/);
});

test('telas auxiliares possuem bootstrap de dados', () => {
    const server = source('index.js');
    assert.match(server, /scope === 'products'/);
    assert.match(server, /scope === 'analytics'/);
});

test('quote screens never poll entire collections on a timer', () => {
    assert.doesNotMatch(source('public/js/budgets.js'), /setInterval\s*\(/);
    assert.doesNotMatch(source('public/js/budget-links.js'), /setInterval\s*\(/);
    assert.match(source('views/budgets.ejs'), /refreshBudgetsBtn/);
    assert.match(source('views/budget-links.ejs'), /refreshLinksBtn/);
});
test('PDV loads only catalog, customer and store data; mutation invalidation is targeted', () => {
    const s=source('index.js');
    const pdv=s.slice(s.indexOf("if (scope === 'pdv')"),s.indexOf("if (scope === 'budgets')"));
    assert.doesNotMatch(pdv,/BUDGETS_COLLECTION|loadServiceWorkTemplatesNormalized/);
    assert.doesNotMatch(s,/db\.clearCache\(\)/);
    const deps=require('../lib/cache-dependencies');
    assert.deepEqual(deps('/api/products/p'),['products']);
    assert.deepEqual(deps('/api/budget-templates/t'),['budget_templates']);
    assert.ok(deps('/api/sales').includes('products'));
    assert.ok(deps('/api/budgets/b/convert-sale').includes('sales'));
});
