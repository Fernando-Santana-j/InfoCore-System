let budgetItemsDraft = [];
let budgetCurrentRecord = null;
let editingBudgetId = '';
let selectedBudgetCustomerId = '';
let selectedBudgetProductId = '';
let budgetProductAcIndex = -1;
let budgetCustomerAcIndex = -1;

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

async function parseJsonResponse(res) {
    const text = await res.text();
    if (!text) {
        return {
            error: !res.ok,
            message: res.ok ? '' : 'Resposta vazia do servidor.'
        };
    }
    try {
        return JSON.parse(text);
    } catch (_e) {
        const plain = text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 140);
        return {
            error: true,
            message: res.status === 401
                ? 'Sessão expirada. Faça login novamente.'
                : (plain || 'Resposta inválida do servidor.')
        };
    }
}

function activeProducts() {
    return asArray(window.appData?.products).filter((p) => p.active !== false);
}

function customerList() {
    return asArray(window.appData?.customers)
        .slice()
        .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
}

function budgetTotals(items = budgetItemsDraft) {
    const subtotal = items.reduce((sum, item) => sum + (asNumber(item.qty) * asNumber(item.unitPrice)), 0);
    const discount = asNumber(document.getElementById('budgetDiscountInput')?.value);
    const extra = asNumber(document.getElementById('budgetExtraInput')?.value);
    const total = Math.max(0, subtotal - discount + extra);
    return { subtotal, discount, extra, total };
}

function normalizeSearchTerm(s) {
    return String(s || '').trim().toLowerCase();
}

function filterProducts(term) {
    const q = normalizeSearchTerm(term);
    let list = activeProducts();
    if (!q) return list.slice(0, 24);
    return list.filter((p) => {
        const name = String(p.name || '').toLowerCase();
        const sku = String(p.sku || '').toLowerCase();
        const cat = String(p.category || '').toLowerCase();
        return name.includes(q) || sku.includes(q) || sku === q || cat.includes(q);
    }).slice(0, 24);
}

function filterCustomers(term) {
    const q = normalizeSearchTerm(term);
    const list = customerList();
    if (!q) return list.slice(0, 20);
    return list.filter((c) =>
        String(c.name || '').toLowerCase().includes(q) ||
        String(c.email || '').toLowerCase().includes(q) ||
        String(c.phone || '').includes(q) ||
        String(c.doc || '').includes(q)
    ).slice(0, 20);
}

function findProductByCode(code) {
    const lower = String(code || '').trim().toLowerCase();
    if (!lower) return null;
    return activeProducts().find((p) => String(p.sku || '').trim().toLowerCase() === lower) || null;
}

function renderProductAcList(term) {
    const listEl = document.getElementById('budgetProductResults');
    if (!listEl) return;
    const matches = filterProducts(term);
    budgetProductAcIndex = matches.length ? 0 : -1;

    if (!matches.length) {
        listEl.innerHTML = '<div class="budget-ac-empty">Nenhum produto encontrado.</div>';
        listEl.hidden = false;
        selectedBudgetProductId = '';
        return;
    }

    listEl.innerHTML = matches.map((p, i) => {
        const stock = asNumber(p.qty);
        const active = i === budgetProductAcIndex ? ' is-active' : '';
        return `
      <button type="button" class="budget-ac-item${active}" data-product-id="${escapeHtml(String(p.id))}">
        <span class="budget-ac-item-title">${escapeHtml(p.name)}</span>
        <span class="budget-ac-item-meta">SKU ${escapeHtml(p.sku || '—')} · ${formatCurrency(asNumber(p.price))} · Est. ${stock}</span>
      </button>`;
    }).join('');

    listEl.hidden = false;
    listEl.querySelectorAll('.budget-ac-item').forEach((btn, i) => {
        btn.addEventListener('mousedown', (e) => {
            e.preventDefault();
            selectProductFromAc(btn.getAttribute('data-product-id'));
        });
        btn.addEventListener('mouseenter', () => {
            budgetProductAcIndex = i;
            listEl.querySelectorAll('.budget-ac-item').forEach((el, j) => {
                el.classList.toggle('is-active', j === i);
            });
        });
    });

    selectedBudgetProductId = String(matches[0]?.id || '');
}

function hideProductAcList() {
    const listEl = document.getElementById('budgetProductResults');
    if (listEl) listEl.hidden = true;
}

function selectProductFromAc(productId) {
    const id = String(productId || '').trim();
    if (!id) return;
    const p = activeProducts().find((row) => String(row.id) === id);
    if (!p) return;

    const existing = budgetItemsDraft.find((item) => item.kind === 'product' && String(item.productId) === id);
    if (existing) {
        existing.qty = asNumber(existing.qty) + 1;
    } else {
        budgetItemsDraft.push({
            kind: 'product',
            productId: String(p.id),
            sku: String(p.sku || ''),
            name: String(p.name || 'Produto'),
            qty: 1,
            unitPrice: asNumber(p.price),
            unitCost: asNumber(p.cost)
        });
    }

    const search = document.getElementById('budgetProductSearch');
    if (search) search.value = '';
    selectedBudgetProductId = '';
    budgetProductAcIndex = -1;
    hideProductAcList();
    renderDraftItems();
    showToast(`${p.name} adicionado ao orçamento.`, 'success');
}

function renderCustomerAcList(term) {
    const listEl = document.getElementById('budgetCustomerResults');
    if (!listEl) return;
    const matches = filterCustomers(term);
    budgetCustomerAcIndex = matches.length ? 0 : -1;

    if (!matches.length) {
        listEl.innerHTML = `<div class="budget-ac-empty">Nenhum cliente encontrado. <a href="/clients">Cadastrar no CRM</a></div>`;
        listEl.hidden = false;
        return;
    }

    listEl.innerHTML = matches.map((c, i) => {
        const active = i === budgetCustomerAcIndex ? ' is-active' : '';
        const meta = [c.phone, c.email, c.doc].filter(Boolean).join(' · ');
        return `
      <button type="button" class="budget-ac-item${active}" data-customer-id="${escapeHtml(String(c.id))}">
        <span class="budget-ac-item-title">${escapeHtml(c.name)}</span>
        <span class="budget-ac-item-meta">${escapeHtml(meta || 'Sem contato cadastrado')}</span>
      </button>`;
    }).join('');

    listEl.hidden = false;
    listEl.querySelectorAll('.budget-ac-item').forEach((btn, i) => {
        btn.addEventListener('mousedown', (e) => {
            e.preventDefault();
            selectCustomerFromAc(btn.getAttribute('data-customer-id'));
        });
        btn.addEventListener('mouseenter', () => {
            budgetCustomerAcIndex = i;
            listEl.querySelectorAll('.budget-ac-item').forEach((el, j) => {
                el.classList.toggle('is-active', j === i);
            });
        });
    });
}

function hideCustomerAcList() {
    const listEl = document.getElementById('budgetCustomerResults');
    if (listEl) listEl.hidden = true;
}

function applyCustomerToForm(customer) {
    if (!customer) return;
    selectedBudgetCustomerId = String(customer.id || '');
    const idEl = document.getElementById('budgetCustomerId');
    const nameEl = document.getElementById('budgetCustomerName');
    const phoneEl = document.getElementById('budgetCustomerPhone');
    const emailEl = document.getElementById('budgetCustomerEmail');
    const searchEl = document.getElementById('budgetCustomerSearch');
    const selectedWrap = document.getElementById('budgetCustomerSelected');
    const chipName = document.getElementById('budgetCustomerChipName');
    const crmLink = document.getElementById('budgetCustomerCrmLink');
    const acWrap = document.getElementById('budgetCustomerAcWrap');

    if (idEl) idEl.value = selectedBudgetCustomerId;
    if (nameEl) nameEl.value = String(customer.name || '');
    if (phoneEl) phoneEl.value = String(customer.phone || '');
    if (emailEl) emailEl.value = String(customer.email || '');
    if (searchEl) searchEl.value = '';
    if (chipName) chipName.textContent = String(customer.name || 'Cliente');
    if (crmLink) crmLink.href = `/clients?client=${encodeURIComponent(selectedBudgetCustomerId)}`;
    if (selectedWrap) selectedWrap.hidden = false;
    if (acWrap) acWrap.style.display = 'none';
    hideCustomerAcList();
}

function clearSelectedCustomer() {
    selectedBudgetCustomerId = '';
    const idEl = document.getElementById('budgetCustomerId');
    const searchEl = document.getElementById('budgetCustomerSearch');
    const selectedWrap = document.getElementById('budgetCustomerSelected');
    const acWrap = document.getElementById('budgetCustomerAcWrap');
    if (idEl) idEl.value = '';
    if (searchEl) searchEl.value = '';
    if (selectedWrap) selectedWrap.hidden = true;
    if (acWrap) acWrap.style.display = '';
}

function selectCustomerFromAc(customerId) {
    const c = customerList().find((row) => String(row.id) === String(customerId));
    if (!c) {
        showToast('Cliente não encontrado.', 'error');
        return;
    }
    applyCustomerToForm(c);
    showToast(`Cliente ${c.name} vinculado ao orçamento.`, 'success');
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
    const search = document.getElementById('budgetProductSearch');
    const term = search?.value?.trim() || '';
    if (selectedBudgetProductId) {
        selectProductFromAc(selectedBudgetProductId);
        return;
    }
    const byCode = findProductByCode(term);
    if (byCode) {
        selectProductFromAc(byCode.id);
        return;
    }
    const matches = filterProducts(term);
    if (matches.length === 1) {
        selectProductFromAc(matches[0].id);
        return;
    }
    if (matches.length > 1) {
        renderProductAcList(term);
        showToast('Selecione o produto na lista.', 'info');
        return;
    }
    showToast('Busque e selecione um produto.', 'info');
}

function payloadFromDraft(status) {
    const totals = budgetTotals();
    return {
        customerId: String(document.getElementById('budgetCustomerId')?.value || selectedBudgetCustomerId || '').trim(),
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

function budgetsForCustomer(customer) {
    if (!customer) return [];
    const budgets = asArray(window.appData?.budgets);
    const cid = String(customer.id || '').trim();
    const nameKey = String(customer.name || '').trim().toLowerCase();
    return budgets.filter((b) => {
        if (cid && String(b.customerId || '').trim() === cid) return true;
        if (!b.customerId && nameKey && String(b.customerName || '').trim().toLowerCase() === nameKey) return true;
        return false;
    }).sort((a, b) => String(b.code || '').localeCompare(String(a.code || '')));
}

function renderSavedBudgets() {
    const search = String(document.getElementById('budgetSearchInput')?.value || '').trim().toLowerCase();
    const draftGrid = document.getElementById('budgetsDraftGrid');
    const finalGrid = document.getElementById('budgetsFinalGrid');
    if (!draftGrid || !finalGrid) return;
    const list = asArray(window.appData?.budgets).filter((budget) => {
        if (!search) return true;
        return String(budget.code || '').toLowerCase().includes(search) ||
            String(budget.customerName || '').toLowerCase().includes(search);
    });
    const drafts = list.filter((b) => String(b.status || 'draft') !== 'finalized');
    const finalized = list.filter((b) => String(b.status || '') === 'finalized');

    const renderCards = (budgets, allowFinalize) => budgets
        .slice()
        .sort((a, b) => String(b.code || '').localeCompare(String(a.code || '')))
        .map((budget) => {
            const bid = String(budget.id || '').trim();
            const crmBtn = budget.customerId
                ? `<a class="btn btn-ghost btn-sm" href="/clients?client=${encodeURIComponent(String(budget.customerId))}">CRM</a>`
                : '';
            return `
            <div class="budget-card-item" data-budget-id="${escapeHtml(bid)}">
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
                    ${crmBtn}
                    <button class="btn btn-ghost btn-sm" type="button" data-budget-action="template" data-budget-id="${escapeHtml(bid)}">Template</button>
                    ${allowFinalize ? `<button class="btn btn-ghost btn-sm" type="button" data-budget-action="edit" data-budget-id="${escapeHtml(bid)}">Editar</button>` : ''}
                    ${allowFinalize ? `<button class="btn btn-ghost btn-sm text-danger-btn" type="button" data-budget-action="delete" data-budget-id="${escapeHtml(bid)}">Excluir</button>` : ''}
                    ${allowFinalize ? `<button class="btn btn-primary btn-sm" type="button" data-budget-action="finalize" data-budget-id="${escapeHtml(bid)}">Finalizar</button>` : ''}
                </div>
            </div>`;
        }).join('');

    draftGrid.innerHTML = drafts.length
        ? renderCards(drafts, true)
        : '<div class="empty-state" style="padding:24px;"><div class="empty-icon">📝</div><p>Nenhum orçamento salvo.</p></div>';
    finalGrid.innerHTML = finalized.length
        ? renderCards(finalized, false)
        : '<div class="empty-state" style="padding:24px;"><div class="empty-icon">✅</div><p>Nenhum orçamento finalizado.</p></div>';
}

function upsertCustomerInAppData(customer) {
    if (!customer || !customer.id) return;
    if (!Array.isArray(window.appData.customers)) window.appData.customers = [];
    const idx = window.appData.customers.findIndex((c) => String(c.id) === String(customer.id));
    if (idx >= 0) window.appData.customers[idx] = customer;
    else window.appData.customers.unshift(customer);
}

function applyBudgetSaveResponse(data, { wasEdit, status }) {
    window.appData.budgets = asArray(window.appData.budgets);
    if (wasEdit) {
        window.appData.budgets = window.appData.budgets.map((b) =>
            String(b.id) === String(data.budget.id) ? data.budget : b
        );
    } else {
        window.appData.budgets.unshift(data.budget);
    }
    if (data.cashFlowEntry) {
        if (!Array.isArray(window.appData.cashFlowEntries)) window.appData.cashFlowEntries = [];
        window.appData.cashFlowEntries.unshift(data.cashFlowEntry);
    }
    if (data.customerCreated && data.customer) {
        upsertCustomerInAppData(data.customer);
        showToast(`Cliente "${data.customer.name}" cadastrado no CRM.`, 'success');
    }
    renderSavedBudgets();
    const msg = wasEdit
        ? 'Orçamento atualizado!'
        : (status === 'finalized' ? 'Orçamento finalizado!' : 'Orçamento salvo!');
    showToast(msg, 'success');
    if (status === 'finalized') showNotificationStatus(data.notifications);
    openTemplateModal(data.budget);
}

async function saveBudget(status) {
    const payload = payloadFromDraft(status);
    if (payload.items.length === 0) {
        showToast('Adicione ao menos um item ao orçamento.', 'error');
        return false;
    }
    const wasEdit = Boolean(editingBudgetId);
    const url = wasEdit
        ? `/api/budgets/${encodeURIComponent(editingBudgetId)}`
        : '/api/budgets';
    const method = wasEdit ? 'PATCH' : 'POST';

    try {
        const res = await fetch(url, {
            method,
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify(payload)
        });
        const data = await parseJsonResponse(res);
        if (!res.ok || data.error) {
            showToast(data.message || 'Erro ao salvar orçamento.', 'error');
            return false;
        }
        if (!data.budget?.id) {
            showToast('Resposta inválida ao salvar orçamento.', 'error');
            return false;
        }
        editingBudgetId = '';
        applyBudgetSaveResponse(data, { wasEdit, status });
        return true;
    } catch (e) {
        console.error(e);
        showToast('Erro ao salvar orçamento.', 'error');
        return false;
    }
}

async function deleteBudgetById(id) {
    const budget = asArray(window.appData?.budgets).find((b) => String(b.id) === String(id));
    if (!budget) return;
    if (String(budget.status || '') === 'finalized') {
        showToast('Orçamentos finalizados não podem ser excluídos.', 'error');
        return;
    }
    const label = budget.code || 'este orçamento';
    if (!confirm(`Excluir ${label} permanentemente?`)) return;

    try {
        const res = await fetch(`/api/budgets/${encodeURIComponent(id)}`, {
            method: 'DELETE',
            credentials: 'same-origin'
        });
        const data = await parseJsonResponse(res);
        if (!res.ok || data.error) {
            showToast(data.message || 'Erro ao excluir orçamento.', 'error');
            return;
        }
        window.appData.budgets = asArray(window.appData.budgets).filter((b) => String(b.id) !== String(id));
        if (Array.isArray(window.appData.cashFlowEntries)) {
            window.appData.cashFlowEntries = window.appData.cashFlowEntries.filter(
                (e) => String(e.budgetId || '') !== String(id)
            );
        }
        if (editingBudgetId === id) editingBudgetId = '';
        renderSavedBudgets();
        showToast(data.message || 'Orçamento excluído.', 'success');
    } catch (e) {
        console.error(e);
        showToast('Erro ao excluir orçamento.', 'error');
    }
}

function openEditBudgetById(id) {
    const budget = asArray(window.appData?.budgets).find((b) => String(b.id) === String(id));
    if (!budget) return;
    if (String(budget.status || '') === 'finalized') {
        showToast('Orçamentos finalizados não podem ser editados.', 'error');
        return;
    }
    openEditBudgetModal(budget);
}

function openEditBudgetModal(budget) {
    editingBudgetId = String(budget.id || '');
    budgetItemsDraft = asArray(budget.items).map((item) => ({
        kind: item.kind === 'product' ? 'product' : 'custom',
        productId: String(item.productId || ''),
        sku: String(item.sku || ''),
        name: String(item.name || ''),
        qty: asNumber(item.qty),
        unitPrice: asNumber(item.unitPrice),
        unitCost: asNumber(item.unitCost)
    }));

    const titleEl = document.getElementById('budgetCreateModalTitle');
    if (titleEl) titleEl.textContent = `Editar orçamento · ${budget.code || ''}`;

    const discountInput = document.getElementById('budgetDiscountInput');
    const extraInput = document.getElementById('budgetExtraInput');
    const date = document.getElementById('budgetdate');
    const notes = document.getElementById('budgetNotes');
    const productSearch = document.getElementById('budgetProductSearch');

    if (discountInput) discountInput.value = String(asNumber(budget.discount));
    if (extraInput) extraInput.value = String(asNumber(budget.extra));
    if (date) date.value = String(budget.validUntil || '').slice(0, 10);
    if (notes) notes.value = String(budget.notes || '');
    if (productSearch) productSearch.value = '';

    if (budget.customerId) {
        const c = customerList().find((row) => String(row.id) === String(budget.customerId));
        if (c) {
            applyCustomerToForm(c);
        } else {
            clearSelectedCustomer();
            const nameEl = document.getElementById('budgetCustomerName');
            const phoneEl = document.getElementById('budgetCustomerPhone');
            const emailEl = document.getElementById('budgetCustomerEmail');
            if (nameEl) nameEl.value = String(budget.customerName || '');
            if (phoneEl) phoneEl.value = String(budget.customerPhone || '');
            if (emailEl) emailEl.value = String(budget.customerEmail || '');
            if (document.getElementById('budgetCustomerId')) {
                document.getElementById('budgetCustomerId').value = String(budget.customerId);
            }
        }
    } else {
        clearSelectedCustomer();
        const nameEl = document.getElementById('budgetCustomerName');
        const phoneEl = document.getElementById('budgetCustomerPhone');
        const emailEl = document.getElementById('budgetCustomerEmail');
        if (nameEl) nameEl.value = String(budget.customerName || '');
        if (phoneEl) phoneEl.value = String(budget.customerPhone || '');
        if (emailEl) emailEl.value = String(budget.customerEmail || '');
    }

    renderDraftItems();
    const createModal = document.getElementById('budgetCreateModal');
    if (createModal) createModal.classList.add('open');
}

async function finalizeById(id) {
    try {
        const res = await fetch(`/api/budgets/${encodeURIComponent(id)}/finalize`, {
            method: 'PATCH',
            credentials: 'same-origin'
        });
        const data = await parseJsonResponse(res);
        if (!res.ok || data.error) {
            showToast(data.message || 'Erro ao finalizar orçamento.', 'error');
            return;
        }
        if (!data.budget?.id) {
            showToast('Resposta inválida ao finalizar orçamento.', 'error');
            return;
        }
        window.appData.budgets = asArray(window.appData.budgets).map((item) =>
            String(item.id) === String(data.budget.id) ? data.budget : item
        );
        if (data.cashFlowEntry) {
            if (!Array.isArray(window.appData.cashFlowEntries)) window.appData.cashFlowEntries = [];
            const exists = window.appData.cashFlowEntries.some((e) => String(e.id) === String(data.cashFlowEntry.id));
            if (!exists) window.appData.cashFlowEntries.unshift(data.cashFlowEntry);
        }
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

function moveAcIndex(listEl, delta) {
    const items = listEl ? [...listEl.querySelectorAll('.budget-ac-item')] : [];
    if (!items.length) return -1;
    let idx = budgetProductAcIndex;
    if (listEl.id === 'budgetCustomerResults') idx = budgetCustomerAcIndex;
    idx = (idx + delta + items.length) % items.length;
    items.forEach((el, i) => el.classList.toggle('is-active', i === idx));
    if (listEl.id === 'budgetCustomerResults') budgetCustomerAcIndex = idx;
    else budgetProductAcIndex = idx;
    return idx;
}

function bindProductSearch() {
    const input = document.getElementById('budgetProductSearch');
    const listEl = document.getElementById('budgetProductResults');
    if (!input) return;

    input.addEventListener('input', () => renderProductAcList(input.value));
    input.addEventListener('focus', () => renderProductAcList(input.value));
    input.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            if (listEl && !listEl.hidden) moveAcIndex(listEl, 1);
            else renderProductAcList(input.value);
            return;
        }
        if (e.key === 'ArrowUp') {
            e.preventDefault();
            if (listEl && !listEl.hidden) moveAcIndex(listEl, -1);
            return;
        }
        if (e.key === 'Enter') {
            e.preventDefault();
            if (listEl && !listEl.hidden && budgetProductAcIndex >= 0) {
                const btn = listEl.querySelectorAll('.budget-ac-item')[budgetProductAcIndex];
                if (btn) selectProductFromAc(btn.getAttribute('data-product-id'));
            } else {
                addProductItem();
            }
            return;
        }
        if (e.key === 'Escape') hideProductAcList();
    });
}

function bindCustomerSearch() {
    const input = document.getElementById('budgetCustomerSearch');
    const listEl = document.getElementById('budgetCustomerResults');
    const clearBtn = document.getElementById('budgetCustomerClearBtn');
    if (!input) return;

    input.addEventListener('input', () => renderCustomerAcList(input.value));
    input.addEventListener('focus', () => renderCustomerAcList(input.value));
    input.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            if (listEl && !listEl.hidden) moveAcIndex(listEl, 1);
            else renderCustomerAcList(input.value);
            return;
        }
        if (e.key === 'ArrowUp') {
            e.preventDefault();
            if (listEl && !listEl.hidden) moveAcIndex(listEl, -1);
            return;
        }
        if (e.key === 'Enter') {
            e.preventDefault();
            if (listEl && !listEl.hidden && budgetCustomerAcIndex >= 0) {
                const btn = listEl.querySelectorAll('.budget-ac-item')[budgetCustomerAcIndex];
                if (btn) selectCustomerFromAc(btn.getAttribute('data-customer-id'));
            }
            return;
        }
        if (e.key === 'Escape') hideCustomerAcList();
    });

    if (clearBtn) clearBtn.addEventListener('click', clearSelectedCustomer);
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
        editingBudgetId = '';
        if (createModal) createModal.classList.remove('open');
        hideProductAcList();
        hideCustomerAcList();
    };

    const openCreateModal = () => {
        editingBudgetId = '';
        const titleEl = document.getElementById('budgetCreateModalTitle');
        if (titleEl) titleEl.textContent = 'Criar orçamento';
        budgetItemsDraft = [];
        clearSelectedCustomer();
        const customerName = document.getElementById('budgetCustomerName');
        const customerPhone = document.getElementById('budgetCustomerPhone');
        const customerEmail = document.getElementById('budgetCustomerEmail');
        const date = document.getElementById('budgetdate');
        const notes = document.getElementById('budgetNotes');
        const discountInputReset = document.getElementById('budgetDiscountInput');
        const extraInputReset = document.getElementById('budgetExtraInput');
        const productSearch = document.getElementById('budgetProductSearch');
        if (customerName) customerName.value = '';
        if (customerPhone) customerPhone.value = '';
        if (customerEmail) customerEmail.value = '';
        if (date) date.value = new Date().toISOString().slice(0, 10);
        if (notes) notes.value = '';
        if (discountInputReset) discountInputReset.value = '0';
        if (extraInputReset) extraInputReset.value = '0';
        if (productSearch) productSearch.value = '';
        renderDraftItems();
        if (createModal) createModal.classList.add('open');
        setTimeout(() => document.getElementById('budgetCustomerSearch')?.focus(), 80);
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

    const onBudgetCardClick = (e) => {
        const btn = e.target.closest('[data-budget-action]');
        if (!btn) return;
        const id = String(btn.getAttribute('data-budget-id') || '').trim();
        const action = String(btn.getAttribute('data-budget-action') || '').trim();
        if (!id) return;
        if (action === 'template') openTemplateById(id);
        else if (action === 'edit') openEditBudgetById(id);
        else if (action === 'delete') deleteBudgetById(id);
        else if (action === 'finalize') finalizeById(id);
    };
    document.getElementById('budgetsDraftGrid')?.addEventListener('click', onBudgetCardClick);
    document.getElementById('budgetsFinalGrid')?.addEventListener('click', onBudgetCardClick);
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

    bindProductSearch();
    bindCustomerSearch();

    document.addEventListener('click', (e) => {
        const pWrap = document.getElementById('budgetProductAcWrap');
        const cWrap = document.getElementById('budgetCustomerAcWrap');
        if (pWrap && !pWrap.contains(e.target)) hideProductAcList();
        if (cWrap && !cWrap.contains(e.target)) hideCustomerAcList();
    });
}

async function ensureBudgetCustomers() {
    window.appData = window.appData || {};
    if (Array.isArray(window.appData.customers) && window.appData.customers.length) return;
    try {
        const res = await fetch('/api/customers', { credentials: 'same-origin' });
        const data = await res.json();
        if (!res.ok || data.error) return;
        window.appData.customers = asArray(data.customers);
    } catch (e) {
        console.error(e);
    }
}

function openCreateModalWithOptionalCustomer(customerId) {
    const openCreateBtn = document.getElementById('openCreateBudgetModalBtn');
    if (openCreateBtn) openCreateBtn.click();
    if (!customerId) return;
    const c = customerList().find((row) => String(row.id) === String(customerId));
    if (c) applyCustomerToForm(c);
}

function initBudgetsPage() {
    updateTopbarTitle('Orçamentos');
    markNavActive('/budgets');
    ensureBudgetCustomers().then(() => {
        renderDraftItems();
        renderSavedBudgets();
        bindEvents();

        const params = new URLSearchParams(window.location.search);
        const preCustomer = params.get('customer');
        if (preCustomer) openCreateModalWithOptionalCustomer(preCustomer);
    });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initBudgetsPage);
} else {
    initBudgetsPage();
}
