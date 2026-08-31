let currentPDVFilter = 'todos';
let confirmActionType = null;
let selectedPaymentMethod = 'money';
let cartAdjustments = {
    discount: { type: 'fixed', value: 0 },
    extra: { type: 'fixed', value: 0 }
};
let currentAdjustmentTarget = 'discount';
let budgetItemsDraft = [];
let budgetCurrentRecord = null;
let confirmAllowInsufficientStock = false;
let selectedCreditInstallments = 1;
const CREDIT_INSTALLMENT_MAX = 12;

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

function isServiceProduct(p) {
    return String(p?.itemType || '').toLowerCase() === 'service';
}

function getServiceProductDetails(p) {
    return {
        duration: String(p?.serviceDuration || '').trim(),
        description: String(p?.description || '').trim()
    };
}

function renderPdvServiceExtra(p) {
    if (!isServiceProduct(p)) return '';
    const { duration, description } = getServiceProductDetails(p);
    if (!duration && !description) return '';
    const durationHtml = duration
        ? `<span class="pdv-service-duration">⏱ ${escapeHtml(duration)}</span>`
        : '';
    const descHtml = description
        ? `<span class="pdv-service-desc">${escapeHtml(description)}</span>`
        : '';
    return `<div class="pdv-service-foot">${durationHtml}${descHtml}</div>`;
}

function renderCartServiceHint(product) {
    if (!product || !isServiceProduct(product)) return '';
    const { duration, description } = getServiceProductDetails(product);
    if (!duration && !description) return '';
    const title = [duration, description].filter(Boolean).join(' · ');
    const bits = [];
    if (duration) bits.push(`<span class="cart-item-service-duration">⏱ ${escapeHtml(duration)}</span>`);
    if (description) {
        const short = description.length > 48 ? `${description.slice(0, 48).trim()}…` : description;
        bits.push(`<span class="cart-item-service-desc">${escapeHtml(short)}</span>`);
    }
    return `<div class="cart-item-service-hint" title="${escapeAttr(title)}">${bits.join('')}</div>`;
}

function productTracksStock(p) {
    if (isServiceProduct(p)) return false;
    return p.trackStock !== false;
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
    if (!Array.isArray(window.appData.cashFlowEntries)) window.appData.cashFlowEntries = [];
    window.appData.cart = asArray(window.appData.cart);
    window.appData.budgets = asArray(window.appData.budgets);
}

function escapeHtml(str) {
    return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function escapeAttr(str) {
    return escapeHtml(str).replace(/`/g, '&#96;');
}

function budgetTotals(items = budgetItemsDraft) {
    const subtotal = items.reduce((sum, item) => sum + (asNumber(item.qty) * asNumber(item.unitPrice)), 0);
    const discount = asNumber(document.getElementById('budgetDiscountInput')?.value);
    const extra = asNumber(document.getElementById('budgetExtraInput')?.value);
    const total = Math.max(0, subtotal - discount + extra);
    return { subtotal, discount, extra, total };
}

function renderBudgetProductsSelect() {
    const select = document.getElementById('budgetProductSelect');
    if (!select) return;
    const products = asArray(window.appData.products).filter((p) => p.active !== false);
    select.innerHTML = `<option value="">Selecione um produto...</option>${products.map((p) => `<option value="${escapeHtml(String(p.id))}">${escapeHtml(p.name)} - ${formatCurrency(asNumber(p.price))}</option>`).join('')}`;
}

function renderBudgetDraftItems() {
    const box = document.getElementById('budgetItemsList');
    const totalsEl = document.getElementById('budgetTotalsBox');
    if (!box || !totalsEl) return;
    if (budgetItemsDraft.length === 0) {
        box.innerHTML = '<div class="text-xs text-muted">Nenhum item adicionado ao orçamento.</div>';
    } else {
        box.innerHTML = budgetItemsDraft.map((item, index) => `
            <div class="pdv-budget-item-row">
                <input class="form-input" value="${escapeHtml(item.name)}" onchange="updateBudgetItem(${index}, 'name', this.value)">
                <input class="form-input" type="number" min="1" step="1" value="${asNumber(item.qty)}" onchange="updateBudgetItem(${index}, 'qty', this.value)">
                <input class="form-input" type="number" min="0" step="0.01" value="${asNumber(item.unitPrice)}" onchange="updateBudgetItem(${index}, 'unitPrice', this.value)">
                <button class="btn btn-ghost btn-sm" type="button" onclick="removeBudgetItem(${index})">✕</button>
            </div>
        `).join('');
    }
    const totals = budgetTotals();
    totalsEl.innerHTML = `
        <div class="cart-total-row"><span>Subtotal</span><span class="mono">${formatCurrency(totals.subtotal)}</span></div>
        <div class="cart-total-row"><span>Desconto</span><span class="mono">- ${formatCurrency(totals.discount)}</span></div>
        <div class="cart-total-row"><span>Acréscimo</span><span class="mono">+ ${formatCurrency(totals.extra)}</span></div>
        <div class="divider"></div>
        <div class="cart-total-row grand"><span>Total</span><span class="val">${formatCurrency(totals.total)}</span></div>
    `;
}

function renderSavedBudgets() {
    const list = document.getElementById('savedBudgetsList');
    if (!list) return;
    const budgets = asArray(window.appData.budgets);
    if (budgets.length === 0) {
        list.innerHTML = '<div class="text-xs text-muted">Nenhum orçamento salvo.</div>';
        return;
    }
    list.innerHTML = budgets.slice().sort((a, b) => String(b.code || '').localeCompare(String(a.code || ''))).map((budget) => `
        <div class="pdv-budget-saved-card">
            <div>
                <div><strong>${escapeHtml(budget.code || 'Orçamento')}</strong> ${budget.status && budget.status !== 'draft' ? '✅' : '📝'}</div>
                <div class="text-xs text-muted">${escapeHtml(budget.customerName || 'Cliente não informado')} · ${formatCurrency(asNumber(budget.total))}</div>
            </div>
            <div class="flex gap-8">
                <button class="btn btn-ghost btn-sm" type="button" onclick="openBudgetTemplateById('${escapeHtml(String(budget.id || ''))}')">Template</button>
                ${budget.status && budget.status !== 'draft' ? '' : `<button class="btn btn-primary btn-sm" type="button" onclick="finalizeBudgetById('${escapeHtml(String(budget.id || ''))}')">Enviar</button>`}
            </div>
        </div>
    `).join('');
}

function updateBudgetItem(index, key, value) {
    const item = budgetItemsDraft[index];
    if (!item) return;
    if (key === 'qty' || key === 'unitPrice') item[key] = Math.max(0, asNumber(value));
    else item[key] = String(value || '').trim();
    renderBudgetDraftItems();
}

function removeBudgetItem(index) {
    budgetItemsDraft.splice(index, 1);
    renderBudgetDraftItems();
}

function addCustomBudgetItem() {
    budgetItemsDraft.push({ kind: 'custom', productId: '', sku: '', name: 'Serviço personalizado', qty: 1, unitPrice: 0 });
    renderBudgetDraftItems();
}

function addProductBudgetItem() {
    const select = document.getElementById('budgetProductSelect');
    const productId = String(select?.value || '').trim();
    if (!productId) {
        showToast('Selecione um produto para adicionar.', 'info');
        return;
    }
    const p = asArray(window.appData.products).find((row) => String(row.id) === productId);
    if (!p) return;
    budgetItemsDraft.push({ kind: 'product', productId: String(p.id), sku: String(p.sku || ''), name: String(p.name || 'Produto'), qty: 1, unitPrice: asNumber(p.price) });
    renderBudgetDraftItems();
}

function buildBudgetPayload(status) {
    const customerName = String(document.getElementById('budgetCustomerName')?.value || '').trim();
    const customerPhone = String(document.getElementById('budgetCustomerPhone')?.value || '').trim();
    const customerEmail = String(document.getElementById('budgetCustomerEmail')?.value || '').trim();
    const validUntil = String(document.getElementById('budgetValidUntil')?.value || '').trim();
    const notes = String(document.getElementById('budgetNotes')?.value || '').trim();
    const totals = budgetTotals();
    const items = budgetItemsDraft
        .filter((item) => String(item.name || '').trim() && asNumber(item.qty) > 0)
        .map((item) => ({
            kind: item.kind === 'product' ? 'product' : 'custom',
            productId: String(item.productId || ''),
            sku: String(item.sku || ''),
            name: String(item.name || '').trim(),
            qty: asNumber(item.qty),
            unitPrice: asNumber(item.unitPrice)
        }));
    return {
        customerName,
        customerPhone,
        customerEmail,
        validUntil,
        notes,
        items,
        discount: totals.discount,
        extra: totals.extra,
        status: status === 'finalized' ? 'sent' : 'draft'
    };
}

function openBudgetTemplateModal(budget) {
    budgetCurrentRecord = budget;
    const preview = document.getElementById('budgetTemplatePreview');
    const modal = document.getElementById('budgetTemplateModal');
    if (modal) modal.classList.add('open');
    loadBudgetTemplatePreview(budget, preview);
}

function closeBudgetTemplateModal() {
    const modal = document.getElementById('budgetTemplateModal');
    if (modal) modal.classList.remove('open');
}

async function saveBudget(status) {
    const payload = buildBudgetPayload(status);
    if (payload.items.length === 0) {
        showToast('Adicione ao menos um item ao orçamento.', 'error');
        return;
    }
    try {
        const res = await fetch('/api/budgets', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (!res.ok || data.error) {
            showToast(data.message || 'Não foi possível salvar o orçamento.', 'error');
            return;
        }
        window.appData.budgets = asArray(window.appData.budgets);
        window.appData.budgets.unshift(data.budget);
        renderSavedBudgets();
        showToast(status === 'finalized' ? 'Orçamento enviado!' : 'Orçamento salvo!', 'success');
        openBudgetTemplateModal(data.budget);
    } catch (e) {
        console.error(e);
        showToast('Erro ao salvar orçamento.', 'error');
    }
}

async function finalizeBudgetById(id) {
    try {
        const res = await fetch(`/api/budgets/${encodeURIComponent(id)}/finalize`, {
            method: 'PATCH',
            credentials: 'same-origin'
        });
        const data = await res.json();
        if (!res.ok || data.error) {
            showToast(data.message || 'Erro ao enviar orçamento.', 'error');
            return;
        }
        window.appData.budgets = asArray(window.appData.budgets).map((item) => String(item.id) === String(data.budget.id) ? data.budget : item);
        renderSavedBudgets();
        showToast('Orçamento finalizado.', 'success');
        openBudgetTemplateModal(data.budget);
    } catch (e) {
        console.error(e);
        showToast('Erro ao finalizar orçamento.', 'error');
    }
}

function openBudgetTemplateById(id) {
    const budget = asArray(window.appData.budgets).find((item) => String(item.id) === String(id));
    if (!budget) return;
    openBudgetTemplateModal(budget);
}

function openBudgetModal() {
    const modal = document.getElementById('budgetModal');
    budgetItemsDraft = [];
    renderBudgetProductsSelect();
    renderBudgetDraftItems();
    renderSavedBudgets();
    if (modal) modal.classList.add('open');
}

function closeBudgetModal() {
    const modal = document.getElementById('budgetModal');
    if (modal) modal.classList.remove('open');
}

function generateBudgetPdf() {
    if (!budgetCurrentRecord) return;
    printBudgetTemplatePdf(budgetCurrentRecord);
}

function downloadBudgetImage() {
    if (!budgetCurrentRecord) return;
    downloadBudgetTemplateImage(budgetCurrentRecord);
}


function bindBudgetModal() {
    const openBtn = document.getElementById('btnOpenBudgetModal');
    const closeBtn = document.getElementById('closeBudgetModalBtn');
    const cancelBtn = document.getElementById('cancelBudgetBtn');
    const addProductBtn = document.getElementById('budgetAddProductBtn');
    const addCustomBtn = document.getElementById('budgetAddCustomBtn');
    const saveBtn = document.getElementById('saveBudgetBtn');
    const finalizeBtn = document.getElementById('finalizeBudgetBtn');
    const modal = document.getElementById('budgetModal');
    const discountInput = document.getElementById('budgetDiscountInput');
    const extraInput = document.getElementById('budgetExtraInput');

    if (openBtn) openBtn.addEventListener('click', openBudgetModal);
    if (closeBtn) closeBtn.addEventListener('click', closeBudgetModal);
    if (cancelBtn) cancelBtn.addEventListener('click', closeBudgetModal);
    if (addProductBtn) addProductBtn.addEventListener('click', addProductBudgetItem);
    if (addCustomBtn) addCustomBtn.addEventListener('click', addCustomBudgetItem);
    if (saveBtn) saveBtn.addEventListener('click', () => saveBudget('draft'));
    if (finalizeBtn) finalizeBtn.addEventListener('click', () => saveBudget('finalized'));
    if (discountInput) discountInput.addEventListener('input', renderBudgetDraftItems);
    if (extraInput) extraInput.addEventListener('input', renderBudgetDraftItems);
    if (modal) modal.addEventListener('click', (e) => { if (e.target === modal) closeBudgetModal(); });
}

async function copyTextToClipboard(value, successMsg) {
    try {
        await navigator.clipboard.writeText(value);
        showToast(successMsg, 'success');
    } catch (e) {
        console.error(e);
        showToast('Não foi possível copiar automaticamente.', 'error');
    }
}

function bindBudgetTemplateModal() {
    const closeBtn = document.getElementById('closeBudgetTemplateModalBtn');
    const doneBtn = document.getElementById('budgetTemplateDoneBtn');
    const modal = document.getElementById('budgetTemplateModal');
    const copyWhatsappBtn = document.getElementById('budgetCopyWhatsappBtn');
    const copyEmailBtn = document.getElementById('budgetCopyEmailBtn');
    const downloadImageBtn = document.getElementById('budgetDownloadImageBtn');
    const generatePdfBtn = document.getElementById('budgetGeneratePdfBtn');

    if (closeBtn) closeBtn.addEventListener('click', closeBudgetTemplateModal);
    if (doneBtn) doneBtn.addEventListener('click', closeBudgetTemplateModal);
    if (modal) modal.addEventListener('click', (e) => { if (e.target === modal) closeBudgetTemplateModal(); });
    if (copyWhatsappBtn) copyWhatsappBtn.addEventListener('click', async () => {
        if (!budgetCurrentRecord) return;
        try {
            await copyBudgetTemplateText('whatsapp', budgetCurrentRecord);
            showToast('Template de WhatsApp copiado.', 'success');
        } catch (e) {
            console.error(e);
            showToast('Não foi possível copiar o template.', 'error');
        }
    });
    if (copyEmailBtn) copyEmailBtn.addEventListener('click', async () => {
        if (!budgetCurrentRecord) return;
        try {
            await copyBudgetTemplateText('email', budgetCurrentRecord);
            showToast('Template HTML de email copiado.', 'success');
        } catch (e) {
            console.error(e);
            showToast('Não foi possível copiar o template.', 'error');
        }
    });
    if (downloadImageBtn) downloadImageBtn.addEventListener('click', downloadBudgetImage);
    if (generatePdfBtn) generatePdfBtn.addEventListener('click', generateBudgetPdf);
}

function renderPDVFilters() {
    const container = document.querySelector('#page-pdv .filter-bar');
    if (!container) return;
    const categories = getCategories();
    const buttons = [
        `<button class="filter-btn ${currentPDVFilter === 'todos' ? 'active' : ''}" onclick="setPDVFilter('todos',this)">Todos</button>`,
        `<button class="filter-btn ${currentPDVFilter === 'servicos' ? 'active' : ''}" onclick="setPDVFilter('servicos',this)">🔧 Serviços</button>`
    ];
    Object.keys(categories).forEach((key) => {
        const isActive = currentPDVFilter === key ? 'active' : '';
        const label = categories[key]?.name || key;
        buttons.push(`<button class="filter-btn ${isActive}" onclick="setPDVFilter('${key}',this)">${label}</button>`);
    });
    container.innerHTML = buttons.join('');
}

function getCreditInstallmentOptions() {
    const cfg = window.appData?.configs?.pdv;
    const fromCfg = cfg?.credit_installment_options;
    if (Array.isArray(fromCfg) && fromCfg.length) {
        return [...new Set(fromCfg.map((n) => parseInt(n, 10)).filter((n) => Number.isFinite(n) && n >= 1 && n <= 24))].sort((a, b) => a - b);
    }
    return Array.from({ length: CREDIT_INSTALLMENT_MAX }, (_, i) => i + 1);
}

function renderCreditInstallmentPicker() {
    const grid = document.getElementById('creditInstallmentsButtons');
    if (!grid) return;
    const opts = getCreditInstallmentOptions();
    if (!opts.includes(selectedCreditInstallments)) selectedCreditInstallments = opts[0] || 1;
    grid.innerHTML = opts.map((n) => {
        const active = n === selectedCreditInstallments ? ' is-active' : '';
        return `<button type="button" class="pdv-installment-btn${active}" data-installments="${n}">${n}x</button>`;
    }).join('');
    grid.querySelectorAll('.pdv-installment-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
            selectedCreditInstallments = parseInt(btn.dataset.installments, 10) || 1;
            renderCreditInstallmentPicker();
            if (document.getElementById('confirmActionModal')?.classList.contains('open') && confirmActionType === 'finalizar') {
                openConfirmActionModal('finalizar');
            }
        });
    });
}

function syncConfirmPaymentExtras(actionType, paymentUiKey) {
    const payment = normalizePaymentKey(paymentUiKey);
    const cashSection = document.getElementById('pdvCashPaymentSection');
    const installmentsSection = document.getElementById('pdvCreditInstallmentsSection');
    const cashInput = document.getElementById('pdvCashReceivedInput');

    if (installmentsSection) {
        const showInstallments = actionType === 'finalizar' && payment === 'credit_card';
        installmentsSection.hidden = !showInstallments;
        if (showInstallments) renderCreditInstallmentPicker();
    }

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
    if (normalizePaymentKey(key) !== 'credit_card') selectedCreditInstallments = 1;
    renderPaymentButtons();
}

function openCustomItemModal() {
    const modal = document.getElementById('customItemModal');
    if (!modal) return;
    const nameEl = document.getElementById('customItemName');
    const priceEl = document.getElementById('customItemPrice');
    const qtyEl = document.getElementById('customItemQty');
    if (nameEl) nameEl.value = '';
    if (priceEl) priceEl.value = '';
    if (qtyEl) qtyEl.value = '1';
    modal.classList.add('open');
    document.body.style.overflow = 'hidden';
    requestAnimationFrame(() => nameEl?.focus());
}

function closeCustomItemModal() {
    const modal = document.getElementById('customItemModal');
    if (modal) modal.classList.remove('open');
    if (!document.querySelector('.pdv-modal-overlay.open')) {
        document.body.style.overflow = '';
    }
}

function saveCustomItemFromModal() {
    const name = document.getElementById('customItemName')?.value;
    const price = document.getElementById('customItemPrice')?.value;
    const qty = document.getElementById('customItemQty')?.value;
    if (!addCustomItemToCart(name, price, qty)) return;
    closeCustomItemModal();
}

function bindCustomItemModal() {
    const openBtn = document.getElementById('btnOpenCustomItemModal');
    const closeBtn = document.getElementById('closeCustomItemModalBtn');
    const cancelBtn = document.getElementById('cancelCustomItemBtn');
    const saveBtn = document.getElementById('saveCustomItemBtn');
    const modal = document.getElementById('customItemModal');
    const quickWrap = document.getElementById('customItemQuickPrices');

    closeBtn?.addEventListener('click', closeCustomItemModal);
    cancelBtn?.addEventListener('click', closeCustomItemModal);
    saveBtn?.addEventListener('click', saveCustomItemFromModal);
    modal?.addEventListener('click', (e) => {
        if (e.target === modal) closeCustomItemModal();
    });

    quickWrap?.querySelectorAll('[data-price]').forEach((btn) => {
        btn.addEventListener('click', () => {
            const priceEl = document.getElementById('customItemPrice');
            if (priceEl) priceEl.value = String(btn.getAttribute('data-price') || '');
        });
    });

    document.getElementById('customItemName')?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            document.getElementById('customItemPrice')?.focus();
        }
    });
    document.getElementById('customItemPrice')?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            saveCustomItemFromModal();
        }
    });
}

function bindPDVKeyboardShortcuts() {
    if (window.__pdvShortcutsBound) return;
    window.__pdvShortcutsBound = true;

    document.addEventListener('keydown', (e) => {
        if (!isOnPDVPage() || isPDVModalOpen()) return;
        if (e.ctrlKey && (e.key === 'i' || e.key === 'I')) {
            e.preventDefault();
            openCustomItemModal();
            return;
        }
        if (e.key === 'F10') {
            e.preventDefault();
            finalizarVenda();
            return;
        }
        if (e.key === 'F4') {
            e.preventDefault();
            document.getElementById('pdvSearch')?.focus();
        }
    });
}

function initPDV() {
    ensureAppDataShape();
    updateTopbarTitle('PDV');
    markNavActive('/pdv');
    renderPDVFilters();
    renderPaymentButtons();
    renderPDV();
    renderCart();
    requestAnimationFrame(() => document.getElementById('pdvSearch')?.focus());
}

function renderPdvPinnedCards() {
  const isAdmin = window.appData?.user?.type === 'admin';
  const catalogCard = isAdmin
    ? `
    <div class="pdv-product-card pdv-product-card--pinned pdv-product-card--catalog" role="button" tabindex="0" onclick="window.location.href='/stock'">
      <div class="prod-thumb"><span class="prod-emoji">📋</span></div>
      <div class="prod-name">Catálogo</div>
      <div class="prod-price text-muted" style="font-size:0.85rem">Cadastrar / editar</div>
      <div class="pdv-pinned-hint">Produtos e serviços</div>
    </div>`
    : '';
  return `
    <div class="pdv-product-card pdv-product-card--pinned pdv-product-card--custom" role="button" tabindex="0" onclick="openCustomItemModal()" title="Atalho: Ctrl+I">
      <div class="prod-thumb"><span class="prod-emoji">✨</span></div>
      <div class="prod-name">Item personalizado</div>
      <div class="prod-price text-muted" style="font-size:0.85rem">Avulso</div>
      <div class="pdv-pinned-hint">Toque · Ctrl+I</div>
    </div>
    ${catalogCard}
  `;
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
        list = list.filter((p) => {
            const name = String(p.name || '').toLowerCase();
            const sku = String(p.sku || '').toLowerCase();
            const desc = String(p.description || '').toLowerCase();
            return name.includes(search) || sku.includes(search) || desc.includes(search);
        });
    }
    if (currentPDVFilter === 'servicos') {
        list = list.filter((p) => isServiceProduct(p));
    } else if (currentPDVFilter !== 'todos') {
        list = list.filter((p) => String(p.category) === String(currentPDVFilter));
    }

    const productCards = list.map((p) => {
        const img = p.image
            ? `<div class="prod-thumb"><img src="${String(p.image).replace(/"/g, '&quot;')}" alt=""></div>`
            : `<div class="prod-thumb"><span class="prod-emoji">${p.emoji || (isServiceProduct(p) ? '🔧' : '📦')}</span></div>`;
        const tracks = productTracksStock(p);
        const isOutOfStock = tracks && asNumber(p.qty) <= 0;
        const shouldShowOutOfStock = isOutOfStock;
        const outOfStockClass = shouldShowOutOfStock ? ' pdv-product-out-of-stock' : '';
        const svcTag = isServiceProduct(p) ? '<span class="pdv-card-type-tag">Serviço</span>' : '';
        const stockStatus = isServiceProduct(p)
            ? 'Serviço'
            : (shouldShowOutOfStock ? '❌ Sem estoque' : `${asNumber(p.qty)} em estoque`);
        const partsHint = isServiceProduct(p) && asNumber(p.partsCost) > 0
            ? ` · peças ${formatCurrency(asNumber(p.partsCost))}`
            : '';
        const serviceExtra = renderPdvServiceExtra(p);
        const serviceTitle = isServiceProduct(p)
            ? getServiceProductDetails(p)
            : null;
        const cardTitle = serviceTitle && (serviceTitle.duration || serviceTitle.description)
            ? escapeAttr([serviceTitle.duration, serviceTitle.description].filter(Boolean).join(' · '))
            : '';
        return `
    <div class="pdv-product-card${outOfStockClass}${isServiceProduct(p) ? ' pdv-product-card--service' : ''}" onclick='addToCart(${JSON.stringify(p.id)})'${cardTitle ? ` title="${cardTitle}"` : ''}>
      ${svcTag}
      ${img}
      <div class="prod-name">${escapeHtml(p.name || 'Produto')}</div>
      <div class="prod-price">${formatCurrency(asNumber(p.price))}</div>
      <div class="pdv-card-meta">${categories[p.category]?.name || p.category || 'Sem categoria'} • ${stockStatus}${partsHint}</div>
      ${serviceExtra}
    </div>
  `;
    }).join('');

    const emptyBlock = !productCards && search
        ? '<div class="pdv-grid-empty empty-state"><div class="empty-icon">🔍</div><p>Nenhum resultado para esta busca</p></div>'
        : '';

    grid.innerHTML = renderPdvPinnedCards() + productCards + emptyBlock;
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
    return (
        products.find((p) => p.active !== false && String(p.sku || '').trim().toLowerCase() === lower)
        || products.find((p) => p.active !== false && String(p.id || '').trim().toLowerCase() === lower)
        || null
    );
}

function isCartItemCustom(item) {
    return item?.custom === true || String(item?.id || '').startsWith('custom:');
}

function newCustomCartId() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
        return `custom:${crypto.randomUUID()}`;
    }
    return `custom:${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function addToCartByProductCode(code) {
    const product = findProductByProductCode(code);
    if (!product) {
        showToast('Produto não encontrado para este código.', 'error');
        return false;
    }
    addToCart(product.id);
    return true;
}

function tryAddFromSearchValue(rawValue, { clearSearch = true } = {}) {
    const code = String(rawValue || '').trim();
    if (!code) return false;
    const product = findProductByProductCode(code);
    if (!product) return false;
    const searchEl = document.getElementById('pdvSearch');
    if (clearSearch && searchEl) {
        searchEl.value = '';
        filterPDV('');
    }
    addToCart(product.id);
    flashBarcodeScan();
    return true;
}

function addCustomItemToCart(name, price, qty = 1) {
    const label = String(name || '').trim();
    const unitPrice = asNumber(price);
    const amount = Math.max(1, Math.floor(asNumber(qty)));
    if (!label) {
        showToast('Informe a descrição do item.', 'error');
        return false;
    }
    if (!Number.isFinite(unitPrice) || unitPrice < 0) {
        showToast('Informe um preço válido.', 'error');
        return false;
    }
    ensureAppDataShape();
    window.appData.cart.push({
        id: newCustomCartId(),
        custom: true,
        name: label,
        category: 'custom',
        price: unitPrice,
        qty: amount
    });
    renderCart();
    showToast(`${label} adicionado ao carrinho`, 'success');
    return true;
}

const PDV_SCAN_GAP_MS = 85;
const PDV_SCAN_MIN_LEN = 3;
let pdvScanBuf = '';
let pdvScanPending = '';
let pdvScanLastKeyAt = 0;
let pdvSearchScanTimer = null;

function isOnPDVPage() {
    return document.body?.dataset?.page === 'pdv';
}

function flashBarcodeScan() {
    const el = document.getElementById('pdvScanIndicator');
    if (!el) return;
    el.classList.add('flash');
    setTimeout(() => el.classList.remove('flash'), 500);
}

function isPDVModalOpen() {
    return Boolean(
        document.getElementById('customItemModal')?.classList.contains('open')
        || document.getElementById('cartAdjustmentModal')?.classList.contains('open')
        || document.getElementById('confirmActionModal')?.classList.contains('open')
        || document.getElementById('paymentWaitingModal')?.classList.contains('open')
        || document.getElementById('paymentResultModal')?.classList.contains('open')
    );
}

function clearPdvSearchField() {
    const searchEl = document.getElementById('pdvSearch');
    if (searchEl) {
        searchEl.value = '';
        filterPDV('');
    }
}

function resolveBarcodeCode(fallbackFromSearch = true) {
    let code = (pdvScanBuf || pdvScanPending || '').trim();
    pdvScanBuf = '';
    pdvScanPending = '';
    if (!code && fallbackFromSearch) {
        const searchEl = document.getElementById('pdvSearch');
        code = String(searchEl?.value || '').trim();
    }
    return code;
}

function bindPDVBarcodeCapture() {
    if (!isOnPDVPage() || window.__pdvBarcodeBound) return;
    window.__pdvBarcodeBound = true;

    const searchEl = document.getElementById('pdvSearch');

    if (searchEl) {
        searchEl.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter') return;
            const code = String(searchEl.value || '').trim();
            if (!code) return;
            e.preventDefault();
            e.stopPropagation();
            pdvScanBuf = '';
            pdvScanPending = '';
            if (tryAddFromSearchValue(code)) return;
            showToast('Nenhum produto com este código/SKU.', 'info');
        }, true);

        searchEl.addEventListener('input', () => {
            clearTimeout(pdvSearchScanTimer);
            pdvSearchScanTimer = setTimeout(() => {
                const code = String(searchEl.value || '').trim();
                if (code.length >= PDV_SCAN_MIN_LEN && findProductByProductCode(code)) {
                    tryAddFromSearchValue(code);
                }
            }, 140);
        });
    }

    window.addEventListener(
        'keydown',
        (e) => {
            if (!isOnPDVPage() || isPDVModalOpen()) return;
            if (e.ctrlKey || e.metaKey || e.altKey) return;

            const now = Date.now();
            const gap = now - pdvScanLastKeyAt;
            pdvScanLastKeyAt = now;

            if (e.key === 'Enter') {
                const code = resolveBarcodeCode(true);
                if (code.length >= PDV_SCAN_MIN_LEN) {
                    e.preventDefault();
                    e.stopImmediatePropagation();
                    clearPdvSearchField();
                    if (!tryAddFromSearchValue(code, { clearSearch: false })) {
                        showToast('Produto não encontrado para este código.', 'error');
                    }
                }
                return;
            }

            if (e.key.length !== 1) return;

            if (gap > PDV_SCAN_GAP_MS) {
                pdvScanPending = e.key;
                pdvScanBuf = '';
                return;
            }

            if (pdvScanPending) {
                pdvScanBuf = pdvScanPending + e.key;
                pdvScanPending = '';
            } else {
                pdvScanBuf += e.key;
            }

            if (searchEl && document.activeElement === searchEl) {
                searchEl.value = '';
            }

            e.preventDefault();
            e.stopImmediatePropagation();
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

    const tracks = productTracksStock(product);
    const productQty = asNumber(product.qty);
    const minStock = asNumber(product.min ?? product.min_stock ?? 0);
    const isOutOfStock = tracks && productQty <= 0;

    if (isOutOfStock) {
        showToast(`⚠️ ${product.name} está sem estoque. Você poderá confirmar na finalização.`, 'warning');
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

function getCartStockWarnings() {
    const cart = asArray(window.appData?.cart);
    const products = asArray(window.appData?.products);
    const warnings = [];
    cart.forEach((item) => {
        if (isCartItemCustom(item)) return;
        const product = products.find((x) => String(x.id) === String(item.id));
        if (product && !productTracksStock(product)) return;
        const stock = asNumber(product?.qty);
        const requested = asNumber(item.qty);
        if (requested > stock) {
            warnings.push({
                name: item.name || product?.name || 'Produto',
                stock,
                requested
            });
        }
    });
    return warnings;
}

function openConfirmActionModal(actionType) {
    confirmActionType = actionType;
    confirmAllowInsufficientStock = false;
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
            <div class="pdv-confirm-row"><span>Pagamento</span><strong><span class="pdv-confirm-payment-icon">${getPaymentIcon(paymentUiKey)}</span> ${getPaymentLabel(paymentUiKey)}${payment === 'credit_card' ? ` · ${selectedCreditInstallments}x` : ''}</strong></div>
            ${payment === 'credit_card' ? '<div class="pdv-confirm-row"><span>Juros</span><strong>Cliente (na maquininha)</strong></div>' : ''}
            <div class="pdv-confirm-row"><span>Itens</span><strong>${totalItems}</strong></div>
            <div class="pdv-confirm-row total"><span>Total</span><strong>${formatCurrency(totals.total)}</strong></div>
        `;
    }

    syncConfirmPaymentExtras(actionType, paymentUiKey);

    if (itemsEl) {
        itemsEl.innerHTML = cart.length
            ? cart.map((item) => `
                <div class="pdv-confirm-item">
                    <div class="pdv-confirm-item-name">${escapeHtml(item.name || 'Produto')}${isCartItemCustom(item) ? ' <span class="cart-item-custom-tag">Personalizado</span>' : ''}</div>
                    <div class="pdv-confirm-item-qty">x${asNumber(item.qty)}</div>
                    <div class="pdv-confirm-item-value">${formatCurrency(asNumber(item.price) * asNumber(item.qty))}</div>
                </div>
            `).join('')
            : `<div class="empty-state" style="padding:20px;"><p>Carrinho vazio</p></div>`;
    }

    const stockWarnEl = document.getElementById('confirmStockWarning');
    const stockWarnings = actionType === 'finalizar' ? getCartStockWarnings() : [];
    if (stockWarnEl) {
        if (stockWarnings.length > 0) {
            const lines = stockWarnings.map((w) =>
                `${w.name}: pedido ${w.requested}, disponível ${w.stock}`
            ).join('<br>');
            stockWarnEl.innerHTML = `<strong>⚠️ Estoque insuficiente</strong><br>${lines}<br>Deseja finalizar mesmo assim? O estoque ficará negativo.`;
            stockWarnEl.hidden = false;
            confirmAllowInsufficientStock = true;
        } else {
            stockWarnEl.innerHTML = '';
            stockWarnEl.hidden = true;
        }
    }

    if (actionType === 'finalizar') {
        if (title) title.textContent = 'Finalizar venda';
        if (message) {
            message.textContent = stockWarnings.length > 0
                ? 'Confirme a venda mesmo com estoque abaixo do solicitado.'
                : 'Revise os itens e valores abaixo antes de finalizar.';
        }
        if (confirmBtn) confirmBtn.textContent = stockWarnings.length > 0 ? 'Finalizar mesmo assim' : 'Finalizar';
    } else {
        if (stockWarnEl) {
            stockWarnEl.innerHTML = '';
            stockWarnEl.hidden = true;
        }
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
    confirmAllowInsufficientStock = false;
    const stockWarnEl = document.getElementById('confirmStockWarning');
    if (stockWarnEl) {
        stockWarnEl.innerHTML = '';
        stockWarnEl.hidden = true;
    }
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
        const products = asArray(window.appData?.products);
        container.innerHTML = cart.map((item) => {
        const cid = JSON.stringify(String(item.id));
        const customTag = isCartItemCustom(item)
            ? '<span class="cart-item-custom-tag">Personalizado</span>'
            : '';
        const product = products.find((x) => String(x.id) === String(item.id));
        const serviceHint = renderCartServiceHint(product);
        return `
      <div class="cart-item${isCartItemCustom(item) ? ' cart-item--custom' : ''}">
        <div class="cart-item-main">
          <div class="cart-item-name">${escapeHtml(item.name || 'Produto')}${customTag}</div>
          ${serviceHint}
        </div>
        <div class="cart-item-qty">
          <button type="button" class="qty-btn" onclick='changeQty(${cid},-1)'>−</button>
          <span class="qty-num">${asNumber(item.qty)}</span>
          <button type="button" class="qty-btn" onclick='changeQty(${cid},1)'>+</button>
        </div>
        <div class="cart-item-price">${formatCurrency(asNumber(item.price) * asNumber(item.qty))}</div>
        <button type="button" class="cart-item-remove" onclick='removeFromCart(${cid})' aria-label="Remover">✕</button>
      </div>
    `;
    }).join('');
    }

    const totals = getCurrentTotals();
    const count = document.getElementById('cartCount');
    const sub = document.getElementById('cartSubtotal');
    const tot = document.getElementById('cartTotal');
    const discountEl = document.getElementById('cartDiscount');
    const extraEl = document.getElementById('cartExtra');

    const units = cart.reduce((s, i) => s + asNumber(i.qty), 0);
    if (count) count.textContent = `${units} un. · ${cart.length} linha${cart.length !== 1 ? 's' : ''}`;
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

    const next = asNumber(item.qty) + delta;
    if (next <= 0) return removeFromCart(id);

    if (!isCartItemCustom(item)) {
        const product = products.find((x) => String(x.id) === String(id));
        if (product && productTracksStock(product)) {
            const productQty = asNumber(product.qty);
            if (next > productQty) {
                showToast(`⚠️ ${item.name || 'Produto'}: estoque ${productQty}, carrinho ${next}. Confirme na finalização.`, 'warning');
            }
        }
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
let paymentCancelInFlight = false;
let paymentAbortRequested = false;
let paymentCooldownUntil = 0;
let paymentWaitingModalBound = false;
let cardPaymentPostInFlight = false;

function getPaymentStatusText(status, paymentKey) {
    const key = String(status || '').toLowerCase();
    if (paymentKey === 'pix') {
        const pixMap = {
            pending: 'Aguardando pagamento PIX',
            in_process: 'Pagamento em processamento',
            created: 'Aguardando pagamento PIX',
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

async function abortPendingPaymentOnServer(token) {
    const url = token
        ? `/api/sales/pending/${encodeURIComponent(token)}`
        : '/api/sales/pending/active';
    const res = await fetch(url, { method: 'DELETE', credentials: 'same-origin' });
    let data = {};
    try { data = await res.json(); } catch { data = {}; }
    return data;
}

function openPaymentWaitingModal(paymentKey) {
    paymentAbortRequested = false;
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

    if (data.cashFlowEntry) {
        if (!Array.isArray(window.appData.cashFlowEntries)) window.appData.cashFlowEntries = [];
        window.appData.cashFlowEntries.unshift(data.cashFlowEntry);
    }

    window.appData.cart = [];
    setAdjustment('discount', 'fixed', 0);
    setAdjustment('extra', 'fixed', 0);
    renderCart();
    renderPDV(currentPDVFilter);

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
    if (paymentAbortRequested) {
        try {
            await abortPendingPaymentOnServer(token);
        } catch (e) {
            console.error(e);
        }
        currentPendingToken = null;
        finalizeSaleInFlight = false;
        paymentCooldownUntil = Date.now() + 2500;
        closePaymentWaitingModal();
        return;
    }
    const check = async () => {
        if (paymentAbortRequested) {
            stopPendingPoll();
            try {
                await abortPendingPaymentOnServer(token);
            } catch (e) {
                console.error(e);
            }
            currentPendingToken = null;
            finalizeSaleInFlight = false;
            paymentCooldownUntil = Date.now() + 2500;
            closePaymentWaitingModal();
            return;
        }
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
    if (Date.now() < paymentCooldownUntil) {
        showToast('Aguarde o terminal liberar antes de uma nova cobrança.', 'warning');
        return false;
    }

    const totals = getCurrentTotals();
    const payment = normalizePaymentKey(selectedPaymentMethod);
    paymentAbortRequested = false;
    const payload = {
        items: cart.map((i) => {
            if (isCartItemCustom(i)) {
                return {
                    id: i.id,
                    name: String(i.name || '').trim(),
                    price: asNumber(i.price),
                    qty: asNumber(i.qty),
                    custom: true
                };
            }
            return { id: i.id, qty: asNumber(i.qty) };
        }),
        discount: { ...cartAdjustments.discount },
        extra: { ...cartAdjustments.extra },
        payment,
        client: 'Balcão',
        allowInsufficientStock: confirmAllowInsufficientStock
    };

    if (payment === 'credit_card') {
        payload.installments = selectedCreditInstallments;
    }

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
    if (isCardOrPix) cardPaymentPostInFlight = true;
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
            finalizeSaleInFlight = false;
            if (data.stockInsufficient && !confirmAllowInsufficientStock) {
                const warnings = getCartStockWarnings();
                if (warnings.length > 0) {
                    confirmAllowInsufficientStock = true;
                    openConfirmActionModal('finalizar');
                    showToast('Confirme a venda para prosseguir sem estoque suficiente.', 'warning');
                    return false;
                }
            }
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
            if (paymentAbortRequested) {
                try {
                    await abortPendingPaymentOnServer(data.token);
                } catch (e) {
                    console.error(e);
                }
                closePaymentWaitingModal();
                showToast('Cobrança cancelada.', 'info');
                finalizeSaleInFlight = false;
                paymentCooldownUntil = Date.now() + 2500;
                return false;
            }
            currentPendingToken = data.token;
            applyPaymentWaitingData(data.payment || {});
            setPaymentWaitingStatus(getPaymentStatusText(data?.payment?.status, payment));
            await pollPendingSaleStatus(data.token, totals, payment);
            return true;
        }

        applySuccessfulSale(data, totals, payment);
        return true;
    } catch (e) {
        console.error(e);
        finalizeSaleInFlight = false;
        if (payment !== 'money') closePaymentWaitingModal();
        showToast('Erro de rede ao finalizar a venda.', 'error');
        return false;
    } finally {
        cardPaymentPostInFlight = false;
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

function setPaymentWaitingActionsDisabled(disabled) {
    const ids = ['cancelPaymentWaitingBtn', 'closePaymentWaitingModalBtn'];
    ids.forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.disabled = disabled;
    });
}

async function cancelPaymentWaiting() {
    if (paymentCancelInFlight) return;
    paymentCancelInFlight = true;
    paymentAbortRequested = true;
    setPaymentWaitingActionsDisabled(true);
    setPaymentWaitingStatus('Cancelando cobrança...');
    const token = currentPendingToken;
    stopPendingPoll();
    try {
        const data = await abortPendingPaymentOnServer(token);
        if (data.cancelWarning) {
            showToast('Cancelamento enviado, mas a maquininha pode ainda estar ocupada. Aguarde alguns segundos.', 'warning');
        } else {
            showToast('Pagamento cancelado.', 'info');
        }
    } catch (e) {
        console.error(e);
        showToast('Erro ao cancelar pagamento.', 'error');
    } finally {
        currentPendingToken = null;
        if (token || !cardPaymentPostInFlight) finalizeSaleInFlight = false;
        paymentCancelInFlight = false;
        paymentCooldownUntil = Date.now() + 2500;
        setPaymentWaitingActionsDisabled(false);
        closePaymentWaitingModal();
    }
}

function bindPaymentWaitingModal() {
    if (paymentWaitingModalBound) return;
    paymentWaitingModalBound = true;
    const cancelBtn = document.getElementById('cancelPaymentWaitingBtn');
    const closeBtn = document.getElementById('closePaymentWaitingModalBtn');
    const modal = document.getElementById('paymentWaitingModal');
    if (cancelBtn) cancelBtn.addEventListener('click', cancelPaymentWaiting);
    if (closeBtn) closeBtn.addEventListener('click', cancelPaymentWaiting);
    if (modal) {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) cancelPaymentWaiting();
        });
    }

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

function bootPDV() {
    whenAppReady(() => {
        initPDV();
        bindConfirmModal();
        bindPaymentWaitingModal();
        bindPaymentResultModal();
        bindCartAdjustmentModal();
        bindBudgetModal();
        bindBudgetTemplateModal();
        bindCustomItemModal();
        bindPDVBarcodeCapture();
        bindPDVKeyboardShortcuts();
        const cashInput = document.getElementById('pdvCashReceivedInput');
        if (cashInput) cashInput.addEventListener('input', updateCashChangeDisplay);
    });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootPDV);
} else {
    bootPDV();
}
