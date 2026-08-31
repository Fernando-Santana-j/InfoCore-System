const test = require('node:test');
const assert = require('node:assert/strict');
const d = require('../lib/budget-domain');

test('legacy finalized normalizes to sent', () => assert.equal(d.normalizeStatus('finalized'), 'sent'));
test('unknown status normalizes to draft', () => assert.equal(d.normalizeStatus('x'), 'draft'));
test('validity cannot be before emission', () => assert.equal(d.validateDates('2026-08-29','2026-08-28').error, true));
test('default validity can be computed', () => assert.equal(d.addDaysIso('2026-08-29',7), '2026-09-05'));
test('fixed discount and extra are computed in cents', () => {
  const r = d.applyAdjustment(100, {type:'fixed',value:10.01}, {type:'fixed',value:5.02});
  assert.equal(r.total, 95.01);
});
test('percentage adjustment is capped', () => {
  const r = d.applyAdjustment(100, {type:'percent',value:150}, {type:'fixed',value:0});
  assert.equal(r.total, 0);
});
test('item preserves condition warranty and special order', () => {
  const x = d.normalizeItem({name:'GPU',qty:1,unitPrice:800,unitCost:600,condition:'used',warranty:'90 dias',specialOrder:true});
  assert.equal(x.condition,'used'); assert.equal(x.warranty,'90 dias'); assert.equal(x.specialOrder,true);
});
test('option computes cost profit and margin', () => {
  const o = d.computeOption({items:[{name:'A',qty:2,unitPrice:100,unitCost:60}]});
  assert.equal(o.subtotal,200); assert.equal(o.costTotal,120); assert.equal(o.profit,80); assert.equal(o.margin,40);
});
test('card machine and six-installment totals are computed in cents', () => {
  const p = d.computeCardPayments(1000);
  assert.equal(p.cardTotal, 1096.70);
  assert.equal(p.installmentTotal, 1096.70);
  assert.equal(p.installments, 6);
  assert.equal(p.installmentValue, 182.78);
});
test('option discount affects profit', () => {
  const o = d.computeOption({items:[{name:'A',qty:1,unitPrice:100,unitCost:60}],discount:{type:'fixed',value:20}});
  assert.equal(o.total,80); assert.equal(o.profit,20); assert.equal(o.margin,25);
});
test('legacy budget items become one option', () => {
  const opts = d.normalizeOptions({items:[{name:'A',qty:1,unitPrice:10}],discount:1,extra:0});
  assert.equal(opts.length,1); assert.equal(opts[0].total,9);
});
test('only one option remains recommended', () => {
  const opts = d.normalizeOptions({options:[{recommended:true,items:[{name:'A',qty:1,unitPrice:1}]},{recommended:true,items:[{name:'B',qty:1,unitPrice:1}]}]});
  assert.equal(opts.filter(x=>x.recommended).length,1);
});
test('selected option wins over recommended', () => {
  const opts = d.normalizeOptions({options:[{id:'a',recommended:true,items:[{name:'A',qty:1,unitPrice:1}]},{id:'b',items:[{name:'B',qty:1,unitPrice:2}]}]});
  assert.equal(d.bestOption(opts,'b').id,'b');
});
test('template normalizes defaults and financials', () => {
  const t = d.normalizeTemplate({id:'t',name:'PC Gamer',items:[{name:'CPU',qty:1,unitPrice:600,unitCost:500}]});
  assert.equal(t.defaultValidDays,7); assert.equal(t.profit,100); assert.equal(t.margin,16.67);
});
test('price mode accepts live and defaults snapshot', () => {
  assert.equal(d.normalizePriceMode('live'),'live'); assert.equal(d.normalizePriceMode('bad'),'snapshot');
});
test('state values are constrained', () => {
  assert.equal(d.normalizeCondition('semi_new'),'semi_new'); assert.equal(d.normalizeCondition('broken'),'new');
});


test('duplicate product lines aggregate stock requirement', () => {
  const grouped = d.aggregateProductQuantities([
    { kind: 'product', productId: 'p1', qty: 1 },
    { kind: 'product', productId: 'p1', qty: 2 },
    { kind: 'product', productId: 'p2', qty: 4 },
    { kind: 'custom', productId: 'p1', qty: 50 }
  ]);
  assert.equal(grouped.get('p1'), 3);
  assert.equal(grouped.get('p2'), 4);
  assert.equal(grouped.size, 2);
});


test('sent/awaiting budgets become effectively expired after validity date', () => {
  assert.equal(d.effectiveStatus('sent', '2026-08-20', '2026-08-29'), 'expired');
  assert.equal(d.effectiveStatus('awaiting', '2026-08-20', '2026-08-29'), 'expired');
  assert.equal(d.effectiveStatus('approved', '2026-08-20', '2026-08-29'), 'approved');
  assert.equal(d.effectiveStatus('sent', '2026-09-05', '2026-08-29'), 'sent');
});

test('item quantity is normalized to whole units', () => {
  const item = d.normalizeItem({ name: 'Mouse', qty: 2.9, unitPrice: 10 });
  assert.equal(item.qty, 2);
  assert.equal(item.total, 20);
});

test('aggregate stock requirement ignores fractional quantity', () => {
  const grouped = d.aggregateProductQuantities([
    { kind: 'product', productId: 'p1', qty: 1.9 },
    { kind: 'product', productId: 'p1', qty: 2.2 }
  ]);
  assert.equal(grouped.get('p1'), 3);
});
