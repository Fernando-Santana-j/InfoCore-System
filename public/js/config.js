function initConfig() {
    updateTopbarTitle('Configurações');
    markNavActive('/config');
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        if (typeof initConfig === 'function') initConfig();
    });
} else {
    if (typeof initConfig === 'function') initConfig();
}
