const Stock = (() => {
    let editId = null;
    let filter = 'todos';

    const getEl = id => document.getElementById(id);
    const getVal = id => getEl(id)?.value.trim() || '';
    const setVal = (id, val) => { const el = getEl(id); if (el) el.value = val; };
    const findProd = (id, arr = window.appData?.products) => arr?.find(p => p.id === id);

    const search = () => {
        const s = getVal('stockSearch').toLowerCase();
        const list = window.appData.products.filter(p =>
            !s || p.name.toLowerCase().includes(s) ||
            p.sku.toLowerCase().includes(s) ||
            p.category.toLowerCase().includes(s)
        );
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

        table.innerHTML = products.map(p => `
      <tr class="fade-in">
        <td class="mono text-muted">${p.sku}</td>
        <td><span style="margin-right:6px">${p.emoji}</span><strong>${p.name}</strong></td>
        <td><span class="tag gray">${p.category}</span></td>
        <td>
          <div class="editable-cell">
            <input class="editable-input" value="${p.qty}" id="qty_${p.id}" onchange="Stock.updateStock(${p.id}, this.value)">
          </div>
        </td>
        <td class="mono text-muted">${p.min}</td>
        <td class="mono">${formatCurrency(p.cost)}</td>
        <td>
          <div class="editable-cell">
            <input class="editable-input" value="${p.price.toFixed(2)}" id="price_${p.id}" onchange="Stock.updatePrice(${p.id}, this.value)">
          </div>
        </td>
        <td><span class="tag ${getStockStatus(p).cls}">${getStockStatus(p).label}</span></td>
        <td class="flex gap-2">
          <button class="btn btn-ghost btn-sm btn-icon" onclick="Stock.openEdit(${p.id})">✏️</button>
          <button class="btn btn-danger btn-sm btn-icon" onclick="Stock.delete(${p.id})">🗑️</button>
        </td>
      </tr>
    `).join('') || `<tr><td colspan="9"><div class="empty-state"><div class="empty-icon">📦</div><p>Nenhum produto encontrado</p></div></td></tr>`;
    };

    const updateStock = (id, val) => {
        const p = findProd(id);
        if (!p) return;
        const n = parseInt(val);
        if (isNaN(n) || n < 0) {
            showToast('Quantidade inválida', 'error');
            return;
        }
        p.qty = n;
        showToast(`Estoque de "${p.name}" atualizado para ${n}`, 'success');
    };

    const updatePrice = (id, val) => {
        const p = findProd(id);
        if (!p) return;
        const n = parseFloat(val);
        if (isNaN(n) || n <= 0) {
            showToast('Preço inválido', 'error');
            return;
        }
        p.price = n;
        showToast(`Preço de "${p.name}" atualizado para ${formatCurrency(n)}`, 'success');
    };

    const openEdit = (id) => {
        const p = findProd(id);
        if (!p) return;
        editId = id;
        setVal('editSku', p.sku);
        setVal('editName', p.name);
        setVal('editCategory', p.category);
        setVal('editEmoji', p.emoji);
        setVal('editCost', p.cost);
        setVal('editPrice', p.price);
        setVal('editQty', p.qty);
        setVal('editMin', p.min);
        openModal('editProduct');
    };

    const saveEdit = () => {
        const p = findProd(editId);
        if (!p) return;
        p.name = getVal('editName');
        p.category = getVal('editCategory');
        p.emoji = getVal('editEmoji');
        p.cost = parseFloat(getVal('editCost')) || p.cost;
        p.price = parseFloat(getVal('editPrice')) || p.price;
        p.qty = parseInt(getVal('editQty')) || p.qty;
        p.min = parseInt(getVal('editMin')) || p.min;
        closeModal('editProduct');
        render();
        showToast('Produto atualizado com sucesso!', 'success');
    };

    const deleteProduct = (id) => {
        if (!confirm('Confirmar exclusão do produto?')) return;
        const idx = window.appData.products.findIndex(p => p.id === id);
        if (idx !== -1) window.appData.products.splice(idx, 1);
        render();
        showToast('Produto excluído!', 'info');
    };

    const add = () => {
        const sku = getVal('newSku');
        const name = getVal('newName');
        const category = getVal('newCategory');
        const emoji = getVal('newEmoji') || '📦';
        const cost = parseFloat(getVal('newCost')) || 0;
        const price = parseFloat(getVal('newPrice')) || 0;
        const qty = parseInt(getVal('newQty')) || 0;
        const min = parseInt(getVal('newMin')) || 10;

        if (!name || !sku) {
            showToast('Preencha Nome e SKU!', 'error');
            return;
        }
        if (window.appData.products.find(p => p.sku === sku)) {
            showToast('SKU já existe!', 'error');
            return;
        }

        const id = Math.max(...window.appData.products.map(p => p.id), 0) + 1;
        window.appData.products.push({ id, sku, name, category, emoji, cost, price, qty, min, active: true });
        closeModal('addProduct');
        ['newSku', 'newName', 'newEmoji', 'newCost', 'newPrice', 'newQty', 'newMin'].forEach(f => setVal(f, ''));
        render();
        showToast(`"${name}" adicionado ao catálogo!`, 'success');
    };

    const init = () => {
        if (typeof updateTopbarTitle === 'function') updateTopbarTitle('Estoque');
        if (typeof markNavActive === 'function') markNavActive('/stock');
        render();
    };

    return { init, render, updateStock, updatePrice, openEdit, saveEdit, delete: deleteProduct, add, setFilter: (f) => { filter = f; render(); }, filterSearch: () => render() };
})();


if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => Stock.init?.());
} else {
    Stock.init?.();
}
