'use strict';
window.__offlineReady = (async () => {
    const status = document.getElementById('pdvOfflineStatus');
    const show = text => { if (status) status.textContent = text; };
    const showOfflinePage = () => {
        if (navigator.onLine || ['pdv', 'budgets'].includes(window.__page)) return;
        const content = document.getElementById('content');
        if (content) content.innerHTML = '<div class="empty-state" role="status"><h1>Você está offline</h1><p>Esta página precisa de conexão. Use o menu para consultar o PDV e os orçamentos salvos.</p></div>';
        window.AppShell?.finishLoading();
    };
    window.addEventListener('offline', showOfflinePage);
    showOfflinePage();
    let savedAt;
    const scope = window.__page === 'budgets' ? 'budgets' : 'pdv';
    const label = scope === 'budgets' ? 'Orçamentos' : 'PDV';
    const showSaved = () => show((navigator.onLine ? label + ' disponível offline neste navegador. Dados atualizados em ' : 'Sem conexão — consulta de dados salvos em ') + new Date(savedAt).toLocaleString('pt-BR') + '. Registros exigem conexão.');
    window.addEventListener('offline', () => { if (savedAt) showSaved(); });
    window.addEventListener('online', () => { if (savedAt) show('Conexão restabelecida. Recarregue a página para atualizar os dados.'); });
    try {
        await window.__dataReady;
        if (window.appData.offlineSavedAt) {
            savedAt = window.appData.offlineSavedAt;
            show('Consulta offline — dados salvos em ' + new Date(savedAt).toLocaleString('pt-BR') + '. Os dados podem ter mudado. Registros exigem conexão.');
            return;
        }
        if (!('serviceWorker' in navigator) || !window.isSecureContext) {
            show('Para preparar a consulta offline, acesse por HTTPS ou localhost.');
            return;
        }
        await navigator.serviceWorker.register('/pdv-sw.js', {updateViaCache:'none'});
        const registration = await navigator.serviceWorker.ready;
        const assets = [...document.querySelectorAll('script[src], link[rel="stylesheet"], link[rel="icon"], img[src]')].map(el => el.src || el.href).filter(Boolean);
        // A página de contingência guarda somente o menu permitido ao usuário, sem o conteúdo da área atual.
        const sidebar = document.getElementById('appSidebar')?.outerHTML || '';
        const styles = [...document.querySelectorAll('link[rel="stylesheet"]')].filter(el => /\/(style-root|style-shared|app-theme)\.css/.test(el.href)).map(el => el.outerHTML).join('');
        const shared = document.querySelector('script[src*="/js/shared.js"]')?.outerHTML || '';
        const shell = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>InfoCore — Offline</title>${styles}</head><body><div class="app">${sidebar}<main class="main"><header class="topbar"><button class="icon-btn mobile-menu-btn" id="mobileMenuBtn" aria-label="Abrir menu" aria-controls="appSidebar">☰</button><div class="topbar-title">Offline</div></header><div class="content"><div class="empty-state" role="status"><h1>Você está offline</h1><p>Esta página precisa de conexão. Use o menu para consultar o PDV e os orçamentos salvos.</p></div></div></main></div><button class="sidebar-backdrop" id="sidebarBackdrop" aria-label="Fechar menu"></button><div id="toastContainer" class="toast-container"></div>${shared}</body></html>`;
        const prepare = target => new Promise(resolve => {
            const channel = new MessageChannel();
            const timeout = setTimeout(() => { channel.port1.close(); resolve({ok:false}); }, 60000);
            channel.port1.onmessage = ({data}) => { clearTimeout(timeout); channel.port1.close(); resolve(data); };
            registration.active.postMessage({type:'PREPARE_PDV', scope:target, owner:JSON.stringify(window.appData?.user || {}), assets, shell}, [channel.port2]);
        });
        show('Preparando consulta offline neste navegador…');
        const scopes = window.appData?.user?.type === 'technician' ? ['budgets'] : [scope, scope === 'pdv' ? 'budgets' : 'pdv'];
        for (const target of scopes) {
            const result = await prepare(target);
            if (target === scope) {
                if (result.ok) { savedAt = result.savedAt; showSaved(); }
                else show('Não foi possível atualizar a cópia offline. Tente novamente com conexão.');
            }
        }
    } catch (_) { show('Consulta offline ainda não preparada. Abra o sistema com conexão para salvar os dados.'); }
})();
