let currentSalesFilter = 'todos';

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
        list = list.filter(s => s.id.toLowerCase().includes(search) || s.client.toLowerCase().includes(search));
    }

    const total = list.reduce((s, v) => s + v.total, 0);
    const tot = document.getElementById('saleTotal');
    if (tot) tot.textContent = formatCurrency(total);

    const cnt = document.getElementById('saleCount');
    if (cnt) cnt.textContent = list.length;

    const avg = document.getElementById('saleAvg');
    if (avg) avg.textContent = list.length ? formatCurrency(total / list.length) : formatCurrency(0);

    const payIcons = { dinheiro: '💵', pix: '⚡', cartao_credito: '💳', cartao_debito: '💳' };
    const payNames = { dinheiro: 'Dinheiro', pix: 'Pix', cartao_credito: 'Crédito', cartao_debito: 'Débito' };

    const table = document.getElementById('salesTable');
    if (!table) return;

    table.innerHTML = list.map(s => `
    <tr class="fade-in">
      <td class="mono" style="color:var(--gold)">${s.id}</td>
      <td style="color:var(--text2)">${s.date}</td>
      <td style="font-weight:600">${s.client}</td>
      <td>${s.items.length} item${s.items.length > 1 ? 's' : ''}</td>
      <td class="mono" style="color:var(--green)">${s.discount > 0 ? '- ' + formatCurrency(s.discount) : '—'}</td>
      <td class="mono" style="font-weight:800;color:var(--gold)">${formatCurrency(s.total)}</td>
      <td>${payIcons[s.payment]} ${payNames[s.payment]}</td>
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

    const payNames = { dinheiro: 'Dinheiro', pix: 'Pix', cartao_credito: 'Cartão de Crédito', cartao_debito: 'Cartão de Débito' };
    const subtotal = s.items.reduce((t, i) => t + i.price * i.qty, 0);

    document.getElementById('saleDetailId').textContent = s.id;
    document.getElementById('saleDetailClient').textContent = s.client;
    document.getElementById('saleDetailDate').textContent = s.date;

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
    document.getElementById('saleDetailDiscount').textContent = formatCurrency(s.discount);
    document.getElementById('saleDetailTotal').textContent = formatCurrency(s.total);
    document.getElementById('saleDetailPayment').textContent = payNames[s.payment];

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
