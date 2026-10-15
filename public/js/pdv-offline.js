'use strict';
(async () => {
    const status = document.getElementById('pdvOfflineStatus');
    const show = text => { if (status) status.textContent = text; };
    let savedAt;
    const showSaved = () => show((navigator.onLine ? 'PDV disponível offline neste navegador. Preços atualizados em ' : 'Sem conexão — consulta de preços salvos em ') + new Date(savedAt).toLocaleString('pt-BR') + '. Registros exigem conexão.');
    window.addEventListener('offline', () => { if (savedAt) showSaved(); });
    window.addEventListener('online', () => { if (savedAt) show('Conexão restabelecida. Recarregue o PDV para atualizar preços e estoque.'); });
    try {
        await window.__dataReady;
        if (window.appData.offlineSavedAt) {
            savedAt = window.appData.offlineSavedAt;
            show('Consulta offline — preços salvos em ' + new Date(window.appData.offlineSavedAt).toLocaleString('pt-BR') + '. Estoque e preços podem ter mudado. Registros exigem conexão.');
            return;
        }
        if (!('serviceWorker' in navigator) || !window.isSecureContext) {
            show('Para preparar a consulta offline, acesse por HTTPS ou localhost.');
            return;
        }
        await navigator.serviceWorker.register('/pdv-sw.js', {updateViaCache:'none'});
        const registration = await navigator.serviceWorker.ready;
        const channel = new MessageChannel();
        channel.port1.onmessage = ({data}) => {
            if (data.ok) { savedAt = data.savedAt; showSaved(); }
            else show('Não foi possível atualizar a cópia offline. Tente novamente com conexão.');
            channel.port1.close();
        };
        const assets = [...document.querySelectorAll('script[src], link[rel="stylesheet"], link[rel="icon"], img[src]')].map(el => el.src || el.href).filter(Boolean);
        registration.active.postMessage({type:'PREPARE_PDV', assets}, [channel.port2]);
        show('Preparando consulta offline neste navegador…');
    } catch (_) { show('Consulta offline ainda não preparada. Abra o PDV com conexão para salvar os preços.'); }
})();
