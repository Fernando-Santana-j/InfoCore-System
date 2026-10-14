// O carregamento dos controles é feito em operations.js.
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => whenAppReady(() => {}));
} else {
    whenAppReady(() => {});
}
