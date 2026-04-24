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
                <div><strong>${escapeHtml(budget.code || 'Orçamento')}</strong> ${budget.status === 'finalized' ? '✅' : '📝'}</div>
                <div class="text-xs text-muted">${escapeHtml(budget.customerName || 'Cliente não informado')} · ${formatCurrency(asNumber(budget.total))}</div>
            </div>
            <div class="flex gap-8">
                <button class="btn btn-ghost btn-sm" type="button" onclick="openBudgetTemplateById('${escapeHtml(String(budget.id || ''))}')">Template</button>
                ${budget.status === 'finalized' ? '' : `<button class="btn btn-primary btn-sm" type="button" onclick="finalizeBudgetById('${escapeHtml(String(budget.id || ''))}')">Finalizar</button>`}
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
        status: status === 'finalized' ? 'finalized' : 'draft'
    };
}

function getBudgetTemplateHtml(budget) {
    const items = asArray(budget?.items);
    const logo = '/public/img/logo_bg.png';
    const rows = items.map((item) => `
        <tr>
            <td style="padding:8px;border-bottom:1px solid #e5e7eb;">${escapeHtml(item.name || '')}</td>
            <td style="padding:8px;border-bottom:1px solid #e5e7eb;text-align:center;">${asNumber(item.qty)}</td>
            <td style="padding:8px;border-bottom:1px solid #e5e7eb;text-align:right;">${formatCurrency(asNumber(item.unitPrice))}</td>
            <td style="padding:8px;border-bottom:1px solid #e5e7eb;text-align:right;font-weight:700;">${formatCurrency(asNumber(item.qty) * asNumber(item.unitPrice))}</td>
        </tr>
    `).join('');
    return `
        <div id="budgetPrintArea" style="font-family:Inter,Arial,sans-serif;max-width:760px;margin:0 auto;">
            <div style="display:flex;justify-content:space-between;align-items:center;padding-bottom:14px;border-bottom:2px solid #111827;">
                <div style="display:flex;align-items:center;gap:10px;">
                    <img src="${logo}" alt="Logo" style="width:56px;height:56px;border-radius:8px;object-fit:cover;">
                    <div>
                        <div style="font-size:1.2rem;font-weight:800;color:#111827;">InfoCore System</div>
                        <div style="font-size:.85rem;color:#4b5563;">Orçamento comercial</div>
                    </div>
                </div>
                <div style="text-align:right;">
                    <div style="font-weight:700;color:#111827;">${escapeHtml(budget.code || 'ORC')}</div>
                    <div style="font-size:.82rem;color:#6b7280;">Status: ${budget.status === 'finalized' ? 'Finalizado' : 'Rascunho'}</div>
                </div>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:12px;">
                <div style="background:#f8fafc;border:1px solid #e5e7eb;padding:10px;border-radius:10px;">
                    <div><strong>Cliente:</strong> ${escapeHtml(budget.customerName || '-')}</div>
                    <div><strong>WhatsApp:</strong> ${escapeHtml(budget.customerPhone || '-')}</div>
                    <div><strong>Email:</strong> ${escapeHtml(budget.customerEmail || '-')}</div>
                </div>
                <div style="background:#f8fafc;border:1px solid #e5e7eb;padding:10px;border-radius:10px;">
                    <div><strong>Validade:</strong> ${escapeHtml(budget.validUntil || '-')}</div>
                    <div><strong>Observações:</strong> ${escapeHtml(budget.notes || '-')}</div>
                </div>
            </div>
            <table style="width:100%;border-collapse:collapse;margin-top:14px;">
                <thead style="background:#111827;color:#fff;">
                    <tr><th style="padding:8px;text-align:left;">Item</th><th>Qtd</th><th style="text-align:right;">Unitário</th><th style="text-align:right;">Total</th></tr>
                </thead>
                <tbody>${rows}</tbody>
            </table>
            <div style="margin-top:12px;display:flex;justify-content:flex-end;">
                <div style="min-width:260px;border:1px solid #e5e7eb;border-radius:8px;padding:10px;">
                    <div style="display:flex;justify-content:space-between;"><span>Subtotal</span><strong>${formatCurrency(asNumber(budget.subtotal))}</strong></div>
                    <div style="display:flex;justify-content:space-between;"><span>Desconto</span><strong>- ${formatCurrency(asNumber(budget.discount))}</strong></div>
                    <div style="display:flex;justify-content:space-between;"><span>Acréscimo</span><strong>+ ${formatCurrency(asNumber(budget.extra))}</strong></div>
                    <div style="display:flex;justify-content:space-between;font-size:1.05rem;margin-top:6px;"><span>Total</span><strong>${formatCurrency(asNumber(budget.total))}</strong></div>
                </div>
            </div>
        </div>
    `;
}

function buildWhatsappTemplate(budget) {
    return [
        `*Orçamento ${budget.code || ''}* - InfoCore`,
        `Cliente: ${budget.customerName || 'Não informado'}`,
        `Total: ${formatCurrency(asNumber(budget.total))}`,
        '',
        ...asArray(budget.items).map((item) => `- ${item.name} (x${asNumber(item.qty)}) ${formatCurrency(asNumber(item.qty) * asNumber(item.unitPrice))}`),
        '',
        `Validade: ${budget.validUntil || 'Não informada'}`,
        `Assinatura: ________________________`
    ].join('\n');
}

function buildEmailTemplate(budget) {
    return `
<h2>Orçamento ${escapeHtml(budget.code || '')} - InfoCore</h2>
<p>Cliente: <strong>${escapeHtml(budget.customerName || 'Não informado')}</strong></p>
<p>Total: <strong>${formatCurrency(asNumber(budget.total))}</strong></p>
<ul>${asArray(budget.items).map((item) => `<li>${escapeHtml(item.name)} - x${asNumber(item.qty)} - ${formatCurrency(asNumber(item.qty) * asNumber(item.unitPrice))}</li>`).join('')}</ul>
<p>Validade: ${escapeHtml(budget.validUntil || 'Não informada')}</p>
<p>Assinatura: _______________________________________</p>
    `.trim();
}

function openBudgetTemplateModal(budget) {
    budgetCurrentRecord = budget;
    const preview = document.getElementById('budgetTemplatePreview');
    const modal = document.getElementById('budgetTemplateModal');
    if (preview) preview.innerHTML = getBudgetTemplateHtml(budget);
    if (modal) modal.classList.add('open');
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
        showToast(status === 'finalized' ? 'Orçamento finalizado!' : 'Orçamento salvo!', 'success');
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
            showToast(data.message || 'Erro ao finalizar orçamento.', 'error');
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
    const html = getBudgetTemplateHtml(budgetCurrentRecord);
    const w = window.open('', '_blank');
    if (!w) return;
    w.document.write(`<html><head><title>Orçamento ${escapeHtml(budgetCurrentRecord.code || '')}</title></head><body>${html}</body></html>`);
    w.document.close();
    w.focus();
    w.print();
}

function downloadBudgetImage() {
    if (!budgetCurrentRecord) return;
    const text = encodeURIComponent(buildWhatsappTemplate(budgetCurrentRecord));
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350"><rect width="100%" height="100%" fill="#0f172a"/><rect x="40" y="40" width="1000" height="1270" rx="26" fill="#ffffff"/><text x="80" y="110" font-size="42" font-family="Arial" font-weight="700" fill="#111827">InfoCore - ${escapeHtml(budgetCurrentRecord.code || 'Orçamento')}</text><foreignObject x="80" y="150" width="920" height="1100"><div xmlns="http://www.w3.org/1999/xhtml" style="font-family:Arial,sans-serif;font-size:26px;line-height:1.45;color:#111827;white-space:pre-wrap;">${decodeURIComponent(text)}</div></foreignObject></svg>`;
    const img = new Image();
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
    img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = 1080;
        canvas.height = 1350;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.drawImage(img, 0, 0);
        URL.revokeObjectURL(url);
        const a = document.createElement('a');
        a.href = canvas.toDataURL('image/png');
        a.download = `${budgetCurrentRecord.code || 'orcamento'}.png`;
        a.click();
    };
    img.src = url;
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
    if (copyWhatsappBtn) copyWhatsappBtn.addEventListener('click', () => {
        if (!budgetCurrentRecord) return;
        copyTextToClipboard(buildWhatsappTemplate(budgetCurrentRecord), 'Template de WhatsApp copiado.');
    });
    if (copyEmailBtn) copyEmailBtn.addEventListener('click', () => {
        if (!budgetCurrentRecord) return;
        copyTextToClipboard(buildEmailTemplate(budgetCurrentRecord), 'Template HTML de email copiado.');
    });
    if (downloadImageBtn) downloadImageBtn.addEventListener('click', downloadBudgetImage);
    if (generatePdfBtn) generatePdfBtn.addEventListener('click', generateBudgetPdf);
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
        bindBudgetModal();
        bindBudgetTemplateModal();
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
    bindBudgetModal();
    bindBudgetTemplateModal();
    bindPDVBarcodeCapture();
    const cashInput = document.getElementById('pdvCashReceivedInput');
    if (cashInput) cashInput.addEventListener('input', updateCashChangeDisplay);
}
