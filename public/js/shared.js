const DOM = {
    toastContainer: null,
    topbarTitle: null,
    getToastContainer() {
        return this.toastContainer || (this.toastContainer = document.getElementById('toastContainer'));
    },
    getTopbarTitle() {
        return this.topbarTitle || (this.topbarTitle = document.getElementById('topbarTitle'));
    },
};

const scriptLoadCache = new Map();
const APP_LOAD_START = Date.now();
// Não mantém a interface bloqueada artificialmente depois que os dados chegam.
const MIN_LOADER_MS = 0;

function loadScript(src) {
    if (scriptLoadCache.has(src)) return scriptLoadCache.get(src);
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing) {
        const p = Promise.resolve();
        scriptLoadCache.set(src, p);
        return p;
    }
    const p = new Promise((resolve, reject) => {
        const el = document.createElement('script');
        el.src = src;
        el.async = true;
        el.onload = () => resolve();
        el.onerror = () => reject(new Error(`Falha ao carregar: ${src}`));
        document.head.appendChild(el);
    });
    scriptLoadCache.set(src, p);
    return p;
}

window.loadScript = loadScript;

async function ensureHtml2Canvas() {
    if (typeof html2canvas === 'function') return;
    await loadScript('https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js');
}

window.ensureHtml2Canvas = ensureHtml2Canvas;

const AppShell = {
    _finished: false,
    setLoaderText(text) {
        const el = document.getElementById('pageLoaderText');
        if (el) el.textContent = text;
    },
    finishLoading() {
        if (this._finished) return;
        this._finished = true;
        const wait = Math.max(0, MIN_LOADER_MS - (Date.now() - APP_LOAD_START));
        setTimeout(() => {
            document.documentElement.classList.remove('app-is-loading');
            const loader = document.getElementById('pageLoader');
            if (loader) {
                loader.classList.add('is-done');
                loader.setAttribute('aria-busy', 'false');
                setTimeout(() => loader.remove(), 200);
            }
        }, wait);
    },
    failLoading(message) {
        this.setLoaderText(message || 'Erro ao carregar');
        const loader = document.getElementById('pageLoader');
        if (loader) loader.classList.add('has-error');
    }
};

window.AppShell = AppShell;

window.whenAppReady = async function whenAppReady(fn) {
    try {
        await window.__dataReady;
        if (typeof fn === 'function') await fn();
    } catch (err) {
        console.error(err);
        AppShell.failLoading(err?.message || 'Erro ao carregar dados');
        showToast(err?.message || 'Não foi possível carregar os dados.', 'error');
    } finally {
        AppShell.finishLoading();
    }
};

function showToast(msg, type = 'info') {
    const icons = { success: '✓', error: '✕', info: 'ℹ', warning: '⚠' };
    const container = DOM.getToastContainer();
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    const icon = document.createElement('div');
    const message = document.createElement('div');
    icon.className = 'toast-icon';
    message.className = 'toast-msg';
    icon.textContent = icons[type] || 'ℹ';
    message.textContent = String(msg || '');
    toast.append(icon, message);
    container?.appendChild(toast);
    requestAnimationFrame(() => {
        setTimeout(() => {
            toast.classList.add('removing');
            setTimeout(() => toast.remove(), 300);
        }, 3200);
    });
}

let modalReturnFocus = null;

function syncGlobalModalState() {
    const open = Boolean(document.querySelector(
        '.modal-overlay.open, .budget-modal-overlay.open:not([hidden]), .link-modal:not([hidden]), .pdv-modal-overlay.open, .svc-create-overlay:not([hidden]), .svc-tpl-overlay:not([hidden]), .svc-stage-overlay:not([hidden]), .svc-delete-overlay:not([hidden]), .svc-share-overlay:not([hidden])'
    ));
    document.documentElement.classList.toggle('modal-is-open', open);
    if (!open) document.body.style.overflow = '';
}

function openModal(id) {
    const el = document.getElementById('modal-' + id);
    if (el) {
        if (el.parentElement !== document.body) document.body.appendChild(el);
        modalReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        el.classList.add('open');
        el.setAttribute('aria-hidden', 'false');
        document.body.style.overflow = 'hidden';
        syncGlobalModalState();
        requestAnimationFrame(() => el.querySelector('input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled])')?.focus());
    }
}

function closeModal(id) {
    const el = document.getElementById('modal-' + id);
    if (el) {
        el.classList.remove('open');
        el.setAttribute('aria-hidden', 'true');
        syncGlobalModalState();
        modalReturnFocus?.focus?.({ preventScroll: true });
        modalReturnFocus = null;
    }
}

document.addEventListener('click', e => {
    if (e.target?.classList.contains('modal-overlay')) {
        e.target.classList.remove('open');
        e.target.setAttribute('aria-hidden', 'true');
        syncGlobalModalState();
    }
}, { passive: true });

const CURRENCY_FORMATTERS = new Map();
function formatCurrency(value) {
    const amount = Number(value);
    const currency = window.appData?.configs?.currency === 'USD' ? 'USD' : 'BRL';
    if (!CURRENCY_FORMATTERS.has(currency)) {
        CURRENCY_FORMATTERS.set(currency, new Intl.NumberFormat('pt-BR', { style: 'currency', currency }));
    }
    return CURRENCY_FORMATTERS.get(currency).format(Number.isFinite(amount) ? amount : 0);
}

function updateTopbarTitle(title) {
    const el = DOM.getTopbarTitle();
    if (el) el.textContent = title;
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
        let isActive = href === path;
        if (href === '/services' && path.startsWith('/services')) isActive = true;
        link.classList.toggle('active', isActive);
    });
}

function openInstructionsModal() {
    closeSharedNotesModal({ silent: true });
    const modal = document.getElementById('instructionsModal');
    if (modal) {
        modal.classList.add('open');
        document.body.style.overflow = 'hidden';
    }
}

function closeInstructionsModal() {
    const modal = document.getElementById('instructionsModal');
    if (modal) {
        modal.classList.remove('open');
    }
    if (!document.querySelector('.modal-overlay.open')) {
        document.body.style.overflow = '';
    }
}

function formatSharedNotesMeta(notes) {
    if (!notes?.updatedAt && !notes?.updatedBy) {
        return 'Nenhuma alteração registrada ainda.';
    }
    const who = notes.updatedBy?.name || notes.updatedBy?.email || 'Equipe';
    let when = '';
    if (notes.updatedAt) {
        const d = new Date(notes.updatedAt);
        when = Number.isNaN(d.getTime())
            ? String(notes.updatedAt)
            : d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
    }
    return when ? `Última edição: ${who} · ${when}` : `Última edição: ${who}`;
}

async function loadSharedNotes() {
    const textarea = document.getElementById('sharedNotesContent');
    const meta = document.getElementById('sharedNotesMeta');
    const saveBtn = document.getElementById('sharedNotesSaveBtn');
    if (textarea) textarea.disabled = true;
    if (saveBtn) saveBtn.disabled = true;
    if (meta) meta.textContent = 'Carregando…';
    try {
        const res = await fetch('/api/shared-notes', { credentials: 'same-origin' });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || data.error) {
            throw new Error(data.message || 'Falha ao carregar notas.');
        }
        if (textarea) textarea.value = data.notes?.content || '';
        if (meta) meta.textContent = formatSharedNotesMeta(data.notes);
    } catch (e) {
        console.error(e);
        if (meta) meta.textContent = 'Não foi possível carregar as notas.';
        showToast(e.message || 'Erro ao carregar notas.', 'error');
    } finally {
        if (textarea) textarea.disabled = false;
        if (saveBtn) saveBtn.disabled = false;
    }
}

async function openSharedNotesModal() {
    closeInstructionsModal();
    const modal = document.getElementById('sharedNotesModal');
    if (!modal) return;
    modal.classList.add('open');
    document.body.style.overflow = 'hidden';
    await loadSharedNotes();
    document.getElementById('sharedNotesContent')?.focus();
}

function closeSharedNotesModal(opts = {}) {
    const modal = document.getElementById('sharedNotesModal');
    if (modal) modal.classList.remove('open');
    if (!document.querySelector('.modal-overlay.open')) {
        document.body.style.overflow = '';
    }
    if (!opts.silent && typeof showToast === 'function') {
        /* noop — reservado para aviso de alterações não salvas */
    }
}

async function saveSharedNotes() {
    const textarea = document.getElementById('sharedNotesContent');
    const saveBtn = document.getElementById('sharedNotesSaveBtn');
    const meta = document.getElementById('sharedNotesMeta');
    if (!textarea) return;
    if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.textContent = 'Salvando…';
    }
    try {
        const res = await fetch('/api/shared-notes', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({ content: textarea.value })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || data.error) {
            throw new Error(data.message || 'Falha ao salvar notas.');
        }
        if (meta) meta.textContent = formatSharedNotesMeta(data.notes);
        showToast('Notas salvas para toda a equipe.', 'success');
    } catch (e) {
        console.error(e);
        showToast(e.message || 'Erro ao salvar notas.', 'error');
    } finally {
        if (saveBtn) {
            saveBtn.disabled = false;
            saveBtn.textContent = 'Salvar notas';
        }
    }
}

window.openInstructionsModal = openInstructionsModal;
window.closeInstructionsModal = closeInstructionsModal;
window.openSharedNotesModal = openSharedNotesModal;
window.closeSharedNotesModal = closeSharedNotesModal;
window.saveSharedNotes = saveSharedNotes;

function setMobileMenu(open) {
    const value = Boolean(open);
    document.documentElement.classList.toggle('mobile-menu-open', value);
    document.getElementById('mobileMenuBtn')?.setAttribute('aria-expanded', String(value));
}

function updateConnectionStatus() {
    const el = document.getElementById('connectionStatus');
    if (!el) return;
    const online = navigator.onLine;
    el.classList.toggle('is-offline', !online);
    const text = el.querySelector('span');
    if (text) text.textContent = online ? 'Online' : 'Sem conexão';
}

async function logoutCurrentUser() {
    const button = document.getElementById('logoutBtn');
    if (button) button.disabled = true;
    try {
        const response = await fetch('/logout', { method: 'POST', credentials: 'same-origin' });
        if (!response.ok) throw new Error('Não foi possível encerrar a sessão.');
        window.location.assign('/');
    } catch (error) {
        if (button) button.disabled = false;
        showToast(error.message, 'error');
    }
}

document.addEventListener('DOMContentLoaded', () => {
    // Modais dentro de .content seriam posicionados em relação ao scroll dessa área.
    document.querySelectorAll('.modal-overlay, .budget-modal-overlay, .link-modal, .pdv-modal-overlay, .svc-create-overlay, .svc-tpl-overlay, .svc-stage-overlay, .svc-delete-overlay, .svc-share-overlay').forEach((modal) => {
        if (modal.parentElement !== document.body) document.body.appendChild(modal);
    });
    const path = window.location.pathname.replace(/\/$/, '') || '/dashboard';
    markNavActive(path);
    if (!window.__bootstrap) {
        AppShell.finishLoading();
    }
    document.getElementById('pageLoaderRetry')?.addEventListener('click', () => window.location.reload());
    document.getElementById('mobileMenuBtn')?.addEventListener('click', () => setMobileMenu(true));
    document.getElementById('sidebarCloseBtn')?.addEventListener('click', () => setMobileMenu(false));
    document.getElementById('sidebarBackdrop')?.addEventListener('click', () => setMobileMenu(false));
    document.querySelectorAll('#appSidebar .nav-item').forEach((link) => link.addEventListener('click', () => setMobileMenu(false)));
    document.getElementById('logoutBtn')?.addEventListener('click', logoutCurrentUser);
    window.addEventListener('online', updateConnectionStatus);
    window.addEventListener('offline', updateConnectionStatus);
    updateConnectionStatus();
    document.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape') return;
        setMobileMenu(false);
        requestAnimationFrame(syncGlobalModalState);
    });
    document.getElementById('sharedNotesContent')?.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 's') {
            e.preventDefault();
            saveSharedNotes();
        }
    });
});
