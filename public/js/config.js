let waPollTimer = null;

const WA_STATUS_LABELS = {
    disconnected: 'Desconectado',
    connecting: 'Conectando...',
    qr: 'Aguardando QR',
    connected: 'Conectado'
};

function waIsAdmin() {
    return String(window.appData?.user?.type || '') === 'admin';
}

async function fetchWaStatus() {
    const res = await fetch('/api/whatsapp/status', { credentials: 'same-origin' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.error) throw new Error(data.message || 'Erro ao consultar WhatsApp.');
    return data;
}

function renderWaUi(data) {
    const pill = document.getElementById('waStatusPill');
    const qrPanel = document.getElementById('waQrPanel');
    const qrImg = document.getElementById('waQrImg');
    const connectedPanel = document.getElementById('waConnectedPanel');
    const phoneEl = document.getElementById('waConnectedPhone');
    const errEl = document.getElementById('waErrorMsg');
    const connectBtn = document.getElementById('waConnectBtn');
    const disconnectBtn = document.getElementById('waDisconnectBtn');
    const card = document.getElementById('waConfigCard');

    if (!pill || !card) return;

    const st = data.status || 'disconnected';
    pill.textContent = WA_STATUS_LABELS[st] || st;
    pill.className = `wa-status-pill is-${st}`;

    if (errEl) {
        if (data.lastError) {
            errEl.hidden = false;
            errEl.textContent = data.lastError;
        } else {
            errEl.hidden = true;
        }
    }

    if (st === 'connected') {
        qrPanel?.setAttribute('hidden', '');
        connectedPanel?.removeAttribute('hidden');
        if (phoneEl) phoneEl.textContent = data.phone ? `+${data.phone}` : 'sessão ativa';
        connectBtn?.setAttribute('hidden', '');
        disconnectBtn?.removeAttribute('hidden');
        stopWaPoll();
        return;
    }

    connectedPanel?.setAttribute('hidden', '');
    disconnectBtn?.setAttribute('hidden', '');
    connectBtn?.removeAttribute('hidden');

    if (st === 'qr' && data.qrDataUrl) {
        qrPanel?.removeAttribute('hidden');
        if (qrImg) qrImg.src = data.qrDataUrl;
        startWaPoll();
        return;
    }

    if (st === 'connecting') {
        qrPanel?.setAttribute('hidden', '');
        startWaPoll();
        return;
    }

    qrPanel?.setAttribute('hidden', '');
    stopWaPoll();
}

function startWaPoll() {
    if (waPollTimer) return;
    waPollTimer = setInterval(async () => {
        if (document.hidden) return;
        try {
            const data = await fetchWaStatus();
            renderWaUi(data);
            if (data.status === 'connected' || data.status === 'disconnected') {
                if (data.status === 'disconnected' && !data.lastError) stopWaPoll();
                if (data.status === 'connected') stopWaPoll();
            }
        } catch (e) {
            console.error(e);
        }
    }, 2500);
}

async function configRequest(url, options) {
    const response = await fetch(url, { credentials: 'same-origin', ...options, headers: { 'Content-Type': 'application/json', ...(options?.headers || {}) } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.error) throw new Error(data.message || 'Não foi possível salvar.');
    return data;
}

async function runConfigAction(button, loadingText, action) {
    if (!button || button.disabled) return;
    const original = button.textContent;
    button.disabled = true;
    button.textContent = loadingText;
    try { await action(); } catch (error) { showToast(error.message, 'error'); }
    finally { button.disabled = false; button.textContent = original; }
}

function bindRealConfigForms() {
    const saveStore = document.getElementById('saveStoreBtn');
    saveStore?.addEventListener('click', () => runConfigAction(saveStore, 'Salvando…', async () => {
        const payload = {
            storeName: document.getElementById('storeName')?.value.trim(),
            storeDoc: document.getElementById('storeDoc')?.value.trim(),
            storeAddress: document.getElementById('storeAddress')?.value.trim(),
            storePhone: document.getElementById('storePhone')?.value.trim()
        };
        if (!payload.storeName) throw new Error('Informe o nome da loja.');
        const data = await configRequest('/api/config', { method: 'PUT', body: JSON.stringify(payload) });
        Object.assign(window.appData.configs, data.configs || payload);
        showToast('Dados da loja salvos.', 'success');
    }));

    const savePreferences = document.getElementById('savePreferencesBtn');
    savePreferences?.addEventListener('click', () => runConfigAction(savePreferences, 'Salvando…', async () => {
        const payload = {
            currency: document.getElementById('currency')?.value || 'BRL',
            defaultMinStock: Number(document.getElementById('defaultMinStock')?.value) || 0
        };
        const data = await configRequest('/api/config', { method: 'PUT', body: JSON.stringify(payload) });
        Object.assign(window.appData.configs, data.configs || payload);
        showToast('Preferências salvas.', 'success');
    }));

    const changePassword = document.getElementById('changePasswordBtn');
    changePassword?.addEventListener('click', () => runConfigAction(changePassword, 'Alterando…', async () => {
        const currentPassword = document.getElementById('currentPassword')?.value || '';
        const newPassword = document.getElementById('newPassword')?.value || '';
        const confirmation = document.getElementById('confirmPassword')?.value || '';
        if (!currentPassword) throw new Error('Informe a senha atual.');
        if (newPassword.length < 6) throw new Error('A nova senha deve ter pelo menos 6 caracteres.');
        if (newPassword !== confirmation) throw new Error('A confirmação da nova senha não confere.');
        await configRequest('/api/account/password', { method: 'PUT', body: JSON.stringify({ currentPassword, newPassword }) });
        ['currentPassword', 'newPassword', 'confirmPassword'].forEach((id) => { const input = document.getElementById(id); if (input) input.value = ''; });
        showToast('Senha alterada com sucesso.', 'success');
    }));
}

function stopWaPoll() {
    if (waPollTimer) {
        clearInterval(waPollTimer);
        waPollTimer = null;
    }
}

async function waConnect() {
    const btn = document.getElementById('waConnectBtn');
    if (btn) {
        btn.disabled = true;
        btn.textContent = 'Gerando QR...';
    }
    try {
        const res = await fetch('/api/whatsapp/connect', {
            method: 'POST',
            credentials: 'same-origin'
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || data.error) throw new Error(data.message || 'Erro ao conectar.');
        renderWaUi(data);
        showToast('Escaneie o QR Code no celular.', 'info');
        startWaPoll();
    } catch (e) {
        showToast(e.message || 'Erro ao conectar.', 'error');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.textContent = 'Conectar / Gerar QR';
        }
    }
}

async function waDisconnect() {
    if (!confirm('Desconectar o WhatsApp desta loja? Será necessário escanear o QR novamente.')) return;
    stopWaPoll();
    try {
        const res = await fetch('/api/whatsapp/disconnect', {
            method: 'POST',
            credentials: 'same-origin'
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || data.error) throw new Error(data.message || 'Erro ao desconectar.');
        renderWaUi(data);
        showToast('WhatsApp desconectado.', 'success');
    } catch (e) {
        showToast(e.message || 'Erro ao desconectar.', 'error');
    }
}

function bindWhatsAppConfig() {
    if (!waIsAdmin()) {
        const card = document.getElementById('waConfigCard');
        if (card) {
            card.innerHTML = '<div class="card-header"><div class="card-title">💬 WhatsApp</div></div><p class="wa-config-desc">Somente administradores podem conectar o WhatsApp da loja.</p>';
        }
        return;
    }
    document.getElementById('waConnectBtn')?.addEventListener('click', waConnect);
    document.getElementById('waDisconnectBtn')?.addEventListener('click', waDisconnect);

    const initial = window.appData?.whatsapp;
    if (initial) {
        renderWaUi(initial);
    } else {
        fetchWaStatus().then(renderWaUi).catch((e) => {
            console.error(e);
            const pill = document.getElementById('waStatusPill');
            if (pill) pill.textContent = 'Indisponível';
        });
    }
}

function initConfig() {
    updateTopbarTitle('Configurações');
    markNavActive('/config');
    bindWhatsAppConfig();
    bindRealConfigForms();
}

function bootConfig() {
    whenAppReady(() => {
        initConfig();
    });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootConfig);
} else {
    bootConfig();
}

window.addEventListener('pagehide', stopWaPoll);
