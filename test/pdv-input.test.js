const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../public/js/pdv.js'), 'utf8');

function setup() {
    const documentEvents = {}, windowEvents = {}, frames = [], added = [], toasts = [];
    const timers = new Map();
    let now = 0, timerId = 0;
    function advance(ms) {
        now += ms;
        for (const [id, timer] of timers) if (timer.at <= now) { timers.delete(id); timer.fn(); }
    }
    const document = {
        readyState: 'loading', body: { dataset: { page: 'pdv' } },
        addEventListener(type, fn) { (documentEvents[type] ||= []).push(fn); },
        querySelector() { return this.modalOpen ? {} : null; },
        getElementById(id) { return elements[id] || null; }
    };
    function input() {
        return {
            value: '', selectionStart: 0, selectionEnd: 0, listeners: {}, matches: () => true,
            setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; },
            addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); },
            focus() { document.activeElement = this; },
            select() { this.selected = true; },
            closest() { return this; }
        };
    }
    const elements = { pdvBarcodeCapture: input(), pdvSearch: input(), pdvCustomerName: input() };
    const context = vm.createContext({
        document, window: {
            appData: { products: [{ id: 'p1', sku: '00123456', name: 'Produto' }, { id: 'p2', sku: '78912345', name: 'Produto 2' }] },
            addEventListener(type, fn) { (windowEvents[type] ||= []).push(fn); }
        },
        requestAnimationFrame: fn => frames.push(fn),
        performance: { now: () => now },
        setTimeout(fn, ms) { const id = ++timerId; timers.set(id, { fn, at: now + ms }); return id; },
        clearTimeout: id => timers.delete(id),
        showToast: (...args) => toasts.push(args)
    });
    vm.runInContext(source, context);
    context.addToCart = id => added.push(id);
    context.filterPDV = () => {};
    context.bindPDVBarcodeCapture();
    function key(target, key, extra = {}) {
        const event = { key, target, preventDefault() { this.prevented = true; }, stopPropagation() {}, ...extra };
        for (const fn of windowEvents.keydown || []) fn(event);
        for (const fn of target.listeners.keydown || []) fn(event);
        if (!event.prevented && key.length === 1) {
            const edit = { inputType: 'insertText', data: key, ...extra };
            for (const fn of target.listeners.beforeinput || []) fn(edit);
            const start = target.selectionStart;
            target.value = target.value.slice(0, start) + key + target.value.slice(target.selectionEnd);
            target.setSelectionRange(start + 1, start + 1);
            for (const fn of target.listeners.input || []) fn(edit);
        }
        return event;
    }
    return { context, document, elements, added, toasts, key, advance, documentEvents, flush() { while (frames.length) frames.shift()(); } };
}

test('pesquisa e cliente preservam digitação rápida, inclusive códigos existentes e Enter', () => {
    const h = setup();
    for (const input of [h.elements.pdvSearch, h.elements.pdvCustomerName]) {
        input.focus();
        for (const char of '123abc') assert.ok(!h.key(input, char).prevented);
        assert.ok(!h.key(input, 'Enter').prevented);
        assert.equal(input.value, '123abc');
    }
    assert.deepEqual(h.added, []);
});

test('leitor adiciona uma vez por Enter, limpa só seu campo e permite leituras seguidas', () => {
    const h = setup(), barcode = h.elements.pdvBarcodeCapture;
    h.context.bindPDVBarcodeCapture(); // Binding must remain idempotent.
    h.elements.pdvSearch.value = 'pesquisa mantida';
    barcode.focus();
    for (let i = 0; i < 2; i++) {
        for (const char of '00123456') h.key(barcode, char);
        assert.equal(h.added.length, i);
        assert.ok(h.key(barcode, 'Enter').prevented);
        assert.equal(barcode.value, '');
    }
    assert.deepEqual(h.added, ['p1', 'p1']);
    assert.equal(h.elements.pdvSearch.value, 'pesquisa mantida');
    assert.equal(h.document.activeElement, barcode);
});

test('código desconhecido é informado sem prender o leitor; composição não confirma', () => {
    const h = setup(), barcode = h.elements.pdvBarcodeCapture;
    barcode.value = '99999999';
    h.key(barcode, 'Enter');
    assert.equal(barcode.value, '');
    assert.equal(h.toasts.length, 1);
    barcode.value = '00123456';
    assert.ok(!h.key(barcode, 'Enter', { isComposing: true }).prevented);
    assert.deepEqual(h.added, []);
});

test('foco padrão e após cliques respeita pesquisa, cliente, edição rica e modais', () => {
    const h = setup();
    h.document.activeElement = h.document.body;
    h.context.focusPdvBarcodeCapture();
    assert.equal(h.document.activeElement, h.elements.pdvBarcodeCapture);
    for (const active of [h.elements.pdvSearch, h.elements.pdvCustomerName, { isContentEditable: true }]) {
        h.document.activeElement = active;
        h.context.focusPdvBarcodeCapture();
        assert.equal(h.document.activeElement, active);
    }
    const button = { closest: () => null };
    h.document.activeElement = button;
    h.document.modalOpen = true;
    h.documentEvents.click[0]({ target: button });
    h.flush();
    assert.equal(h.document.activeElement, button);
    h.document.modalOpen = false;
    h.documentEvents.click[0]({ target: button });
    h.flush();
    assert.equal(h.document.activeElement, h.elements.pdvBarcodeCapture);
});

test('leitura automática sem Enter na pesquisa restaura texto, seleção e foco', () => {
    const h = setup(), search = h.elements.pdvSearch;
    search.value = 'cabo USB';
    search.setSelectionRange(5, 8);
    search.focus();
    for (const char of '78912345') { h.key(search, char); h.advance(8); }
    h.advance(150);
    assert.deepEqual(h.added, ['p2']);
    assert.equal(search.value, 'cabo USB');
    assert.equal(search.selectionStart, 5);
    assert.equal(search.selectionEnd, 8);
    assert.equal(h.document.activeElement, search);
    h.advance(500);
    assert.equal(h.added.length, 1);
});

test('pesquisa rápida de letras e sequências fora de oito números não são apagadas', () => {
    for (const [code, interval] of [['789123456', 8], ['7891234567890', 8], ['texto rapido desconhecido', 8], ['1234567', 8], ['ab12cd34ef56gh78', 8]]) {
        const h = setup(), search = h.elements.pdvSearch;
        search.focus();
        for (const char of code) { h.key(search, char); h.advance(interval); }
        h.advance(200);
        assert.equal(search.value, code);
        assert.deepEqual(h.added, []);
    }
});

test('campo do leitor adiciona automaticamente sem Enter e não duplica com sufixo Enter', () => {
    const h = setup(), barcode = h.elements.pdvBarcodeCapture;
    barcode.focus();
    for (const char of '00123456') { h.key(barcode, char); h.advance(8); }
    h.advance(200);
    h.key(barcode, 'Enter');
    h.advance(200);
    assert.deepEqual(h.added, ['p1']);
    assert.equal(barcode.value, '');
});

test('edição e troca de foco cancelam a detecção pendente da pesquisa', () => {
    for (const cancel of ['edit', 'blur']) {
        const h = setup(), search = h.elements.pdvSearch;
        search.focus();
        for (const char of '78912345') { h.key(search, char); h.advance(8); }
        if (cancel === 'edit') {
            for (const fn of search.listeners.beforeinput) fn({ inputType: 'deleteContentBackward' });
            search.value = '789123456789';
        } else {
            h.elements.pdvCustomerName.focus();
            for (const fn of search.listeners.blur) fn({});
        }
        const preserved = search.value;
        h.advance(200);
        assert.equal(search.value, preserved);
        assert.deepEqual(h.added, []);
    }
});

test('Enter enviado pelo leitor confirma apenas uma vez e preserva a pesquisa', () => {
    const h = setup(), search = h.elements.pdvSearch;
    search.value = 'cabo';
    search.setSelectionRange(4, 4);
    search.focus();
    for (const char of '78912345') { h.key(search, char); h.advance(8); }
    assert.ok(h.key(search, 'Enter').prevented);
    h.advance(250);
    assert.deepEqual(h.added, ['p2']);
    assert.equal(search.value, 'cabo');
});

test('colar um código na pesquisa não aciona venda automática', () => {
    const h = setup(), search = h.elements.pdvSearch;
    search.focus();
    for (const fn of search.listeners.beforeinput) fn({ inputType: 'insertFromPaste', data: '78912345' });
    search.value = '78912345';
    for (const fn of search.listeners.input) fn({ inputType: 'insertFromPaste' });
    h.advance(250);
    assert.equal(search.value, '78912345');
    assert.deepEqual(h.added, []);
});

test('oito números são reconhecidos independentemente da velocidade, incluindo zeros iniciais', () => {
    for (const interval of [2, 60, 250]) {
        for (const field of ['pdvSearch', 'pdvBarcodeCapture']) {
            const h = setup(), input = h.elements[field];
            input.focus();
            for (const char of '00123456') { h.key(input, char); h.advance(interval); }
            h.advance(250);
            assert.deepEqual(h.added, ['p1']);
            assert.equal(input.value, '');
        }
    }
});

test('letras rápidas antes e depois de uma leitura permanecem na pesquisa', () => {
    const h = setup(), search = h.elements.pdvSearch;
    search.focus();
    for (const char of 'cabo USB ') { h.key(search, char); h.advance(2); }
    for (const char of '00123456') { h.key(search, char); h.advance(2); }
    h.advance(150);
    for (const char of 'preto') { h.key(search, char); h.advance(2); }
    h.advance(150);
    assert.equal(search.value, 'cabo USB preto');
    assert.deepEqual(h.added, ['p1']);
});

test('código de oito números não cadastrado preserva a pesquisa e informa o erro', () => {
    const h = setup(), search = h.elements.pdvSearch;
    search.value = 'cabo';
    search.setSelectionRange(4, 4);
    search.focus();
    for (const char of '99999999') h.key(search, char);
    h.advance(200);
    assert.equal(search.value, 'cabo');
    assert.deepEqual(h.added, []);
    assert.equal(h.toasts.length, 1);
});

test('leitor também rejeita códigos de outros tamanhos e alfanuméricos cadastrados', () => {
    for (const code of ['1234567', '123456789', 'AB123456']) {
        const h = setup(), input = h.elements.pdvBarcodeCapture;
        h.context.window.appData.products.push({ id: 'invalid', sku: code });
        input.focus();
        for (const char of code) h.key(input, char);
        h.advance(250);
        h.key(input, 'Enter');
        assert.deepEqual(h.added, []);
    }
});
