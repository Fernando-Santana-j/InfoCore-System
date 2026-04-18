function formatMoneyFromNumber(n) {
    const x = Number(n);
    if (!Number.isFinite(x)) return '';
    return x.toFixed(2).replace('.', ',');
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
        return `<img class="stock-prod-thumb" src="${escapeAttr(p.image)}" alt="">`;
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
        const btn = e.target.closest?.('.stock-btn-edit, .stock-btn-delete');
        if (!btn || !page.contains(btn)) return;
        const id = btn.dataset.productId;
        if (!id) return;
        e.preventDefault();
        if (btn.classList.contains('stock-btn-edit')) api.openEdit(id);
        else if (btn.classList.contains('stock-btn-delete')) api.deleteProduct(id);
    });
}

function openStockAddProductModal() {
    const inp = document.getElementById('newProductImage');
    if (inp) inp.value = '';
    setPreviewFromUrl(document.getElementById('newImagePreview'), '');
    ['newCost', 'newPrice', 'newQty', 'newMin', 'newName', 'newDesc'].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });
    const cat = document.getElementById('newCategory');
    if (cat && cat.options.length) {
        const i = [...cat.options].findIndex((o) => o.value === 'others');
        cat.selectedIndex = i >= 0 ? i : 0;
    }
    const minEl = document.getElementById('newMin');
    if (minEl) minEl.value = '10';
    openModal('addProduct');
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
        if (filter === 'baixo') return products.filter(p => p.qty < p.min);
        if (filter === 'normal') return products.filter(p => p.qty >= p.min && p.qty < p.min * 3);
        if (filter === 'alto') return products.filter(p => p.qty >= p.min * 3);
        return products;
    };

    const render = () => {
        if (!window.appData?.products) return;

        let products = search();
        products = applyFilter(products);

        const countEl = getEl('stockCount');
        if (countEl) countEl.textContent = `${products.length} produto${products.length !== 1 ? 's' : ''} encontrado${products.length !== 1 ? 's' : ''}`;

        const table = getEl('stockTable');
        if (!table) return;

        const rowId = (p) => escapeAttr(String(p.id));

        table.innerHTML = products.map(p => `
      <tr class="fade-in">
        <td class="mono text-muted">${p.sku}</td>
        <td>${productThumbCell(p)}<strong>${p.name}</strong></td>
        <td>${stockCategoryTagHtml(p.category)}</td>
        <td>
          <div class="editable-cell">
            <input type="number" min="0" step="1" class="editable-input stock-qty-input" value="${p.qty}" data-product-id="${rowId(p)}">
          </div>
        </td>
        <td class="mono text-muted">${p.min}</td>
        <td class="mono">${formatCurrency(p.cost)}</td>
        <td>
          <div class="editable-cell">
            <input type="text" inputmode="numeric" autocomplete="off" class="editable-input input-money stock-price-input" value="${formatMoneyFromNumber(p.price)}" data-product-id="${rowId(p)}">
          </div>
        </td>
        <td><span class="tag ${getStockStatus(p).cls}">${getStockStatus(p).label}</span></td>
        <td class="flex gap-2">
          <button type="button" class="btn btn-ghost btn-sm btn-icon stock-btn-edit" data-product-id="${rowId(p)}">✏️</button>
          <button type="button" class="btn btn-danger btn-sm btn-icon stock-btn-delete" data-product-id="${rowId(p)}">🗑️</button>
        </td>
      </tr>
    `).join('') || `<tr><td colspan="9"><div class="empty-state"><div class="empty-icon">📦</div><p>Nenhum produto encontrado</p></div></td></tr>`;
    };

    const updateStock = async (id, val) => {
        const p = findProd(id);
        if (!p) return;
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

    const openEdit = (id) => {
        const p = findProd(id);
        if (!p) return;
        editId = String(p.id);
        const fileInp = getEl('editProductImage');
        if (fileInp) fileInp.value = '';
        setVal('editSku', p.sku);
        setVal('editName', p.name);
        const catEl = getEl('editCategory');
        if (catEl) {
            const target = String(p.category || 'others');
            let match = [...catEl.options].find(o => o.value === target);
            if (!match) match = [...catEl.options].find(o => o.textContent.trim() === target);
            if (match) {
                catEl.value = match.value;
            } else {
                const o = document.createElement('option');
                o.value = target;
                o.textContent = target;
                catEl.appendChild(o);
                catEl.value = target;
            }
        }
        setVal('editCost', formatMoneyFromNumber(p.cost));
        setVal('editPrice', formatMoneyFromNumber(p.price));
        setVal('editQty', p.qty);
        setVal('editMin', p.min);
        setPreviewFromUrl(getEl('editImagePreview'), p.image || '');
        openModal('editProduct');
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

        let res;
        try {
            if (newFile) {
                const fd = new FormData();
                fd.append('name', getVal('editName'));
                fd.append('category', getVal('editCategory'));
                fd.append('cost', String(getMoneyVal('editCost')));
                fd.append('price', String(getMoneyVal('editPrice')));
                fd.append('qty', String(parseInt(getVal('editQty'), 10) || 0));
                fd.append('min', String(parseInt(getVal('editMin'), 10) || 0));
                fd.append('image', newFile);
                res = await fetch(url, { method: 'PATCH', body: fd, credentials: 'same-origin' });
            } else {
                res = await fetch(url, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'same-origin',
                    body: JSON.stringify({
                        name: getVal('editName'),
                        category: getVal('editCategory'),
                        cost: getMoneyVal('editCost'),
                        price: getMoneyVal('editPrice'),
                        qty: parseInt(getVal('editQty'), 10) || 0,
                        min: parseInt(getVal('editMin'), 10) || 0
                    })
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

    const deleteProduct = async (id) => {
        if (!confirm('Confirmar exclusão do produto?')) return;
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
            showToast('Produto excluído!', 'info');
        } catch (e) {
            showToast('Erro de rede ao excluir.', 'error');
        }
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
        const qty = parseInt(getVal('newQty'), 10) || 0;
        const min = parseInt(getVal('newMin'), 10) || 10;
        const description = getVal('newDesc');

        if (!name) {
            showToast('Preencha o nome do produto!', 'error');
            return;
        }

        const fd = new FormData();
        fd.append('name', name);
        fd.append('category', category);
        fd.append('cost', String(cost));
        fd.append('price', String(price));
        fd.append('qty', String(qty));
        fd.append('min', String(min));
        fd.append('description', description);
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
            deleteProduct
        });
        wireImagePreview(getEl('newProductImage'), getEl('newImagePreview'));
        wireImagePreview(getEl('editProductImage'), getEl('editImagePreview'));
        if (typeof updateTopbarTitle === 'function') updateTopbarTitle('Estoque');
        if (typeof markNavActive === 'function') markNavActive('/stock');
        render();
    };

    return {
        init,
        render,
        updateStock,
        updatePrice,
        openEdit,
        saveEdit,
        delete: deleteProduct,
        deleteProduct,
        deleteEditing,
        add,
        setFilter: (f) => { filter = f; render(); },
        filterSearch: () => render()
    };
})();

window.Stock = Stock;

function filterStock() {
    Stock.filterSearch();
}

function setStockFilter(f, el) {
    document.querySelectorAll('#page-estoque .filter-btn').forEach((b) => b.classList.remove('active'));
    if (el && el.classList) el.classList.add('active');
    Stock.setFilter(f);
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

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => Stock.init?.());
} else {
    Stock.init?.();
}
