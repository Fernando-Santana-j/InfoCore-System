
let currentSalesPeriod = 'todos';

function escapeHtml(s) {
    return String(s || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
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

function formatSaleDate(value) {
    if (!value) return '-';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleString('pt-BR');
}

function parseSaleDate(sale) {
    const raw = sale?.createdAt || sale?.date;
    if (!raw) return null;
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? null : d;
}

function saleTimeMs(sale) {
    const d = parseSaleDate(sale);
    return d ? d.getTime() : 0;
}

function sortSalesRecentFirst(list) {
    return [...list].sort((a, b) => saleTimeMs(b) - saleTimeMs(a));
}

function startOfLocalDay(d) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function filterSalesByPeriod(list, period) {
    const now = new Date();
    const todayStart = startOfLocalDay(now);
    const tomorrow = new Date(todayStart);
    tomorrow.setDate(tomorrow.getDate() + 1);

    if (period === 'hoje') {
        return list.filter((s) => {
            const d = parseSaleDate(s);
            return d && d >= todayStart && d < tomorrow;
        });
    }

    if (period === 'semana') {
        const day = now.getDay();
        const daysFromMonday = (day + 6) % 7;
        const weekStart = new Date(todayStart);
        weekStart.setDate(weekStart.getDate() - daysFromMonday);
        const weekEnd = new Date(weekStart);
        weekEnd.setDate(weekEnd.getDate() + 7);
        return list.filter((s) => {
            const d = parseSaleDate(s);
            return d && d >= weekStart && d < weekEnd;
        });
    }

    if (period === 'mes') {
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
        const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);
        return list.filter((s) => {
            const d = parseSaleDate(s);
            return d && d >= monthStart && d < monthEnd;
        });
    }

    return list;
}

function resolveSalePayment(sale) {
    const provider = sale?.paymentGateway?.provider;
    const raw = provider || sale?.payment;
    return normalizePaymentKey(raw);
}

function paymentLabel(paymentKey) {
    const payNames = {
        money: 'Dinheiro',
        pix: 'Pix',
        credit_card: 'Crédito',
        debit_card: 'Débito',
        mercado_pago_pix_online: 'Pix Online',
        mercado_pago_qr_instore: 'Pix QR loja',
        mercado_pago_point: 'Maquininha'
    };
    return payNames[paymentKey] || paymentKey || '-';
}

function filterSalesByPayment(list, wantRaw) {
    const want = String(wantRaw || '').trim();
    if (!want) return list;
    return list.filter((s) => {
        const gw = s?.paymentGateway?.provider ? String(s.paymentGateway.provider) : '';
        const norm = normalizePaymentKey(s?.payment != null ? s.payment : gw);
        if (gw === want || norm === want) return true;
        try {
            if (want === 'credit_card') return gw.includes('credito') || norm === 'credit_card';
            if (want === 'debit_card') return gw.includes('debito') || norm === 'debit_card';
        } catch {
            //
        }
        return gw === want;
    });
}

function saleLineItems(s) {
    return Array.isArray(s?.items) ? s.items : [];
}

function initSells() {
    if (!document.getElementById('page-vendas')) return;

    updateTopbarTitle('Vendas');
    markNavActive('/sells');

    const search = document.getElementById('salesSearch');
    if (search) search.addEventListener('input', () => renderSales());

    document.querySelectorAll('[data-sales-period]').forEach((btn) => {
        btn.addEventListener('click', () => setSalesPeriod(btn.getAttribute('data-sales-period')));
    });

    const paySel = document.getElementById('salesPayFilter');
    if (paySel) paySel.addEventListener('change', () => renderSales());

    renderSales();
}

function setSalesPeriod(period) {
    currentSalesPeriod = period || 'todos';
    document.querySelectorAll('[data-sales-period]').forEach((b) => {
        b.classList.toggle('active', b.getAttribute('data-sales-period') === currentSalesPeriod);
    });
    renderSales();
}

function periodHintLabel(p) {
    const map = { todos: '', hoje: 'Hoje · ', semana: 'Semana · ', mes: 'Mês · ' };
    return map[p] || '';
}

function renderSales() {
    const rows = Array.isArray(window.appData?.sales) ? window.appData.sales : [];

    let list = sortSalesRecentFirst(rows);
    list = filterSalesByPeriod(list, currentSalesPeriod);

    const payRaw = document.getElementById('salesPayFilter')?.value ?? '';
    list = filterSalesByPayment(list, payRaw);

    const search = document.getElementById('salesSearch')?.value?.toLowerCase().trim() || '';
    if (search) {
        list = list.filter((s) => {
            const payKey = resolveSalePayment(s);
            const payPt = paymentLabel(payKey).toLowerCase();
            return (
                String(s.id || '').toLowerCase().includes(search) ||
                String(s.code || '').toLowerCase().includes(search) ||
                String(s.client || '').toLowerCase().includes(search) ||
                String(payKey || '').toLowerCase().includes(search) ||
                payPt.includes(search)
            );
        });
    }

    const total = list.reduce((acc, v) => acc + (Number(v.total) || 0), 0);
    const tot = document.getElementById('saleTotal');
    if (tot) tot.textContent = formatCurrency(total);

    const cnt = document.getElementById('saleCount');
    if (cnt) cnt.textContent = String(list.length);

    const avg = document.getElementById('saleAvg');
    if (avg) avg.textContent = list.length ? formatCurrency(total / list.length) : formatCurrency(0);

    const hint = document.getElementById('saleFilterHint');
    if (hint) {
        const pl = periodHintLabel(currentSalesPeriod);
        hint.textContent = `${pl}${list.length} venda${list.length === 1 ? '' : 's'} · mais recentes primeiro`;
    }

    const payIcons = {
        money: '💵',
        pix: '⚡',
        credit_card: '💳',
        debit_card: '💳',
        mercado_pago_pix_online: '⚡',
        mercado_pago_qr_instore: '⚡',
        mercado_pago_point: '🏧'
    };

    const table = document.getElementById('salesTable');
    const empty = document.getElementById('salesEmpty');
    if (!table) return;

    if (!list.length) {
        table.innerHTML = '';
        if (empty) {
            empty.style.display = 'block';
            const msg = document.getElementById('salesEmptyMsg');
            if (msg) {
                msg.textContent = search || payRaw || currentSalesPeriod !== 'todos'
                    ? 'Nenhuma venda corresponde aos filtros.'
                    : 'Nenhuma venda registrada ainda.';
            }
        }
        return;
    }

    if (empty) empty.style.display = 'none';

    table.innerHTML = list.map((s) => {
        const payKey = resolveSalePayment(s);
        const icon = payIcons[payKey] || '💳';
        const items = saleLineItems(s);
        const nItems = items.length;
        const disc = Number(s.discount) || 0;
        const code = escapeHtml(s.code || s.id);

        return `
    <tr class="sells-row fade-in">
      <td class="mono sells-code">${code}</td>
      <td class="muted-cell">${escapeHtml(formatSaleDate(s.createdAt || s.date))}</td>
      <td class="sells-client">${escapeHtml(s.client || '—')}</td>
      <td>${nItems} item${nItems !== 1 ? 's' : ''}</td>
      <td class="mono disc-cell">${disc > 0 ? '- ' + formatCurrency(disc) : '—'}</td>
      <td class="mono ta-r sells-total-cell">${formatCurrency(Number(s.total) || 0)}</td>
      <td><span class="sells-pay-pill">${icon} ${escapeHtml(paymentLabel(payKey))}</span></td>
      <td class="ta-r">
        <button type="button" class="btn btn-ghost btn-sm sells-view-btn" data-sale-id="${escapeHtml(s.id)}">Ver</button>
      </td>
    </tr>`;
    }).join('');

    table.querySelectorAll('.sells-view-btn').forEach((btn) => {
        btn.addEventListener('click', () => openSaleDetail(btn.getAttribute('data-sale-id')));
    });
}

function openSaleDetail(id) {
    const sales = Array.isArray(window.appData?.sales) ? window.appData.sales : [];
    const s = sales.find((x) => String(x.id) === String(id));
    if (!s) return;

    const items = saleLineItems(s);
    const subtotal = items.reduce((t, i) => {
        const line = i.lineTotal != null ? Number(i.lineTotal) : (Number(i.price) || 0) * (Number(i.qty) || 0);
        return t + line;
    }, 0);

    document.getElementById('saleDetailId').textContent = s.code || s.id;
    document.getElementById('saleDetailClient').textContent = s.client || '—';
    document.getElementById('saleDetailDate').textContent = formatSaleDate(s.createdAt || s.date);

    const itemsHtml = items.map((i) => {
        const line = i.lineTotal != null ? Number(i.lineTotal) : (Number(i.price) || 0) * (Number(i.qty) || 0);
        return `
    <tr>
      <td>${escapeHtml(i.name || '—')}</td>
      <td class="ta-r">${Number(i.qty) || 0}</td>
      <td class="ta-r mono">${formatCurrency(Number(i.price) || 0)}</td>
      <td class="ta-r mono gold-fg">${formatCurrency(line)}</td>
    </tr>`;
    }).join('');

    document.getElementById('saleDetailItems').innerHTML = itemsHtml;

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

function printSale(saleId) {
    showToast('Imprimindo nota fiscal...', 'info');
    setTimeout(() => showToast('Nota impressa com sucesso!', 'success'), 800);
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        if (typeof initSells === 'function') initSells();
    });
} else {
    if (typeof initSells === 'function') initSells();
}
