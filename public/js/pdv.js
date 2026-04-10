let currentPDVFilter = 'todos';
let confirmActionType = null;
let selectedPaymentMethod = 'money';
let cartAdjustments = {
    discount: { type: 'fixed', value: 0 },
    extra: { type: 'fixed', value: 0 }
};
let currentAdjustmentTarget = 'discount';

function asArray(value) {
    if (Array.isArray(value)) return value;
    if (value && typeof value === 'object') return Object.values(value);
    return [];
}

function asNumber(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
}

function normalizePaymentKey(payment) {
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
}

function getPaymentMethods() {
    return window.appData?.configs?.payment_methods || {};
}

function getCategories() {
    return window.appData?.configs?.category || {};
}

function getPaymentLabel(paymentKey) {
    const method = getPaymentMethods()[paymentKey];
    return method?.name || paymentKey;
}

function getPaymentIcon(paymentKey) {
    const method = getPaymentMethods()[paymentKey];
    return method?.icon || '💳';
}

function getAdjustmentValue(target) {
    return cartAdjustments[target]?.value || 0;
}

function getAdjustmentType(target) {
    return cartAdjustments[target]?.type || 'fixed';
}

function setAdjustment(target, type, value) {
    if (!cartAdjustments[target]) cartAdjustments[target] = { type: 'fixed', value: 0 };
    cartAdjustments[target].type = type === 'percent' ? 'percent' : 'fixed';
    cartAdjustments[target].value = Math.max(0, asNumber(value));
}

function formatAdjustment(type, value) {
    if (type === 'percent') return `${asNumber(value).toFixed(2)}%`;
    return formatCurrency(value);
}

function getQuickAdjustments(target, type) {
    if (type === 'percent') {
        return target === 'discount' ? [5, 10, 15, 20] : [5, 10, 12, 15];
    }
    return target === 'discount' ? [5, 10, 20, 50] : [2, 5, 10, 20];
}

function renderQuickAdjustmentButtons() {
    const container = document.getElementById('cartAdjustmentQuickValues');
    if (!container) return;
    const type = getAdjustmentType(currentAdjustmentTarget);
    const options = getQuickAdjustments(currentAdjustmentTarget, type);
    const currentValue = asNumber(document.getElementById('cartAdjustmentValue')?.value || getAdjustmentValue(currentAdjustmentTarget));
    container.innerHTML = options.map((value) => {
        const active = asNumber(currentValue) === asNumber(value) ? 'active' : '';
        const label = type === 'percent' ? `${value}%` : formatCurrency(value);
        return `<button type="button" class="quick-adjust-btn ${active}" onclick="setQuickAdjustmentValue(${value})">${label}</button>`;
    }).join('');
}

function setQuickAdjustmentValue(value) {
    const input = document.getElementById('cartAdjustmentValue');
    if (!input) return;
    input.value = String(asNumber(value));
    renderQuickAdjustmentButtons();
}

function ensureAppDataShape() {
    if (!window.appData || typeof window.appData !== 'object') window.appData = {};
    window.appData.products = asArray(window.appData.products);
    window.appData.sales = asArray(window.appData.sales);
    window.appData.cart = asArray(window.appData.cart);
}

function renderPDVFilters() {
    const container = document.querySelector('#page-pdv .filter-bar');
    if (!container) return;
    const categories = getCategories();
    const buttons = [`<button class="filter-btn ${currentPDVFilter === 'todos' ? 'active' : ''}" onclick="setPDVFilter('todos',this)">Todos</button>`];
    Object.keys(categories).forEach((key) => {
        const isActive = currentPDVFilter === key ? 'active' : '';
        const label = categories[key]?.name || key;
        buttons.push(`<button class="filter-btn ${isActive}" onclick="setPDVFilter('${key}',this)">${label}</button>`);
    });
    container.innerHTML = buttons.join('');
}

function renderPaymentButtons() {
    const container = document.getElementById('paymentMethodsButtons');
    if (!container) return;
    const methods = getPaymentMethods();
    const keys = Object.keys(methods);
    if (keys.length === 0) {
        container.innerHTML = '<div class="text-xs text-muted">Nenhum metodo configurado</div>';
        selectedPaymentMethod = 'money';
        return;
    }
    selectedPaymentMethod = normalizePaymentKey(selectedPaymentMethod || keys[0] || 'money');
    if (!keys.includes(selectedPaymentMethod)) selectedPaymentMethod = keys[0];
    const buttons = keys.map((key) => {
        const method = methods[key] || {};
        const active = selectedPaymentMethod === key ? 'active' : '';
        return `
            <button class="payment-method-btn ${active}" type="button" onclick="selectPaymentMethod('${key}')">
                <span class="payment-method-icon" style="color:${method.color || 'var(--gold)'};">${method.icon || '💳'}</span>
                <span class="payment-method-label">${method.name || key}</span>
            </button>
        `;
    });
    container.innerHTML = buttons.join('');
}

function selectPaymentMethod(key) {
    selectedPaymentMethod = normalizePaymentKey(key);
    renderPaymentButtons();
}

function initPDV() {
    ensureAppDataShape();
    updateTopbarTitle('PDV');
    markNavActive('/pdv');
    renderPDVFilters();
    renderPaymentButtons();
    renderPDV();
    renderCart();
}

function renderPDV(filter) {
    ensureAppDataShape();
    currentPDVFilter = filter || currentPDVFilter;

    const products = asArray(window.appData.products);
    const categories = getCategories();
    const search = (document.getElementById('pdvSearch')?.value || '').toLowerCase().trim();
    const grid = document.getElementById('pdvGrid');
    if (!grid) return;

    let list = products.filter((p) => p.active !== false && asNumber(p.qty) > 0);
    if (search) {
        list = list.filter((p) => String(p.name || '').toLowerCase().includes(search) || String(p.sku || '').toLowerCase().includes(search));
    }
    if (currentPDVFilter !== 'todos') {
        list = list.filter((p) => String(p.category) === String(currentPDVFilter));
    }

    grid.innerHTML = list.map((p) => `
    <div class="pdv-product-card" onclick="addToCart(${p.id})">
      <div class="prod-emoji">${p.emoji || '📦'}</div>
      <div class="prod-name">${p.name || 'Produto'}</div>
      <div class="prod-price">${formatCurrency(asNumber(p.price))}</div>
      <div style="font-size:0.65rem;color:var(--text3);margin-top:2px;">${categories[p.category]?.name || p.category || 'Sem categoria'} • ${asNumber(p.qty)} em estoque</div>
    </div>
  `).join('') || `<div class="empty-state"><div class="empty-icon">📦</div><p>Nenhum produto</p></div>`;
}

function setPDVFilter(filter, btn) {
    currentPDVFilter = filter;
    document.querySelectorAll('#page-pdv .filter-btn').forEach((b) => b.classList.remove('active'));
    if (btn) btn.classList.add('active');
    renderPDV(currentPDVFilter);
}

function filterPDV() {
    renderPDV(currentPDVFilter);
}

function addToCart(id) {
    ensureAppDataShape();
    const products = window.appData.products;
    const cart = window.appData.cart;
    const product = products.find((x) => x.id === id);
    if (!product || asNumber(product.qty) <= 0) {
        showToast('Produto sem estoque!', 'error');
        return;
    }

    const existing = cart.find((x) => x.id === id);
    if (existing) {
        if (asNumber(existing.qty) >= asNumber(product.qty)) {
            showToast('Estoque insuficiente!', 'error');
            return;
        }
        existing.qty += 1;
    } else {
        cart.push({
            id: product.id,
            name: product.name,
            category: product.category,
            price: asNumber(product.price),
            qty: 1
        });
    }

    renderCart();
    showToast(`${product.name} adicionado ao carrinho`, 'success');
}

function getCurrentTotals() {
    const cart = asArray(window.appData?.cart);
    const subtotal = cart.reduce((s, i) => s + (asNumber(i.price) * asNumber(i.qty)), 0);
    const discountType = getAdjustmentType('discount');
    const discountInput = getAdjustmentValue('discount');
    const extraType = getAdjustmentType('extra');
    const extraInput = getAdjustmentValue('extra');

    const discount = discountType === 'percent'
        ? (subtotal * discountInput) / 100
        : discountInput;
    const extra = extraType === 'percent'
        ? (subtotal * extraInput) / 100
        : extraInput;
    const total = Math.max(0, subtotal - discount + extra);
    return { subtotal, discount, extra, total };
}

function openConfirmActionModal(actionType) {
    confirmActionType = actionType;
    const title = document.getElementById('confirmActionTitle');
    const message = document.getElementById('confirmActionMessage');
    const confirmBtn = document.getElementById('confirmActionBtn');
    const totalsEl = document.getElementById('confirmActionTotals');
    const itemsEl = document.getElementById('confirmActionItems');
    const modal = document.getElementById('confirmActionModal');
    const payment = normalizePaymentKey(selectedPaymentMethod);
    const cart = asArray(window.appData?.cart);
    const totals = getCurrentTotals();
    const totalItems = cart.reduce((sum, item) => sum + asNumber(item.qty), 0);

    if (totalsEl) {
        totalsEl.innerHTML = `
            <div class="pdv-confirm-row"><span>Subtotal</span><strong>${formatCurrency(totals.subtotal)}</strong></div>
            <div class="pdv-confirm-row"><span>Desconto (${formatAdjustment(getAdjustmentType('discount'), getAdjustmentValue('discount'))})</span><strong>- ${formatCurrency(totals.discount)}</strong></div>
            <div class="pdv-confirm-row"><span>Acréscimo (${formatAdjustment(getAdjustmentType('extra'), getAdjustmentValue('extra'))})</span><strong>+ ${formatCurrency(totals.extra)}</strong></div>
            <div class="pdv-confirm-row"><span>Pagamento</span><strong><span class="pdv-confirm-payment-icon">${getPaymentIcon(payment)}</span> ${getPaymentLabel(payment)}</strong></div>
            <div class="pdv-confirm-row"><span>Itens</span><strong>${totalItems}</strong></div>
            <div class="pdv-confirm-row total"><span>Total</span><strong>${formatCurrency(totals.total)}</strong></div>
        `;
    }

    if (itemsEl) {
        itemsEl.innerHTML = cart.length
            ? cart.map((item) => `
                <div class="pdv-confirm-item">
                    <div class="pdv-confirm-item-name">${item.name || 'Produto'}</div>
                    <div class="pdv-confirm-item-qty">x${asNumber(item.qty)}</div>
                    <div class="pdv-confirm-item-value">${formatCurrency(asNumber(item.price) * asNumber(item.qty))}</div>
                </div>
            `).join('')
            : `<div class="empty-state" style="padding:20px;"><p>Carrinho vazio</p></div>`;
    }

    if (actionType === 'finalizar') {
        if (title) title.textContent = 'Finalizar venda';
        if (message) message.textContent = 'Revise os itens e valores abaixo antes de finalizar.';
        if (confirmBtn) confirmBtn.textContent = 'Finalizar';
    } else {
        if (title) title.textContent = 'Limpar carrinho';
        if (message) message.textContent = 'Confirme os itens e totais que serao removidos.';
        if (confirmBtn) confirmBtn.textContent = 'Limpar';
    }

    if (modal) modal.classList.add('open');
}

function closeConfirmActionModal() {
    const modal = document.getElementById('confirmActionModal');
    if (modal) modal.classList.remove('open');
    confirmActionType = null;
}

function executeConfirmedAction() {
    if (confirmActionType === 'finalizar') finalizeSaleCore();
    if (confirmActionType === 'limpar') clearCartCore();
    closeConfirmActionModal();
}

function renderCart() {
    ensureAppDataShape();
    const cart = window.appData.cart;
    const container = document.getElementById('cartItems');
    if (!container) return;

    if (cart.length === 0) {
        container.innerHTML = '<div class="empty-state" style="padding:30px;"><div class="empty-icon">🛒</div><p>Carrinho vazio</p></div>';
    } else {
        container.innerHTML = cart.map((item) => `
      <div class="cart-item">
        <div class="cart-item-name">${item.name || 'Produto'}</div>
        <div class="cart-item-qty">
          <button class="qty-btn" onclick="changeQty(${item.id},-1)">−</button>
          <span class="qty-num">${asNumber(item.qty)}</span>
          <button class="qty-btn" onclick="changeQty(${item.id},1)">+</button>
        </div>
        <div class="cart-item-price">${formatCurrency(asNumber(item.price) * asNumber(item.qty))}</div>
        <div class="cart-item-remove" onclick="removeFromCart(${item.id})">✕</div>
      </div>
    `).join('');
    }

    const totals = getCurrentTotals();
    const count = document.getElementById('cartCount');
    const sub = document.getElementById('cartSubtotal');
    const tot = document.getElementById('cartTotal');
    const discountEl = document.getElementById('cartDiscount');
    const extraEl = document.getElementById('cartExtra');

    if (count) count.textContent = `${cart.length} item${cart.length !== 1 ? 's' : ''}`;
    if (sub) sub.textContent = formatCurrency(totals.subtotal);
    if (tot) tot.textContent = formatCurrency(totals.total);
    if (discountEl) discountEl.textContent = `- ${formatCurrency(totals.discount)}`;
    if (extraEl) extraEl.textContent = `+ ${formatCurrency(totals.extra)}`;
}

function changeQty(id, delta) {
    const cart = asArray(window.appData?.cart);
    const products = asArray(window.appData?.products);
    const item = cart.find((x) => x.id === id);
    if (!item) return;

    const product = products.find((x) => x.id === id);
    const maxQty = asNumber(product?.qty || 0);
    const next = asNumber(item.qty) + delta;
    if (next <= 0) return removeFromCart(id);
    if (next > maxQty) {
        showToast('Estoque insuficiente!', 'error');
        return;
    }
    item.qty = next;
    renderCart();
}

function removeFromCart(id) {
    const cart = asArray(window.appData?.cart);
    const idx = cart.findIndex((x) => x.id === id);
    if (idx !== -1) cart.splice(idx, 1);
    renderCart();
}

function clearCart() {
    openConfirmActionModal('limpar');
}

function clearCartCore() {
    window.appData.cart = [];
    setAdjustment('discount', 'fixed', 0);
    setAdjustment('extra', 'fixed', 0);
    renderCart();
}

function finalizeSaleCore() {
    ensureAppDataShape();
    const cart = window.appData.cart;
    const products = window.appData.products;
    const sales = window.appData.sales;
    if (cart.length === 0) {
        showToast('Carrinho vazio!', 'error');
        return;
    }

    const totals = getCurrentTotals();
    const payment = normalizePaymentKey(selectedPaymentMethod);
    const id = `VD-${String(sales.length + 1).padStart(3, '0')}`;
    const now = new Date();
    const dateStr = `${now.toISOString().slice(0, 10)} ${now.toTimeString().slice(0, 5)}`;

    cart.forEach((item) => {
        const product = products.find((x) => x.id === item.id);
        if (product) product.qty = Math.max(0, asNumber(product.qty) - asNumber(item.qty));
    });

    sales.push({
        id,
        date: dateStr,
        client: 'Balcao',
        items: cart.map((i) => ({ ...i })),
        discount: totals.discount,
        extra: totals.extra,
        subtotal: totals.subtotal,
        total: totals.total,
        payment
    });

    window.appData.cart = [];
    renderCart();
    renderPDV(currentPDVFilter);
    showToast(`Venda ${id} finalizada! ${formatCurrency(totals.total)}`, 'success');
}

function finalizarVenda() {
    openConfirmActionModal('finalizar');
}

function openCartAdjustmentModal(target) {
    currentAdjustmentTarget = target === 'extra' ? 'extra' : 'discount';
    const modal = document.getElementById('cartAdjustmentModal');
    const title = document.getElementById('cartAdjustmentTitle');
    const hint = document.getElementById('cartAdjustmentHint');
    const valueInput = document.getElementById('cartAdjustmentValue');
    const type = getAdjustmentType(currentAdjustmentTarget);
    const value = getAdjustmentValue(currentAdjustmentTarget);
    const radios = document.querySelectorAll('input[name="adjustmentType"]');

    if (title) title.textContent = currentAdjustmentTarget === 'discount' ? 'Aplicar desconto' : 'Aplicar acréscimo';
    if (hint) hint.textContent = currentAdjustmentTarget === 'discount'
        ? 'Escolha o tipo e valor do desconto para esta venda.'
        : 'Escolha o tipo e valor do acréscimo para esta venda.';
    radios.forEach((radio) => {
        radio.checked = radio.value === type;
    });
    if (valueInput) valueInput.value = value > 0 ? String(value) : '';
    renderQuickAdjustmentButtons();
    if (modal) modal.classList.add('open');
}

function closeCartAdjustmentModal() {
    const modal = document.getElementById('cartAdjustmentModal');
    if (modal) modal.classList.remove('open');
}

function saveCartAdjustment() {
    const radios = document.querySelectorAll('input[name="adjustmentType"]');
    let selectedType = 'fixed';
    radios.forEach((radio) => {
        if (radio.checked) selectedType = radio.value;
    });
    const input = document.getElementById('cartAdjustmentValue');
    const rawValue = asNumber(input?.value);
    if (selectedType === 'percent' && rawValue > 100) {
        showToast('A porcentagem maxima e 100%.', 'error');
        return;
    }
    setAdjustment(currentAdjustmentTarget, selectedType, rawValue);
    renderCart();
    closeCartAdjustmentModal();
}

function bindConfirmModal() {
    const closeBtn = document.getElementById('closeConfirmActionModalBtn');
    const cancelBtn = document.getElementById('cancelConfirmActionBtn');
    const confirmBtn = document.getElementById('confirmActionBtn');
    const modal = document.getElementById('confirmActionModal');
    if (closeBtn) closeBtn.addEventListener('click', closeConfirmActionModal);
    if (cancelBtn) cancelBtn.addEventListener('click', closeConfirmActionModal);
    if (confirmBtn) confirmBtn.addEventListener('click', executeConfirmedAction);
    if (modal) modal.addEventListener('click', (e) => { if (e.target === modal) closeConfirmActionModal(); });
}

function bindCartAdjustmentModal() {
    const openDiscountBtn = document.getElementById('btnOpenDiscountModal');
    const openExtraBtn = document.getElementById('btnOpenExtraModal');
    const closeBtn = document.getElementById('closeCartAdjustmentModalBtn');
    const cancelBtn = document.getElementById('cancelCartAdjustmentBtn');
    const saveBtn = document.getElementById('saveCartAdjustmentBtn');
    const modal = document.getElementById('cartAdjustmentModal');
    const valueInput = document.getElementById('cartAdjustmentValue');
    const typeRadios = document.querySelectorAll('input[name="adjustmentType"]');
    if (openDiscountBtn) openDiscountBtn.addEventListener('click', () => openCartAdjustmentModal('discount'));
    if (openExtraBtn) openExtraBtn.addEventListener('click', () => openCartAdjustmentModal('extra'));
    if (closeBtn) closeBtn.addEventListener('click', closeCartAdjustmentModal);
    if (cancelBtn) cancelBtn.addEventListener('click', closeCartAdjustmentModal);
    if (saveBtn) saveBtn.addEventListener('click', saveCartAdjustment);
    if (modal) modal.addEventListener('click', (e) => { if (e.target === modal) closeCartAdjustmentModal(); });
    if (valueInput) valueInput.addEventListener('input', renderQuickAdjustmentButtons);
    typeRadios.forEach((radio) => {
        radio.addEventListener('change', renderQuickAdjustmentButtons);
    });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        initPDV();
        bindConfirmModal();
        bindCartAdjustmentModal();
    });
} else {
    initPDV();
    bindConfirmModal();
    bindCartAdjustmentModal();
}
