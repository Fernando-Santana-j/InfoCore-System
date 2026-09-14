const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('a execução da OS permite criar etapas sem template pré-selecionado', () => {
    const view = read('views/service-work.ejs');
    const js = read('public/js/service-work.js');

    assert.match(view, /id="svcStageModal"/);
    assert.match(view, /data-type="service"/);
    assert.match(view, /data-type="part"/);
    assert.match(view, /data-type="diagnostic"/);
    assert.match(js, /function openStageEditor\s*\(/);
    assert.match(js, /function saveStageEditor\s*\(/);
    assert.match(js, /defective:\s*true/);
    assert.doesNotMatch(js, /service-work-templates/);
});

test('etapas dinâmicas preservam tipo, valor e estado em andamento na API', () => {
    const server = read('index.js');
    const js = read('public/js/service-work.js');

    assert.match(server, /allowedWorkTypes = new Set\(\['service', 'part', 'diagnostic', 'other'\]\)/);
    assert.match(server, /workType:\s*allowedWorkTypes\.has/);
    assert.match(js, /itemOutcome = 'progress'/);
    assert.match(js, /done:\s*itemOutcome === 'done'/);
    assert.match(js, /archived:\s*itemOutcome === 'archive'/);
    assert.match(js, /estimatedPrice/);
});

test('o fluxo dinâmico oferece edição, exclusão e reordenação persistentes', () => {
    const js = read('public/js/service-work.js');
    const view = read('views/service-work.ejs');

    assert.match(js, /function moveCurrentStage\s*\(/);
    assert.match(js, /function deleteCurrentStage\s*\(/);
    assert.match(js, /function confirmDeleteCurrentStage\s*\(/);
    assert.match(js, /function persistStageChecklist\s*\(/);
    assert.match(js, /persistPatch\(patch\)/);
    assert.match(js, /stageChecklistWithLiveDraft/);
    assert.match(view, /id="svcDeleteModal"/);
    assert.match(view, /id="svcDeleteConfirmBtn"/);
});

test('a página Oficina cria OS vazia com orçamento novo, existente ou sem orçamento', () => {
    const view = read('views/services.ejs');
    const js = read('public/js/services.js');
    const server = read('index.js');

    assert.match(view, /id="btnCreateService"/);
    assert.match(view, /id="svcCreateModal"/);
    assert.match(view, /data-mode="existing"/);
    assert.match(view, /data-mode="new"/);
    assert.match(view, /data-mode="none"/);
    assert.match(js, /allowEmpty:\s*true/);
    assert.match(js, /skipBudget:\s*createServiceMode === 'none'/);
    assert.match(js, /existingBudgetId:/);
    assert.match(server, /const allowEmpty = body\.allowEmpty === true/);
    assert.match(server, /allowEmpty \? \[\] : defaultServiceChecklistState/);
    assert.match(server, /serviceOrderId:\s*id/);
});

test('bootstrap da Oficina fornece clientes e orçamentos para vínculo', () => {
    const server = read('index.js');
    const servicesScope = server.match(/if \(scope === 'services'\) \{[\s\S]*?\n        \}/)?.[0] || '';

    assert.match(servicesScope, /BUDGETS_COLLECTION/);
    assert.match(servicesScope, /loadCustomersNormalized/);
    assert.match(servicesScope, /budgets, customers/);
});

test('relatórios destinados ao cliente identificam os tipos criados dinamicamente', () => {
    const server = read('index.js');
    const publicView = read('views/service-share-public.ejs');
    const pdf = read('lib/service-report-export.js');

    assert.match(server, /function serviceWorkTypeLabel\s*\(/);
    assert.match(publicView, /Peça\/material/);
    assert.match(pdf, /Peça\/material/);
    assert.doesNotMatch(publicView, /estimatedPrice/);
    assert.doesNotMatch(pdf, /estimatedPrice/);
});
