
function escapeHtml(s) {
    return String(s || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

async function apiJson(url, opts = {}) {
    const defaults = {
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        ...opts
    };
    const r = await fetch(url, defaults);
    const data = await r.json().catch(() => ({}));
    if (!r.ok || data.error) {
        showToast(data.message || 'Algo deu errado na requisição.', 'error');
        throw new Error(data.message || 'request failed');
    }
    return data;
}

const REQUEST_LABELS = {
    open: 'Aberta',
    in_progress: 'Em andamento',
    done: 'Concluída',
    cancelled: 'Cancelada'
};

let selectedId = null;
let pendingRequestCustomerId = null;

function customerListSorted() {
    const { customers } = window.appData || {};
    return Array.isArray(customers)
        ? [...customers].sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')))
        : [];
}

function getFilteredClients(q) {
    const term = q.trim().toLowerCase();
    const list = customerListSorted();
    if (!term) return list;
    return list.filter((c) =>
        String(c.name || '').toLowerCase().includes(term) ||
        String(c.email || '').toLowerCase().includes(term) ||
        String(c.phone || '').includes(term) ||
        String(c.doc || '').includes(term));
}

function badgeClass(st) {
    const map = { open: 'open', in_progress: 'progress', done: 'done', cancelled: 'cancelled' };
    const slug = map[String(st || 'open')] || 'open';
    return `req-badge bs-${slug}`;
}

function formatShortDate(ds) {
    if (!ds) return 'Sem data';
    const d = String(ds).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return ds;
    const [y, m, da] = d.split('-');
    return `${da}/${m}/${y}`;
}

function refreshCount(n) {
    const el = document.getElementById('clientListCount');
    if (el) el.textContent = `${n} cliente${n === 1 ? '' : 's'}`;
}

function renderClientList(filterValue) {
    const list = getFilteredClients(filterValue || '');
    refreshCount(list.length);

    const mount = document.getElementById('clientListMount');
    if (!mount) return;

    if (!list.length) {
        mount.innerHTML = `<div class="empty-state"><div class="empty-icon">📭</div><p>Nenhum cliente nesta lista.</p></div>`;
        return;
    }

    mount.innerHTML = list.map((c) => {
        const letter = escapeHtml(String(c.name || '?').trim().slice(0, 1).toUpperCase());
        const openReq = (Array.isArray(c.requests) ? c.requests : []).filter((r) => r.status !== 'done' && r.status !== 'cancelled').length;
        const subtitle = `${c.phone ? escapeHtml(c.phone) + ' · ' : ''}${openReq ? openReq + ' requi. em aberto' : 'histórico de requisições'}`;
        const active = c.id === selectedId ? 'is-active' : '';
        return `
      <article class="crm-chip ${active}" data-client-id="${escapeHtml(c.id)}" tabindex="0" role="button">
        <div class="crm-chip-avatar">${letter}</div>
        <div class="crm-chip-body">
          <div class="crm-chip-name">${escapeHtml(c.name)}</div>
          <div class="crm-chip-meta">${subtitle}</div>
        </div>
      </article>`;
    }).join('');

    mount.querySelectorAll('.crm-chip').forEach((el) => {
        el.addEventListener('click', () => selectClient(el.getAttribute('data-client-id')));
        el.addEventListener('keydown', (ev) => {
            if (ev.key === 'Enter' || ev.key === ' ') {
                ev.preventDefault();
                selectClient(el.getAttribute('data-client-id'));
            }
        });
    });
}

function selectClient(id) {
    selectedId = id;
    const q = document.getElementById('clientSearch')?.value || '';
    renderClientList(q);

    const c = customerListSorted().find((x) => x.id === id);
    const mount = document.getElementById('clientDetailMount');
    if (!mount) return;

    if (!c) {
        mount.innerHTML = `<div class="card crm-empty card--muted"><div class="crm-empty-inner"><p class="crm-empty-title">Cliente não encontrado</p></div></div>`;
        return;
    }

    mount.innerHTML = buildDetailMarkup(c);

    bindDetailActions(c.id);
}

function budgetsForCustomer(c) {
    const budgets = Array.isArray(window.appData?.budgets) ? window.appData.budgets : [];
    const cid = String(c?.id || '').trim();
    const nameKey = String(c?.name || '').trim().toLowerCase();
    return budgets.filter((b) => {
        if (cid && String(b.customerId || '').trim() === cid) return true;
        if (!b.customerId && nameKey && String(b.customerName || '').trim().toLowerCase() === nameKey) return true;
        return false;
    }).sort((a, b) => String(b.code || '').localeCompare(String(a.code || '')));
}

function buildDetailMarkup(c) {
    const reqs = Array.isArray(c.requests) ? c.requests : [];
    const clientBudgets = budgetsForCustomer(c);

    const reqBlocks = reqs.length
        ? reqs.map((r) => {
            const st = String(r.status || 'open');
            const options = ['open', 'in_progress', 'done', 'cancelled'].map((v) =>
                `<option value="${escapeHtml(v)}"${v === st ? ' selected' : ''}>${REQUEST_LABELS[v]}</option>`
            ).join('');

            return `
        <article class="req-card req-${escapeHtml(st)}" data-req="${escapeHtml(r.id)}">
          <div class="req-top">
            <div class="req-title-row">
              <h4 class="req-title">${escapeHtml(r.title)}</h4>
              <span class="${badgeClass(st)}">${REQUEST_LABELS[st]}</span>
            </div>
            <button class="btn btn-ghost btn-sm" type="button" data-action="del-req" data-id="${escapeHtml(r.id)}">Remover</button>
          </div>
          ${r.description ? `<p class="req-desc">${escapeHtml(r.description)}</p>` : ''}
          <div class="req-footer">
            <span class="req-date-muted">Solicitação · ${escapeHtml(formatShortDate(r.date))}</span>
            <div class="req-controls">
              <label class="visually-hidden" for="st-${escapeHtml(r.id)}">Status da requisição</label>
              <select id="st-${escapeHtml(r.id)}" class="form-input req-status-select" data-action="chg-req" data-id="${escapeHtml(r.id)}">${options}</select>
            </div>
          </div>
        </article>`;
        }).join('')
        : `<p style="margin:0;color:var(--text3);font-size:0.88rem;">Nenhuma requisição registrada ainda.</p>`;

    const spent = typeof c.spent === 'number' ? c.spent : Number(c.spent) || 0;
    const pur = typeof c.purchases === 'number' ? c.purchases : Number(c.purchases) || 0;

    return `
    <div class="card crm-detail-hero">
      <div class="crm-detail-toolbar">
        <div>
          <p class="crm-kicker">Ficha cadastral</p>
          <h3 class="crm-detail-name">${escapeHtml(c.name)}</h3>
          <p class="crm-detail-line">${escapeHtml(c.doc)} ${c.doc && c.phone ? '· ' : ''} ${escapeHtml(c.phone)}</p>
          <p class="crm-detail-line">${escapeHtml(c.email)}</p>
          ${c.address ? `<p class="crm-detail-line">${escapeHtml(c.address)}</p>` : ''}
        </div>
        <div class="crm-actions">
          <button class="btn btn-ghost btn-sm" type="button" data-action="edit">✏️ Editar</button>
          <button class="btn btn-primary btn-sm" type="button" data-action="request">📌 Nova requisição</button>
          <button class="btn btn-ghost btn-sm text-danger-btn" type="button" data-action="delete-customer">Excluir cliente</button>
        </div>
      </div>
      <div class="stat-row" style="margin-top:14px;">
        <div class="stat-pill">
          <div class="stat-pill-label">Compras (PDV)</div>
          <div class="stat-pill-value mono">${pur}</div>
        </div>
        <div class="stat-pill">
          <div class="stat-pill-label">Volume em vendas</div>
          <div class="stat-pill-value mono gold">${formatCurrency(spent)}</div>
        </div>
        <div class="stat-pill">
          <div class="stat-pill-label">Requisições</div>
          <div class="stat-pill-value mono">${reqs.length}</div>
        </div>
        <div class="stat-pill">
          <div class="stat-pill-label">Orçamentos</div>
          <div class="stat-pill-value mono">${clientBudgets.length}</div>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="crm-requests-head">
        <div class="crm-section-title" style="margin:0;">Orçamentos</div>
        <a class="btn btn-primary btn-sm" href="/budgets?customer=${encodeURIComponent(String(c.id || ''))}">+ Novo orçamento</a>
      </div>
      <div class="crm-budgets-list">
        ${clientBudgets.length
        ? clientBudgets.map((b) => `
          <article class="crm-budget-row">
            <div class="crm-budget-row-head">
              <strong class="mono">${escapeHtml(b.code || 'ORC')}</strong>
              <span class="badge ${b.status === 'finalized' ? 'green' : ''}">${b.status === 'finalized' ? 'Finalizado' : 'Rascunho'}</span>
            </div>
            <div class="crm-budget-row-meta">
              <span>Validade: ${escapeHtml(b.validUntil || 'N/I')}</span>
              <span class="mono gold-fg">${formatCurrency(Number(b.total) || 0)}</span>
            </div>
          </article>`).join('')
        : '<p style="margin:0;color:var(--text3);font-size:0.88rem;">Nenhum orçamento vinculado a este cliente.</p>'}
      </div>
    </div>

    <div class="card">
      <div class="crm-section-title">Descrição · observações</div>
      <p class="crm-notes-block">${c.notes ? escapeHtml(c.notes) : '— Sem observações —'}</p>
    </div>

    <div class="card">
      <div class="crm-requests-head">
        <div class="crm-section-title" style="margin:0;">Requisitado pelo cliente</div>
        <button class="btn btn-primary btn-sm" type="button" data-action="request">Registrar requisição</button>
      </div>
      <div class="requests-timeline" id="requestsTimeline">${reqBlocks}</div>
    </div>`;
}

function bindDetailActions(clientId) {
    const wrap = document.getElementById('clientDetailMount');
    if (!wrap) return;

    wrap.querySelectorAll('[data-action="edit"]').forEach((btn) =>
        btn.addEventListener('click', () => openEditCustomer(clientId)));

    wrap.querySelectorAll('[data-action="request"]').forEach((btn) =>
        btn.addEventListener('click', () => openRequestModal(clientId)));

    wrap.querySelectorAll('[data-action="delete-customer"]').forEach((btn) =>
        btn.addEventListener('click', () => removeCustomer(clientId)));

    wrap.querySelectorAll('[data-action="del-req"]').forEach((btn) =>
        btn.addEventListener('click', async () => {
            const rid = btn.getAttribute('data-id');
            await removeRequest(clientId, rid);
        }));

    wrap.querySelectorAll('[data-action="chg-req"]').forEach((sel) =>
        sel.addEventListener('change', async () => {
            const rid = sel.getAttribute('data-id');
            await updateRequestStatus(clientId, rid, sel.value);
        }));
}

async function updateRequestStatus(clientId, requestId, newStatus) {
    const c = (window.appData.customers || []).find((x) => x.id === clientId);
    if (!c) return;
    const next = (c.requests || []).map((r) => (String(r.id) === String(requestId) ? { ...r, status: newStatus } : r));

    try {
        const data = await apiJson(`/api/customers/${encodeURIComponent(clientId)}`, {
            method: 'PATCH',
            body: JSON.stringify({ requests: next })
        });

        upsertCustomerInState(data.customer);
        const q = document.getElementById('clientSearch')?.value || '';
        renderClientList(q);
        selectClient(clientId);
        showToast('Status atualizado.', 'success');
    } catch {
        renderClientList(document.getElementById('clientSearch')?.value || '');
        selectClient(clientId);
    }
}

async function removeRequest(clientId, requestId) {
    const c = (window.appData.customers || []).find((x) => x.id === clientId);
    if (!c) return;
    const next = (c.requests || []).filter((r) => String(r.id) !== String(requestId));

    try {
        const data = await apiJson(`/api/customers/${encodeURIComponent(clientId)}`, {
            method: 'PATCH',
            body: JSON.stringify({ requests: next })
        });
        upsertCustomerInState(data.customer);
        const q = document.getElementById('clientSearch')?.value || '';
        renderClientList(q);
        selectClient(clientId);
        showToast('Requisição removida.', 'success');
    } catch {}
}

async function removeCustomer(clientId) {
    if (!window.confirm('Tem certeza que deseja excluir este cliente?')) return;

    try {
        await apiJson(`/api/customers/${encodeURIComponent(clientId)}`, { method: 'DELETE' });
        window.appData.customers = (window.appData.customers || []).filter((c) => c.id !== clientId);
        selectedId = null;

        const q = document.getElementById('clientSearch')?.value || '';
        renderClientList(q);
        const mount = document.getElementById('clientDetailMount');
        if (mount) {
            mount.innerHTML = `<div class="card crm-empty card--muted"><div class="crm-empty-inner">
          <div class="crm-empty-icon">👋</div>
          <p class="crm-empty-title">Selecione um cliente</p>
          <p class="crm-empty-text">Ou cadastre um novo para iniciar.</p></div></div>`;
        }
        showToast('Cliente excluído.', 'success');
    } catch {}
}

function upsertCustomerInState(c) {
    if (!window.appData.customers) window.appData.customers = [];
    const idx = window.appData.customers.findIndex((x) => x.id === c.id);
    if (idx >= 0) window.appData.customers[idx] = c;
    else window.appData.customers.push(c);
}

function openNewCustomerForm() {
    document.getElementById('customerModalTitle').textContent = 'Novo cliente';
    document.getElementById('editCustomerId').value = '';
    ['custName', 'custDoc', 'custPhone', 'custEmail', 'custAddress', 'custNotes'].forEach((fid) => {
        const el = document.getElementById(fid);
        if (el) el.value = '';
    });
    openModal('customerForm');
}

function openEditCustomer(customerId) {
    const c = customerListSorted().find((x) => x.id === customerId);
    if (!c) return;

    document.getElementById('customerModalTitle').textContent = 'Editar cliente';
    document.getElementById('editCustomerId').value = customerId;

    document.getElementById('custName').value = c.name || '';
    document.getElementById('custDoc').value = c.doc || '';
    document.getElementById('custPhone').value = c.phone || '';
    document.getElementById('custEmail').value = c.email || '';
    document.getElementById('custAddress').value = c.address || '';
    document.getElementById('custNotes').value = c.notes || '';

    openModal('customerForm');
}

async function submitCustomerForm() {
    const name = document.getElementById('custName').value.trim();
    if (!name) {
        showToast('Informe o nome do cliente.', 'error');
        return;
    }

    const editId = document.getElementById('editCustomerId').value.trim();
    const body = {
        name,
        doc: document.getElementById('custDoc').value.trim(),
        phone: document.getElementById('custPhone').value.trim(),
        email: document.getElementById('custEmail').value.trim(),
        address: document.getElementById('custAddress').value.trim(),
        notes: document.getElementById('custNotes').value.trim()
    };

    try {
        if (editId) {
            const data = await apiJson(`/api/customers/${encodeURIComponent(editId)}`, {
                method: 'PATCH',
                body: JSON.stringify(body)
            });
            upsertCustomerInState(data.customer);
            selectedId = data.customer.id;
            closeModal('customerForm');

            renderClientList(document.getElementById('clientSearch')?.value || '');
            selectClient(data.customer.id);
            showToast('Cliente atualizado.', 'success');
        } else {
            const data = await apiJson('/api/customers', { method: 'POST', body: JSON.stringify(body) });
            upsertCustomerInState(data.customer);
            selectedId = data.customer.id;
            closeModal('customerForm');

            renderClientList(document.getElementById('clientSearch')?.value || '');
            selectClient(data.customer.id);
            showToast('Cliente cadastrado.', 'success');
        }
    } catch {}
}

function openRequestModal(forClientId = null) {
    const cid = forClientId || selectedId;
    if (!cid) {
        showToast('Selecione um cliente primeiro.', 'error');
        return;
    }
    pendingRequestCustomerId = cid;
    document.getElementById('reqTitle').value = '';
    document.getElementById('reqDescription').value = '';
    document.getElementById('reqStatus').value = 'open';
    document.getElementById('reqDate').value = new Date().toISOString().slice(0, 10);
    openModal('requestForm');
}

async function submitNewRequest() {
    const cid = pendingRequestCustomerId;
    const title = document.getElementById('reqTitle').value.trim();

    if (!cid) return;
    if (!title) {
        showToast('Informe um título para a requisição.', 'error');
        return;
    }

    const payload = {
        title,
        description: document.getElementById('reqDescription').value.trim(),
        date: document.getElementById('reqDate').value || '',
        status: document.getElementById('reqStatus').value
    };

    try {
        const data = await apiJson(`/api/customers/${encodeURIComponent(cid)}/requests`, {
            method: 'POST',
            body: JSON.stringify(payload)
        });
        upsertCustomerInState(data.customer);
        closeModal('requestForm');

        const q = document.getElementById('clientSearch')?.value || '';
        renderClientList(q);
        selectClient(cid);
        showToast('Requisição registrada.', 'success');
    } catch {}
}

function initCustomersPage() {
    if (!document.getElementById('page-clientes')) return;

    window.appData = window.appData || {};
    window.appData.customers = Array.isArray(window.appData.customers) ? window.appData.customers : [];
    window.appData.budgets = Array.isArray(window.appData.budgets) ? window.appData.budgets : [];

    updateTopbarTitle('Clientes CRM');
    markNavActive('/clients');

    const sr = document.getElementById('clientSearch');
    if (sr) sr.addEventListener('input', () => renderClientList(sr.value));

    renderClientList('');

    const params = new URLSearchParams(window.location.search);
    const clientFromUrl = params.get('client');
    if (clientFromUrl && window.appData.customers.some((c) => String(c.id) === String(clientFromUrl))) {
        selectClient(clientFromUrl);
    } else if (window.appData.customers.length === 1) {
        selectClient(window.appData.customers[0].id);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    if (typeof initCustomersPage === 'function') initCustomersPage();
});
