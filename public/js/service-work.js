let service = window.appData?.service || null;
let defectItems = [];
let currentStep = 0;
let phase = 'items';
const pendingPhotos = [];

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

function repairProgress() {
    if (!defectItems.length) return 0;
    const done = defectItems.filter((i) => i.done).length;
    return Math.round((done / defectItems.length) * 100);
}

function initialStepIndex() {
    const params = new URLSearchParams(window.location.search);
    const q = Number(params.get('step'));
    if (Number.isFinite(q) && q >= 0 && q < defectItems.length) return q;
    const firstPending = defectItems.findIndex((i) => !i.done);
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
            <span class="svc-work-progress-label">${defectItems.filter((i) => i.done).length}/${defectItems.length} itens</span>
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
        if (item.done) cls += ' is-done';
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
                <div class="svc-stat-pill"><strong>${defectItems.filter((i) => !i.done).length}</strong><span>Pendentes</span></div>
            </div>
            <div class="svc-work-summary-actions">
                <label class="form-label">Status da OS</label>
                <select class="form-input" id="svcWorkStatusSelect">
                    ${['open', 'in_progress', 'waiting_parts', 'done', 'delivered'].map((st) =>
                        `<option value="${st}" ${service.status === st ? 'selected' : ''}>${statusLabel(st)}</option>`
                    ).join('')}
                </select>
                ${budgetBtn}
                <button type="button" class="btn btn-ghost btn-sm" id="svcWorkReviewBtn">Revisar itens</button>
            </div>
        </div>
    `;
    document.getElementById('svcWorkFooter').innerHTML = `
        <a href="/services" class="btn btn-primary btn-sm">Voltar à oficina</a>
    `;
    document.getElementById('svcWorkStatusSelect')?.addEventListener('change', async (e) => {
        await persistPatch({ status: e.target.value });
        service.status = e.target.value;
        renderTop();
        showToast('Status atualizado.', 'success');
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

    main.innerHTML = `
        <article class="svc-work-card">
            <header class="svc-work-card-head">
                <span class="svc-work-card-icon">${esc(item.icon || '🔧')}</span>
                <div>
                    <p class="svc-work-card-step">Item ${currentStep + 1} de ${defectItems.length}</p>
                    <h3 class="svc-work-card-title">${esc(item.label)}</h3>
                </div>
                <span class="svc-defect-badge ${item.done ? 'is-done' : ''}">${item.done ? 'Concluído' : 'Em reparo'}</span>
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
                <h4 class="svc-work-section-title">📷 Fotos do reparo</h4>
                ${renderPhotos(item.techPhotos, 'svc-work-existing-photos')}
                <div class="svc-work-upload-zone">
                    <label class="btn btn-ghost btn-sm svc-work-photo-label">
                        Adicionar fotos
                        <input type="file" id="svcWorkPhotoInput" accept="image/*" capture="environment" multiple hidden>
                    </label>
                    <span class="svc-work-pending" id="svcWorkPending" hidden></span>
                </div>
            </section>

            <label class="svc-work-done-check">
                <input type="checkbox" id="svcWorkDoneCheck" ${item.done ? 'checked' : ''}>
                <span>Marcar este item como concluído</span>
            </label>
        </article>
    `;

    const isLast = currentStep >= defectItems.length - 1;
    footer.innerHTML = `
        <div class="svc-work-footer-hint">Etapa ${currentStep + 1} de ${defectItems.length}</div>
        <div class="svc-work-footer-actions">
            <button type="button" class="btn btn-ghost btn-sm" id="svcWorkPrevBtn" ${currentStep === 0 ? 'disabled' : ''}>← Anterior</button>
            <button type="button" class="btn btn-primary btn-sm" id="svcWorkSaveBtn">${isLast ? 'Salvar e finalizar' : 'Salvar e continuar →'}</button>
        </div>
    `;

    document.getElementById('svcWorkPhotoInput')?.addEventListener('change', (e) => {
        pendingPhotos.length = 0;
        pendingPhotos.push(...Array.from(e.target.files || []));
        const pendingEl = document.getElementById('svcWorkPending');
        if (pendingEl) {
            if (pendingPhotos.length) {
                pendingEl.hidden = false;
                pendingEl.textContent = `${pendingPhotos.length} foto(s) pronta(s) para enviar`;
            } else {
                pendingEl.hidden = true;
            }
        }
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

async function uploadPendingPhotos(itemKey) {
    if (!pendingPhotos.length) return true;
    const form = new FormData();
    pendingPhotos.forEach((f) => form.append('photos', f));
    const res = await fetch(
        `/api/services/${encodeURIComponent(service.id)}/checklist/${encodeURIComponent(itemKey)}/photos?phase=tech`,
        { method: 'POST', body: form }
    );
    const data = await res.json();
    if (data.error) {
        showToast(data.message || 'Erro no upload de fotos.', 'error');
        return false;
    }
    pendingPhotos.length = 0;
    return true;
}

async function saveCurrentStep(isLast) {
    const item = currentItem();
    if (!item) return;

    const techNote = String(document.getElementById('svcWorkTechNote')?.value || '').trim();
    const done = Boolean(document.getElementById('svcWorkDoneCheck')?.checked);
    const checklist = (service.checklist || []).map((row) =>
        String(row.key) === String(item.key)
            ? { ...row, techNote, done }
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

    if (!done && techNote) {
        showToast('Registro salvo.', 'success');
    } else if (done) {
        showToast('Item concluído.', 'success');
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
        const doneEl = document.getElementById('svcWorkDoneCheck');
        const item = currentItem();
        if (item && noteEl) {
            const dirty = noteEl.value.trim() !== String(item.techNote || '').trim()
                || Boolean(doneEl?.checked) !== Boolean(item.done)
                || pendingPhotos.length > 0;
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

document.addEventListener('DOMContentLoaded', () => {
    if (!service?.id) {
        window.location.href = '/services';
        return;
    }
    updateTopbarTitle(`Oficina — ${service.code || 'OS'}`);
    markNavActive('/services');
    syncDefectItems();
    if (defectItems.length) {
        currentStep = initialStepIndex();
        const allDone = defectItems.every((i) => i.done);
        const params = new URLSearchParams(window.location.search);
        if (allDone && params.get('view') !== 'items') {
            phase = 'summary';
        }
    }
    renderAll();
});
