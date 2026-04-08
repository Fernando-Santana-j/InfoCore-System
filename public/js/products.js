function initProducts() {

    updateTopbarTitle('Produtos');
    markNavActive('/products');
    renderProducts();

}

function renderProducts() {
    const { products } = window.appData;

    const search = document.getElementById('prodSearch')?.value?.toLowerCase() || '';
    let list = [...products];

    if (search) {
        list = list.filter(p => p.name.toLowerCase().includes(search) || p.sku.toLowerCase().includes(search));
    }

    const count = document.getElementById('prodCount');
    if (count) count.textContent = list.length + ' produto' + (list.length !== 1 ? 's' : '');

    const table = document.getElementById('productsTable');
    if (!table) return;

    table.innerHTML = list.map(p => {
        const margin = ((p.price - p.cost) / p.price * 100).toFixed(0);
        return `
    <tr>
      <td class="mono" style="color:var(--text3)">${p.sku}</td>
      <td><span style="margin-right:6px">${p.emoji}</span><strong>${p.name}</strong></td>
      <td><span class="tag gray">${p.category}</span></td>
      <td class="mono" style="font-weight:700;color:var(--gold)">${formatCurrency(p.price)}</td>
      <td><span class="tag ${parseInt(margin) > 30 ? 'green' : parseInt(margin) > 15 ? 'gold' : 'red'}">${margin}%</span></td>
      <td>${p.active ? '<span class="tag green">Ativo</span>' : '<span class="tag red">Inativo</span>'}</td>
      <td>
        <div style="display:flex;gap:6px;">
          <button class="btn btn-ghost btn-sm" onclick="openEditProductModal(${p.id})">✏️ Editar</button>
          <button class="btn btn-danger btn-sm btn-icon" onclick="deleteProductFromList(${p.id})">🗑️</button>
        </div>
      </td>
    </tr>`;
    }).join('');
}

function filterProducts() {
    renderProducts();
}

function openEditProductModal(id) {
    const { products } = window.appData;
    const p = products.find(x => x.id === id);
    if (!p) return;

    document.getElementById('editSku').value = p.sku;
    document.getElementById('editName').value = p.name;
    document.getElementById('editCategory').value = p.category;
    document.getElementById('editEmoji').value = p.emoji;
    document.getElementById('editCost').value = p.cost;
    document.getElementById('editPrice').value = p.price;
    document.getElementById('editQty').value = p.qty;
    document.getElementById('editMin').value = p.min;

    window.editingProductId = id;
    openModal('editProduct');
}

function saveEditProduct() {
    const { products } = window.appData;
    const p = products.find(x => x.id === window.editingProductId);
    if (!p) return;

    p.name = document.getElementById('editName').value;
    p.category = document.getElementById('editCategory').value;
    p.emoji = document.getElementById('editEmoji').value;
    p.cost = parseFloat(document.getElementById('editCost').value) || p.cost;
    p.price = parseFloat(document.getElementById('editPrice').value) || p.price;
    p.qty = parseInt(document.getElementById('editQty').value) || p.qty;
    p.min = parseInt(document.getElementById('editMin').value) || p.min;

    closeModal('editProduct');
    renderProducts();
    showToast('Produto atualizado com sucesso!', 'success');
}

function deleteProductFromList(id) {
    if (!confirm('Confirmar exclusão do produto?')) return;

    const { products } = window.appData;
    const idx = products.findIndex(x => x.id === id);
    if (idx !== -1) products.splice(idx, 1);

    renderProducts();
    showToast('Produto excluído!', 'info');
}

function addProductFromForm() {
    const { products } = window.appData;

    const sku = document.getElementById('newSku').value.trim();
    const name = document.getElementById('newName').value.trim();
    const category = document.getElementById('newCategory').value;
    const emoji = document.getElementById('newEmoji').value.trim() || '📦';
    const cost = parseFloat(document.getElementById('newCost').value) || 0;
    const price = parseFloat(document.getElementById('newPrice').value) || 0;
    const qty = parseInt(document.getElementById('newQty').value) || 0;
    const min = parseInt(document.getElementById('newMin').value) || 10;

    if (!name || !sku) {
        showToast('Preencha Nome e SKU!', 'error');
        return;
    }

    if (products.find(p => p.sku === sku)) {
        showToast('SKU já existe!', 'error');
        return;
    }

    const id = Math.max(...products.map(p => p.id), 0) + 1;
    products.push({ id, sku, name, category, emoji, cost, price, qty, min, active: true });

    closeModal('addProduct');
    ['newSku', 'newName', 'newEmoji', 'newCost', 'newPrice', 'newQty', 'newMin'].forEach(f => {
        const el = document.getElementById(f);
        if (el) el.value = '';
    });

    renderProducts();
    showToast(`"${name}" adicionado ao catálogo!`, 'success');
}


if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        if (typeof initProducts === 'function') initProducts();
    });
} else {
    if (typeof initProducts === 'function') initProducts();
}
