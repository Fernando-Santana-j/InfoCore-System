function initAnalytics() {
    updateTopbarTitle('Relatórios');
    markNavActive('/analytics');
    renderAnalytics();
}

function renderAnalytics() {
    const { products, sales, clients } = window.appData;

    const catData = [
        { name: 'Bebidas', val: 38, color: 'var(--gold)' },
        { name: 'Alimentos', val: 29, color: 'var(--green)' },
        { name: 'Eletrônicos', val: 18, color: 'var(--blue)' },
        { name: 'Limpeza', val: 10, color: 'var(--purple)' },
        { name: 'Papelaria', val: 5, color: 'var(--text2)' },
    ];

    const cat = document.getElementById('reportCategories');
    if (cat) {
        cat.innerHTML = catData.map(c => `
      <div>
        <div style="display:flex;justify-content:space-between;font-size:0.82rem;margin-bottom:5px;">
          <span style="font-weight:600">${c.name}</span>
          <span class="mono" style="color:${c.color}">${c.val}%</span>
        </div>
        <div class="progress-bar"><div class="progress-fill" style="width:${c.val}%;background:${c.color}"></div></div>
      </div>
    `).join('');
    }

    const topProds = [
        { name: 'Coca-Cola 2L', sold: 84, rev: 755.16 },
        { name: 'Água Mineral 1,5L', sold: 210, rev: 522.9 },
        { name: 'Arroz 5kg', sold: 22, rev: 503.8 },
        { name: 'Fone Bluetooth', sold: 4, rev: 519.6 },
        { name: 'Detergente 500ml', sold: 95, rev: 379.05 },
    ];

    const top = document.getElementById('reportTopProducts');
    if (top) {
        top.innerHTML = topProds.map((p, i) => `
      <div style="display:flex;align-items:center;gap:10px;">
        <div style="font-size:1.1rem;font-weight:800;color:var(--text3);min-width:20px">${i + 1}</div>
        <div style="flex:1">
          <div style="font-size:0.82rem;font-weight:700">${p.name}</div>
          <div style="font-size:0.7rem;color:var(--text2)">${p.sold} unidades</div>
        </div>
        <div class="mono" style="font-weight:700;color:var(--gold)">${formatCurrency(p.rev)}</div>
      </div>
    `).join('');
    }

    const payData = [
        { name: 'Pix', pct: 42, color: 'var(--blue)' },
        { name: 'Débito', pct: 28, color: 'var(--green)' },
        { name: 'Dinheiro', pct: 18, color: 'var(--gold)' },
        { name: 'Crédito', pct: 12, color: 'var(--purple)' },
    ];

    const pay = document.getElementById('reportPayments');
    if (pay) {
        pay.innerHTML = payData.map(p => `
      <div>
        <div style="display:flex;justify-content:space-between;font-size:0.82rem;margin-bottom:5px;">
          <span style="font-weight:600">${p.name}</span>
          <span class="mono" style="color:${p.color}">${p.pct}%</span>
        </div>
        <div class="progress-bar"><div class="progress-fill" style="width:${p.pct}%;background:${p.color}"></div></div>
      </div>
    `).join('');
    }

    const totalVendas = sales.reduce((s, v) => s + v.total, 0);
    const totalCusto = products.reduce((s, p) => s + p.cost * p.qty * 0.3, 0);

    const fin = document.getElementById('reportFinancial');
    if (fin) {
        fin.innerHTML = `
      <div class="detail-item">
        <div class="detail-item-label">Receita Bruta (mês)</div>
        <div class="detail-item-value mono" style="color:var(--gold)">${formatCurrency(totalVendas * 4.2)}</div>
      </div>
      <div class="detail-item">
        <div class="detail-item-label">Custo das Mercadorias</div>
        <div class="detail-item-value mono" style="color:var(--red)">${formatCurrency(totalCusto)}</div>
      </div>
      <div class="detail-item">
        <div class="detail-item-label">Margem Bruta</div>
        <div class="detail-item-value" style="color:var(--green)">68,4%</div>
      </div>
      <div class="detail-item">
        <div class="detail-item-label">Ticket Médio</div>
        <div class="detail-item-value mono" style="color:var(--blue)">${formatCurrency(totalVendas / sales.length)}</div>
      </div>
      <div class="detail-item">
        <div class="detail-item-label">Itens vendidos</div>
        <div class="detail-item-value">${sales.reduce((s, v) => s + v.items.reduce((ss, i) => ss + i.qty, 0), 0)}</div>
      </div>
      <div class="detail-item">
        <div class="detail-item-label">Clientes ativos</div>
        <div class="detail-item-value">${clients.length}</div>
      </div>
    `;
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        if (typeof initAnalytics === 'function') initAnalytics();
    });
} else {
    if (typeof initAnalytics === 'function') initAnalytics();
}
