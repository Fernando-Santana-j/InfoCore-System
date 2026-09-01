const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('budget PDF contains identified store and customer copies with a cut line', () => {
  const pdf = read('templates/budgets/pdf.html');
  assert.match(pdf, /VIA DA LOJA/);
  assert.match(pdf, /VIA DO CLIENTE/);
  assert.match(pdf, /LINHA DE CORTE/);
  assert.equal((pdf.match(/\{\{voucherHtml\}\}/g) || []).length, 2);
});

test('budget acceptance term is shown below the customer signature in PDF and PNG vouchers', () => {
  const server = read('index.js');
  const expected = 'Ao assinar, concordo que a máquina ou equipamento foi entregue e que o problema foi solucionado.';
  assert.ok(server.includes(expected));
  for (const file of ['templates/budgets/voucher.html', 'templates/budgets/voucher-print.html']) {
    const voucher = read(file);
    assert.match(voucher, /Assinatura do cliente[\s\S]*?\{\{signatureTerms\}\}/);
  }
});

test('large two-copy budgets fall back to safe multi-page printing', () => {
  const pdf = read('templates/budgets/pdf.html');
  const js = read('public/js/budget-templates.js');
  assert.match(pdf, /budget-print-area--multipage/);
  assert.match(pdf, /page-break-after:\s*always/);
  assert.match(js, /function prepareBudgetPrintLayout\s*\(/);
  assert.match(js, /copy\.scrollHeight\s*<=\s*maxCopyHeight/);
  assert.match(js, /classList\.toggle\('budget-print-area--multipage'/);
});

test('export does not hang on an already broken image and escapes the popup title', () => {
  const js = read('public/js/budget-templates.js');
  assert.match(js, /if \(img\.complete\) return Promise\.resolve\(\)/);
  assert.match(js, /setTimeout\(done, 5000\)/);
  assert.match(js, /<title>\$\{escapeBudgetTemplateHtml\(title\)\}<\/title>/);
});
