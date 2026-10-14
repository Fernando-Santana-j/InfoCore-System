'use strict';
// Process-local protection. Never retries a write or turns a failed read into data.
function databaseFailure(error) {
    if (error?.databaseUnavailable) return error.reason || 'unavailable';
    const code = String(error?.code ?? '').toUpperCase().replace(/-/g, '_');
    if (['8', 'RESOURCE_EXHAUSTED', 'FIRESTORE/RESOURCE_EXHAUSTED'].includes(code)) return 'quota';
    if (['4', '14', 'DEADLINE_EXCEEDED', 'UNAVAILABLE', 'FIRESTORE/UNAVAILABLE'].includes(code)) return 'unavailable';
    return '';
}
function createAvailability({ now = Date.now, cooldownMs = 60000, log = console.warn } = {}) {
    let until = 0, reason = '', probe = false, lastLog = -Infinity;
    const retryAfter = () => Math.max(1, Math.ceil((until - now()) / 1000));
    function error() {
        return Object.assign(new Error('Banco de dados temporariamente indisponível.'), {databaseUnavailable:true, reason:reason || 'unavailable', status:503, retryAfter:retryAfter()});
    }
    function observe(err) {
        const failure = databaseFailure(err);
        if (!failure) return false;
        if (err.databaseUnavailable) return true;
        reason = failure;
        until = now() + cooldownMs;
        if (now() - lastLog >= cooldownMs) {
            lastLog = now();
            log(`[Firestore] ${failure === 'quota' ? 'Cota excedida' : 'Indisponível'}; novas requisições pausadas por ${Math.ceil(cooldownMs / 1000)}s. Confira o uso e as cotas no Firebase.`);
        }
        return true;
    }
    async function run(task) {
        if (until > now()) throw error();
        try { return await task(); } catch (err) { observe(err); throw err; }
    }
    function gate(req, res, next) {
        if (!reason) return next();
        if (until > now() || probe) return next(error());
        // Only one HTTP request tests recovery after a pause; no operation is replayed.
        probe = true;
        let completed = false;
        const release = () => {
            if (completed) return;
            completed = true;
            probe = false;
            if (res.writableFinished && res.statusCode < 500 && until <= now()) { reason = ''; until = 0; }
            else until = Math.max(until, now() + cooldownMs);
        };
        res.once('finish', release);
        res.once('close', release);
        next();
    }
    function respond(err, req, res, next) {
        const unavailable = observe(err);
        if (res.headersSent) {
            if (!unavailable) return next(err);
            if (!res.writableEnded) res.destroy();
            return;
        }
        const status = unavailable ? 503 : (Number(err?.status) >= 400 && Number(err?.status) < 600 ? Number(err.status) : 500);
        if (!unavailable) console.error(`[HTTP] ${req.method} ${req.path}:`, err);
        if (unavailable) res.setHeader('Retry-After', String(retryAfter()));
        res.setHeader('Cache-Control', 'no-store');
        const message = unavailable
            ? 'O banco de dados está temporariamente indisponível. Aguarde e tente novamente. Antes de repetir uma venda ou pagamento, confira se ele foi registrado.'
            : 'Não foi possível concluir a solicitação. Confira o resultado antes de repetir a operação.';
        if (String(req.path || '').startsWith('/api/')) return res.status(status).json({error:true, code:unavailable ? 'DATABASE_UNAVAILABLE' : 'REQUEST_FAILED', message, ...(unavailable ? {retryAfter:retryAfter()} : {})});
        // Standalone fallback works even if templates/session/database are unavailable.
        return res.status(status).type('html').send(`<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>InfoCore — serviço indisponível</title><body style="font-family:system-ui;background:#0e0e14;color:#eee;padding:24px"><main style="max-width:560px;margin:12vh auto;line-height:1.7"><h1>${unavailable ? 'Indisponibilidade temporária' : 'Não foi possível concluir'}</h1><p>${message}</p><p>Se houver um formulário aberto, mantenha a página para preservar o preenchimento.</p><a href="/dashboard" style="color:#5eead4">Tentar acessar novamente</a></main></body></html>`);
    }
    return {run, observe, gate, respond, state:()=>({available:!reason, retryAfter:reason ? retryAfter() : 0})};
}
module.exports = {...createAvailability(), createAvailability, databaseFailure};
