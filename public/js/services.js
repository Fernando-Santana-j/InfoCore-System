let servicesData = [];
let workTemplates = [];
let createServiceMode = 'existing';
let selectedCreateBudgetId = '';

function syncWorkTemplatesFromAppData() {
    workTemplates = Array.isArray(window.appData?.serviceWorkTemplates)
        ? window.appData.serviceWorkTemplates.slice()
        : [];
}
let statusFilter = 'all';
const SVC_DEVICE_TYPES = ['Celular', 'Notebook', 'Computador', 'Tablet', 'Outro'];

function esc(v) {
    return String(v || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function statusLabel(st) {
    const m = {
        open: 'Aberta',
        in_progress: 'Em andamento',
        waiting_parts: 'Aguardando peça',
        done: 'Concluída',
        delivered: 'Entregue'
    };
    return m[String(st || '')] || 'Aberta';
}

function defectiveItems(service) {
    return (service?.checklist || []).filter((i) => i.defective);
}

function repairProgress(service) {
    const items = defectiveItems(service);
    if (!items.length) return 0;
    const done = items.filter((i) => i.done || i.archived).length;
    return Math.round((done / items.length) * 100);
}

function openServiceWork(id) {
    window.location.href = `/services/${encodeURIComponent(id)}`;
}

function renderAdminStats() {
    const el = document.getElementById('svcAdminStats');
    if (!el) return;
    const open = servicesData.filter((s) => s.status === 'open' || s.status === 'in_progress').length;
    const waiting = servicesData.filter((s) => s.status === 'waiting_parts').length;
    el.innerHTML = `
        <div class="svc-stat-pill"><strong>${servicesData.length}</strong><span>Total</span></div>
        <div class="svc-stat-pill"><strong>${open}</strong><span>Em fila</span></div>
        <div class="svc-stat-pill"><strong>${waiting}</strong><span>Peças</span></div>
    `;
}

function renderStatusFilters() {
    const el = document.getElementById('svcStatusFilters');
    if (!el) return;
    const opts = [
        { id: 'all', label: 'Todas' },
        { id: 'open', label: 'Abertas' },
        { id: 'in_progress', label: 'Andamento' },
        { id: 'waiting_parts', label: 'Peças' },
        { id: 'done', label: 'Concluídas' }
    ];
    el.innerHTML = opts.map((o) => `
        <button type="button" class="svc-filter-chip ${statusFilter === o.id ? 'active' : ''}" data-filter="${o.id}">${o.label}</button>
    `).join('');
    el.querySelectorAll('.svc-filter-chip').forEach((btn) => {
        btn.addEventListener('click', () => {
            statusFilter = btn.getAttribute('data-filter') || 'all';
            renderStatusFilters();
            renderServicesList();
        });
    });
}

function renderServicesList() {
    const list = document.getElementById('servicesList');
    if (!list) return;
    const q = String(document.getElementById('serviceSearchInput')?.value || '').trim().toLowerCase();
    const highlightId = new URLSearchParams(window.location.search).get('highlight') || '';
    let rows = servicesData.slice();
    if (statusFilter !== 'all') rows = rows.filter((s) => s.status === statusFilter);
    if (q) {
        rows = rows.filter((s) => {
            const hay = `${s.code} ${s.customerName} ${s.deviceType} ${s.deviceBrandModel}`.toLowerCase();
            return hay.includes(q);
        });
    }
    if (!rows.length) {
        list.innerHTML = '<div class="empty-state"><div class="empty-icon">📭</div><p>Nenhuma ordem de serviço.</p><p class="text-muted svc-empty-copy">Crie a primeira OS diretamente por esta página.</p><button type="button" class="btn btn-primary btn-sm svc-empty-create" id="svcEmptyCreateBtn">+ Nova ordem de serviço</button></div>';
        document.getElementById('svcEmptyCreateBtn')?.addEventListener('click', openCreateServiceModal);
        return;
    }
    list.innerHTML = rows.map((s) => {
        const prog = repairProgress(s);
        const defects = defectiveItems(s).length;
        const doneCount = defectiveItems(s).filter((i) => i.done || i.archived).length;
        const isNew = highlightId && String(s.id) === String(highlightId);
        return `
            <a class="svc-order-card svc-order-card--link${isNew ? ' is-highlight' : ''}" href="/services/${encodeURIComponent(s.id)}" data-service-id="${esc(s.id)}">
                <div class="svc-order-card-top">
                    <span class="svc-order-code">${esc(s.code)}</span>
                    <span class="svc-status ${esc(s.status)}">${esc(statusLabel(s.status))}</span>
                </div>
                <h4>${esc(s.customerName)}</h4>
                <p class="svc-order-device">${esc(s.deviceType)} · ${esc(s.deviceBrandModel)}</p>
                <div class="svc-order-meta">
                    <span>${defects ? `${doneCount}/${defects} itens` : 'Sem etapas'}${s.budgetId ? ' · 🧾 com orçamento' : ''}</span>
                    <strong>${prog}% reparado</strong>
                </div>
                <div class="svc-progress-mini"><span style="width:${prog}%"></span></div>
                <span class="svc-order-open-hint">${defects ? 'Continuar fluxo de reparo' : 'Criar fluxo personalizado'} →</span>
            </a>
        `;
    }).join('');

    if (highlightId) {
        const card = list.querySelector(`[data-service-id="${CSS.escape(highlightId)}"]`);
        card?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
}

function createBudgets() {
    const rows = Array.isArray(window.appData?.budgets) ? window.appData.budgets : [];
    return rows
        .filter((budget) => budget?.id && !budget.serviceOrderId)
        .sort((a, b) => String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || '')));
}

function createCustomers() {
    const rows = window.appData?.customers;
    return Array.isArray(rows) ? rows : (rows && typeof rows === 'object' ? Object.values(rows) : []);
}

function createMoney(value) {
    return Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function createBudgetStatusLabel(status) {
    return ({ draft: 'Rascunho', sent: 'Enviado', approved: 'Aprovado', acquiring_parts: 'Adquirindo peças', rejected: 'Recusado', converted: 'Convertido' })[status] || 'Orçamento';
}

function populateCreateCustomers() {
    const select = document.getElementById('svcCreateCustomerSelect');
    if (!select) return;
    const customers = createCustomers().slice().sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'pt-BR'));
    select.innerHTML = '<option value="">Preencher manualmente</option>' + customers.map((customer) => `
        <option value="${esc(customer.id)}">${esc(customer.name)}${customer.phone ? ` · ${esc(customer.phone)}` : ''}</option>
    `).join('');
}

function fillCreateCustomer(customer) {
    document.getElementById('svcCreateCustomerName').value = customer?.customerName || customer?.name || '';
    document.getElementById('svcCreateCustomerPhone').value = customer?.customerPhone || customer?.phone || '';
    document.getElementById('svcCreateCustomerEmail').value = customer?.customerEmail || customer?.email || '';
}

function renderCreateBudgetResults(query = '') {
    const el = document.getElementById('svcCreateBudgetResults');
    if (!el || createServiceMode !== 'existing' || selectedCreateBudgetId) {
        if (el) el.innerHTML = '';
        return;
    }
    const term = String(query || '').trim().toLowerCase();
    const rows = createBudgets().filter((budget) => {
        if (!term) return true;
        return `${budget.code || ''} ${budget.customerName || ''} ${budget.customerPhone || ''}`.toLowerCase().includes(term);
    }).slice(0, 8);
    if (!rows.length) {
        el.innerHTML = '<div class="svc-create-no-budget">Nenhum orçamento livre encontrado. Escolha “Novo rascunho” ou “Sem orçamento”.</div>';
        return;
    }
    el.innerHTML = rows.map((budget) => `
        <button type="button" class="svc-create-budget-option" data-budget-id="${esc(budget.id)}">
            <span><strong>${esc(budget.code || 'Sem código')}</strong><small>${esc(budget.customerName || 'Cliente não informado')}</small></span>
            <span class="svc-create-budget-option-meta"><small>${esc(createBudgetStatusLabel(budget.status))}</small><strong>${esc(createMoney(budget.total))}</strong></span>
        </button>
    `).join('');
    el.querySelectorAll('[data-budget-id]').forEach((button) => {
        button.addEventListener('click', () => selectCreateBudget(button.getAttribute('data-budget-id')));
    });
}

function selectCreateBudget(id) {
    const budget = createBudgets().find((row) => String(row.id) === String(id));
    if (!budget) return;
    selectedCreateBudgetId = String(budget.id);
    document.getElementById('svcCreateBudgetId').value = selectedCreateBudgetId;
    document.getElementById('svcCreateBudgetResults').innerHTML = '';
    document.getElementById('svcCreateBudgetSearch').value = '';
    const selected = document.getElementById('svcCreateBudgetSelected');
    selected.hidden = false;
    selected.innerHTML = `
        <div><span>Orçamento selecionado</span><strong>${esc(budget.code || 'Sem código')} · ${esc(budget.customerName || 'Cliente')}</strong><small>${esc(createBudgetStatusLabel(budget.status))} · ${esc(createMoney(budget.total))}</small></div>
        <button type="button" class="btn btn-ghost btn-sm" id="svcCreateChangeBudgetBtn">Trocar</button>
    `;
    document.getElementById('svcCreateChangeBudgetBtn')?.addEventListener('click', clearCreateBudget);
    fillCreateCustomer(budget);
    document.getElementById('svcCreateCustomerSelect').value = budget.customerId || '';
    syncCreateCustomerLock();
}

function clearCreateBudget() {
    selectedCreateBudgetId = '';
    document.getElementById('svcCreateBudgetId').value = '';
    document.getElementById('svcCreateBudgetSelected').hidden = true;
    fillCreateCustomer(null);
    document.getElementById('svcCreateCustomerSelect').value = '';
    syncCreateCustomerLock();
    renderCreateBudgetResults(document.getElementById('svcCreateBudgetSearch')?.value);
}

function syncCreateCustomerLock() {
    const locked = createServiceMode === 'existing' && Boolean(selectedCreateBudgetId);
    ['svcCreateCustomerName', 'svcCreateCustomerPhone', 'svcCreateCustomerEmail'].forEach((id) => {
        const field = document.getElementById(id);
        if (field) field.readOnly = locked;
    });
    const picker = document.getElementById('svcCreateCustomerPickerWrap');
    if (picker) picker.hidden = locked;
}

function setCreateServiceMode(mode) {
    createServiceMode = ['existing', 'new', 'none'].includes(mode) ? mode : 'none';
    document.querySelectorAll('#svcCreateModes .svc-create-mode').forEach((button) => {
        const active = button.getAttribute('data-mode') === createServiceMode;
        button.classList.toggle('is-active', active);
        button.setAttribute('aria-pressed', String(active));
    });
    const picker = document.getElementById('svcCreateBudgetPicker');
    picker.hidden = createServiceMode !== 'existing';
    const note = document.getElementById('svcCreateModeNote');
    if (createServiceMode === 'new') {
        note.hidden = false;
        note.innerHTML = '<span>🧾</span><div><strong>Um orçamento rascunho será criado automaticamente.</strong><small>Você poderá completar itens, valores e condições na página de Orçamentos.</small></div>';
    } else if (createServiceMode === 'none') {
        note.hidden = false;
        note.innerHTML = '<span>📭</span><div><strong>A OS ficará independente.</strong><small>Você ainda poderá registrar etapas e fotos normalmente.</small></div>';
    } else {
        note.hidden = true;
        note.innerHTML = '';
    }
    if (createServiceMode !== 'existing' && selectedCreateBudgetId) clearCreateBudget();
    syncCreateCustomerLock();
    if (createServiceMode === 'existing') renderCreateBudgetResults();
}

function openCreateServiceModal() {
    const modal = document.getElementById('svcCreateModal');
    const form = document.getElementById('svcCreateForm');
    if (!modal || !form) return;
    form.reset();
    selectedCreateBudgetId = '';
    document.getElementById('svcCreateBudgetId').value = '';
    document.getElementById('svcCreateBudgetSelected').hidden = true;
    populateCreateCustomers();
    setCreateServiceMode(createBudgets().length ? 'existing' : 'none');
    modal.hidden = false;
    modal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    window.setTimeout(() => {
        const target = createServiceMode === 'existing' ? document.getElementById('svcCreateBudgetSearch') : document.getElementById('svcCreateCustomerName');
        target?.focus();
    }, 0);
}

function closeCreateServiceModal() {
    const modal = document.getElementById('svcCreateModal');
    if (!modal) return;
    modal.hidden = true;
    modal.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
}

async function submitCreateService(event) {
    event.preventDefault();
    if (createServiceMode === 'existing' && !selectedCreateBudgetId) {
        showToast('Selecione o orçamento que será vinculado.', 'error');
        document.getElementById('svcCreateBudgetSearch')?.focus();
        return;
    }
    const selectedBudget = createServiceMode === 'existing'
        ? createBudgets().find((row) => String(row.id) === selectedCreateBudgetId)
        : null;
    const customerId = createServiceMode === 'existing'
        ? (selectedBudget?.customerId || '')
        : (document.getElementById('svcCreateCustomerSelect')?.value || '');
    const payload = {
        customerId,
        customerName: document.getElementById('svcCreateCustomerName')?.value?.trim(),
        customerPhone: document.getElementById('svcCreateCustomerPhone')?.value?.trim(),
        customerEmail: document.getElementById('svcCreateCustomerEmail')?.value?.trim(),
        deviceType: document.getElementById('svcCreateDeviceType')?.value,
        deviceBrandModel: document.getElementById('svcCreateDeviceModel')?.value?.trim(),
        priority: document.getElementById('svcCreatePriority')?.value,
        accessories: document.getElementById('svcCreateAccessories')?.value?.trim(),
        issueReport: document.getElementById('svcCreateIssue')?.value?.trim(),
        estimateValue: selectedBudget ? Number(selectedBudget.total) || null : null,
        checklist: [],
        allowEmpty: true,
        skipBudget: createServiceMode === 'none',
        existingBudgetId: createServiceMode === 'existing' ? selectedCreateBudgetId : ''
    };
    const button = document.getElementById('svcCreateSubmitBtn');
    button.disabled = true;
    button.textContent = 'Criando ordem...';
    try {
        const response = await fetch('/api/services', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify(payload)
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || data.error) throw new Error(data.message || 'Não foi possível criar a OS.');
        servicesData.unshift(data.service);
        window.appData.services = servicesData;
        if (data.budget?.id) {
            const budgets = Array.isArray(window.appData.budgets) ? window.appData.budgets : [];
            window.appData.budgets = [data.budget, ...budgets.filter((row) => String(row.id) !== String(data.budget.id))];
        }
        closeCreateServiceModal();
        showToast(`OS ${data.service.code} criada. Abrindo o fluxo livre...`, 'success');
        window.setTimeout(() => { window.location.href = `/services/${encodeURIComponent(data.service.id)}`; }, 250);
    } catch (error) {
        showToast(error.message || 'Erro ao criar ordem de serviço.', 'error');
    } finally {
        button.disabled = false;
        button.textContent = 'Criar OS e abrir fluxo →';
    }
}

function bindCreateServiceModal() {
    document.getElementById('btnCreateService')?.addEventListener('click', openCreateServiceModal);
    document.getElementById('svcCreateCloseBtn')?.addEventListener('click', closeCreateServiceModal);
    document.getElementById('svcCreateCancelBtn')?.addEventListener('click', closeCreateServiceModal);
    document.getElementById('svcCreateForm')?.addEventListener('submit', submitCreateService);
    document.getElementById('svcCreateModal')?.addEventListener('click', (event) => {
        if (event.target.id === 'svcCreateModal') closeCreateServiceModal();
    });
    document.querySelectorAll('#svcCreateModes .svc-create-mode').forEach((button) => {
        button.addEventListener('click', () => setCreateServiceMode(button.getAttribute('data-mode')));
    });
    document.getElementById('svcCreateBudgetSearch')?.addEventListener('input', (event) => renderCreateBudgetResults(event.target.value));
    document.getElementById('svcCreateCustomerSelect')?.addEventListener('change', (event) => {
        const customer = createCustomers().find((row) => String(row.id) === String(event.target.value));
        fillCreateCustomer(customer);
    });
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && document.getElementById('svcCreateModal')?.hidden === false) closeCreateServiceModal();
    });
}

async function reloadWorkTemplatesFromApi() {
    try {
        const res = await fetch('/api/service-work-templates', { credentials: 'same-origin' });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || data.error) {
            throw new Error(data.message || 'Erro ao carregar templates.');
        }
        workTemplates = Array.isArray(data.templates) ? data.templates : [];
        window.appData.serviceWorkTemplates = workTemplates;
        return true;
    } catch (e) {
        console.error(e);
        syncWorkTemplatesFromAppData();
        return false;
    }
}

async function reloadServicesFromApi(showSuccessToast = true) {
    const btn = document.getElementById('btnRefreshServices');
    if (btn) {
        btn.disabled = true;
        btn.textContent = '↻ ...';
    }
    try {
        const res = await fetch('/api/services', { credentials: 'same-origin' });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || data.error) {
            throw new Error(data.message || 'Erro ao atualizar lista.');
        }
        servicesData = Array.isArray(data.services) ? data.services : [];
        window.appData.services = servicesData;
        renderAdminStats();
        renderServicesList();
        if (showSuccessToast) {
            showToast(`${servicesData.length} ordem(ns) carregada(s).`, 'success');
        }
    } catch (e) {
        console.error(e);
        if (showSuccessToast) showToast(e.message || 'Erro ao atualizar.', 'error');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.textContent = '↻ Atualizar';
        }
    }
}

function formatTplDeviceTypes(t) {
    const types = Array.isArray(t?.deviceTypes) ? t.deviceTypes.filter(Boolean) : [];
    if (!types.length) return 'Todos os aparelhos';
    return types.join(' · ');
}

function renderTplList() {
    const el = document.getElementById('svcTplList');
    if (!el) return;
    if (!workTemplates.length) {
        el.innerHTML = '<p class="svc-tpl-empty">Nenhum template. Crie o primeiro (ex.: Limpeza).</p>';
        return;
    }
    el.innerHTML = workTemplates.map((t) => `
        <button type="button" class="svc-tpl-item" data-id="${esc(t.id)}">
            <span class="svc-tpl-item-icon">${esc(t.icon || '🔧')}</span>
            <span class="svc-tpl-item-body">
                <strong>${esc(t.name)}</strong>
                <span>${(t.stages || []).length} etapa(s) · ${t.active ? 'Ativo' : 'Inativo'}</span>
                <span class="svc-tpl-item-devices">${esc(formatTplDeviceTypes(t))}</span>
            </span>
        </button>
    `).join('');
    el.querySelectorAll('.svc-tpl-item').forEach((btn) => {
        btn.addEventListener('click', () => openTplForm(btn.getAttribute('data-id')));
    });
}

function renderTplDeviceChips(selected = []) {
    const el = document.getElementById('svcTplDevices');
    if (!el) return;
    const set = new Set(selected);
    el.innerHTML = SVC_DEVICE_TYPES.map((d) => `
        <label class="svc-tpl-chip"><input type="checkbox" value="${esc(d)}" ${set.has(d) ? 'checked' : ''}> ${esc(d)}</label>
    `).join('');
}

function addTplStageRow(data = {}) {
    const wrap = document.getElementById('svcTplStages');
    if (!wrap) return;
    const row = document.createElement('div');
    row.className = 'svc-tpl-stage-row';
    row.innerHTML = `
        <input class="form-input" data-field="icon" placeholder="🔧" value="${esc(data.icon || '')}" maxlength="4" style="width:52px">
        <input class="form-input" data-field="label" placeholder="Nome da etapa *" value="${esc(data.label || '')}" required>
        <input class="form-input" data-field="note" placeholder="Nota padrão (opcional)" value="${esc(data.defaultNote || '')}">
        <button type="button" class="btn btn-ghost btn-sm svc-tpl-stage-rm" title="Remover">✕</button>
    `;
    row.querySelector('.svc-tpl-stage-rm')?.addEventListener('click', () => row.remove());
    wrap.appendChild(row);
}

function openTplForm(id) {
    const form = document.getElementById('svcTplForm');
    const listWrap = document.querySelector('.svc-tpl-list-wrap');
    if (!form) return;
    form.hidden = false;
    if (listWrap) listWrap.style.display = 'none';
    const tpl = workTemplates.find((t) => String(t.id) === String(id));
    document.getElementById('svcTplId').value = tpl?.id || '';
    document.getElementById('svcTplName').value = tpl?.name || '';
    document.getElementById('svcTplIcon').value = tpl?.icon || '🔧';
    document.getElementById('svcTplDesc').value = tpl?.description || '';
    document.getElementById('svcTplActive').checked = tpl ? tpl.active !== false : true;
    renderTplDeviceChips(tpl?.deviceTypes || []);
    const stagesEl = document.getElementById('svcTplStages');
    if (stagesEl) {
        stagesEl.innerHTML = '';
        (tpl?.stages || []).forEach((s) => addTplStageRow(s));
        if (!tpl?.stages?.length) addTplStageRow();
    }
}

function closeTplForm() {
    document.getElementById('svcTplForm')?.setAttribute('hidden', '');
    const listWrap = document.querySelector('.svc-tpl-list-wrap');
    if (listWrap) listWrap.style.display = '';
}

async function saveTplForm(e) {
    e.preventDefault();
    const id = document.getElementById('svcTplId')?.value;
    const stages = [];
    document.querySelectorAll('#svcTplStages .svc-tpl-stage-row').forEach((row, i) => {
        const label = row.querySelector('[data-field="label"]')?.value?.trim();
        if (!label) return;
        stages.push({
            key: `stage-${i + 1}`,
            label,
            icon: row.querySelector('[data-field="icon"]')?.value?.trim() || '🔧',
            defaultNote: row.querySelector('[data-field="note"]')?.value?.trim() || '',
            sortOrder: i
        });
    });
    if (!stages.length) {
        showToast('Adicione ao menos uma etapa.', 'error');
        return;
    }
    const deviceTypes = [...document.querySelectorAll('#svcTplDevices input:checked')].map((c) => c.value);
    const payload = {
        name: document.getElementById('svcTplName')?.value?.trim(),
        icon: document.getElementById('svcTplIcon')?.value?.trim() || '🔧',
        description: document.getElementById('svcTplDesc')?.value?.trim(),
        deviceTypes,
        stages,
        active: document.getElementById('svcTplActive')?.checked !== false
    };
    const url = id ? `/api/service-work-templates/${encodeURIComponent(id)}` : '/api/service-work-templates';
    const method = id ? 'PATCH' : 'POST';
    const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok || data.error) {
        showToast(data.message || 'Erro ao salvar.', 'error');
        return;
    }
    const saved = data.template;
    const idx = workTemplates.findIndex((t) => String(t.id) === String(saved.id));
    if (idx >= 0) workTemplates[idx] = saved;
    else workTemplates.push(saved);
    window.appData.serviceWorkTemplates = workTemplates;
    closeTplForm();
    renderTplList();
    showToast('Template salvo.', 'success');
}

function bindTemplatesModal() {
    document.getElementById('btnOpenWorkTemplates')?.addEventListener('click', () => {
        const modal = document.getElementById('svcTplModal');
        modal?.removeAttribute('hidden');
        renderTplList();
        void reloadWorkTemplatesFromApi().then(() => renderTplList());
    });
    document.getElementById('svcTplCloseBtn')?.addEventListener('click', () => {
        document.getElementById('svcTplModal')?.setAttribute('hidden', '');
        closeTplForm();
    });
    document.getElementById('svcTplModal')?.addEventListener('click', (e) => {
        if (e.target.id === 'svcTplModal') {
            e.target.setAttribute('hidden', '');
            closeTplForm();
        }
    });
    document.getElementById('svcTplNewBtn')?.addEventListener('click', () => openTplForm(''));
    document.getElementById('svcTplCancelFormBtn')?.addEventListener('click', closeTplForm);
    document.getElementById('svcTplAddStageBtn')?.addEventListener('click', () => addTplStageRow());
    document.getElementById('svcTplForm')?.addEventListener('submit', saveTplForm);
}

function bootServices() {
    whenAppReady(async () => {
        servicesData = Array.isArray(window.appData?.services) ? window.appData.services : [];
        syncWorkTemplatesFromAppData();
        updateTopbarTitle('Oficina — Serviços');
        markNavActive('/services');
        renderAdminStats();
        renderStatusFilters();
        document.getElementById('serviceSearchInput')?.addEventListener('input', renderServicesList);
        document.getElementById('btnRefreshServices')?.addEventListener('click', () => reloadServicesFromApi(true));
        bindCreateServiceModal();
        bindTemplatesModal();
        renderServicesList();
    });
}
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootServices);
} else {
    bootServices();
}
