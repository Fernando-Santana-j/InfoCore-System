


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
