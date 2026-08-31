const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

test('budget page has no duplicate ids and JS static ids exist', () => {
  const view = read('views/budgets.ejs');
  const js = read('public/js/budgets.js');
  const ids = [...view.matchAll(/\bid=["']([^"']+)["']/g)].map((m) => m[1]);
  const unique = new Set(ids);
  assert.equal(unique.size, ids.length, 'Há IDs duplicados em views/budgets.ejs');
  const refs = [...js.matchAll(/getElementById\(["']([^"']+)["']\)/g)].map((m) => m[1]);
  const missing = [...new Set(refs)].filter((id) => !unique.has(id));
  assert.deepEqual(missing, [], `IDs usados pelo JS e ausentes na view: ${missing.join(', ')}`);
});

test('template product picker has the same explicit add flow as normal budgets', () => {
  const view = read('views/budgets.ejs');
  const js = read('public/js/budgets.js');
  assert.match(view, /id="templateAddProductBtn"/);
  assert.match(view, /id="templateProductResults"/);
  assert.match(js, /selectedTemplateProductId\)addProductToContext\(selectedTemplateProductId,'template'\)/);
});

test('customer-facing budget templates never expose internal financial fields', () => {
  const files = [
    'templates/budgets/voucher.html',
    'templates/budgets/voucher-print.html',
    'templates/budgets/pdf.html',
    'templates/budgets/image.html',
    'templates/budgets/email.html',
    'templates/budgets/whatsapp.txt'
  ];
  for (const file of files) {
    const content = read(file);
    assert.doesNotMatch(content, /\{\{\s*(?:costTotal|profit|margin|internalNotes)\s*\}\}/i, `${file} expõe campo interno`);
  }
});

test('budget template placeholders are provided by the render data contract', () => {
  const allowed = new Set([
    'code','customerName','customerPhone','customerEmail','validUntil','date','notes','internalNotes',
    'subtotal','discount','extra','total','status','statusBg','statusColor','statusBadgeHtml','signatureTerms',
    'issuedAt','itemsRowsHtml','optionsHtml','itemsRowsText','includedServicesHtml','conditionLinesHtml',
    'conditionLinesText','sourceLabel','logoUrl','voucherHtml'
  ]);
  const files = fs.readdirSync(path.join(root, 'templates', 'budgets')).filter((x) => /\.(?:html|txt)$/.test(x));
  for (const name of files) {
    const content = read(path.join('templates', 'budgets', name));
    const tokens = [...content.matchAll(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g)].map((m) => m[1]);
    const unknown = [...new Set(tokens)].filter((x) => !allowed.has(x));
    assert.deepEqual(unknown, [], `${name} usa placeholders sem contrato: ${unknown.join(', ')}`);
  }
});

test('direct quote conversion explicitly requires confirmed payment', () => {
  const view = read('views/budgets.ejs');
  const js = read('public/js/budgets.js');
  const server = read('index.js');
  assert.match(view, /id="convertPaymentConfirmed"/);
  assert.match(js, /paymentConfirmed:true/);
  assert.match(server, /req\.body\?\.paymentConfirmed !== true/);
});

test('quote finalization no longer creates new budget cash-flow entries', () => {
  const server = read('index.js');
  const syncBlock = server.match(/async function syncMissingBudgetsToCashFlow\(\) \{[\s\S]*?\n\}/)?.[0] || '';
  assert.doesNotMatch(syncBlock, /createCashFlowFromBudget\(/);
  assert.match(syncBlock, /return 0/);
});

test('budget popups are fail-safe hidden and have standalone modal CSS', () => {
  const view = read('views/budgets.ejs');
  const css = read('public/css/budgets.css');
  const modalTags = [...view.matchAll(/<div\s+class=["']pdv-modal-overlay budget-modal-overlay["']([^>]*)>/g)];
  assert.ok(modalTags.length >= 7, 'Quantidade inesperada de modais de orçamento');
  for (const [, attrs] of modalTags) {
    assert.match(attrs, /\bhidden\b/, 'Todo modal deve nascer com hidden no HTML');
    assert.match(attrs, /aria-hidden=["']true["']/, 'Todo modal deve nascer aria-hidden=true');
  }
  assert.match(css, /\.budget-modal-overlay\[hidden\][\s\S]*?display\s*:\s*none\s*!important/i);
  assert.match(css, /\.budget-modal-overlay \[hidden\][\s\S]*?display\s*:\s*none\s*!important/i);
  assert.match(css, /\.pdv-modal-overlay\.budget-modal-overlay\s*\{[\s\S]*?position\s*:\s*fixed/i);
});

test('budget modal controller toggles hidden, aria and body lock', () => {
  const vm = require('node:vm');
  const js = read('public/js/budgets.js');
  const makeClassList = () => {
    const set = new Set();
    return {
      add: (...xs) => xs.forEach((x) => set.add(x)),
      remove: (...xs) => xs.forEach((x) => set.delete(x)),
      contains: (x) => set.has(x),
      toggle: (x, force) => {
        if (force === true) { set.add(x); return true; }
        if (force === false) { set.delete(x); return false; }
        if (set.has(x)) { set.delete(x); return false; }
        set.add(x); return true;
      }
    };
  };
  const attrs = new Map([['aria-hidden', 'true']]);
  const modal = {
    hidden: true,
    classList: makeClassList(),
    setAttribute: (k, v) => attrs.set(k, String(v)),
    getAttribute: (k) => attrs.get(k)
  };
  const body = { classList: makeClassList() };
  const document = {
    readyState: 'loading',
    body,
    addEventListener: () => {},
    getElementById: (id) => id === 'budgetCreateModal' ? modal : null,
    querySelector: (sel) => sel === '.budget-modal-overlay.open:not([hidden])' && modal.classList.contains('open') && !modal.hidden ? modal : null,
    querySelectorAll: () => []
  };
  const context = {
    document,
    window: { appData: {} },
    console,
    crypto: { randomUUID: () => 'test-id' },
    setTimeout: () => {},
    clearTimeout: () => {},
    formatCurrency: (v) => String(v),
    URLSearchParams,
    location: { search: '' },
    fetch: async () => { throw new Error('fetch não deveria ser chamado'); }
  };
  vm.runInNewContext(js, context, { filename: 'budgets.js' });
  context.openBudgetModal('budgetCreateModal');
  assert.equal(modal.hidden, false);
  assert.equal(modal.getAttribute('aria-hidden'), 'false');
  assert.equal(modal.classList.contains('open'), true);
  assert.equal(body.classList.contains('budget-modal-open'), true);
  context.closeBudgetModal('budgetCreateModal');
  assert.equal(modal.hidden, true);
  assert.equal(modal.getAttribute('aria-hidden'), 'true');
  assert.equal(modal.classList.contains('open'), false);
  assert.equal(body.classList.contains('budget-modal-open'), false);
});

test('budget UI avoids native browser confirm/prompt dialogs', () => {
  const js = read('public/js/budgets.js');
  assert.doesNotMatch(js, /\b(?:window\.)?confirm\s*\(/);
  assert.doesNotMatch(js, /\b(?:window\.)?prompt\s*\(/);
  assert.match(js, /openBudgetConfirm\s*\(/);
});

test('budget assets are cache-busted after modal regression fix', () => {
  const layout = read('views/layout.ejs');
  assert.match(layout, /\/css\/<%= body %>\.css\?v=9/);
  assert.match(layout, /\/js\/<%= body %>\.js\?v=11/);
});

test('budget server forces quote snapshots and conversion only after approval', () => {
  const server = read('index.js');
  assert.match(server, /priceMode:\s*'snapshot'/);
  assert.match(server, /\['approved',\s*'acquiring_parts'\]\.includes\(budget\.status\)/);
  assert.doesNotMatch(server, /\['approved',\s*'acquiring_parts',\s*'sent',\s*'awaiting'\]\.includes\(budget\.status\)/);
});

test('budget page does not override global shared modal helpers', () => {
  const js = read('public/js/budgets.js');
  assert.doesNotMatch(js, /function\s+openModal\s*\(/);
  assert.doesNotMatch(js, /function\s+closeModal\s*\(/);
  assert.match(js, /function\s+openBudgetModal\s*\(/);
  assert.match(js, /function\s+closeBudgetModal\s*\(/);
});

test('budget print flow supports multi-page output and opens popup before async fetch', () => {
  const js = read('public/js/budget-templates.js');
  const fn = js.match(/async function printBudgetTemplatePdf\(budget\) \{[\s\S]*?\n\}/)?.[0] || '';
  assert.ok(fn, 'Função de impressão não encontrada');
  assert.ok(fn.indexOf("window.open('', '_blank')") < fn.indexOf("await fetchBudgetTemplateHtml('pdf', budget)"), 'Popup deve abrir antes do await para não ser bloqueado');
  assert.doesNotMatch(fn, /overflow\s*:\s*hidden/);
  assert.match(fn, /overflow:\s*visible/);
});

test('budget customer-facing HTML escapes dynamic text', () => {
  const server = read('index.js');
  assert.match(server, /function\s+budgetHtmlValue\s*\(/);
  assert.match(server, /budgetHtmlValue\(item\.name/);
  assert.match(server, /const\s+scalar\s*=\s*plainText\s*\?\s*safeTemplateValue\s*:\s*budgetHtmlValue/);
  assert.match(server, /plainText:\s*kind\s*===\s*'whatsapp'/);
});


test('budget modal styles are scoped and cannot restyle unrelated platform modals', () => {
  const css = read('public/css/budgets.css');
  const lines = css.split(/\r?\n/).filter((line) => line.includes('.pdv-modal-header') || line.includes('.pdv-modal-body') || line.includes('.pdv-modal-footer'));
  assert.ok(lines.length > 0);
  for (const line of lines) {
    // Every budget override for generic PDV modal internals must be under the budget overlay.
    assert.match(line, /budget-modal-overlay/, `Regra genérica de modal sem escopo: ${line}`);
  }
});

test('budget integrity guards prevent fake converted status, deleting sold quotes and unsafe name-only linking', () => {
  const server = read('index.js');
  assert.match(server, /requestedRawStatus === 'converted'/);
  assert.match(server, /Use a ação "Converter em venda"/);
  assert.match(server, /budgetForDelete\.saleId/);
  const finder = server.match(/async function findCustomerByContact\([\s\S]*?\n\}/)?.[0] || '';
  assert.ok(finder, 'findCustomerByContact não encontrada');
  assert.doesNotMatch(finder, /byName|nameNorm/);
});


test('budget copy flow has a fallback for local HTTP installations', () => {
  const js = read('public/js/budget-templates.js');
  assert.match(js, /window\.isSecureContext/);
  assert.match(js, /document\.execCommand\('copy'\)/);
  assert.match(js, /writeBudgetTextToClipboard/);
});
