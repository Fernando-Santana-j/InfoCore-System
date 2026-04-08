let currentPDVFilter = 'todos';

function initPDV() {


    if (window.appData) {

    }

    updateTopbarTitle('PDV');
    markNavActive('/pdv');
    renderPDV();
    renderCart();


}

function renderPDV(filter) {
    filter = filter || currentPDVFilter;

    if (!window.appData) {

        return;
    }

    const { products } = window.appData;


    const search = document.getElementById('pdvSearch')?.value?.toLowerCase() || '';
    let list = products.filter(p => p.active && p.qty > 0);

    if (search) list = list.filter(p => p.name.toLowerCase().includes(search));
    if (filter !== 'todos') list = list.filter(p => p.category === filter);



    const grid = document.getElementById('pdvGrid');
    if (!grid) {

        return;
    }

    grid.innerHTML = list.map(p => `
    <div class="pdv-product-card" onclick="addToCart(${p.id})">
      <div class="prod-emoji">${p.emoji}</div>
      <div class="prod-name">${p.name}</div>
      <div class="prod-price">${formatCurrency(p.price)}</div>
      <div style="font-size:0.65rem;color:var(--text3);margin-top:2px;">${p.qty} em estoque</div>
    </div>
  `).join('') || `<div class="empty-state"><div class="empty-icon">📦</div><p>Nenhum produto</p></div>`;


}

function setPDVFilter(f, btn) {
    currentPDVFilter = f;
    document.querySelectorAll('#page-pdv .filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    renderPDV(f);
}

function filterPDV(value) {
    renderPDV(currentPDVFilter);
}

function addToCart(id) {
    const { products, cart } = window.appData;
    const p = products.find(x => x.id === id);
    if (!p || p.qty <= 0) {
        showToast('Produto sem estoque!', 'error');
        return;
    }

    const existing = cart.find(x => x.id === id);
    if (existing) {
        if (existing.qty >= p.qty) {
            showToast('Estoque insuficiente!', 'error');
            return;
        }
        existing.qty++;
    } else {
        cart.push({ id: p.id, name: p.name, price: p.price, qty: 1 });
    }

    renderCart();
    showToast(`${p.name} adicionado ao carrinho`, 'success');
}

function renderCart() {
    const { cart } = window.appData;
    const container = document.getElementById('cartItems');
    if (!container) return;

    if (cart.length === 0) {
        container.innerHTML = '<div class="empty-state" style="padding:30px;"><div class="empty-icon">🛒</div><p>Carrinho vazio</p></div>';
    } else {
        container.innerHTML = cart.map(item => `
      <div class="cart-item">
        <div class="cart-item-name">${item.name}</div>
        <div class="cart-item-qty">
          <button class="qty-btn" onclick="changeQty(${item.id},-1)">−</button>
          <span class="qty-num">${item.qty}</span>
          <button class="qty-btn" onclick="changeQty(${item.id},1)">+</button>
        </div>
        <div class="cart-item-price">${formatCurrency(item.price * item.qty)}</div>
        <div class="cart-item-remove" onclick="removeFromCart(${item.id})">✕</div>
      </div>
    `).join('');
    }

    const subtotal = cart.reduce((s, i) => s + i.price * i.qty, 0);

    const count = document.getElementById('cartCount');
    if (count) count.textContent = cart.length + ' item' + (cart.length !== 1 ? 's' : '');

    const sub = document.getElementById('cartSubtotal');
    if (sub) sub.textContent = formatCurrency(subtotal);

    const tot = document.getElementById('cartTotal');
    if (tot) tot.textContent = formatCurrency(subtotal);
}

function changeQty(id, delta) {
    const { cart } = window.appData;
    const item = cart.find(x => x.id === id);
    if (!item) return;
    item.qty += delta;
    if (item.qty <= 0) removeFromCart(id);
    else renderCart();
}

function removeFromCart(id) {
    const { cart } = window.appData;
    const idx = cart.findIndex(x => x.id === id);
    if (idx !== -1) cart.splice(idx, 1);
    renderCart();
}

function clearCart() {
    window.appData.cart = [];
    renderCart();
}

function finalizarVenda() {
    const { cart, products, sales } = window.appData;

    if (cart.length === 0) {
        showToast('Carrinho vazio!', 'error');
        return;
    }

    const total = cart.reduce((s, i) => s + i.price * i.qty, 0);
    const payment = document.getElementById('paymentMethod')?.value || 'dinheiro';
    const id = 'VD-' + String(sales.length + 1).padStart(3, '0');
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10) + ' ' + now.toTimeString().slice(0, 5);

    cart.forEach(item => {
        const p = products.find(x => x.id === item.id);
        if (p) p.qty = Math.max(0, p.qty - item.qty);
    });

    const sale = { id, date: dateStr, client: 'Balcão', items: cart.map(i => ({ ...i })), discount: 0, total, payment };
    sales.push(sale);
    window.appData.cart = [];
    renderCart();
    showToast(`Venda ${id} finalizada! ${formatCurrency(total)}`, 'success');
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        if (typeof initPDV === 'function') initPDV();
    });
} else {
    if (typeof initPDV === 'function') initPDV();
}
