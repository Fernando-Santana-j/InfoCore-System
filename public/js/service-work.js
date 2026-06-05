let service = window.appData?.service || null;
let defectItems = [];
let currentStep = 0;
let phase = 'items';
const pendingPhotos = [];
const pendingBeforePhotos = [];
const pendingAfterPhotos = [];
/** @type {'done'|'archive'} */
let itemOutcome = 'done';

function esc(v) {
    return String(v || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function statusLabel(st) {
    const m = {
        open: 'Aberta',
        in_progress: 'Em andamento',
        waiting_parts: 'Aguardando peça',
        done: 'Concluída',
        delivered: 'Entregue'
    };
    return m[String(st || '')] || 'Aberta';
}

function syncDefectItems() {
    defectItems = (service?.checklist || []).filter((i) => i.defective);
}

function itemIsFinished(item) {
    return Boolean(item?.done || item?.archived);
}

function repairProgress() {
    if (!defectItems.length) return 0;
    const done = defectItems.filter((i) => itemIsFinished(i)).length;
    return Math.round((done / defectItems.length) * 100);
}

function initialStepIndex() {
    const params = new URLSearchParams(window.location.search);
    const q = Number(params.get('step'));
    if (Number.isFinite(q) && q >= 0 && q < defectItems.length) return q;
    const firstPending = defectItems.findIndex((i) => !itemIsFinished(i));
    return firstPending >= 0 ? firstPending : 0;
}

function currentItem() {
    return defectItems[currentStep] || null;
}

function renderPhotos(photos, extraClass) {
    if (!photos?.length) return '';
    const cls = extraClass ? ` ${extraClass}` : '';
    return `<div class="svc-photo-row${cls}">${photos.map((p) => `
        <a class="svc-photo-thumb" href="${esc(p.url)}" target="_blank" rel="noopener">
            <img src="${esc(p.url)}" alt="">
        </a>
    `).join('')}</div>`;
}

function renderTop() {
    const el = document.getElementById('svcWorkTop');
    if (!el || !service) return;
    const prog = repairProgress();
    el.innerHTML = `
        <a href="/services" class="svc-work-back btn btn-ghost btn-sm">← Oficina</a>
        <div class="svc-work-top-info">
            <div class="svc-work-top-codes">
                <span class="svc-order-code">${esc(service.code)}</span>
                <span class="svc-status ${esc(service.status)}">${esc(statusLabel(service.status))}</span>
            </div>
            <h2 class="svc-work-title">${esc(service.customerName)}</h2>
            <p class="svc-work-device">${esc(service.deviceType)} · ${esc(service.deviceBrandModel)}</p>
        </div>
        <div class="svc-work-top-progress">
            <div class="svc-detail-progress-ring" style="background: conic-gradient(var(--gold) ${prog}%, var(--bg3) 0)"><span>${prog}%</span></div>
            <span class="svc-work-progress-label">${defectItems.filter((i) => itemIsFinished(i)).length}/${defectItems.length} itens</span>
        </div>
    `;
}

function renderStepper() {
    const el = document.getElementById('svcWorkStepper');
    if (!el) return;
    if (phase !== 'items' || !defectItems.length) {
        el.innerHTML = '';
        el.hidden = true;
        return;
    }
    el.hidden = false;
    el.innerHTML = defectItems.map((item, i) => {
        let cls = 'svc-work-step-pill';
        if (i === currentStep) cls += ' is-active';
        if (itemIsFinished(item)) cls += ' is-done';
        else if (i < currentStep) cls += ' is-past';
        return `
            <button type="button" class="${cls}" data-step="${i}" title="${esc(item.label)}">
                <span class="svc-work-step-pill-num">${i + 1}</span>
                <span class="svc-work-step-pill-icon">${esc(item.icon || '🔧')}</span>
            </button>
        `;
    }).join('');
    el.querySelectorAll('.svc-work-step-pill').forEach((btn) => {
        btn.addEventListener('click', () => {
            const idx = Number(btn.getAttribute('data-step'));
            if (!Number.isFinite(idx)) return;
            goToStep(idx, false);
        });
    });
}

function renderEmpty() {
    phase = 'empty';
    document.getElementById('svcWorkStepper').hidden = true;
    document.getElementById('svcWorkMain').innerHTML = `
        <div class="svc-work-empty">
            <div class="empty-icon">📋</div>
            <h3>Nenhum defeito marcado</h3>
            <p>Esta OS não tem itens no checklist. Volte à oficina ou registre defeitos no PDV.</p>
            <a href="/services" class="btn btn-primary btn-sm">Voltar à oficina</a>
        </div>
    `;
    document.getElementById('svcWorkFooter').innerHTML = '';
}

function renderSummary() {
    phase = 'summary';
    document.getElementById('svcWorkStepper').hidden = true;
    const budgetBtn = service.budgetId
        ? `<a class="btn btn-primary btn-sm" href="/budgets?open=${encodeURIComponent(service.budgetId)}">Abrir orçamento</a>`
        : '';
    document.getElementById('svcWorkMain').innerHTML = `
        <div class="svc-work-summary">
            <div class="svc-work-summary-icon">✓</div>
            <h3>Checklist percorrido</h3>
            <p>Você revisou todos os ${defectItems.length} itens. Ajuste o status da OS se necessário.</p>
            <div class="svc-work-summary-stats">
                <div class="svc-stat-pill"><strong>${defectItems.filter((i) => i.done).length}</strong><span>Concluídos</span></div>
                <div class="svc-stat-pill"><strong>${defectItems.filter((i) => i.archived).length}</strong><span>Arquivados</span></div>
                <div class="svc-stat-pill"><strong>${defectItems.filter((i) => !itemIsFinished(i)).length}</strong><span>Pendentes</span></div>
            </div>
            <div class="svc-work-summary-actions">
                <p class="form-label">Finalizar ordem de serviço</p>
                <div class="svc-work-final-btns">
                    <button type="button" class="btn btn-primary btn-sm" id="svcWorkMarkDoneBtn">✓ OS concluída</button>
                    <button type="button" class="btn btn-ghost btn-sm" id="svcWorkArchiveBtn">📦 Arquivar OS</button>
                </div>
                ${budgetBtn}
                <button type="button" class="btn btn-ghost btn-sm" id="svcWorkReviewBtn">Revisar itens</button>
                <button type="button" class="btn btn-primary btn-sm svc-work-share-btn" id="svcWorkShareBtn">✨ Enviar relatório ao cliente</button>
            </div>
        </div>
    `;
    document.getElementById('svcWorkFooter').innerHTML = `
        <a href="/services" class="btn btn-ghost btn-sm">Voltar à oficina</a>
        <button type="button" class="btn btn-primary btn-sm" id="svcWorkShareBtnFooter">Enviar ao cliente</button>
    `;
    document.getElementById('svcWorkShareBtn')?.addEventListener('click', openShareModal);
    document.getElementById('svcWorkShareBtnFooter')?.addEventListener('click', openShareModal);
    document.getElementById('svcWorkMarkDoneBtn')?.addEventListener('click', async () => {
        const updated = await persistPatch({ status: 'done' });
        if (updated) {
            service = updated;
            renderTop();
            showToast('OS marcada como concluída.', 'success');
        }
    });
    document.getElementById('svcWorkArchiveBtn')?.addEventListener('click', async () => {
        if (!confirm('Arquivar esta OS? Ela ficará como entregue na lista.')) return;
        const updated = await persistPatch({ status: 'delivered' });
        if (updated) {
            service = updated;
            renderTop();
            showToast('OS arquivada.', 'success');
        }
    });
    document.getElementById('svcWorkReviewBtn')?.addEventListener('click', () => {
        phase = 'items';
        currentStep = 0;
        const url = new URL(window.location.href);
        url.searchParams.set('view', 'items');
        window.history.replaceState({}, '', url);
        renderAll();
    });
}

function renderItemStep() {
    const main = document.getElementById('svcWorkMain');
    const footer = document.getElementById('svcWorkFooter');
    const item = currentItem();
    if (!main || !item) return;

    pendingPhotos.length = 0;
    pendingBeforePhotos.length = 0;
    pendingAfterPhotos.length = 0;
    itemOutcome = item.archived ? 'archive' : 'done';

    main.innerHTML = `
        <article class="svc-work-card">
            <header class="svc-work-card-head">
                <span class="svc-work-card-icon">${esc(item.icon || '🔧')}</span>
                <div>
                    <p class="svc-work-card-step">Item ${currentStep + 1} de ${defectItems.length}</p>
                    <h3 class="svc-work-card-title">${esc(item.label)}</h3>
                </div>
                <span class="svc-defect-badge ${item.archived ? 'is-archived' : ''} ${item.done ? 'is-done' : ''}">${item.archived ? 'Arquivado' : (item.done ? 'Concluído' : 'Em reparo')}</span>
            </header>

            ${item.customerNote || (item.photos || []).length ? `
            <section class="svc-work-section svc-work-section--intake">
                <h4 class="svc-work-section-title">📥 Relato do balcão</h4>
                ${item.customerNote ? `<p class="svc-work-intake-note">${esc(item.customerNote)}</p>` : ''}
                ${item.estimatedPrice > 0 ? `<p class="svc-defect-price">Ref. balcão: ${formatCurrency(Number(item.estimatedPrice))}</p>` : ''}
                ${renderPhotos(item.photos)}
            </section>` : ''}

            <section class="svc-work-section">
                <h4 class="svc-work-section-title">🔧 O que foi feito</h4>
                <textarea class="form-input svc-work-tech-note" id="svcWorkTechNote" rows="4" placeholder="Descreva o reparo realizado neste item...">${esc(item.techNote)}</textarea>
            </section>

            <section class="svc-work-section">
                <h4 class="svc-work-section-title">📷 Antes e depois</h4>
                <div class="svc-work-ba-grid">
                    <div class="svc-work-ba-col svc-work-ba-col--before">
                        <span class="svc-work-ba-label">Antes</span>
                        ${renderPhotos(item.beforePhotos?.length ? item.beforePhotos : (item.techPhotos || []).filter((p) => p.kind === 'before'))}
                        <label class="btn btn-ghost btn-sm svc-work-photo-label">
                            + Antes
                            <input type="file" id="svcWorkPhotoBefore" accept="image/*" capture="environment" multiple hidden>
                        </label>
                    </div>
                    <div class="svc-work-ba-col svc-work-ba-col--after">
                        <span class="svc-work-ba-label">Depois</span>
                        ${renderPhotos(item.afterPhotos?.length ? item.afterPhotos : (item.techPhotos || []).filter((p) => p.kind === 'after'))}
                        <label class="btn btn-ghost btn-sm svc-work-photo-label">
                            + Depois
                            <input type="file" id="svcWorkPhotoAfter" accept="image/*" capture="environment" multiple hidden>
                        </label>
                    </div>
                </div>
            </section>
            <section class="svc-work-section">
                <h4 class="svc-work-section-title">📷 Outras fotos do reparo</h4>
                ${renderPhotos((item.techPhotos || []).filter((p) => !p.kind || p.kind === 'general'), 'svc-work-existing-photos')}
                <div class="svc-work-upload-zone">
                    <label class="btn btn-ghost btn-sm svc-work-photo-label">
                        Adicionar fotos
                        <input type="file" id="svcWorkPhotoInput" accept="image/*" capture="environment" multiple hidden>
                    </label>
                    <span class="svc-work-pending" id="svcWorkPending" hidden></span>
                </div>
            </section>

            <div class="svc-work-outcome">
                <span class="form-label">Situação desta etapa</span>
                <div class="svc-work-outcome-btns" role="group" aria-label="Situação da etapa">
                    <button type="button" class="svc-work-outcome-btn is-active" data-outcome="done" id="svcWorkOutcomeDone">✓ Concluído</button>
                    <button type="button" class="svc-work-outcome-btn" data-outcome="archive" id="svcWorkOutcomeArchive">📦 Arquivar</button>
                </div>
            </div>
        </article>
    `;

    const isLast = currentStep >= defectItems.length - 1;
    footer.innerHTML = `
        <div class="svc-work-footer-hint">Etapa ${currentStep + 1} de ${defectItems.length}</div>
        <div class="svc-work-footer-actions">
            <button type="button" class="btn btn-ghost btn-sm" id="svcWorkPrevBtn" ${currentStep === 0 ? 'disabled' : ''}>← Anterior</button>
            <button type="button" class="btn btn-primary btn-sm" id="svcWorkSaveBtn">${isLast ? 'Salvar e finalizar checklist' : 'Salvar e continuar →'}</button>
        </div>
    `;

    document.querySelectorAll('.svc-work-outcome-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
            itemOutcome = btn.getAttribute('data-outcome') === 'archive' ? 'archive' : 'done';
            document.querySelectorAll('.svc-work-outcome-btn').forEach((b) => {
                b.classList.toggle('is-active', b.getAttribute('data-outcome') === itemOutcome);
            });
        });
    });
    if (itemOutcome === 'archive') {
        document.getElementById('svcWorkOutcomeArchive')?.classList.add('is-active');
        document.getElementById('svcWorkOutcomeDone')?.classList.remove('is-active');
    }

    const syncPendingHint = () => {
        const pendingEl = document.getElementById('svcWorkPending');
        const total = pendingPhotos.length + pendingBeforePhotos.length + pendingAfterPhotos.length;
        if (pendingEl) {
            if (total) {
                pendingEl.hidden = false;
                pendingEl.textContent = `${total} foto(s) pronta(s) para enviar`;
            } else {
                pendingEl.hidden = true;
            }
        }
    };
    document.getElementById('svcWorkPhotoInput')?.addEventListener('change', (e) => {
        pendingPhotos.length = 0;
        pendingPhotos.push(...Array.from(e.target.files || []));
        syncPendingHint();
    });
    document.getElementById('svcWorkPhotoBefore')?.addEventListener('change', (e) => {
        pendingBeforePhotos.length = 0;
        pendingBeforePhotos.push(...Array.from(e.target.files || []));
        syncPendingHint();
    });
    document.getElementById('svcWorkPhotoAfter')?.addEventListener('change', (e) => {
        pendingAfterPhotos.length = 0;
        pendingAfterPhotos.push(...Array.from(e.target.files || []));
        syncPendingHint();
    });

    document.getElementById('svcWorkPrevBtn')?.addEventListener('click', () => goToStep(currentStep - 1, false));
    document.getElementById('svcWorkSaveBtn')?.addEventListener('click', () => saveCurrentStep(isLast));
}

function renderAll() {
    if (!service) {
        window.location.href = '/services';
        return;
    }
    syncDefectItems();
    if (!defectItems.length) {
        renderEmpty();
        renderTop();
        return;
    }
    if (phase === 'summary') {
        renderTop();
        renderSummary();
        return;
    }
    phase = 'items';
    renderTop();
    renderStepper();
    renderItemStep();
}

async function reloadService() {
    const res = await fetch(`/api/services/${encodeURIComponent(service.id)}`);
    const data = await res.json();
    if (data.error || !data.service) {
        showToast(data.message || 'Erro ao recarregar OS.', 'error');
        return false;
    }
    service = data.service;
    window.appData.service = service;
    syncDefectItems();
    if (currentStep >= defectItems.length) currentStep = Math.max(0, defectItems.length - 1);
    return true;
}

async function persistPatch(patch) {
    const res = await fetch(`/api/services/${encodeURIComponent(service.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch)
    });
    const data = await res.json();
    if (data.error) {
        showToast(data.message || 'Erro ao salvar.', 'error');
        return null;
    }
    return data.service;
}

async function uploadPhotoBatch(itemKey, files, phase, kind) {
    if (!files?.length) return true;
    const form = new FormData();
    files.forEach((f) => form.append('photos', f));
    let url = `/api/services/${encodeURIComponent(service.id)}/checklist/${encodeURIComponent(itemKey)}/photos?phase=${phase}`;
    if (kind) url += `&kind=${encodeURIComponent(kind)}`;
    const res = await fetch(url, { method: 'POST', body: form });
    const data = await res.json();
    if (data.error) {
        showToast(data.message || 'Erro no upload de fotos.', 'error');
        return false;
    }
    return true;
}

async function uploadPendingPhotos(itemKey) {
    const batches = [
        [pendingBeforePhotos, 'tech', 'before'],
        [pendingAfterPhotos, 'tech', 'after'],
        [pendingPhotos, 'tech', 'general']
    ];
    for (const [files, phase, kind] of batches) {
        const ok = await uploadPhotoBatch(itemKey, files, phase, kind === 'general' ? '' : kind);
        if (!ok) return false;
        files.length = 0;
    }
    return true;
}

async function saveCurrentStep(isLast) {
    const item = currentItem();
    if (!item) return;

    const techNote = String(document.getElementById('svcWorkTechNote')?.value || '').trim();
    const done = itemOutcome === 'done';
    const archived = itemOutcome === 'archive';
    const checklist = (service.checklist || []).map((row) =>
        String(row.key) === String(item.key)
            ? { ...row, techNote, done, archived }
            : row
    );

    const saveBtn = document.getElementById('svcWorkSaveBtn');
    if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.textContent = 'Salvando...';
    }

    const saved = await persistPatch({ checklist });
    if (!saved) {
        if (saveBtn) {
            saveBtn.disabled = false;
            saveBtn.textContent = isLast ? 'Salvar e finalizar' : 'Salvar e continuar →';
        }
        return;
    }
    service = saved;
    syncDefectItems();

    const photosOk = await uploadPendingPhotos(item.key);
    if (!photosOk) {
        if (saveBtn) {
            saveBtn.disabled = false;
            saveBtn.textContent = isLast ? 'Salvar e finalizar' : 'Salvar e continuar →';
        }
        return;
    }

    await reloadService();

    if (archived) {
        showToast('Etapa arquivada.', 'success');
    } else if (done) {
        showToast('Etapa concluída.', 'success');
    } else {
        showToast('Salvo.', 'success');
    }

    if (isLast) {
        phase = 'summary';
        if (service.status === 'open') {
            const updated = await persistPatch({ status: 'in_progress' });
            if (updated) service = updated;
        }
        renderAll();
        return;
    }

    goToStep(currentStep + 1, true);
    if (saveBtn) saveBtn.disabled = false;
}

function goToStep(index, skipConfirm) {
    if (!skipConfirm && index !== currentStep) {
        const noteEl = document.getElementById('svcWorkTechNote');
        const item = currentItem();
        if (item && noteEl) {
            const dirty = noteEl.value.trim() !== String(item.techNote || '').trim()
                || itemOutcome !== (item.archived ? 'archive' : (item.done ? 'done' : 'done'))
                || pendingPhotos.length > 0
                || pendingBeforePhotos.length > 0
                || pendingAfterPhotos.length > 0;
            if (dirty && !confirm('Há alterações não salvas neste item. Deseja sair mesmo assim?')) {
                return;
            }
        }
    }
    currentStep = Math.max(0, Math.min(index, defectItems.length - 1));
    const url = new URL(window.location.href);
    url.searchParams.set('step', String(currentStep));
    window.history.replaceState({}, '', url);
    renderTop();
    renderStepper();
    renderItemStep();
}

let sharePreviewLoaded = false;

async function loadSharePreview() {
    const el = document.getElementById('svcSharePreview');
    if (!el) return;
    el.innerHTML = '<div class="svc-share-preview-loading">Carregando visualização...</div>';
    try {
        const html = await fetchServiceTemplateHtml('image', service);
        el.innerHTML = `<div class="svc-share-preview-inner">${html}</div>`;
        sharePreviewLoaded = true;
    } catch (e) {
        el.innerHTML = '<div class="svc-share-preview-loading" style="color:#f87171;">Não foi possível carregar a prévia.</div>';
    }
}

function closeShareModal() {
    document.getElementById('svcShareModal')?.setAttribute('hidden', '');
    document.body.style.overflow = '';
}

async function openShareModal() {
    const modal = document.getElementById('svcShareModal');
    if (!modal) return;
    document.getElementById('svcShareResult')?.setAttribute('hidden', '');
    document.getElementById('svcShareLinkBox')?.setAttribute('hidden', '');
    modal.removeAttribute('hidden');
    document.body.style.overflow = 'hidden';
    if (!sharePreviewLoaded) await loadSharePreview();
}

async function runServiceShareSend() {
    const sendBtn = document.getElementById('svcShareSendBtn');
    const resultEl = document.getElementById('svcShareResult');
    if (sendBtn) {
        sendBtn.disabled = true;
        sendBtn.textContent = 'Enviando...';
    }
    try {
        const includeImage = Boolean(document.getElementById('svcShareOptImage')?.checked);
        let reportImageBase64 = '';
        if (includeImage) {
            if (sendBtn) sendBtn.textContent = 'Gerando imagem...';
            try {
                reportImageBase64 = await captureServiceReportImageBase64(service);
            } catch (e) {
                console.error(e);
                showToast('Não foi possível gerar a imagem do relatório.', 'warning');
            }
        }
        if (sendBtn) sendBtn.textContent = 'Enviando...';
        const data = await dispatchServiceShareToCustomer(service.id, {
            sendWhatsapp: Boolean(document.getElementById('svcShareOptWhatsapp')?.checked),
            includeLink: Boolean(document.getElementById('svcShareOptLink')?.checked),
            includeQr: Boolean(document.getElementById('svcShareOptQr')?.checked),
            includePdf: Boolean(document.getElementById('svcShareOptPdf')?.checked),
            includeImage,
            reportImageBase64,
            markDelivered: Boolean(document.getElementById('svcShareOptDelivered')?.checked)
        });
        if (data.service) {
            service = data.service;
            window.appData.service = service;
            renderTop();
        }
        const linkBox = document.getElementById('svcShareLinkBox');
        const linkInput = document.getElementById('svcShareLinkInput');
        if (data.shareUrl && linkBox && linkInput) {
            linkBox.hidden = false;
            linkInput.value = data.shareUrl;
        }
        const qrWrap = document.getElementById('svcShareQrWrap');
        const qrImg = document.getElementById('svcShareQrImg');
        if (data.qrDataUrl && qrWrap && qrImg) {
            qrWrap.hidden = false;
            qrImg.src = data.qrDataUrl;
        }
        if (resultEl) {
            resultEl.hidden = false;
            const wa = data.whatsapp;
            let msg = '';
            if (wa?.sent && wa?.warning) msg = `⚠ WhatsApp: ${wa.warning}`;
            else if (wa?.sent) msg = '✓ WhatsApp enviado com sucesso.';
            else if (wa?.skipped) msg = `WhatsApp: ${wa.reason || 'não enviado'}.`;
            else if (wa?.error) msg = `✗ WhatsApp: ${wa.reason || 'falha no envio'}.`;
            else if (document.getElementById('svcShareOptWhatsapp')?.checked) msg = 'Link gerado. Conecte o WhatsApp em Configurações (menu lateral → Sistema).';
            else msg = '✓ Link de compartilhamento gerado.';
            const waOk = wa?.sent && !wa?.warning;
            resultEl.className = `svc-share-result ${waOk || !document.getElementById('svcShareOptWhatsapp')?.checked ? 'is-ok' : wa?.sent ? 'is-warn' : 'is-warn'}`;
            resultEl.textContent = msg;
        }
        if (data.whatsapp?.sent && data.whatsapp?.warning) showToast(data.whatsapp.warning, 'warning');
        else if (data.whatsapp?.sent) showToast('Relatório enviado ao cliente.', 'success');
        else if (data.shareUrl) showToast('Link do relatório pronto.', 'success');
    } catch (e) {
        console.error(e);
        if (resultEl) {
            resultEl.hidden = false;
            resultEl.className = 'svc-share-result is-error';
            resultEl.textContent = e.message || 'Erro ao enviar.';
        }
        showToast(e.message || 'Erro ao enviar.', 'error');
    } finally {
        if (sendBtn) {
            sendBtn.disabled = false;
            sendBtn.textContent = 'Enviar ao cliente';
        }
    }
}

function bindShareModal() {
    document.getElementById('svcShareCloseBtn')?.addEventListener('click', closeShareModal);
    document.getElementById('svcShareModal')?.addEventListener('click', (e) => {
        if (e.target.id === 'svcShareModal') closeShareModal();
    });
    document.getElementById('svcShareSendBtn')?.addEventListener('click', runServiceShareSend);
    document.getElementById('svcShareDownloadImgBtn')?.addEventListener('click', () => downloadServiceTemplateImage(service));
    document.getElementById('svcShareDownloadPdfBtn')?.addEventListener('click', () => printServiceTemplatePdf(service));
    document.getElementById('svcShareCopyLinkBtn')?.addEventListener('click', async () => {
        const v = document.getElementById('svcShareLinkInput')?.value;
        if (!v) {
            showToast('Envie primeiro para gerar o link.', 'info');
            return;
        }
        await navigator.clipboard.writeText(v);
        showToast('Link copiado.', 'success');
    });
}

function bootServiceWork() {
    whenAppReady(() => {
        if (!service?.id) {
            window.location.href = '/services';
            return;
        }
        updateTopbarTitle(`Oficina — ${service.code || 'OS'}`);
        markNavActive('/services');
        syncDefectItems();
        if (defectItems.length) {
            currentStep = initialStepIndex();
            const allDone = defectItems.every((i) => i.done || i.archived);
            const params = new URLSearchParams(window.location.search);
            if (allDone && params.get('view') !== 'items') {
                phase = 'summary';
            }
        }
        bindShareModal();
        renderAll();
    });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootServiceWork);
} else {
    bootServiceWork();
}
