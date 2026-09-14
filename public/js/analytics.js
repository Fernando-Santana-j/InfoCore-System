const Analytics = (() => {
    const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
    const list = (value) => Array.isArray(value) ? value : [];
    const num = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
    const money = (value) => formatCurrency(num(value));
    const colors = ['var(--accent)', 'var(--gold)', 'var(--blue)', 'var(--purple)', 'var(--green)', 'var(--red)'];
    const paymentLabels = { money: 'Dinheiro', credit_card: 'Crédito', debit_card: 'Débito', pix: 'Pix' };

    function saleDate(sale) {
        const date = new Date(sale?.createdAt || sale?.date || '');
        return Number.isNaN(date.getTime()) ? null : date;
    }

    function periodSales() {
        const sales = list(window.appData?.sales);
        const value = document.getElementById('reportPeriod')?.value || '30';
        if (value === 'all') return sales;
        const cutoff = new Date();
        cutoff.setHours(0, 0, 0, 0);
        cutoff.setDate(cutoff.getDate() - Math.max(0, Number(value) - 1));
        return sales.filter((sale) => {
            const date = saleDate(sale);
            return date && date >= cutoff;
        });
    }

    function productMaps() {
        const byId = new Map();
        const bySku = new Map();
        list(window.appData?.products).forEach((product) => {
            if (product.id != null) byId.set(String(product.id), product);
            if (product.sku != null) bySku.set(String(product.sku).toLowerCase(), product);
        });
        return { byId, bySku };
    }

    function catalogProduct(item, maps) {
        return maps.byId.get(String(item?.id || '')) || maps.bySku.get(String(item?.sku || '').toLowerCase()) || null;
    }

    function saleCost(sale) {
        if (Number.isFinite(Number(sale?.costTotal)) && Number(sale.costTotal) > 0) return Number(sale.costTotal);
        return list(sale?.items).reduce((sum, item) => sum + (num(item.lineCost) || num(item.cost) * num(item.qty)), 0);
    }

    function aggregate() {
        const sales = periodSales();
        const maps = productMaps();
        const categories = new Map();
        const products = new Map();
        const payments = new Map();
        let revenue = 0;
        let cost = 0;
        let quantity = 0;
        sales.forEach((sale) => {
            const saleTotal = num(sale.total);
            revenue += saleTotal;
            cost += saleCost(sale);
            const payment = paymentLabels[sale.payment] ? sale.payment : 'money';
            const paymentRow = payments.get(payment) || { count: 0, revenue: 0 };
            paymentRow.count += 1;
            paymentRow.revenue += saleTotal;
            payments.set(payment, paymentRow);
            const subtotal = list(sale.items).reduce((sum, item) => sum + (num(item.lineTotal) || num(item.price) * num(item.qty)), 0) || saleTotal;
            list(sale.items).forEach((item) => {
                const product = catalogProduct(item, maps);
                const qty = Math.max(0, num(item.qty));
                const lineRevenue = num(item.lineTotal) || num(item.price) * qty;
                const apportionedRevenue = subtotal > 0 ? saleTotal * (lineRevenue / subtotal) : lineRevenue;
                const category = String(item.category || product?.category || 'others');
                const categoryRow = categories.get(category) || { quantity: 0, revenue: 0 };
                categoryRow.quantity += qty;
                categoryRow.revenue += apportionedRevenue;
                categories.set(category, categoryRow);
                const key = String(item.id || item.sku || item.name || 'item');
                const productRow = products.get(key) || { name: item.name || product?.name || 'Item', quantity: 0, revenue: 0 };
                productRow.quantity += qty;
                productRow.revenue += apportionedRevenue;
                products.set(key, productRow);
                quantity += qty;
            });
        });
        return { sales, categories, products, payments, revenue, cost, profit: revenue - cost, quantity };
    }

    const empty = (message) => `<div class="analytics-empty"><span>◇</span><p>${esc(message)}</p></div>`;

    function renderKpis(data) {
        const margin = data.revenue > 0 ? (data.profit / data.revenue) * 100 : 0;
        const ticket = data.sales.length ? data.revenue / data.sales.length : 0;
        document.getElementById('analyticsKpis').innerHTML = [
            ['Receita', money(data.revenue), `${data.sales.length} venda(s)`, '↗'],
            ['Lucro bruto', money(data.profit), `${margin.toFixed(1).replace('.', ',')}% de margem`, '◆'],
            ['Ticket médio', money(ticket), 'por venda', '◎'],
            ['Itens vendidos', String(data.quantity), 'unidades e serviços', '□']
        ].map(([label, value, detail, icon]) => `<article class="analytics-kpi"><span>${icon}</span><div><small>${label}</small><strong>${value}</strong><em>${detail}</em></div></article>`).join('');
    }

    function renderCategories(data) {
        const container = document.getElementById('reportCategories');
        const rows = [...data.categories.entries()].sort((a, b) => b[1].revenue - a[1].revenue).slice(0, 8);
        if (!rows.length) { container.innerHTML = empty('Nenhuma categoria vendida no período.'); return; }
        const categoryConfig = window.appData?.configs?.category || {};
        container.innerHTML = rows.map(([key, row], index) => {
            const percent = data.revenue > 0 ? (row.revenue / data.revenue) * 100 : 0;
            const name = categoryConfig[key]?.name || key;
            return `<div class="analytics-progress"><div><strong>${esc(name)}</strong><span>${row.quantity} item(ns) · ${money(row.revenue)}</span></div><div class="analytics-progress-track"><i style="width:${Math.max(2, percent).toFixed(2)}%;background:${colors[index % colors.length]}"></i></div><b>${percent.toFixed(1).replace('.', ',')}%</b></div>`;
        }).join('');
    }

    function renderTopProducts(data) {
        const container = document.getElementById('reportTopProducts');
        const rows = [...data.products.values()].sort((a, b) => b.quantity - a.quantity || b.revenue - a.revenue).slice(0, 8);
        if (!rows.length) { container.innerHTML = empty('Nenhum item vendido no período.'); return; }
        container.innerHTML = rows.map((row, index) => `<div class="analytics-rank"><span>${index + 1}</span><div><strong>${esc(row.name)}</strong><small>${row.quantity} vendido(s)</small></div><b>${money(row.revenue)}</b></div>`).join('');
    }

    function renderPayments(data) {
        const container = document.getElementById('reportPayments');
        const rows = [...data.payments.entries()].sort((a, b) => b[1].revenue - a[1].revenue);
        if (!rows.length) { container.innerHTML = empty('Nenhum pagamento registrado no período.'); return; }
        container.innerHTML = rows.map(([key, row], index) => {
            const percent = data.revenue > 0 ? (row.revenue / data.revenue) * 100 : 0;
            return `<div class="analytics-payment"><i style="background:${colors[index % colors.length]}"></i><div><strong>${esc(paymentLabels[key] || key)}</strong><small>${row.count} venda(s)</small></div><b>${money(row.revenue)}</b><span>${percent.toFixed(1).replace('.', ',')}%</span></div>`;
        }).join('');
    }

    function renderFinancial(data) {
        const container = document.getElementById('reportFinancial');
        const margin = data.revenue > 0 ? (data.profit / data.revenue) * 100 : 0;
        const clients = new Set(data.sales.map((sale) => String(sale.client || '').trim().toLowerCase()).filter((name) => name && name !== 'balcão' && name !== 'balcao'));
        container.innerHTML = [
            ['Receita bruta', money(data.revenue), 'positive'],
            ['Custo registrado', money(data.cost), 'negative'],
            ['Lucro bruto', money(data.profit), data.profit >= 0 ? 'positive' : 'negative'],
            ['Margem bruta', `${margin.toFixed(1).replace('.', ',')}%`, 'neutral'],
            ['Clientes identificados', String(clients.size), 'neutral']
        ].map(([label, value, tone]) => `<div class="analytics-financial"><span>${label}</span><strong class="${tone}">${value}</strong></div>`).join('');
    }

    function render() {
        const data = aggregate();
        renderKpis(data);
        renderCategories(data);
        renderTopProducts(data);
        renderPayments(data);
        renderFinancial(data);
    }

    function init() {
        updateTopbarTitle('Análises');
        markNavActive('/analytics');
        document.getElementById('reportPeriod')?.addEventListener('change', render);
        render();
    }
    return { init, render };
})();

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => whenAppReady(Analytics.init));
else whenAppReady(Analytics.init);
