let servicesData = Array.isArray(window.appData?.services) ? window.appData.services : [];
let statusFilter = 'all';

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
    let rows = servicesData.slice();
    if (statusFilter !== 'all') rows = rows.filter((s) => s.status === statusFilter);
    if (q) {
        rows = rows.filter((s) => {
            const hay = `${s.code} ${s.customerName} ${s.deviceType} ${s.deviceBrandModel}`.toLowerCase();
            return hay.includes(q);
        });
    }
    if (!rows.length) {
        list.innerHTML = '<div class="empty-state"><div class="empty-icon">📭</div><p>Nenhuma ordem.</p></div>';
        return;
    }
    list.innerHTML = rows.map((s) => {
        const prog = repairProgress(s);
        const defects = defectiveItems(s).length;
        const doneCount = defectiveItems(s).filter((i) => i.done).length;
        return `
            <a class="svc-order-card svc-order-card--link" href="/services/${encodeURIComponent(s.id)}">
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
}

function bootServices() {
    whenAppReady(() => {
        updateTopbarTitle('Oficina — Serviços');
        markNavActive('/services');
        renderAdminStats();
        renderStatusFilters();
        document.getElementById('serviceSearchInput')?.addEventListener('input', renderServicesList);
        renderServicesList();
    });
}
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootServices);
} else {
    bootServices();
}
