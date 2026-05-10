
async function cfApi(url, opts = {}) {
    const r = await fetch(url, {
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        ...opts
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok || data.error) {
        showToast(data.message || 'Erro ao salvar dados.', 'error');
        throw new Error(data.message);
    }
    return data;
}

function escapeCf(s) {
    return String(s || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function parseAmountInput(raw) {
    let s = String(raw || '').trim().replace(/\s+/g, '');
    if (!s) return NaN;
    if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(/\./g, '');
    const n = Number(s);
    return Number.isFinite(n) ? n : NaN;
}

function normalizeEntry(e) {
    return {
        id: e.id != null ? String(e.id) : '',
        type: String(e.type || '').toLowerCase() === 'expense' ? 'expense' : 'income',
        amount: Math.max(0, Number(e.amount) || 0),
        category: String(e.category || '').trim(),
        description: String(e.description || '').trim(),
        date: e.date != null ? String(e.date).trim().slice(0, 10) : ''
    };
}

function getEntriesFromState() {
    const rows = window.appData && Array.isArray(window.appData.cashFlowEntries)
        ? [...window.appData.cashFlowEntries]
        : [];
    return rows.map(normalizeEntry).sort((a, b) => {
        const c = String(b.date || '').localeCompare(String(a.date || ''));
        if (c !== 0) return c;
        return String(b.id).localeCompare(String(a.id));
    });
}

function applyFilters(entries) {
    const typeSel = document.getElementById('cfFilterType')?.value || '';
    let out = [...entries];
    if (typeSel === 'income') out = out.filter((x) => x.type === 'income');
    if (typeSel === 'expense') out = out.filter((x) => x.type === 'expense');

    const df = document.getElementById('cfDateFrom')?.value?.trim();
    const dt = document.getElementById('cfDateTo')?.value?.trim();
    if (df) out = out.filter((x) => !x.date || x.date >= df);
    if (dt) out = out.filter((x) => !x.date || x.date <= dt);

    return out.sort((a, b) => {
        const cmp = String(b.date || '').localeCompare(String(a.date || ''));
        if (cmp !== 0) return cmp;
        return String(b.id).localeCompare(String(a.id));
    });
}

function summarize(rows) {
    let inc = 0;
    let exp = 0;
    rows.forEach((r) => {
        if (r.type === 'income') inc += Number(r.amount) || 0;
        else exp += Number(r.amount) || 0;
    });
    return { inc, exp, balance: inc - exp };
}

function upsertCashEntry(entry) {
    if (!window.appData.cashFlowEntries) window.appData.cashFlowEntries = [];
    const e = normalizeEntry(entry);
    const idx = window.appData.cashFlowEntries.findIndex((x) => x.id === e.id);
    if (idx >= 0) window.appData.cashFlowEntries[idx] = e;
    else window.appData.cashFlowEntries.push(e);
}

function removeCashEntryFromState(id) {
    window.appData.cashFlowEntries = (window.appData.cashFlowEntries || []).filter((x) => x.id !== id);
}

function renderCashFlow() {
    const all = getEntriesFromState();
    const filtered = applyFilters(all);
    const totals = summarize(filtered);

    document.getElementById('cfTotalIncome').textContent = formatCurrency(totals.inc);
    document.getElementById('cfTotalExpense').textContent = formatCurrency(totals.exp);
    const balEl = document.getElementById('cfBalance');
    balEl.textContent = formatCurrency(totals.balance);
    balEl.classList.toggle('cf-balance-positive', totals.balance >= 0);
    balEl.classList.toggle('cf-balance-negative', totals.balance < 0);

    document.getElementById('cfEntryCount').textContent = `${filtered.length} lançamento${filtered.length === 1 ? '' : 's'}`;

    const tbody = document.getElementById('cashFlowBody');
    const empty = document.getElementById('cfEmpty');

    tbody.innerHTML = filtered.map((r) => {
        const isInc = r.type === 'income';
        const pillClass = isInc ? 'cf-pill cf-pill-inc' : 'cf-pill cf-pill-out';
        const amtClass = isInc ? 'mono cf-amt-inc' : 'mono cf-amt-out';
        const sign = isInc ? '+' : '−';

        let d = '';
        if (r.date && /^\d{4}-\d{2}-\d{2}$/.test(r.date)) {
            const [y, m, dd] = r.date.split('-');
            d = `${dd}/${m}/${y}`;
        } else d = r.date || '—';

        return `
<tr>
  <td class="mono muted">${escapeCf(d)}</td>
  <td><span class="${pillClass}">${isInc ? 'Entrada' : 'Saída'}</span></td>
  <td>${r.category ? escapeCf(r.category) : '—'}</td>
  <td>${r.description ? escapeCf(r.description) : '<span class="muted">Sem descrição</span>'}</td>
  <td class="${amtClass} ta-right">${sign} ${formatCurrency(r.amount)}</td>
  <td class="cf-actions ta-right">
    <button type="button" class="btn btn-ghost btn-sm" data-act="edit" data-id="${escapeCf(r.id)}">Editar</button>
    <button type="button" class="btn btn-ghost btn-sm text-danger-btn" data-act="del" data-id="${escapeCf(r.id)}">Excluir</button>
  </td>
</tr>`;
    }).join('');

    tbody.querySelectorAll('[data-act="edit"]').forEach((b) =>
        b.addEventListener('click', () => openCashEntryModal(b.getAttribute('data-id'))));

    tbody.querySelectorAll('[data-act="del"]').forEach((b) =>
        b.addEventListener('click', async () => {
            await deleteCfEntry(b.getAttribute('data-id'));
        }));

    empty.classList.toggle('is-visible', filtered.length === 0);
}

async function deleteCfEntry(id) {
    if (!id || !confirm('Remover este lançamento permanentemente?')) return;
    try {
        await cfApi(`/api/cash-flow/${encodeURIComponent(id)}`, { method: 'DELETE' });
        removeCashEntryFromState(id);
        renderCashFlow();
        showToast('Lançamento removido.', 'success');
    } catch {}
}

function openCashEntryModal(id) {
    const today = new Date().toISOString().slice(0, 10);
    document.getElementById('cfCfDate').value = today;

    if (!id) {
        document.getElementById('cfEntryModalTitle').textContent = 'Novo lançamento';
        document.getElementById('cfEditId').value = '';
        document.getElementById('cfType').value = 'income';
        document.getElementById('cfAmount').value = '';
        document.getElementById('cfCategory').value = '';
        document.getElementById('cfDescription').value = '';
        openModal('cfEntry');
        return;
    }

    const row = getEntriesFromState().find((x) => x.id === id);
    if (!row) return;

    document.getElementById('cfEntryModalTitle').textContent = 'Editar lançamento';
    document.getElementById('cfEditId').value = id;
    document.getElementById('cfType').value = row.type;
    document.getElementById('cfAmount').value = row.amount.toFixed(2).replace('.', ',');
    document.getElementById('cfCategory').value = row.category;
    document.getElementById('cfDescription').value = row.description;
    document.getElementById('cfCfDate').value = row.date || today;
    openModal('cfEntry');
}

async function submitCashFlowForm() {
    const editId = document.getElementById('cfEditId').value.trim();
    const amt = parseAmountInput(document.getElementById('cfAmount').value);
    if (!Number.isFinite(amt) || amt <= 0) {
        showToast('Valor inválido.', 'error');
        return;
    }

    const body = {
        type: document.getElementById('cfType').value,
        amount: amt,
        category: document.getElementById('cfCategory').value.trim(),
        description: document.getElementById('cfDescription').value.trim(),
        date: document.getElementById('cfCfDate').value || ''
    };

    try {
        if (editId) {
            const data = await cfApi(`/api/cash-flow/${encodeURIComponent(editId)}`, {
                method: 'PATCH',
                body: JSON.stringify(body)
            });
            upsertCashEntry(data.entry);
            showToast('Lançamento atualizado.', 'success');
        } else {
            const data = await cfApi('/api/cash-flow', {
                method: 'POST',
                body: JSON.stringify(body)
            });
            upsertCashEntry(data.entry);
            showToast('Registrado!', 'success');
        }
        closeModal('cfEntry');
        renderCashFlow();
    } catch {}
}

function initCashFlowPage() {
    if (!document.getElementById('page-cashflow')) return;

    window.appData = window.appData || {};
    if (!Array.isArray(window.appData.cashFlowEntries)) window.appData.cashFlowEntries = [];

    updateTopbarTitle('Fluxo de caixa');
    markNavActive('/cash-flow');

    ['cfFilterType', 'cfDateFrom', 'cfDateTo'].forEach((id) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.addEventListener('input', renderCashFlow);
        el.addEventListener('change', renderCashFlow);
    });

    renderCashFlow();
}

document.addEventListener('DOMContentLoaded', () => {
    if (typeof initCashFlowPage === 'function') initCashFlowPage();
});
