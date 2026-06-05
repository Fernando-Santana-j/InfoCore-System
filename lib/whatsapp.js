/**
 * WhatsApp via Baileys — conexão com QR, sessão persistida, envio de texto e imagens.
 */
const fs = require('fs');
const path = require('path');
const QRCode = require('qrcode');
const pino = require('pino');

const SESSION_DIR = path.join(__dirname, '..', 'data', 'whatsapp-session');

let sock = null;
let connecting = false;
let intentionalStop = false;
let reconnectTimer = null;
let reconnectAttempts = 0;
let sendChain = Promise.resolve();
let status = 'disconnected';
let qrRaw = '';
let qrDataUrl = '';
let connectedPhone = '';
let lastError = '';

const logger = pino({ level: 'silent' });

function setStatus(next, extra = {}) {
    status = next;
    if (extra.qr != null) qrRaw = String(extra.qr);
    if (extra.qrDataUrl != null) qrDataUrl = extra.qrDataUrl;
    if (extra.phone != null) connectedPhone = String(extra.phone);
    if (extra.error != null) lastError = String(extra.error);
}

async function loadBaileys() {
    return import('@whiskeysockets/baileys');
}

function hasSavedSession() {
    try {
        return fs.existsSync(path.join(SESSION_DIR, 'creds.json'));
    } catch {
        return false;
    }
}

function sessionExists() {
    return hasSavedSession();
}

function normalizePhoneDigits(raw) {
    let digits = String(raw || '').replace(/\D/g, '');
    if (!digits) return '';
    if (digits.length >= 10 && digits.length <= 11 && !digits.startsWith('55')) {
        digits = `55${digits}`;
    }
    return digits;
}

/** Variantes com/sem 9º dígito (celular BR). */
function brazilPhoneDigitVariants(digits) {
    const set = new Set();
    if (!digits) return [];
    set.add(digits);
    if (!digits.startsWith('55')) return [...set];
    const national = digits.slice(2);
    if (national.length === 10) {
        const ddd = national.slice(0, 2);
        const rest = national.slice(2);
        if (rest.length === 8 && /^[6-9]/.test(rest)) {
            set.add(`55${ddd}9${rest}`);
        }
    }
    if (national.length === 11 && national[2] === '9') {
        const ddd = national.slice(0, 2);
        const rest = national.slice(3);
        if (rest.length === 8) set.add(`55${ddd}${rest}`);
    }
    return [...set];
}

function phoneToJid(raw) {
    const digits = normalizePhoneDigits(raw);
    return digits ? `${digits}@s.whatsapp.net` : '';
}

function digitsToJid(digits) {
    return digits ? `${digits}@s.whatsapp.net` : '';
}

async function resolveRecipientJid(activeSock, phone) {
    const variants = brazilPhoneDigitVariants(normalizePhoneDigits(phone));
    if (!variants.length) throw new Error('Telefone inválido.');

    if (typeof activeSock.onWhatsApp === 'function') {
        for (const digits of variants) {
            const jid = digitsToJid(digits);
            try {
                const rows = await activeSock.onWhatsApp(jid);
                const hit = Array.isArray(rows) ? rows.find((r) => r?.exists && r?.jid) : null;
                if (hit?.jid) return hit.jid;
            } catch (e) {
                console.warn('[WhatsApp] onWhatsApp:', e.message);
            }
        }
        throw new Error('Número não encontrado no WhatsApp. Confira DDD e o 9º dígito do celular.');
    }

    return digitsToJid(variants[0]);
}

function assertSendResult(result, label) {
    if (!result?.key?.id) {
        throw new Error(`WhatsApp não confirmou o envio${label ? ` (${label})` : ''}.`);
    }
    return result;
}

function getStatus() {
    return {
        status,
        connected: status === 'connected',
        qrDataUrl: status === 'qr' ? qrDataUrl : '',
        phone: connectedPhone,
        sessionExists: hasSavedSession(),
        lastError: lastError || null
    };
}

function isReady() {
    return status === 'connected' && sock != null;
}

function clearReconnectTimer() {
    if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
    }
}

function scheduleReconnect(reason) {
    if (intentionalStop) return;
    if (reconnectTimer) return;
    if (reconnectAttempts >= 12) {
        setStatus('disconnected', { error: 'Muitas tentativas. Vá em Configurações e reconecte.' });
        return;
    }
    reconnectAttempts += 1;
    const delay = Math.min(15000, 2000 * reconnectAttempts);
    setStatus('connecting', { error: reason || 'Reconectando...' });
    reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        start({ fromReconnect: true, force: true }).catch((e) => {
            console.error('[WhatsApp] reconexão:', e.message);
            scheduleReconnect('Tentando reconectar...');
        });
    }, delay);
}

async function updateQrDataUrl(qr) {
    try {
        const dataUrl = await QRCode.toDataURL(qr, { width: 280, margin: 2 });
        setStatus('qr', { qr, qrDataUrl: dataUrl, error: '' });
    } catch (e) {
        setStatus('qr', { qr, error: e.message });
    }
}

function detachSocketListeners(current) {
    if (!current?.ev) return;
    try {
        current.ev.removeAllListeners('connection.update');
        current.ev.removeAllListeners('creds.update');
    } catch (_) { /* ignore */ }
}

async function destroySocket() {
    const current = sock;
    sock = null;
    if (!current) return;
    detachSocketListeners(current);
    try {
        current.end(undefined);
    } catch (_) { /* ignore */ }
    await new Promise((r) => setTimeout(r, 400));
}

async function createSocket() {
    const baileys = await loadBaileys();
    const {
        default: makeWASocket,
        useMultiFileAuthState,
        fetchLatestBaileysVersion,
        DisconnectReason,
        makeCacheableSignalKeyStore
    } = baileys;

    if (!fs.existsSync(SESSION_DIR)) {
        fs.mkdirSync(SESSION_DIR, { recursive: true });
    }

    const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);
    const { version } = await fetchLatestBaileysVersion();

    const socket = makeWASocket({
        version,
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, logger)
        },
        printQRInTerminal: false,
        logger,
        browser: ['InfoCore', 'Chrome', '1.0.0'],
        syncFullHistory: false,
        shouldSyncHistoryMessage: () => true,
        markOnlineOnConnect: false,
        generateHighQualityLinkPreview: false,
        keepAliveIntervalMs: 25000,
        connectTimeoutMs: 60000,
        defaultQueryTimeoutMs: 60000
    });

    socket.ev.on('creds.update', saveCreds);

    socket.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            await updateQrDataUrl(qr);
        }

        if (connection === 'open') {
            reconnectAttempts = 0;
            clearReconnectTimer();
            sock = socket;
            const me = socket.user?.id || '';
            const phone = me.split(':')[0] || me.split('@')[0] || '';
            setStatus('connected', { phone, error: '' });
            qrRaw = '';
            qrDataUrl = '';
            console.log('[WhatsApp] Conectado:', phone || 'ok');
        }

        if (connection === 'close') {
            const code = lastDisconnect?.error?.output?.statusCode;
            const loggedOut = code === DisconnectReason.loggedOut;
            const restartRequired = code === DisconnectReason.restartRequired;
            const timedOut = code === DisconnectReason.timedOut;

            if (sock === socket) sock = null;
            detachSocketListeners(socket);

            if (intentionalStop) {
                setStatus('disconnected', { error: '' });
                return;
            }

            if (loggedOut) {
                clearReconnectTimer();
                reconnectAttempts = 0;
                setStatus('disconnected', { phone: '', error: 'Sessão encerrada. Escaneie o QR novamente.' });
                try {
                    if (fs.existsSync(SESSION_DIR)) {
                        fs.rmSync(SESSION_DIR, { recursive: true, force: true });
                    }
                } catch (e) {
                    console.error('[WhatsApp] limpar sessão', e);
                }
                return;
            }

            if (restartRequired || timedOut) {
                scheduleReconnect(restartRequired ? 'Sincronizando...' : 'Reconectando...');
                return;
            }

            if (status === 'qr' || !hasSavedSession()) {
                setStatus('disconnected', { error: 'Conexão interrompida. Gere um novo QR Code.' });
                return;
            }

            scheduleReconnect('Conexão perdida. Reconectando...');
        }
    });

    return socket;
}

async function start(options = {}) {
    if (connecting) return getStatus();
    if (status === 'connected' && sock && !options.force) return getStatus();

    intentionalStop = false;
    clearReconnectTimer();
    connecting = true;
    if (!options.fromReconnect) {
        setStatus('connecting', { error: '' });
    }

    try {
        if (options.force || !sock) {
            await destroySocket();
            sock = await createSocket();
        }
        return getStatus();
    } catch (e) {
        console.error('[WhatsApp] start:', e.message);
        setStatus('disconnected', { error: e.message || 'Falha ao iniciar.' });
        sock = null;
        throw e;
    } finally {
        connecting = false;
    }
}

async function startIfSessionExists() {
    if (!hasSavedSession()) return getStatus();
    if (process.env.WHATSAPP_AUTO_CONNECT === 'false') return getStatus();
    try {
        return await start({ fromReconnect: true });
    } catch (e) {
        console.error('[WhatsApp] auto-start:', e.message);
        return getStatus();
    }
}

async function logout() {
    intentionalStop = true;
    clearReconnectTimer();
    reconnectAttempts = 0;

    if (sock) {
        try {
            await sock.logout();
        } catch (e) {
            console.error('[WhatsApp] logout:', e.message);
        }
    }
    await destroySocket();

    try {
        if (fs.existsSync(SESSION_DIR)) {
            fs.rmSync(SESSION_DIR, { recursive: true, force: true });
        }
    } catch (e) {
        console.error('[WhatsApp] rm session', e);
    }

    setStatus('disconnected', { phone: '', qr: '', qrDataUrl: '', error: '' });
    return getStatus();
}

async function waitUntilReady(timeoutMs = 60000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (isReady()) return true;
        if (!connecting && status === 'disconnected' && hasSavedSession()) {
            await start({ fromReconnect: true, force: true }).catch(() => {});
        }
        await new Promise((r) => setTimeout(r, 600));
    }
    return isReady();
}

async function ensureConnected() {
    if (isReady()) return sock;
    if (!hasSavedSession()) {
        throw new Error('WhatsApp não conectado. Vá em Configurações e escaneie o QR Code.');
    }
    if (!connecting) {
        await start({ fromReconnect: true, force: true });
    }
    const ok = await waitUntilReady(45000);
    if (!ok || !sock) {
        throw new Error('WhatsApp desconectado. Abra Configurações e verifique a conexão.');
    }
    return sock;
}

function enqueueSend(task) {
    const run = sendChain.then(() => task());
    sendChain = run.catch(() => {});
    return run;
}

async function sendWithRetry(fn, attempts = 3) {
    let lastErr;
    for (let i = 0; i < attempts; i++) {
        try {
            await ensureConnected();
            return await fn(sock);
        } catch (e) {
            lastErr = e;
            const msg = String(e?.message || e);
            const retryable = /closed|disconnect|timed out|connection|socket|session/i.test(msg);
            if (!retryable || i >= attempts - 1) break;
            sock = null;
            setStatus('connecting', { error: 'Reconectando para enviar...' });
            await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
            await start({ force: true, fromReconnect: true });
        }
    }
    throw lastErr || new Error('Falha ao enviar mensagem.');
}

async function sendText(phone, text) {
    return enqueueSend(async () => {
        const message = String(text || '').trim();
        if (!message) throw new Error('Mensagem vazia.');
        let lastJid = '';
        let messageId = '';
        await sendWithRetry(async (activeSock) => {
            const jid = await resolveRecipientJid(activeSock, phone);
            lastJid = jid;
            const result = await activeSock.sendMessage(jid, { text: message });
            assertSendResult(result, 'texto');
            messageId = result.key.id;
            return result;
        });
        return { sent: true, to: lastJid, messageId };
    });
}

async function sendImage(phone, filePath, caption = '') {
    return enqueueSend(async () => {
        const abs = path.isAbsolute(filePath) ? filePath : path.join(__dirname, '..', filePath);
        if (!fs.existsSync(abs)) throw new Error('Arquivo de imagem não encontrado.');
        const cap = String(caption || '').trim() || undefined;
        let lastJid = '';
        let messageId = '';
        await sendWithRetry(async (activeSock) => {
            const jid = await resolveRecipientJid(activeSock, phone);
            lastJid = jid;
            const result = await activeSock.sendMessage(jid, {
                image: fs.readFileSync(abs),
                caption: cap
            });
            assertSendResult(result, 'imagem');
            messageId = result.key.id;
            return result;
        });
        await new Promise((r) => setTimeout(r, 800));
        return { sent: true, to: lastJid, messageId };
    });
}

async function sendDocument(phone, filePath, opts = {}) {
    return enqueueSend(async () => {
        const abs = path.isAbsolute(filePath) ? filePath : path.join(__dirname, '..', filePath);
        if (!fs.existsSync(abs)) throw new Error('Arquivo não encontrado.');
        const fileName = String(opts.fileName || path.basename(abs)).trim() || path.basename(abs);
        const mimetype = String(opts.mimetype || 'application/octet-stream').trim();
        const cap = String(opts.caption || '').trim() || undefined;
        let lastJid = '';
        let messageId = '';
        await sendWithRetry(async (activeSock) => {
            const jid = await resolveRecipientJid(activeSock, phone);
            lastJid = jid;
            const result = await activeSock.sendMessage(jid, {
                document: fs.readFileSync(abs),
                mimetype,
                fileName,
                caption: cap
            });
            assertSendResult(result, 'documento');
            messageId = result.key.id;
            return result;
        });
        await new Promise((r) => setTimeout(r, 800));
        return { sent: true, to: lastJid, messageId };
    });
}

module.exports = {
    getStatus,
    isReady,
    start,
    startIfSessionExists,
    logout,
    sendText,
    sendImage,
    sendDocument,
    phoneToJid,
    sessionExists,
    hasSavedSession,
    ensureConnected
};
