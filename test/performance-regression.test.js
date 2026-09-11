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
    const sessionPosition = server.indexOf('app.use(session({');
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
