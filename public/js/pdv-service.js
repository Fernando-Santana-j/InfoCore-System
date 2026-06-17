/**
 * Modal de ordem de serviço no PDV (caixa).
 */
let svcIntakeStep = 1;
let svcChecklistState = [];
let svcCustomerAcIndex = -1;
let svcSelectedCustomerId = '';
const svcPendingPhotos = new Map();
/** IDs dos templates aplicados, na ordem em que foram clicados. */
const svcAppliedTemplateOrder = [];
let svcBudgetItemsDraft = [];
let svcBudgetSeeded = false;
let svcSelectedBudgetProductId = '';
let svcBudgetProductAcIndex = -1;

const SVC_NEXT_LABEL = 'Próximo →';
const SVC_SUBMIT_LABEL = '✓ Finalizar ordem de serviço';

function svcEsc(s) {
    return String(s || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function svcCustomers() {
    const list = window.appData?.customers;
    if (Array.isArray(list)) return list;
    if (list && typeof list === 'object') return Object.values(list);
    return [];
}

function svcBuildTemplate(deviceType) {
    const tpl = window.appData?.serviceChecklistTemplates;
    if (!tpl?.base || !tpl?.byDevice) return [];
    const keys = tpl.byDevice[deviceType] || tpl.byDevice.Outro || [];
    const map = new Map(tpl.base.map((i) => [i.key, i]));
    return keys.map((key) => {
        const b = map.get(key);
        if (!b) return null;
        return { key: b.key, label: b.label, icon: b.icon || '🔧' };
    }).filter(Boolean);
}

function svcResetChecklist(deviceType) {
    svcChecklistState = svcBuildTemplate(deviceType).map((item) => ({
        ...item,
        defective: false,
        customerNote: '',
        estimatedPrice: '',
        photos: []
    }));
    svcPendingPhotos.clear();
}

function svcFilterCustomers(term) {
    const q = String(term || '').trim().toLowerCase();
    let list = svcCustomers().slice();
    if (!q) return list.slice(0, 20);
    return list.filter((c) =>
        String(c.name || '').toLowerCase().includes(q) ||
        String(c.phone || '').includes(q) ||
        String(c.email || '').toLowerCase().includes(q)
    ).slice(0, 20);
}

function svcRenderCustomerAc(term) {
    const listEl = document.getElementById('svcCustomerResults');
    if (!listEl) return;
    const matches = svcFilterCustomers(term);
    svcCustomerAcIndex = matches.length ? 0 : -1;
    if (!matches.length) {
        listEl.innerHTML = '<div class="budget-ac-empty">Nenhum cliente. Preencha o nome manualmente.</div>';
        listEl.hidden = false;
        return;
    }
    listEl.innerHTML = matches.map((c, i) => `
        <button type="button" class="budget-ac-item${i === svcCustomerAcIndex ? ' is-active' : ''}" data-id="${svcEsc(c.id)}">
            <span class="budget-ac-item-title">${svcEsc(c.name)}</span>
            <span class="budget-ac-item-meta">${svcEsc([c.phone, c.email].filter(Boolean).join(' · ') || '—')}</span>
        </button>
    `).join('');
    listEl.hidden = false;
    listEl.querySelectorAll('.budget-ac-item').forEach((btn) => {
        btn.addEventListener('mousedown', (e) => {
            e.preventDefault();
            svcSelectCustomer(btn.getAttribute('data-id'));
        });
    });
}

function svcSelectCustomer(id) {
    const c = svcCustomers().find((row) => String(row.id) === String(id));
    if (!c) return;
    svcSelectedCustomerId = String(c.id);
    document.getElementById('svcCustomerId').value = svcSelectedCustomerId;
    document.getElementById('svcCustomerName').value = c.name || '';
    document.getElementById('svcCustomerPhone').value = c.phone || '';
    document.getElementById('svcCustomerEmail').value = c.email || '';
    const chip = document.getElementById('svcCustomerChipName');
    if (chip) chip.textContent = c.name || '';
    document.getElementById('svcCustomerSelected')?.removeAttribute('hidden');
    document.getElementById('svcCustomerResults').hidden = true;
    const search = document.getElementById('svcCustomerSearch');
    if (search) search.value = '';
}

function svcClearCustomer() {
    svcSelectedCustomerId = '';
    document.getElementById('svcCustomerId').value = '';
    document.getElementById('svcCustomerSelected')?.setAttribute('hidden', '');
}

async function svcRefreshWorkTemplates() {
    try {
        const res = await fetch('/api/service-work-templates?active=1', { credentials: 'same-origin' });
        const data = await res.json().catch(() => ({}));
        if (res.ok && !data.error && Array.isArray(data.templates)) {
            window.appData.serviceWorkTemplates = data.templates;
        }
    } catch (e) {
        console.warn('svcRefreshWorkTemplates', e);
    }
}

function svcWorkTemplates() {
    const list = window.appData?.serviceWorkTemplates;
    return Array.isArray(list) ? list.filter((t) => t.active !== false) : [];
}

function svcTemplateMatchesDevice(tpl, deviceType) {
    const types = tpl.deviceTypes || [];
    if (!types.length) return true;
    return types.includes(deviceType);
}

function svcTemplateItemKey(tplId, stageKey) {
    return `tpl-${tplId}-${stageKey}`;
}

function svcIsTemplateItemKey(key) {
    return String(key || '').startsWith('tpl-');
}

function svcRemoveWorkTemplate(tplId) {
    const id = String(tplId);
    const idx = svcAppliedTemplateOrder.indexOf(id);
    if (idx < 0) return;
    svcAppliedTemplateOrder.splice(idx, 1);
    svcChecklistState = svcChecklistState.filter((item) => !String(item.key).startsWith(`tpl-${id}-`));
    svcRebuildChecklistOrder();
}

function svcRebuildChecklistOrder() {
    const byKey = new Map(svcChecklistState.map((item) => [String(item.key), item]));
    const deviceType = String(document.getElementById('svcDeviceType')?.value || 'Celular');
    const baseKeys = svcBuildTemplate(deviceType).map((b) => b.key);
    const ordered = [];

    for (const tplId of svcAppliedTemplateOrder) {
        const tpl = svcWorkTemplates().find((t) => String(t.id) === String(tplId));
        if (!tpl?.stages?.length) continue;
        for (const stage of tpl.stages) {
            const item = byKey.get(svcTemplateItemKey(tplId, stage.key));
            if (item) ordered.push(item);
        }
    }

    for (const key of baseKeys) {
        const item = byKey.get(key);
        if (item && !svcIsTemplateItemKey(item.key)) ordered.push(item);
    }

    const placed = new Set(ordered.map((i) => String(i.key)));
    for (const item of svcChecklistState) {
        if (!placed.has(String(item.key))) ordered.push(item);
    }
    svcChecklistState = ordered;
}

function svcApplyWorkTemplate(tpl) {
    if (!tpl?.id || !tpl.stages?.length) return;
    const id = String(tpl.id);
    const deviceType = String(document.getElementById('svcDeviceType')?.value || 'Celular');
    if (!svcTemplateMatchesDevice(tpl, deviceType)) {
        showToast('Template não disponível para este tipo de aparelho.', 'error');
        return;
    }
    if (svcAppliedTemplateOrder.includes(id)) {
        svcRemoveWorkTemplate(id);
        svcRenderChecklist();
        svcRenderWorkTemplatesPicker();
        svcRenderAppliedTemplatesSequence();
        showToast(`"${tpl.name}" removido da sequência.`, 'info');
        return;
    }
    for (const stage of tpl.stages) {
        const key = svcTemplateItemKey(id, stage.key);
        const existing = svcChecklistState.find((i) => String(i.key) === key);
        if (existing) {
            existing.defective = true;
            if (stage.defaultNote && !existing.customerNote) existing.customerNote = stage.defaultNote;
            continue;
        }
        svcChecklistState.push({
            key,
            label: stage.label,
            icon: stage.icon || '🔧',
            defective: true,
            customerNote: stage.defaultNote || '',
            estimatedPrice: '',
            photos: [],
            templateId: id,
            templateName: tpl.name
        });
    }
    svcAppliedTemplateOrder.push(id);
    svcRebuildChecklistOrder();
    svcRenderChecklist();
    svcRenderWorkTemplatesPicker();
    svcRenderAppliedTemplatesSequence();
    const orderNum = svcAppliedTemplateOrder.length;
    showToast(`"${tpl.name}" adicionado (${orderNum}º na sequência).`, 'success');
}

function svcRenderAppliedTemplatesSequence() {
    const el = document.getElementById('svcAppliedTemplatesSequence');
    if (!el) return;
    if (!svcAppliedTemplateOrder.length) {
        el.hidden = true;
        el.innerHTML = '';
        return;
    }
    el.hidden = false;
    el.innerHTML = `
        <p class="pdv-svc-templates-seq-label">Sequência de templates (ordem de execução)</p>
        <div class="pdv-svc-templates-seq">
            ${svcAppliedTemplateOrder.map((tplId, i) => {
                const tpl = svcWorkTemplates().find((t) => String(t.id) === String(tplId));
                if (!tpl) return '';
                return `
                    <span class="pdv-svc-seq-chip">
                        <span class="pdv-svc-seq-num">${i + 1}</span>
                        <span>${svcEsc(tpl.icon || '🔧')} ${svcEsc(tpl.name)}</span>
                        <button type="button" class="pdv-svc-seq-rm" data-tpl-id="${svcEsc(tplId)}" title="Remover">✕</button>
                    </span>
                `;
            }).join('')}
        </div>
    `;
    el.querySelectorAll('.pdv-svc-seq-rm').forEach((btn) => {
        btn.addEventListener('click', () => {
            const tplId = btn.getAttribute('data-tpl-id');
            const tpl = svcWorkTemplates().find((t) => String(t.id) === String(tplId));
            if (tpl) svcApplyWorkTemplate(tpl);
        });
    });
}

function svcRenderWorkTemplatesPicker() {
    const grid = document.getElementById('svcWorkTemplatesGrid');
    const wrap = document.getElementById('svcWorkTemplatesPicker');
    if (!grid || !wrap) return;
    const deviceType = String(document.getElementById('svcDeviceType')?.value || 'Celular');
    const templates = svcWorkTemplates().filter((t) => svcTemplateMatchesDevice(t, deviceType));
    if (!templates.length) {
        wrap.hidden = true;
        return;
    }
    wrap.hidden = false;
    grid.innerHTML = templates.map((t) => {
        const orderIdx = svcAppliedTemplateOrder.indexOf(String(t.id));
        const applied = orderIdx >= 0;
        return `
            <button type="button" class="pdv-svc-tpl-card ${applied ? 'is-applied' : ''}" data-tpl-id="${svcEsc(t.id)}" title="${applied ? 'Clique para remover da sequência' : 'Clique para adicionar à sequência'}">
                ${applied ? `<span class="pdv-svc-tpl-order">${orderIdx + 1}</span>` : ''}
                <span class="pdv-svc-tpl-icon">${svcEsc(t.icon || '🔧')}</span>
                <span class="pdv-svc-tpl-name">${svcEsc(t.name)}</span>
                <span class="pdv-svc-tpl-meta">${(t.stages || []).length} etapas</span>
            </button>
        `;
    }).join('');
    grid.querySelectorAll('.pdv-svc-tpl-card').forEach((btn) => {
        btn.addEventListener('click', () => {
            const id = btn.getAttribute('data-tpl-id');
            const tpl = svcWorkTemplates().find((t) => String(t.id) === String(id));
            if (tpl) svcApplyWorkTemplate(tpl);
        });
    });
}

function svcUpdateDefectCount() {
    const count = svcChecklistState.filter((i) => i.defective).length;
    const badge = document.getElementById('svcDefectCount');
    if (!badge) return;
    const label = count === 1 ? '1 marcado' : `${count} marcados`;
    badge.textContent = label;
    badge.classList.toggle('has-defects', count > 0);
}

function svcRenderChecklist() {
    const grid = document.getElementById('svcChecklistGrid');
    if (!grid) return;
    grid.innerHTML = svcChecklistState.map((item, index) => {
        const defective = item.defective ? 'is-defective' : '';
        const files = svcPendingPhotos.get(item.key) || [];
        return `
            <div class="pdv-svc-check-item ${defective}" data-index="${index}">
                <button type="button" class="pdv-svc-check-toggle" data-index="${index}">
                    <span class="pdv-svc-check-box" aria-hidden="true">${item.defective ? '✓' : ''}</span>
                    <span class="pdv-svc-check-icon">${svcEsc(item.icon)}</span>
                    <span class="pdv-svc-check-text">
                        <span class="pdv-svc-check-label">${svcEsc(item.label)}</span>
                        <span class="pdv-svc-check-hint">${item.defective ? 'Defeito marcado — preencha abaixo' : 'Toque para marcar defeito'}</span>
                    </span>
                </button>
                <div class="pdv-svc-check-detail" ${item.defective ? '' : 'hidden'}>
                    <textarea class="form-input" data-field="note" data-index="${index}" rows="2" placeholder="O que o cliente relatou neste item...">${svcEsc(item.customerNote)}</textarea>
                    <div class="pdv-svc-check-row">
                        <input class="form-input" type="number" min="0" step="0.01" data-field="price" data-index="${index}" placeholder="Ref. R$ (opcional)" value="${item.estimatedPrice !== '' && item.estimatedPrice != null ? item.estimatedPrice : ''}">
                        <label class="btn btn-ghost btn-sm pdv-svc-photo-btn">
                            📷 Fotos
                            <input type="file" accept="image/*" capture="environment" multiple hidden data-photo-index="${index}">
                        </label>
                    </div>
                    ${files.length ? `<div class="pdv-svc-pending-photos">📎 ${files.length} foto(s) selecionada(s)</div>` : ''}
                </div>
            </div>
        `;
    }).join('');
    svcUpdateDefectCount();

    grid.querySelectorAll('.pdv-svc-check-toggle').forEach((btn) => {
        btn.addEventListener('click', () => {
            const idx = Number(btn.getAttribute('data-index'));
            const row = svcChecklistState[idx];
            if (!row) return;
            row.defective = !row.defective;
            svcRenderChecklist();
        });
    });

    grid.querySelectorAll('[data-field="note"]').forEach((el) => {
        el.addEventListener('input', () => {
            const idx = Number(el.getAttribute('data-index'));
            if (svcChecklistState[idx]) svcChecklistState[idx].customerNote = el.value;
        });
    });
    grid.querySelectorAll('[data-field="price"]').forEach((el) => {
        el.addEventListener('input', () => {
            const idx = Number(el.getAttribute('data-index'));
            if (svcChecklistState[idx]) svcChecklistState[idx].estimatedPrice = el.value;
        });
    });
    grid.querySelectorAll('input[data-photo-index]').forEach((input) => {
        input.addEventListener('change', () => {
            const idx = Number(input.getAttribute('data-photo-index'));
            const row = svcChecklistState[idx];
            if (!row) return;
            const files = Array.from(input.files || []);
            svcPendingPhotos.set(row.key, files);
            svcRenderChecklist();
        });
    });
}

const SVC_STEP_LABELS = ['Dados', 'Serviços', 'Orçamento'];
const SVC_TOTAL_STEPS = 3;

function svcAsNumber(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
}

function svcActiveProducts() {
    const list = window.appData?.products;
    const rows = Array.isArray(list) ? list : (list && typeof list === 'object' ? Object.values(list) : []);
    return rows.filter((p) => p.active !== false);
}

function svcBudgetTotals(items = svcBudgetItemsDraft) {
    const subtotal = items.reduce((sum, item) => sum + (svcAsNumber(item.qty) * svcAsNumber(item.unitPrice)), 0);
    const discount = svcAsNumber(document.getElementById('svcBudgetDiscountInput')?.value);
    const extra = svcAsNumber(document.getElementById('svcBudgetExtraInput')?.value);
    const total = Math.max(0, subtotal - discount + extra);
    return { subtotal, discount, extra, total };
}

function svcFilterBudgetProducts(term) {
    const q = String(term || '').trim().toLowerCase();
    let list = svcActiveProducts();
    if (!q) return list.slice(0, 24);
    return list.filter((p) => {
        const name = String(p.name || '').toLowerCase();
        const sku = String(p.sku || '').toLowerCase();
        const cat = String(p.category || '').toLowerCase();
        return name.includes(q) || sku.includes(q) || sku === q || cat.includes(q);
    }).slice(0, 24);
}

function svcHideBudgetProductAc() {
    const listEl = document.getElementById('svcBudgetProductResults');
    if (listEl) listEl.hidden = true;
}

function svcRenderBudgetProductAc(term) {
    const listEl = document.getElementById('svcBudgetProductResults');
    if (!listEl) return;
    const matches = svcFilterBudgetProducts(term);
    svcBudgetProductAcIndex = matches.length ? 0 : -1;
    if (!matches.length) {
        listEl.innerHTML = '<div class="budget-ac-empty">Nenhum produto encontrado.</div>';
        listEl.hidden = false;
        svcSelectedBudgetProductId = '';
        return;
    }
    listEl.innerHTML = matches.map((p, i) => `
        <button type="button" class="budget-ac-item${i === svcBudgetProductAcIndex ? ' is-active' : ''}" data-product-id="${svcEsc(p.id)}">
            <span class="budget-ac-item-title">${svcEsc(p.name)}</span>
            <span class="budget-ac-item-meta">SKU ${svcEsc(p.sku || '—')} · ${formatCurrency(svcAsNumber(p.price))} · Est. ${svcAsNumber(p.qty)}</span>
        </button>
    `).join('');
    listEl.hidden = false;
    listEl.querySelectorAll('.budget-ac-item').forEach((btn, i) => {
        btn.addEventListener('mousedown', (e) => {
            e.preventDefault();
            svcSelectBudgetProduct(btn.getAttribute('data-product-id'));
        });
        btn.addEventListener('mouseenter', () => {
            svcBudgetProductAcIndex = i;
            listEl.querySelectorAll('.budget-ac-item').forEach((el, j) => {
                el.classList.toggle('is-active', j === i);
            });
        });
    });
    svcSelectedBudgetProductId = String(matches[0]?.id || '');
}

function svcSelectBudgetProduct(productId) {
    const id = String(productId || '').trim();
    if (!id) return;
    const p = svcActiveProducts().find((row) => String(row.id) === id);
    if (!p) return;
    const existing = svcBudgetItemsDraft.find((item) => item.kind === 'product' && String(item.productId) === id);
    if (existing) {
        existing.qty = svcAsNumber(existing.qty) + 1;
    } else {
        svcBudgetItemsDraft.push({
            kind: 'product',
            productId: String(p.id),
            sku: String(p.sku || ''),
            name: String(p.name || 'Produto'),
            qty: 1,
            unitPrice: svcAsNumber(p.price)
        });
    }
    const search = document.getElementById('svcBudgetProductSearch');
    if (search) search.value = '';
    svcSelectedBudgetProductId = '';
    svcBudgetProductAcIndex = -1;
    svcHideBudgetProductAc();
    svcRenderBudgetItems();
    showToast(`${p.name} adicionado ao orçamento.`, 'success');
}

function svcRenderBudgetItems() {
    const list = document.getElementById('svcBudgetItemsList');
    if (!list) return;
    if (!svcBudgetItemsDraft.length) {
        list.innerHTML = '<div class="empty-state" style="padding:20px;"><div class="empty-icon">🧾</div><p>Nenhum item no orçamento.</p></div>';
    } else {
        list.innerHTML = svcBudgetItemsDraft.map((item, index) => `
            <div class="budget-items-row" data-budget-index="${index}">
                <input class="form-input" data-budget-field="name" value="${svcEsc(item.name)}">
                <input class="form-input" type="number" min="1" step="1" data-budget-field="qty" value="${svcAsNumber(item.qty)}">
                <input class="form-input" type="number" min="0" step="0.01" data-budget-field="unitPrice" value="${svcAsNumber(item.unitPrice)}">
                <span class="budget-items-total">${formatCurrency(svcAsNumber(item.qty) * svcAsNumber(item.unitPrice))}</span>
                <button class="btn btn-ghost btn-sm" type="button" data-budget-remove="${index}">✕</button>
            </div>
        `).join('');
        list.querySelectorAll('[data-budget-field]').forEach((el) => {
            el.addEventListener('input', () => {
                const row = el.closest('[data-budget-index]');
                const idx = Number(row?.getAttribute('data-budget-index'));
                const item = svcBudgetItemsDraft[idx];
                if (!item) return;
                const field = el.getAttribute('data-budget-field');
                if (field === 'qty' || field === 'unitPrice') item[field] = Math.max(0, svcAsNumber(el.value));
                else item[field] = el.value;
                svcRenderBudgetItems();
            });
        });
        list.querySelectorAll('[data-budget-remove]').forEach((btn) => {
            btn.addEventListener('click', () => {
                const idx = Number(btn.getAttribute('data-budget-remove'));
                svcBudgetItemsDraft.splice(idx, 1);
                svcRenderBudgetItems();
            });
        });
    }
    svcRenderBudgetTotals();
}

function svcRenderBudgetTotals() {
    const totalsEl = document.getElementById('svcBudgetTotalsBox');
    if (!totalsEl) return;
    const totals = svcBudgetTotals();
    totalsEl.innerHTML = `
        <div class="cart-total-row"><span>Subtotal</span><span class="mono">${formatCurrency(totals.subtotal)}</span></div>
        <div class="cart-total-row"><span>Desconto</span><span class="mono">- ${formatCurrency(totals.discount)}</span></div>
        <div class="cart-total-row"><span>Acréscimo</span><span class="mono">+ ${formatCurrency(totals.extra)}</span></div>
        <div class="divider"></div>
        <div class="cart-total-row grand"><span>Total</span><span class="val">${formatCurrency(totals.total)}</span></div>
    `;
}

function svcSeedBudgetFromChecklist() {
    if (svcBudgetItemsDraft.length) return;
    const defects = svcChecklistState.filter((i) => i.defective);
    for (const d of defects) {
        const price = d.estimatedPrice !== '' && d.estimatedPrice != null ? svcAsNumber(d.estimatedPrice) : 0;
        svcBudgetItemsDraft.push({
            kind: 'custom',
            productId: '',
            sku: '',
            name: String(d.label || 'Serviço'),
            qty: 1,
            unitPrice: price
        });
    }
    if (!svcBudgetItemsDraft.length) {
        const deviceType = String(document.getElementById('svcDeviceType')?.value || 'Aparelho');
        const model = String(document.getElementById('svcDeviceBrandModel')?.value || '').trim();
        svcBudgetItemsDraft.push({
            kind: 'custom',
            productId: '',
            sku: '',
            name: `Serviço — ${deviceType}${model ? ` ${model}` : ''}`.trim(),
            qty: 1,
            unitPrice: 0
        });
    }
}

function svcPrepareBudgetStep() {
    if (!svcBudgetSeeded) {
        svcSeedBudgetFromChecklist();
        svcBudgetSeeded = true;
    }
    svcRenderBudgetItems();
}

function svcResetBudgetDraft() {
    svcBudgetItemsDraft = [];
    svcBudgetSeeded = false;
    svcSelectedBudgetProductId = '';
    svcBudgetProductAcIndex = -1;
    const notes = document.getElementById('svcBudgetNotes');
    const validUntil = document.getElementById('svcBudgetValidUntil');
    const discount = document.getElementById('svcBudgetDiscountInput');
    const extra = document.getElementById('svcBudgetExtraInput');
    const productSearch = document.getElementById('svcBudgetProductSearch');
    if (notes) notes.value = '';
    if (validUntil) validUntil.value = '';
    if (discount) discount.value = '0';
    if (extra) extra.value = '0';
    if (productSearch) productSearch.value = '';
    svcHideBudgetProductAc();
    svcRenderBudgetItems();
}

function svcAddCustomBudgetItem() {
    svcBudgetItemsDraft.push({
        kind: 'custom',
        productId: '',
        sku: '',
        name: 'Serviço personalizado',
        qty: 1,
        unitPrice: 0
    });
    svcRenderBudgetItems();
}

function svcAddProductBudgetItem() {
    const search = document.getElementById('svcBudgetProductSearch');
    const term = search?.value?.trim() || '';
    if (svcSelectedBudgetProductId) {
        svcSelectBudgetProduct(svcSelectedBudgetProductId);
        return;
    }
    const lower = term.toLowerCase();
    const byCode = svcActiveProducts().find((p) => String(p.sku || '').trim().toLowerCase() === lower);
    if (byCode) {
        svcSelectBudgetProduct(byCode.id);
        return;
    }
    const matches = svcFilterBudgetProducts(term);
    if (matches.length === 1) {
        svcSelectBudgetProduct(matches[0].id);
        return;
    }
    if (matches.length > 1) {
        svcRenderBudgetProductAc(term);
        showToast('Selecione o produto na lista.', 'info');
        return;
    }
    showToast('Busque e selecione um produto.', 'info');
}

function svcBuildBudgetPayload() {
    const totals = svcBudgetTotals();
    const items = svcBudgetItemsDraft
        .filter((item) => String(item.name || '').trim() && svcAsNumber(item.qty) > 0)
        .map((item) => ({
            kind: item.kind === 'product' ? 'product' : 'custom',
            productId: String(item.productId || ''),
            sku: String(item.sku || ''),
            name: String(item.name || '').trim(),
            qty: svcAsNumber(item.qty),
            unitPrice: svcAsNumber(item.unitPrice)
        }));
    return {
        notes: String(document.getElementById('svcBudgetNotes')?.value || '').trim(),
        validUntil: String(document.getElementById('svcBudgetValidUntil')?.value || '').trim(),
        items,
        discount: totals.discount,
        extra: totals.extra
    };
}

function svcPhoneDigits(raw) {
    return String(raw || '').replace(/\D/g, '');
}

function svcIsValidPhone(raw) {
    const d = svcPhoneDigits(raw);
    return d.length >= 10 && d.length <= 15;
}

function svcRenderReview() {
    const el = document.getElementById('svcReviewSummary');
    if (!el) return;
    const name = String(document.getElementById('svcCustomerName')?.value || '').trim();
    const phone = String(document.getElementById('svcCustomerPhone')?.value || '').trim();
    const email = String(document.getElementById('svcCustomerEmail')?.value || '').trim();
    const deviceType = String(document.getElementById('svcDeviceType')?.value || '');
    const model = String(document.getElementById('svcDeviceBrandModel')?.value || '').trim();
    const accessories = String(document.getElementById('svcAccessories')?.value || '').trim();
    const issue = String(document.getElementById('svcIssueReport')?.value || '').trim();
    const priority = String(document.getElementById('svcPriority')?.value || 'normal');
    const defects = svcChecklistState.filter((i) => i.defective);
    const priLabels = { normal: 'Normal', high: 'Alta', urgent: 'Urgente' };
    const appliedTemplates = svcAppliedTemplateOrder
        .map((id) => svcWorkTemplates().find((t) => String(t.id) === String(id)))
        .filter(Boolean);

    el.innerHTML = `
        <div class="pdv-svc-review-block">
            <h5>Cliente</h5>
            <p><strong>${svcEsc(name || '—')}</strong></p>
            <p>${svcEsc(phone || '—')}${email ? ` · ${svcEsc(email)}` : ''}</p>
        </div>
        <div class="pdv-svc-review-block">
            <h5>Aparelho</h5>
            <p>${svcEsc(deviceType)} · ${svcEsc(model || '—')}</p>
            <p class="pdv-svc-review-meta">Prioridade: ${svcEsc(priLabels[priority] || priority)}${accessories ? ` · Acessórios: ${svcEsc(accessories)}` : ''}</p>
        </div>
        <div class="pdv-svc-review-block">
            <h5>Serviços (${defects.length})</h5>
            ${appliedTemplates.length
        ? `<p class="pdv-svc-review-meta">Templates: ${appliedTemplates.map((t, i) => `${i + 1}. ${svcEsc(t.name)}`).join(' → ')}</p>`
        : ''}
            ${defects.length
        ? `<ul class="pdv-svc-review-list">${defects.map((d) => `<li>${svcEsc(d.icon || '🔧')} ${svcEsc(d.label)}</li>`).join('')}</ul>`
        : '<p class="pdv-svc-review-meta">Nenhum item marcado — usando relato do problema.</p>'}
            ${issue ? `<p class="pdv-svc-review-note">${svcEsc(issue)}</p>` : ''}
        </div>
    `;
}

function svcSetStep(step) {
    svcIntakeStep = Math.max(1, Math.min(SVC_TOTAL_STEPS, step));
    document.querySelectorAll('.pdv-service-step').forEach((el) => {
        const n = Number(el.getAttribute('data-step'));
        el.classList.toggle('is-active', n === svcIntakeStep);
        el.classList.toggle('is-done', n < svcIntakeStep);
    });
    document.querySelectorAll('.pdv-service-pane').forEach((pane) => {
        pane.classList.toggle('is-active', Number(pane.getAttribute('data-pane')) === svcIntakeStep);
    });
    const prev = document.getElementById('svcPrevStepBtn');
    const next = document.getElementById('svcNextStepBtn');
    const cancel = document.getElementById('cancelServiceIntakeBtn');
    const hint = document.getElementById('svcStepHint');
    const isFinal = svcIntakeStep >= SVC_TOTAL_STEPS;

    if (prev) prev.style.visibility = svcIntakeStep === 1 ? 'hidden' : 'visible';
    if (next) {
        next.textContent = isFinal ? SVC_SUBMIT_LABEL : SVC_NEXT_LABEL;
        next.classList.toggle('pdv-service-submit-btn', isFinal);
        next.disabled = false;
    }
    if (cancel) cancel.hidden = isFinal;
    if (hint) {
        hint.textContent = isFinal
            ? 'Revise o orçamento e clique em Finalizar'
            : `Etapa ${svcIntakeStep} de ${SVC_TOTAL_STEPS} — ${SVC_STEP_LABELS[svcIntakeStep - 1]}`;
    }
    if (isFinal) {
        svcRenderReview();
        svcPrepareBudgetStep();
    }
}

async function svcOpenModal() {
    svcIntakeStep = 1;
    svcClearCustomer();
    document.getElementById('svcCustomerName').value = '';
    document.getElementById('svcCustomerPhone').value = '';
    document.getElementById('svcCustomerEmail').value = '';
    document.getElementById('svcDeviceType').value = 'Celular';
    document.getElementById('svcDeviceBrandModel').value = '';
    document.getElementById('svcAccessories').value = '';
    document.getElementById('svcIssueReport').value = '';
    document.getElementById('svcPriority').value = 'normal';
    svcAppliedTemplateOrder.length = 0;
    svcResetBudgetDraft();
    svcResetChecklist('Celular');
    svcRenderChecklist();
    document.getElementById('serviceIntakeModal')?.classList.add('open');
    document.body.style.overflow = 'hidden';
    await svcRefreshWorkTemplates();
    svcRenderWorkTemplatesPicker();
    svcRenderAppliedTemplatesSequence();
    svcSetStep(1);
}

function svcCloseModal() {
    document.getElementById('serviceIntakeModal')?.classList.remove('open');
    document.body.style.overflow = '';
}

function svcValidateStep(step) {
    if (step === 1) {
        const name = String(document.getElementById('svcCustomerName')?.value || '').trim();
        const phone = String(document.getElementById('svcCustomerPhone')?.value || '').trim();
        const model = String(document.getElementById('svcDeviceBrandModel')?.value || '').trim();
        if (!name) {
            showToast('Informe o nome do cliente.', 'error');
            document.getElementById('svcCustomerName')?.focus();
            return false;
        }
        if (!svcIsValidPhone(phone)) {
            showToast('Informe o WhatsApp/telefone (mín. 10 dígitos).', 'error');
            document.getElementById('svcCustomerPhone')?.focus();
            return false;
        }
        if (!model) {
            showToast('Informe marca/modelo do aparelho.', 'error');
            document.getElementById('svcDeviceBrandModel')?.focus();
            return false;
        }
    }
    if (step === 2) {
        const defects = svcChecklistState.filter((i) => i.defective);
        const issue = String(document.getElementById('svcIssueReport')?.value || '').trim();
        if (!defects.length && !issue) {
            showToast('Marque ao menos um serviço ou preencha o relato do problema.', 'error');
            return false;
        }
    }
    if (step === 3) {
        const budget = svcBuildBudgetPayload();
        if (!budget.items.length) {
            showToast('Adicione ao menos um item ao orçamento.', 'error');
            return false;
        }
    }
    return true;
}

async function svcUploadPendingPhotos(serviceId) {
    for (const [key, files] of svcPendingPhotos.entries()) {
        if (!files?.length) continue;
        const form = new FormData();
        files.forEach((f) => form.append('photos', f));
        await fetch(`/api/services/${encodeURIComponent(serviceId)}/checklist/${encodeURIComponent(key)}/photos?phase=intake`, {
            method: 'POST',
            body: form
        });
    }
}

async function svcSubmit() {
    if (!svcValidateStep(1) || !svcValidateStep(2) || !svcValidateStep(3)) {
        if (!svcValidateStep(1)) svcSetStep(1);
        else if (!svcValidateStep(2)) svcSetStep(2);
        else svcSetStep(3);
        return;
    }
    const submitBtn = document.getElementById('svcNextStepBtn');
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Finalizando...';
    }
    svcRebuildChecklistOrder();
    const budget = svcBuildBudgetPayload();
    const totals = svcBudgetTotals();
    const payload = {
        customerId: svcSelectedCustomerId,
        customerName: String(document.getElementById('svcCustomerName')?.value || '').trim(),
        customerPhone: String(document.getElementById('svcCustomerPhone')?.value || '').trim(),
        customerEmail: String(document.getElementById('svcCustomerEmail')?.value || '').trim(),
        deviceType: String(document.getElementById('svcDeviceType')?.value || 'Celular'),
        deviceBrandModel: String(document.getElementById('svcDeviceBrandModel')?.value || '').trim(),
        accessories: String(document.getElementById('svcAccessories')?.value || '').trim(),
        issueReport: String(document.getElementById('svcIssueReport')?.value || '').trim(),
        priority: String(document.getElementById('svcPriority')?.value || 'normal'),
        estimateValue: totals.total > 0 ? totals.total : null,
        budgetRawNotes: budget.notes,
        budget,
        checklist: svcChecklistState.map((item) => ({
            key: item.key,
            label: item.label,
            icon: item.icon,
            defective: item.defective,
            customerNote: item.customerNote,
            estimatedPrice: item.estimatedPrice === '' ? null : item.estimatedPrice
        })),
        applyTemplateIds: svcAppliedTemplateOrder.slice()
    };
    try {
        const res = await fetch('/api/services', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (!res.ok || data.error) {
            showToast(data.message || 'Erro ao registrar OS.', 'error');
            return;
        }
        await svcUploadPendingPhotos(data.service.id);
        if (data.budget?.id) {
            const budgets = Array.isArray(window.appData?.budgets) ? window.appData.budgets : [];
            window.appData.budgets = [data.budget, ...budgets.filter((b) => String(b.id) !== String(data.budget.id))];
        }
        svcCloseModal();
        const isAdmin = String(window.appData?.user?.type || '') === 'admin';
        showToast(`OS ${data.service.code} criada · Orçamento ${data.budget?.code || ''} em rascunho.`, 'success');
        if (isAdmin && data.service?.id) {
            setTimeout(() => {
                if (confirm(`OS ${data.service.code} criada. Abrir na Oficina agora?`)) {
                    window.location.href = `/services?highlight=${encodeURIComponent(data.service.id)}`;
                }
            }, 400);
        }
    } catch (e) {
        console.error(e);
        showToast('Erro de conexão.', 'error');
    } finally {
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = SVC_SUBMIT_LABEL;
        }
    }
}

function bindServiceIntakeModal() {
    document.getElementById('btnOpenServiceIntakeModal')?.addEventListener('click', svcOpenModal);
    document.getElementById('closeServiceIntakeModalBtn')?.addEventListener('click', svcCloseModal);
    document.getElementById('cancelServiceIntakeBtn')?.addEventListener('click', svcCloseModal);
    document.getElementById('svcPrevStepBtn')?.addEventListener('click', () => svcSetStep(svcIntakeStep - 1));
    document.getElementById('svcNextStepBtn')?.addEventListener('click', () => {
        if (svcIntakeStep >= SVC_TOTAL_STEPS) {
            svcSubmit();
            return;
        }
        if (!svcValidateStep(svcIntakeStep)) return;
        svcSetStep(svcIntakeStep + 1);
    });
    document.getElementById('svcDeviceType')?.addEventListener('change', (e) => {
        svcAppliedTemplateOrder.length = 0;
        svcBudgetSeeded = false;
        svcBudgetItemsDraft = [];
        svcResetChecklist(e.target.value);
        svcRenderChecklist();
        svcRenderWorkTemplatesPicker();
        svcRenderAppliedTemplatesSequence();
    });
    document.getElementById('svcBudgetAddProductBtn')?.addEventListener('click', svcAddProductBudgetItem);
    document.getElementById('svcBudgetAddCustomBtn')?.addEventListener('click', svcAddCustomBudgetItem);
    document.getElementById('svcBudgetDiscountInput')?.addEventListener('input', svcRenderBudgetTotals);
    document.getElementById('svcBudgetExtraInput')?.addEventListener('input', svcRenderBudgetTotals);
    document.getElementById('svcBudgetProductSearch')?.addEventListener('input', (e) => svcRenderBudgetProductAc(e.target.value));
    document.getElementById('svcBudgetProductSearch')?.addEventListener('focus', (e) => svcRenderBudgetProductAc(e.target.value));
    document.getElementById('svcCustomerSearch')?.addEventListener('input', (e) => svcRenderCustomerAc(e.target.value));
    document.getElementById('svcCustomerSearch')?.addEventListener('focus', (e) => svcRenderCustomerAc(e.target.value));
    document.getElementById('svcCustomerClearBtn')?.addEventListener('click', svcClearCustomer);
    const modal = document.getElementById('serviceIntakeModal');
    modal?.addEventListener('click', (e) => { if (e.target === modal) svcCloseModal(); });
}

function bootServiceIntake() {
    whenAppReady(() => bindServiceIntakeModal());
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootServiceIntake);
} else {
    bootServiceIntake();
}
