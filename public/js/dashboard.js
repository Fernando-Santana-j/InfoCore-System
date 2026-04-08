const Dashboard = (() => {
    const CONFIG = {
        CHART_DAYS: ['Sáb', 'Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex'],
        CHART_VALUES: [3900, 3200, 4100, 2800, 5600, 4820, 6200],
        HIGHLIGHT_DAY: 5,
        ANIMATION_DELAY: 50,
        MAX_SALES: 10,
    };

    const COLORS = {
        dinheiro: { icon: '💵', name: 'Dinheiro', bg: 'rgba(61, 220, 132, 0.15)', color: 'var(--green)' },
        pix: { icon: '⚡', name: 'Pix', bg: 'rgba(74, 158, 255, 0.15)', color: 'var(--blue)' },
        cartao_credito: { icon: '💳', name: 'Crédito', bg: 'rgba(240, 192, 64, 0.15)', color: 'var(--gold)' },
        cartao_debito: { icon: '💳', name: 'Débito', bg: 'rgba(176, 106, 255, 0.15)', color: 'var(--purple)' },
    };

    const CATEGORIES = [
        { name: 'Bebidas', pct: 38, color: 'var(--gold)' },
        { name: 'Alimentos', pct: 29, color: 'var(--green)' },
        { name: 'Eletrônicos', pct: 18, color: 'var(--blue)' },
        { name: 'Limpeza', pct: 10, color: 'var(--purple)' },
        { name: 'Outros', pct: 5, color: 'var(--text3)' },
    ];

    const getEl = id => document.getElementById(id);
    const fmt = v => typeof window.formatCurrency === 'function' ? window.formatCurrency(v) : `R$ ${v.toLocaleString('pt-BR')}`;
    const hasData = () => window.appData?.products && window.appData?.sales && window.appData?.clients;

    const updateStats = (products, sales, clients) => {
        const totalSales = sales.reduce((sum, s) => sum + s.total, 0);
        const totalItems = products.reduce((sum, p) => sum + p.qty, 0);
        const lowStock = products.filter(p => p.qty < p.min).length;

        getEl('statTotal').textContent = fmt(totalSales);
        getEl('statSales').textContent = sales.length;
        getEl('statStock').textContent = totalItems;
        getEl('statClients').textContent = clients.length;

        getEl('statTotalChange').textContent = `▲ ${((Math.random() * 10 + 5).toFixed(1))}% vs ontem`;
        getEl('statSalesChange').textContent = `▲ ${Math.floor(sales.length * 0.1)} hoje`;
        getEl('statStockChange').innerHTML = lowStock > 0
            ? `<span style="color: var(--red);">▼ ${lowStock} abaixo</span>`
            : `✓ <span style="color: var(--green);">Ótimo</span>`;
        getEl('statClientsChange').textContent = `▲ ${Math.floor(clients.length * 0.05)} novos`;

        const alert = getEl('alertLowStock');
        if (lowStock > 0) {
            getEl('lowStockCount').textContent = lowStock === 1 ? '1 produto' : `${lowStock} produtos`;
            alert.style.display = 'flex';
        } else {
            alert.style.display = 'none';
        }
    };

    const renderWeekChart = (sales) => {
        const chart = getEl('weekChart');
        const labels = getEl('weekLabels');
        if (!chart || !labels) return;

        chart.innerHTML = '';
        labels.innerHTML = '';

        const weekData = CONFIG.CHART_VALUES;
        const max = Math.max(...weekData);
        const min = Math.min(...weekData);
        const total = weekData.reduce((a, b) => a + b, 0);
        const avg = Math.round(total / weekData.length);

        CONFIG.CHART_DAYS.forEach((day, i) => {
            const value = weekData[i];
            const pct = Math.round((value / max) * 100);

            const bar = document.createElement('div');
            bar.className = 'chart-bar';
            bar.title = `${day}: ${fmt(value)}`;

            if (i === CONFIG.HIGHLIGHT_DAY) {
                bar.style.background = 'linear-gradient(180deg, var(--gold), var(--gold2))';
            } else if (pct > 70) {
                bar.style.background = 'linear-gradient(180deg, var(--green), #2cb060)';
            } else if (pct < 40) {
                bar.style.background = 'linear-gradient(180deg, var(--blue), #3080d0)';
            } else {
                bar.style.background = 'linear-gradient(180deg, var(--border2), var(--border))';
            }

            bar.style.height = '0%';
            chart.appendChild(bar);

            setTimeout(() => {
                bar.style.height = `${pct}%`;
            }, CONFIG.ANIMATION_DELAY * i);

            const label = document.createElement('div');
            label.className = 'chart-bar-label';
            label.textContent = day;
            labels.appendChild(label);
        });

        // Update statistics
        getEl('maxSaleValue').textContent = fmt(max);
        getEl('avgSaleValue').textContent = fmt(avg);
        getEl('totalPeriodValue').textContent = fmt(total);
    };

    const renderTopCategories = () => {
        const container = getEl('topCategories');
        if (!container) return;

        container.innerHTML = CATEGORIES.map(cat => `
      <div>
        <div class="flex-between mb-6">
          <span class="font-bold text-sm">${cat.name}</span>
          <span class="mono font-bold" style="color: ${cat.color};">${cat.pct}%</span>
        </div>
        <div class="progress-bar">
          <div class="progress-fill" style="width: ${cat.pct}%; background: ${cat.color};"></div>
        </div>
      </div>
    `).join('');
    };

    const renderPaymentMethods = (sales) => {
        const container = getEl('paymentMethods');
        if (!container) return;

        const paymentCounts = {};
        sales.forEach(s => {
            const method = s.payment || 'dinheiro';
            paymentCounts[method] = (paymentCounts[method] || 0) + 1;
        });

        const total = sales.length;
        const html = Object.entries(COLORS).map(([key, config]) => {
            const count = paymentCounts[key] || 0;
            const pct = total > 0 ? Math.round((count / total) * 100) : 0;

            return `
        <div class="payment-item" style="border-color: ${config.color}; border-width: 2px;">
          <div class="payment-icon">${config.icon}</div>
          <div class="payment-type">${config.name}</div>
          <div class="payment-count">${count}</div>
          <div class="payment-pct">${pct}%</div>
        </div>
      `;
        }).join('');

        container.innerHTML = html;
    };

    const renderRecentSales = (sales) => {
        const tbody = getEl('recentSales');
        if (!tbody) return;

        const recent = sales.slice().reverse().slice(0, CONFIG.MAX_SALES);
        tbody.innerHTML = recent.map(s => {
            const pmConfig = COLORS[s.payment] || COLORS.dinheiro;
            const itemCount = s.items?.length || 0;
            const hour = s.date ? s.date.split(' ')[1] : '00:00';

            return `
        <tr class="fade-in">
          <td class="mono text-muted">#${s.id}</td>
          <td class="font-bold">${s.client}</td>
          <td class="text-muted">${itemCount} ${itemCount === 1 ? 'item' : 'itens'}</td>
          <td class="mono text-gold font-bold">${fmt(s.total)}</td>
          <td><span style="margin-right: 4px;">${pmConfig.icon}</span>${pmConfig.name}</td>
          <td class="text-muted mono">${hour}</td>
          <td><span class="tag green">✓ Pago</span></td>
        </tr>
      `;
        }).join('');

        if (recent.length === 0) {
            tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; padding: 40px 20px; color: var(--text3);">
        📊 Nenhuma venda registrada
      </td></tr>`;
        }
    };

    const render = () => {
        if (!hasData()) {
            console.warn('Dashboard: appData not loaded');
            return;
        }

        const { products, sales, clients } = window.appData;

        updateStats(products, sales, clients);
        renderWeekChart(sales);
        renderTopCategories();
        renderPaymentMethods(sales);
        renderRecentSales(sales);
    };

    const init = () => {
        if (typeof updateTopbarTitle === 'function') updateTopbarTitle('Dashboard');
        if (typeof markNavActive === 'function') markNavActive('/dashboard');
        render();
    };

    return { init, render };
})();

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => Dashboard.init?.());
} else {
    Dashboard.init?.();
}
