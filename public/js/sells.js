let currentSalesFilter = 'todos';

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

function resolveSalePayment(sale) {
    const provider = sale?.paymentGateway?.provider;
    if (provider) return normalizePaymentKey(provider);
    return normalizePaymentKey(sale?.payment);
}

function paymentLabel(paymentKey) {
    const payNames = {
        money: 'Dinheiro',
        pix: 'Pix',
        credit_card: 'Credito',
        debit_card: 'Debito',
        mercado_pago_pix_online: 'Pix Online',
        mercado_pago_point: 'Maquininha'
    };
    return payNames[paymentKey] || paymentKey || '-';
}

function initSells() {

    updateTopbarTitle('Vendas');
    markNavActive('/sells');
    renderSales();

}

function renderSales(filter) {
    filter = filter || currentSalesFilter;
    const { sales } = window.appData;

    const search = document.getElementById('salesSearch')?.value?.toLowerCase() || '';
    let list = [...sales].reverse();

    if (search) {
        list = list.filter((s) =>
            String(s.id || '').toLowerCase().includes(search) ||
            String(s.code || '').toLowerCase().includes(search) ||
            String(s.client || '').toLowerCase().includes(search)
        );
    }

    const total = list.reduce((s, v) => s + v.total, 0);
    const tot = document.getElementById('saleTotal');
    if (tot) tot.textContent = formatCurrency(total);

    const cnt = document.getElementById('saleCount');
    if (cnt) cnt.textContent = list.length;

    const avg = document.getElementById('saleAvg');
    if (avg) avg.textContent = list.length ? formatCurrency(total / list.length) : formatCurrency(0);

    const payIcons = {
        money: '💵',
        pix: '⚡',
        credit_card: '💳',
        debit_card: '💳',
        mercado_pago_pix_online: '⚡',
        mercado_pago_point: '🏧'
    };

    const table = document.getElementById('salesTable');
    if (!table) return;

    table.innerHTML = list.map(s => `
    <tr class="fade-in">
      <td class="mono" style="color:var(--gold)">${s.code || s.id}</td>
      <td style="color:var(--text2)">${formatSaleDate(s.createdAt || s.date)}</td>
      <td style="font-weight:600">${s.client}</td>
      <td>${s.items.length} item${s.items.length > 1 ? 's' : ''}</td>
      <td class="mono" style="color:var(--green)">${s.discount > 0 ? '- ' + formatCurrency(s.discount) : '—'}</td>
      <td class="mono" style="font-weight:800;color:var(--gold)">${formatCurrency(s.total)}</td>
      <td>${payIcons[resolveSalePayment(s)] || '💳'} ${paymentLabel(resolveSalePayment(s))}</td>
      <td>
        <button class="btn btn-ghost btn-sm" onclick="openSaleDetail('${s.id}')">🔍 Ver</button>
      </td>
    </tr>
  `).join('') || `<tr><td colspan="8"><div class="empty-state"><div class="empty-icon">🧾</div><p>Nenhuma venda encontrada</p></div></td></tr>`;
}

function setSalesFilter(f, btn) {
    currentSalesFilter = f;
    document.querySelectorAll('#page-vendas .filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    renderSales(f);
}

function filterSales() {
    renderSales(currentSalesFilter);
}

function openSaleDetail(id) {
    const { sales } = window.appData;
    const s = sales.find(x => x.id === id);
    if (!s) return;

    const payNames = {
        money: 'Dinheiro',
        pix: 'Pix',
        credit_card: 'Cartao de Credito',
        debit_card: 'Cartao de Debito',
        mercado_pago_pix_online: 'Pix Online',
        mercado_pago_point: 'Maquininha'
    };
    const subtotal = s.items.reduce((t, i) => t + i.price * i.qty, 0);

    document.getElementById('saleDetailId').textContent = s.code || s.id;
    document.getElementById('saleDetailClient').textContent = s.client;
    document.getElementById('saleDetailDate').textContent = formatSaleDate(s.createdAt || s.date);

    const itemsHtml = s.items.map(i => `
    <tr>
      <td style="padding:8px;font-size:0.85rem">${i.name}</td>
      <td style="padding:8px;font-size:0.85rem;text-align:right">${i.qty}</td>
      <td style="padding:8px;font-size:0.85rem;text-align:right;font-family:monospace">${formatCurrency(i.price)}</td>
      <td style="padding:8px;font-size:0.85rem;text-align:right;font-family:monospace;color:var(--gold)">${formatCurrency(i.price * i.qty)}</td>
    </tr>
  `).join('');

    document.getElementById('saleDetailItems').innerHTML = itemsHtml;
    document.getElementById('saleDetailSubtotal').textContent = formatCurrency(subtotal);
    document.getElementById('saleDetailDiscount').textContent = formatCurrency(s.discount || s.adjustments?.discount?.amount || 0);
    document.getElementById('saleDetailTotal').textContent = formatCurrency(s.total);
    const paymentKey = resolveSalePayment(s);
    const gatewayStatus = s?.paymentGateway?.status ? ` (${s.paymentGateway.status})` : '';
    document.getElementById('saleDetailPayment').textContent = `${payNames[paymentKey] || paymentKey}${gatewayStatus}`;

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

// Automatically initialize when page is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        if (typeof initSells === 'function') initSells();
    });
} else {
    if (typeof initSells === 'function') initSells();
}
