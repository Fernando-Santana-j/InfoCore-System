
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
    const type = String(e.type || '').toLowerCase() === 'expense' ? 'expense' : 'income';
    const amount = Math.max(0, Number(e.amount) || 0);
    const cost = Math.max(0, Number(e.cost) || 0);
    let profit = Number(e.profit);
    if (!Number.isFinite(profit)) profit = type === 'income' ? amount - cost : 0;
    return {
        id: e.id != null ? String(e.id) : '',
        type,
        amount,
        cost,
        profit,
        category: String(e.category || '').trim(),
        description: String(e.description || '').trim(),
        date: e.date != null ? String(e.date).trim().slice(0, 10) : '',
        saleId: e.saleId != null ? String(e.saleId) : '',
        budgetId: e.budgetId != null ? String(e.budgetId) : '',
        source: e.source != null ? String(e.source).trim() : ''
    };
}

function currentMonthKey() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    return `${y}-${m}`;
}

function currentMonthLabel() {
    const d = new Date();
    const months = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
        'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
    return `${months[d.getMonth()]} ${d.getFullYear()}`;
}

function filterByMonth(entries, monthKey) {
    return entries.filter((e) => String(e.date || '').slice(0, 7) === monthKey);
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

function isPdvEntry(e) {
    const src = String(e.source || '').trim();
    return src === 'pdv' || src === 'budget' || Boolean(String(e.saleId || '').trim()) || Boolean(String(e.budgetId || '').trim());
}

function isBudgetEntry(e) {
    return String(e.source || '').trim() === 'budget' || Boolean(String(e.budgetId || '').trim());
}

function applyFilters(entries) {
    const typeSel = document.getElementById('cfFilterType')?.value || '';
    let out = [...entries];
    if (typeSel === 'income') out = out.filter((x) => x.type === 'income');
    if (typeSel === 'expense') out = out.filter((x) => x.type === 'expense');
    if (typeSel === 'pdv') out = out.filter((x) => isPdvEntry(x));

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
    let profit = 0;
    rows.forEach((r) => {
        if (r.type === 'income') {
            inc += Number(r.amount) || 0;
            if (Number.isFinite(Number(r.profit))) {
                profit += Number(r.profit);
            } else {
                profit += (Number(r.amount) || 0) - (Number(r.cost) || 0);
            }
        } else {
            exp += Number(r.amount) || 0;
        }
    });
    return { inc, exp, profit, balance: inc - exp };
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
    const monthKey = currentMonthKey();
    const monthRows = filterByMonth(all, monthKey);
    const monthTotals = summarize(monthRows);

    document.getElementById('cfTotalIncome').textContent = formatCurrency(monthTotals.inc);
    document.getElementById('cfTotalExpense').textContent = formatCurrency(monthTotals.exp);
    const profitEl = document.getElementById('cfTotalProfit');
    if (profitEl) {
        profitEl.textContent = formatCurrency(monthTotals.profit);
        profitEl.classList.toggle('cf-balance-negative', monthTotals.profit < 0);
        profitEl.classList.toggle('cf-balance-positive', monthTotals.profit >= 0);
    }
    const monthLabel = document.getElementById('cfMonthLabel');
    if (monthLabel) monthLabel.textContent = `Período: ${currentMonthLabel()}`;
    const balEl = document.getElementById('cfBalance');
    balEl.textContent = formatCurrency(monthTotals.balance);
    balEl.classList.toggle('cf-balance-positive', monthTotals.balance >= 0);
    balEl.classList.toggle('cf-balance-negative', monthTotals.balance < 0);

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

        const profitHint = isInc && (r.cost > 0 || isPdvEntry(r))
            ? `<div class="cf-profit-hint muted">Custo ${formatCurrency(r.cost)} · Lucro ${formatCurrency(r.profit)}</div>`
            : '';
        const pdv = isPdvEntry(r);
        const budget = isBudgetEntry(r);
        const typePill = budget
            ? `<span class="cf-pill cf-pill-pdv">Orçamento</span>`
            : (pdv && r.saleId)
                ? `<span class="cf-pill cf-pill-pdv">Venda PDV</span>`
                : `<span class="${pillClass}">${isInc ? 'Entrada' : 'Saída'}</span>`;
        let actions;
        if (budget && r.budgetId) {
            actions = `<a class="btn btn-ghost btn-sm" href="/budgets">Ver orçamentos</a>`;
        } else if (pdv && r.saleId) {
            actions = `<button type="button" class="btn btn-ghost btn-sm" data-act="sale" data-sale-id="${escapeCf(r.saleId)}">Ver venda</button>`;
        } else if (pdv) {
            actions = `<span class="cf-actions-pdv muted">Automático</span>`;
        } else {
            actions = `<button type="button" class="btn btn-ghost btn-sm" data-act="edit" data-id="${escapeCf(r.id)}">Editar</button>
    <button type="button" class="btn btn-ghost btn-sm text-danger-btn" data-act="del" data-id="${escapeCf(r.id)}">Excluir</button>`;
        }

        return `
<tr>
  <td class="mono muted">${escapeCf(d)}</td>
  <td>${typePill}</td>
  <td>${r.category ? escapeCf(r.category) : '—'}</td>
  <td>${r.description ? escapeCf(r.description) : '<span class="muted">Sem descrição</span>'}${profitHint}</td>
  <td class="${amtClass} ta-right">${sign} ${formatCurrency(r.amount)}</td>
  <td class="cf-actions ta-right">${actions}</td>
</tr>`;
    }).join('');

    tbody.querySelectorAll('[data-act="edit"]').forEach((b) =>
        b.addEventListener('click', () => openCashEntryModal(b.getAttribute('data-id'))));

    tbody.querySelectorAll('[data-act="del"]').forEach((b) =>
        b.addEventListener('click', async () => {
            await deleteCfEntry(b.getAttribute('data-id'));
        }));

    tbody.querySelectorAll('[data-act="sale"]').forEach((b) =>
        b.addEventListener('click', () => openSaleDetailFromCashFlow(b.getAttribute('data-sale-id'))));

    empty.classList.toggle('is-visible', filtered.length === 0);
}

function normalizePaymentKey(payment) {
    const map = {
        dinheiro: 'money',
        cartao_credito: 'credit_card',
        cartao_debito: 'debit_card',
        money: 'money',
        credit_card: 'credit_card',
        debit_card: 'debit_card',
        pix: 'pix'
    };
    return map[payment] || payment || 'money';
}

function paymentLabel(payment) {
    const key = normalizePaymentKey(payment);
    const methods = window.appData?.configs?.payment_methods || {};
    if (methods[key]?.name) return methods[key].name;
    const labels = {
        money: 'Dinheiro',
        credit_card: 'Cartão de crédito',
        debit_card: 'Cartão de débito',
        pix: 'PIX'
    };
    return labels[key] || key;
}

function formatSaleDate(value) {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleString('pt-BR');
}

function saleLineItems(sale) {
    return Array.isArray(sale?.items) ? sale.items : [];
}

function resolveSalePayment(sale) {
    if (sale?.paymentGateway?.provider) return String(sale.paymentGateway.provider);
    return normalizePaymentKey(sale?.payment);
}

function renderSaleDetailModal(s) {
    const items = saleLineItems(s);
    const subtotal = items.reduce((t, i) => {
        const line = i.lineTotal != null ? Number(i.lineTotal) : (Number(i.price) || 0) * (Number(i.qty) || 0);
        return t + line;
    }, 0);

    document.getElementById('saleDetailId').textContent = s.code || s.id;
    document.getElementById('saleDetailClient').textContent = s.client || '—';
    document.getElementById('saleDetailDate').textContent = formatSaleDate(s.createdAt || s.date);

    document.getElementById('saleDetailItems').innerHTML = items.map((i) => {
        const line = i.lineTotal != null ? Number(i.lineTotal) : (Number(i.price) || 0) * (Number(i.qty) || 0);
        return `
    <tr>
      <td>${escapeCf(i.name || '—')}</td>
      <td class="ta-r">${Number(i.qty) || 0}</td>
      <td class="ta-r mono">${formatCurrency(Number(i.price) || 0)}</td>
      <td class="ta-r mono gold-fg">${formatCurrency(line)}</td>
    </tr>`;
    }).join('');

    const discountVal = Number(s.discount) || Number(s.adjustments?.discount?.amount) || 0;
    document.getElementById('saleDetailSubtotal').textContent = formatCurrency(subtotal);
    document.getElementById('saleDetailDiscount').textContent = formatCurrency(discountVal);
    document.getElementById('saleDetailTotal').textContent = formatCurrency(Number(s.total) || 0);

    const paymentKey = resolveSalePayment(s);
    const gatewayStatus = s?.paymentGateway?.status ? ` (${s.paymentGateway.status})` : '';
    document.getElementById('saleDetailPayment').textContent = `${paymentLabel(paymentKey)}${gatewayStatus}`;

    const cashWrap = document.getElementById('saleDetailCashWrap');
    const isCash = paymentKey === 'money';
    const hasCashMeta = isCash && s.cashReceived != null && Number.isFinite(Number(s.cashReceived));
    if (cashWrap) {
        if (hasCashMeta) {
            cashWrap.style.display = 'block';
            document.getElementById('saleDetailCashReceived').textContent = formatCurrency(Number(s.cashReceived));
            const ch = s.change != null && Number.isFinite(Number(s.change)) ? Number(s.change) : 0;
            document.getElementById('saleDetailCashChange').textContent = formatCurrency(ch);
        } else {
            cashWrap.style.display = 'none';
        }
    }

    openModal('saleDetail');
}

async function openSaleDetailFromCashFlow(saleId) {
    if (!saleId) return;
    try {
        const data = await cfApi(`/api/sales/${encodeURIComponent(saleId)}`);
        if (data.sale) renderSaleDetailModal(data.sale);
    } catch {}
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
    if (isPdvEntry(row)) {
        if (row.saleId) openSaleDetailFromCashFlow(row.saleId);
        else if (row.budgetId) showToast('Orçamentos aparecem em Orçamentos. Este lançamento é automático.', 'info');
        else showToast('Lançamento automático não pode ser editado.', 'info');
        return;
    }

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

    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth();
    const firstDay = `${y}-${String(m + 1).padStart(2, '0')}-01`;
    const lastDay = new Date(y, m + 1, 0);
    const lastDayStr = `${y}-${String(m + 1).padStart(2, '0')}-${String(lastDay.getDate()).padStart(2, '0')}`;
    const dateFrom = document.getElementById('cfDateFrom');
    const dateTo = document.getElementById('cfDateTo');
    if (dateFrom && !dateFrom.value) dateFrom.value = firstDay;
    if (dateTo && !dateTo.value) dateTo.value = lastDayStr;

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
