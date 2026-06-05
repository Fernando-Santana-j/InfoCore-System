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
