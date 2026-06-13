let servicesData = [];
let workTemplates = [];

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
    const done = items.filter((i) => i.done).length;
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
        list.innerHTML = '<div class="empty-state"><div class="empty-icon">📭</div><p>Nenhuma ordem de serviço.</p><p class="text-muted" style="font-size:.85rem;margin-top:8px;">Crie uma nova OS no PDV → botão Ordem de serviço.</p></div>';
        return;
    }
    list.innerHTML = rows.map((s) => {
        const prog = repairProgress(s);
        const defects = defectiveItems(s).length;
        const doneCount = defectiveItems(s).filter((i) => i.done).length;
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
                    <span>${defects ? `${doneCount}/${defects} itens` : 'Sem checklist'}</span>
                    <strong>${prog}% reparado</strong>
                </div>
                <div class="svc-progress-mini"><span style="width:${prog}%"></span></div>
                <span class="svc-order-open-hint">Abrir fluxo de reparo →</span>
            </a>
        `;
    }).join('');

    if (highlightId) {
        const card = list.querySelector(`[data-service-id="${CSS.escape(highlightId)}"]`);
        card?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
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
    document.getElementById('btnOpenWorkTemplates')?.addEventListener('click', async () => {
        const modal = document.getElementById('svcTplModal');
        const list = document.getElementById('svcTplList');
        modal?.removeAttribute('hidden');
        if (list) list.innerHTML = '<p class="svc-tpl-empty">Carregando templates…</p>';
        await reloadWorkTemplatesFromApi();
        renderTplList();
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
        bindTemplatesModal();
        renderServicesList();
        await reloadServicesFromApi(false);
    });
}
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootServices);
} else {
    bootServices();
}
