function formatMoneyFromNumber(n) {
    const x = Number(n);
    if (!Number.isFinite(x)) return '';
    return x.toFixed(2).replace('.', ',');
}

function asNumber(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
}

function parseMoneyInput(str) {
    if (str == null || str === '') return NaN;
    let s = String(str).trim().replace(/R\$\s?/i, '');
    if (s.includes(',')) {
        s = s.replace(/\./g, '').replace(',', '.');
    }
    const v = Number(s);
    return Number.isFinite(v) ? v : NaN;
}

function applyMoneyMaskToInput(el) {
    const digits = String(el.value || '').replace(/\D/g, '');
    if (!digits) {
        el.value = '';
        return;
    }
    const v = (parseInt(digits, 10) / 100).toFixed(2).replace('.', ',');
    el.value = v;
    requestAnimationFrame(() => {
        try {
            el.setSelectionRange(v.length, v.length);
        } catch (_) { /* ignore */ }
    });
}

function escapeAttr(s) {
    return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
}

function getCategoryMap() {
    const c = window.appData?.configs;
    if (!c || c.error) return {};
    const cat = c.category;
    return cat && typeof cat === 'object' ? cat : {};
}

function resolveCategoryColor(colorRaw) {
    if (colorRaw == null || colorRaw === '') return '';
    const c = String(colorRaw).trim();
    if (!c) return '';
    if (c.startsWith('var(')) return c;
    if (c.startsWith('--')) return `var(${c})`;
    return c;
}

function stockCategoryLabel(key) {
    const meta = getCategoryMap()[key];
    if (meta && meta.name != null) return String(meta.name);
    return key != null && key !== '' ? String(key) : '';
}

function getAllCategoryKeys() {
    const keys = new Set(Object.keys(getCategoryMap()));
    const products = Array.isArray(window.appData?.products) ? window.appData.products : [];
    products.forEach((p) => {
        const k = String(p?.category || '').trim();
        if (k) keys.add(k);
    });
    if (!keys.size) keys.add('others');
    return [...keys].sort((a, b) =>
        stockCategoryLabel(a).localeCompare(stockCategoryLabel(b), 'pt-BR', { sensitivity: 'base' })
    );
}

function populateCategorySelect(selectEl, selectedKey) {
    if (!selectEl) return;
    const prev = String(selectedKey != null ? selectedKey : selectEl.value || 'others').trim() || 'others';
    const keys = getAllCategoryKeys();
    selectEl.innerHTML = keys.map((k) => {
        const label = stockCategoryLabel(k) || k;
        return `<option value="${escapeAttr(k)}">${escapeHtml(label)}</option>`;
    }).join('');
    if (keys.includes(prev)) {
        selectEl.value = prev;
        return;
    }
    const o = document.createElement('option');
    o.value = prev;
    o.textContent = stockCategoryLabel(prev) || prev;
    selectEl.appendChild(o);
    selectEl.value = prev;
}

function stockCategoryTagHtml(categoryKey) {
    const key = categoryKey != null ? String(categoryKey) : '';
    const label = escapeHtml(stockCategoryLabel(key) || key || '—');
    const meta = getCategoryMap()[key];
    const color = meta ? resolveCategoryColor(meta.color) : '';
    if (color) {
        return `<span class="tag stock-cat-tag" style="border-color:${color};color:${color}">${label}</span>`;
    }
    return `<span class="tag gray">${label}</span>`;
}

function productThumbCell(p) {
    if (p.image) {
        return `<img class="stock-prod-thumb" src="${escapeAttr(p.image)}" alt="" loading="lazy" decoding="async">`;
    }
    return `<span class="stock-prod-thumb stock-prod-thumb--ph" aria-hidden="true">${p.emoji || '📦'}</span>`;
}

function wireMoneyMaskDelegation(root) {
    if (!root || root.dataset.moneyWired) return;
    root.dataset.moneyWired = '1';
    root.addEventListener('input', (e) => {
        if (e.target.classList && e.target.classList.contains('input-money')) {
            applyMoneyMaskToInput(e.target);
        }
    });
}

function wireImagePreview(fileInput, imgEl) {
    if (!fileInput || !imgEl || fileInput.dataset.previewWired) return;
    fileInput.dataset.previewWired = '1';
    fileInput.addEventListener('change', () => {
        const f = fileInput.files && fileInput.files[0];
        if (!f) {
            imgEl.removeAttribute('src');
            imgEl.classList.add('is-empty');
            return;
        }
        imgEl.src = URL.createObjectURL(f);
        imgEl.classList.remove('is-empty');
    });
}

function setPreviewFromUrl(imgEl, url) {
    if (!imgEl) return;
    if (url) {
        imgEl.src = url;
        imgEl.classList.remove('is-empty');
    } else {
        imgEl.removeAttribute('src');
        imgEl.classList.add('is-empty');
    }
}

function wireStockPageActions(api) {
    const page = document.getElementById('page-estoque');
    if (!page || page.dataset.stockActionsWired) return;
    page.dataset.stockActionsWired = '1';
    page.addEventListener('change', (e) => {
        const t = e.target;
        if (t.classList?.contains('stock-qty-input')) {
            const id = t.dataset.productId;
            if (id) api.updateStock(id, t.value);
            return;
        }
        if (t.classList?.contains('stock-price-input')) {
            const id = t.dataset.productId;
            if (id) api.updatePrice(id, t.value);
        }
    });
    page.addEventListener('click', (e) => {
        const btn = e.target.closest?.('.stock-btn-edit, .stock-btn-delete, .stock-btn-duplicate, .stock-btn-toggle');
        if (!btn || !page.contains(btn)) return;
        const id = btn.dataset.productId;
        if (!id) return;
        e.preventDefault();
        if (btn.classList.contains('stock-btn-edit')) api.openEdit(id);
        else if (btn.classList.contains('stock-btn-delete')) api.deleteProduct(id);
        else if (btn.classList.contains('stock-btn-duplicate')) api.duplicateProduct(id);
        else if (btn.classList.contains('stock-btn-toggle')) api.toggleActive(id);
    });
}

function isCatalogService(p) {
    return String(p?.itemType || '').toLowerCase() === 'service';
}

function catalogTypeLabel(p) {
    return isCatalogService(p) ? 'Serviço' : 'Produto';
}

function catalogDisplayCost(p) {
    const labor = asNumber(p?.cost ?? p?.laborCost);
    const parts = asNumber(p?.partsCost);
    if (isCatalogService(p) && parts > 0) {
        return `${formatCurrency(labor + parts)} <span class="text-xs text-muted">(${formatCurrency(labor)} + ${formatCurrency(parts)} peças)</span>`;
    }
    return formatCurrency(labor);
}

function getCatalogItemType(scope) {
    const el = document.querySelector(`input[name="${scope}ItemType"]:checked`);
    return el?.value === 'service' ? 'service' : 'product';
}

function syncCatalogFormType(scope) {
    const isSvc = getCatalogItemType(scope) === 'service';
    document.querySelectorAll(`[data-stock-scope="${scope}"][data-product-only]`).forEach((el) => {
        el.style.display = isSvc ? 'none' : '';
    });
    document.querySelectorAll(`[data-stock-scope="${scope}"][data-service-only]`).forEach((el) => {
        el.style.display = isSvc ? '' : 'none';
    });
    const catEl = document.getElementById(`${scope}Category`);
    if (catEl) populateCategorySelect(catEl, catEl.value);
    const costLabel = document.getElementById(`${scope}CostLabel`);
    if (costLabel) costLabel.textContent = isSvc ? 'Custo mão de obra (R$)' : 'Custo (R$)';
    if (scope === 'new') {
        const title = document.getElementById('catalogCreateTitle');
        const subtitle = document.getElementById('catalogCreateSubtitle');
        const submit = document.getElementById('catalogCreateSubmitBtn');
        const skuLabel = document.getElementById('newSkuLabel');
        const skuHint = document.getElementById('newSkuHint');
        const imageLabel = document.getElementById('newImageLabel');
        if (title) title.textContent = isSvc ? 'Novo serviço' : 'Novo produto';
        if (subtitle) subtitle.textContent = isSvc ? 'Defina duração, mão de obra e materiais. Serviços não movimentam estoque.' : 'Cadastre um item físico com quantidade e estoque mínimo.';
        if (submit) submit.textContent = isSvc ? 'Salvar serviço' : 'Salvar produto';
        if (skuLabel) skuLabel.textContent = isSvc ? 'Código do serviço' : 'SKU / código de barras';
        if (skuHint) skuHint.textContent = isSvc ? 'Gerado automaticamente no formato SRV-0001.' : 'Gerado automaticamente com 8 dígitos para leitura de código de barras.';
        if (imageLabel) imageLabel.textContent = isSvc ? 'Imagem ilustrativa (opcional)' : 'Foto do produto';
    } else {
        const title = document.getElementById('catalogEditTitle');
        if (title) title.textContent = isSvc ? 'Editar serviço' : 'Editar produto';
    }
    updateCatalogCostPreview(scope);
}

function updateCatalogCostPreview(scope) {
    const preview = document.getElementById(`${scope}CostTotalPreview`);
    if (!preview) return;
    const labor = parseMoneyInput(document.getElementById(`${scope}Cost`)?.value || '') || 0;
    const parts = parseMoneyInput(document.getElementById(`${scope}PartsCost`)?.value || '') || 0;
    preview.textContent = formatCurrency(labor + parts);
}

function wireCatalogFormType(scope) {
    document.querySelectorAll(`input[name="${scope}ItemType"]`).forEach((radio) => {
        if (radio.dataset.catalogWired) return;
        radio.dataset.catalogWired = '1';
        radio.addEventListener('change', () => syncCatalogFormType(scope));
    });
    ['Cost', 'PartsCost'].forEach((suffix) => {
        const el = document.getElementById(`${scope}${suffix}`);
        if (!el || el.dataset.catalogWired) return;
        el.dataset.catalogWired = '1';
        el.addEventListener('input', () => updateCatalogCostPreview(scope));
    });
}

let stockTypeFilter = 'todos';
let catalogStatusFilter = 'all';
let catalogCategoryFilter = 'all';
let pendingCatalogConfirm = null;

function syncCatalogFilterControls() {
    document.querySelectorAll('[data-stock-type-filter]').forEach((button) => {
        button.classList.toggle('active', button.dataset.stockTypeFilter === stockTypeFilter);
    });
    const status = document.getElementById('catalogStatusFilter');
    const category = document.getElementById('catalogCategoryFilter');
    if (status) status.value = catalogStatusFilter;
    if (category) category.value = catalogCategoryFilter;
}

function populateCatalogFilters() {
    const category = document.getElementById('catalogCategoryFilter');
    if (category) {
        category.innerHTML = '<option value="all">Todas</option>' + getAllCategoryKeys().map((key) => `<option value="${escapeAttr(key)}">${escapeHtml(stockCategoryLabel(key) || key)}</option>`).join('');
        category.onchange = () => { catalogCategoryFilter = category.value || 'all'; Stock.render(); };
    }
    const status = document.getElementById('catalogStatusFilter');
    if (status) status.onchange = () => { catalogStatusFilter = status.value || 'all'; Stock.render(); };
    syncCatalogFilterControls();
}

function closeCatalogConfirm() {
    pendingCatalogConfirm = null;
    closeModal('catalogConfirm');
}

function openCatalogConfirm({ title, message, confirmText, onConfirm }) {
    pendingCatalogConfirm = typeof onConfirm === 'function' ? onConfirm : null;
    document.getElementById('catalogConfirmTitle').textContent = title || 'Confirmar ação';
    document.getElementById('catalogConfirmMessage').textContent = message || '';
    document.getElementById('confirmCatalogActionBtn').textContent = confirmText || 'Confirmar';
    openModal('catalogConfirm');
}

function bindCatalogConfirm() {
    const close = document.getElementById('closeCatalogConfirmBtn');
    const cancel = document.getElementById('cancelCatalogConfirmBtn');
    const confirmButton = document.getElementById('confirmCatalogActionBtn');
    if (close) close.onclick = closeCatalogConfirm;
    if (cancel) cancel.onclick = closeCatalogConfirm;
    if (confirmButton) confirmButton.onclick = async () => {
        const action = pendingCatalogConfirm;
        pendingCatalogConfirm = null;
        closeModal('catalogConfirm');
        if (action) await action();
    };
}

function setStockTypeFilter(type, btn) {
    stockTypeFilter = type || 'todos';
    syncCatalogFilterControls();
    Stock.filterSearch?.();
}

function openCatalogModal(id) {
    const overlay = document.getElementById(`modal-${id}`);
    // A área principal possui scroll próprio. Levar o modal para o body garante
    // centralização na janela visível, independentemente da posição do catálogo.
    if (overlay && overlay.parentElement !== document.body) document.body.appendChild(overlay);
    openModal(id);
}

function openStockAddProductModal(type = 'product') {
    const inp = document.getElementById('newProductImage');
    if (inp) inp.value = '';
    setPreviewFromUrl(document.getElementById('newImagePreview'), '');
    ['newCost', 'newPrice', 'newQty', 'newMin', 'newName', 'newDesc', 'newPartsCost', 'newServiceDuration'].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });
    const selectedType = type === 'service' ? 'service' : 'product';
    const productRadio = document.querySelector(`input[name="newItemType"][value="${selectedType}"]`);
    if (productRadio) productRadio.checked = true;
    const cat = document.getElementById('newCategory');
    populateCategorySelect(cat, 'others');
    const minEl = document.getElementById('newMin');
    if (minEl) minEl.value = String(Math.max(0, Number(window.appData?.configs?.defaultMinStock) || 10));
    syncCatalogFormType('new');
    openCatalogModal('addProduct');
}

const Stock = (() => {
    let editId = null;
    let filter = 'todos';

    const getEl = id => document.getElementById(id);
    const getVal = id => getEl(id)?.value.trim() || '';
    const setVal = (id, val) => { const el = getEl(id); if (el) el.value = val; };
    const findProd = (id, arr = window.appData?.products) =>
        arr?.find(p => String(p.id) === String(id));

    const getMoneyVal = (id) => {
        const v = parseMoneyInput(getEl(id)?.value || '');
        return Number.isFinite(v) ? v : 0;
    };

    const search = () => {
        const s = getVal('stockSearch').toLowerCase();
        const list = window.appData.products.filter((p) => {
            if (!s) return true;
            const catKey = String(p.category || '').toLowerCase();
            const catLabel = stockCategoryLabel(p.category).toLowerCase();
            return p.name.toLowerCase().includes(s) ||
                String(p.sku || '').toLowerCase().includes(s) ||
                catKey.includes(s) ||
                catLabel.includes(s);
        });
        return list;
    };

    const applyFilter = (products) => {
        let list = products;
        if (stockTypeFilter === 'product') list = list.filter((p) => !isCatalogService(p));
        if (stockTypeFilter === 'service') list = list.filter((p) => isCatalogService(p));
        if (catalogCategoryFilter !== 'all') list = list.filter((p) => String(p.category) === catalogCategoryFilter);
        if (catalogStatusFilter === 'active') list = list.filter((p) => p.active !== false);
        if (catalogStatusFilter === 'inactive') list = list.filter((p) => p.active === false);
        if (catalogStatusFilter === 'critical') list = list.filter((p) => !isCatalogService(p) && p.active !== false && asNumber(p.qty) <= asNumber(p.min));
        if (filter === 'baixo') return list.filter((p) => !isCatalogService(p) && p.qty < p.min);
        if (filter === 'normal') return list.filter((p) => !isCatalogService(p) && p.qty >= p.min && p.qty < p.min * 3);
        if (filter === 'alto') return list.filter((p) => !isCatalogService(p) && p.qty >= p.min * 3);
        return list;
    };

    const marginTag = (p) => {
        const price = asNumber(p.price);
        const cost = asNumber(p.unitCostTotal ?? p.cost);
        const margin = price > 0 ? ((price - cost) / price) * 100 : 0;
        const cls = margin >= 30 ? 'green' : margin >= 15 ? 'gold' : 'red';
        return `<span class="tag ${cls}">${margin.toFixed(1)}%</span>`;
    };

    const actionButtons = (p) => {
        const id = escapeAttr(String(p.id));
        return `<div class="catalog-row-actions">
            <button type="button" class="btn btn-ghost btn-sm btn-icon stock-btn-edit" data-product-id="${id}" title="Editar">✏️</button>
            <button type="button" class="btn btn-ghost btn-sm btn-icon stock-btn-duplicate" data-product-id="${id}" title="Duplicar">⧉</button>
            <button type="button" class="btn btn-ghost btn-sm btn-icon stock-btn-toggle" data-product-id="${id}" title="${p.active === false ? 'Ativar' : 'Desativar'}">${p.active === false ? '▶' : 'Ⅱ'}</button>
        </div>`;
    };

    const renderKpis = () => {
        const all = window.appData.products || [];
        const physical = all.filter((p) => !isCatalogService(p));
        const services = all.filter(isCatalogService);
        const critical = physical.filter((p) => p.active !== false && asNumber(p.qty) <= asNumber(p.min));
        const inactive = all.filter((p) => p.active === false);
        const el = getEl('catalogKpis');
        if (!el) return;
        el.innerHTML = [
            ['📦', 'Produtos', physical.length, 'Itens com estoque'],
            ['🔧', 'Serviços', services.length, 'Sem movimentar estoque'],
            ['⚠️', 'Estoque crítico', critical.length, 'Pedem reposição'],
            ['◌', 'Inativos', inactive.length, 'Ocultos no PDV']
        ].map(([icon, label, value, hint]) => `<button type="button" class="catalog-kpi" data-kpi-filter="${label === 'Estoque crítico' ? 'critical' : label === 'Inativos' ? 'inactive' : label === 'Produtos' ? 'product' : 'service'}"><span>${icon}</span><div><small>${label}</small><strong>${value}</strong><em>${hint}</em></div></button>`).join('');
        el.querySelectorAll('[data-kpi-filter]').forEach((button) => {
            button.onclick = () => {
                const selected = button.dataset.kpiFilter;
                if (selected === 'product' || selected === 'service') {
                    stockTypeFilter = selected;
                    catalogStatusFilter = 'all';
                } else {
                    stockTypeFilter = 'todos';
                    catalogStatusFilter = selected;
                }
                syncCatalogFilterControls();
                render();
            };
        });
    };

    const render = () => {
        if (!window.appData?.products) return;

        let products = search();
        products = applyFilter(products);

        const physical = products.filter((p) => !isCatalogService(p));
        const services = products.filter(isCatalogService);
        const countEl = getEl('stockCount');
        if (countEl) countEl.textContent = `${products.length} resultado(s) · ${physical.length} produto(s) · ${services.length} serviço(s)`;
        const productCount = getEl('catalogProductsCount');
        const serviceCount = getEl('catalogServicesCount');
        if (productCount) productCount.textContent = `${physical.length} produto(s) nesta visualização`;
        if (serviceCount) serviceCount.textContent = `${services.length} serviço(s) nesta visualização`;

        const productTable = getEl('catalogProductsTable');
        const serviceTable = getEl('catalogServicesTable');
        if (!productTable || !serviceTable) return;
        const rowId = (p) => escapeAttr(String(p.id));
        productTable.innerHTML = physical.map((p) => `<tr class="fade-in${p.active === false ? ' catalog-row-inactive' : ''}">
            <td class="mono text-muted">${escapeHtml(p.sku)}</td>
            <td><div class="catalog-item-cell">${productThumbCell(p)}<div><strong>${escapeHtml(p.name)}</strong><small>${escapeHtml(p.description || 'Produto físico')}</small></div></div></td>
            <td>${stockCategoryTagHtml(p.category)}</td>
            <td><div class="editable-cell"><input aria-label="Estoque de ${escapeAttr(p.name)}" type="number" min="0" step="1" class="editable-input stock-qty-input" value="${asNumber(p.qty)}" data-product-id="${rowId(p)}"></div></td>
            <td class="mono text-muted">${asNumber(p.min)}</td>
            <td class="mono">${formatCurrency(asNumber(p.cost))}</td>
            <td><div class="editable-cell"><input aria-label="Preço de ${escapeAttr(p.name)}" type="text" inputmode="numeric" autocomplete="off" class="editable-input input-money stock-price-input" value="${formatMoneyFromNumber(p.price)}" data-product-id="${rowId(p)}"></div></td>
            <td>${marginTag(p)}</td>
            <td><span class="tag ${p.active === false ? 'gray' : getStockStatus(p).cls}">${p.active === false ? 'Inativo' : getStockStatus(p).label}</span></td>
            <td>${actionButtons(p)}</td>
        </tr>`).join('') || '<tr><td colspan="10"><div class="empty-state"><div class="empty-icon">📦</div><p>Nenhum produto encontrado</p></div></td></tr>';
        serviceTable.innerHTML = services.map((p) => `<tr class="fade-in${p.active === false ? ' catalog-row-inactive' : ''}">
            <td class="mono text-muted">${escapeHtml(p.sku || '—')}</td>
            <td><div class="catalog-item-cell">${productThumbCell(p)}<div><strong>${escapeHtml(p.name)}</strong><small>${escapeHtml(p.description || 'Serviço do catálogo')}</small></div></div></td>
            <td>${stockCategoryTagHtml(p.category)}</td>
            <td><span class="catalog-duration">${escapeHtml(p.serviceDuration || 'Não informado')}</span></td>
            <td class="mono">${formatCurrency(asNumber(p.cost))}</td>
            <td class="mono">${formatCurrency(asNumber(p.partsCost))}</td>
            <td class="mono catalog-total-cost">${formatCurrency(asNumber(p.unitCostTotal))}</td>
            <td><div class="editable-cell"><input aria-label="Preço de ${escapeAttr(p.name)}" type="text" inputmode="numeric" autocomplete="off" class="editable-input input-money stock-price-input" value="${formatMoneyFromNumber(p.price)}" data-product-id="${rowId(p)}"></div></td>
            <td><span class="tag ${p.active === false ? 'gray' : 'green'}">${p.active === false ? 'Inativo' : 'Ativo no PDV'}</span></td>
            <td>${actionButtons(p)}</td>
        </tr>`).join('') || '<tr><td colspan="10"><div class="empty-state"><div class="empty-icon">🔧</div><p>Nenhum serviço encontrado</p></div></td></tr>';
        getEl('catalogProductsSection').hidden = stockTypeFilter === 'service' || catalogStatusFilter === 'critical' && physical.length === 0;
        getEl('catalogServicesSection').hidden = stockTypeFilter === 'product' || catalogStatusFilter === 'critical';
        renderKpis();
    };

    const updateStock = async (id, val) => {
        const p = findProd(id);
        if (!p || isCatalogService(p)) return;
        const n = parseInt(val, 10);
        if (isNaN(n) || n < 0) {
            showToast('Quantidade inválida', 'error');
            render();
            return;
        }
        try {
            const res = await fetch(`/api/products/${encodeURIComponent(String(id))}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                body: JSON.stringify({ qty: n })
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok || data.error) {
                showToast(data.message || 'Não foi possível atualizar o estoque.', 'error');
                render();
                return;
            }
            Object.assign(p, data.product);
            showToast(`Estoque de "${p.name}" atualizado para ${n}`, 'success');
            render();
        } catch (e) {
            showToast('Erro de rede ao atualizar estoque.', 'error');
            render();
        }
    };

    const updatePrice = async (id, val) => {
        const p = findProd(id);
        if (!p) return;
        const n = parseMoneyInput(val);
        if (!Number.isFinite(n) || n <= 0) {
            showToast('Preço inválido', 'error');
            render();
            return;
        }
        try {
            const res = await fetch(`/api/products/${encodeURIComponent(String(id))}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                body: JSON.stringify({ price: n })
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok || data.error) {
                showToast(data.message || 'Não foi possível atualizar o preço.', 'error');
                render();
                return;
            }
            Object.assign(p, data.product);
            showToast(`Preço de "${p.name}" atualizado para ${formatCurrency(n)}`, 'success');
            render();
        } catch (e) {
            showToast('Erro de rede ao atualizar preço.', 'error');
            render();
        }
    };

    const toggleActive = async (id) => {
        const product = findProd(id);
        if (!product) return;
        try {
            const res = await fetch(`/api/products/${encodeURIComponent(String(id))}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                body: JSON.stringify({ active: product.active === false })
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok || data.error) throw new Error(data.message || 'Não foi possível alterar a situação.');
            Object.assign(product, data.product);
            render();
            showToast(`${catalogTypeLabel(product)} ${product.active === false ? 'desativado' : 'ativado'} com sucesso.`, 'success');
        } catch (error) {
            showToast(error.message || 'Erro de rede ao alterar a situação.', 'error');
        }
    };

    const duplicateProduct = async (id) => {
        const source = findProd(id);
        if (!source) return;
        try {
            const res = await fetch(`/api/products/${encodeURIComponent(String(id))}/duplicate`, { method: 'POST', credentials: 'same-origin' });
            const data = await res.json().catch(() => ({}));
            if (!res.ok || data.error) throw new Error(data.message || 'Não foi possível duplicar.');
            window.appData.products.push(data.product);
            render();
            showToast(`${catalogTypeLabel(source)} duplicado como inativo para revisão.`, 'success');
            openEdit(data.product.id);
        } catch (error) {
            showToast(error.message || 'Erro de rede ao duplicar.', 'error');
        }
    };

    const openEdit = (id) => {
        const p = findProd(id);
        if (!p) return;
        editId = String(p.id);
        const fileInp = getEl('editProductImage');
        if (fileInp) fileInp.value = '';
        setVal('editSku', p.sku);
        setVal('editName', p.name);
        populateCategorySelect(getEl('editCategory'), p.category || 'others');
        const svc = isCatalogService(p);
        const typeRadio = document.querySelector(`input[name="editItemType"][value="${svc ? 'service' : 'product'}"]`);
        if (typeRadio) typeRadio.checked = true;
        setVal('editCost', formatMoneyFromNumber(p.cost ?? p.laborCost));
        setVal('editPartsCost', formatMoneyFromNumber(p.partsCost));
        setVal('editPrice', formatMoneyFromNumber(p.price));
        setVal('editQty', p.qty);
        setVal('editMin', p.min);
        setVal('editDesc', p.description || '');
        setVal('editServiceDuration', p.serviceDuration || '');
        const editSubtitle = getEl('catalogEditSubtitle');
        if (editSubtitle) editSubtitle.textContent = `${p.sku || 'Sem código'} · ${stockCategoryLabel(p.category) || 'Sem categoria'}`;
        const activeButton = getEl('catalogToggleActiveBtn');
        if (activeButton) {
            activeButton.textContent = p.active === false ? 'Ativar no PDV' : 'Desativar no PDV';
            activeButton.onclick = () => { closeModal('editProduct'); toggleActive(p.id); };
        }
        syncCatalogFormType('edit');
        setPreviewFromUrl(getEl('editImagePreview'), p.image || '');
        openCatalogModal('editProduct');
    };

    const saveEdit = async () => {
        const p = findProd(editId);
        if (!p) return;
        if (!getVal('editName')) {
            showToast('Nome do produto é obrigatório.', 'error');
            return;
        }

        const imgInp = getEl('editProductImage');
        const newFile = imgInp?.files?.[0];
        const url = `/api/products/${encodeURIComponent(String(editId))}`;

        const itemType = getCatalogItemType('edit');
        const trackStock = itemType !== 'service';
        const payload = {
            name: getVal('editName'),
            category: getVal('editCategory'),
            itemType,
            cost: getMoneyVal('editCost'),
            partsCost: getMoneyVal('editPartsCost'),
            price: getMoneyVal('editPrice'),
            qty: itemType === 'service' ? 0 : (parseInt(getVal('editQty'), 10) || 0),
            min: itemType === 'service' ? 0 : (parseInt(getVal('editMin'), 10) || 0),
            trackStock,
            serviceDuration: getVal('editServiceDuration'),
            description: getVal('editDesc')
        };

        let res;
        try {
            if (newFile) {
                const fd = new FormData();
                Object.entries(payload).forEach(([k, v]) => fd.append(k, String(v)));
                fd.append('image', newFile);
                res = await fetch(url, { method: 'PATCH', body: fd, credentials: 'same-origin' });
            } else {
                res = await fetch(url, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'same-origin',
                    body: JSON.stringify(payload)
                });
            }
            const data = await res.json().catch(() => ({}));
            if (!res.ok || data.error) {
                showToast(data.message || `Não foi possível salvar (${res.status}).`, 'error');
                return;
            }
            Object.assign(p, data.product);
            closeModal('editProduct');
            render();
            showToast('Produto atualizado com sucesso!', 'success');
        } catch (e) {
            showToast('Erro de rede ao salvar.', 'error');
        }
    };

    const deleteProductNow = async (id) => {
        try {
            const res = await fetch(`/api/products/${encodeURIComponent(String(id))}`, {
                method: 'DELETE',
                credentials: 'same-origin'
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok || data.error) {
                showToast(data.message || 'Não foi possível excluir o produto.', 'error');
                return;
            }
            const idx = window.appData.products.findIndex(pr => String(pr.id) === String(id));
            if (idx !== -1) window.appData.products.splice(idx, 1);
            if (String(editId) === String(id)) {
                editId = null;
                closeModal('editProduct');
            }
            render();
            showToast('Item excluído do catálogo.', 'info');
        } catch (e) {
            showToast('Erro de rede ao excluir o item.', 'error');
        }
    };

    const deleteProduct = (id) => {
        const product = findProd(id);
        if (!product) return;
        closeModal('editProduct');
        openCatalogConfirm({
            title: `Excluir ${catalogTypeLabel(product).toLowerCase()}`,
            message: `Excluir “${product.name}” permanentemente? Vendas e orçamentos antigos manterão apenas o retrato do item. Para ocultar temporariamente, prefira desativar.`,
            confirmText: 'Excluir permanentemente',
            onConfirm: () => deleteProductNow(id)
        });
    };

    const deleteEditing = () => {
        if (editId == null) return;
        deleteProduct(editId);
    };

    const add = async () => {
        const name = getVal('newName');
        const category = getVal('newCategory');
        const cost = getMoneyVal('newCost');
        const price = getMoneyVal('newPrice');
        const description = getVal('newDesc');

        if (!name) {
            showToast('Preencha o nome do produto!', 'error');
            return;
        }

        const itemType = getCatalogItemType('new');
        const qty = itemType === 'service' ? 0 : (parseInt(getVal('newQty'), 10) || 0);
        const min = itemType === 'service' ? 0 : (parseInt(getVal('newMin'), 10) || 10);
        const trackStock = itemType !== 'service';
        const partsCost = getMoneyVal('newPartsCost');
        const serviceDuration = getVal('newServiceDuration');

        const fd = new FormData();
        fd.append('name', name);
        fd.append('category', category);
        fd.append('itemType', itemType);
        fd.append('cost', String(cost));
        fd.append('partsCost', String(partsCost));
        fd.append('price', String(price));
        fd.append('qty', String(qty));
        fd.append('min', String(min));
        fd.append('trackStock', trackStock ? 'true' : 'false');
        fd.append('description', description);
        if (serviceDuration) fd.append('serviceDuration', serviceDuration);
        const fileInp = getEl('newProductImage');
        if (fileInp?.files?.[0]) fd.append('image', fileInp.files[0]);

        try {
            const res = await fetch('/api/products', {
                method: 'POST',
                body: fd,
                credentials: 'same-origin'
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok || data.error) {
                showToast(data.message || 'Não foi possível cadastrar o produto.', 'error');
                return;
            }
            window.appData.products = window.appData.products || [];
            window.appData.products.push(data.product);
            closeModal('addProduct');
            const inp = getEl('newProductImage');
            if (inp) inp.value = '';
            setPreviewFromUrl(getEl('newImagePreview'), '');
            ['newCost', 'newPrice', 'newQty', 'newMin', 'newName', 'newDesc'].forEach(f => setVal(f, ''));
            const minEl = getEl('newMin');
            if (minEl) minEl.value = '10';
            const cat = getEl('newCategory');
            if (cat && cat.options.length) {
                const i = [...cat.options].findIndex((o) => o.value === 'others');
                cat.selectedIndex = i >= 0 ? i : 0;
            }
            render();
            showToast(`"${name}" adicionado ao catálogo!`, 'success');
        } catch (e) {
            showToast('Erro de rede ao cadastrar.', 'error');
        }
    };

    const init = () => {
        if (!Array.isArray(window.appData?.products)) {
            window.appData = window.appData || {};
            window.appData.products = window.appData.products ? Object.values(window.appData.products) : [];
        }
        wireMoneyMaskDelegation(document.getElementById('modal-addProduct'));
        wireMoneyMaskDelegation(document.getElementById('modal-editProduct'));
        wireMoneyMaskDelegation(document.getElementById('page-estoque'));
        wireStockPageActions({
            updateStock,
            updatePrice,
            openEdit,
            deleteProduct,
            duplicateProduct,
            toggleActive
        });
        wireCatalogFormType('new');
        wireCatalogFormType('edit');
        populateCategorySelect(getEl('newCategory'), 'others');
        populateCategorySelect(getEl('editCategory'), 'others');
        populateCatalogFilters();
        bindCatalogConfirm();
        wireImagePreview(getEl('newProductImage'), getEl('newImagePreview'));
        wireImagePreview(getEl('editProductImage'), getEl('editImagePreview'));
        if (typeof updateTopbarTitle === 'function') updateTopbarTitle('Catálogo');
        if (typeof markNavActive === 'function') markNavActive('/stock');
        render();
    };

    const getVisibleProducts = () => {
        if (!window.appData?.products) return [];
        let products = search();
        products = applyFilter(products);
        return products;
    };

    return {
        init,
        render,
        updateStock,
        updatePrice,
        duplicateProduct,
        toggleActive,
        openEdit,
        saveEdit,
        delete: deleteProduct,
        deleteProduct,
        deleteEditing,
        add,
        setFilter: (f) => { filter = f; render(); },
        filterSearch: () => render(),
        getVisibleProducts
    };
})();

window.Stock = Stock;

/** Exporta em JSON os itens da visualização atual, separados por natureza. */
function exportCatalogJson() {
    const visibleItems = Stock.getVisibleProducts?.() || [];
    if (!visibleItems.length) {
        showToast('Não há itens para exportar nesta visualização.', 'info');
        return;
    }
    const common = (p) => ({
        id: String(p.id || ''),
        sku: String(p.sku || ''),
        nome: String(p.name || ''),
        categoria: String(p.category || ''),
        categoriaNome: stockCategoryLabel(p.category) || String(p.category || ''),
        preco: Number(p.price) || 0,
        ativo: p.active !== false,
        descricao: String(p.description || '')
    });
    const products = visibleItems.filter((p) => !isCatalogService(p)).map((p) => ({
        ...common(p), tipo: 'product', custo: Number(p.cost) || 0,
        estoque: Number(p.qty) || 0, estoqueMinimo: Number(p.min) || 0,
        controlaEstoque: p.trackStock !== false
    }));
    const services = visibleItems.filter(isCatalogService).map((p) => ({
        ...common(p), tipo: 'service', duracao: String(p.serviceDuration || ''),
        custoMaoDeObra: Number(p.cost) || 0, custoMateriais: Number(p.partsCost) || 0,
        custoTotal: Number(p.unitCostTotal ?? ((Number(p.cost) || 0) + (Number(p.partsCost) || 0))) || 0
    }));
    const payload = {
        schemaVersion: 2,
        exportadoEm: new Date().toISOString(),
        filtros: { tipo: stockTypeFilter, situacao: catalogStatusFilter, categoria: catalogCategoryFilter },
        resumo: { total: visibleItems.length, produtos: products.length, servicos: services.length },
        produtos: products,
        servicos: services
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    const stamp = new Date().toISOString().slice(0, 10);
    anchor.href = url;
    anchor.download = `catalogo_${stamp}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
    showToast(`${visibleItems.length} item(ns) exportado(s) em JSON.`, 'success');
}

// Compatibilidade com páginas que ainda estejam em cache.
function exportStockExcel() { exportCatalogJson(); }

function filterStock() {
    Stock.filterSearch();
}

function setStockFilter(f, el) {
    catalogStatusFilter = f === 'baixo' ? 'critical' : 'all';
    syncCatalogFilterControls();
    Stock.setFilter('todos');
}

function addProduct() {
    Stock.add();
}

function saveEditProduct() {
    Stock.saveEdit();
}

function deleteProductModal() {
    Stock.deleteEditing();
}

function bootStock() {
    whenAppReady(() => Stock.init?.());
}
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootStock);
} else {
    bootStock();
}
