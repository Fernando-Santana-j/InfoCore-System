const Dashboard = (() => {
    const CHART_DAYS = 7;
    const MAX_SALES = 10;
    const ANIMATION_DELAY = 50;
    const WEEKDAY_LABELS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sab'];
    const DEFAULT_PAYMENT_KEYS = ['money', 'credit_card', 'debit_card', 'pix'];

    const domCache = new Map();
    const getEl = (id) => {
        if (!domCache.has(id)) domCache.set(id, document.getElementById(id));
        return domCache.get(id);
    };
    const fmt = (v) => typeof window.formatCurrency === 'function' ? window.formatCurrency(v || 0) : `R$ ${(v || 0).toLocaleString('pt-BR')}`;
    const asArray = (value) => Array.isArray(value) ? value : (value && typeof value === 'object' ? Object.values(value) : []);
    const asNumber = (v) => {
        const n = Number(v);
        return Number.isFinite(n) ? n : 0;
    };
    const pluralize = (count, singular, plural = `${singular}s`) => `${count} ${count === 1 ? singular : plural}`;
    const setText = (id, text) => {
        const el = getEl(id);
        if (el) el.textContent = text;
    };
    const setHtml = (id, html) => {
        const el = getEl(id);
        if (el) el.innerHTML = html;
    };
    const setDisplay = (id, display) => {
        const el = getEl(id);
        if (el) el.style.display = display;
    };
    const normalizePaymentKey = (payment) => {
        const map = {
            money: 'money',
            credit_card: 'credit_card',
            debit_card: 'debit_card',
            pix: 'pix',
            dinheiro: 'money',
            cartao_credito: 'credit_card',
            cartao_debito: 'debit_card'
        };
        return map[payment] || 'money';
    };
    const getPaymentConfig = (paymentKey) => {
        const methods = window.appData?.configs?.payment_methods || {};
        const method = methods[paymentKey];
        if (method) {
            return {
                icon: method.icon || '💳',
                name: method.name || paymentKey,
                color: method.color || 'var(--border)'
            };
        }
        return { icon: '💳', name: paymentKey || 'Pagamento', color: 'var(--border)' };
    };

    const getData = () => {
        const data = window.appData || {};
        return {
            products: asArray(data.products),
            sales: asArray(data.sales),
            clients: asArray(data.clients)
        };
    };

    const updateStats = ({ products, sales, clients }) => {
        const totalSales = sales.reduce((sum, s) => sum + asNumber(s.total), 0);
        const totalItems = products.reduce((sum, p) => sum + asNumber(p.qty), 0);
        const lowStock = products.filter((p) => asNumber(p.qty) < asNumber(p.min)).length;

        setText('statTotal', fmt(totalSales));
        setText('statSales', String(sales.length));
        setText('statStock', String(totalItems));
        setText('statClients', String(clients.length));

        setText('statTotalChange', `${pluralize(sales.length, 'venda')} registrada${sales.length === 1 ? '' : 's'}`);
        setText('statSalesChange', `${sales.length} no histórico`);
        setHtml('statStockChange', lowStock > 0 ? `<span style="color: var(--red);">${lowStock} em risco</span>` : `✓ <span style="color: var(--green);">Tudo ok</span>`);
        setText('statClientsChange', pluralize(clients.length, 'cliente'));

        setDisplay('alertLowStock', lowStock > 0 ? 'flex' : 'none');
        setText('lowStockCount', pluralize(lowStock, 'produto'));
    };

    const parseSaleDate = (sale) => {
        const raw = String(sale.date || '').trim();
        if (!raw) return null;
        const isoCandidate = raw.replace(' ', 'T');
        const d = new Date(isoCandidate);
        return Number.isNaN(d.getTime()) ? null : d;
    };

    const renderWeekChart = ({ sales }) => {
        const chart = getEl('weekChart');
        const labels = getEl('weekLabels');
        if (!chart || !labels) return;

        const now = new Date();
        const days = [];
        for (let i = CHART_DAYS - 1; i >= 0; i -= 1) {
            const d = new Date(now);
            d.setHours(0, 0, 0, 0);
            d.setDate(now.getDate() - i);
            days.push(d);
        }
        const dayIndexByTs = new Map(days.map((day, idx) => [day.getTime(), idx]));

        const totals = days.map(() => 0);
        sales.forEach((sale) => {
            const d = parseSaleDate(sale);
            if (!d) return;
            d.setHours(0, 0, 0, 0);
            const idx = dayIndexByTs.get(d.getTime());
            if (idx !== undefined) totals[idx] += asNumber(sale.total);
        });

        const max = Math.max(0, ...totals);
        const sum = totals.reduce((acc, value) => acc + value, 0);
        const avg = totals.length ? sum / totals.length : 0;
        const peakIdx = totals.indexOf(max);

        chart.innerHTML = '';
        labels.innerHTML = '';

        totals.forEach((value, i) => {
            const pct = max > 0 ? Math.max(6, Math.round((value / max) * 100)) : 6;
            const bar = document.createElement('div');
            bar.className = 'chart-bar';
            bar.title = `${WEEKDAY_LABELS[days[i].getDay()]}: ${fmt(value)}`;
            bar.style.height = '0%';
            bar.style.background = i === peakIdx ? 'linear-gradient(180deg, var(--gold), var(--gold2))' : 'linear-gradient(180deg, var(--blue), #3080d0)';
            chart.appendChild(bar);
            setTimeout(() => { bar.style.height = `${pct}%`; }, ANIMATION_DELAY * i);

            const label = document.createElement('div');
            label.className = 'chart-bar-label';
            label.textContent = WEEKDAY_LABELS[days[i].getDay()];
            labels.appendChild(label);
        });

        const maxSaleValue = getEl('maxSaleValue');
        const avgSaleValue = getEl('avgSaleValue');
        const totalPeriodValue = getEl('totalPeriodValue');
        if (maxSaleValue) maxSaleValue.textContent = fmt(max);
        if (avgSaleValue) avgSaleValue.textContent = fmt(avg);
        if (totalPeriodValue) totalPeriodValue.textContent = fmt(sum);
    };

    const normalizeCssColor = (color) => {
        if (!color || typeof color !== 'string') return 'var(--text3)';
        const trimmed = color.trim();
        if (trimmed.startsWith('var(') || trimmed.startsWith('#') || trimmed.startsWith('rgb')) return trimmed;
        if (trimmed.startsWith('--')) return `var(${trimmed})`;
        return trimmed;
    };

    const renderTopCategories = ({ sales, products }) => {
        const container = getEl('topCategories');
        if (!container) return;

        const categorySalesCount = {};
        let totalCount = 0;
        const hasDirectCategorySales = sales.some((sale) => sale && sale.category);

        if (hasDirectCategorySales) {
            sales.forEach((sale) => {
                const saleCategory = sale?.category || 'others';
                categorySalesCount[saleCategory] = (categorySalesCount[saleCategory] || 0) + 1;
                totalCount += 1;
            });
        } else {
            const byProductId = new Map(products.map((p) => [p.id, p]));
            sales.forEach((sale) => {
                const items = asArray(sale.items);
                items.forEach((item) => {
                    const product = byProductId.get(item.id);
                    const category = item.category || product?.category || 'others';
                    categorySalesCount[category] = (categorySalesCount[category] || 0) + 1;
                    totalCount += 1;
                });
            });
        }

        const categoryConfig = window.appData?.configs?.category || {};
        const configuredKeys = Object.keys(categoryConfig);
        const dynamicKeys = Object.keys(categorySalesCount).filter((key) => !configuredKeys.includes(key));
        const allKeys = [...configuredKeys, ...dynamicKeys];
        const orderedKeys = allKeys.slice().sort((a, b) => (categorySalesCount[b] || 0) - (categorySalesCount[a] || 0));

        if (orderedKeys.length === 0) {
            container.innerHTML = '<div class="text-muted">Sem categorias configuradas</div>';
            return;
        }

        container.innerHTML = orderedKeys.map((key) => {
            const cfg = categoryConfig[key] || {};
            const name = cfg.name || key;
            const color = normalizeCssColor(cfg.color || 'var(--text3)');
            const count = categorySalesCount[key] || 0;
            const pct = totalCount > 0 ? Math.round((count / totalCount) * 100) : 0;
            return `
      <div>
        <div class="flex-between mb-6">
          <span class="font-bold text-sm">${name}</span>
          <span class="mono font-bold" style="color: ${color};">${count} venda${count === 1 ? '' : 's'} (${pct}%)</span>
        </div>
        <div class="progress-bar">
          <div class="progress-fill" style="width: ${pct}%; background: ${color};"></div>
        </div>
      </div>
    `;
        }).join('');
    };

    const renderPaymentMethods = ({ sales }) => {
        const container = getEl('paymentMethods');
        if (!container) return;

        const counts = {};
        sales.forEach((sale) => {
            const key = normalizePaymentKey(sale.payment);
            counts[key] = (counts[key] || 0) + 1;
        });

        const paymentMethods = window.appData?.configs?.payment_methods || {};
        const keys = Object.keys(paymentMethods);
        const baseKeys = keys.length ? keys : DEFAULT_PAYMENT_KEYS;
        const total = sales.length;

        container.innerHTML = baseKeys.map((key) => {
            const cfg = getPaymentConfig(key);
            const count = counts[key] || 0;
            const pct = total > 0 ? Math.round((count / total) * 100) : 0;
            return `
        <div class="payment-item" style="border-color: ${cfg.color}; border-width: 2px;">
          <div class="payment-icon">${cfg.icon}</div>
          <div class="payment-type">${cfg.name}</div>
          <div class="payment-count">${count}</div>
          <div class="payment-pct">${pct}%</div>
        </div>
      `;
        }).join('');
    };

    const renderRecentSales = ({ sales }) => {
        const tbody = getEl('recentSales');
        if (!tbody) return;

        const recent = sales.slice().reverse().slice(0, MAX_SALES);
        if (recent.length === 0) {
            tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; padding: 40px 20px; color: var(--text3);">📊 Nenhuma venda registrada</td></tr>`;
            return;
        }

        tbody.innerHTML = recent.map((sale) => {
            const paymentCfg = getPaymentConfig(normalizePaymentKey(sale.payment));
            const itemCount = asArray(sale.items).length;
            const hour = String(sale.date || '').split(' ')[1] || '--:--';
            return `
        <tr class="fade-in">
          <td class="mono text-muted">#${sale.id || '-'}</td>
          <td class="font-bold">${sale.client || 'Balcao'}</td>
          <td class="text-muted">${itemCount} ${itemCount === 1 ? 'item' : 'itens'}</td>
          <td class="mono text-gold font-bold">${fmt(sale.total)}</td>
          <td class="sales-payment-content"><span class="sales-payment-icon" style="margin-right: 4px;">${paymentCfg.icon}</span>${paymentCfg.name}</td>
          <td class="text-muted mono">${hour}</td>
          <td><span class="tag green">✓ Pago</span></td>
        </tr>
      `;
        }).join('');
    };

    const render = () => {
        const data = getData();
        updateStats(data);
        renderWeekChart(data);
        renderTopCategories(data);
        renderPaymentMethods(data);
        renderRecentSales(data);
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
