let editingBudgetId = '';
let budgetOptionsDraft = [];
let activeBudgetOptionId = '';
let budgetCurrentRecord = null;
let selectedBudgetCustomerId = '';
let selectedBudgetProductId = '';
let budgetProductAcIndex = -1;
let budgetCustomerAcIndex = -1;
let templateItemsDraft = [];
let editingTemplateId = '';
let selectedTemplateProductId = '';
let templateProductAcIndex = -1;
let convertBudgetId = '';
let duplicateBudgetId = '';
let pendingBudgetConfirm = null;
let budgetRefreshErrorShown = false;
let templatePresentationDraft = null;

const BUDGET_STATUS_LABELS = {
    draft: 'Rascunho', sent: 'Enviado', awaiting: 'Aguardando cliente', approved: 'Aprovado',
    rejected: 'Recusado', expired: 'Expirado', cancelled: 'Cancelado', acquiring_parts: 'Peças em aquisição', converted: 'Convertido em venda'
};
const SOURCE_LABELS = {
    instagram: 'Instagram', google: 'Google', referral: 'Indicação', storefront: 'Passou na loja',
    old_customer: 'Cliente antigo', whatsapp: 'WhatsApp', facebook: 'Facebook', other: 'Outro'
};
const REJECTION_LABELS = {
    price: 'Preço', saving: 'Cliente vai juntar dinheiro', competitor: 'Comprou em outro lugar', gave_up: 'Desistiu',
    no_response: 'Não respondeu', deadline: 'Prazo', other: 'Outro'
};
const CONDITION_LABELS = { new: 'Novo', used: 'Usado', semi_new: 'Seminovo', refurbished: 'Recondicionado', na: 'N/A' };

function arr(v) { return Array.isArray(v) ? v : (v && typeof v === 'object' ? Object.values(v) : []); }
function num(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; }
function money(v) { return formatCurrency(Math.round(num(v) * 100) / 100); }
function esc(v) { return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
function clone(v) { return JSON.parse(JSON.stringify(v)); }
function uuid() { return (crypto.randomUUID ? crypto.randomUUID() : `id-${Date.now()}-${Math.random().toString(36).slice(2)}`); }
function todayIso() { const d = new Date(); const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000); return z.toISOString().slice(0, 10); }
function addDays(dateIso, days) { const d = new Date(`${dateIso || todayIso()}T12:00:00`); d.setDate(d.getDate() + Number(days || 0)); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); }
function dateBr(v) { const s = String(v || ''); const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[3]}/${m[2]}/${m[1]}` : '—'; }
function activeProducts() { return arr(window.appData?.products).filter((p) => p.active !== false); }
function customers() { return arr(window.appData?.customers).slice().sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'pt-BR')); }
function templates() { return arr(window.appData?.budgetTemplates).slice().sort((a, b) => String(a.category || '').localeCompare(String(b.category || ''), 'pt-BR') || String(a.name || '').localeCompare(String(b.name || ''), 'pt-BR')); }
function budgets() { return arr(window.appData?.budgets); }
function productById(id) { return activeProducts().find((p) => String(p.id) === String(id)) || null; }

async function jsonResponse(res) {
    const text = await res.text();
    if (!text) return { error: !res.ok, message: res.ok ? '' : 'Resposta vazia.' };
    try { return JSON.parse(text); } catch { return { error: true, message: 'Resposta inválida do servidor.' }; }
}
async function api(url, options = {}) {
    const res = await fetch(url, { credentials: 'same-origin', ...options, headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) } });
    const data = await jsonResponse(res);
    if (!res.ok || data.error) { const err = new Error(data.message || 'Erro na operação.'); err.data = data; err.status = res.status; throw err; }
    return data;
}
function upsert(listName, row) {
    window.appData[listName] = arr(window.appData[listName]);
    const i = window.appData[listName].findIndex((x) => String(x.id) === String(row.id));
    if (i >= 0) window.appData[listName][i] = row; else window.appData[listName].unshift(row);
}
function syncBudgetModalLock() {
    const hasOpen = Boolean(document.querySelector('.budget-modal-overlay.open:not([hidden])'));
    document.body.classList.toggle('budget-modal-open', hasOpen);
}
function openBudgetModal(id) {
    const modal = document.getElementById(id);
    if (!modal) return;
    modal.hidden = false;
    modal.setAttribute('aria-hidden', 'false');
    modal.classList.add('open');
    syncBudgetModalLock();
}
function closeBudgetModal(id) {
    const modal = document.getElementById(id);
    if (!modal) return;
    modal.classList.remove('open');
    modal.setAttribute('aria-hidden', 'true');
    modal.hidden = true;
    if (id === 'budgetConfirmModal') pendingBudgetConfirm = null;
    if (id === 'budgetDuplicateModal') duplicateBudgetId = '';
    if (id === 'budgetConvertModal') convertBudgetId = '';
    if (id === 'budgetTemplateModal') budgetCurrentRecord = null;
    syncBudgetModalLock();
}
function closeTopBudgetModal() {
    const open = [...document.querySelectorAll('.budget-modal-overlay.open')];
    if (open.length) closeBudgetModal(open[open.length - 1].id);
}
function openBudgetConfirm({ title = 'Confirmar', message = '', confirmText = 'Confirmar', danger = true, onConfirm = null } = {}) {
    pendingBudgetConfirm = typeof onConfirm === 'function' ? onConfirm : null;
    document.getElementById('budgetConfirmTitle').textContent = title;
    document.getElementById('budgetConfirmMessage').textContent = message;
    const btn = document.getElementById('confirmBudgetConfirmBtn');
    btn.textContent = confirmText;
    btn.classList.toggle('btn-danger-soft', danger);
    btn.classList.toggle('btn-primary', !danger);
    openBudgetModal('budgetConfirmModal');
}
function statusLabel(s) { return BUDGET_STATUS_LABELS[s] || 'Rascunho'; }
function sourceLabel(s) { return SOURCE_LABELS[s] || (s ? s : 'Não informado'); }
function rejectionLabel(s) { return REJECTION_LABELS[s] || (s ? s : 'Não informado'); }
async function copyBudgetLink(text){if(window.isSecureContext&&navigator.clipboard)return navigator.clipboard.writeText(text);const area=document.createElement('textarea');area.value=text;area.style.position='fixed';area.style.opacity='0';document.body.appendChild(area);area.select();document.execCommand('copy');area.remove();}
function updateTemplateImagePreview(url){const img=document.getElementById('templateImagePreview');if(!img)return;img.src=url||'';img.hidden=!url;}
async function uploadTemplateImage(){const file=document.getElementById('templateImageFile')?.files?.[0];if(!file)return showToast('Selecione uma imagem.','info');const fd=new FormData();fd.append('image',file);try{const res=await fetch('/api/budget-templates/image',{method:'POST',credentials:'same-origin',body:fd});const data=await jsonResponse(res);if(!res.ok||data.error)throw new Error(data.message||'Falha no upload.');document.getElementById('templateImageUrl').value=data.imageUrl;updateTemplateImagePreview(data.imageUrl);showToast('Imagem enviada.','success');}catch(e){showToast(e.message,'error');}}

function normalizeAdjustment(raw) {
    const r = raw && typeof raw === 'object' ? raw : {};
    const type = r.type === 'percent' ? 'percent' : 'fixed';
    let value = Math.max(0, num(r.value)); if (type === 'percent') value = Math.min(100, value);
    return { type, value };
}
function adjustmentAmount(subtotal, adj) { const a = normalizeAdjustment(adj); return a.type === 'percent' ? subtotal * a.value / 100 : a.value; }
function itemTotal(item) {
    const gross = Math.max(0, num(item.qty)) * Math.max(0, num(item.unitPrice));
    return Math.max(0, gross - adjustmentAmount(gross, item.discount));
}
function optionTotals(option) {
    const subtotal = (option.items || []).reduce((s, item) => s + itemTotal(item), 0);
    const discountAmount = Math.min(subtotal, adjustmentAmount(subtotal, option.discount));
    const extraAmount = adjustmentAmount(subtotal, option.extra);
    const total = Math.max(0, subtotal - discountAmount + extraAmount);
    const costTotal = (option.items || []).reduce((s, item) => s + Math.max(0, num(item.qty)) * Math.max(0, num(item.unitCost)), 0);
    const profit = total - costTotal;
    const margin = total > 0 ? profit / total * 100 : 0;
    return { subtotal, discountAmount, extraAmount, total, costTotal, profit, margin };
}
function cardPaymentTotals(total) {
    const base = Math.max(0, Math.round(num(total) * 100));
    const installmentTotalCents = Math.round(base * 1.0967);
    return { cardTotal: installmentTotalCents / 100, installments: 6, installmentValue: Math.round(installmentTotalCents / 6) / 100 };
}
function newOption(name = 'Proposta', recommended = null) {
    const isRecommended = recommended == null ? budgetOptionsDraft.length === 0 : recommended === true;
    return {
        id: uuid(), name, description: '', imageUrl: '', gallery: [], useCases: [], games: [], highlights: [], performanceNote: '',
        recommended: isRecommended, items: [], discount: { type: 'fixed', value: 0 }, extra: { type: 'fixed', value: 0 }
    };
}

function safeBudgetMediaUrl(value) {
    const raw = String(value || '').trim().slice(0, 1000);
    if (!raw || /[\u0000-\u001f\u007f\\]/.test(raw)) return '';
    if (/^\/(?:uploads|img|public)(?:\/|$)/i.test(raw)) return raw.split(/[?#]/, 1)[0].split('/').includes('..') ? '' : raw;
    if (!/^https?:\/\//i.test(raw)) return '';
    try { const parsed = new URL(raw); return parsed.hostname ? raw : ''; } catch { return ''; }
}
function normalizeGalleryDraft(raw, legacyImageUrl = '') {
    const rows = arr(raw).slice(0, 8).map((entry) => {
        const row = entry && typeof entry === 'object' ? entry : { url: entry };
        const url = safeBudgetMediaUrl(row.url);
        return url ? { id: String(row.id || uuid()), url, alt: String(row.alt || '').slice(0, 160), caption: String(row.caption || '').slice(0, 300) } : null;
    }).filter(Boolean);
    const legacy = safeBudgetMediaUrl(legacyImageUrl);
    if (legacy && !rows.some((photo) => photo.url === legacy)) rows.unshift({ id: uuid(), url: legacy, alt: '', caption: '' });
    return rows.slice(0, 8);
}
function normalizeUseCasesDraft(raw) {
    return arr(raw).slice(0, 12).map((entry) => {
        const row = entry && typeof entry === 'object' ? entry : { title: entry };
        return { id: String(row.id || uuid()), title: String(row.title || '').slice(0, 120), description: String(row.description || '').slice(0, 600) };
    });
}
function normalizeGamesDraft(raw) {
    const fpsValue = (value) => value == null || String(value).trim() === '' ? '' : Math.min(1000, Math.max(0, Math.round(num(value))));
    return arr(raw).slice(0, 20).map((entry) => {
        const row = entry && typeof entry === 'object' ? entry : {};
        return {
            id: String(row.id || uuid()), name: String(row.name || '').slice(0, 120), resolution: String(row.resolution || '1080p').slice(0, 40),
            quality: String(row.quality || 'Alto').slice(0, 40), fpsMin: fpsValue(row.fpsMin),
            fpsMax: fpsValue(row.fpsMax), note: String(row.note || '').slice(0, 500)
        };
    });
}
function optionDraftFromRow(row = {}, { refreshCost = false } = {}) {
    const gallery = normalizeGalleryDraft(row.gallery, row.imageUrl);
    return {
        id: row.id || uuid(), name: String(row.name || 'Proposta'), description: String(row.description || '').slice(0, 1200),
        imageUrl: safeBudgetMediaUrl(row.imageUrl) || gallery[0]?.url || '', gallery,
        useCases: normalizeUseCasesDraft(row.useCases), games: normalizeGamesDraft(row.games),
        highlights: arr(row.highlights).map((x) => String(x || '').trim().slice(0, 160)).filter(Boolean).slice(0, 12),
        performanceNote: String(row.performanceNote || '').slice(0, 1000), recommended: row.recommended === true,
        items: arr(row.items).map((item) => normalizeDraftItem(item, { refreshCost })),
        discount: normalizeAdjustment(row.discount), extra: normalizeAdjustment(row.extra)
    };
}

function activeOption() { return budgetOptionsDraft.find((x) => String(x.id) === String(activeBudgetOptionId)) || budgetOptionsDraft[0] || null; }
function normalizeDraftItem(row, { forTemplate = false, refreshCost = false } = {}) {
    const p = row?.productId ? productById(row.productId) : null;
    const templatePriceMode = row?.priceMode === 'snapshot' ? 'snapshot' : 'live';
    const liveTemplateProduct = forTemplate && templatePriceMode === 'live' && p;
    const unitCost = (refreshCost || liveTemplateProduct) && p
        ? num(p.unitCostTotal ?? p.cost)
        : num(row?.unitCost ?? p?.unitCostTotal ?? p?.cost);
    const unitPrice = liveTemplateProduct
        ? num(p.price)
        : num(row?.unitPrice ?? p?.price);
    return {
        id: row?.id || uuid(),
        kind: row?.kind === 'product' ? 'product' : 'custom',
        productId: String(row?.productId || ''),
        sku: String(row?.sku || ''),
        name: String(row?.name || (p?.name || 'Item')),
        qty: Math.max(1, Math.trunc(num(row?.qty) || 1)),
        unitPrice: Math.max(0, unitPrice),
        unitCost: Math.max(0, unitCost),
        condition: row?.condition || (row?.kind === 'custom' ? 'na' : 'new'),
        warranty: String(row?.warranty || ''),
        note: String(row?.note || ''),
        // Modelos podem acompanhar o preço atual. Orçamentos são sempre snapshots.
        priceMode: forTemplate ? templatePriceMode : 'snapshot',
        specialOrder: row?.specialOrder === true,
        discount: normalizeAdjustment(row?.discount)
    };
}
function itemFromProduct(p, { forTemplate = false } = {}) {
    return normalizeDraftItem({
        kind: 'product', productId: p.id, sku: p.sku || '', name: p.name || 'Produto', qty: 1, unitPrice: num(p.price),
        unitCost: num(p.unitCostTotal ?? p.cost), condition: 'new', warranty: '', note: '', priceMode: forTemplate ? 'live' : 'snapshot',
        specialOrder: p.trackStock !== false && num(p.qty) <= 0
    }, { forTemplate });
}

// ---------- Customer autocomplete ----------
function filterCustomers(term) {
    const q = String(term || '').trim().toLowerCase();
    return customers().filter((c) => !q || [c.name, c.phone, c.email, c.doc].some((v) => String(v || '').toLowerCase().includes(q))).slice(0, 20);
}
function renderCustomerResults(term) {
    const el = document.getElementById('budgetCustomerResults'); if (!el) return;
    const rows = filterCustomers(term); budgetCustomerAcIndex = rows.length ? 0 : -1;
    el.innerHTML = rows.length ? rows.map((c, i) => `<button type="button" class="budget-ac-item${i === 0 ? ' is-active' : ''}" data-customer-id="${esc(c.id)}"><span class="budget-ac-item-title">${esc(c.name)}</span><span class="budget-ac-item-meta">${esc([c.phone, c.email, c.doc].filter(Boolean).join(' · ') || 'Sem contato')}</span></button>`).join('') : '<div class="budget-ac-empty">Nenhum cliente encontrado. Você pode preencher o nome e WhatsApp manualmente abaixo.</div>';
    el.hidden = false;
    el.querySelectorAll('[data-customer-id]').forEach((b, i) => {
        b.onmousedown = (e) => { e.preventDefault(); applyCustomer(customers().find((c) => String(c.id) === String(b.dataset.customerId))); };
        b.onmouseenter = () => { budgetCustomerAcIndex = i; [...el.querySelectorAll('.budget-ac-item')].forEach((x, j) => x.classList.toggle('is-active', j === i)); };
    });
}
function applyCustomer(c) {
    if (!c) return; selectedBudgetCustomerId = String(c.id || '');
    document.getElementById('budgetCustomerId').value = selectedBudgetCustomerId;
    document.getElementById('budgetCustomerName').value = c.name || '';
    document.getElementById('budgetCustomerPhone').value = c.phone || '';
    document.getElementById('budgetCustomerEmail').value = c.email || '';
    document.getElementById('budgetCustomerDoc').value = c.doc || '';
    document.getElementById('budgetCustomerSearch').value = c.name || '';
    document.getElementById('budgetCustomerResults').hidden = true;
}

// ---------- Product autocomplete (budget/template) ----------
function filterProducts(term) {
    const q = String(term || '').trim().toLowerCase();
    return activeProducts().filter((p) => !q || [p.name, p.sku, p.category].some((v) => String(v || '').toLowerCase().includes(q))).slice(0, 30);
}
function renderProductResults(term, context = 'budget') {
    const isTemplate = context === 'template';
    const el = document.getElementById(isTemplate ? 'templateProductResults' : 'budgetProductResults'); if (!el) return;
    const rows = filterProducts(term);
    if (isTemplate) templateProductAcIndex = rows.length ? 0 : -1; else budgetProductAcIndex = rows.length ? 0 : -1;
    el.innerHTML = rows.length ? rows.map((p, i) => `<button type="button" class="budget-ac-item${i === 0 ? ' is-active' : ''}" data-product-id="${esc(p.id)}"><span class="budget-ac-item-title">${esc(p.name)}</span><span class="budget-ac-item-meta">${esc(p.sku || 'Sem SKU')} · ${money(p.price)} · Estoque ${num(p.qty)}${p.itemType === 'service' ? ' · Serviço' : ''}</span></button>`).join('') : '<div class="budget-ac-empty">Nenhum produto encontrado.</div>';
    el.hidden = false;
    el.querySelectorAll('[data-product-id]').forEach((b, i) => {
        b.onmousedown = (e) => { e.preventDefault(); addProductToContext(b.dataset.productId, context); };
        b.onmouseenter = () => { if (isTemplate) templateProductAcIndex = i; else budgetProductAcIndex = i; [...el.querySelectorAll('.budget-ac-item')].forEach((x, j) => x.classList.toggle('is-active', j === i)); };
    });
    if (isTemplate) selectedTemplateProductId = String(rows[0]?.id || ''); else selectedBudgetProductId = String(rows[0]?.id || '');
}
function addProductToContext(id, context) {
    const p = productById(id); if (!p) return;
    const isTemplate = context === 'template';
    const list = isTemplate ? templateItemsDraft : (activeOption()?.items || []);
    const existing = list.find((x) => x.kind === 'product' && String(x.productId) === String(id));
    if (existing) existing.qty = num(existing.qty) + 1; else list.push(itemFromProduct(p, { forTemplate: isTemplate }));
    const search = document.getElementById(isTemplate ? 'templateProductSearch' : 'budgetProductSearch'); if (search) search.value = '';
    document.getElementById(isTemplate ? 'templateProductResults' : 'budgetProductResults').hidden = true;
    if (isTemplate) { selectedTemplateProductId = ''; renderTemplateItems(); } else { selectedBudgetProductId = ''; renderBudgetItems(); }
}

// ---------- Budget option/items rendering ----------
function renderOptionTabs() {
    const el = document.getElementById('budgetOptionTabs'); if (!el) return;
    el.innerHTML = budgetOptionsDraft.map((o) => `<button type="button" class="budget-option-tab${String(o.id) === String(activeBudgetOptionId) ? ' active' : ''}" data-option-id="${esc(o.id)}">${esc(o.name || 'Opção')}${o.recommended ? '<span class="rec">★</span>' : ''}</button>`).join('');
    el.querySelectorAll('[data-option-id]').forEach((b) => b.onclick = () => { syncOptionHeader(); syncAdjustmentsFromUi(); activeBudgetOptionId = b.dataset.optionId; renderOptionTabs(); renderBudgetItems(); });
    syncOptionHeader(true);
}
function syncOptionHeader(renderOnly = false) {
    const o = activeOption(); if (!o) return;
    const name = document.getElementById('budgetOptionName'); const rec = document.getElementById('budgetOptionRecommended');
    const description = document.getElementById('budgetOptionDescription');
    const highlights = document.getElementById('budgetOptionHighlights');
    const performanceNote = document.getElementById('budgetOptionPerformanceNote');
    if (!renderOnly) {
        if (name) o.name = name.value.trim() || o.name;
        if (rec) o.recommended = rec.checked;
        if (description) o.description = description.value.trim().slice(0, 1200);
        if (highlights) o.highlights = highlights.value.split('\n').map((x) => x.trim().slice(0, 160)).filter(Boolean).slice(0, 12);
        if (performanceNote) o.performanceNote = performanceNote.value.trim().slice(0, 1000);
    }
    if (name) name.value = o.name || '';
    if (rec) rec.checked = o.recommended === true;
    if (description) description.value = o.description || '';
    if (highlights) highlights.value = arr(o.highlights).join('\n');
    if (performanceNote) performanceNote.value = o.performanceNote || '';
    if (renderOnly) renderBudgetPresentationEditor();
}

function renderBudgetPresentationEditor() {
    const option = activeOption(); if (!option) return;
    option.gallery = normalizeGalleryDraft(option.gallery, option.imageUrl);
    option.useCases = normalizeUseCasesDraft(option.useCases);
    option.games = normalizeGamesDraft(option.games);
    option.imageUrl = safeBudgetMediaUrl(option.imageUrl) || option.gallery[0]?.url || '';
    const coverIndex = option.gallery.findIndex((photo) => photo.url === option.imageUrl);
    if (coverIndex > 0) option.gallery.unshift(option.gallery.splice(coverIndex, 1)[0]);

    const galleryCount = document.getElementById('budgetGalleryCount');
    if (galleryCount) galleryCount.textContent = `${option.gallery.length}/8`;
    const gallery = document.getElementById('budgetGalleryEditor');
    if (gallery) gallery.innerHTML = option.gallery.length ? option.gallery.map((photo, index) => `
      <article class="budget-gallery-item${index === 0 ? ' is-cover' : ''}" data-photo-id="${esc(photo.id)}">
        ${index === 0 ? '<span class="budget-cover-chip">CAPA</span>' : ''}
        <img src="${esc(photo.url)}" alt="${esc(photo.alt || photo.caption || `Foto ${index + 1} do PC`)}" loading="lazy" decoding="async">
        <input class="form-input budget-photo-caption" maxlength="300" value="${esc(photo.caption)}" placeholder="Legenda da foto">
        <input class="form-input budget-photo-alt" maxlength="160" value="${esc(photo.alt)}" placeholder="Descrição acessível">
        <div class="budget-gallery-actions">
          ${index ? '<button class="btn btn-ghost" type="button" data-gallery-action="cover">Usar como capa</button>' : ''}
          <button class="btn btn-danger-soft" type="button" data-gallery-action="remove">Remover</button>
        </div>
      </article>`).join('') : '<div class="budget-rich-empty">Nenhuma foto adicionada. Você pode enviar arquivos ou colar uma URL.</div>';

    const useCases = document.getElementById('budgetUseCasesEditor');
    if (useCases) useCases.innerHTML = option.useCases.length ? option.useCases.map((item, index) => `
      <div class="budget-rich-row use-case" data-usecase-id="${esc(item.id)}">
        <input class="form-input budget-usecase-title" maxlength="120" value="${esc(item.title)}" placeholder="Ex.: Edição de vídeo">
        <input class="form-input budget-usecase-description" maxlength="600" value="${esc(item.description)}" placeholder="Detalhes, programas e nível de uso">
        <button class="btn btn-danger-soft budget-rich-remove" type="button" data-usecase-action="remove" aria-label="Remover tarefa ${index + 1}">×</button>
      </div>`).join('') : '<div class="budget-rich-empty">Adicione tarefas como estudos, trabalho, edição, streaming ou projetos 3D.</div>';

    const games = document.getElementById('budgetGamesEditor');
    if (games) games.innerHTML = option.games.length ? option.games.map((game, index) => `
      <div class="budget-rich-row game" data-game-id="${esc(game.id)}">
        <input class="form-input budget-game-name" maxlength="120" value="${esc(game.name)}" placeholder="Jogo">
        <input class="form-input budget-game-resolution" maxlength="40" value="${esc(game.resolution)}" placeholder="1080p">
        <input class="form-input budget-game-quality" maxlength="40" value="${esc(game.quality)}" placeholder="Alto">
        <input class="form-input budget-game-fps-min" type="number" min="0" max="1000" value="${game.fpsMin === '' ? '' : game.fpsMin}" placeholder="FPS mín.">
        <input class="form-input budget-game-fps-max" type="number" min="0" max="1000" value="${game.fpsMax === '' ? '' : game.fpsMax}" placeholder="FPS máx.">
        <input class="form-input budget-game-note" maxlength="500" value="${esc(game.note)}" placeholder="DLSS/FSR, ray tracing, observações...">
        <button class="btn btn-danger-soft budget-rich-remove" type="button" data-game-action="remove" aria-label="Remover jogo ${index + 1}">×</button>
      </div>`).join('') : '<div class="budget-rich-empty">Adicione os jogos que o cliente quer rodar e uma estimativa de FPS.</div>';
}

function syncRichRowInput(event) {
    const option = activeOption(); if (!option) return;
    const useCaseRow = event.target.closest('[data-usecase-id]');
    if (useCaseRow) {
        const item = option.useCases.find((row) => String(row.id) === String(useCaseRow.dataset.usecaseId));
        if (!item) return;
        if (event.target.classList.contains('budget-usecase-title')) item.title = event.target.value.slice(0, 120);
        if (event.target.classList.contains('budget-usecase-description')) item.description = event.target.value.slice(0, 600);
        return;
    }
    const gameRow = event.target.closest('[data-game-id]');
    if (!gameRow) return;
    const game = option.games.find((row) => String(row.id) === String(gameRow.dataset.gameId));
    if (!game) return;
    if (event.target.classList.contains('budget-game-name')) game.name = event.target.value.slice(0, 120);
    else if (event.target.classList.contains('budget-game-resolution')) game.resolution = event.target.value.slice(0, 40);
    else if (event.target.classList.contains('budget-game-quality')) game.quality = event.target.value.slice(0, 40);
    else if (event.target.classList.contains('budget-game-fps-min')) game.fpsMin = event.target.value === '' ? '' : Math.min(1000, Math.max(0, Math.round(num(event.target.value))));
    else if (event.target.classList.contains('budget-game-fps-max')) game.fpsMax = event.target.value === '' ? '' : Math.min(1000, Math.max(0, Math.round(num(event.target.value))));
    else if (event.target.classList.contains('budget-game-note')) game.note = event.target.value.slice(0, 500);
}

async function optimizeBudgetImage(file) {
    if (!file || typeof createImageBitmap !== 'function') return file;
    try {
        const bitmap = await createImageBitmap(file);
        const maxSide = 1920;
        const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
        const width = Math.max(1, Math.round(bitmap.width * scale));
        const height = Math.max(1, Math.round(bitmap.height * scale));
        const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
        canvas.getContext('2d', { alpha: false }).drawImage(bitmap, 0, 0, width, height);
        bitmap.close?.();
        const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', .84));
        if (!blob || blob.size >= file.size) return file;
        const basename = String(file.name || 'pc').replace(/\.[^.]+$/, '').slice(0, 80);
        return typeof File === 'function' ? new File([blob], `${basename}.webp`, { type: 'image/webp' }) : blob;
    } catch (_) { return file; }
}

async function uploadBudgetGalleryFiles() {
    const option = activeOption(); const input = document.getElementById('budgetGalleryFiles');
    const status = document.getElementById('budgetGalleryUploadStatus'); const button = document.getElementById('budgetUploadGalleryBtn');
    if (!option || !input?.files?.length) return;
    const room = Math.max(0, 8 - option.gallery.length);
    const files = [...input.files].slice(0, room);
    if (!room) { input.value = ''; return showToast('Esta opção já possui o limite de 8 fotos.', 'info'); }
    button.disabled = true; status.textContent = `Otimizando e enviando ${files.length} foto(s)…`;
    let uploaded = 0;
    try {
        for (const file of files) {
            if (!/^image\/(?:jpeg|png|webp)$/i.test(file.type)) throw new Error(`Formato inválido: ${file.name}`);
            const optimized = await optimizeBudgetImage(file);
            const fd = new FormData(); fd.append('image', optimized, optimized.name || file.name);
            const res = await fetch('/api/budgets/image', { method: 'POST', credentials: 'same-origin', body: fd });
            const data = await jsonResponse(res);
            if (!res.ok || data.error) throw new Error(data.message || `Falha ao enviar ${file.name}.`);
            option.gallery.push({ id: uuid(), url: data.imageUrl, alt: '', caption: '' }); uploaded++;
            if (!option.imageUrl) option.imageUrl = data.imageUrl;
        }
        status.textContent = `${uploaded} foto(s) enviada(s) e pronta(s) para o link.`;
        renderBudgetPresentationEditor();
        showToast('Fotos adicionadas à proposta.', 'success');
    } catch (error) {
        status.textContent = error.message || 'Não foi possível enviar as fotos.';
        showToast(status.textContent, 'error');
        renderBudgetPresentationEditor();
    } finally { input.value = ''; button.disabled = false; }
}
function renderBudgetItems() {
    const option = activeOption(); const el = document.getElementById('budgetItemsList'); if (!el || !option) return;
    if (!option.items.length) el.innerHTML = '<div class="empty-state">Nenhum item nesta opção.</div>';
    else el.innerHTML = option.items.map((item, i) => itemRowHtml(item, i, 'budget')).join('');
    bindItemRowEvents('budget');
    renderBudgetTotals();
}
function itemRowHtml(item, i, context) {
    const p = item.productId ? productById(item.productId) : null;
    const total = itemTotal(item);
    const stockWarn = p && p.trackStock !== false && num(p.qty) < num(item.qty)
        ? `<span class="budget-stock-warn">Estoque ${num(p.qty)}</span>`
        : (p ? `Estoque ${num(p.qty)}` : 'Item manual');
    const isTemplate = context === 'template';
    const priceModeControl = isTemplate
        ? `<select class="form-input item-price-mode"><option value="snapshot"${item.priceMode !== 'live' ? ' selected' : ''}>Fixo</option><option value="live"${item.priceMode === 'live' ? ' selected' : ''}>Atual</option></select>`
        : '<span class="budget-price-lock" title="O preço do orçamento não muda automaticamente depois de salvo.">Fixo no orçamento</span>';
    const priceReadonly = '';
    return `<div class="budget-items-row advanced" data-index="${i}">
      <div class="budget-item-name-wrap"><input class="form-input item-name" value="${esc(item.name)}"><div class="budget-item-secondary"><input class="form-input item-warranty" value="${esc(item.warranty || '')}" placeholder="Garantia"><input class="form-input item-note" value="${esc(item.note || '')}" placeholder="Observação"></div><div class="budget-item-meta">${stockWarn}</div></div>
      <select class="form-input item-condition">${Object.entries(CONDITION_LABELS).map(([v,l]) => `<option value="${v}"${item.condition === v ? ' selected' : ''}>${l}</option>`).join('')}</select>
      <input class="form-input item-qty" type="number" min="1" step="1" value="${Math.max(1, Math.trunc(num(item.qty) || 1))}">
      <input class="form-input item-price" type="number" min="0" step="0.01" value="${num(item.unitPrice).toFixed(2)}"${priceReadonly}>
      ${priceModeControl}
      <label class="budget-special-order" title="Item sob encomenda"><input class="item-special" type="checkbox"${item.specialOrder ? ' checked' : ''}></label>
      <div class="budget-items-total">${money(total)}</div>
      <div class="budget-row-actions"><button class="btn btn-ghost budget-row-up" type="button" title="Mover para cima"${i === 0 ? ' disabled' : ''}>↑</button><button class="btn btn-ghost budget-row-down" type="button" title="Mover para baixo">↓</button><button class="btn btn-danger-soft budget-row-remove" type="button" title="Remover">×</button></div>
    </div>`;
}
function bindItemRowEvents(context) {
    const container = document.getElementById(context === 'template' ? 'templateItemsList' : 'budgetItemsList');
    if (!container) return;
    container.querySelectorAll('.budget-items-row').forEach((row) => {
        const i = Number(row.dataset.index);
        const list = context === 'template' ? templateItemsDraft : (activeOption()?.items || []);
        const item = list[i];
        if (!item) return;
        const update = () => {
            item.name = row.querySelector('.item-name').value.trim();
            item.warranty = row.querySelector('.item-warranty').value.trim();
            item.note = row.querySelector('.item-note').value.trim();
            item.condition = row.querySelector('.item-condition').value;
            item.qty = Math.max(1, Math.trunc(num(row.querySelector('.item-qty').value) || 1));
            item.unitPrice = Math.max(0, num(row.querySelector('.item-price').value));
            const mode = row.querySelector('.item-price-mode');
            item.priceMode = context === 'template' && mode ? mode.value : 'snapshot';
            item.specialOrder = row.querySelector('.item-special').checked;
            if (context === 'template' && item.priceMode === 'live' && item.productId) {
                const p = productById(item.productId);
                if (p) {
                    item.unitPrice = num(p.price);
                    item.unitCost = num(p.unitCostTotal ?? p.cost);
                }
            }
            if (context === 'template') renderTemplateItems(); else renderBudgetItems();
        };
        row.addEventListener('change', (e) => { if (e.target.matches('.item-price') && context === 'template') { item.priceMode='snapshot'; const mode=row.querySelector('.item-price-mode'); if(mode)mode.value='snapshot'; } if (e.target.matches('input,select')) update(); });
        row.querySelector('.item-name').onblur = update;
        row.querySelector('.item-warranty').onblur = update;
        row.querySelector('.item-note').onblur = update;
        const rerender = () => context === 'template' ? renderTemplateItems() : renderBudgetItems();
        const up = row.querySelector('.budget-row-up');
        const down = row.querySelector('.budget-row-down');
        if (up) up.onclick = () => { if (i <= 0) return; [list[i - 1], list[i]] = [list[i], list[i - 1]]; rerender(); };
        if (down) { down.disabled = i >= list.length - 1; down.onclick = () => { if (i >= list.length - 1) return; [list[i + 1], list[i]] = [list[i], list[i + 1]]; rerender(); }; }
        row.querySelector('.budget-row-remove').onclick = () => { list.splice(i, 1); rerender(); };
    });
}
function renderBudgetTotals() {
    const o = activeOption(); if (!o) return;
    const dType = document.getElementById('budgetDiscountType'), dVal = document.getElementById('budgetDiscountValue'), eType = document.getElementById('budgetExtraType'), eVal = document.getElementById('budgetExtraValue');
    if (dType && document.activeElement !== dType) dType.value = o.discount?.type || 'fixed'; if (dVal && document.activeElement !== dVal) dVal.value = num(o.discount?.value);
    if (eType && document.activeElement !== eType) eType.value = o.extra?.type || 'fixed'; if (eVal && document.activeElement !== eVal) eVal.value = num(o.extra?.value);
    const t = optionTotals(o); const box = document.getElementById('budgetTotalsBox'); if (!box) return;
    const card = cardPaymentTotals(t.total);
    box.innerHTML = `<div class="budget-financial-box"><div class="budget-financial-cell"><small>Subtotal</small><strong>${money(t.subtotal)}</strong></div><div class="budget-financial-cell"><small>Custo interno</small><strong>${money(t.costTotal)}</strong></div><div class="budget-financial-cell"><small>Valor à vista</small><strong>${money(t.total)}</strong></div><div class="budget-financial-cell"><small>Valor no cartão</small><strong>${money(card.cardTotal)}</strong><small>ou 6x de ${money(card.installmentValue)}</small></div><div class="budget-financial-cell"><small>Lucro bruto</small><strong class="${t.profit < 0 ? 'margin-low' : ''}">${money(t.profit)}</strong></div><div class="budget-financial-cell"><small>Margem</small><strong class="${t.margin < 10 ? 'margin-low' : 'margin-good'}">${t.margin.toFixed(1)}%${t.margin < 10 ? ' · baixa' : ''}</strong></div></div>`;
}
function syncAdjustmentsFromUi() {
    const o = activeOption(); if (!o) return;
    o.discount = { type: document.getElementById('budgetDiscountType').value, value: Math.max(0, num(document.getElementById('budgetDiscountValue').value)) };
    o.extra = { type: document.getElementById('budgetExtraType').value, value: Math.max(0, num(document.getElementById('budgetExtraValue').value)) };
    renderBudgetTotals();
}

// ---------- Template editor ----------
function resetTemplateEditor() {
    editingTemplateId = ''; templateItemsDraft = []; selectedTemplateProductId = ''; templateProductAcIndex = -1;
    templatePresentationDraft = { gallery: [], useCases: [], games: [], highlights: [], performanceNote: '' };
    const search = document.getElementById('templateProductSearch'); if (search) search.value = '';
    const results = document.getElementById('templateProductResults'); if (results) results.hidden = true;
    ['templateId','templateName','templateCategory','templateDescription','templateImageUrl','templateDeadline','templateWarranty','templatePaymentTerms','templateIncludedServices','templateCustomerNotes','templateInternalNotes'].forEach((id) => { const el=document.getElementById(id); if(el) el.value=''; });
    updateTemplateImagePreview('');
    document.getElementById('templateValidDays').value = 7; document.getElementById('templateActive').checked = true;
    document.getElementById('deleteTemplateBtn').hidden = true; document.getElementById('duplicateTemplateBtn').hidden = true; renderTemplateItems(); renderTemplateList();
}
function loadTemplateEditor(t) {
    editingTemplateId = String(t.id || ''); document.getElementById('templateId').value = editingTemplateId; document.getElementById('templateName').value = t.name || ''; document.getElementById('templateCategory').value = t.category || '';
    document.getElementById('templateDescription').value = t.description || ''; document.getElementById('templateImageUrl').value=t.imageUrl||''; updateTemplateImagePreview(t.imageUrl); document.getElementById('templateValidDays').value = num(t.defaultValidDays) || 7; document.getElementById('templateDeadline').value = t.deadline || '';
    document.getElementById('templateWarranty').value = t.warrantyText || ''; document.getElementById('templatePaymentTerms').value = t.paymentTerms || ''; document.getElementById('templateIncludedServices').value = arr(t.includedServices).join('\n');
    document.getElementById('templateCustomerNotes').value = t.customerNotes || ''; document.getElementById('templateInternalNotes').value = t.internalNotes || ''; document.getElementById('templateActive').checked = t.active !== false;
    templatePresentationDraft = {
        gallery: normalizeGalleryDraft(t.gallery, t.imageUrl), useCases: normalizeUseCasesDraft(t.useCases), games: normalizeGamesDraft(t.games),
        highlights: arr(t.highlights).map((x) => String(x || '')).filter(Boolean), performanceNote: String(t.performanceNote || '')
    };
    templateItemsDraft = arr(t.items).map((x) => normalizeDraftItem(x, { forTemplate: true, refreshCost: true })); document.getElementById('deleteTemplateBtn').hidden = false; document.getElementById('duplicateTemplateBtn').hidden = false; renderTemplateItems(); renderTemplateList();
}
function renderTemplateItems() {
    const el = document.getElementById('templateItemsList'); if (!el) return;
    const countEl = document.getElementById('templateItemsCount'); if (countEl) countEl.textContent = `${templateItemsDraft.length} ${templateItemsDraft.length === 1 ? 'item' : 'itens'}`;
    el.innerHTML = templateItemsDraft.length ? templateItemsDraft.map((x,i) => itemRowHtml(x,i,'template')).join('') : '<div class="template-items-empty"><span>📦</span><strong>Nenhum item adicionado</strong><small>Pesquise um produto acima ou crie um item manual.</small></div>';
    bindItemRowEvents('template');
    const subtotal = templateItemsDraft.reduce((s,x)=>s+itemTotal(x),0), cost = templateItemsDraft.reduce((s,x)=>s+num(x.qty)*num(x.unitCost),0), profit=subtotal-cost, margin=subtotal?profit/subtotal*100:0;
    document.getElementById('templateFinancialBox').innerHTML = `<div class="template-items-summary"><span>${templateItemsDraft.length} item(ns) no modelo</span></div><div class="budget-financial-box"><div class="budget-financial-cell"><small>Preço estimado</small><strong>${money(subtotal)}</strong></div><div class="budget-financial-cell"><small>Custo</small><strong>${money(cost)}</strong></div><div class="budget-financial-cell"><small>Lucro bruto</small><strong>${money(profit)}</strong></div><div class="budget-financial-cell"><small>Margem</small><strong class="${margin < 10 ? 'margin-low':'margin-good'}">${margin.toFixed(1)}%</strong></div></div>`;
}
function renderTemplateList() {
    const q = String(document.getElementById('templateSearchInput')?.value || '').toLowerCase(); const el = document.getElementById('budgetTemplatesList'); if (!el) return;
    const list = templates().filter((t) => !q || `${t.name} ${t.category} ${t.description}`.toLowerCase().includes(q));
    el.innerHTML = list.length ? list.map((t) => `<div class="template-list-item${String(t.id)===String(editingTemplateId)?' active':''}" data-template-id="${esc(t.id)}"><div class="template-list-item-head"><strong>${esc(t.name)}</strong><span class="budget-status ${t.active !== false ? 'status-approved':'status-cancelled'}">${t.active !== false ? 'Ativo':'Inativo'}</span></div><div class="template-list-item-meta">${esc(t.category || 'Outros')} · ${money(t.subtotal || 0)} · margem ${num(t.margin).toFixed(1)}%</div></div>`).join('') : '<div class="empty-state">Nenhum modelo cadastrado.</div>';
    el.querySelectorAll('[data-template-id]').forEach((x) => x.onclick = () => { const t = templates().find((r)=>String(r.id)===String(x.dataset.templateId)); if(t) loadTemplateEditor(t); });
    fillTemplateSelect();
}
function templatePayload() {
    const presentation = templatePresentationDraft || { gallery: [], useCases: [], games: [], highlights: [], performanceNote: '' };
    return {
        name: document.getElementById('templateName').value.trim(), category: document.getElementById('templateCategory').value.trim() || 'Outros', description: document.getElementById('templateDescription').value.trim(), imageUrl:document.getElementById('templateImageUrl').value.trim(),
        defaultValidDays: Math.max(1, num(document.getElementById('templateValidDays').value) || 7), deadline: document.getElementById('templateDeadline').value.trim(), warrantyText: document.getElementById('templateWarranty').value.trim(),
        paymentTerms: document.getElementById('templatePaymentTerms').value.trim(), includedServices: document.getElementById('templateIncludedServices').value.split('\n').map((x)=>x.trim()).filter(Boolean),
        customerNotes: document.getElementById('templateCustomerNotes').value.trim(), internalNotes: document.getElementById('templateInternalNotes').value.trim(), active: document.getElementById('templateActive').checked,
        gallery: clone(presentation.gallery), useCases: clone(presentation.useCases), games: clone(presentation.games), highlights: clone(presentation.highlights), performanceNote: presentation.performanceNote,
        items: templateItemsDraft.map(clone)
    };
}
async function saveTemplate() {
    const payload = templatePayload(); if (!payload.name) return showToast('Informe o nome do modelo.', 'error'); if (!payload.items.length) return showToast('Adicione pelo menos um item.', 'error');
    try { const data = await api(editingTemplateId ? `/api/budget-templates/${encodeURIComponent(editingTemplateId)}` : '/api/budget-templates', { method: editingTemplateId ? 'PATCH':'POST', body: JSON.stringify(payload) }); upsert('budgetTemplates', data.template); loadTemplateEditor(data.template); showToast('Modelo salvo.', 'success'); }
    catch(e){ console.error(e); showToast(e.message,'error'); }
}
function fillTemplateSelect() {
    const el = document.getElementById('budgetTemplateSelect'); if (!el) return; const cur=el.value;
    const active = templates().filter((t)=>t.active!==false); const groups = new Map(); active.forEach((t)=>{ const c=t.category||'Outros'; if(!groups.has(c))groups.set(c,[]); groups.get(c).push(t); });
    el.innerHTML='<option value="">Criar orçamento vazio</option>'+[...groups.entries()].map(([cat,rows])=>`<optgroup label="${esc(cat)}">${rows.map(t=>`<option value="${esc(t.id)}">${esc(t.name)} — ${money(t.subtotal)}</option>`).join('')}</optgroup>`).join('');
    if(active.some(t=>String(t.id)===String(cur))) el.value=cur;
}
function resolvedTemplateItems(t) {
    return arr(t.items).map((x) => { const p=x.productId?productById(x.productId):null; const live=x.priceMode==='live'&&p; return normalizeDraftItem({...x,id:uuid(),unitPrice:live?num(p.price):num(x.unitPrice),unitCost:p?num(p.unitCostTotal??p.cost):num(x.unitCost),priceMode:'snapshot'}, {forTemplate:false}); });
}
function applyTemplateToActiveBudget(t) {
    if (!t) return;
    const option = activeOption();
    if (!option) return;
    option.items = resolvedTemplateItems(t);
    option.name = t.name || option.name;
    option.description = t.description || '';
    option.gallery = normalizeGalleryDraft(t.gallery, t.imageUrl);
    option.imageUrl = safeBudgetMediaUrl(t.imageUrl) || option.gallery[0]?.url || '';
    option.useCases = normalizeUseCasesDraft(t.useCases);
    option.games = normalizeGamesDraft(t.games);
    option.highlights = arr(t.highlights).map((x) => String(x || '').trim()).filter(Boolean).slice(0, 12);
    option.performanceNote = String(t.performanceNote || '');
    option.recommended = true;
    budgetOptionsDraft.forEach((o) => { if (o.id !== option.id) o.recommended = false; });
    document.getElementById('budgetValidUntil').value = addDays(document.getElementById('budgetIssuedAt').value || todayIso(), num(t.defaultValidDays) || 7);
    document.getElementById('budgetDeadline').value = t.deadline || '';
    document.getElementById('budgetWarrantyText').value = t.warrantyText || '';
    document.getElementById('budgetPaymentTerms').value = t.paymentTerms || '';
    document.getElementById('budgetIncludedServices').value = arr(t.includedServices).join('\n');
    document.getElementById('budgetNotes').value = t.customerNotes || '';
    document.getElementById('budgetInternalNotes').value = t.internalNotes || '';
    document.getElementById('budgetTemplateSelect').value = t.id;
    renderOptionTabs();
    renderBudgetItems();
    showToast(`Modelo ${t.name} carregado. O orçamento agora é independente.`, 'success');
}
function loadTemplateIntoBudget(t) {
    if (!t) return;
    const option = activeOption();
    if (option?.items?.length) {
        openBudgetConfirm({
            title: 'Substituir itens da opção?',
            message: `A opção "${option.name || 'Proposta'}" já possui itens. Carregar o modelo substituirá somente os itens e condições desta opção.`,
            confirmText: 'Carregar modelo',
            danger: false,
            onConfirm: () => applyTemplateToActiveBudget(t)
        });
        return;
    }
    applyTemplateToActiveBudget(t);
}

// ---------- Budget editor ----------
function resetBudgetEditor() {
    editingBudgetId = '';
    selectedBudgetCustomerId = '';
    selectedBudgetProductId = '';
    budgetProductAcIndex = -1;
    budgetCustomerAcIndex = -1;
    budgetOptionsDraft = [];
    const first = newOption('Proposta', true);
    budgetOptionsDraft = [first];
    activeBudgetOptionId = first.id;
    document.getElementById('budgetCreateModalTitle').textContent = 'Novo orçamento';
    document.getElementById('budgetEditorSubtitle').textContent = 'Crie vazio ou carregue um modelo.';
    document.getElementById('budgetTemplateLoader').hidden = false;
    document.getElementById('budgetSaveAsTemplateBtn').hidden = false;
    ['budgetCustomerId','budgetCustomerName','budgetCustomerPhone','budgetCustomerEmail','budgetCustomerDoc','budgetCustomerSearch','budgetRejectionNote','budgetDeadline','budgetPaymentTerms','budgetWarrantyText','budgetIncludedServices','budgetNotes','budgetInternalNotes','budgetProductSearch'].forEach((id)=>{const el=document.getElementById(id);if(el)el.value='';});
    ['budgetCustomerResults','budgetProductResults'].forEach((id)=>{const el=document.getElementById(id);if(el)el.hidden=true;});
    document.getElementById('budgetSource').value='';
    document.getElementById('budgetStatus').value='draft';
    document.getElementById('budgetRejectionReason').value='';
    document.getElementById('budgetIssuedAt').value=todayIso();
    document.getElementById('budgetValidUntil').value=addDays(todayIso(),7);
    document.getElementById('budgetTemplateSelect').value='';
    toggleRejectionFields();
    renderOptionTabs();
    renderBudgetItems();
}
function openNewBudget() { resetBudgetEditor(); openBudgetModal('budgetCreateModal'); setTimeout(()=>document.getElementById('budgetCustomerSearch')?.focus(),80); }
function openEditBudget(b) {
    if (!b) return;
    if (b.status === 'converted') {
        showToast('Orçamentos convertidos são somente leitura. Abrindo a pré-visualização.', 'info');
        openBudgetPreview(b);
        return;
    }
    editingBudgetId = String(b.id);
    selectedBudgetCustomerId = String(b.customerId || '');
    selectedBudgetProductId = '';
    budgetProductAcIndex = -1;
    budgetCustomerAcIndex = -1;
    ['budgetCustomerResults','budgetProductResults'].forEach((id)=>{const el=document.getElementById(id);if(el)el.hidden=true;});
    document.getElementById('budgetProductSearch').value = '';
    document.getElementById('budgetCreateModalTitle').textContent = `Editar ${b.code || 'orçamento'}`;
    document.getElementById('budgetEditorSubtitle').textContent = `${statusLabel(b.status)} · ${sourceLabel(b.source)}`;
    document.getElementById('budgetTemplateLoader').hidden = true;
    document.getElementById('budgetSaveAsTemplateBtn').hidden = false;
    document.getElementById('budgetCustomerId').value = b.customerId || '';
    document.getElementById('budgetCustomerName').value = b.customerName || '';
    document.getElementById('budgetCustomerPhone').value = b.customerPhone || '';
    document.getElementById('budgetCustomerEmail').value = b.customerEmail || '';
    document.getElementById('budgetCustomerDoc').value = b.customerDoc || '';
    document.getElementById('budgetCustomerSearch').value = b.customerName || '';
    document.getElementById('budgetSource').value = b.source || '';
    document.getElementById('budgetStatus').value = b.status || 'draft';
    document.getElementById('budgetRejectionReason').value = b.rejectionReason || '';
    document.getElementById('budgetRejectionNote').value = b.rejectionNote || '';
    document.getElementById('budgetIssuedAt').value = (b.issuedAt || todayIso()).slice(0,10);
    document.getElementById('budgetValidUntil').value = (b.validUntil || addDays(todayIso(),7)).slice(0,10);
    document.getElementById('budgetDeadline').value = b.deadline || '';
    document.getElementById('budgetPaymentTerms').value = b.paymentTerms || '';
    document.getElementById('budgetWarrantyText').value = b.warrantyText || '';
    document.getElementById('budgetIncludedServices').value = arr(b.includedServices).join('\n');
    document.getElementById('budgetNotes').value = b.notes || '';
    document.getElementById('budgetInternalNotes').value = b.internalNotes || '';
    fillTemplateSelect();
    document.getElementById('budgetTemplateSelect').value = b.templateId || '';
    budgetOptionsDraft = arr(b.options).length
        ? arr(b.options).map((o)=>optionDraftFromRow(o))
        : [{...newOption('Proposta', true),items:arr(b.items).map((x)=>normalizeDraftItem(x))}];
    if (budgetOptionsDraft.length && !budgetOptionsDraft.some((o)=>o.recommended)) budgetOptionsDraft[0].recommended = true;
    activeBudgetOptionId = String(b.selectedOptionId || budgetOptionsDraft.find(o=>o.recommended)?.id || budgetOptionsDraft[0]?.id);
    toggleRejectionFields();
    renderOptionTabs();
    renderBudgetItems();
    openBudgetModal('budgetCreateModal');
}
function budgetPayload() {
    syncOptionHeader(); syncAdjustmentsFromUi();
    const status=document.getElementById('budgetStatus').value; return {
        customerId:document.getElementById('budgetCustomerId').value.trim(), customerName:document.getElementById('budgetCustomerName').value.trim(), customerPhone:document.getElementById('budgetCustomerPhone').value.trim(), customerEmail:document.getElementById('budgetCustomerEmail').value.trim(), customerDoc:document.getElementById('budgetCustomerDoc').value.trim(),
        source:document.getElementById('budgetSource').value, status, rejectionReason:status==='rejected'?document.getElementById('budgetRejectionReason').value:'', rejectionNote:status==='rejected'?document.getElementById('budgetRejectionNote').value.trim():'',
        issuedAt:document.getElementById('budgetIssuedAt').value, validUntil:document.getElementById('budgetValidUntil').value, deadline:document.getElementById('budgetDeadline').value.trim(), paymentTerms:document.getElementById('budgetPaymentTerms').value.trim(), warrantyText:document.getElementById('budgetWarrantyText').value.trim(), includedServices:document.getElementById('budgetIncludedServices').value.split('\n').map(x=>x.trim()).filter(Boolean), notes:document.getElementById('budgetNotes').value.trim(), internalNotes:document.getElementById('budgetInternalNotes').value.trim(),
        templateId:document.getElementById('budgetTemplateSelect').value||'', selectedOptionId:activeBudgetOptionId, options:budgetOptionsDraft.map((o)=>({...clone(o),items:o.items.map((item)=>({...clone(item),priceMode:'snapshot'}))}))
    };
}
async function saveBudgetEditor() {
    const payload=budgetPayload(); if(!payload.customerName)return showToast('Informe o nome do cliente.','error'); if(!payload.options.length||payload.options.every(o=>!o.items.length))return showToast('Adicione pelo menos um item.','error'); const emptyOption=payload.options.find(o=>!o.items.length); if(emptyOption)return showToast(`A opção \"${emptyOption.name||'sem nome'}\" está sem itens. Preencha ou exclua essa opção.`,'error'); if(payload.validUntil<payload.issuedAt)return showToast('A validade não pode ser anterior à emissão.','error');
    try { const data=await api(editingBudgetId?`/api/budgets/${encodeURIComponent(editingBudgetId)}`:'/api/budgets',{method:editingBudgetId?'PATCH':'POST',body:JSON.stringify(payload)}); upsert('budgets',data.budget); if(data.customerCreated&&data.customer)upsert('customers',data.customer); closeBudgetModal('budgetCreateModal'); renderAll(); showToast('Orçamento salvo com sucesso.','success'); showNotificationStatus(data.notifications); }
    catch(e){console.error(e);showToast(e.message,'error');}
}
function toggleRejectionFields(){document.getElementById('budgetRejectionFields').hidden=document.getElementById('budgetStatus').value!=='rejected';}

// ---------- Cards/dashboard ----------
function normalizedBudgetTotal(b){const opt=arr(b.options).find(o=>String(o.id)===String(b.selectedOptionId))||arr(b.options).find(o=>o.recommended)||arr(b.options)[0];return num(opt?.total??b.total);}
function isFollowUpPending(b){if(!['sent','awaiting'].includes(b.status)||b.followUpDone)return false; const base=new Date(b.sentAt||b.updatedAt||b.createdAt||0).getTime(); return base>0&&Date.now()-base>=3*86400000;}
function renderKpis(){const nowMonth=todayIso().slice(0,7);const list=budgets().filter(b=>String(b.issuedAt||b.createdAt||'').slice(0,7)===nowMonth);const approved=list.filter(b=>['approved','acquiring_parts','converted'].includes(b.status));const rejected=list.filter(b=>b.status==='rejected');const decided=approved.length+rejected.length;const conv=decided?approved.length/decided*100:0;const approvedValue=approved.reduce((s,b)=>s+normalizedBudgetTotal(b),0);const waiting=list.filter(b=>['sent','awaiting'].includes(b.status)).length;document.getElementById('budgetKpis').innerHTML=[['Orçamentos no mês',list.length,'Criados'],['Aprovados',approved.length,money(approvedValue)],['Aguardando',waiting,'Precisam de acompanhamento'],['Conversão',`${conv.toFixed(0)}%`,`${decided} decididos`],['Valor aprovado',money(approvedValue),'Não é lucro']].map(([l,v,s])=>`<div class="card budget-kpi"><div class="kpi-label">${l}</div><div class="kpi-value">${v}</div><div class="kpi-sub">${s}</div></div>`).join('');}

function renderInsights(){
    const nowMonth=todayIso().slice(0,7), list=budgets().filter(b=>String(b.issuedAt||b.createdAt||'').slice(0,7)===nowMonth);
    const sourceCounts=new Map(), sourceValues=new Map();
    list.forEach(b=>{const k=b.source||'other';sourceCounts.set(k,(sourceCounts.get(k)||0)+1);sourceValues.set(k,(sourceValues.get(k)||0)+normalizedBudgetTotal(b));});
    const srcRows=[...sourceCounts.entries()].sort((a,b)=>b[1]-a[1]); const maxSrc=Math.max(1,...srcRows.map(x=>x[1]));
    const srcEl=document.getElementById('budgetSourceSummary');
    srcEl.innerHTML=srcRows.length?srcRows.map(([k,c])=>`<div class="budget-summary-row"><span>${esc(sourceLabel(k))}</span><strong>${c}</strong><span>${money(sourceValues.get(k)||0)}</span><div class="budget-summary-bar"><span style="width:${Math.max(5,c/maxSrc*100)}%"></span></div></div>`).join(''):'<div class="budget-summary-empty">Sem dados de origem neste mês.</div>';
    const lossCounts=new Map(); list.filter(b=>b.status==='rejected').forEach(b=>{const k=b.rejectionReason||'other';lossCounts.set(k,(lossCounts.get(k)||0)+1);});
    const lossRows=[...lossCounts.entries()].sort((a,b)=>b[1]-a[1]); const maxLoss=Math.max(1,...lossRows.map(x=>x[1])); const lossEl=document.getElementById('budgetLossSummary');
    lossEl.innerHTML=lossRows.length?lossRows.map(([k,c])=>`<div class="budget-summary-row"><span>${esc(rejectionLabel(k))}</span><strong>${c}</strong><span></span><div class="budget-summary-bar"><span style="width:${Math.max(5,c/maxLoss*100)}%"></span></div></div>`).join(''):'<div class="budget-summary-empty">Nenhum orçamento recusado neste mês.</div>';
}
function budgetFiltersActive(){return ['budgetSearchInput','budgetStatusFilter','budgetSourceFilter','budgetMonthFilter'].some((id)=>String(document.getElementById(id)?.value||'').trim());}
function clearBudgetFilters(){['budgetSearchInput','budgetStatusFilter','budgetSourceFilter','budgetMonthFilter'].forEach((id)=>{const el=document.getElementById(id);if(el)el.value='';});renderBudgetCards();}
function filteredBudgets(){const q=String(document.getElementById('budgetSearchInput')?.value||'').toLowerCase(),st=document.getElementById('budgetStatusFilter')?.value||'',src=document.getElementById('budgetSourceFilter')?.value||'',month=document.getElementById('budgetMonthFilter')?.value||'';return budgets().filter(b=>{const hay=`${b.code} ${b.customerName} ${arr(b.options).flatMap(o=>arr(o.items).map(i=>i.name)).join(' ')}`.toLowerCase();return(!q||hay.includes(q))&&(!st||b.status===st)&&(!src||b.source===src)&&(!month||String(b.issuedAt||b.createdAt||'').slice(0,7)===month);}).sort((a,b)=>String(b.updatedAt||b.createdAt||'').localeCompare(String(a.updatedAt||a.createdAt||'')));}
function renderBudgetCards(){const all=budgets(),list=filteredBudgets(),hasFilters=budgetFiltersActive(),el=document.getElementById('budgetsGrid'),clearBtn=document.getElementById('clearBudgetFiltersBtn');if(clearBtn)clearBtn.hidden=!hasFilters;document.getElementById('budgetResultCount').textContent=hasFilters?`${list.length} de ${all.length} orçamento(s)`:`${all.length} orçamento(s)`;if(!list.length){el.innerHTML=all.length&&hasFilters?'<div class="empty-state">Nenhum orçamento corresponde aos filtros.<br><button class="btn btn-ghost btn-sm" type="button" data-clear-budget-filters>Limpar filtros</button></div>':'<div class="empty-state">Nenhum orçamento cadastrado.</div>';el.querySelector('[data-clear-budget-filters]')?.addEventListener('click',clearBudgetFilters);return;}el.innerHTML=list.map(b=>{const total=normalizedBudgetTotal(b),opts=arr(b.options),margin=num((opts.find(o=>String(o.id)===String(b.selectedOptionId))||opts.find(o=>o.recommended)||opts[0])?.margin??b.margin);const follow=isFollowUpPending(b),reply=b.customerResponse;return `<article class="budget-card-item${reply?' has-customer-reply':''}"><div class="budget-card-head"><div><div class="budget-card-code">${esc(b.code||'Orçamento')}</div><div class="budget-card-client">${esc(b.customerName||'Sem cliente')}</div></div><span class="budget-status status-${esc(b.status||'draft')}">${esc(statusLabel(b.status))}</span></div><div class="budget-card-meta"><span>${esc(sourceLabel(b.source))}</span><span>Emissão ${dateBr(b.issuedAt||b.createdAt)}</span><span>Validade ${dateBr(b.validUntil)}</span>${opts.length>1?`<span>${opts.length} opções</span>`:''}</div>${reply?`<div class="budget-customer-live">${reply.finalized?'✓ Cliente finalizou':'● Cliente está preenchendo'} · ${esc(opts.find(o=>String(o.id)===String(reply.selectedOptionId))?.name||'opção em análise')}</div>`:''}${b.status==='rejected'?`<div class="budget-card-loss">Motivo: ${esc(rejectionLabel(b.rejectionReason))}${b.rejectionNote?` · ${esc(b.rejectionNote)}`:''}</div>`:''}${follow?'<div class="budget-card-followup">● Follow-up pendente há mais de 3 dias</div>':''}<div class="budget-card-values"><div class="budget-card-value"><small>Total</small><strong>${money(total)}</strong></div><div class="budget-card-value"><small>Lucro bruto</small><strong>${money(b.profit||0)}</strong></div><div class="budget-card-value"><small>Margem</small><strong class="${margin<10?'margin-low':''}">${margin.toFixed(1)}%</strong></div></div><div class="budget-card-actions"><button class="btn btn-primary btn-sm" data-action="share" data-id="${esc(b.id)}">Link do cliente</button>${reply?`<button class="btn btn-ghost btn-sm" data-action="response" data-id="${esc(b.id)}">Ver respostas</button>`:''}<button class="btn btn-ghost btn-sm" data-action="preview" data-id="${esc(b.id)}">Visualizar</button>${b.status!=='converted'?`<button class="btn btn-ghost btn-sm" data-action="edit" data-id="${esc(b.id)}">Editar</button>`:''}<button class="btn btn-ghost btn-sm" data-action="duplicate" data-id="${esc(b.id)}">Duplicar</button>${follow?`<button class="btn btn-ghost btn-sm" data-action="followup" data-id="${esc(b.id)}">Follow-up feito</button>`:''}${['approved','acquiring_parts'].includes(b.status)?`<button class="btn btn-primary btn-sm" data-action="convert" data-id="${esc(b.id)}">Converter em venda</button>`:''}${b.status!=='converted'?`<button class="btn btn-danger-soft btn-sm" data-action="delete" data-id="${esc(b.id)}">Excluir</button>`:''}</div></article>`;}).join('');
    el.querySelectorAll('[data-action]').forEach(btn=>btn.onclick=()=>handleBudgetAction(btn.dataset.action,btn.dataset.id));}
function renderAll(){renderKpis();renderInsights();renderBudgetCards();renderTemplateList();fillTemplateSelect();}
async function executeDuplicateBudget() {
    if (!duplicateBudgetId) return;
    const updatePrices = document.getElementById('duplicateUpdatePrices').checked;
    const keepCustomer = document.getElementById('duplicateKeepCustomer').checked;
    const id = duplicateBudgetId;
    const btn = document.getElementById('confirmDuplicateBtn');
    btn.disabled = true;
    try {
        const data = await api(`/api/budgets/${encodeURIComponent(id)}/duplicate`, { method:'POST', body:JSON.stringify({updatePrices, keepCustomer, validDays:7}) });
        upsert('budgets', data.budget);
        closeBudgetModal('budgetDuplicateModal');
        duplicateBudgetId = '';
        renderAll();
        showToast('Orçamento duplicado.', 'success');
        openEditBudget(data.budget);
    } catch (e) {
        showToast(e.message, 'error');
    } finally {
        btn.disabled = false;
    }
}
function openDuplicateBudgetModal(b) {
    duplicateBudgetId = String(b.id || '');
    document.getElementById('duplicateBudgetCode').textContent = `${b.code || 'Orçamento'} · ${b.customerName || 'Sem cliente'}`;
    document.getElementById('duplicateKeepPrices').checked = true;
    document.getElementById('duplicateUpdatePrices').checked = false;
    document.getElementById('duplicateKeepCustomer').checked = true;
    openBudgetModal('budgetDuplicateModal');
}
async function handleBudgetAction(action,id){
    const b=budgets().find(x=>String(x.id)===String(id));
    if(!b)return;
    if(action==='share'){
        try{const data=await api(`/api/budgets/${encodeURIComponent(id)}/public-link`,{method:'POST',body:JSON.stringify({})});if(data.budget)upsert('budgets',data.budget);await copyBudgetLink(data.url);renderBudgetCards();showToast('Link do cliente copiado.','success');}catch(e){showToast(e.message,'error');}return;
    }
    if(action==='response')return showCustomerResponse(b);
    if(action==='preview')return openBudgetPreview(b);
    if(action==='edit')return openEditBudget(b);
    if(action==='delete'){
        openBudgetConfirm({
            title:'Excluir orçamento',
            message:`Excluir ${b.code || 'este orçamento'} de ${b.customerName || 'sem cliente'}? Esta ação não pode ser desfeita.`,
            confirmText:'Excluir orçamento',
            danger:true,
            onConfirm:async()=>{
                try{await api(`/api/budgets/${encodeURIComponent(id)}`,{method:'DELETE'});window.appData.budgets=budgets().filter(x=>String(x.id)!==String(id));renderAll();showToast('Orçamento excluído.','success');}
                catch(e){showToast(e.message,'error');}
            }
        });
        return;
    }
    if(action==='duplicate')return openDuplicateBudgetModal(b);
    if(action==='followup'){
        try{const data=await api(`/api/budgets/${encodeURIComponent(id)}/follow-up`,{method:'PATCH',body:JSON.stringify({done:true})});upsert('budgets',data.budget);renderAll();showToast('Follow-up registrado.','success');}
        catch(e){showToast(e.message,'error');}
        return;
    }
    if(action==='convert')return openConvertModal(b);
}

function showCustomerResponse(b){const r=b.customerResponse||{},o=arr(b.options).find(x=>String(x.id)===String(r.selectedOptionId)),choices=r.choices||{};const selected=arr(o?.items).filter(i=>choices[i.id]?.included!==false).map(i=>`<li>${esc(i.name)} · qtd. ${num(choices[i.id]?.qty||i.qty)}</li>`).join('');const removed=arr(o?.items).filter(i=>choices[i.id]?.included===false).map(i=>esc(i.name)).join(', ');const requested=arr(r.requestedItems).map(i=>`<li><strong>${esc(i.name)}</strong>${i.details?` — ${esc(i.details)}`:''}</li>`).join('');let modal=document.getElementById('budgetCustomerResponseModal');if(!modal){modal=document.createElement('div');modal.id='budgetCustomerResponseModal';modal.className='pdv-modal-overlay budget-modal-overlay';document.body.appendChild(modal);}modal.innerHTML=`<div class="pdv-modal-card small-modal-card"><div class="pdv-modal-header"><div class="pdv-modal-title">Resposta de ${esc(r.customerName||b.customerName)}</div><button class="pdv-modal-close" type="button">✕</button></div><div class="pdv-modal-body customer-response-body"><span class="budget-customer-live">${r.finalized?'✓ Finalizado pelo cliente':'● Preenchimento em andamento'}</span><h4>${esc(o?.name||'Opção selecionada')}</h4><p>${esc(o?.description||'')}</p><strong>Itens mantidos</strong><ul>${selected||'<li>Nenhum</li>'}</ul>${removed?`<strong>Itens removidos</strong><p>${removed}</p>`:''}${requested?`<strong>Itens solicitados</strong><ul>${requested}</ul>`:''}${r.notes?`<strong>Observações</strong><p>${esc(r.notes)}</p>`:''}</div></div>`;modal.querySelector('.pdv-modal-close').onclick=()=>closeBudgetModal(modal.id);modal.onclick=e=>{if(e.target===modal)closeBudgetModal(modal.id)};openBudgetModal(modal.id);}

// ---------- Preview/share ----------
function openBudgetPreview(b){budgetCurrentRecord=b;openBudgetModal('budgetTemplateModal');loadBudgetTemplatePreview(b,document.getElementById('budgetTemplatePreview'));}
function closeBudgetPreview(){closeBudgetModal('budgetTemplateModal');}
function showNotificationStatus(n){if(!n)return;if(n.email?.sent)showToast('Email enviado automaticamente.','success');if(n.whatsapp?.sent)showToast('WhatsApp enviado automaticamente.','success');}
async function openWhatsappForBudget(){if(!budgetCurrentRecord)return;let phone=String(budgetCurrentRecord.customerPhone||'').replace(/\D/g,'');if(phone&&!phone.startsWith('55'))phone='55'+phone;if(!phone)return showToast('Cliente sem WhatsApp cadastrado.','error');const popup=window.open('about:blank','_blank');if(!popup)return showToast('Permita pop-ups para abrir o WhatsApp.','error');try{const data=await api('/api/budgets/template',{method:'POST',body:JSON.stringify({kind:'whatsapp',budget:budgetCurrentRecord})});popup.location.href=`https://wa.me/${phone}?text=${encodeURIComponent(data.html||'')}`;}catch(e){try{popup.close();}catch(_){}showToast(e.message,'error');}}
function generatePdf(){if(budgetCurrentRecord)printBudgetTemplatePdf(budgetCurrentRecord);}function downloadImage(){if(budgetCurrentRecord)downloadBudgetTemplateImage(budgetCurrentRecord);}

// ---------- Save as template ----------
function openSaveCurrentBudgetAsTemplate() {
    syncOptionHeader();
    syncAdjustmentsFromUi();
    const o = activeOption();
    if (!o || !o.items?.length) return showToast('Adicione itens à opção antes de salvá-la como modelo.', 'error');
    const baseName = (o.name && o.name !== 'Proposta') ? o.name : 'InfoCore Gamer';
    document.getElementById('saveTemplateFromBudgetName').value = baseName;
    document.getElementById('saveTemplateFromBudgetCategory').value = 'PC Gamer';
    document.getElementById('saveTemplateFromBudgetValidDays').value = 7;
    openBudgetModal('budgetSaveTemplateModal');
    setTimeout(()=>document.getElementById('saveTemplateFromBudgetName')?.focus(),80);
}
async function saveCurrentBudgetAsTemplate() {
    syncOptionHeader();
    syncAdjustmentsFromUi();
    const o = activeOption();
    if (!o || !o.items?.length) return showToast('A opção atual está sem itens.', 'error');
    const name = document.getElementById('saveTemplateFromBudgetName').value.trim();
    const category = document.getElementById('saveTemplateFromBudgetCategory').value.trim() || 'Outros';
    const defaultValidDays = Math.min(90, Math.max(1, Math.trunc(num(document.getElementById('saveTemplateFromBudgetValidDays').value) || 7)));
    if (!name) return showToast('Informe o nome do modelo.', 'error');
    const payload = {
        name,
        category,
        description: o.description || '',
        imageUrl: o.imageUrl || '',
        gallery: clone(o.gallery || []),
        useCases: clone(o.useCases || []),
        games: clone(o.games || []),
        highlights: clone(o.highlights || []),
        performanceNote: o.performanceNote || '',
        active: true,
        defaultValidDays,
        deadline: document.getElementById('budgetDeadline').value.trim(),
        warrantyText: document.getElementById('budgetWarrantyText').value.trim(),
        paymentTerms: document.getElementById('budgetPaymentTerms').value.trim(),
        includedServices: document.getElementById('budgetIncludedServices').value.split('\n').map(x=>x.trim()).filter(Boolean),
        customerNotes: document.getElementById('budgetNotes').value.trim(),
        internalNotes: document.getElementById('budgetInternalNotes').value.trim(),
        items: o.items.map((item)=>({...clone(item), priceMode:item.productId ? 'live' : 'snapshot'}))
    };
    const btn = document.getElementById('confirmSaveTemplateBtn');
    btn.disabled = true;
    try {
        const data = await api('/api/budget-templates', {method:'POST', body:JSON.stringify(payload)});
        upsert('budgetTemplates', data.template);
        closeBudgetModal('budgetSaveTemplateModal');
        renderTemplateList();
        fillTemplateSelect();
        showToast('Modelo criado a partir da opção atual.', 'success');
    } catch(e) {
        showToast(e.message, 'error');
    } finally {
        btn.disabled = false;
    }
}

// ---------- Convert sale ----------
function openConvertModal(b){convertBudgetId=String(b.id);const select=document.getElementById('convertOptionSelect');select.innerHTML=arr(b.options).map(o=>`<option value="${esc(o.id)}"${String(o.id)===String(b.selectedOptionId)?' selected':''}>${esc(o.name)} — ${money(o.total)}</option>`).join('');document.getElementById('convertPayment').value='money';document.getElementById('convertCashReceived').value='';document.getElementById('convertAllowStock').checked=false;document.getElementById('convertPaymentConfirmed').checked=false;toggleCashReceived();openBudgetModal('budgetConvertModal');}
function toggleCashReceived(){const show=document.getElementById('convertPayment').value==='money';document.getElementById('convertCashReceivedField').hidden=!show;}
async function confirmConvert(){if(!convertBudgetId)return;const paymentConfirmed=document.getElementById('convertPaymentConfirmed').checked;if(!paymentConfirmed)return showToast('Confirme que o pagamento já foi recebido/aprovado antes de registrar a venda.','error');const id=convertBudgetId;const payload={optionId:document.getElementById('convertOptionSelect').value,payment:document.getElementById('convertPayment').value,cashReceived:document.getElementById('convertCashReceived').value,paymentConfirmed:true,allowInsufficientStock:document.getElementById('convertAllowStock').checked};const btn=document.getElementById('confirmConvertBtn');btn.disabled=true;try{const data=await api(`/api/budgets/${encodeURIComponent(id)}/convert-sale`,{method:'POST',body:JSON.stringify(payload)});if(data.budget)upsert('budgets',data.budget);closeBudgetModal('budgetConvertModal');renderAll();showToast(`Venda ${data.saleCode||''} criada com sucesso.`,'success');}catch(e){if(e.data?.stockInsufficient&&!payload.allowInsufficientStock)showToast(`${e.message} Marque a opção de permitir estoque insuficiente apenas se tiver certeza.`,'error');else showToast(e.message,'error');}finally{btn.disabled=false;}}

// ---------- Events ----------
function bindAutocompleteInput(inputId,resultId,context){
    const input=document.getElementById(inputId),results=document.getElementById(resultId);
    if(!input||!results)return;
    const render=()=>context==='customer'?renderCustomerResults(input.value):renderProductResults(input.value,context);
    input.addEventListener('input',render);
    input.addEventListener('focus',render);
    input.addEventListener('keydown',(e)=>{
        if(e.key==='Escape'){results.hidden=true;return;}
        const buttons=[...results.querySelectorAll('.budget-ac-item')];
        if(!buttons.length)return;
        const getIndex=()=>context==='customer'?budgetCustomerAcIndex:(context==='template'?templateProductAcIndex:budgetProductAcIndex);
        const setIndex=(idx)=>{
            const safe=Math.max(0,Math.min(buttons.length-1,idx));
            if(context==='customer')budgetCustomerAcIndex=safe;else if(context==='template')templateProductAcIndex=safe;else budgetProductAcIndex=safe;
            buttons.forEach((b,i)=>b.classList.toggle('is-active',i===safe));
            buttons[safe]?.scrollIntoView({block:'nearest'});
        };
        if(e.key==='ArrowDown'){e.preventDefault();setIndex(getIndex()+1);return;}
        if(e.key==='ArrowUp'){e.preventDefault();setIndex(getIndex()-1);return;}
        if(e.key==='Enter'){e.preventDefault();const btn=buttons[Math.max(0,getIndex())];if(btn)btn.dispatchEvent(new MouseEvent('mousedown',{bubbles:true}));}
    });
}
function bindEvents(){
    document.getElementById('templateUploadImageBtn').onclick=uploadTemplateImage; document.getElementById('templateImageUrl').oninput=(e)=>updateTemplateImagePreview(e.target.value.trim());
    document.getElementById('openCreateBudgetModalBtn').onclick=openNewBudget; document.getElementById('closeCreateBudgetModalBtn').onclick=()=>closeBudgetModal('budgetCreateModal'); document.getElementById('cancelCreateBudgetBtn').onclick=()=>closeBudgetModal('budgetCreateModal'); document.getElementById('budgetSaveBtn').onclick=saveBudgetEditor; document.getElementById('budgetSaveAsTemplateBtn').onclick=openSaveCurrentBudgetAsTemplate;
    document.getElementById('budgetLoadTemplateBtn').onclick=()=>{const t=templates().find(x=>String(x.id)===String(document.getElementById('budgetTemplateSelect').value));if(t)loadTemplateIntoBudget(t);};
    document.getElementById('addBudgetOptionBtn').onclick=()=>{syncOptionHeader();syncAdjustmentsFromUi();const o=newOption(`Opção ${budgetOptionsDraft.length+1}`);budgetOptionsDraft.push(o);activeBudgetOptionId=o.id;renderOptionTabs();renderBudgetItems();};
    document.getElementById('duplicateBudgetOptionBtn').onclick=()=>{syncOptionHeader();syncAdjustmentsFromUi();const o=activeOption();if(!o)return;const c=clone(o);c.id=uuid();c.name=`${o.name} (cópia)`;c.recommended=false;c.items=c.items.map(x=>({...x,id:uuid()}));budgetOptionsDraft.push(c);activeBudgetOptionId=c.id;renderOptionTabs();renderBudgetItems();};
    document.getElementById('removeBudgetOptionBtn').onclick=()=>{if(budgetOptionsDraft.length<=1)return showToast('O orçamento precisa ter pelo menos uma opção.','error');const i=budgetOptionsDraft.findIndex(o=>String(o.id)===String(activeBudgetOptionId));budgetOptionsDraft.splice(i,1);if(!budgetOptionsDraft.some(o=>o.recommended))budgetOptionsDraft[0].recommended=true;activeBudgetOptionId=budgetOptionsDraft[Math.max(0,i-1)]?.id||budgetOptionsDraft[0].id;renderOptionTabs();renderBudgetItems();};
    document.getElementById('budgetOptionName').onchange=()=>{const o=activeOption();if(o){o.name=document.getElementById('budgetOptionName').value.trim()||'Proposta';renderOptionTabs();}};
    document.getElementById('budgetOptionRecommended').onchange=()=>{const o=activeOption();if(!o)return;const checked=document.getElementById('budgetOptionRecommended').checked;if(checked)budgetOptionsDraft.forEach(x=>x.recommended=x.id===o.id);else o.recommended=false;if(!budgetOptionsDraft.some(x=>x.recommended))o.recommended=true;renderOptionTabs();};
    document.getElementById('budgetOptionDescription').oninput=(event)=>{const option=activeOption();if(option)option.description=event.target.value.slice(0,1200);};
    document.getElementById('budgetOptionHighlights').oninput=(event)=>{const option=activeOption();if(option)option.highlights=event.target.value.split('\n').map((x)=>x.trim().slice(0,160)).filter(Boolean).slice(0,12);};
    document.getElementById('budgetOptionPerformanceNote').oninput=(event)=>{const option=activeOption();if(option)option.performanceNote=event.target.value.slice(0,1000);};
    document.getElementById('budgetUploadGalleryBtn').onclick=()=>document.getElementById('budgetGalleryFiles').click();
    document.getElementById('budgetGalleryFiles').onchange=uploadBudgetGalleryFiles;
    document.getElementById('budgetAddGalleryUrlBtn').onclick=()=>{const option=activeOption(),input=document.getElementById('budgetGalleryUrl');if(!option||!input)return;const url=safeBudgetMediaUrl(input.value);if(!url)return showToast('Informe uma URL http(s) válida para a imagem.','error');if(option.gallery.length>=8)return showToast('Esta opção já possui o limite de 8 fotos.','info');if(option.gallery.some((photo)=>photo.url===url))return showToast('Esta foto já está na galeria.','info');option.gallery.push({id:uuid(),url,alt:'',caption:''});if(!option.imageUrl)option.imageUrl=url;input.value='';renderBudgetPresentationEditor();};
    document.getElementById('budgetGalleryEditor').addEventListener('input',(event)=>{const option=activeOption(),row=event.target.closest('[data-photo-id]');if(!option||!row)return;const photo=option.gallery.find((item)=>String(item.id)===String(row.dataset.photoId));if(!photo)return;if(event.target.classList.contains('budget-photo-caption'))photo.caption=event.target.value.slice(0,300);if(event.target.classList.contains('budget-photo-alt'))photo.alt=event.target.value.slice(0,160);});
    document.getElementById('budgetGalleryEditor').addEventListener('click',(event)=>{const button=event.target.closest('[data-gallery-action]'),option=activeOption();if(!button||!option)return;const row=button.closest('[data-photo-id]'),index=option.gallery.findIndex((item)=>String(item.id)===String(row?.dataset.photoId));if(index<0)return;if(button.dataset.galleryAction==='cover'){const [photo]=option.gallery.splice(index,1);option.gallery.unshift(photo);option.imageUrl=photo.url;}else if(button.dataset.galleryAction==='remove'){option.gallery.splice(index,1);option.imageUrl=option.gallery[0]?.url||'';}renderBudgetPresentationEditor();});
    document.getElementById('budgetAddUseCaseBtn').onclick=()=>{const option=activeOption();if(!option)return;if(option.useCases.length>=12)return showToast('Limite de 12 tarefas por opção.','info');option.useCases.push({id:uuid(),title:'',description:''});renderBudgetPresentationEditor();document.querySelector('#budgetUseCasesEditor [data-usecase-id]:last-child input')?.focus();};
    document.getElementById('budgetUseCasesEditor').addEventListener('input',syncRichRowInput);
    document.getElementById('budgetUseCasesEditor').addEventListener('click',(event)=>{const button=event.target.closest('[data-usecase-action="remove"]'),option=activeOption();if(!button||!option)return;const id=button.closest('[data-usecase-id]')?.dataset.usecaseId;option.useCases=option.useCases.filter((row)=>String(row.id)!==String(id));renderBudgetPresentationEditor();});
    document.getElementById('budgetAddGameBtn').onclick=()=>{const option=activeOption();if(!option)return;if(option.games.length>=20)return showToast('Limite de 20 jogos por opção.','info');option.games.push({id:uuid(),name:'',resolution:'1080p',quality:'Alto',fpsMin:'',fpsMax:'',note:''});renderBudgetPresentationEditor();document.querySelector('#budgetGamesEditor [data-game-id]:last-child input')?.focus();};
    document.getElementById('budgetGamesEditor').addEventListener('input',syncRichRowInput);
    document.getElementById('budgetGamesEditor').addEventListener('click',(event)=>{const button=event.target.closest('[data-game-action="remove"]'),option=activeOption();if(!button||!option)return;const id=button.closest('[data-game-id]')?.dataset.gameId;option.games=option.games.filter((row)=>String(row.id)!==String(id));renderBudgetPresentationEditor();});
    ['budgetDiscountType','budgetDiscountValue','budgetExtraType','budgetExtraValue'].forEach(id=>document.getElementById(id).addEventListener('change',syncAdjustmentsFromUi));
    document.getElementById('budgetAddProductBtn').onclick=()=>{if(selectedBudgetProductId)addProductToContext(selectedBudgetProductId,'budget');else showToast('Selecione um produto.','info');}; document.getElementById('budgetAddCustomBtn').onclick=()=>{activeOption().items.push(normalizeDraftItem({kind:'custom',name:'Serviço personalizado',qty:1,unitPrice:0,condition:'na'}));renderBudgetItems();};
    document.getElementById('budgetStatus').onchange=toggleRejectionFields; document.getElementById('budgetIssuedAt').onchange=()=>{const issue=document.getElementById('budgetIssuedAt').value;const valid=document.getElementById('budgetValidUntil');if(valid.value<issue)valid.value=addDays(issue,7);};
    ['budgetSearchInput','budgetStatusFilter','budgetSourceFilter','budgetMonthFilter'].forEach(id=>document.getElementById(id).addEventListener(id==='budgetSearchInput'?'input':'change',renderBudgetCards));
    document.getElementById('clearBudgetFiltersBtn').onclick=clearBudgetFilters;
    document.getElementById('budgetsGrid').onclick=()=>{};
    document.getElementById('openTemplatesBtn').onclick=()=>{renderTemplateList();if(!editingTemplateId&&templates()[0])loadTemplateEditor(templates()[0]);else if(!templates().length)resetTemplateEditor();openBudgetModal('budgetTemplatesModal');}; document.getElementById('closeTemplatesBtn').onclick=()=>closeBudgetModal('budgetTemplatesModal'); document.getElementById('newTemplateBtn').onclick=resetTemplateEditor; document.getElementById('templateSearchInput').oninput=renderTemplateList; document.getElementById('saveTemplateBtn').onclick=saveTemplate;
    document.getElementById('templateAddCustomBtn').onclick=()=>{templateItemsDraft.push(normalizeDraftItem({kind:'custom',name:'Serviço personalizado',qty:1,unitPrice:0,condition:'na',priceMode:'snapshot'},{forTemplate:true}));renderTemplateItems();};
    document.getElementById('templateAddProductBtn').onclick=()=>{if(selectedTemplateProductId)addProductToContext(selectedTemplateProductId,'template');else{document.getElementById('templateProductSearch').focus();showToast('Pesquise e selecione um produto ou serviço.','info');}};
    document.getElementById('deleteTemplateBtn').onclick=()=>{if(!editingTemplateId)return;const id=editingTemplateId;const t=templates().find(x=>String(x.id)===String(id));openBudgetConfirm({title:'Excluir modelo',message:`Excluir o modelo \"${t?.name||'selecionado'}\"? Orçamentos já criados não serão alterados.`,confirmText:'Excluir modelo',danger:true,onConfirm:async()=>{try{await api(`/api/budget-templates/${encodeURIComponent(id)}`,{method:'DELETE'});window.appData.budgetTemplates=templates().filter(x=>String(x.id)!==String(id));resetTemplateEditor();showToast('Modelo excluído.','success');}catch(e){showToast(e.message,'error');}}});};
    document.getElementById('duplicateTemplateBtn').onclick=async()=>{if(!editingTemplateId)return;try{const data=await api(`/api/budget-templates/${encodeURIComponent(editingTemplateId)}/duplicate`,{method:'POST',body:JSON.stringify({})});upsert('budgetTemplates',data.template);loadTemplateEditor(data.template);showToast('Modelo duplicado.','success');}catch(e){showToast(e.message,'error');}};
    document.getElementById('closeConvertBtn').onclick=()=>closeBudgetModal('budgetConvertModal'); document.getElementById('cancelConvertBtn').onclick=()=>closeBudgetModal('budgetConvertModal'); document.getElementById('convertPayment').onchange=toggleCashReceived; document.getElementById('confirmConvertBtn').onclick=confirmConvert;
    document.getElementById('closeDuplicateBtn').onclick=()=>{duplicateBudgetId='';closeBudgetModal('budgetDuplicateModal');}; document.getElementById('cancelDuplicateBtn').onclick=()=>{duplicateBudgetId='';closeBudgetModal('budgetDuplicateModal');}; document.getElementById('confirmDuplicateBtn').onclick=executeDuplicateBudget;
    document.getElementById('closeSaveTemplateBtn').onclick=()=>closeBudgetModal('budgetSaveTemplateModal'); document.getElementById('cancelSaveTemplateBtn').onclick=()=>closeBudgetModal('budgetSaveTemplateModal'); document.getElementById('confirmSaveTemplateBtn').onclick=saveCurrentBudgetAsTemplate;
    const cancelConfirm=()=>{pendingBudgetConfirm=null;closeBudgetModal('budgetConfirmModal');}; document.getElementById('closeBudgetConfirmBtn').onclick=cancelConfirm; document.getElementById('cancelBudgetConfirmBtn').onclick=cancelConfirm; document.getElementById('confirmBudgetConfirmBtn').onclick=async()=>{const action=pendingBudgetConfirm;pendingBudgetConfirm=null;closeBudgetModal('budgetConfirmModal');if(action){try{await action();}catch(e){console.error(e);showToast(e.message||'Erro na operação.','error');}}};
    document.getElementById('closeBudgetTemplateModalBtn').onclick=closeBudgetPreview; document.getElementById('budgetTemplateDoneBtn').onclick=closeBudgetPreview; document.getElementById('budgetGeneratePdfBtn').onclick=generatePdf; document.getElementById('budgetDownloadImageBtn').onclick=downloadImage; document.getElementById('budgetOpenWhatsappBtn').onclick=openWhatsappForBudget;
    document.getElementById('budgetCopyWhatsappBtn').onclick=async()=>{if(!budgetCurrentRecord)return;try{await copyBudgetTemplateText('whatsapp',budgetCurrentRecord);showToast('Texto do WhatsApp copiado.','success');}catch(e){showToast(e.message||'Erro ao copiar.','error');}}; document.getElementById('budgetCopyEmailBtn').onclick=async()=>{if(!budgetCurrentRecord)return;try{await copyBudgetTemplateText('email',budgetCurrentRecord);showToast('Email copiado.','success');}catch(e){showToast(e.message||'Erro ao copiar.','error');}};
    bindAutocompleteInput('budgetCustomerSearch','budgetCustomerResults','customer'); bindAutocompleteInput('budgetProductSearch','budgetProductResults','budget'); bindAutocompleteInput('templateProductSearch','templateProductResults','template');
    document.addEventListener('click',(e)=>{[['budgetCustomerAcWrap','budgetCustomerResults'],['budgetProductAcWrap','budgetProductResults'],['templateProductAcWrap','templateProductResults']].forEach(([wrap,list])=>{const w=document.getElementById(wrap);if(w&&!w.contains(e.target))document.getElementById(list).hidden=true;});});
    document.addEventListener('keydown',(e)=>{if(e.key==='Escape'&&document.querySelector('.budget-modal-overlay.open')){e.preventDefault();closeTopBudgetModal();return;}if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='s'&&document.getElementById('budgetCreateModal').classList.contains('open')){e.preventDefault();saveBudgetEditor();}});
    ['budgetConvertModal','budgetTemplateModal','budgetDuplicateModal','budgetSaveTemplateModal','budgetConfirmModal'].forEach(id=>document.getElementById(id)?.addEventListener('click',(e)=>{if(e.target.id===id)closeBudgetModal(id);}));
}

function initBudgetsPage(){
    document.querySelectorAll('.budget-modal-overlay').forEach((modal)=>{modal.classList.remove('open');modal.setAttribute('aria-hidden','true');modal.hidden=true;});
    syncBudgetModalLock(); updateTopbarTitle('Orçamentos'); markNavActive('/budgets');
    // O histórico começa sem filtro. O mês atual continua restrito aos KPIs/insights.
    document.getElementById('budgetMonthFilter').value='';
    fillTemplateSelect(); renderAll(); bindEvents();
    setInterval(async()=>{
        if(document.hidden||document.querySelector('.budget-modal-overlay.open'))return;
        try{
            const data=await api('/api/budgets'); window.appData.budgets=data.budgets; budgetRefreshErrorShown=false; renderAll();
        }catch(error){
            console.error('Falha ao atualizar orçamentos:',error);
            if(!budgetRefreshErrorShown){showToast('Não foi possível atualizar a lista de orçamentos. Os dados atuais foram mantidos.','warning');budgetRefreshErrorShown=true;}
        }
    },4000);
    const params=new URLSearchParams(location.search),customerId=params.get('customer');
    if(customerId){openNewBudget();const customer=customers().find((row)=>String(row.id)===String(customerId));if(customer)applyCustomer(customer);}
    const openId=params.get('open');if(openId){const budget=budgets().find((row)=>String(row.id)===String(openId));if(budget)setTimeout(()=>openEditBudget(budget),100);}
}
function bootBudgets(){whenAppReady(()=>initBudgetsPage());}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bootBudgets);else bootBudgets();
