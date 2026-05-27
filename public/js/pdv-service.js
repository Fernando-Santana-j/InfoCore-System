/**
 * Modal de ordem de serviço no PDV (caixa).
 */
let svcIntakeStep = 1;
let svcChecklistState = [];
let svcCustomerAcIndex = -1;
let svcSelectedCustomerId = '';
const svcPendingPhotos = new Map();

function svcEsc(s) {
    return String(s || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function svcCustomers() {
    const list = window.appData?.customers;
    if (Array.isArray(list)) return list;
    if (list && typeof list === 'object') return Object.values(list);
    return [];
}

function svcBuildTemplate(deviceType) {
    const tpl = window.appData?.serviceChecklistTemplates;
    if (!tpl?.base || !tpl?.byDevice) return [];
    const keys = tpl.byDevice[deviceType] || tpl.byDevice.Outro || [];
    const map = new Map(tpl.base.map((i) => [i.key, i]));
    return keys.map((key) => {
        const b = map.get(key);
        if (!b) return null;
        return { key: b.key, label: b.label, icon: b.icon || '🔧' };
    }).filter(Boolean);
}

function svcResetChecklist(deviceType) {
    svcChecklistState = svcBuildTemplate(deviceType).map((item) => ({
        ...item,
        defective: false,
        customerNote: '',
        estimatedPrice: '',
        photos: []
    }));
    svcPendingPhotos.clear();
}

function svcFilterCustomers(term) {
    const q = String(term || '').trim().toLowerCase();
    let list = svcCustomers().slice();
    if (!q) return list.slice(0, 20);
    return list.filter((c) =>
        String(c.name || '').toLowerCase().includes(q) ||
        String(c.phone || '').includes(q) ||
        String(c.email || '').toLowerCase().includes(q)
    ).slice(0, 20);
}

function svcRenderCustomerAc(term) {
    const listEl = document.getElementById('svcCustomerResults');
    if (!listEl) return;
    const matches = svcFilterCustomers(term);
    svcCustomerAcIndex = matches.length ? 0 : -1;
    if (!matches.length) {
        listEl.innerHTML = '<div class="budget-ac-empty">Nenhum cliente. Preencha o nome manualmente.</div>';
        listEl.hidden = false;
        return;
    }
    listEl.innerHTML = matches.map((c, i) => `
        <button type="button" class="budget-ac-item${i === svcCustomerAcIndex ? ' is-active' : ''}" data-id="${svcEsc(c.id)}">
            <span class="budget-ac-item-title">${svcEsc(c.name)}</span>
            <span class="budget-ac-item-meta">${svcEsc([c.phone, c.email].filter(Boolean).join(' · ') || '—')}</span>
        </button>
    `).join('');
    listEl.hidden = false;
    listEl.querySelectorAll('.budget-ac-item').forEach((btn) => {
        btn.addEventListener('mousedown', (e) => {
            e.preventDefault();
            svcSelectCustomer(btn.getAttribute('data-id'));
        });
    });
}

function svcSelectCustomer(id) {
    const c = svcCustomers().find((row) => String(row.id) === String(id));
    if (!c) return;
    svcSelectedCustomerId = String(c.id);
    document.getElementById('svcCustomerId').value = svcSelectedCustomerId;
    document.getElementById('svcCustomerName').value = c.name || '';
    document.getElementById('svcCustomerPhone').value = c.phone || '';
    document.getElementById('svcCustomerEmail').value = c.email || '';
    const chip = document.getElementById('svcCustomerChipName');
    if (chip) chip.textContent = c.name || '';
    document.getElementById('svcCustomerSelected')?.removeAttribute('hidden');
    document.getElementById('svcCustomerResults').hidden = true;
    const search = document.getElementById('svcCustomerSearch');
    if (search) search.value = '';
}

function svcClearCustomer() {
    svcSelectedCustomerId = '';
    document.getElementById('svcCustomerId').value = '';
    document.getElementById('svcCustomerSelected')?.setAttribute('hidden', '');
}

function svcUpdateDefectCount() {
    const count = svcChecklistState.filter((i) => i.defective).length;
    const badge = document.getElementById('svcDefectCount');
    if (!badge) return;
    const label = count === 1 ? '1 marcado' : `${count} marcados`;
    badge.textContent = label;
    badge.classList.toggle('has-defects', count > 0);
}

function svcRenderChecklist() {
    const grid = document.getElementById('svcChecklistGrid');
    if (!grid) return;
    grid.innerHTML = svcChecklistState.map((item, index) => {
        const defective = item.defective ? 'is-defective' : '';
        const files = svcPendingPhotos.get(item.key) || [];
        return `
            <div class="pdv-svc-check-item ${defective}" data-index="${index}">
                <button type="button" class="pdv-svc-check-toggle" data-index="${index}">
                    <span class="pdv-svc-check-box" aria-hidden="true">${item.defective ? '✓' : ''}</span>
                    <span class="pdv-svc-check-icon">${svcEsc(item.icon)}</span>
                    <span class="pdv-svc-check-text">
                        <span class="pdv-svc-check-label">${svcEsc(item.label)}</span>
                        <span class="pdv-svc-check-hint">${item.defective ? 'Defeito marcado — preencha abaixo' : 'Toque para marcar defeito'}</span>
                    </span>
                </button>
                <div class="pdv-svc-check-detail" ${item.defective ? '' : 'hidden'}>
                    <textarea class="form-input" data-field="note" data-index="${index}" rows="2" placeholder="O que o cliente relatou neste item...">${svcEsc(item.customerNote)}</textarea>
                    <div class="pdv-svc-check-row">
                        <input class="form-input" type="number" min="0" step="0.01" data-field="price" data-index="${index}" placeholder="Ref. R$ (opcional)" value="${item.estimatedPrice !== '' && item.estimatedPrice != null ? item.estimatedPrice : ''}">
                        <label class="btn btn-ghost btn-sm pdv-svc-photo-btn">
                            📷 Fotos
                            <input type="file" accept="image/*" capture="environment" multiple hidden data-photo-index="${index}">
                        </label>
                    </div>
                    ${files.length ? `<div class="pdv-svc-pending-photos">📎 ${files.length} foto(s) selecionada(s)</div>` : ''}
                </div>
            </div>
        `;
    }).join('');
    svcUpdateDefectCount();

    grid.querySelectorAll('.pdv-svc-check-toggle').forEach((btn) => {
        btn.addEventListener('click', () => {
            const idx = Number(btn.getAttribute('data-index'));
            const row = svcChecklistState[idx];
            if (!row) return;
            row.defective = !row.defective;
            svcRenderChecklist();
        });
    });

    grid.querySelectorAll('[data-field="note"]').forEach((el) => {
        el.addEventListener('input', () => {
            const idx = Number(el.getAttribute('data-index'));
            if (svcChecklistState[idx]) svcChecklistState[idx].customerNote = el.value;
        });
    });
    grid.querySelectorAll('[data-field="price"]').forEach((el) => {
        el.addEventListener('input', () => {
            const idx = Number(el.getAttribute('data-index'));
            if (svcChecklistState[idx]) svcChecklistState[idx].estimatedPrice = el.value;
        });
    });
    grid.querySelectorAll('input[data-photo-index]').forEach((input) => {
        input.addEventListener('change', () => {
            const idx = Number(input.getAttribute('data-photo-index'));
            const row = svcChecklistState[idx];
            if (!row) return;
            const files = Array.from(input.files || []);
            svcPendingPhotos.set(row.key, files);
            svcRenderChecklist();
        });
    });
}

const SVC_STEP_LABELS = ['Cliente', 'Aparelho', 'Defeitos', 'Orçamento'];

function svcSetStep(step) {
    svcIntakeStep = Math.max(1, Math.min(4, step));
    document.querySelectorAll('.pdv-service-step').forEach((el) => {
        const n = Number(el.getAttribute('data-step'));
        el.classList.toggle('is-active', n === svcIntakeStep);
        el.classList.toggle('is-done', n < svcIntakeStep);
    });
    document.querySelectorAll('.pdv-service-pane').forEach((pane) => {
        pane.classList.toggle('is-active', Number(pane.getAttribute('data-pane')) === svcIntakeStep);
    });
    const prev = document.getElementById('svcPrevStepBtn');
    const next = document.getElementById('svcNextStepBtn');
    const submit = document.getElementById('svcSubmitBtn');
    const hint = document.getElementById('svcStepHint');
    if (prev) prev.style.visibility = svcIntakeStep === 1 ? 'hidden' : 'visible';
    if (next) next.hidden = svcIntakeStep >= 4;
    if (submit) submit.hidden = svcIntakeStep < 4;
    if (hint) {
        hint.textContent = `Etapa ${svcIntakeStep} de 4 — ${SVC_STEP_LABELS[svcIntakeStep - 1]}`;
    }
}

function svcOpenModal() {
    svcIntakeStep = 1;
    svcClearCustomer();
    document.getElementById('svcCustomerName').value = '';
    document.getElementById('svcCustomerPhone').value = '';
    document.getElementById('svcCustomerEmail').value = '';
    document.getElementById('svcDeviceType').value = 'Celular';
    document.getElementById('svcDeviceBrandModel').value = '';
    document.getElementById('svcAccessories').value = '';
    document.getElementById('svcIssueReport').value = '';
    document.getElementById('svcEstimateValue').value = '';
    document.getElementById('svcBudgetRawNotes').value = '';
    document.getElementById('svcPriority').value = 'normal';
    svcResetChecklist('Celular');
    svcRenderChecklist();
    svcSetStep(1);
    document.getElementById('serviceIntakeModal')?.classList.add('open');
    document.body.style.overflow = 'hidden';
}

function svcCloseModal() {
    document.getElementById('serviceIntakeModal')?.classList.remove('open');
    document.body.style.overflow = '';
}

function svcValidateStep(step) {
    if (step === 1) {
        const name = String(document.getElementById('svcCustomerName')?.value || '').trim();
        if (!name) {
            showToast('Informe o nome do cliente.', 'error');
            return false;
        }
    }
    if (step === 2) {
        const model = String(document.getElementById('svcDeviceBrandModel')?.value || '').trim();
        if (!model) {
            showToast('Informe marca/modelo do aparelho.', 'error');
            return false;
        }
    }
    if (step === 3) {
        const defects = svcChecklistState.filter((i) => i.defective);
        const issue = String(document.getElementById('svcIssueReport')?.value || '').trim();
        if (!defects.length && !issue) {
            showToast('Marque ao menos um defeito ou preencha o relato geral.', 'error');
            return false;
        }
    }
    return true;
}

async function svcUploadPendingPhotos(serviceId) {
    for (const [key, files] of svcPendingPhotos.entries()) {
        if (!files?.length) continue;
        const form = new FormData();
        files.forEach((f) => form.append('photos', f));
        await fetch(`/api/services/${encodeURIComponent(serviceId)}/checklist/${encodeURIComponent(key)}/photos?phase=intake`, {
            method: 'POST',
            body: form
        });
    }
}

async function svcSubmit() {
    if (!svcValidateStep(3)) {
        svcSetStep(3);
        return;
    }
    const submitBtn = document.getElementById('svcSubmitBtn');
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Salvando...';
    }
    const estimateRaw = document.getElementById('svcEstimateValue')?.value;
    const payload = {
        customerId: svcSelectedCustomerId,
        customerName: String(document.getElementById('svcCustomerName')?.value || '').trim(),
        customerPhone: String(document.getElementById('svcCustomerPhone')?.value || '').trim(),
        customerEmail: String(document.getElementById('svcCustomerEmail')?.value || '').trim(),
        deviceType: String(document.getElementById('svcDeviceType')?.value || 'Celular'),
        deviceBrandModel: String(document.getElementById('svcDeviceBrandModel')?.value || '').trim(),
        accessories: String(document.getElementById('svcAccessories')?.value || '').trim(),
        issueReport: String(document.getElementById('svcIssueReport')?.value || '').trim(),
        priority: String(document.getElementById('svcPriority')?.value || 'normal'),
        estimateValue: estimateRaw === '' ? null : estimateRaw,
        budgetRawNotes: String(document.getElementById('svcBudgetRawNotes')?.value || '').trim(),
        checklist: svcChecklistState.map((item) => ({
            key: item.key,
            label: item.label,
            icon: item.icon,
            defective: item.defective,
            customerNote: item.customerNote,
            estimatedPrice: item.estimatedPrice === '' ? null : item.estimatedPrice
        }))
    };
    try {
        const res = await fetch('/api/services', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (!res.ok || data.error) {
            showToast(data.message || 'Erro ao registrar OS.', 'error');
            return;
        }
        await svcUploadPendingPhotos(data.service.id);
        svcCloseModal();
        showToast(`OS ${data.service.code} criada · Orçamento ${data.budget?.code || ''} em rascunho.`, 'success');
    } catch (e) {
        console.error(e);
        showToast('Erro de conexão.', 'error');
    } finally {
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Registrar OS + orçamento';
        }
    }
}

function bindServiceIntakeModal() {
    document.getElementById('btnOpenServiceIntakeModal')?.addEventListener('click', svcOpenModal);
    document.getElementById('closeServiceIntakeModalBtn')?.addEventListener('click', svcCloseModal);
    document.getElementById('cancelServiceIntakeBtn')?.addEventListener('click', svcCloseModal);
    document.getElementById('svcPrevStepBtn')?.addEventListener('click', () => svcSetStep(svcIntakeStep - 1));
    document.getElementById('svcNextStepBtn')?.addEventListener('click', () => {
        if (!svcValidateStep(svcIntakeStep)) return;
        svcSetStep(svcIntakeStep + 1);
    });
    document.getElementById('svcSubmitBtn')?.addEventListener('click', svcSubmit);
    document.getElementById('svcDeviceType')?.addEventListener('change', (e) => {
        svcResetChecklist(e.target.value);
        svcRenderChecklist();
    });
    document.getElementById('svcCustomerSearch')?.addEventListener('input', (e) => svcRenderCustomerAc(e.target.value));
    document.getElementById('svcCustomerSearch')?.addEventListener('focus', (e) => svcRenderCustomerAc(e.target.value));
    document.getElementById('svcCustomerClearBtn')?.addEventListener('click', svcClearCustomer);
    const modal = document.getElementById('serviceIntakeModal');
    modal?.addEventListener('click', (e) => { if (e.target === modal) svcCloseModal(); });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindServiceIntakeModal);
} else {
    bindServiceIntakeModal();
}
