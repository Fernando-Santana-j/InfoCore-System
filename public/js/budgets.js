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

function renderProductsSelect() {
    const select = document.getElementById('budgetProductSelect');
    if (!select) return;
    const products = asArray(window.appData?.products).filter((p) => p.active !== false);
    select.innerHTML = `<option value="">Selecione um produto cadastrado...</option>${products.map((p) => `<option value="${escapeHtml(String(p.id))}">${escapeHtml(p.name)} - ${formatCurrency(asNumber(p.price))}</option>`).join('')}`;
}

function renderDraftItems() {
    const list = document.getElementById('budgetItemsList');
    if (!list) return;
    if (budgetItemsDraft.length === 0) {
        list.innerHTML = '<div class="empty-state" style="padding:20px;"><div class="empty-icon">🧾</div><p>Nenhum item no orçamento.</p></div>';
    } else {
        list.innerHTML = budgetItemsDraft.map((item, index) => `
            <div class="budget-items-row">
                <input class="form-input" value="${escapeHtml(item.name)}" onchange="updateDraftItem(${index}, 'name', this.value)">
                <input class="form-input" type="number" min="1" step="1" value="${asNumber(item.qty)}" onchange="updateDraftItem(${index}, 'qty', this.value)">
                <input class="form-input" type="number" min="0" step="0.01" value="${asNumber(item.unitPrice)}" onchange="updateDraftItem(${index}, 'unitPrice', this.value)">
                <span class="budget-items-total">${formatCurrency(asNumber(item.qty) * asNumber(item.unitPrice))}</span>
                <button class="btn btn-ghost btn-sm" type="button" onclick="removeDraftItem(${index})">✕</button>
            </div>
        `).join('');
    }
    renderTotals();
}

function renderTotals() {
    const totalsEl = document.getElementById('budgetTotalsBox');
    if (!totalsEl) return;
    const totals = budgetTotals();
    totalsEl.innerHTML = `
        <div class="cart-total-row"><span>Subtotal</span><span class="mono">${formatCurrency(totals.subtotal)}</span></div>
        <div class="cart-total-row"><span>Desconto</span><span class="mono">- ${formatCurrency(totals.discount)}</span></div>
        <div class="cart-total-row"><span>Acréscimo</span><span class="mono">+ ${formatCurrency(totals.extra)}</span></div>
        <div class="divider"></div>
        <div class="cart-total-row grand"><span>Total</span><span class="val">${formatCurrency(totals.total)}</span></div>
    `;
}

function updateDraftItem(index, key, value) {
    const item = budgetItemsDraft[index];
    if (!item) return;
    if (key === 'qty' || key === 'unitPrice') item[key] = Math.max(0, asNumber(value));
    else item[key] = String(value || '').trim();
    renderDraftItems();
}

function removeDraftItem(index) {
    budgetItemsDraft.splice(index, 1);
    renderDraftItems();
}

function addCustomItem() {
    budgetItemsDraft.push({ kind: 'custom', productId: '', sku: '', name: 'Serviço personalizado', qty: 1, unitPrice: 0 });
    renderDraftItems();
}

function addProductItem() {
    const select = document.getElementById('budgetProductSelect');
    const id = String(select?.value || '').trim();
    if (!id) {
        showToast('Selecione um produto para adicionar.', 'info');
        return;
    }
    const p = asArray(window.appData?.products).find((row) => String(row.id) === id);
    if (!p) return;
    budgetItemsDraft.push({
        kind: 'product',
        productId: String(p.id),
        sku: String(p.sku || ''),
        name: String(p.name || 'Produto'),
        qty: 1,
        unitPrice: asNumber(p.price)
    });
    renderDraftItems();
}

function payloadFromDraft(status) {
    const totals = budgetTotals();
    return {
        customerName: String(document.getElementById('budgetCustomerName')?.value || '').trim(),
        customerPhone: String(document.getElementById('budgetCustomerPhone')?.value || '').trim(),
        customerEmail: String(document.getElementById('budgetCustomerEmail')?.value || '').trim(),
        validUntil: String(document.getElementById('budgetdate')?.value || '').trim(),
        notes: String(document.getElementById('budgetNotes')?.value || '').trim(),
        discount: totals.discount,
        extra: totals.extra,
        status: status === 'finalized' ? 'finalized' : 'draft',
        items: budgetItemsDraft
            .filter((item) => String(item.name || '').trim() && asNumber(item.qty) > 0)
            .map((item) => ({
                kind: item.kind === 'product' ? 'product' : 'custom',
                productId: String(item.productId || ''),
                sku: String(item.sku || ''),
                name: String(item.name || '').trim(),
                qty: asNumber(item.qty),
                unitPrice: asNumber(item.unitPrice)
            }))
    };
}

function openTemplateModal(budget) {
    budgetCurrentRecord = budget;
    const preview = document.getElementById('budgetTemplatePreview');
    const modal = document.getElementById('budgetTemplateModal');
    if (modal) modal.classList.add('open');
    loadBudgetTemplatePreview(budget, preview);
}

function closeTemplateModal() {
    const modal = document.getElementById('budgetTemplateModal');
    if (modal) modal.classList.remove('open');
}

function renderSavedBudgets() {
    const search = String(document.getElementById('budgetSearchInput')?.value || '').trim().toLowerCase();
    const draftGrid = document.getElementById('budgetsDraftGrid');
    const finalGrid = document.getElementById('budgetsFinalGrid');
    if (!draftGrid || !finalGrid) return;
    const list = asArray(window.appData?.budgets).filter((budget) => {
        if (!search) return true;
        return String(budget.code || '').toLowerCase().includes(search) || String(budget.customerName || '').toLowerCase().includes(search);
    });
    const drafts = list.filter((b) => String(b.status || 'draft') !== 'finalized');
    const finalized = list.filter((b) => String(b.status || '') === 'finalized');

    const renderCards = (budgets, allowFinalize) => budgets
        .slice()
        .sort((a, b) => String(b.code || '').localeCompare(String(a.code || '')))
        .map((budget) => `
            <div class="budget-card-item">
                <div class="budget-card-head">
                    <strong>${escapeHtml(budget.code || 'Orçamento')}</strong>
                    <span class="badge ${budget.status === 'finalized' ? 'green' : ''}">${budget.status === 'finalized' ? 'Finalizado' : 'Rascunho'}</span>
                </div>
                <div class="budget-card-meta">
                    <div>Cliente: ${escapeHtml(budget.customerName || 'Não informado')}</div>
                    <div>Itens: ${asArray(budget.items).length}</div>
                    <div>Validade: ${escapeHtml(budget.validUntil || budget.date || 'N/I')}</div>
                    <div>Total: ${formatCurrency(asNumber(budget.total))}</div>
                </div>
                <div class="budget-card-actions">
                    <button class="btn btn-ghost btn-sm" type="button" onclick="openTemplateById('${escapeHtml(String(budget.id || ''))}')">Template</button>
                    ${allowFinalize ? `<button class="btn btn-primary btn-sm" type="button" onclick="finalizeById('${escapeHtml(String(budget.id || ''))}')">Finalizar</button>` : ''}
                </div>
            </div>
        `).join('');

    draftGrid.innerHTML = drafts.length
        ? renderCards(drafts, true)
        : '<div class="empty-state" style="padding:24px;"><div class="empty-icon">📝</div><p>Nenhum orçamento salvo.</p></div>';
    finalGrid.innerHTML = finalized.length
        ? renderCards(finalized, false)
        : '<div class="empty-state" style="padding:24px;"><div class="empty-icon">✅</div><p>Nenhum orçamento finalizado.</p></div>';
}

async function saveBudget(status) {
    const payload = payloadFromDraft(status);
    if (payload.items.length === 0) {
        showToast('Adicione ao menos um item ao orçamento.', 'error');
        return false;
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
            showToast(data.message || 'Erro ao salvar orçamento.', 'error');
            return false;
        }
        window.appData.budgets = asArray(window.appData.budgets);
        window.appData.budgets.unshift(data.budget);
        renderSavedBudgets();
        showToast(status === 'finalized' ? 'Orçamento finalizado!' : 'Orçamento salvo!', 'success');
        if (status === 'finalized') showNotificationStatus(data.notifications);
        openTemplateModal(data.budget);
        return true;
    } catch (e) {
        console.error(e);
        showToast('Erro ao salvar orçamento.', 'error');
        return false;
    }
}

async function finalizeById(id) {
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
        showToast('Orçamento finalizado com sucesso.', 'success');
        showNotificationStatus(data.notifications);
        openTemplateModal(data.budget);
    } catch (e) {
        console.error(e);
        showToast('Erro ao finalizar orçamento.', 'error');
    }
}

function openTemplateById(id) {
    const budget = asArray(window.appData?.budgets).find((item) => String(item.id) === String(id));
    if (!budget) return;
    openTemplateModal(budget);
}

function generatePdf() {
    if (!budgetCurrentRecord) return;
    printBudgetTemplatePdf(budgetCurrentRecord);
}

function downloadImage() {
    if (!budgetCurrentRecord) return;
    downloadBudgetTemplateImage(budgetCurrentRecord);
}

async function copyText(value, okMessage) {
    try {
        await navigator.clipboard.writeText(value);
        showToast(okMessage, 'success');
    } catch (e) {
        console.error(e);
        showToast('Não foi possível copiar automaticamente.', 'error');
    }
}

function showNotificationStatus(notifications) {
    if (!notifications || typeof notifications !== 'object') return;
    const email = notifications.email;
    const whatsapp = notifications.whatsapp;
    if (email?.sent) showToast('Email enviado automaticamente.', 'success');
    else if (email && !email.skipped) showToast(`Email: ${email.reason || 'falha no envio'}`, 'error');
    if (whatsapp?.sent) showToast('WhatsApp enviado automaticamente.', 'success');
    else if (whatsapp && !whatsapp.skipped) showToast(`WhatsApp: ${whatsapp.reason || 'falha no envio'}`, 'error');
}

function bindEvents() {
    const openCreateBtn = document.getElementById('openCreateBudgetModalBtn');
    const createModal = document.getElementById('budgetCreateModal');
    const closeCreateBtn = document.getElementById('closeCreateBudgetModalBtn');
    const cancelCreateBtn = document.getElementById('cancelCreateBudgetBtn');
    const addProductBtn = document.getElementById('budgetAddProductBtn');
    const addCustomBtn = document.getElementById('budgetAddCustomBtn');
    const saveDraftBtn = document.getElementById('budgetPageSaveDraftBtn');
    const saveFinalBtn = document.getElementById('budgetPageSaveFinalBtn');
    const searchInput = document.getElementById('budgetSearchInput');
    const discountInput = document.getElementById('budgetDiscountInput');
    const extraInput = document.getElementById('budgetExtraInput');
    const closeBtn = document.getElementById('closeBudgetTemplateModalBtn');
    const doneBtn = document.getElementById('budgetTemplateDoneBtn');
    const modal = document.getElementById('budgetTemplateModal');
    const copyWhatsappBtn = document.getElementById('budgetCopyWhatsappBtn');
    const copyEmailBtn = document.getElementById('budgetCopyEmailBtn');
    const downloadImageBtn = document.getElementById('budgetDownloadImageBtn');
    const generatePdfBtn = document.getElementById('budgetGeneratePdfBtn');

    const closeCreateModal = () => {
        if (createModal) createModal.classList.remove('open');
    };
    const openCreateModal = () => {
        budgetItemsDraft = [];
        const customerName = document.getElementById('budgetCustomerName');
        const customerPhone = document.getElementById('budgetCustomerPhone');
        const customerEmail = document.getElementById('budgetCustomerEmail');
        const date = document.getElementById('budgetdate');
        const notes = document.getElementById('budgetNotes');
        const discountInputReset = document.getElementById('budgetDiscountInput');
        const extraInputReset = document.getElementById('budgetExtraInput');
        if (customerName) customerName.value = '';
        if (customerPhone) customerPhone.value = '';
        if (customerEmail) customerEmail.value = '';
        if (date) date.value = new Date().toISOString().slice(0, 10);
        if (notes) notes.value = '';
        if (discountInputReset) discountInputReset.value = '0';
        if (extraInputReset) extraInputReset.value = '0';
        renderDraftItems();
        if (createModal) createModal.classList.add('open');
    };

    if (openCreateBtn) openCreateBtn.addEventListener('click', openCreateModal);
    if (closeCreateBtn) closeCreateBtn.addEventListener('click', closeCreateModal);
    if (cancelCreateBtn) cancelCreateBtn.addEventListener('click', closeCreateModal);
    if (createModal) createModal.addEventListener('click', (e) => { if (e.target === createModal) closeCreateModal(); });
    if (addProductBtn) addProductBtn.addEventListener('click', addProductItem);
    if (addCustomBtn) addCustomBtn.addEventListener('click', addCustomItem);
    if (saveDraftBtn) saveDraftBtn.addEventListener('click', async () => {
        const ok = await saveBudget('draft');
        if (ok) closeCreateModal();
    });
    if (saveFinalBtn) saveFinalBtn.addEventListener('click', async () => {
        const ok = await saveBudget('finalized');
        if (ok) closeCreateModal();
    });
    if (searchInput) searchInput.addEventListener('input', renderSavedBudgets);
    if (discountInput) discountInput.addEventListener('input', renderTotals);
    if (extraInput) extraInput.addEventListener('input', renderTotals);
    if (closeBtn) closeBtn.addEventListener('click', closeTemplateModal);
    if (doneBtn) doneBtn.addEventListener('click', closeTemplateModal);
    if (modal) modal.addEventListener('click', (e) => { if (e.target === modal) closeTemplateModal(); });
    if (copyWhatsappBtn) copyWhatsappBtn.addEventListener('click', async () => {
        if (!budgetCurrentRecord) return;
        try {
            await copyBudgetTemplateText('whatsapp', budgetCurrentRecord);
            showToast('Template WhatsApp copiado.', 'success');
        } catch (e) {
            console.error(e);
            showToast('Não foi possível copiar o template.', 'error');
        }
    });
    if (copyEmailBtn) copyEmailBtn.addEventListener('click', async () => {
        if (!budgetCurrentRecord) return;
        try {
            await copyBudgetTemplateText('email', budgetCurrentRecord);
            showToast('Template de email copiado.', 'success');
        } catch (e) {
            console.error(e);
            showToast('Não foi possível copiar o template.', 'error');
        }
    });
    if (downloadImageBtn) downloadImageBtn.addEventListener('click', downloadImage);
    if (generatePdfBtn) generatePdfBtn.addEventListener('click', generatePdf);
}

function initBudgetsPage() {
    updateTopbarTitle('Orçamentos');
    markNavActive('/budgets');
    renderProductsSelect();
    renderDraftItems();
    renderSavedBudgets();
    bindEvents();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initBudgetsPage);
} else {
    initBudgetsPage();
}
