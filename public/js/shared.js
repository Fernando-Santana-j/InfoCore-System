window.appData = {
    products: [
        { id: 1, sku: 'SKU-001', name: 'Coca-Cola 2L', category: 'Bebidas', emoji: '🥤', cost: 4.5, price: 8.99, qty: 45, min: 10, active: true },
        { id: 2, sku: 'SKU-002', name: 'Pão de Forma', category: 'Alimentos', emoji: '🍞', cost: 3.2, price: 6.5, qty: 18, min: 20, active: true },
        { id: 3, sku: 'SKU-003', name: 'Detergente 500ml', category: 'Limpeza', emoji: '🧴', cost: 1.8, price: 3.99, qty: 62, min: 15, active: true },
        { id: 4, sku: 'SKU-004', name: 'Fone Bluetooth', category: 'Eletrônicos', emoji: '🎧', cost: 45, price: 129.9, qty: 7, min: 3, active: true },
        { id: 5, sku: 'SKU-005', name: 'Biscoito Recheado', category: 'Alimentos', emoji: '🍪', cost: 2.1, price: 4.49, qty: 4, min: 15, active: true },
        { id: 6, sku: 'SKU-006', name: 'Água Mineral 1,5L', category: 'Bebidas', emoji: '💧', cost: 0.9, price: 2.49, qty: 120, min: 30, active: true },
        { id: 7, sku: 'SKU-007', name: 'Caneta Azul', category: 'Papelaria', emoji: '🖊️', cost: 0.5, price: 1.99, qty: 3, min: 20, active: true },
        { id: 8, sku: 'SKU-008', name: 'Sabonete Líquido', category: 'Higiene', emoji: '🧼', cost: 3.5, price: 7.9, qty: 28, min: 10, active: true },
        { id: 9, sku: 'SKU-009', name: 'Arroz 5kg', category: 'Alimentos', emoji: '🍚', cost: 12, price: 22.9, qty: 35, min: 10, active: true },
        { id: 10, sku: 'SKU-010', name: 'Mouse USB', category: 'Eletrônicos', emoji: '🖱️', cost: 22, price: 59.9, qty: 12, min: 5, active: true },
    ],
    clients: [
        { id: 1, name: 'Ana Souza', doc: '123.456.789-00', phone: '(11) 98765-4321', email: 'ana@email.com', purchases: 12, spent: 487.5 },
        { id: 2, name: 'Carlos Lima', doc: '987.654.321-00', phone: '(21) 91234-5678', email: 'carlos@email.com', purchases: 5, spent: 213.9 },
        { id: 3, name: 'Maria Silva', doc: '456.789.123-00', phone: '(31) 99876-5432', email: 'maria@email.com', purchases: 28, spent: 1204.0 },
        { id: 4, name: 'João Pinto', doc: '321.654.987-00', phone: '(41) 93456-7890', email: 'joao@email.com', purchases: 3, spent: 89.7 },
        { id: 5, name: 'Beatriz Costa', doc: '654.321.789-00', phone: '(51) 92345-6789', email: 'bea@email.com', purchases: 17, spent: 752.4 },
    ],
    sales: [
        { id: 'VD-001', date: '2025-04-05 08:32', client: 'Ana Souza', items: [{ name: 'Coca-Cola 2L', qty: 2, price: 8.99 }, { name: 'Biscoito Recheado', qty: 1, price: 4.49 }], discount: 0, total: 22.47, payment: 'cartao_debito' },
        { id: 'VD-002', date: '2025-04-05 09:15', client: 'Carlos Lima', items: [{ name: 'Arroz 5kg', qty: 1, price: 22.9 }, { name: 'Detergente 500ml', qty: 2, price: 3.99 }], discount: 2, total: 28.88, payment: 'pix' },
        { id: 'VD-003', date: '2025-04-05 10:04', client: 'Balcão', items: [{ name: 'Água Mineral 1,5L', qty: 6, price: 2.49 }, { name: 'Pão de Forma', qty: 1, price: 6.5 }], discount: 0, total: 21.44, payment: 'dinheiro' },
        { id: 'VD-004', date: '2025-04-05 11:22', client: 'Maria Silva', items: [{ name: 'Fone Bluetooth', qty: 1, price: 129.9 }], discount: 10, total: 119.9, payment: 'cartao_credito' },
        { id: 'VD-005', date: '2025-04-05 12:40', client: 'Beatriz Costa', items: [{ name: 'Sabonete Líquido', qty: 3, price: 7.9 }, { name: 'Caneta Azul', qty: 5, price: 1.99 }], discount: 0, total: 33.65, payment: 'dinheiro' },
        { id: 'VD-006', date: '2025-04-05 13:55', client: 'Balcão', items: [{ name: 'Mouse USB', qty: 1, price: 59.9 }], discount: 0, total: 59.9, payment: 'pix' },
    ],
    cart: [],
};


const DOM = {
    toastContainer: null,
    topbarTitle: null,
    modalOverlays: new Map(),
    getToastContainer() {
        return this.toastContainer || (this.toastContainer = document.getElementById('toastContainer'));
    },
    getTopbarTitle() {
        return this.topbarTitle || (this.topbarTitle = document.getElementById('topbarTitle'));
    },
};


function showToast(msg, type = 'info') {
    const icons = { success: '✅', error: '❌', info: 'ℹ️' };
    const container = DOM.getToastContainer();
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `<div class="toast-icon">${icons[type]}</div><div class="toast-msg">${msg}</div>`;
    container?.appendChild(toast);
    requestAnimationFrame(() => {
        setTimeout(() => {
            toast.classList.add('removing');
            setTimeout(() => toast.remove(), 300);
        }, 3200);
    });
}


function openModal(id) {
    const el = document.getElementById('modal-' + id);
    if (el) {
        el.classList.add('open');
        document.body.style.overflow = 'hidden';
    }
}

function closeModal(id) {
    const el = document.getElementById('modal-' + id);
    if (el) {
        el.classList.remove('open');
        document.body.style.overflow = '';
    }
}


document.addEventListener('click', e => {
    if (e.target?.classList.contains('modal-overlay') && !e.target.classList.contains('open')) {
        e.target.classList.remove('open');
        document.body.style.overflow = '';
    }
}, { passive: true });


function formatCurrency(value) {
    return 'R$ ' + value.toFixed(2).replace('.', ',');
}

function updateTopbarTitle(title) {
    const el = DOM.getTopbarTitle();
    if (el) el.textContent = title + ' ↗';
}

function getStockStatus(product) {
    const { qty, min } = product;
    if (qty === 0) return { label: 'Sem estoque', cls: 'red' };
    if (qty < min) return { label: 'Crítico', cls: 'red' };
    if (qty < min * 2) return { label: 'Baixo', cls: 'gold' };
    return { label: 'Normal', cls: 'green' };
}

function markNavActive(path) {
    document.querySelectorAll('.nav-item').forEach(link => {
        const href = link.getAttribute('href');
        const isActive = href === path || (path === '/' && href === '/dashboard');
        link.classList.toggle('active', isActive);
    });
}


function syncBackend() {
    showToast('Sincronizando com servidor...', 'info');
    setTimeout(() => showToast('Sincronização concluída!', 'success'), 2000);
}

function exportData(type) {
    showToast(`Exportando ${type}...`, 'info');
    setTimeout(() => showToast(`${type.charAt(0).toUpperCase() + type.slice(1)} exportados com sucesso!`, 'success'), 1500);
}

function testConnection() {
    showToast('Testando conexão...', 'info');
    setTimeout(() => showToast('Conexão OK! API respondeu.', 'success'), 1000);
}

function globalSearchHandler(value) {
    if (!value) return;
    showToast(`Pesquisando por "${value}"...`, 'info');
}


document.addEventListener('DOMContentLoaded', () => {
    document.addEventListener('click', e => {
        if (e.target.classList?.contains('modal-overlay')) {
            e.target.classList.remove('open');
        }
    }, { passive: true });
});
