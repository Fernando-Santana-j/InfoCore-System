(() => {
    'use strict';

    const dataNode = document.getElementById('publicBudgetData');
    if (!dataNode) return;

    let data;
    try {
        data = JSON.parse(dataNode.textContent);
    } catch (error) {
        console.error('Não foi possível carregar os dados da proposta.', error);
        return;
    }

    const budget = data.budget && typeof data.budget === 'object' ? data.budget : {};
    const options = Array.isArray(budget.options) ? budget.options : [];
    const storageKey = `infocore-budget-${data.token}`;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const moneyFormatter = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
    const byId = (id) => document.getElementById(id);
    const list = (value) => Array.isArray(value) ? value : [];
    const number = (value, fallback = 0) => {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : fallback;
    };
    const optionalNumber = (value) => {
        if (value == null || value === '') return null;
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
    };
    const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
    const money = (value) => moneyFormatter.format(number(value));
    const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[character]));
    const plainObject = (value) => value && typeof value === 'object' && !Array.isArray(value) ? value : {};

    function safeImageUrl(value) {
        const raw = String(value || '').trim();
        if (!raw) return '';
        if (/^\/(?!\/)/.test(raw)) return raw;
        try {
            const parsed = new URL(raw, window.location.origin);
            return ['http:', 'https:'].includes(parsed.protocol) ? parsed.href : '';
        } catch (_) {
            return '';
        }
    }

    function parseTimestamp(value) {
        const timestamp = Date.parse(String(value || ''));
        return Number.isFinite(timestamp) ? timestamp : 0;
    }

    function readLocalState() {
        try {
            const parsed = JSON.parse(localStorage.getItem(storageKey) || '{}');
            return plainObject(parsed);
        } catch (_) {
            return {};
        }
    }

    const remoteState = plainObject(data.response);
    const storedState = readLocalState();
    const storedUpdatedAt = number(storedState._localUpdatedAt);
    const remoteUpdatedAt = parseTimestamp(remoteState.updatedAt);
    const storedPayload = { ...storedState };
    delete storedPayload._localUpdatedAt;
    delete storedPayload._pendingFinalization;
    const remoteHasProgress = Boolean(remoteState.updatedAt || remoteState.selectedOptionId || remoteState.finalized);
    const storedHasProgress = Boolean(storedUpdatedAt || storedPayload.selectedOptionId || Object.keys(plainObject(storedPayload.choices)).length || list(storedPayload.requestedItems).length || storedPayload.notes);
    const preferStored = storedHasProgress && (!remoteHasProgress || storedUpdatedAt > remoteUpdatedAt);

    const defaultState = {
        selectedOptionId: budget.recommendedOptionId || options[0]?.id || '',
        choices: {},
        requestedItems: [],
        notes: '',
        customerName: budget.customerName || '',
        customerPhone: budget.customerPhone || '',
        finalized: false
    };
    const state = preferStored
        ? { ...defaultState, ...remoteState, ...storedPayload }
        : { ...defaultState, ...storedPayload, ...remoteState };

    state.choices = plainObject(state.choices);
    state.requestedItems = list(state.requestedItems).slice(0, 20).map((item) => ({
        name: String(item?.name || '').slice(0, 120),
        details: String(item?.details || '').slice(0, 500)
    }));
    state.notes = String(state.notes || '').slice(0, 3000);
    state.finalized = state.finalized === true;

    if (!options.some((item) => String(item.id) === String(state.selectedOptionId))) {
        state.selectedOptionId = budget.recommendedOptionId || options[0]?.id || '';
        state.choices = {};
    }

    let localUpdatedAt = storedUpdatedAt;
    let pendingFinalization = preferStored && storedState._pendingFinalization === true;
    let dirty = false;
    let saveTimer = 0;
    let savePromise = null;
    let finishInFlight = false;
    let activeGalleryIndex = 0;
    let currentGallery = [];
    let lightboxIndex = 0;
    let lightboxReturnFocus = null;
    let revealObserver = null;

    const selectedOption = () => options.find((item) => String(item.id) === String(state.selectedOptionId)) || options[0] || null;

    function publicStatePayload() {
        return {
            selectedOptionId: String(state.selectedOptionId || ''),
            choices: plainObject(state.choices),
            requestedItems: list(state.requestedItems).map((item) => ({
                name: String(item?.name || '').slice(0, 120),
                details: String(item?.details || '').slice(0, 500)
            })),
            notes: String(state.notes || '').slice(0, 3000),
            customerName: String(state.customerName || budget.customerName || '').slice(0, 120),
            customerPhone: String(state.customerPhone || budget.customerPhone || '').slice(0, 30),
            finalized: state.finalized === true
        };
    }

    function persistLocalState() {
        try {
            localStorage.setItem(storageKey, JSON.stringify({
                ...publicStatePayload(),
                _localUpdatedAt: localUpdatedAt,
                _pendingFinalization: pendingFinalization
            }));
        } catch (_) {
            // A resposta continua sendo enviada ao servidor mesmo se o armazenamento local estiver indisponível.
        }
    }

    function setSaveState(text, status = 'saved') {
        const element = byId('saveState');
        const textElement = byId('saveStateText');
        if (element) element.dataset.state = status;
        if (textElement) textElement.textContent = text;
    }

    function announce(message) {
        const element = byId('pageAnnouncements');
        if (!element) return;
        element.textContent = '';
        window.setTimeout(() => { element.textContent = message; }, 20);
    }

    function initChoices() {
        const option = selectedOption();
        list(option?.items).forEach((item) => {
            const key = String(item.id || '');
            const existing = plainObject(state.choices[key]);
            if (!Object.prototype.hasOwnProperty.call(state.choices, key)) {
                state.choices[key] = { included: true, qty: Math.max(1, Math.trunc(number(item.qty, 1))) };
                return;
            }
            state.choices[key] = {
                included: existing.included !== false,
                qty: clamp(Math.trunc(number(existing.qty, item.qty || 1)) || 1, 1, 99)
            };
        });
    }

    function invalidateFinalization() {
        if (!state.finalized && !pendingFinalization) return;
        state.finalized = false;
        pendingFinalization = false;
        const feedback = byId('finishFeedback');
        if (feedback) {
            feedback.textContent = 'As escolhas foram alteradas. Finalize novamente quando terminar.';
            feedback.className = 'finish-feedback';
        }
    }

    function markDirty({ immediate = false } = {}) {
        dirty = true;
        localUpdatedAt = Date.now();
        persistLocalState();
        setSaveState('Alterações pendentes', 'pending');
        window.clearTimeout(saveTimer);
        if (!immediate) saveTimer = window.setTimeout(() => { void saveNow(); }, 650);
    }

    async function parseJsonResponse(response) {
        const text = await response.text();
        if (!text) return {};
        try {
            return JSON.parse(text);
        } catch (_) {
            throw new Error('O servidor enviou uma resposta inválida.');
        }
    }

    async function drainSaveQueue({ keepalive = false } = {}) {
        while (dirty) {
            dirty = false;
            const payload = publicStatePayload();
            setSaveState(payload.finalized ? 'Finalizando…' : 'Salvando…', 'saving');

            try {
                const response = await fetch(`${data.apiBase}/${encodeURIComponent(data.token)}/response`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload),
                    keepalive
                });
                const json = await parseJsonResponse(response);
                if (!response.ok || json.error) throw new Error(json.message || 'Não foi possível salvar suas escolhas.');

                if (payload.finalized && state.finalized) pendingFinalization = false;
                persistLocalState();
                setSaveState(dirty ? 'Alterações pendentes' : 'Salvo agora', dirty ? 'pending' : 'saved');
            } catch (error) {
                dirty = true;
                persistLocalState();
                setSaveState('Salvo neste aparelho', 'error');
                renderFinalizationState();
                return false;
            }
        }

        renderFinalizationState();
        return true;
    }

    function saveNow({ keepalive = false } = {}) {
        window.clearTimeout(saveTimer);
        if (savePromise) return savePromise;
        if (!dirty) return Promise.resolve(true);

        savePromise = drainSaveQueue({ keepalive }).finally(() => {
            savePromise = null;
        });
        return savePromise;
    }

    function galleryFor(option) {
        const rawGallery = [];
        if (option?.imageUrl) {
            rawGallery.push({
                id: 'cover',
                url: option.imageUrl,
                alt: `Imagem da configuração ${option.name || ''}`.trim(),
                caption: option.name || ''
            });
        }
        rawGallery.push(...list(option?.gallery));

        const seen = new Set();
        return rawGallery.map((image, index) => {
            const url = safeImageUrl(image?.url || image?.imageUrl);
            return {
                id: String(image?.id || `image-${index}`),
                url,
                alt: String(image?.alt || `Imagem ${index + 1} da configuração ${option?.name || ''}`).trim(),
                caption: String(image?.caption || '').trim()
            };
        }).filter((image) => {
            if (!image.url || seen.has(image.url)) return false;
            seen.add(image.url);
            return true;
        });
    }

    function galleryPlaceholderMarkup() {
        return `<span class="gallery-placeholder" aria-hidden="true">
          <svg viewBox="0 0 260 210" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect x="48" y="20" width="164" height="170" rx="18" stroke="currentColor" stroke-width="4"/>
            <rect x="68" y="43" width="124" height="88" rx="10" stroke="currentColor" stroke-width="3" opacity=".68"/>
            <circle cx="99" cy="87" r="25" stroke="currentColor" stroke-width="3" opacity=".9"/>
            <circle cx="99" cy="87" r="9" fill="currentColor" opacity=".75"/>
            <path d="M145 56h29M145 68h20M145 80h29" stroke="currentColor" stroke-width="3" stroke-linecap="round" opacity=".7"/>
            <path d="M72 154h116" stroke="currentColor" stroke-width="4" stroke-linecap="round" opacity=".75"/>
            <circle cx="183" cy="168" r="5" fill="currentColor"/>
          </svg>
        </span>`;
    }

    function primaryImage(option) {
        return galleryFor(option)[0] || null;
    }

    function renderOptions() {
        const grid = byId('optionGrid');
        if (!grid) return;
        grid.classList.toggle('single-option', options.length === 1);

        const title = byId('optionsTitle');
        const hint = byId('optionsHint');
        if (title) title.textContent = options.length === 1 ? 'Sua configuração' : 'Escolha a configuração';
        if (hint) hint.textContent = options.length === 1
            ? 'Confira tudo o que foi preparado para você.'
            : 'Compare as opções e selecione a que combina com você.';

        if (!options.length) {
            grid.innerHTML = '<div class="custom-card">Nenhuma configuração foi adicionada a esta proposta.</div>';
            return;
        }

        grid.innerHTML = options.map((item, index) => {
            const selected = String(item.id) === String(state.selectedOptionId);
            const image = primaryImage(item);
            const inputId = `public-option-${index}`;
            const descriptionId = `${inputId}-description`;
            const imageMarkup = image
                ? `<img src="${esc(image.url)}" alt="${esc(image.alt)}" loading="lazy" decoding="async">`
                : '<span class="option-media-placeholder" aria-hidden="true">⌁</span>';
            return `<div class="option-card${selected ? ' selected' : ''}" data-option-index="${index}">
              <input class="option-radio" type="radio" name="publicBudgetOption" id="${inputId}" value="${esc(item.id)}"${selected ? ' checked' : ''} aria-describedby="${descriptionId}">
              <label class="option-card-surface" for="${inputId}">
                <span class="option-media">${imageMarkup}${item.recommended ? '<span class="recommended-badge">★ RECOMENDADO</span>' : ''}<span class="selected-badge">✓ SELECIONADO</span></span>
                <span class="option-content">
                  <span class="option-title">${esc(item.name || `Opção ${index + 1}`)}</span>
                  <span class="option-description" id="${descriptionId}">${esc(item.description || 'Uma configuração preparada pela nossa equipe.')}</span>
                  <span class="option-footer"><span class="option-price-wrap"><small>A partir de</small><span class="option-price">${money(item.total)}</span></span><span class="option-select-label">${selected ? 'Sua escolha' : 'Selecionar'} →</span></span>
                </span>
              </label>
            </div>`;
        }).join('');

        grid.querySelectorAll('.option-radio').forEach((radio) => {
            radio.addEventListener('change', () => {
                if (!radio.checked || String(radio.value) === String(state.selectedOptionId)) return;
                state.selectedOptionId = radio.value;
                state.choices = {};
                activeGalleryIndex = 0;
                invalidateFinalization();
                render();
                markDirty();
                announce(`Configuração ${selectedOption()?.name || ''} selecionada.`);
            });
        });

        grid.querySelectorAll('.option-media img').forEach((image) => {
            image.addEventListener('error', () => {
                image.replaceWith(Object.assign(document.createElement('span'), {
                    className: 'option-media-placeholder',
                    textContent: '⌁'
                }));
            }, { once: true });
        });
    }

    function renderGallery() {
        const host = byId('heroGallery');
        if (!host) return;
        const option = selectedOption();
        currentGallery = galleryFor(option);
        activeGalleryIndex = clamp(activeGalleryIndex, 0, Math.max(0, currentGallery.length - 1));

        if (!currentGallery.length) {
            host.innerHTML = `<div class="gallery-stage">${galleryPlaceholderMarkup()}</div>`;
            return;
        }

        const active = currentGallery[activeGalleryIndex];
        const thumbs = currentGallery.length > 1 ? `<div class="gallery-thumbnails" role="list" aria-label="Escolher foto">
          ${currentGallery.map((image, index) => `<button class="gallery-thumb${index === activeGalleryIndex ? ' active' : ''}" type="button" role="listitem" data-gallery-index="${index}" aria-label="Ver foto ${index + 1}: ${esc(image.caption || image.alt)}"${index === activeGalleryIndex ? ' aria-current="true"' : ''}><img src="${esc(image.url)}" alt="" loading="lazy" decoding="async"></button>`).join('')}
        </div>` : '';

        host.innerHTML = `<div class="gallery-stage">
          <button class="gallery-main-button" id="openGalleryBtn" type="button" aria-label="Ampliar foto: ${esc(active.alt)}">
            <img src="${esc(active.url)}" alt="${esc(active.alt)}" decoding="async" loading="eager" fetchpriority="high">
            ${active.caption ? `<span class="gallery-caption">${esc(active.caption)}</span>` : ''}
            <span class="gallery-zoom"><span aria-hidden="true">⌕</span> Ampliar</span>
          </button>
        </div>${thumbs}`;

        const mainButton = byId('openGalleryBtn');
        mainButton?.addEventListener('click', () => openLightbox(activeGalleryIndex, mainButton));
        const mainImage = mainButton?.querySelector('img');
        mainImage?.addEventListener('error', () => {
            mainButton.classList.add('image-error');
            mainButton.disabled = true;
            mainButton.innerHTML = galleryPlaceholderMarkup();
        }, { once: true });

        host.querySelectorAll('[data-gallery-index]').forEach((button) => {
            button.addEventListener('click', () => {
                activeGalleryIndex = number(button.dataset.galleryIndex);
                renderGallery();
            });
            button.querySelector('img')?.addEventListener('error', () => { button.hidden = true; }, { once: true });
        });
    }

    function renderHighlights() {
        const host = byId('highlightList');
        if (!host) return;
        host.innerHTML = list(selectedOption()?.highlights)
            .map((highlight) => String(highlight || '').trim())
            .filter(Boolean)
            .slice(0, 12)
            .map((highlight) => `<span class="highlight-chip"><span aria-hidden="true">✓</span>${esc(highlight)}</span>`)
            .join('');
    }

    function renderUseCases() {
        const section = byId('capabilitiesSection');
        const host = byId('useCaseGrid');
        if (!section || !host) return;
        const useCases = list(selectedOption()?.useCases).filter((item) => item && (item.title || item.description));
        section.hidden = !useCases.length;
        host.innerHTML = useCases.slice(0, 12).map((item, index) => `<article class="capability-card">
          <span class="capability-icon" aria-hidden="true">${String(index + 1).padStart(2, '0')}</span>
          <h3>${esc(item.title || 'Possibilidade de uso')}</h3>
          ${item.description ? `<p>${esc(item.description)}</p>` : ''}
        </article>`).join('');
    }

    function fpsLabel(game) {
        const minimum = optionalNumber(game?.fpsMin);
        const maximum = optionalNumber(game?.fpsMax);
        if ((minimum == null || minimum === 0) && (maximum == null || maximum === 0)) return '—';
        if (minimum != null && maximum != null && minimum !== maximum) return `${Math.round(Math.min(minimum, maximum))}–${Math.round(Math.max(minimum, maximum))}`;
        if (maximum != null) return `${Math.round(maximum)}`;
        if (minimum != null) return `${Math.round(minimum)}+`;
        return '—';
    }

    function renderGames() {
        const section = byId('performanceSection');
        const host = byId('gameGrid');
        const note = byId('performanceNote');
        if (!section || !host || !note) return;
        const option = selectedOption();
        const games = list(option?.games).filter((game) => game && game.name);
        section.hidden = !games.length;
        host.innerHTML = games.slice(0, 20).map((game) => {
            const minimum = optionalNumber(game.fpsMin);
            const maximum = optionalNumber(game.fpsMax);
            const peak = Math.max(0, maximum ?? minimum ?? 0);
            const bar = peak > 0 ? clamp(peak / 240 * 100, 4, 100) : 0;
            return `<article class="game-card">
              <div class="game-head"><h3>${esc(game.name)}</h3><div class="game-fps"><strong>${esc(fpsLabel(game))}</strong><span>FPS</span></div></div>
              <div class="game-specs">${game.resolution ? `<span>${esc(game.resolution)}</span>` : ''}${game.quality ? `<span>${esc(game.quality)}</span>` : ''}</div>
              <div class="fps-track" aria-hidden="true"><span style="--fps:${bar.toFixed(2)}%"></span></div>
              ${game.note ? `<p class="game-note">${esc(game.note)}</p>` : ''}
            </article>`;
        }).join('');
        note.textContent = games.length
            ? String(option.performanceNote || 'O desempenho é uma estimativa e pode variar conforme versão do jogo, atualizações, temperatura, memória e configurações utilizadas.')
            : '';
    }

    function conditionLabel(value) {
        const labels = {
            new: 'Novo', used: 'Usado', semi_new: 'Seminovo', refurbished: 'Recondicionado', na: ''
        };
        return labels[String(value || '').toLowerCase()] ?? String(value || '');
    }

    function adjustment(base, raw) {
        const value = Math.max(0, number(raw?.value));
        return raw?.type === 'percent' ? base * Math.min(100, value) / 100 : value;
    }

    function itemAmounts(item, quantity) {
        const gross = Math.max(0, number(item?.unitPrice)) * Math.max(0, number(quantity));
        const discount = Math.min(gross, adjustment(gross, item?.discount));
        return { gross, discount, total: Math.max(0, gross - discount) };
    }

    function focusItemControl(index, selector) {
        window.requestAnimationFrame(() => {
            byId('itemList')?.querySelector(`[data-item-index="${index}"] ${selector}`)?.focus();
        });
    }

    function renderItems() {
        initChoices();
        const host = byId('itemList');
        if (!host) return;
        const items = list(selectedOption()?.items);
        host.innerHTML = items.map((item, index) => {
            const key = String(item.id || '');
            const choice = state.choices[key] || { included: true, qty: 1 };
            const amounts = itemAmounts(item, choice.qty);
            const tags = [
                conditionLabel(item.condition),
                item.warranty ? `Garantia: ${item.warranty}` : '',
                item.note || '',
                item.specialOrder ? 'Sob encomenda' : ''
            ].filter(Boolean);
            const checkboxId = `public-item-${index}`;
            return `<div class="item-row${choice.included ? '' : ' off'}" data-item-index="${index}">
              <label class="item-check" for="${checkboxId}"><input class="item-toggle" id="${checkboxId}" type="checkbox"${choice.included ? ' checked' : ''} aria-label="Incluir ${esc(item.name)}"><span class="item-check-visual" aria-hidden="true"></span></label>
              <div class="item-copy"><strong class="item-name">${esc(item.name || 'Item')}</strong>${tags.length ? `<div class="item-tags">${tags.map((tag) => `<span class="item-tag${tag === 'Sob encomenda' ? ' special-order' : ''}">${esc(tag)}</span>`).join('')}</div>` : ''}</div>
              <div class="item-actions">
                <div class="qty-control" role="group" aria-label="Quantidade de ${esc(item.name)}"><button type="button" data-delta="-1" aria-label="Diminuir quantidade de ${esc(item.name)}"${choice.qty <= 1 ? ' disabled' : ''}>−</button><output aria-label="Quantidade">${choice.qty}</output><button type="button" data-delta="1" aria-label="Aumentar quantidade de ${esc(item.name)}"${choice.qty >= 99 ? ' disabled' : ''}>+</button></div>
                <div class="item-price-block"><strong>${money(amounts.total)}</strong>${amounts.discount > 0 ? `<del>${money(amounts.gross)}</del>` : ''}</div>
              </div>
            </div>`;
        }).join('');

        host.querySelectorAll('.item-row').forEach((row) => {
            const index = number(row.dataset.itemIndex);
            const item = items[index];
            if (!item) return;
            const key = String(item.id || '');
            row.querySelector('.item-toggle')?.addEventListener('change', (event) => {
                state.choices[key].included = event.target.checked;
                invalidateFinalization();
                renderItems();
                renderSummary();
                markDirty();
                focusItemControl(index, '.item-toggle');
            });
            row.querySelectorAll('[data-delta]').forEach((button) => {
                button.addEventListener('click', () => {
                    const delta = number(button.dataset.delta);
                    state.choices[key].qty = clamp(state.choices[key].qty + delta, 1, 99);
                    invalidateFinalization();
                    renderItems();
                    renderSummary();
                    markDirty();
                    focusItemControl(index, `[data-delta="${delta}"]`);
                });
            });
        });
    }

    function handleEditableChange() {
        invalidateFinalization();
        renderFinalizationState();
        markDirty();
    }

    function renderRequests() {
        const host = byId('requestList');
        if (!host) return;
        host.innerHTML = state.requestedItems.map((request, index) => {
            const nameId = `request-name-${index}`;
            const detailsId = `request-details-${index}`;
            return `<div class="request-row" data-request-index="${index}">
              <label class="sr-only" for="${nameId}">Peça ou serviço solicitado</label><input id="${nameId}" value="${esc(request.name)}" maxlength="120" placeholder="Peça ou serviço" autocomplete="off">
              <label class="sr-only" for="${detailsId}">Detalhes da solicitação</label><input id="${detailsId}" value="${esc(request.details)}" maxlength="500" placeholder="Detalhes, preferência, quantidade..." autocomplete="off">
              <button class="request-remove" type="button" aria-label="Remover solicitação ${index + 1}">×</button>
            </div>`;
        }).join('');

        host.querySelectorAll('.request-row').forEach((row) => {
            const index = number(row.dataset.requestIndex);
            const inputs = row.querySelectorAll('input');
            inputs[0]?.addEventListener('input', (event) => {
                state.requestedItems[index].name = event.target.value;
                handleEditableChange();
            });
            inputs[1]?.addEventListener('input', (event) => {
                state.requestedItems[index].details = event.target.value;
                handleEditableChange();
            });
            row.querySelector('.request-remove')?.addEventListener('click', () => {
                state.requestedItems.splice(index, 1);
                invalidateFinalization();
                renderRequests();
                renderSummary();
                markDirty();
                announce('Solicitação removida.');
            });
        });
    }

    function summaryAmounts() {
        const option = selectedOption();
        let grossSubtotal = 0;
        let itemDiscount = 0;
        let subtotal = 0;
        let keptItems = 0;
        list(option?.items).forEach((item) => {
            const choice = state.choices[String(item.id || '')];
            if (!choice?.included) return;
            const amounts = itemAmounts(item, choice.qty);
            grossSubtotal += amounts.gross;
            itemDiscount += amounts.discount;
            subtotal += amounts.total;
            keptItems += 1;
        });
        const optionDiscount = Math.min(subtotal, adjustment(subtotal, option?.discount));
        const extra = adjustment(subtotal, option?.extra);
        const total = Math.max(0, subtotal - optionDiscount + extra);
        return { grossSubtotal, itemDiscount, subtotal, optionDiscount, extra, total, keptItems };
    }

    function cardTotals(value) {
        const option = selectedOption();
        const configured = plainObject(option?.cardPayments);
        let rate = optionalNumber(configured.installmentRate);
        const originalTotal = number(option?.total);
        const originalCardTotal = number(configured.cardTotal || configured.installmentTotal);
        if (rate == null && originalTotal > 0 && originalCardTotal >= originalTotal) {
            rate = (originalCardTotal / originalTotal - 1) * 100;
        }
        if (rate == null) rate = 9.67;
        const installments = clamp(Math.trunc(number(configured.installments, 6)) || 6, 1, 24);
        const baseCents = Math.max(0, Math.round(value * 100));
        const cardTotalCents = Math.round(baseCents * (1 + Math.max(0, rate) / 100));
        return {
            installments,
            cardTotal: cardTotalCents / 100,
            installmentValue: Math.round(cardTotalCents / installments) / 100
        };
    }

    function renderSummary() {
        initChoices();
        const option = selectedOption();
        const amounts = summaryAmounts();
        const payment = cardTotals(amounts.total);
        const totalElement = byId('summaryTotal');
        const mobileTotal = byId('mobileSummaryTotal');
        if (totalElement) totalElement.textContent = money(amounts.total);
        if (mobileTotal) mobileTotal.textContent = money(amounts.total);

        const summaryOption = byId('summaryOption');
        if (summaryOption) {
            const image = primaryImage(option);
            summaryOption.innerHTML = `<span class="summary-option-visual">${image ? `<img src="${esc(image.url)}" alt="" loading="lazy" decoding="async">` : '<span aria-hidden="true">⌁</span>'}</span><span class="summary-option-copy"><strong>${esc(option?.name || 'Configuração')}</strong><small>${amounts.keptItems} ${amounts.keptItems === 1 ? 'item selecionado' : 'itens selecionados'}</small></span>`;
            summaryOption.querySelector('img')?.addEventListener('error', (event) => { event.target.hidden = true; }, { once: true });
        }

        const breakdownRows = [];
        if (amounts.itemDiscount > 0 || amounts.optionDiscount > 0 || amounts.extra > 0) {
            breakdownRows.push(['Subtotal dos itens', money(amounts.grossSubtotal), '']);
        }
        if (amounts.itemDiscount > 0) breakdownRows.push(['Descontos nos itens', `− ${money(amounts.itemDiscount)}`, 'discount']);
        if (amounts.optionDiscount > 0) breakdownRows.push(['Desconto da proposta', `− ${money(amounts.optionDiscount)}`, 'discount']);
        if (amounts.extra > 0) breakdownRows.push(['Acréscimo', `+ ${money(amounts.extra)}`, '']);
        const breakdown = byId('summaryBreakdown');
        if (breakdown) breakdown.innerHTML = breakdownRows.map(([label, value, className]) => `<div class="summary-breakdown-row ${className}"><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`).join('');

        const payments = byId('summaryPayments');
        if (payments) payments.innerHTML = `<span><span>No cartão</span><strong>${money(payment.cardTotal)}</strong></span><span><span>Parcelamento</span><strong>${payment.installments}x de ${money(payment.installmentValue)}</strong></span>`;

        const summaryText = byId('summaryText');
        if (summaryText) summaryText.textContent = `${amounts.keptItems} ${amounts.keptItems === 1 ? 'item mantido' : 'itens mantidos'}${state.requestedItems.length ? ` · ${state.requestedItems.length} ${state.requestedItems.length === 1 ? 'solicitação extra' : 'solicitações extras'}` : ''}. A equipe confirmará disponibilidade e alterações solicitadas.`;
        renderFinalizationState();
    }

    function conditionBlock(icon, title, content, { full = false, html = false } = {}) {
        if (!content) return '';
        return `<article class="condition-block${full ? ' full' : ''}"><div class="condition-block-head"><span class="condition-icon" aria-hidden="true">${icon}</span><h3>${esc(title)}</h3></div>${html ? content : `<p>${esc(content)}</p>`}</article>`;
    }

    function renderConditions() {
        const section = byId('conditionsSection');
        const host = byId('conditionsCard');
        if (!section || !host) return;
        const services = list(budget.includedServices).map((item) => String(item || '').trim()).filter(Boolean);
        const blocks = [
            conditionBlock('◷', 'Prazo', String(budget.deadline || '').trim()),
            conditionBlock('◇', 'Pagamento', String(budget.paymentTerms || '').trim()),
            conditionBlock('✓', 'Garantia', String(budget.warrantyText || '').trim()),
            services.length ? conditionBlock('＋', 'Serviços incluídos', `<ul class="service-list">${services.map((service) => `<li>${esc(service)}</li>`).join('')}</ul>`, { full: true, html: true }) : '',
            conditionBlock('i', 'Observações da proposta', String(budget.notes || '').trim(), { full: true })
        ].filter(Boolean);
        section.hidden = !blocks.length;
        host.innerHTML = blocks.join('');
    }

    function whatsappUrl() {
        const phone = String(data.storePhone || '').replace(/\D/g, '');
        const option = selectedOption();
        const total = summaryAmounts().total;
        const text = `Olá! Sou ${state.customerName || budget.customerName || 'cliente'} e finalizei minhas escolhas da proposta ${budget.code || ''}. Escolhi: ${option?.name || 'configuração'} (${money(total)}).`;
        const destination = phone ? (phone.startsWith('55') ? phone : `55${phone}`) : '';
        return destination
            ? `https://wa.me/${destination}?text=${encodeURIComponent(text)}`
            : `https://wa.me/?text=${encodeURIComponent(text)}`;
    }

    function renderFinalizationState() {
        const desktopButton = byId('finishBtn');
        const mobileButton = byId('mobileFinishBtn');
        const whatsapp = byId('whatsappBtn');
        const feedback = byId('finishFeedback');
        const confirmed = state.finalized && !pendingFinalization;

        [desktopButton, mobileButton].forEach((button) => {
            if (!button) return;
            button.disabled = finishInFlight;
            button.classList.toggle('is-finalized', confirmed);
        });

        if (finishInFlight) {
            if (desktopButton) desktopButton.innerHTML = 'Confirmando escolhas…';
            if (mobileButton) mobileButton.textContent = 'Confirmando…';
            if (feedback) {
                feedback.textContent = 'Aguarde enquanto enviamos sua seleção para a loja.';
                feedback.className = 'finish-feedback';
            }
        } else if (confirmed) {
            if (desktopButton) desktopButton.innerHTML = 'Escolhas finalizadas <span aria-hidden="true">✓</span>';
            if (mobileButton) mobileButton.textContent = 'Finalizado ✓';
            if (feedback) {
                feedback.textContent = 'Tudo certo! A loja já pode consultar suas escolhas.';
                feedback.className = 'finish-feedback success';
            }
        } else if (pendingFinalization) {
            if (desktopButton) desktopButton.innerHTML = 'Tentar finalizar novamente <span aria-hidden="true">→</span>';
            if (mobileButton) mobileButton.textContent = 'Tentar novamente';
            if (feedback) {
                feedback.textContent = 'Ainda não foi possível confirmar com a loja. Suas escolhas estão salvas neste aparelho.';
                feedback.className = 'finish-feedback error';
            }
        } else {
            if (desktopButton) desktopButton.innerHTML = 'Finalizar minhas escolhas <span aria-hidden="true">→</span>';
            if (mobileButton) mobileButton.innerHTML = 'Finalizar <span aria-hidden="true">→</span>';
            if (feedback && !feedback.textContent.includes('alteradas')) {
                feedback.textContent = '';
                feedback.className = 'finish-feedback';
            }
        }

        if (whatsapp) {
            whatsapp.hidden = !confirmed;
            if (confirmed) whatsapp.href = whatsappUrl();
        }
    }

    async function finishSelections() {
        if (finishInFlight || !selectedOption()) return;
        state.finalized = true;
        pendingFinalization = true;
        finishInFlight = true;
        markDirty({ immediate: true });
        renderFinalizationState();

        const succeeded = await saveNow();
        finishInFlight = false;
        if (succeeded) {
            pendingFinalization = false;
            persistLocalState();
            setSaveState('Escolhas salvas', 'saved');
            announce('Suas escolhas foram finalizadas e enviadas para a loja.');
        } else {
            pendingFinalization = true;
            persistLocalState();
            announce('Não foi possível confirmar a finalização. Tente novamente quando estiver conectado.');
        }
        renderFinalizationState();
        byId('summaryCard')?.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' });
    }

    function updateLightbox() {
        const image = currentGallery[lightboxIndex];
        if (!image) return closeLightbox();
        const element = byId('lightboxImage');
        if (element) {
            element.src = image.url;
            element.alt = image.alt;
        }
        const caption = byId('lightboxCaption');
        if (caption) caption.textContent = image.caption;
        const counter = byId('lightboxCounter');
        if (counter) counter.textContent = `${lightboxIndex + 1} de ${currentGallery.length}`;
        const previous = byId('lightboxPrev');
        const next = byId('lightboxNext');
        if (previous) previous.hidden = currentGallery.length < 2;
        if (next) next.hidden = currentGallery.length < 2;
    }

    function openLightbox(index, returnFocus) {
        if (!currentGallery.length) return;
        lightboxIndex = clamp(index, 0, currentGallery.length - 1);
        lightboxReturnFocus = returnFocus || document.activeElement;
        const lightbox = byId('galleryLightbox');
        if (!lightbox) return;
        lightbox.hidden = false;
        lightbox.setAttribute('aria-hidden', 'false');
        document.body.classList.add('lightbox-open');
        updateLightbox();
        lightbox.querySelector('.lightbox-close')?.focus();
    }

    function closeLightbox() {
        const lightbox = byId('galleryLightbox');
        if (!lightbox || lightbox.hidden) return;
        lightbox.setAttribute('aria-hidden', 'true');
        lightbox.hidden = true;
        document.body.classList.remove('lightbox-open');
        lightboxReturnFocus?.focus?.();
        lightboxReturnFocus = null;
    }

    function moveLightbox(delta) {
        if (currentGallery.length < 2) return;
        lightboxIndex = (lightboxIndex + delta + currentGallery.length) % currentGallery.length;
        updateLightbox();
    }

    function bindLightbox() {
        const lightbox = byId('galleryLightbox');
        if (!lightbox) return;
        lightbox.querySelectorAll('[data-lightbox-close]').forEach((element) => element.addEventListener('click', closeLightbox));
        byId('lightboxPrev')?.addEventListener('click', () => moveLightbox(-1));
        byId('lightboxNext')?.addEventListener('click', () => moveLightbox(1));

        let touchStartX = 0;
        lightbox.addEventListener('touchstart', (event) => { touchStartX = event.changedTouches[0]?.clientX || 0; }, { passive: true });
        lightbox.addEventListener('touchend', (event) => {
            const endX = event.changedTouches[0]?.clientX || 0;
            if (Math.abs(endX - touchStartX) < 55) return;
            moveLightbox(endX < touchStartX ? 1 : -1);
        }, { passive: true });

        document.addEventListener('keydown', (event) => {
            if (lightbox.hidden) return;
            if (event.key === 'Escape') {
                event.preventDefault();
                closeLightbox();
                return;
            }
            if (event.key === 'ArrowLeft') {
                event.preventDefault();
                moveLightbox(-1);
                return;
            }
            if (event.key === 'ArrowRight') {
                event.preventDefault();
                moveLightbox(1);
                return;
            }
            if (event.key !== 'Tab') return;
            const focusable = [...lightbox.querySelectorAll('button:not([hidden]):not(:disabled), [href], [tabindex]:not([tabindex="-1"])')];
            if (!focusable.length) return;
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
            }
        });
    }

    function observeRevealElements() {
        const elements = document.querySelectorAll('[data-reveal]');
        if (reduceMotion || !('IntersectionObserver' in window)) {
            elements.forEach((element) => element.classList.add('is-visible'));
            return;
        }
        if (!revealObserver) {
            revealObserver = new IntersectionObserver((entries, observer) => {
                entries.forEach((entry) => {
                    if (!entry.isIntersecting) return;
                    entry.target.classList.add('is-visible');
                    observer.unobserve(entry.target);
                });
            }, { rootMargin: '0px 0px -8% 0px', threshold: .08 });
        }
        elements.forEach((element) => {
            if (!element.classList.contains('is-visible')) revealObserver.observe(element);
        });
    }

    function render() {
        renderOptions();
        renderGallery();
        renderHighlights();
        renderUseCases();
        renderGames();
        renderItems();
        renderRequests();
        renderConditions();
        renderSummary();
        const notes = byId('notes');
        if (notes && notes.value !== state.notes) notes.value = state.notes;
        observeRevealElements();
    }

    function bindPageEvents() {
        byId('addRequestBtn')?.addEventListener('click', () => {
            if (state.requestedItems.length >= 20) {
                announce('Você pode adicionar até vinte solicitações extras.');
                return;
            }
            state.requestedItems.push({ name: '', details: '' });
            invalidateFinalization();
            renderRequests();
            renderSummary();
            markDirty();
            byId('requestList')?.querySelector('.request-row:last-child input')?.focus();
        });

        byId('notes')?.addEventListener('input', (event) => {
            state.notes = event.target.value;
            handleEditableChange();
        });
        byId('finishBtn')?.addEventListener('click', finishSelections);
        byId('mobileFinishBtn')?.addEventListener('click', finishSelections);

        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'hidden' && dirty) void saveNow({ keepalive: true });
        });
        window.addEventListener('pagehide', () => {
            if (dirty) void saveNow({ keepalive: true });
        });
    }

    initChoices();
    document.body.classList.add('motion-ready');
    bindLightbox();
    bindPageEvents();
    render();

    if (pendingFinalization) setSaveState('Finalização pendente', 'error');
    else if (state.finalized) setSaveState('Escolhas salvas', 'saved');
    else setSaveState('Salvo', 'saved');
})();
