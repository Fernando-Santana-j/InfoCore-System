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

function isCashPaymentSelected() {
    return normalizePaymentKey(selectedPaymentMethod) === 'money';
}

function roundMoney2(n) {
    return Math.round(asNumber(n) * 100) / 100;
}

function updateCashChangeDisplay() {
    
    const section = document.getElementById('pdvCashPaymentSection');
    const input = document.getElementById('pdvCashReceivedInput');
    const out = document.getElementById('pdvCashChangeDisplay');
    if (!section || !input || !out || section.style.display === 'none') return;
    const totals = getCurrentTotals();
    const total = totals.total;
    const raw = String(input.value || '').trim();
    if (raw === '') {
        out.textContent = formatCurrency(0);
        out.classList.remove('pdv-cash-change-negative');
        return;
    }
    const received = asNumber(input.value);
    const change = roundMoney2(received - total);
    out.textContent = formatCurrency(Math.max(0, change));
    out.classList.toggle('pdv-cash-change-negative', received < total - 1e-9);
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

function showPaymentPopup(title, details) {
    const modal = document.getElementById('paymentResultModal');
    const titleEl = document.getElementById('paymentResultTitle');
    const messageEl = document.getElementById('paymentResultMessage');
    const listEl = document.getElementById('paymentResultDetails');
    const lines = Array.isArray(details) ? details.filter(Boolean) : [String(details || '').trim()];
    const [first, ...rest] = lines;
    if (titleEl) titleEl.textContent = title || 'Resultado do pagamento';
    if (messageEl) messageEl.textContent = first || '';
    if (listEl) {
        listEl.innerHTML = rest.map((line) => {
            const idx = line.indexOf(':');
            if (idx === -1) return `<div class="pdv-result-item"><span>Detalhe</span><strong>${line}</strong></div>`;
            const label = line.slice(0, idx).trim();
            const value = line.slice(idx + 1).trim();
            return `<div class="pdv-result-item"><span>${label}</span><strong>${value}</strong></div>`;
        }).join('');
    }
    if (modal) modal.classList.add('open');
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
    requestAnimationFrame(() => focusPDVBarcodeInput());
}

function renderPDV(filter) {
    ensureAppDataShape();
    currentPDVFilter = filter || currentPDVFilter;

    const products = asArray(window.appData.products);
    const categories = getCategories();
    const search = (document.getElementById('pdvSearch')?.value || '').toLowerCase().trim();
    const grid = document.getElementById('pdvGrid');
    if (!grid) return;

    let list = products.filter((p) => p.active !== false);
    if (search) {
        list = list.filter((p) => String(p.name || '').toLowerCase().includes(search) || String(p.sku || '').toLowerCase().includes(search));
    }
    if (currentPDVFilter !== 'todos') {
        list = list.filter((p) => String(p.category) === String(currentPDVFilter));
    }

    grid.innerHTML = list.map((p) => {
        const img = p.image
            ? `<div class="prod-thumb"><img src="${String(p.image).replace(/"/g, '&quot;')}" alt=""></div>`
            : `<div class="prod-thumb"><span class="prod-emoji">${p.emoji || '📦'}</span></div>`;
        const minStock = asNumber(p.min_stock || 0);
        const isOutOfStock = asNumber(p.qty) <= 0;
        const shouldShowOutOfStock = isOutOfStock && minStock > 0;
        const outOfStockClass = shouldShowOutOfStock ? ' pdv-product-out-of-stock' : '';
        const stockStatus = shouldShowOutOfStock ? '❌ Sem estoque' : `${asNumber(p.qty)} em estoque`;
        return `
    <div class="pdv-product-card${outOfStockClass}" onclick='addToCart(${JSON.stringify(p.id)})'>
      ${img}
      <div class="prod-name">${p.name || 'Produto'}</div>
      <div class="prod-price">${formatCurrency(asNumber(p.price))}</div>
      <div style="font-size:0.65rem;color:var(--text3);margin-top:2px;">${categories[p.category]?.name || p.category || 'Sem categoria'} • ${stockStatus}</div>
    </div>
  `;
    }).join('') || `<div class="empty-state"><div class="empty-icon">📦</div><p>Nenhum produto</p></div>`;
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

function findProductByProductCode(code) {
    const c = String(code || '').trim();
    if (!c) return null;
    const lower = c.toLowerCase();
    const products = asArray(window.appData.products);
    return products.find((p) => p.active !== false && String(p.sku || '').trim().toLowerCase() === lower) || null;
}

function addToCartByProductCode(code) {
    const product = findProductByProductCode(code);
    if (!product) {
        showToast('Produto não encontrado para este código.', 'error');
        return;
    }
    addToCart(product.id);
}

function focusPDVBarcodeInput() {
    const el = document.getElementById('pdvBarcodeInput');
    if (el) el.focus();
}

function isPDVModalOpen() {
    return Boolean(
        document.getElementById('cartAdjustmentModal')?.classList.contains('open')
        || document.getElementById('confirmActionModal')?.classList.contains('open')
    );
}

function bindPDVBarcodeCapture() {
    const barcodeEl = document.getElementById('pdvBarcodeInput');
    const searchEl = document.getElementById('pdvSearch');

    if (barcodeEl) {
        barcodeEl.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter') return;
            e.preventDefault();
            const raw = barcodeEl.value;
            barcodeEl.value = '';
            const code = String(raw || '').trim();
            if (code) addToCartByProductCode(code);
        });
    }

    if (searchEl) {
        searchEl.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter') return;
            const code = String(searchEl.value || '').trim();
            if (!code || !findProductByProductCode(code)) return;
            e.preventDefault();
            searchEl.value = '';
            filterPDV();
            addToCartByProductCode(code);
        });
    }

    let scanBuf = '';
    let scanLast = 0;
    window.addEventListener(
        'keydown',
        (e) => {
            if (isPDVModalOpen()) return;
            const t = e.target;
            if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) {
                if (t.id === 'pdvBarcodeInput' || t.id === 'pdvSearch') return;
                return;
            }
            const now = Date.now();
            if (now - scanLast > 70) scanBuf = '';
            scanLast = now;
            if (e.key === 'Enter') {
                if (scanBuf.length >= 3) {
                    e.preventDefault();
                    addToCartByProductCode(scanBuf);
                }
                scanBuf = '';
                return;
            }
            if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
                scanBuf += e.key;
            }
        },
        true
    );
}

function addToCart(id) {
    ensureAppDataShape();
    const products = window.appData.products;
    const cart = window.appData.cart;
    const product = products.find((x) => String(x.id) === String(id));
    if (!product) {
        showToast('Produto não encontrado!', 'error');
        return;
    }

    const productQty = asNumber(product.qty);
    const minStock = asNumber(product.min_stock || 0);
    const isOutOfStock = productQty <= 0;

    // Validar permissão de adicionar ao carrinho baseado em min_stock
    if (isOutOfStock && minStock > 0) {
        // Produto sem estoque mas com min_stock > 0: mostrar aviso, mas permitir
        showToast(`⚠️ ${product.name} está sem estoque, mas será adicionado ao carrinho.`, 'warning');
    }

    const existing = cart.find((x) => String(x.id) === String(id));
    if (existing) {
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
    // Mostrar mensagem de sucesso apenas se não for uma situação de out-of-stock com min_stock > 0
    if (!isOutOfStock || (isOutOfStock && minStock === 0)) {
        showToast(`${product.name} adicionado ao carrinho`, 'success');
    }
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
    const paymentUiKey = selectedPaymentMethod;
  
    const cart = asArray(window.appData?.cart);
    const totals = getCurrentTotals();
    const totalItems = cart.reduce((sum, item) => sum + asNumber(item.qty), 0);

    if (totalsEl) {
        totalsEl.innerHTML = `
            <div class="pdv-confirm-row"><span>Subtotal</span><strong>${formatCurrency(totals.subtotal)}</strong></div>
            <div class="pdv-confirm-row"><span>Desconto (${formatAdjustment(getAdjustmentType('discount'), getAdjustmentValue('discount'))})</span><strong>- ${formatCurrency(totals.discount)}</strong></div>
            <div class="pdv-confirm-row"><span>Acréscimo (${formatAdjustment(getAdjustmentType('extra'), getAdjustmentValue('extra'))})</span><strong>+ ${formatCurrency(totals.extra)}</strong></div>
            <div class="pdv-confirm-row"><span>Pagamento</span><strong><span class="pdv-confirm-payment-icon">${getPaymentIcon(paymentUiKey)}</span> ${getPaymentLabel(paymentUiKey)}</strong></div>
            <div class="pdv-confirm-row"><span>Itens</span><strong>${totalItems}</strong></div>
            <div class="pdv-confirm-row total"><span>Total</span><strong>${formatCurrency(totals.total)}</strong></div>
        `;
    }

    const cashSection = document.getElementById('pdvCashPaymentSection');
    const cashInput = document.getElementById('pdvCashReceivedInput');
    if (cashSection && cashInput) {
        if (actionType === 'finalizar' && paymentUiKey === 'money') {
            cashSection.style.display = 'flex';
            cashInput.value = '';
            requestAnimationFrame(() => {
                cashInput.focus();
                cashInput.select();
            });
        } else {
            cashSection.style.display = 'none';
            cashInput.value = '';
        }
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

async function executeConfirmedAction() {
    if (confirmActionType === 'finalizar') {
        const ok = await finalizeSaleCore();
        if (!ok) return;
    }
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
          <button class="qty-btn" onclick='changeQty(${JSON.stringify(item.id)},-1)'>−</button>
          <span class="qty-num">${asNumber(item.qty)}</span>
          <button class="qty-btn" onclick='changeQty(${JSON.stringify(item.id)},1)'>+</button>
        </div>
        <div class="cart-item-price">${formatCurrency(asNumber(item.price) * asNumber(item.qty))}</div>
        <div class="cart-item-remove" onclick='removeFromCart(${JSON.stringify(item.id)})'>✕</div>
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
    const item = cart.find((x) => String(x.id) === String(id));
    if (!item) return;

    const product = products.find((x) => String(x.id) === String(id));
    const productQty = asNumber(product?.qty || 0);
    const minStock = asNumber(product?.min_stock || 0);
    const next = asNumber(item.qty) + delta;
    
    if (next <= 0) return removeFromCart(id);
    
    // Determinar quantidade máxima permitida no carrinho
    let maxQty = productQty > 0 ? productQty : 0;
    
    // Se produto está sem estoque mas tem min_stock
    if (productQty <= 0 && minStock > 0) {
        // Permitir adicionar até 10 unidades quando sem estoque mas com min_stock
        maxQty = 10;
    } else if (productQty <= 0 && minStock === 0) {
        // Se min_stock = 0, permitir quantidade bem alta
        maxQty = 999;
    }
    
    if (next > maxQty) {
        showToast('Estoque insuficiente!', 'error');
        return;
    }
    item.qty = next;
    renderCart();
}

function removeFromCart(id) {
    const cart = asArray(window.appData?.cart);
    const idx = cart.findIndex((x) => String(x.id) === String(id));
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

let finalizeSaleInFlight = false;
let paymentPendingPollTimer = null;
let currentPendingToken = null;

function getPaymentStatusText(status, paymentKey) {
    const key = String(status || '').toLowerCase();
    if (paymentKey === 'pix') {
        const pixMap = {
            pending: 'Aguardando pagamento PIX',
            in_process: 'Pagamento em processamento',
            approved: 'Pagamento aprovado',
            rejected: 'Pagamento recusado',
            cancelled: 'Pagamento cancelado'
        };
        return pixMap[key] || 'Aguardando confirmação do PIX';
    }
    const map = {
        created: 'Cobranca criada',
        at_terminal: 'Pedido enviado para a maquininha',
        in_process: 'Cliente realizando pagamento',
        processed: 'Pagamento aprovado',
        canceled: 'Pagamento cancelado',
        expired: 'Pagamento expirado',
        failed: 'Falha no pagamento'
    };
    return map[key] || 'Aguardando ação do cliente';
}

function setPaymentWaitingStatus(statusText) {
    const chip = document.getElementById('paymentWaitingStatusChip');
    if (chip) chip.textContent = statusText || 'Aguardando confirmação';
}

function openPaymentWaitingModal(paymentKey) {
    const modal = document.getElementById('paymentWaitingModal');
    const title = document.getElementById('paymentWaitingTitle');
    const message = document.getElementById('paymentWaitingMessage');
    const qrWrap = document.getElementById('paymentWaitingQrWrap');
    const qrTextWrap = document.getElementById('paymentWaitingQrTextWrap');
    const qrLoader = document.getElementById('paymentWaitingQrLoader');
    const qrImage = document.getElementById('paymentWaitingQrImage');
    const hint = document.getElementById('paymentWaitingHint');
    const isPix = normalizePaymentKey(paymentKey) === 'pix';
    if (title) title.textContent = 'Aguardando pagamento';
    if (message) {
        message.textContent = isPix
            ? 'Peça para o cliente pagar o PIX na maquininha ou escaneando o QR abaixo.'
            : 'Peça para o cliente inserir/aproximar o cartão e seguir as instruções na maquininha.';
    }
    if (hint) hint.textContent = 'A venda só será concluída após aprovação na maquininha.';
    setPaymentWaitingStatus('Iniciando cobrança...');
    if (qrWrap) qrWrap.style.display = isPix ? 'flex' : 'none';
    if (qrTextWrap) qrTextWrap.style.display = isPix ? 'block' : 'none';
    if (qrLoader) qrLoader.style.display = isPix ? 'flex' : 'none';
    if (qrImage) qrImage.style.display = 'none';
    if (modal) modal.classList.add('open');
}

function closePaymentWaitingModal() {
    const modal = document.getElementById('paymentWaitingModal');
    const qrImage = document.getElementById('paymentWaitingQrImage');
    const qrText = document.getElementById('paymentWaitingQrText');
    const qrLoader = document.getElementById('paymentWaitingQrLoader');
    if (modal) modal.classList.remove('open');
    if (qrImage) qrImage.removeAttribute('src');
    if (qrText) qrText.value = '';
    if (qrLoader) qrLoader.style.display = 'none';
}

function applyPaymentWaitingData(payment) {
    const qrImage = document.getElementById('paymentWaitingQrImage');
    const qrText = document.getElementById('paymentWaitingQrText');
    const qrLoader = document.getElementById('paymentWaitingQrLoader');
    const qrWrap = document.getElementById('paymentWaitingQrWrap');
    const hasQr = Boolean(payment?.qrBase64);
    if (qrWrap && qrWrap.style.display !== 'none') {
        if (qrLoader) qrLoader.style.display = hasQr ? 'none' : 'flex';
    }
    if (qrImage) {
        if (hasQr) {
            qrImage.src = `data:image/png;base64,${payment.qrBase64}`;
            qrImage.style.display = 'block';
        } else if (payment?.qrData) {
            qrImage.removeAttribute('src');
            qrImage.style.display = 'none';
        } else {
            qrImage.removeAttribute('src');
            qrImage.style.display = 'none';
        }
    }
    if (qrText) qrText.value = payment?.qrData || '';
    setPaymentWaitingStatus(getPaymentStatusText(payment?.status, normalizePaymentKey(selectedPaymentMethod)));
}

function stopPendingPoll() {
    if (paymentPendingPollTimer) {
        clearTimeout(paymentPendingPollTimer);
        paymentPendingPollTimer = null;
    }
}

function applySuccessfulSale(data, totals, payment) {
    const sale = data.sale;
    if (Array.isArray(data.products)) {
        data.products.forEach((p) => {
            const idx = window.appData.products.findIndex((x) => String(x.id) === String(p.id));
            if (idx !== -1) window.appData.products[idx] = p;
        });
    }

    window.appData.sales = asArray(window.appData.sales);
    window.appData.sales.unshift(sale);

    window.appData.cart = [];
    setAdjustment('discount', 'fixed', 0);
    setAdjustment('extra', 'fixed', 0);
    renderCart();
    renderPDV(currentPDVFilter);
    focusPDVBarcodeInput();

    const label = sale?.code || sale?.id || 'Venda';
    const totalVal = sale?.total != null ? asNumber(sale.total) : totals.total;
    let toastMsg = `${label} finalizada! ${formatCurrency(totalVal)}`;
    if (payment === 'money' && sale?.change != null && asNumber(sale.change) > 0) {
        toastMsg += ` · Troco: ${formatCurrency(asNumber(sale.change))}`;
    }
    showToast(toastMsg, 'success');
    if (payment !== 'money') {
        const paymentInfo = data?.payment || sale?.payment || {};
        showPaymentPopup('Compra paga com sucesso', [
            `Meio: ${getPaymentLabel(selectedPaymentMethod)}`,
            `Status: ${paymentInfo.status || 'processed'}`,
            `Pedido: ${paymentInfo.orderId || 'não informado'}`
        ]);
    }
}

async function pollPendingSaleStatus(token, totals, payment) {
    stopPendingPoll();
    currentPendingToken = token;
    const check = async () => {
        try {
            const res = await fetch(`/api/sales/pending/${encodeURIComponent(token)}`, {
                method: 'GET',
                credentials: 'same-origin'
            });
            let data = {};
            try { data = await res.json(); } catch { data = {}; }

            if (!res.ok || data.error) {
                stopPendingPoll();
                currentPendingToken = null;
                closePaymentWaitingModal();
                const paymentInfo = data?.payment || {};
                showPaymentPopup('Pagamento não aprovado', [
                    `Meio: ${getPaymentLabel(selectedPaymentMethod)}`,
                    `Status: ${paymentInfo.status || 'não informado'}`,
                    `Motivo: ${paymentInfo.reason || data.message || 'Não informado'}`
                ]);
                showToast(data.message || 'Pagamento não aprovado.', 'error');
                finalizeSaleInFlight = false;
                return;
            }

            if (data.pending) {
                applyPaymentWaitingData(data.payment || {});
                setPaymentWaitingStatus(getPaymentStatusText(data?.payment?.status, payment));
                paymentPendingPollTimer = setTimeout(check, 2000);
                return;
            }

            stopPendingPoll();
            currentPendingToken = null;
            closePaymentWaitingModal();
            applySuccessfulSale(data, totals, payment);
            finalizeSaleInFlight = false;
        } catch (e) {
            console.error(e);
            stopPendingPoll();
            currentPendingToken = null;
            closePaymentWaitingModal();
            showToast('Erro ao consultar status do pagamento.', 'error');
            finalizeSaleInFlight = false;
        }
    };
    await check();
}

async function finalizeSaleCore() {
    ensureAppDataShape();
    const cart = asArray(window.appData.cart);
    if (cart.length === 0) {
        showToast('Carrinho vazio!', 'error');
        return false;
    }
    if (finalizeSaleInFlight) return false;

    const totals = getCurrentTotals();
    const payment = normalizePaymentKey(selectedPaymentMethod);
    const payload = {
        items: cart.map((i) => ({ id: i.id, qty: asNumber(i.qty) })),
        discount: { ...cartAdjustments.discount },
        extra: { ...cartAdjustments.extra },
        payment,
        client: 'Balcão'
    };

    if (payment === 'money') {
        const cashInput = document.getElementById('pdvCashReceivedInput');
        const raw = String(cashInput?.value || '').trim();
        if (raw === '') {
            payload.cashReceived = roundMoney2(totals.total);
            payload.change = 0;
        } else {
            const received = asNumber(cashInput?.value);
            if (!Number.isFinite(received) || received <= 0) {
                showToast('Valor recebido inválido. Deixe em branco se o cliente pagou o valor exato.', 'error');
                return false;
            }
            if (received + 1e-9 < totals.total) {
                showToast('O valor recebido é menor que o total da venda.', 'error');
                return false;
            }
            payload.cashReceived = roundMoney2(received);
            payload.change = roundMoney2(received - totals.total);
        }
    }

    const isCardOrPix = payment !== 'money';
    if (isCardOrPix) {
        closeConfirmActionModal();
        openPaymentWaitingModal(payment);
        setPaymentWaitingStatus('Criando cobrança...');
    }

    finalizeSaleInFlight = true;
    const confirmBtn = document.getElementById('confirmActionBtn');
    const prevBtnText = confirmBtn ? confirmBtn.textContent : '';
    if (confirmBtn && !isCardOrPix) {
        confirmBtn.disabled = true;
        confirmBtn.textContent = 'Salvando...';
    }

    try {
        const res = await fetch('/api/sales', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify(payload)
        });
        let data = {};
        try {
            data = await res.json();
        } catch {
            data = {};
        }
        if (!res.ok || data.error) {
            if (payment !== 'money') {
                closePaymentWaitingModal();
                const paymentInfo = data?.payment || {};
                showPaymentPopup('Pagamento não aprovado', [
                    `Meio: ${getPaymentLabel(selectedPaymentMethod)}`,
                    `Status: ${paymentInfo.status || 'não informado'}`,
                    `Motivo: ${paymentInfo.reason || data.message || 'Não informado'}`
                ]);
            }
            showToast(data.message || 'Não foi possível salvar a venda.', 'error');
            return false;
        }

        if (payment !== 'money' && data.pending && data.token) {
            applyPaymentWaitingData(data.payment || {});
            setPaymentWaitingStatus(getPaymentStatusText(data?.payment?.status, payment));
            await pollPendingSaleStatus(data.token, totals, payment);
            return true;
        }

        applySuccessfulSale(data, totals, payment);
        return true;
    } catch (e) {
        console.error(e);
        if (payment !== 'money') closePaymentWaitingModal();
        showToast('Erro de rede ao finalizar a venda.', 'error');
        return false;
    } finally {
        if (payment === 'money') finalizeSaleInFlight = false;
        if (confirmBtn) {
            confirmBtn.disabled = false;
            confirmBtn.textContent = prevBtnText || 'Confirmar';
        }
    }
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

function bindPaymentWaitingModal() {
    const cancelBtn = document.getElementById('cancelPaymentWaitingBtn');
    const closeBtn = document.getElementById('closePaymentWaitingModalBtn');
    const modal = document.getElementById('paymentWaitingModal');
    const cancelFn = async () => {
        const token = currentPendingToken;
        stopPendingPoll();
        currentPendingToken = null;
        if (token) {
            try {
                await fetch(`/api/sales/pending/${encodeURIComponent(token)}`, {
                    method: 'DELETE',
                    credentials: 'same-origin'
                });
            } catch (e) {
                console.error(e);
            }
        }
        finalizeSaleInFlight = false;
        closePaymentWaitingModal();
        showToast('Pagamento pendente cancelado.', 'info');
    };
    if (cancelBtn) cancelBtn.addEventListener('click', cancelFn);
    if (closeBtn) closeBtn.addEventListener('click', cancelFn);
    if (modal) modal.addEventListener('click', (e) => { if (e.target === modal) cancelFn(); });

    const copyBtn = document.getElementById('copyPixCodeBtn');
    if (copyBtn) {
        copyBtn.addEventListener('click', async () => {
            const qrText = document.getElementById('paymentWaitingQrText');
            const value = String(qrText?.value || '').trim();
            if (!value) {
                showToast('Código PIX ainda não disponível.', 'info');
                return;
            }
            try {
                await navigator.clipboard.writeText(value);
                showToast('Código PIX copiado!', 'success');
            } catch (e) {
                console.error(e);
                showToast('Não foi possível copiar automaticamente.', 'error');
            }
        });
    }
}

function bindPaymentResultModal() {
    const modal = document.getElementById('paymentResultModal');
    const closeBtn = document.getElementById('closePaymentResultModalBtn');
    const okBtn = document.getElementById('paymentResultOkBtn');
    const close = () => {
        if (modal) modal.classList.remove('open');
    };
    if (closeBtn) closeBtn.addEventListener('click', close);
    if (okBtn) okBtn.addEventListener('click', close);
    if (modal) modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
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
        bindPaymentWaitingModal();
        bindPaymentResultModal();
        bindCartAdjustmentModal();
        bindPDVBarcodeCapture();
        const cashInput = document.getElementById('pdvCashReceivedInput');
        if (cashInput) cashInput.addEventListener('input', updateCashChangeDisplay);
    });
} else {
    initPDV();
    bindConfirmModal();
    bindPaymentWaitingModal();
    bindPaymentResultModal();
    bindCartAdjustmentModal();
    bindPDVBarcodeCapture();
    const cashInput = document.getElementById('pdvCashReceivedInput');
    if (cashInput) cashInput.addEventListener('input', updateCashChangeDisplay);
}
