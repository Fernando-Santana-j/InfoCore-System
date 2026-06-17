
//TODO-------------importes------------
const express = require('express')
const fs = require('fs');
const bodyParser = require('body-parser');
const session = require('express-session')
const path = require('path');
const multer = require('multer')
const cookieParser = require("cookie-parser");
const mercadopago = require('mercadopago');
const db = require('./firebase/models.js');
const firestore = require('./firebase/db.js');
const { randomInt } = require('crypto');
const axios = require('axios');
const QRCode = require('qrcode');
const { randomUUID } = require("crypto");
const nodemailer = require('nodemailer');
const compression = require('compression');
const whatsappClient = require('./lib/whatsapp');
const { buildServiceReportFiles } = require('./lib/service-report-export');
const {
    normalizePcDiagnostic,
    buildPcDiagnosticHtml,
    formatDiagnosticTimestamp
} = require('./lib/pc-diagnostic');
require('dotenv').config();
// const config = require('./config/config.json');

const PRODUCTS_COLLECTION = 'products';
const SALES_COLLECTION = 'sales';
const BUDGETS_COLLECTION = 'budgets';
const CUSTOMERS_COLLECTION = 'customers';
const CASH_FLOW_COLLECTION = 'cash_flow';
const SERVICE_ORDERS_COLLECTION = 'service_orders';
const SERVICE_WORK_TEMPLATES_COLLECTION = 'service_work_templates';
const PC_DIAGNOSTICS_COLLECTION = 'pc_diagnostics';
const INFOCORE_COLLECTION = 'infocore';
const SHARED_NOTES_DOC = 'shared_notes';
const { FieldValue } = require('firebase-admin/firestore');

const PAYMENT_KEYS = new Set(['money', 'credit_card', 'debit_card', 'pix']);

function normalizePaymentKey(payment) {
    const map = {
        money: 'money',
        credit_card: 'credit_card',
        debit_card: 'debit_card',
        pix: 'pix',
        dinheiro: 'money',
        cartao_credito: 'credit_card',
        cartao_debito: 'debit_card'
    };
    const k = String(payment || '').trim();
    return map[k] || 'money';
}

function parsePositiveInt(v) {
    const n = Number.parseInt(String(v), 10);
    return Number.isFinite(n) && n > 0 ? n : 0;
}

function parseAdjustment(body, key) {
    const raw = body && typeof body[key] === 'object' ? body[key] : {};
    const type = String(raw.type || 'fixed').trim() === 'percent' ? 'percent' : 'fixed';
    let value = Number(raw.value);
    if (!Number.isFinite(value) || value < 0) value = 0;
    if (type === 'percent' && value > 100) value = 100;
    return { type, value };
}

function toCents(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return 0;
    return Math.round(n * 100);
}

function fromCents(cents) {
    return (Number(cents) || 0) / 100;
}

function computeSaleAmounts(subtotal, discountAdj, extraAdj) {
    const subtotalCents = toCents(subtotal);
    const discountCents = discountAdj.type === 'percent'
        ? Math.round((subtotalCents * discountAdj.value) / 100)
        : toCents(discountAdj.value);
    const extraCents = extraAdj.type === 'percent'
        ? Math.round((subtotalCents * extraAdj.value) / 100)
        : toCents(extraAdj.value);
    const totalCents = Math.max(0, subtotalCents - discountCents + extraCents);
    return {
        discountAmount: fromCents(discountCents),
        extraAmount: fromCents(extraCents),
        total: fromCents(totalCents)
    };
}

function saleDisplayCode() {
    const t = Date.now().toString(36).toUpperCase();
    return `VD-${t.slice(-6)}${Math.random().toString(36).slice(2, 4).toUpperCase()}`;
}

function budgetDisplayCode() {
    const t = Date.now().toString(36).toUpperCase();
    return `ORC-${t.slice(-6)}${Math.random().toString(36).slice(2, 4).toUpperCase()}`;
}

function normalizeBudgetRow(row) {
    const r = row && typeof row === 'object' ? row : {};
    const subtotal = Number(r.subtotal) || 0;
    const discount = Number(r.discount) || 0;
    const extra = Number(r.extra) || 0;
    const total = Number(r.total) || Math.max(0, subtotal - discount + extra);
    return {
        id: r.id != null ? String(r.id) : '',
        code: r.code != null ? String(r.code) : '',
        customerId: r.customerId != null ? String(r.customerId) : '',
        customerName: r.customerName != null ? String(r.customerName) : '',
        customerPhone: r.customerPhone != null ? String(r.customerPhone) : '',
        customerEmail: r.customerEmail != null ? String(r.customerEmail) : '',
        notes: r.notes != null ? String(r.notes) : '',
        validUntil: r.validUntil != null ? String(r.validUntil) : '',
        status: String(r.status || 'draft') === 'finalized' ? 'finalized' : 'draft',
        items: Array.isArray(r.items) ? r.items.map((item) => ({
            id: item?.id != null ? String(item.id) : '',
            kind: String(item?.kind || 'custom') === 'product' ? 'product' : 'custom',
            productId: item?.productId != null ? String(item.productId) : '',
            sku: item?.sku != null ? String(item.sku) : '',
            name: item?.name != null ? String(item.name) : '',
            qty: Number(item?.qty) || 0,
            unitPrice: Number(item?.unitPrice) || 0,
            unitCost: Number(item?.unitCost) || 0,
            lineCost: Number(item?.lineCost) || 0,
            total: Number(item?.total) || 0
        })) : [],
        subtotal,
        discount,
        extra,
        total,
        costTotal: Number(r.costTotal) || 0,
        profit: Number.isFinite(Number(r.profit)) ? Number(r.profit) : null,
        createdAt: r.createdAt || null,
        updatedAt: r.updatedAt || null,
        finalizedAt: r.finalizedAt || null,
        serviceOrderId: r.serviceOrderId != null ? String(r.serviceOrderId) : ''
    };
}

function toDateSafe(value) {
    if (!value) return null;
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
    if (typeof value === 'string' || typeof value === 'number') {
        const d = new Date(value);
        return Number.isNaN(d.getTime()) ? null : d;
    }
    if (typeof value.toDate === 'function') {
        const d = value.toDate();
        return d instanceof Date && !Number.isNaN(d.getTime()) ? d : null;
    }
    if (typeof value._seconds === 'number') {
        const d = new Date(value._seconds * 1000);
        return Number.isNaN(d.getTime()) ? null : d;
    }
    return null;
}

function normalizeSaleRow(row) {
    const r = row && typeof row === 'object' ? row : {};
    const createdAtDate = toDateSafe(r.createdAt);
    const paymentGateway = r.paymentGateway && typeof r.paymentGateway === 'object' ? r.paymentGateway : null;
    const payment = paymentGateway?.provider ? String(paymentGateway.provider) : normalizePaymentKey(r.payment);

    return {
        id: r.id != null ? String(r.id) : '',
        code: r.code != null ? String(r.code) : '',
        date: createdAtDate ? createdAtDate.toISOString() : '',
        createdAt: createdAtDate ? createdAtDate.toISOString() : null,
        client: r.client != null ? String(r.client) : 'Balcao',
        payment,
        paymentGateway,
        cashier: r.cashier && typeof r.cashier === 'object' ? {
            name: r.cashier.name != null ? String(r.cashier.name) : '',
            email: r.cashier.email != null ? String(r.cashier.email) : ''
        } : null,
        items: asItemsArray(r.items).map((item) => ({
            id: item?.id != null ? String(item.id) : '',
            sku: item?.sku != null ? String(item.sku) : '',
            name: item?.name != null ? String(item.name) : '',
            category: item?.category != null ? String(item.category) : '',
            price: Number(item?.price) || 0,
            cost: Number(item?.cost) || 0,
            qty: Number(item?.qty) || 0,
            lineTotal: Number(item?.lineTotal) || ((Number(item?.price) || 0) * (Number(item?.qty) || 0)),
            lineCost: Number(item?.lineCost) || ((Number(item?.cost) || 0) * (Number(item?.qty) || 0))
        })),
        costTotal: Number(r.costTotal) || 0,
        profit: Number.isFinite(Number(r.profit)) ? Number(r.profit) : null,
        subtotal: Number(r.subtotal) || 0,
        discount: Number(r.discount) || 0,
        extra: Number(r.extra) || 0,
        total: Number(r.total) || 0,
        adjustments: r.adjustments && typeof r.adjustments === 'object' ? r.adjustments : null,
        cashReceived: Number.isFinite(Number(r.cashReceived)) ? Number(r.cashReceived) : null,
        change: Number.isFinite(Number(r.change)) ? Number(r.change) : null
    };
}

function moneyBr(value) {
    const n = Number(value) || 0;
    return `R$ ${n.toFixed(2).replace('.', ',')}`;
}

const REQUEST_STATUSES = new Set(['open', 'in_progress', 'done', 'cancelled']);

function normalizeCustomerRequest(reqRow) {
    const r = reqRow && typeof reqRow === 'object' ? reqRow : {};
    const st = String(r.status || 'open').toLowerCase();
    return {
        id: r.id != null ? String(r.id) : randomUUID(),
        title: r.title != null ? String(r.title).trim() : '',
        description: r.description != null ? String(r.description).trim() : '',
        date: r.date != null ? String(r.date).trim().slice(0, 16) : '',
        status: REQUEST_STATUSES.has(st) ? st : 'open'
    };
}

function normalizeCustomerRow(row, aggregatedStats) {
    const r = row && typeof row === 'object' ? row : {};
    const requests = Array.isArray(r.requests)
        ? r.requests.map(normalizeCustomerRequest)
        : [];
    const createdAt = toDateSafe(r.createdAt);
    const updatedAt = toDateSafe(r.updatedAt);
    const purchases = aggregatedStats != null && typeof aggregatedStats === 'object'
        ? (Number(aggregatedStats.purchases) || 0)
        : (Number(r.purchases) || 0);
    const spent = aggregatedStats != null && typeof aggregatedStats === 'object'
        ? (Number(aggregatedStats.spent) || 0)
        : (Number(r.spent) || 0);
    return {
        id: r.id != null ? String(r.id) : '',
        name: String(r.name || '').trim(),
        doc: r.doc != null ? String(r.doc).trim() : '',
        phone: r.phone != null ? String(r.phone).trim() : '',
        email: r.email != null ? String(r.email).trim() : '',
        address: r.address != null ? String(r.address).trim() : '',
        notes: r.notes != null ? String(r.notes).trim() : '',
        requests,
        purchases,
        spent,
        createdAt: createdAt ? createdAt.toISOString() : null,
        updatedAt: updatedAt ? updatedAt.toISOString() : null
    };
}

function salesTotalsByClientKey(sales) {
    const m = new Map();
    for (const s of sales) {
        const k = String(s.client || '').trim().toLowerCase();
        if (!k) continue;
        const prev = m.get(k) || { purchases: 0, spent: 0 };
        prev.purchases += 1;
        prev.spent += Number(s.total) || 0;
        m.set(k, prev);
    }
    return m;
}

function normalizeCashFlowRow(row) {
    const r = row && typeof row === 'object' ? row : {};
    const dt = r.date != null ? String(r.date).trim().slice(0, 10) : '';
    const createdAt = toDateSafe(r.createdAt);
    const rawType = String(r.type || '').toLowerCase();
    const type = rawType === 'expense' ? 'expense' : 'income';
    const amount = Math.max(0, Number(r.amount) || 0);
    const cost = Math.max(0, Number(r.cost) || 0);
    let profit = Number(r.profit);
    if (!Number.isFinite(profit)) profit = type === 'income' ? amount - cost : 0;
    return {
        id: r.id != null ? String(r.id) : '',
        type,
        amount,
        cost,
        profit,
        category: r.category != null ? String(r.category).trim() : '',
        description: r.description != null ? String(r.description).trim() : '',
        date: dt,
        saleId: r.saleId != null ? String(r.saleId) : '',
        budgetId: r.budgetId != null ? String(r.budgetId) : '',
        source: r.source != null ? String(r.source).trim() : '',
        createdAt: createdAt ? createdAt.toISOString() : null
    };
}

function serviceDisplayCode() {
    const t = Date.now().toString(36).toUpperCase();
    return `OS-${t.slice(-6)}${Math.random().toString(36).slice(2, 4).toUpperCase()}`;
}

const SERVICE_CHECKLIST_BASE = [
    { key: 'power', label: 'Não liga / energia', icon: '⚡' },
    { key: 'screen', label: 'Tela / display', icon: '📱' },
    { key: 'battery', label: 'Bateria', icon: '🔋' },
    { key: 'charging', label: 'Conector de carga', icon: '🔌' },
    { key: 'audio', label: 'Áudio (alto-falante/mic)', icon: '🔊' },
    { key: 'camera', label: 'Câmera', icon: '📷' },
    { key: 'buttons', label: 'Botões físicos', icon: '🔘' },
    { key: 'wifi', label: 'Wi-Fi / Bluetooth', icon: '📶' },
    { key: 'software', label: 'Software / sistema', icon: '💾' },
    { key: 'housing', label: 'Carcaça / estrutura', icon: '🛡️' },
    { key: 'keyboard', label: 'Teclado', icon: '⌨️' },
    { key: 'trackpad', label: 'Touchpad / mouse', icon: '🖱️' },
    { key: 'overheat', label: 'Superaquecimento', icon: '🌡️' },
    { key: 'liquid', label: 'Contato com líquido', icon: '💧' },
    { key: 'other', label: 'Outro defeito', icon: '➕' }
];

const SERVICE_CHECKLIST_BY_DEVICE = {
    Celular: ['power', 'screen', 'battery', 'charging', 'audio', 'camera', 'buttons', 'wifi', 'software', 'housing', 'liquid', 'other'],
    Notebook: ['power', 'screen', 'battery', 'charging', 'audio', 'keyboard', 'trackpad', 'wifi', 'software', 'overheat', 'housing', 'liquid', 'other'],
    Computador: ['power', 'screen', 'audio', 'wifi', 'software', 'overheat', 'housing', 'liquid', 'other'],
    Tablet: ['power', 'screen', 'battery', 'charging', 'audio', 'wifi', 'software', 'housing', 'other'],
    Outro: ['power', 'screen', 'battery', 'charging', 'audio', 'software', 'other']
};

function getServiceChecklistTemplate(deviceType) {
    const keys = SERVICE_CHECKLIST_BY_DEVICE[deviceType] || SERVICE_CHECKLIST_BY_DEVICE.Outro;
    const map = new Map(SERVICE_CHECKLIST_BASE.map((item) => [item.key, item]));
    return keys.map((key) => {
        const base = map.get(key);
        if (!base) return null;
        return { key: base.key, label: base.label, icon: base.icon };
    }).filter(Boolean);
}

function defaultServiceChecklistState(deviceType) {
    return getServiceChecklistTemplate(deviceType).map((item) => ({
        key: item.key,
        label: item.label,
        icon: item.icon,
        defective: false,
        customerNote: '',
        estimatedPrice: null,
        photos: [],
        done: false,
        techNote: '',
        techPhotos: [],
        beforePhotos: [],
        afterPhotos: [],
        fromTemplate: false
    }));
}

function normalizeServicePhotoItem(item) {
    const r = item && typeof item === 'object' ? item : {};
    const kindRaw = String(r.kind || 'general').toLowerCase();
    const kind = kindRaw === 'before' ? 'before' : (kindRaw === 'after' ? 'after' : 'general');
    return {
        id: r.id != null ? String(r.id) : randomUUID(),
        url: r.url != null ? String(r.url).trim() : '',
        caption: r.caption != null ? String(r.caption).trim() : '',
        kind,
        createdAt: r.createdAt || null
    };
}

function normalizeServiceChecklistItem(item) {
    const r = item && typeof item === 'object' ? item : {};
    const key = String(r.key || r.id || '').trim() || randomUUID();
    const label = String(r.label || r.title || '').trim();
    let estimatedPrice = r.estimatedPrice;
    if (estimatedPrice != null && estimatedPrice !== '') {
        estimatedPrice = Math.max(0, Number(estimatedPrice) || 0);
    } else {
        estimatedPrice = null;
    }
    return {
        key,
        label,
        icon: r.icon != null ? String(r.icon) : '',
        defective: Boolean(r.defective),
        customerNote: r.customerNote != null ? String(r.customerNote).trim() : (r.notes != null ? String(r.notes).trim() : ''),
        estimatedPrice,
        photos: Array.isArray(r.photos) ? r.photos.map(normalizeServicePhotoItem).filter((p) => p.url) : [],
        done: Boolean(r.done),
        techNote: r.techNote != null ? String(r.techNote).trim() : '',
        techPhotos: Array.isArray(r.techPhotos) ? r.techPhotos.map(normalizeServicePhotoItem).filter((p) => p.url) : [],
        beforePhotos: Array.isArray(r.beforePhotos) ? r.beforePhotos.map(normalizeServicePhotoItem).filter((p) => p.url) : [],
        afterPhotos: Array.isArray(r.afterPhotos) ? r.afterPhotos.map(normalizeServicePhotoItem).filter((p) => p.url) : [],
        fromTemplate: Boolean(r.fromTemplate),
        archived: Boolean(r.archived)
    };
}

function normalizeServiceOrderRow(row) {
    const r = row && typeof row === 'object' ? row : {};
    const allowedStatuses = new Set(['open', 'in_progress', 'waiting_parts', 'done', 'delivered']);
    const status = String(r.status || 'open').toLowerCase();
    const checklist = Array.isArray(r.checklist)
        ? r.checklist.map(normalizeServiceChecklistItem).filter((item) => item.label)
        : [];
    return {
        id: r.id != null ? String(r.id) : '',
        code: r.code != null ? String(r.code) : serviceDisplayCode(),
        budgetId: r.budgetId != null ? String(r.budgetId) : '',
        customerId: r.customerId != null ? String(r.customerId) : '',
        customerName: r.customerName != null ? String(r.customerName).trim() : '',
        customerPhone: r.customerPhone != null ? String(r.customerPhone).trim() : '',
        customerEmail: r.customerEmail != null ? String(r.customerEmail).trim() : '',
        deviceType: r.deviceType != null ? String(r.deviceType).trim() : '',
        deviceBrandModel: r.deviceBrandModel != null ? String(r.deviceBrandModel).trim() : '',
        accessories: r.accessories != null ? String(r.accessories).trim() : '',
        issueReport: r.issueReport != null ? String(r.issueReport).trim() : '',
        budgetRawNotes: r.budgetRawNotes != null ? String(r.budgetRawNotes).trim() : '',
        estimateValue: Number.isFinite(Number(r.estimateValue)) ? Math.max(0, Number(r.estimateValue)) : null,
        checklist,
        defectiveCount: checklist.filter((item) => item.defective).length,
        doneCount: checklist.filter((item) => item.defective && item.done).length,
        progressNotes: Array.isArray(r.progressNotes)
            ? r.progressNotes.map((n) => ({
                id: n?.id != null ? String(n.id) : randomUUID(),
                text: n?.text != null ? String(n.text).trim() : '',
                createdAt: n?.createdAt || null
            })).filter((note) => note.text)
            : [],
        status: allowedStatuses.has(status) ? status : 'open',
        priority: String(r.priority || 'normal') === 'high' ? 'high' : (String(r.priority || '') === 'urgent' ? 'urgent' : 'normal'),
        createdAt: r.createdAt || null,
        updatedAt: r.updatedAt || null,
        createdBy: r.createdBy && typeof r.createdBy === 'object' ? {
            name: r.createdBy.name != null ? String(r.createdBy.name) : '',
            email: r.createdBy.email != null ? String(r.createdBy.email) : ''
        } : null,
        workTemplateId: r.workTemplateId != null ? String(r.workTemplateId).trim() : '',
        workTemplateIds: Array.isArray(r.workTemplateIds)
            ? r.workTemplateIds.map((id) => String(id).trim()).filter(Boolean)
            : (r.workTemplateId ? [String(r.workTemplateId).trim()] : []),
        workTemplateName: r.workTemplateName != null ? String(r.workTemplateName).trim() : '',
        shareToken: r.shareToken != null ? String(r.shareToken).trim() : '',
        shareCreatedAt: r.shareCreatedAt || null,
        pcDiagnostic: normalizePcDiagnostic(r.pcDiagnostic)
    };
}

function normalizeServiceWorkTemplateRow(row) {
    const r = row && typeof row === 'object' ? row : {};
    const stages = Array.isArray(r.stages) ? r.stages.map((s, i) => {
        const stage = s && typeof s === 'object' ? s : {};
        const key = String(stage.key || stage.id || `stage-${i + 1}`).trim() || `stage-${i + 1}`;
        return {
            key,
            label: String(stage.label || stage.title || `Etapa ${i + 1}`).trim(),
            icon: stage.icon != null ? String(stage.icon) : '🔧',
            defaultNote: stage.defaultNote != null ? String(stage.defaultNote).trim() : '',
            sortOrder: Number.isFinite(Number(stage.sortOrder)) ? Number(stage.sortOrder) : i
        };
    }).filter((s) => s.label) : [];
    stages.sort((a, b) => a.sortOrder - b.sortOrder);
    const deviceTypes = Array.isArray(r.deviceTypes)
        ? r.deviceTypes.map((d) => String(d).trim()).filter(Boolean)
        : [];
    return {
        id: r.id != null ? String(r.id) : '',
        name: String(r.name || '').trim(),
        description: r.description != null ? String(r.description).trim() : '',
        icon: r.icon != null ? String(r.icon) : '🔧',
        deviceTypes,
        stages,
        active: r.active !== false,
        createdAt: r.createdAt || null,
        updatedAt: r.updatedAt || null
    };
}

async function loadServiceWorkTemplatesNormalized() {
    const rows = await db.findAll({ colecao: SERVICE_WORK_TEMPLATES_COLLECTION }).catch(() => []);
    const list = Array.isArray(rows) ? rows.map(normalizeServiceWorkTemplateRow).filter((t) => t.name) : [];
    list.sort((a, b) => String(a.name).localeCompare(String(b.name), 'pt-BR'));
    return list;
}

function getPublicBaseUrl(req) {
    const reqBase = req?.get?.('host')
        ? `${req.protocol}://${req.get('host')}`
        : '';
    const envBase = process.env.APP_PUBLIC_BASE_URL
        ? String(process.env.APP_PUBLIC_BASE_URL).replace(/\/$/, '')
        : '';
    // Prioriza o host da requisição para links gerados durante o uso (evita APP_PUBLIC_BASE_URL desatualizado).
    return process.env.APP_PUBLIC_BASE_URL;
}

function serviceShareUrl(shareToken, req) {
    const base = getPublicBaseUrl(req);
    if (!base || !shareToken) return '';
    return `${base}/p/os/${encodeURIComponent(shareToken)}`;
}

async function ensureServiceShareToken(serviceRow, req) {
    const prev = normalizeServiceOrderRow(serviceRow);
    if (prev.shareToken) {
        return {
            service: prev,
            shareUrl: serviceShareUrl(prev.shareToken, req),
            created: false
        };
    }
    const shareToken = randomUUID().replace(/-/g, '').slice(0, 24);
    const shareCreatedAt = new Date().toISOString();
    await db.update(SERVICE_ORDERS_COLLECTION, prev.id, { shareToken, shareCreatedAt });
    const service = normalizeServiceOrderRow({
        ...prev,
        shareToken,
        shareCreatedAt
    });
    return {
        service,
        shareUrl: serviceShareUrl(shareToken, req),
        created: true
    };
}

function serviceStatusLabelPt(status) {
    const m = {
        open: 'Aberta',
        in_progress: 'Em andamento',
        waiting_parts: 'Aguardando peça',
        done: 'Concluída',
        delivered: 'Entregue'
    };
    return m[String(status || '')] || 'Em andamento';
}

function serviceShareableStages(service) {
    return (service?.checklist || []).filter((item) => item.defective);
}

function buildServiceStagesHtml(service, options = {}) {
    const compact = options?.compact === true;
    const stages = serviceShareableStages(service);
    if (!stages.length) {
        return '<p style="color:#64748b;font-size:.9rem;">Nenhuma etapa registrada nesta ordem.</p>';
    }
    const pad = compact ? '14px' : '20px';
    return stages.map((item, index) => {
        const intakePhotos = item.photos || [];
        const before = (item.beforePhotos || []).length
            ? item.beforePhotos
            : (item.techPhotos || []).filter((p) => p.kind === 'before');
        const after = (item.afterPhotos || []).length
            ? item.afterPhotos
            : (item.techPhotos || []).filter((p) => p.kind === 'after');
        const generalTech = (item.techPhotos || []).filter((p) => !p.kind || p.kind === 'general');
        const photoCell = (photos, label) => {
            if (!photos?.length) return '';
            const thumbs = photos.map((p) => {
                const cap = p.caption ? `<span style="display:block;font-size:.65rem;color:#64748b;margin-top:4px;">${safeTemplateValue(p.caption)}</span>` : '';
                return `<figure style="margin:0;flex:1;min-width:100px;max-width:200px;">
  <img src="${safeTemplateValue(p.url)}" alt="" style="width:100%;height:120px;object-fit:cover;border-radius:10px;border:1px solid #e2e8f0;">
  ${cap}
</figure>`;
            }).join('');
            return `<div style="margin-top:10px;">
  <div style="font-size:.7rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#64748b;margin-bottom:6px;">${label}</div>
  <div style="display:flex;flex-wrap:wrap;gap:8px;">${thumbs}</div>
</div>`;
        };
        const statusBadge = item.done
            ? '<span style="background:#dcfce7;color:#166534;padding:4px 10px;border-radius:999px;font-size:.68rem;font-weight:700;">Concluído</span>'
            : '<span style="background:#fef3c7;color:#92400e;padding:4px 10px;border-radius:999px;font-size:.68rem;font-weight:700;">Em andamento</span>';
        return `
<article style="border:1px solid #e2e8f0;border-radius:16px;padding:${pad};margin-bottom:16px;background:#fff;box-shadow:0 4px 24px rgba(15,23,42,.06);">
  <div style="display:flex;align-items:flex-start;gap:12px;margin-bottom:12px;">
    <span style="font-size:1.6rem;line-height:1;">${safeTemplateValue(item.icon || '🔧')}</span>
    <div style="flex:1;">
      <div style="font-size:.72rem;color:#94a3b8;font-weight:600;">Etapa ${index + 1}</div>
      <h3 style="margin:4px 0 0;font-size:1.05rem;color:#0f172a;">${safeTemplateValue(item.label)}</h3>
    </div>
    ${statusBadge}
  </div>
  ${item.customerNote ? `<p style="margin:0 0 10px;font-size:.88rem;color:#475569;"><strong>Relato:</strong> ${safeTemplateValue(item.customerNote)}</p>` : ''}
  ${item.techNote ? `<p style="margin:0 0 10px;font-size:.88rem;color:#0f172a;background:#f8fafc;padding:12px;border-radius:10px;border-left:3px solid #f2c94c;"><strong>Serviço realizado:</strong> ${safeTemplateValue(item.techNote)}</p>` : ''}
  ${intakePhotos.length ? photoCell(intakePhotos, 'Fotos do recebimento') : ''}
  ${before.length || after.length ? `
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:12px;">
    ${before.length ? `<div style="background:#fef2f2;border-radius:12px;padding:10px;">${photoCell(before, 'Antes')}</div>` : '<div></div>'}
    ${after.length ? `<div style="background:#f0fdf4;border-radius:12px;padding:10px;">${photoCell(after, 'Depois')}</div>` : '<div></div>'}
  </div>` : ''}
  ${generalTech.length ? photoCell(generalTech, 'Registro do reparo') : ''}
</article>`;
    }).join('');
}

function serviceTemplateData(service, req, options = {}) {
    const compact = options?.compact === true;
    const base = getPublicBaseUrl(req);
    const logoUrl = base ? `${base}/public/img/logo_bg.png` : '/public/img/logo_bg.png';
    const shareUrl = serviceShareUrl(service?.shareToken, req);
    const stages = serviceShareableStages(service);
    const done = stages.filter((s) => s.done).length;
    const progress = stages.length ? Math.round((done / stages.length) * 100) : 0;
    const storeName = options?.storeName != null
        ? String(options.storeName)
        : (options?.configs?.storeName || options?.configs?.name || 'InfoCore');
    return {
        code: safeTemplateValue(service?.code || 'OS'),
        customerName: safeTemplateValue(service?.customerName || 'Cliente'),
        customerPhone: safeTemplateValue(service?.customerPhone || '-'),
        deviceType: safeTemplateValue(service?.deviceType || ''),
        deviceBrandModel: safeTemplateValue(service?.deviceBrandModel || ''),
        accessories: safeTemplateValue(service?.accessories || '-'),
        issueReport: safeTemplateValue(service?.issueReport || '-'),
        statusLabel: safeTemplateValue(serviceStatusLabelPt(service?.status)),
        progressPercent: String(progress),
        progressLabel: `${done}/${stages.length} etapas`,
        workTemplateName: safeTemplateValue(service?.workTemplateName || ''),
        workTemplateRowHtml: service?.workTemplateName
            ? `<tr><td style="padding:6px 0;color:#64748b;">Pacote</td><td style="text-align:right;font-weight:600;">${safeTemplateValue(service.workTemplateName)}</td></tr>`
            : '',
        stagesHtml: buildServiceStagesHtml(service, { compact }),
        shareUrl: safeTemplateValue(shareUrl),
        shareLinkBlock: shareUrl
            ? `<a href="${safeTemplateValue(shareUrl)}" style="color:#b45309;font-weight:700;text-decoration:none;">${safeTemplateValue(shareUrl)}</a>`
            : '',
        logoUrl,
        storeName: safeTemplateValue(storeName),
        issuedAt: formatDateBr(new Date().toISOString().slice(0, 10)),
        updatedAt: formatDateBr(service?.updatedAt || service?.createdAt || ''),
        diagnosticHtml: buildPcDiagnosticHtml(service?.pcDiagnostic, { compact })
    };
}

function readServiceTemplate(filename, fallback = '') {
    const templatePath = path.join(__dirname, 'templates', 'services', filename);
    try {
        return fs.readFileSync(templatePath, 'utf8');
    } catch {
        return fallback;
    }
}

function renderServiceTemplateHtml(kind, service, req, options = {}) {
    const compact = kind === 'pdf';
    const data = {
        ...serviceTemplateData(service, req, options),
        reportCardHtml: renderTemplateString(
            readServiceTemplate('report-card.html', '<div>{{stagesHtml}}</div>'),
            serviceTemplateData(service, req, { compact, ...options })
        )
    };
    const file = kind === 'image' ? 'image.html' : 'pdf.html';
    const fallback = kind === 'image'
        ? '<div id="serviceImageArea">{{reportCardHtml}}</div>'
        : '<div id="servicePrintArea">{{reportCardHtml}}</div>';
    return renderTemplateString(readServiceTemplate(file, fallback), data);
}

function renderServiceTemplateText(kind, service, req, options = {}) {
    const file = kind === 'whatsapp' ? 'whatsapp.txt' : 'whatsapp.txt';
    const fallback = `*Serviço {{code}}* — {{storeName}}\n\nOlá, {{customerName}}!\n\nSeu {{deviceType}} {{deviceBrandModel}} foi atendido.\nProgresso: {{progressPercent}}% ({{progressLabel}})\n\nAcompanhe cada etapa com fotos:\n{{shareUrl}}\n\n— Equipe {{storeName}}`;
    return renderTemplateString(readServiceTemplate(file, fallback), serviceTemplateData(service, req, options));
}

async function generateServiceShareQrDataUrl(shareUrl) {
    if (!shareUrl) return '';
    return QRCode.toDataURL(shareUrl, {
        width: 320,
        margin: 2,
        color: { dark: '#0f172a', light: '#ffffff' }
    });
}

async function saveShareQrPng(shareToken, shareUrl) {
    const dir = path.join(__dirname, 'uploads');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const filename = `os-share-${shareToken}.png`;
    const filePath = path.join(dir, filename);
    await QRCode.toFile(filePath, shareUrl, {
        width: 400,
        margin: 2,
        color: { dark: '#0f172a', light: '#ffffff' }
    });
    return `/uploads/${filename}`;
}

async function findServiceByCode(code) {
    const c = String(code || '').trim();
    if (!c) return null;
    const snap = await firestore.collection(SERVICE_ORDERS_COLLECTION)
        .where('code', '==', c)
        .limit(1)
        .get();
    if (snap.empty) return null;
    const doc = snap.docs[0];
    return normalizeServiceOrderRow({ id: doc.id, ...(doc.data() || {}) });
}

function verifyDiagnosticApiKey(req) {
    const expected = process.env.DIAGNOSTIC_API_KEY
        ? String(process.env.DIAGNOSTIC_API_KEY).trim()
        : '';
    if (!expected) return true;
    const provided = String(
        req.get('x-diagnostic-key')
        || req.query.key
        || req.body?.api_key
        || ''
    ).trim();
    return provided === expected;
}

async function fetchServiceByShareToken(token) {
    const t = String(token || '').trim();
    if (!t) return null;
    const snap = await firestore.collection(SERVICE_ORDERS_COLLECTION)
        .where('shareToken', '==', t)
        .limit(1)
        .get();
    if (!snap.empty) {
        const doc = snap.docs[0];
        return normalizeServiceOrderRow({ id: doc.id, ...(doc.data() || {}) });
    }
    const byId = await firestore.collection(SERVICE_ORDERS_COLLECTION).doc(t).get();
    if (!byId.exists) return null;
    let row = normalizeServiceOrderRow({ id: byId.id, ...(byId.data() || {}) });
    if (!row.shareToken) {
        const shareToken = randomUUID().replace(/-/g, '').slice(0, 24);
        const shareCreatedAt = new Date().toISOString();
        await db.update(SERVICE_ORDERS_COLLECTION, byId.id, { shareToken, shareCreatedAt });
        row = normalizeServiceOrderRow({ ...row, shareToken, shareCreatedAt });
    }
    return row;
}

async function sendServiceWhatsapp(service, req, options = {}) {
    const to = sanitizePhone(service?.customerPhone || '');
    if (!to) return { sent: false, skipped: true, reason: 'Sem telefone do cliente.' };
    if (!whatsappClient.hasSavedSession()) {
        return { sent: false, skipped: true, reason: 'WhatsApp não conectado. Vá em Configurações e escaneie o QR Code.' };
    }

    const share = await ensureServiceShareToken(service, req);
    const svc = share.service;
    const shareUrl = share.shareUrl;
    const text = renderServiceTemplateText('whatsapp', svc, req, options);
    const reportFiles = options.reportFiles || {};
    const warnings = [];

    if (options.includeImage && !reportFiles.imagePath) {
        warnings.push('Marque a prévia do relatório antes de enviar ou aguarde o carregamento da imagem.');
    }

    let firstResult;
    try {
        if (options.includeQr && shareUrl && svc.shareToken) {
            const qrRelPath = await saveShareQrPng(svc.shareToken, shareUrl);
            const qrAbs = path.join(__dirname, qrRelPath.replace(/^\//, ''));
            firstResult = await whatsappClient.sendImage(to, qrAbs, text);
        } else {
            firstResult = await whatsappClient.sendText(to, text);
        }
    } catch (e) {
        console.error('[WhatsApp] envio texto OS:', e.message);
        return { sent: false, error: true, reason: e.message || 'Falha ao enviar mensagem.' };
    }

    let pdfSent = false;
    if (options.includePdf && reportFiles.pdfPath) {
        try {
            await whatsappClient.sendDocument(to, reportFiles.pdfPath, {
                fileName: reportFiles.pdfFileName || `OS-${svc.code || 'relatorio'}.pdf`,
                mimetype: 'application/pdf',
                caption: `Relatório em PDF — ${svc.code || 'OS'}`
            });
            pdfSent = true;
        } catch (e) {
            warnings.push(`PDF: ${e.message || 'falha no envio'}`);
            console.error('[WhatsApp] PDF:', e.message);
        }
    } else if (options.includePdf) {
        warnings.push('PDF não foi gerado.');
    }

    let imageSent = false;
    if (options.includeImage && reportFiles.imagePath) {
        try {
            await whatsappClient.sendImage(to, reportFiles.imagePath, `Relatório visual — ${svc.code || 'OS'}`);
            imageSent = true;
        } catch (e) {
            warnings.push(`Imagem: ${e.message || 'falha no envio'}`);
            console.error('[WhatsApp] imagem relatório:', e.message);
        }
    }

    return {
        sent: true,
        shareUrl,
        to: firstResult?.to || to,
        messageId: firstResult?.messageId || '',
        qrSent: Boolean(options.includeQr && shareUrl),
        pdfSent,
        imageSent,
        ...(warnings.length ? { warning: warnings.join(' ') } : {})
    };
}

async function dispatchServiceShare(service, req, body = {}) {
    const report = { whatsapp: null, share: null };
    const options = {
        includeLink: body.includeLink !== false,
        includeQr: Boolean(body.includeQr),
        includePdf: Boolean(body.includePdf),
        includeImage: Boolean(body.includeImage)
    };
    try {
        report.share = await ensureServiceShareToken(service, req);
        service = report.share.service;
    } catch (e) {
        report.share = { error: true, reason: e.message || 'Falha ao gerar link.' };
    }
    if (body.sendWhatsapp) {
        try {
            const configs = await getConfigsSafe();
            let reportFiles = {};
            const svcForFiles = report.share?.service || service;
            if (options.includePdf || (options.includeImage && body.reportImageBase64)) {
                reportFiles = await buildServiceReportFiles(svcForFiles, __dirname, {
                    includePdf: options.includePdf,
                    includeImage: options.includeImage,
                    imageBase64: body.reportImageBase64,
                    storeName: configs?.storeName || configs?.name || 'InfoCore',
                    shareUrl: report.share?.shareUrl || ''
                });
            }
            report.whatsapp = await sendServiceWhatsapp(svcForFiles, req, {
                ...options,
                configs,
                reportFiles
            });
        } catch (e) {
            report.whatsapp = { sent: false, error: true, reason: e.message || 'Falha no envio por WhatsApp.' };
        }
    }
    let qrDataUrl = '';
    if (report.share?.shareUrl) {
        try {
            qrDataUrl = await generateServiceShareQrDataUrl(report.share.shareUrl);
        } catch (e) {
            console.error('QR generation', e);
        }
    }
    return {
        ...report,
        shareUrl: report.share?.shareUrl || '',
        qrDataUrl,
        service: report.share?.service || service
    };
}

function reorderChecklistByTemplateSequence(checklist, templateIds) {
    const list = Array.isArray(checklist) ? [...checklist] : [];
    const ids = Array.isArray(templateIds) ? templateIds.map((id) => String(id).trim()).filter(Boolean) : [];
    if (!ids.length) return list;
    const ordered = [];
    const used = new Set();
    for (const tplId of ids) {
        const prefix = `tpl-${tplId}-`;
        for (const item of list) {
            const key = String(item.key || '');
            if (key.startsWith(prefix) && !used.has(key)) {
                ordered.push(item);
                used.add(key);
            }
        }
    }
    for (const item of list) {
        const key = String(item.key || '');
        if (!used.has(key)) ordered.push(item);
    }
    return ordered;
}

function applyWorkTemplateToChecklist(existingChecklist, template, deviceType) {
    const tpl = normalizeServiceWorkTemplateRow(template);
    if (!tpl.id || !tpl.stages.length) return existingChecklist;
    if (tpl.deviceTypes.length && !tpl.deviceTypes.includes(deviceType)) {
        return existingChecklist;
    }
    const list = Array.isArray(existingChecklist) ? [...existingChecklist] : [];
    const existingKeys = new Set(list.map((i) => String(i.key)));
    for (const stage of tpl.stages) {
        const key = `tpl-${tpl.id}-${stage.key}`;
        if (existingKeys.has(key)) continue;
        list.push(normalizeServiceChecklistItem({
            key,
            label: stage.label,
            icon: stage.icon,
            defective: true,
            customerNote: stage.defaultNote,
            estimatedPrice: null,
            photos: [],
            done: false,
            techNote: '',
            techPhotos: [],
            beforePhotos: [],
            afterPhotos: [],
            fromTemplate: true
        }));
        existingKeys.add(key);
    }
    return list;
}

function buildServiceBudgetNotes(serviceRow, budgetRawNotes) {
    const lines = [];
    const raw = String(budgetRawNotes || serviceRow.budgetRawNotes || '').trim();
    if (raw) lines.push(raw);
    lines.push(`--- OS ${serviceRow.code} (rascunho para polir) ---`);
    lines.push(`Aparelho: ${serviceRow.deviceType || '—'} ${serviceRow.deviceBrandModel || ''}`.trim());
    if (serviceRow.accessories) lines.push(`Acessórios: ${serviceRow.accessories}`);
    if (serviceRow.issueReport) lines.push(`Relato geral: ${serviceRow.issueReport}`);
    const defects = (serviceRow.checklist || []).filter((item) => item.defective);
    if (defects.length) {
        lines.push('Itens marcados com defeito:');
        for (const item of defects) {
            let line = `- ${item.label}`;
            if (item.customerNote) line += ` — ${item.customerNote}`;
            if (item.estimatedPrice != null && item.estimatedPrice > 0) {
                line += ` (ref. ${moneyBr(item.estimatedPrice)})`;
            }
            lines.push(line);
        }
    }
    if (serviceRow.estimateValue != null && serviceRow.estimateValue > 0) {
        lines.push(`Valor estimado informado no balcão: ${moneyBr(serviceRow.estimateValue)}`);
    }
    return lines.join('\n');
}

async function createLinkedBudgetForService(serviceDraft, sessionUser, budgetBody = null) {
    const serviceId = String(serviceDraft.id || '').trim();
    const budgetId = randomUUID();
    const osCode = String(serviceDraft.code || serviceDisplayCode());
    const budgetInput = budgetBody && typeof budgetBody === 'object' ? budgetBody : null;
    let items = [];
    let discount = 0;
    let extra = 0;
    let validUntil = '';
    let userNotes = '';

    if (budgetInput && Array.isArray(budgetInput.items) && budgetInput.items.length) {
        items = budgetInput.items.map((item) => ({
            kind: item.kind === 'product' ? 'product' : 'custom',
            productId: String(item.productId || ''),
            sku: String(item.sku || ''),
            name: String(item.name || '').trim(),
            qty: Math.max(0, Number(item.qty) || 0),
            unitPrice: Math.max(0, Number(item.unitPrice) || 0)
        })).filter((row) => row.name && row.qty > 0);
        discount = Math.max(0, Number(budgetInput.discount) || 0);
        extra = Math.max(0, Number(budgetInput.extra) || 0);
        validUntil = String(budgetInput.validUntil || '').trim();
        userNotes = String(budgetInput.notes || '').trim();
    } else {
        const estimateValue = serviceDraft.estimateValue != null ? Math.max(0, Number(serviceDraft.estimateValue) || 0) : 0;
        const defects = (serviceDraft.checklist || []).filter((item) => item.defective);
        items = [{
            kind: 'custom',
            name: `Serviço ${osCode} — ${serviceDraft.deviceType || 'Aparelho'} ${serviceDraft.deviceBrandModel || ''}`.trim(),
            qty: 1,
            unitPrice: estimateValue
        }];
        for (const defect of defects) {
            const price = defect.estimatedPrice != null ? Math.max(0, Number(defect.estimatedPrice) || 0) : 0;
            if (price <= 0) continue;
            items.push({
                kind: 'custom',
                name: `[OS] ${defect.label}`,
                qty: 1,
                unitPrice: price
            });
        }
        userNotes = String(serviceDraft.budgetRawNotes || '').trim();
    }

    if (!items.length) {
        return { error: true, message: 'Adicione ao menos 1 item ao orçamento.' };
    }

    const notes = buildServiceBudgetNotes(serviceDraft, userNotes);
    const built = await buildBudgetRecordFromBody({
        customerId: serviceDraft.customerId,
        customerName: serviceDraft.customerName,
        customerPhone: serviceDraft.customerPhone,
        customerEmail: serviceDraft.customerEmail,
        notes,
        items,
        discount,
        extra,
        validUntil,
        status: 'draft',
        serviceOrderId: serviceId
    }, {
        id: budgetId,
        code: null,
        createdAt: null,
        prevStatus: null
    });

    if (built.error) return built;

    const payload = { ...built.payload, serviceOrderId: serviceId };
    await db.create(BUDGETS_COLLECTION, budgetId, payload);
    const budget = await fetchBudgetNormalized(budgetId);
    return { error: false, budgetId, budget: budget || built.budget, customer: built.customer, customerCreated: built.customerCreated };
}

async function loadServiceOrdersNormalized() {
    const rows = await db.findAll({ colecao: SERVICE_ORDERS_COLLECTION }).catch((err) => {
        console.error('[OS] Erro ao listar ordens:', err);
        return [];
    });
    const list = Array.isArray(rows) ? rows.map((row) => {
        const id = row?.id != null ? String(row.id) : '';
        return normalizeServiceOrderRow({ ...row, id });
    }).filter((row) => row.id && row.customerName) : [];
    list.sort((a, b) => {
        const ta = new Date(a.updatedAt || a.createdAt || 0).getTime();
        const tb = new Date(b.updatedAt || b.createdAt || 0).getTime();
        return tb - ta;
    });
    return list;
}

function serviceOrderFirestorePayload(row) {
    const n = normalizeServiceOrderRow(row);
    return {
        id: n.id,
        code: n.code,
        budgetId: n.budgetId,
        customerId: n.customerId,
        customerName: n.customerName,
        customerPhone: n.customerPhone,
        customerEmail: n.customerEmail,
        deviceType: n.deviceType,
        deviceBrandModel: n.deviceBrandModel,
        accessories: n.accessories,
        issueReport: n.issueReport,
        budgetRawNotes: n.budgetRawNotes,
        estimateValue: n.estimateValue,
        checklist: n.checklist,
        progressNotes: n.progressNotes,
        status: n.status,
        priority: n.priority,
        createdAt: n.createdAt,
        updatedAt: n.updatedAt,
        createdBy: n.createdBy,
        workTemplateId: n.workTemplateId,
        workTemplateName: n.workTemplateName,
        shareToken: n.shareToken || '',
        shareCreatedAt: n.shareCreatedAt || null,
        pcDiagnostic: n.pcDiagnostic || null
    };
}

function isValidServicePhone(raw) {
    const digits = sanitizePhone(raw);
    return digits.length >= 10 && digits.length <= 15;
}

function currentMonthKey() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    return `${y}-${m}`;
}

function entryInMonth(entry, monthKey) {
    const dt = String(entry?.date || '').slice(0, 7);
    return dt === monthKey;
}

function paymentLabelForCashFlow(payment) {
    const key = normalizePaymentKey(payment);
    const labels = {
        money: 'Dinheiro',
        pix: 'PIX',
        credit_card: 'Cartão de crédito',
        debit_card: 'Cartão de débito'
    };
    return labels[key] || key;
}

async function loadCustomersNormalized() {
    const rows = await db.findAll({ colecao: CUSTOMERS_COLLECTION }).catch(() => []);
    let sales = [];
    try {
        sales = await db.findAll({ colecao: SALES_COLLECTION });
    } catch {
        sales = [];
    }
    const saleMap = salesTotalsByClientKey(Array.isArray(sales) ? sales : []);
    const list = Array.isArray(rows) ? rows : [];
    return list.map((row) => {
        const id = row.id != null ? String(row.id) : '';
        const nmKey = String(row.name || '').trim().toLowerCase();
        const stats = nmKey ? saleMap.get(nmKey) || { purchases: 0, spent: 0 } : { purchases: 0, spent: 0 };
        return normalizeCustomerRow({ ...row, id }, stats);
    }).sort((a, b) => {
        const ad = a.updatedAt ? new Date(a.updatedAt).getTime() : (a.createdAt ? new Date(a.createdAt).getTime() : 0);
        const bd = b.updatedAt ? new Date(b.updatedAt).getTime() : (b.createdAt ? new Date(b.createdAt).getTime() : 0);
        return bd - ad;
    });
}

function cashFlowDescriptionForSale(saleRecord, saleId) {
    const code = saleRecord?.code || saleId || '';
    const client = saleRecord?.client != null ? String(saleRecord.client).trim() : 'Balcão';
    const pay = paymentLabelForCashFlow(saleRecord?.payment);
    return `${code} · ${client || 'Balcão'} · ${pay}`;
}

function buildCashFlowPayloadFromSale(saleId, saleRecord) {
    const total = Number(saleRecord?.total) || 0;
    const costTotal = Number(saleRecord?.costTotal) || 0;
    const profit = Number.isFinite(Number(saleRecord?.profit))
        ? Number(saleRecord.profit)
        : Math.round((total - costTotal) * 100) / 100;
    const createdAtDate = toDateSafe(saleRecord?.createdAt);
    const date = createdAtDate
        ? createdAtDate.toISOString().slice(0, 10)
        : new Date().toISOString().slice(0, 10);
    const cfId = randomUUID();
    return {
        id: cfId,
        type: 'income',
        amount: total,
        cost: costTotal,
        profit,
        category: 'Vendas PDV',
        description: cashFlowDescriptionForSale(saleRecord, saleId),
        date,
        saleId: String(saleId),
        source: 'pdv',
        createdAt: FieldValue.serverTimestamp()
    };
}

function cashFlowDescriptionForBudget(budgetRecord, budgetId) {
    const code = budgetRecord?.code || budgetId || '';
    const client = budgetRecord?.customerName != null ? String(budgetRecord.customerName).trim() : 'Cliente';
    return `${code} · ${client || 'Cliente'} · Orçamento`;
}

function buildCashFlowPayloadFromBudget(budgetId, budgetRecord) {
    const total = Number(budgetRecord?.total) || 0;
    const { costTotal, profit } = computeBudgetFinancials(budgetRecord);
    const finalizedAtDate = toDateSafe(budgetRecord?.finalizedAt) || toDateSafe(budgetRecord?.updatedAt);
    const date = finalizedAtDate
        ? finalizedAtDate.toISOString().slice(0, 10)
        : new Date().toISOString().slice(0, 10);
    const cfId = randomUUID();
    return {
        id: cfId,
        type: 'income',
        amount: total,
        cost: costTotal,
        profit,
        category: 'Orçamentos',
        description: cashFlowDescriptionForBudget(budgetRecord, budgetId),
        date,
        budgetId: String(budgetId),
        source: 'budget',
        createdAt: FieldValue.serverTimestamp()
    };
}

function isPdvCashFlowEntry(row) {
    const r = row && typeof row === 'object' ? row : {};
    const source = String(r.source || '').trim();
    return source === 'pdv' || source === 'budget' || Boolean(String(r.saleId || '').trim()) || Boolean(String(r.budgetId || '').trim());
}

async function enrichBudgetItemsWithCost(rawItems, maps) {
    const costMaps = maps?.byId ? maps : await loadProductCostMaps();
    const items = [];
    let costCents = 0;
    for (const row of asItemsArray(rawItems)) {
        const kind = String(row?.kind || 'custom') === 'product' ? 'product' : 'custom';
        const qty = Number(row?.qty);
        const unitPrice = Number(row?.unitPrice);
        const name = String(row?.name || '').trim();
        const unitCost = await resolveItemUnitCost({
            id: row?.productId || row?.id,
            productId: row?.productId,
            sku: row?.sku,
            unitCost: row?.unitCost,
            cost: row?.cost
        }, costMaps);
        const lineTotal = Math.round(qty * unitPrice * 100) / 100;
        const lineCost = lineCostFromUnit(unitCost, qty);
        costCents += toCents(lineCost);
        items.push({
            id: row?.id != null ? String(row.id) : randomUUID(),
            kind,
            productId: row?.productId != null ? String(row.productId) : '',
            sku: row?.sku != null ? String(row.sku) : '',
            name,
            qty,
            unitPrice,
            unitCost,
            lineCost,
            total: lineTotal
        });
    }
    return { items, costTotal: fromCents(costCents) };
}

async function createCashFlowFromBudget(budget) {
    const budgetId = budget?.id != null ? String(budget.id).trim() : '';
    if (!budgetId) return null;
    const cfRows = await db.findAll({ colecao: CASH_FLOW_COLLECTION }).catch(() => []);
    const exists = (Array.isArray(cfRows) ? cfRows : []).some(
        (e) => String(e.budgetId || '').trim() === budgetId
    );
    if (exists) return null;

    const fin = await enrichBudgetItemsWithCost(budget.items);
    const total = Number(budget.total) || 0;
    const enriched = {
        ...budget,
        items: fin.items,
        costTotal: fin.costTotal,
        profit: Math.round((total - fin.costTotal) * 100) / 100
    };
    const payload = buildCashFlowPayloadFromBudget(budgetId, enriched);
    await db.create(CASH_FLOW_COLLECTION, payload.id, payload);
    return normalizeCashFlowRow({ ...payload, createdAt: new Date().toISOString() });
}

async function resolveBudgetCostFromProducts(budgetRecord, maps) {
    const items = asItemsArray(budgetRecord?.items);
    const enriched = await enrichBudgetItemsWithCost(items);
    const total = Number(budgetRecord?.total) || 0;
    const profit = Math.round((total - enriched.costTotal) * 100) / 100;
    return { items: enriched.items, costTotal: enriched.costTotal, profit };
}

/** Rebuild único: vendas, orçamentos finalizados e fluxo de caixa com custo do produto. */
async function rebuildAllFinancialData() {
    const maps = await loadProductCostMaps();
    let batch = firestore.batch();
    let ops = 0;

    const commitIfNeeded = async (force = false) => {
        if (force || ops >= 350) {
            if (ops > 0) await batch.commit();
            batch = firestore.batch();
            ops = 0;
        }
    };

    const salesRows = await db.findAll({ colecao: SALES_COLLECTION }).catch(() => []);
    const salesMap = new Map();
    for (const sale of Array.isArray(salesRows) ? salesRows : []) {
        const id = sale?.id != null ? String(sale.id).trim() : '';
        if (!id) continue;
        const fin = await enrichSaleItemsWithProductCosts(sale.items, maps);
        const total = Number(sale.total) || 0;
        const profit = Math.round((total - fin.costTotal) * 100) / 100;
        const enriched = { ...sale, items: fin.items, costTotal: fin.costTotal, profit };
        salesMap.set(id, enriched);
        batch.set(firestore.collection(SALES_COLLECTION).doc(id), enriched);
        ops++;
        await commitIfNeeded();
    }

    const budgetRows = await db.findAll({ colecao: BUDGETS_COLLECTION }).catch(() => []);
    const budgetMap = new Map();
    for (const budget of Array.isArray(budgetRows) ? budgetRows : []) {
        const id = budget?.id != null ? String(budget.id).trim() : '';
        if (!id) continue;
        const fin = await resolveBudgetCostFromProducts(budget, maps);
        const enriched = { ...budget, items: fin.items, costTotal: fin.costTotal, profit: fin.profit };
        budgetMap.set(id, enriched);
        if (String(budget.status || '') === 'finalized') {
            batch.set(firestore.collection(BUDGETS_COLLECTION).doc(id), enriched);
            ops++;
            await commitIfNeeded();
        }
    }

    const cfRows = await db.findAll({ colecao: CASH_FLOW_COLLECTION }).catch(() => []);
    const linkedSales = new Set();
    const linkedBudgets = new Set();

    for (const entry of Array.isArray(cfRows) ? cfRows : []) {
        const cfId = String(entry.id || '').trim();
        if (!cfId) continue;

        const saleId = String(entry.saleId || '').trim();
        const budgetId = String(entry.budgetId || '').trim();
        let patch = null;

        if (saleId && salesMap.has(saleId)) {
            const sale = salesMap.get(saleId);
            linkedSales.add(saleId);
            const amount = Number(sale.total) || Number(entry.amount) || 0;
            patch = {
                amount,
                cost: sale.costTotal,
                profit: sale.profit
            };
        } else if (budgetId && budgetMap.has(budgetId)) {
            const budget = budgetMap.get(budgetId);
            linkedBudgets.add(budgetId);
            const amount = Number(budget.total) || Number(entry.amount) || 0;
            patch = {
                amount,
                cost: budget.costTotal,
                profit: budget.profit
            };
        }

        if (patch) {
            batch.update(firestore.collection(CASH_FLOW_COLLECTION).doc(cfId), patch);
            ops++;
            await commitIfNeeded();
        }
    }

    for (const [saleId, sale] of salesMap) {
        if (linkedSales.has(saleId)) continue;
        const payload = buildCashFlowPayloadFromSale(saleId, sale);
        batch.set(firestore.collection(CASH_FLOW_COLLECTION).doc(payload.id), payload);
        ops++;
        await commitIfNeeded();
    }

    for (const [budgetId, budget] of budgetMap) {
        if (String(budget.status || '') !== 'finalized' || linkedBudgets.has(budgetId)) continue;
        const payload = buildCashFlowPayloadFromBudget(budgetId, budget);
        batch.set(firestore.collection(CASH_FLOW_COLLECTION).doc(payload.id), payload);
        ops++;
        await commitIfNeeded();
    }

    await commitIfNeeded(true);
    return { sales: salesMap.size, budgets: budgetMap.size, cashFlow: (cfRows || []).length };
}

async function hydrateCashFlowEntriesFromProducts(entries) {
    const maps = await loadProductCostMaps();
    const [salesRows, budgetRows] = await Promise.all([
        db.findAll({ colecao: SALES_COLLECTION }).catch(() => []),
        db.findAll({ colecao: BUDGETS_COLLECTION }).catch(() => [])
    ]);
    const salesMap = new Map(
        (Array.isArray(salesRows) ? salesRows : []).map((s) => [String(s.id || '').trim(), s])
    );
    const budgetMap = new Map(
        (Array.isArray(budgetRows) ? budgetRows : []).map((b) => [String(b.id || '').trim(), b])
    );

    const out = [];
    for (const entry of entries) {
        const base = normalizeCashFlowRow(entry);
        const saleId = String(entry.saleId || '').trim();
        const budgetId = String(entry.budgetId || '').trim();

        if (saleId && salesMap.has(saleId)) {
            const fin = await enrichSaleItemsWithProductCosts(salesMap.get(saleId).items, maps);
            const amount = Number(salesMap.get(saleId).total) || base.amount;
            base.amount = amount;
            base.cost = fin.costTotal;
            base.profit = Math.round((amount - fin.costTotal) * 100) / 100;
        } else if (budgetId && budgetMap.has(budgetId)) {
            const fin = await resolveBudgetCostFromProducts(budgetMap.get(budgetId), maps);
            const amount = Number(budgetMap.get(budgetId).total) || base.amount;
            base.amount = amount;
            base.cost = fin.costTotal;
            base.profit = Math.round((amount - fin.costTotal) * 100) / 100;
        }
        out.push(base);
    }
    return out;
}

async function syncMissingBudgetsToCashFlow() {
    const [budgetRows, cfRows] = await Promise.all([
        db.findAll({ colecao: BUDGETS_COLLECTION }).catch(() => []),
        db.findAll({ colecao: CASH_FLOW_COLLECTION }).catch(() => [])
    ]);
    const linked = new Set(
        (Array.isArray(cfRows) ? cfRows : [])
            .map((e) => String(e.budgetId || '').trim())
            .filter(Boolean)
    );
    const budgets = (Array.isArray(budgetRows) ? budgetRows : []).filter(
        (b) => String(b.status || '') === 'finalized'
    );
    for (const budget of budgets) {
        const id = budget?.id != null ? String(budget.id).trim() : '';
        if (!id || linked.has(id)) continue;
        await createCashFlowFromBudget(budget).catch((e) => console.error('sync orçamento→fluxo:', e));
        linked.add(id);
    }
}

const FINANCIAL_REBUILD_FLAG = 'financial_rebuild_v3';

async function ensureFinancialRebuildOnce() {
    try {
        const metaRef = firestore.collection('infocore').doc('meta');
        const snap = await metaRef.get();
        if (snap.exists && snap.data()?.[FINANCIAL_REBUILD_FLAG] === true) return false;
        await rebuildAllFinancialData();
        await metaRef.set(
            { [FINANCIAL_REBUILD_FLAG]: true, rebuiltAt: FieldValue.serverTimestamp() },
            { merge: true }
        );
        return true;
    } catch (e) {
        console.error('ensureFinancialRebuildOnce:', e);
        await rebuildAllFinancialData().catch((err) => console.error('rebuild financeiro:', err));
        return true;
    }
}

async function loadCashFlowNormalized() {
    await ensureFinancialRebuildOnce().catch((e) => console.error('rebuild financeiro:', e));
    await syncMissingBudgetsToCashFlow().catch((e) => console.error('sync orçamentos→fluxo:', e));
    const rows = await db.findAll({ colecao: CASH_FLOW_COLLECTION }).catch(() => []);
    const raw = Array.isArray(rows) ? rows : [];
    const list = await hydrateCashFlowEntriesFromProducts(raw);
    list.sort((a, b) => {
        const dCmp = String(b.date || '').localeCompare(String(a.date || ''));
        if (dCmp !== 0) return dCmp;
        const ac = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const bc = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return bc - ac;
    });
    return list;
}

function safeTemplateValue(value) {
    return String(value == null ? '' : value);
}

function formatDateBr(value) {
    const s = String(value || '').trim();
    if (!s) return '-';
    const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`;
    return s;
}

function renderTemplateString(template, data) {
    let out = String(template || '');
    Object.keys(data || {}).forEach((key) => {
        const token = new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, 'g');
        out = out.replace(token, safeTemplateValue(data[key]));
    });
    return out;
}

function readBudgetTemplate(filename, fallback = '') {
    const templatePath = path.join(__dirname, 'templates', 'budgets', filename);
    try {
        return fs.readFileSync(templatePath, 'utf8');
    } catch {
        return fallback;
    }
}

function buildBudgetRowsHtml(budget, compact = false) {
    const items = Array.isArray(budget?.items) ? budget.items : [];
    const pad = compact ? '4px 6px' : '8px';
    const fs = compact ? 'font-size:.7rem;' : '';
    return items.map((item) => `
<tr>
  <td style="padding:${pad};border-bottom:1px solid #e5e7eb;${fs}">${safeTemplateValue(item.name || '')}</td>
  <td style="padding:${pad};border-bottom:1px solid #e5e7eb;text-align:center;${fs}">${safeTemplateValue(item.qty || 0)}</td>
  <td style="padding:${pad};border-bottom:1px solid #e5e7eb;text-align:right;${fs}">${moneyBr(item.unitPrice || 0)}</td>
  <td style="padding:${pad};border-bottom:1px solid #e5e7eb;text-align:right;font-weight:700;${fs}">${moneyBr((Number(item.qty) || 0) * (Number(item.unitPrice) || 0))}</td>
</tr>`).join('');
}

function buildBudgetRowsText(budget) {
    const items = Array.isArray(budget?.items) ? budget.items : [];
    return items.map((item) => `- ${safeTemplateValue(item.name || 'Item')} (x${Number(item.qty) || 0}) ${moneyBr((Number(item.qty) || 0) * (Number(item.unitPrice) || 0))}`).join('\n');
}

function budgetTemplateData(budget, req, options = {}) {
    const compact = options?.compact === true;
    const reqBase = req ? `${req.protocol}://${req.get('host')}` : '';
    const envBase = process.env.APP_PUBLIC_BASE_URL
        ? String(process.env.APP_PUBLIC_BASE_URL).replace(/\/$/, '')
        : '';
    const base = reqBase || envBase;
    const logoUrl = base ? `${base}/public/img/logo_bg.png` : '/public/img/logo_bg.png';
    const isFinalized = String(budget?.status || 'draft') === 'finalized';
    const validUntilRaw = budget?.validUntil || budget?.date || '';
    const statusBadgeHtml = isFinalized
        ? '<span style="display:inline-block;padding:4px 10px;border-radius:999px;font-size:.72rem;font-weight:700;text-transform:uppercase;letter-spacing:.04em;background:#dcfce7;color:#166534;">Finalizado</span>'
        : '';
    const signatureTerms = 'Ao assinar, declaro que o problema foi resolvido e que o aparelho foi devolvido.';
    return {
        code: safeTemplateValue(budget?.code || 'ORC'),
        customerName: safeTemplateValue(budget?.customerName || 'Não informado'),
        customerPhone: safeTemplateValue(budget?.customerPhone || '-'),
        customerEmail: safeTemplateValue(budget?.customerEmail || '-'),
        validUntil: formatDateBr(validUntilRaw),
        date: formatDateBr(validUntilRaw),
        notes: safeTemplateValue(budget?.notes || '-'),
        subtotal: moneyBr(budget?.subtotal || 0),
        discount: moneyBr(budget?.discount || 0),
        extra: moneyBr(budget?.extra || 0),
        total: moneyBr(budget?.total || 0),
        status: safeTemplateValue(isFinalized ? 'Finalizado' : ''),
        statusBg: isFinalized ? '#dcfce7' : 'transparent',
        statusColor: isFinalized ? '#166534' : 'transparent',
        statusBadgeHtml,
        signatureTerms: safeTemplateValue(signatureTerms),
        issuedAt: formatDateBr(new Date().toISOString().slice(0, 10)),
        itemsRowsHtml: buildBudgetRowsHtml(budget, compact),
        itemsRowsText: buildBudgetRowsText(budget),
        logoUrl
    };
}

function renderBudgetVoucherHtml(budget, req, options = {}) {
    const compact = options?.compact === true;
    const file = compact ? 'voucher-print.html' : 'voucher.html';
    const fallback = '<div><h2>{{code}}</h2><p>{{customerName}}</p><p>{{total}}</p></div>';
    return renderTemplateString(
        readBudgetTemplate(file, fallback),
        budgetTemplateData(budget, req, { compact })
    );
}

function renderBudgetTemplateHtml(kind, budget, req) {
    const compact = kind === 'pdf';
    const data = {
        ...budgetTemplateData(budget, req, { compact }),
        voucherHtml: renderBudgetVoucherHtml(budget, req, { compact })
    };
    const file = kind === 'image' ? 'image.html' : 'pdf.html';
    const fallback = kind === 'image'
        ? '<div id="budgetImageArea">{{voucherHtml}}</div>'
        : '<div id="budgetPrintArea">{{voucherHtml}}<hr style="border-top:2px dashed #94a3b8">{{voucherHtml}}</div>';
    return renderTemplateString(readBudgetTemplate(file, fallback), data);
}

function renderBudgetTemplateText(kind, budget, req) {
    const file = kind === 'email' ? 'email.html' : 'whatsapp.txt';
    const fallback = kind === 'email'
        ? `<h2>Orçamento {{code}}</h2><p>Total: {{total}}</p><pre>{{itemsRowsText}}</pre>`
        : `*Orçamento {{code}}*\nTotal: {{total}}\n{{itemsRowsText}}`;
    return renderTemplateString(readBudgetTemplate(file, fallback), budgetTemplateData(budget, req));
}

function sanitizePhone(raw) {
    return String(raw || '').replace(/[^\d]/g, '');
}

function createSmtpTransport() {
    const host = process.env.SMTP_HOST;
    const port = Number(process.env.SMTP_PORT || 587);
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;
    if (!host || !user || !pass) return null;
    return nodemailer.createTransport({
        host,
        port,
        secure: port === 465,
        auth: { user, pass }
    });
}

async function sendBudgetEmail(budget) {
    const to = String(budget?.customerEmail || '').trim();
    if (!to) return { sent: false, skipped: true, reason: 'Sem email do cliente.' };
    const transport = createSmtpTransport();
    if (!transport) return { sent: false, skipped: true, reason: 'SMTP não configurado.' };
    const from = process.env.SMTP_FROM || process.env.SMTP_USER;
    const html = renderBudgetTemplateText('email', budget);
    await transport.sendMail({
        from,
        to,
        subject: `Orçamento ${budget?.code || ''} - InfoCore`,
        html
    });
    return { sent: true };
}

async function sendBudgetWhatsapp(budget) {
    const to = sanitizePhone(budget?.customerPhone || '');
    if (!to) return { sent: false, skipped: true, reason: 'Sem telefone do cliente.' };
    if (!whatsappClient.hasSavedSession()) {
        return { sent: false, skipped: true, reason: 'WhatsApp não conectado. Vá em Configurações e escaneie o QR Code.' };
    }
    const text = renderBudgetTemplateText('whatsapp', budget);
    try {
        await whatsappClient.sendText(to, text);
        return { sent: true };
    } catch (e) {
        console.error('[WhatsApp] envio orçamento:', e.message);
        return { sent: false, error: true, reason: e.message || 'Falha ao enviar.' };
    }
}

async function dispatchBudgetNotifications(budget) {
    const report = { email: null, whatsapp: null };
    try {
        report.email = await sendBudgetEmail(budget);
    } catch (e) {
        report.email = { sent: false, error: true, reason: e.message || 'Falha no envio por email.' };
    }
    try {
        report.whatsapp = await sendBudgetWhatsapp(budget);
    } catch (e) {
        report.whatsapp = { sent: false, error: true, reason: e.message || 'Falha no envio por WhatsApp.' };
    }
    return report;
}

/** SKU / código de barras: apenas dígitos, 1–8 caracteres, valor 1..99999999; armazenado sempre com 8 dígitos (zeros à esquerda). */
const BARCODE_SKU_MIN = 1;
const BARCODE_SKU_MAX = 99999999;

function canonicalBarcodeSku(raw) {
    const t = String(raw ?? '').trim();
    if (!/^\d{1,8}$/.test(t)) return null;
    const n = Number.parseInt(t, 10);
    if (!Number.isFinite(n) || n < BARCODE_SKU_MIN || n > BARCODE_SKU_MAX) return null;
    return String(n).padStart(8, '0');
}

function pickUnusedBarcodeSku(usedSet) {
    for (let attempt = 0; attempt < 500; attempt++) {
        const n = randomInt(BARCODE_SKU_MIN, BARCODE_SKU_MAX + 1);
        const s = String(n).padStart(8, '0');
        if (!usedSet.has(s)) {
            usedSet.add(s);
            return s;
        }
    }
    for (let n = BARCODE_SKU_MIN; n <= BARCODE_SKU_MAX; n++) {
        const s = String(n).padStart(8, '0');
        if (!usedSet.has(s)) {
            usedSet.add(s);
            return s;
        }
    }
    throw new Error('Esgotados os códigos numéricos de produto (SKU).');
}

async function fetchProductRows() {
    const rows = await db.findAll({ colecao: PRODUCTS_COLLECTION });
    return Array.isArray(rows) ? rows : [];
}

/**
 * Garante que cada produto tenha SKU numérico único (8 dígitos) e persiste correções no Firestore.
 */
async function reconcileProductBarcodeSkus(rows) {
    const used = new Set();
    const plannedKeep = new Map();

    for (const row of rows) {
        const id = row.id != null ? String(row.id) : '';
        if (!id) continue;
        const c = canonicalBarcodeSku(row.sku);
        if (!c) continue;
        if (!used.has(c)) {
            used.add(c);
            plannedKeep.set(id, c);
        }
    }

    const updates = [];
    for (const row of rows) {
        const id = row.id != null ? String(row.id) : '';
        if (!id) continue;
        const raw = row.sku != null ? String(row.sku).trim() : '';
        const c = canonicalBarcodeSku(raw);
        const kept = plannedKeep.get(id);

        if (c && kept === c) {
            if (raw !== c) updates.push({ id, sku: c });
            row.sku = c;
            continue;
        }

        const nu = pickUnusedBarcodeSku(used);
        updates.push({ id, sku: nu });
        row.sku = nu;
    }

    if (updates.length === 0) return;

    let batch = firestore.batch();
    let ops = 0;
    for (const u of updates) {
        batch.update(firestore.collection(PRODUCTS_COLLECTION).doc(u.id), { sku: u.sku });
        ops++;
        if (ops >= 400) {
            await batch.commit();
            batch = firestore.batch();
            ops = 0;
        }
    }
    if (ops) await batch.commit();
}

function normalizeProduct(row) {
    const d = row && typeof row === 'object' ? row : {};
    const id = d.id != null ? d.id : '';
    let sku = String(d.sku || '').trim();
    const c = canonicalBarcodeSku(sku);
    if (c) sku = c;
    else if (!sku && id) sku = '';
    const imageRaw = d.image != null ? String(d.image).trim() : '';
    const image = imageRaw.startsWith('/') ? imageRaw : (imageRaw ? `/uploads/${imageRaw}` : '');
    const itemType = isServiceItemType(d) ? 'service' : 'product';
    const laborCost = productLaborCost(d);
    const partsCost = parsePartsCostField(d);
    const emojiDefault = itemType === 'service' ? '🔧' : '📦';
    return {
        id,
        sku,
        name: String(d.name || ''),
        category: String(d.category || '').trim() || 'others',
        itemType,
        emoji: String(d.emoji || emojiDefault),
        image,
        cost: laborCost,
        laborCost,
        partsCost,
        unitCostTotal: productUnitCost(d),
        price: Number(d.price) || 0,
        qty: Number.parseInt(String(d.qty), 10) || 0,
        min: Number.parseInt(String(d.min), 10) || 0,
        trackStock: productTracksStock({ ...d, itemType }),
        active: d.active !== false,
        description: d.description != null ? String(d.description) : '',
        serviceDuration: d.serviceDuration != null ? String(d.serviceDuration).trim() : ''
    };
}

function parseMoneyField(v) {
    if (v == null || v === '') return 0;
    let s = String(v).trim().replace(/R\$\s?/i, '');
    if (s.includes(',')) {
        s = s.replace(/\./g, '').replace(',', '.');
    }
    const n = Number(s);
    return Number.isFinite(n) ? n : 0;
}

function asItemsArray(items) {
    if (Array.isArray(items)) return items;
    if (items && typeof items === 'object') return Object.values(items);
    return [];
}

function isServiceItemType(product) {
    const p = product && typeof product === 'object' ? product : {};
    return String(p.itemType || '').toLowerCase() === 'service';
}

function parsePartsCostField(product) {
    const p = product && typeof product === 'object' ? product : {};
    const n = parseMoneyField(p.partsCost);
    if (n > 0) return n;
    const raw = Number(p.partsCost);
    return Number.isFinite(raw) && raw > 0 ? raw : 0;
}

function productLaborCost(product) {
    const p = product && typeof product === 'object' ? product : {};
    const candidates = [p.cost, p.laborCost, p.custo, p.precoCusto, p.preco_custo, p.costPrice];
    for (const raw of candidates) {
        const parsed = parseMoneyField(raw);
        if (parsed > 0) return parsed;
        const n = Number(raw);
        if (Number.isFinite(n) && n > 0) return n;
    }
    return 0;
}

function productUnitCost(product) {
    const labor = productLaborCost(product);
    const parts = parsePartsCostField(product);
    if (isServiceItemType(product)) return labor + parts;
    return labor;
}

function productTracksStock(product) {
    const p = product && typeof product === 'object' ? product : {};
    if (isServiceItemType(p)) return false;
    return p.trackStock !== false;
}

function lineCostFromUnit(unitCost, qty) {
    const q = Number(qty) || 0;
    if (q <= 0) return 0;
    return fromCents(toCents((Number(unitCost) || 0) * q));
}

async function loadProductCostMaps() {
    const rows = await fetchProductRows();
    const byId = new Map();
    const bySku = new Map();
    for (const row of rows) {
        const id = row?.id != null ? String(row.id).trim() : '';
        const sku = row?.sku != null ? String(row.sku).trim().toLowerCase() : '';
        const unit = productUnitCost(row);
        if (id) byId.set(id, unit);
        if (sku) bySku.set(sku, unit);
    }
    return { byId, bySku };
}

async function fetchProductUnitCostDirect(productId) {
    const id = String(productId || '').trim();
    if (!id) return 0;
    try {
        const snap = await firestore.collection(PRODUCTS_COLLECTION).doc(id).get();
        if (!snap.exists) return 0;
        return productUnitCost(snap.data());
    } catch {
        return 0;
    }
}

async function resolveItemUnitCost(item, maps) {
    const productId = String(item?.id || item?.productId || '').trim();
    const sku = String(item?.sku || '').trim().toLowerCase();
    if (productId && maps?.byId?.has(productId)) return maps.byId.get(productId);
    if (sku && maps?.bySku?.has(sku)) return maps.bySku.get(sku);
    if (productId) {
        const live = await fetchProductUnitCostDirect(productId);
        if (live > 0) {
            maps.byId.set(productId, live);
            return live;
        }
    }
    return productUnitCost({ cost: item?.unitCost ?? item?.cost });
}

/** Custo sempre do produto (id → SKU → busca Firestore). */
async function enrichSaleItemsWithProductCosts(items, maps) {
    const costMaps = maps?.byId ? maps : await loadProductCostMaps();
    const list = asItemsArray(items).map((item) => ({ ...item }));
    let costCents = 0;
    for (const item of list) {
        const qty = parsePositiveInt(item.qty) || Number(item.qty) || 0;
        const unitCost = await resolveItemUnitCost(item, costMaps);
        const lineCost = lineCostFromUnit(unitCost, qty);
        item.cost = unitCost;
        item.lineCost = lineCost;
        if (qty > 0) costCents += toCents(lineCost);
    }
    return { items: list, costTotal: fromCents(costCents) };
}

async function enrichSaleRecordFinancials(saleRecord, maps) {
    const costMaps = maps?.byId ? maps : await loadProductCostMaps();
    const { items, costTotal } = await enrichSaleItemsWithProductCosts(saleRecord?.items, costMaps);
    const total = Number(saleRecord?.total) || 0;
    const profit = Math.round((total - costTotal) * 100) / 100;
    return { items, costTotal, profit };
}

function computeSaleFinancials(saleRecord) {
    const costTotal = Number(saleRecord?.costTotal) || 0;
    const total = Number(saleRecord?.total) || 0;
    const profit = Number.isFinite(Number(saleRecord?.profit))
        ? Number(saleRecord.profit)
        : Math.round((total - costTotal) * 100) / 100;
    return { costTotal, profit };
}

function computeBudgetFinancials(budgetRecord) {
    const items = asItemsArray(budgetRecord?.items);
    let costCents = 0;
    for (const item of items) {
        const unitCost = productUnitCost({ cost: item?.unitCost ?? item?.cost });
        const qty = Number(item?.qty) || 0;
        if (qty > 0) {
            const line = Number(item?.lineCost) > 0
                ? Number(item.lineCost)
                : lineCostFromUnit(unitCost, qty);
            costCents += toCents(line);
        }
    }
    let costTotal = fromCents(costCents);
    if (costTotal <= 0 && Number(budgetRecord?.costTotal) > 0) {
        costTotal = Number(budgetRecord.costTotal);
    }
    const total = Number(budgetRecord?.total) || 0;
    const profit = Math.round((total - costTotal) * 100) / 100;
    return { costTotal, profit };
}

async function loadProductsFromDb() {
    try {
        const list = await fetchProductRows();
        await reconcileProductBarcodeSkus(list);
        return list.map(normalizeProduct);
    } catch (e) {
        console.error('Erro ao carregar produtos:', e);
        return [];
    }
}

//TODO------------Configs--------------

const app = express();

class FirestoreSessionStore extends session.Store {
    constructor() {
        super();
        this.collection = firestore.collection('sessions');
    }

    get(sid, callback) {
        this.collection.doc(String(sid)).get()
            .then((doc) => {
                if (!doc.exists) return callback(null, null);
                const data = doc.data() || {};
                const expiresAt = toDateSafe(data.expiresAt);
                if (expiresAt && expiresAt.getTime() <= Date.now()) {
                    return this.destroy(sid, () => callback(null, null));
                }
                const sessionData = data.session && typeof data.session === 'object' ? data.session : null;
                return callback(null, sessionData);
            })
            .catch((err) => callback(err));
    }

    set(sid, sess, callback) {
        const maxAge = Number(sess?.cookie?.maxAge) || 0;
        const expiresAt = new Date(Date.now() + (maxAge > 0 ? maxAge : 3600000));
        let sessionData;
        try {
            sessionData = JSON.parse(JSON.stringify(sess || {}));
        } catch (e) {
            return callback && callback(e);
        }
        this.collection.doc(String(sid)).set({
            session: sessionData,
            updatedAt: FieldValue.serverTimestamp(),
            expiresAt
        })
            .then(() => callback && callback(null))
            .catch((err) => callback && callback(err));
    }

    destroy(sid, callback) {
        this.collection.doc(String(sid)).delete()
            .then(() => callback && callback(null))
            .catch((err) => callback && callback(err));
    }

    touch(sid, sess, callback) {
        const maxAge = Number(sess?.cookie?.maxAge) || 0;
        const expiresAt = new Date(Date.now() + (maxAge > 0 ? maxAge : 3600000));
        this.collection.doc(String(sid)).set({
            updatedAt: FieldValue.serverTimestamp(),
            expiresAt
        }, { merge: true })
            .then(() => callback && callback(null))
            .catch((err) => callback && callback(err));
    }
}

app.use(session({
    secret: process.env.SECRET || 'infocore-fajg3bi2bt3fi3nt2fajbf2',
    store: new FirestoreSessionStore(),
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
        maxAge: 8 * 60 * 60 * 1000,
        httpOnly: true,
        sameSite: 'lax'
    }
}));
app.use(cookieParser());

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(compression());

const staticMaxAge = process.env.NODE_ENV === 'production' ? '7d' : 0;
const staticOpts = { maxAge: staticMaxAge, etag: true, lastModified: true };

app.use((req, res, next) => {
    const p = String(req.path || '').replace(/\/$/, '') || '/';
    res.locals.currentPath = p;
    next();
});

app.use(express.static(path.join(__dirname, 'public'), staticOpts));
app.use('/uploads', express.static(path.join(__dirname, 'uploads'), staticOpts));
app.use('/public', express.static(path.join(__dirname, 'public'), staticOpts));

app.set('views', path.join(__dirname, '/views'))
app.set('view engine', 'ejs');
app.set('trust proxy', 1);

app.get('/p/os/:token', async (req, res) => {
    const token = String(req.params.token || '').trim();
    const service = await fetchServiceByShareToken(token);
    if (!service) {
        return res.status(404).send('<!DOCTYPE html><html lang="pt-BR"><body style="font-family:system-ui;text-align:center;padding:48px;"><h1>Link inválido ou expirado</h1></body></html>');
    }
    const configs = await getConfigsSafe();
    return res.render('service-share-public', {
        service,
        configs,
        diagnostic: service.pcDiagnostic,
        formatDiagnosticTimestamp,
        shareUrl: serviceShareUrl(service.shareToken, req),
        layout: false
    });
});

app.post('/api/diagnostico', async (req, res) => {
    if (!verifyDiagnosticApiKey(req)) {
        return res.status(401).json({ error: true, message: 'Chave de API inválida.' });
    }

    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const serviceCode = String(
        req.query.os
        || req.query.service_code
        || body.service_code
        || body.os_code
        || ''
    ).trim();
    const diagnostic = normalizePcDiagnostic(body);
    if (!diagnostic) {
        return res.status(400).json({
            error: true,
            message: 'Payload inválido. Envie computer_name e os dados de hardware.'
        });
    }

    const now = new Date().toISOString();
    let linked = false;
    let serviceId = '';

    if (serviceCode) {
        const service = await findServiceByCode(serviceCode);
        if (service?.id) {
            serviceId = service.id;
            linked = true;
            try {
                await db.update(SERVICE_ORDERS_COLLECTION, service.id, {
                    pcDiagnostic: diagnostic,
                    updatedAt: now
                });
            } catch (e) {
                console.error('[Diagnóstico] Erro ao vincular à OS:', e);
                return res.status(500).json({ error: true, message: 'Erro ao salvar diagnóstico na ordem de serviço.' });
            }
        }
    }

    const logId = randomUUID();
    try {
        await db.create(PC_DIAGNOSTICS_COLLECTION, logId, {
            id: logId,
            ...diagnostic,
            computerName: diagnostic.computerName,
            serviceId: serviceId || null,
            serviceCode: serviceCode || null,
            linked,
            receivedAt: now
        });
    } catch (e) {
        console.error('[Diagnóstico] Erro ao registrar log:', e);
    }

    return res.json({
        error: false,
        message: linked
            ? 'Diagnóstico recebido e vinculado à ordem de serviço.'
            : 'Diagnóstico recebido.',
        linked,
        serviceCode: serviceCode || null,
        serviceId: serviceId || null,
        computerName: diagnostic.computerName,
        timestamp: diagnostic.timestamp
    });
});

app.get('/api/public/os/:token', async (req, res) => {
    const service = await fetchServiceByShareToken(String(req.params.token || '').trim());
    if (!service) {
        return res.status(404).json({ error: true, message: 'Relatório não encontrado.' });
    }
    const shareUrl = serviceShareUrl(service.shareToken, req);
    let qrDataUrl = '';
    try {
        qrDataUrl = await generateServiceShareQrDataUrl(shareUrl);
    } catch (e) {
        console.error(e);
    }
    return res.json({
        error: false,
        service: {
            code: service.code,
            customerName: service.customerName,
            deviceType: service.deviceType,
            deviceBrandModel: service.deviceBrandModel,
            status: service.status,
            checklist: serviceShareableStages(service),
            progressPercent: (() => {
                const s = serviceShareableStages(service);
                const done = s.filter((i) => i.done).length;
                return s.length ? Math.round((done / s.length) * 100) : 0;
            })()
        },
        shareUrl,
        qrDataUrl
    });
});

app.get('/api/public/os/:token/report', async (req, res) => {
    const service = await fetchServiceByShareToken(String(req.params.token || '').trim());
    if (!service) {
        return res.status(404).send('Não encontrado');
    }
    const configs = await getConfigsSafe();
    const html = renderServiceTemplateHtml('pdf', service, req, { configs });
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.send(`<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><title>OS ${service.code}</title>
<style>@media print{@page{size:A4;margin:8mm}body{margin:0}}</style></head><body>${html}</body></html>`);
});

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        const dir = path.join(__dirname, 'uploads');
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
    },
    filename: function (req, file, cb) {
        const codigo = require('crypto').randomBytes(42).toString('hex');
        const originalName = file.originalname;
        const extension = originalName.substr(originalName.lastIndexOf('.'));
        const fileName = codigo + extension;
        cb(null, `${fileName}`)
    }
});

const imageMime = /^image\/(jpeg|png|gif|webp)$/i;
const upload = multer({
    storage,
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter(req, file, cb) {
        if (imageMime.test(file.mimetype)) cb(null, true);
        else cb(new Error('Use uma imagem JPG, PNG, GIF ou WebP.'));
    }
});

function uploadProductImage(req, res, next) {
    upload.single('image')(req, res, (err) => {
        if (err) {
            return res.status(400).json({ error: true, message: err.message || 'Upload inválido.' });
        }
        next();
    });
}

function uploadProductImageIfMultipart(req, res, next) {
    const ct = String(req.headers['content-type'] || '');
    if (ct.includes('multipart/form-data')) {
        return uploadProductImage(req, res, next);
    }
    next();
}









//TODO------------WEB PAGE--------------
function verifyLogin(req, res, next) {
    if (!req.session.user) {
        const isApi = String(req.path || '').startsWith('/api/');
        if (isApi) {
            return res.status(401).json({ error: true, message: 'Sessão expirada. Faça login novamente.' });
        }
        return res.redirect('/login');
    }
    next();
}

app.get('/api/shared-notes', verifyLogin, async (req, res) => {
    try {
        const notes = await readSharedNotes();
        return res.json({ error: false, notes });
    } catch (e) {
        console.error(e);
        return res.status(500).json({ error: true, message: 'Erro ao carregar notas.' });
    }
});

app.put('/api/shared-notes', verifyLogin, async (req, res) => {
    const body = req.body || {};
    const content = body.content != null ? String(body.content) : '';
    if (content.length > 50000) {
        return res.status(400).json({ error: true, message: 'Notas muito longas (máx. 50.000 caracteres).' });
    }
    const user = req.session.user && typeof req.session.user === 'object' ? req.session.user : null;
    const updatedBy = user ? {
        name: user.name != null ? String(user.name) : '',
        email: user.email != null ? String(user.email) : ''
    } : null;
    try {
        await firestore.collection(INFOCORE_COLLECTION).doc(SHARED_NOTES_DOC).set({
            content,
            updatedAt: FieldValue.serverTimestamp(),
            updatedBy
        }, { merge: true });
        const notes = await readSharedNotes();
        return res.json({ error: false, notes });
    } catch (e) {
        console.error(e);
        return res.status(500).json({ error: true, message: 'Erro ao salvar notas.' });
    }
});

function verifyAdmin(req, res, next) {
    if (!req.session.user) {
        return res.redirect('/login');
    }
    if (req.session.user.type !== 'admin') {
        return res.redirect('/dashboard');
    }
    next();
}

function isBudgetFinalized(row) {
    return String(row?.status || 'draft').toLowerCase() === 'finalized';
}

async function deleteCashFlowEntriesForBudget(budgetId) {
    const bid = String(budgetId || '').trim();
    if (!bid) return;
    const rows = await db.findAll({ colecao: CASH_FLOW_COLLECTION }).catch(() => []);
    const batch = firestore.batch();
    let ops = 0;
    for (const row of Array.isArray(rows) ? rows : []) {
        const cfId = row?.id != null ? String(row.id).trim() : '';
        if (!cfId || String(row.budgetId || '').trim() !== bid) continue;
        batch.delete(firestore.collection(CASH_FLOW_COLLECTION).doc(cfId));
        ops++;
    }
    if (ops > 0) await batch.commit();
}

function budgetFirestorePatchFromBuilt(built) {
    const p = built.payload;
    const patch = {
        customerId: String(p.customerId || ''),
        customerName: String(p.customerName || ''),
        customerPhone: String(p.customerPhone || ''),
        customerEmail: String(p.customerEmail || ''),
        notes: String(p.notes || ''),
        validUntil: String(p.validUntil || ''),
        items: p.items,
        subtotal: Number(p.subtotal) || 0,
        discount: Number(p.discount) || 0,
        extra: Number(p.extra) || 0,
        total: Number(p.total) || 0,
        costTotal: Number(p.costTotal) || 0,
        profit: Number.isFinite(Number(p.profit)) ? Number(p.profit) : 0,
        status: p.status === 'finalized' ? 'finalized' : 'draft',
        updatedAt: FieldValue.serverTimestamp()
    };
    if (patch.status === 'finalized') {
        patch.finalizedAt = FieldValue.serverTimestamp();
    }
    return patch;
}

async function fetchBudgetNormalized(id) {
    const snap = await firestore.collection(BUDGETS_COLLECTION).doc(id).get();
    if (!snap.exists) return null;
    return normalizeBudgetRow({ id, ...snap.data() });
}

async function getConfigsSafe() {
    const raw = await db.findOne({ colecao: 'infocore', doc: 'configs' });
    return raw && raw.error !== true ? raw : {};
}

async function readSharedNotes() {
    const snap = await firestore.collection(INFOCORE_COLLECTION).doc(SHARED_NOTES_DOC).get();
    if (!snap.exists) {
        return { content: '', updatedAt: null, updatedBy: null };
    }
    const d = snap.data() || {};
    let updatedAt = null;
    if (d.updatedAt && typeof d.updatedAt.toDate === 'function') {
        updatedAt = d.updatedAt.toDate().toISOString();
    } else if (d.updatedAt) {
        updatedAt = String(d.updatedAt);
    }
    const by = d.updatedBy && typeof d.updatedBy === 'object' ? d.updatedBy : null;
    return {
        content: d.content != null ? String(d.content) : '',
        updatedAt,
        updatedBy: by ? {
            name: by.name != null ? String(by.name) : '',
            email: by.email != null ? String(by.email) : ''
        } : null
    };
}

function renderAppShell(res, body, user) {
    res.render('layout', {
        body,
        bootstrap: body,
        appData: { user, configs: {}, cart: [] }
    });
}

app.get('/api/bootstrap/:scope', verifyLogin, async (req, res) => {
    try {
        const scope = String(req.params.scope || '').trim();
        const configs = await getConfigsSafe();

        if (scope === 'dashboard') {
            const [products, salesRows] = await Promise.all([
                loadProductsFromDb(),
                db.findAll({ colecao: SALES_COLLECTION }).catch(() => [])
            ]);
            let sales = Array.isArray(salesRows) ? salesRows.map(normalizeSaleRow) : [];
            sales.sort((a, b) => {
                const ta = new Date(a.createdAt || a.date || 0).getTime();
                const tb = new Date(b.createdAt || b.date || 0).getTime();
                return tb - ta;
            });
            return res.json({ configs, products, sales });
        }

        if (scope === 'pdv') {
            const [products, budgetRows, customers] = await Promise.all([
                loadProductsFromDb(),
                db.findAll({ colecao: BUDGETS_COLLECTION }).catch(() => []),
                loadCustomersNormalized()
            ]);
            const budgets = Array.isArray(budgetRows) ? budgetRows.map(normalizeBudgetRow) : [];
            return res.json({
                configs,
                products,
                budgets,
                customers,
                serviceChecklistTemplates: {
                    base: SERVICE_CHECKLIST_BASE,
                    byDevice: SERVICE_CHECKLIST_BY_DEVICE
                },
                serviceWorkTemplates: await loadServiceWorkTemplatesNormalized().then((t) => t.filter((x) => x.active))
            });
        }

        if (scope === 'budgets') {
            const [products, budgetRows, customers] = await Promise.all([
                loadProductsFromDb(),
                db.findAll({ colecao: BUDGETS_COLLECTION }).catch(() => []),
                loadCustomersNormalized()
            ]);
            const budgets = Array.isArray(budgetRows) ? budgetRows.map(normalizeBudgetRow) : [];
            return res.json({ configs, products, budgets, customers });
        }

        if (scope === 'stock') {
            const products = await loadProductsFromDb();
            return res.json({ configs, products });
        }

        if (scope === 'clients') {
            const [customers, budgetRows] = await Promise.all([
                loadCustomersNormalized(),
                db.findAll({ colecao: BUDGETS_COLLECTION }).catch(() => [])
            ]);
            const budgets = Array.isArray(budgetRows) ? budgetRows.map(normalizeBudgetRow) : [];
            return res.json({ configs, customers, budgets });
        }

        if (scope === 'services') {
            const [services, budgetRows, serviceWorkTemplates] = await Promise.all([
                loadServiceOrdersNormalized(),
                db.findAll({ colecao: BUDGETS_COLLECTION }).catch(() => []),
                loadServiceWorkTemplatesNormalized()
            ]);
            const budgets = Array.isArray(budgetRows) ? budgetRows.map(normalizeBudgetRow) : [];
            return res.json({ configs, services, budgets, serviceWorkTemplates });
        }

        if (scope === 'cashflow') {
            const cashFlowEntries = await loadCashFlowNormalized();
            return res.json({ configs, cashFlowEntries });
        }

        if (scope === 'config') {
            return res.json({ configs, whatsapp: whatsappClient.getStatus() });
        }

        return res.status(404).json({ error: true, message: 'Página não suportada.' });
    } catch (err) {
        console.error('bootstrap', err);
        return res.status(500).json({ error: true, message: 'Erro ao carregar dados da página.' });
    }
});

app.post('/login', async (req, res) => {
    let { email, pass } = req.body;
    let user = await db.findOne({ colecao: 'users', where: ['email', '==', email] });
    
    if (!user) {
        return res.json({ error: true, message: 'Usuário não encontrado' });
    }
    if (user.pass !== pass) {
        return res.json({ error: true, message: 'Senha incorreta' });
    }
    req.session.user = user;
    return res.json({ error: false, message: 'Login realizado com sucesso' });
});


app.get('/', async (req, res) => {
    if (req.session.user) {
        res.redirect('/dashboard')
    }else{
        return res.redirect('/login');
    }
});

app.get('/login', (req, res) => {
    if (req.session.user) {
        return res.redirect('/dashboard');
    }
    res.render('login');
});

app.get('/dashboard', verifyLogin, (req, res) => {
    renderAppShell(res, 'dashboard', req.session.user);
});

app.get('/pdv', verifyLogin, (req, res) => {
    renderAppShell(res, 'pdv', req.session.user);
});

app.get('/budgets', verifyLogin, (req, res) => {
    renderAppShell(res, 'budgets', req.session.user);
});

app.get('/stock', verifyLogin, (req, res) => {
    if (req.session.user.type !== 'admin') {
        return res.redirect('/dashboard');
    }
    renderAppShell(res, 'stock', req.session.user);
});

app.get('/services', verifyAdmin, (req, res) => {
    renderAppShell(res, 'services', req.session.user);
});

app.get('/services/:id', verifyAdmin, async (req, res) => {
    const id = String(req.params.id || '').trim();
    if (!id) return res.redirect('/services');
    const configs = await getConfigsSafe();
    const snap = await firestore.collection(SERVICE_ORDERS_COLLECTION).doc(id).get();
    if (!snap.exists) return res.redirect('/services');
    const service = normalizeServiceOrderRow({ id, ...(snap.data() || {}) });
    res.render('layout', {
        body: 'service-work',
        bootstrap: '',
        appData: { configs, user: req.session.user, service }
    });
});

app.post('/api/products', verifyLogin, uploadProductImage, async (req, res) => {
    const body = req.body || {};
    const name = String(body.name || '').trim();
    const category = String(body.category || 'others').trim() || 'others';
    const description = body.description != null ? String(body.description).trim() : '';

    if (!name) {
        return res.status(400).json({ error: true, message: 'Nome do produto é obrigatório.' });
    }

    const itemType = String(body.itemType || 'product').toLowerCase() === 'service' ? 'service' : 'product';
    const cost = parseMoneyField(body.cost);
    const partsCost = parseMoneyField(body.partsCost);
    const price = parseMoneyField(body.price);
    let qty = Number.parseInt(String(body.qty), 10) || 0;
    let min = Number.parseInt(String(body.min), 10) || 10;
    const trackStock = itemType === 'service'
        ? false
        : body.trackStock !== false && body.trackStock !== 'false';
    if (itemType === 'service') {
        qty = 0;
        min = 0;
    }
    const serviceDuration = body.serviceDuration != null ? String(body.serviceDuration).trim() : '';

    const id = randomUUID();
    const existingRows = await fetchProductRows();
    const usedSkus = new Set();
    for (const r of existingRows) {
        const c = canonicalBarcodeSku(r.sku != null ? String(r.sku).trim() : '');
        if (c) usedSkus.add(c);
    }
    let sku;
    try {
        sku = pickUnusedBarcodeSku(usedSkus);
    } catch (e) {
        console.error(e);
        return res.status(500).json({ error: true, message: 'Não foi possível gerar código do produto.' });
    }
    const image = req.file ? `/uploads/${req.file.filename}` : '';

    const payload = {
        id,
        sku,
        name,
        category,
        itemType,
        emoji: itemType === 'service' ? '🔧' : '📦',
        image,
        cost,
        partsCost,
        price,
        qty,
        min,
        trackStock,
        active: true
    };
    if (description) payload.description = description;
    if (serviceDuration) payload.serviceDuration = serviceDuration;

    try {
        await db.create(PRODUCTS_COLLECTION, id, payload);
    } catch (e) {
        console.error(e);
        return res.status(500).json({ error: true, message: 'Erro ao salvar produto.' });
    }

    return res.json({ error: false, product: normalizeProduct(payload) });
});

app.patch('/api/products/:id', verifyLogin, uploadProductImageIfMultipart, async (req, res) => {
    const id = String(req.params.id || '').trim();
    if (!id) {
        return res.status(400).json({ error: true, message: 'ID inválido.' });
    }

    const snap = await firestore.collection(PRODUCTS_COLLECTION).doc(id).get();
    if (!snap.exists) {
        return res.status(404).json({ error: true, message: 'Produto não encontrado.' });
    }

    const body = req.body || {};
    const patch = {};

    if (body.name !== undefined) {
        const nm = String(body.name).trim();
        if (!nm) {
            return res.status(400).json({ error: true, message: 'Nome inválido.' });
        }
        patch.name = nm;
    }
    if (body.category != null) patch.category = String(body.category).trim() || 'others';
    if (body.itemType != null) {
        patch.itemType = String(body.itemType).toLowerCase() === 'service' ? 'service' : 'product';
    }
    if (body.cost != null) patch.cost = parseMoneyField(body.cost);
    if (body.partsCost != null) patch.partsCost = parseMoneyField(body.partsCost);
    if (body.price != null) patch.price = parseMoneyField(body.price);
    if (body.qty != null) patch.qty = Number.parseInt(String(body.qty), 10) || 0;
    if (body.min != null) patch.min = Number.parseInt(String(body.min), 10) || 0;
    if (body.trackStock != null) {
        patch.trackStock = body.trackStock === true || body.trackStock === 'true';
    }
    if (body.serviceDuration != null) {
        patch.serviceDuration = String(body.serviceDuration).trim();
    }
    if (body.description != null) {
        const d = String(body.description).trim();
        if (d) patch.description = d;
    }
    if (body.emoji != null) patch.emoji = String(body.emoji).trim() || '📦';
    if (req.file) patch.image = `/uploads/${req.file.filename}`;

    const mergedType = patch.itemType || snap.data().itemType || 'product';
    if (String(mergedType).toLowerCase() === 'service') {
        patch.trackStock = false;
        patch.qty = 0;
        patch.min = 0;
    }

    if (Object.keys(patch).length === 0) {
        return res.status(400).json({ error: true, message: 'Nada para atualizar.' });
    }

    try {
        await db.update(PRODUCTS_COLLECTION, id, patch);
    } catch (e) {
        console.error(e);
        return res.status(500).json({ error: true, message: 'Erro ao atualizar produto.' });
    }

    const merged = { id, ...snap.data(), ...patch };
    return res.json({ error: false, product: normalizeProduct(merged) });
});

app.delete('/api/products/:id', verifyLogin, async (req, res) => {
    const id = String(req.params.id || '').trim();
    if (!id) {
        return res.status(400).json({ error: true, message: 'ID inválido.' });
    }

    const snap = await firestore.collection(PRODUCTS_COLLECTION).doc(id).get();
    if (!snap.exists) {
        return res.status(404).json({ error: true, message: 'Produto não encontrado.' });
    }

    try {
        await db.delete(PRODUCTS_COLLECTION, id);
    } catch (e) {
        console.error(e);
        return res.status(500).json({ error: true, message: 'Erro ao excluir produto.' });
    }

    return res.json({ error: false });
});

app.get('/api/budgets', verifyLogin, async (req, res) => {
    try {
        const rows = await db.findAll({ colecao: BUDGETS_COLLECTION });
        const budgets = Array.isArray(rows) ? rows.map(normalizeBudgetRow) : [];
        budgets.sort((a, b) => {
            const ad = a.updatedAt?.toMillis ? a.updatedAt.toMillis() : 0;
            const bd = b.updatedAt?.toMillis ? b.updatedAt.toMillis() : 0;
            return bd - ad;
        });
        return res.json({ error: false, budgets });
    } catch (e) {
        console.error(e);
        return res.status(500).json({ error: true, message: 'Erro ao carregar orçamentos.' });
    }
});

function autoCustomerNotesFromBudget({ code, status, validUntil, total, budgetNotes }) {
    const stLabel = status === 'finalized' ? 'finalizado' : 'rascunho';
    const lines = [
        `Cadastro automático via orçamento ${code || '—'} (${stLabel}).`,
        `Data do registro: ${new Date().toLocaleString('pt-BR')}.`
    ];
    if (validUntil) lines.push(`Validade do orçamento: ${formatDateBr(validUntil)}.`);
    if (Number(total) > 0) lines.push(`Valor do orçamento: ${moneyBr(total)}.`);
    const extra = String(budgetNotes || '').trim();
    if (extra) {
        lines.push('', 'Observações do orçamento:', extra);
    }
    return lines.join('\n');
}

async function findCustomerByContact({ name, phone, email }) {
    const rows = await db.findAll({ colecao: CUSTOMERS_COLLECTION }).catch(() => []);
    const list = Array.isArray(rows) ? rows : [];
    const phoneNorm = sanitizePhone(phone);
    const emailNorm = String(email || '').trim().toLowerCase();
    const nameNorm = String(name || '').trim().toLowerCase();

    if (phoneNorm) {
        const byPhone = list.find((c) => sanitizePhone(c.phone) === phoneNorm);
        if (byPhone) return byPhone;
    }
    if (emailNorm) {
        const byEmail = list.find((c) => String(c.email || '').trim().toLowerCase() === emailNorm);
        if (byEmail) return byEmail;
    }
    if (nameNorm) {
        const byName = list.find((c) => String(c.name || '').trim().toLowerCase() === nameNorm);
        if (byName) return byName;
    }
    return null;
}

async function resolveBudgetCustomerLink({ customerId, customerName, customerPhone, customerEmail, budgetMeta }) {
    let cid = String(customerId || '').trim();
    let name = String(customerName || '').trim();
    let phone = String(customerPhone || '').trim();
    let email = String(customerEmail || '').trim();
    let customerCreated = false;
    let customer = null;

    if (cid) {
        const snap = await firestore.collection(CUSTOMERS_COLLECTION).doc(cid).get();
        if (snap.exists) {
            const c = snap.data() || {};
            name = name || String(c.name || '').trim();
            phone = phone || String(c.phone || '').trim();
            email = email || String(c.email || '').trim();
            return { customerId: cid, customerName: name, customerPhone: phone, customerEmail: email, customerCreated, customer };
        }
        cid = '';
    }

    if (!name) {
        return { customerId: '', customerName: '', customerPhone: phone, customerEmail: email, customerCreated, customer };
    }

    const existing = await findCustomerByContact({ name, phone, email });
    if (existing) {
        const eid = existing.id != null ? String(existing.id) : '';
        return {
            customerId: eid,
            customerName: name,
            customerPhone: phone || String(existing.phone || '').trim(),
            customerEmail: email || String(existing.email || '').trim(),
            customerCreated: false,
            customer: null
        };
    }

    const newId = randomUUID();
    const autoNotes = autoCustomerNotesFromBudget(budgetMeta);
    const custPayload = {
        id: newId,
        name,
        doc: '',
        phone,
        email,
        address: '',
        notes: autoNotes,
        requests: [],
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp()
    };
    await db.create(CUSTOMERS_COLLECTION, newId, custPayload);
    customerCreated = true;
    customer = normalizeCustomerRow(custPayload, { purchases: 0, spent: 0 });
    return {
        customerId: newId,
        customerName: name,
        customerPhone: phone,
        customerEmail: email,
        customerCreated,
        customer
    };
}

async function buildBudgetRecordFromBody(body, { id, code, createdAt, prevStatus }) {
    const rawItems = Array.isArray(body.items) ? body.items : [];
    if (rawItems.length === 0) {
        return { error: true, message: 'Adicione ao menos 1 item ao orçamento.' };
    }

    let enriched;
    try {
        enriched = await enrichBudgetItemsWithCost(rawItems);
    } catch (e) {
        console.error(e);
        return { error: true, message: 'Erro ao calcular custos do orçamento.' };
    }
    const items = enriched.items;
    const subtotal = items.reduce((sum, item) => sum + (Number(item.total) || 0), 0);
    const costTotal = enriched.costTotal;

    const discount = Math.max(0, Number(body.discount) || 0);
    const extra = Math.max(0, Number(body.extra) || 0);
    const total = Math.max(0, Math.round((subtotal - discount + extra) * 100) / 100);
    let profit = Math.round((total - costTotal) * 100) / 100;
    if (!Number.isFinite(profit)) profit = 0;
    const requestedStatus = String(body.status || 'draft') === 'finalized' ? 'finalized' : 'draft';
    const status = prevStatus === 'finalized' ? 'finalized' : requestedStatus;
    const budgetCode = code || budgetDisplayCode();
    const validUntil = String(body.validUntil || body.date || '').trim();
    const notes = String(body.notes || '').trim();

    const customerLink = await resolveBudgetCustomerLink({
        customerId: body.customerId,
        customerName: body.customerName,
        customerPhone: body.customerPhone,
        customerEmail: body.customerEmail,
        budgetMeta: { code: budgetCode, status, validUntil, total, budgetNotes: notes }
    });

    const now = FieldValue.serverTimestamp();
    const serviceOrderId = body.serviceOrderId != null ? String(body.serviceOrderId).trim() : '';

    const payload = {
        id,
        code: budgetCode,
        customerId: customerLink.customerId,
        customerName: customerLink.customerName,
        customerPhone: customerLink.customerPhone,
        customerEmail: customerLink.customerEmail,
        notes,
        validUntil,
        items,
        subtotal,
        discount,
        extra,
        total,
        costTotal,
        profit,
        status,
        updatedAt: now
    };
    if (serviceOrderId) payload.serviceOrderId = serviceOrderId;
    if (createdAt != null) payload.createdAt = createdAt;
    else payload.createdAt = now;
    if (status === 'finalized') payload.finalizedAt = now;

    return {
        error: false,
        payload,
        budget: normalizeBudgetRow(payload),
        customerCreated: customerLink.customerCreated,
        customer: customerLink.customer,
        status
    };
}

app.post('/api/budgets', verifyLogin, async (req, res) => {
    const built = await buildBudgetRecordFromBody(req.body || {}, {
        id: randomUUID(),
        code: null,
        createdAt: null,
        prevStatus: null
    });
    if (built.error) {
        return res.status(400).json({ error: true, message: built.message });
    }

    try {
        await db.create(BUDGETS_COLLECTION, built.payload.id, built.payload);
        const budget = await fetchBudgetNormalized(built.payload.id);
        let notifications = null;
        let cashFlowEntry = null;
        if (built.status === 'finalized' && budget) {
            notifications = await dispatchBudgetNotifications(budget);
            cashFlowEntry = await createCashFlowFromBudget(budget);
        }
        return res.json({
            error: false,
            budget: budget || built.budget,
            notifications,
            cashFlowEntry,
            customerCreated: built.customerCreated,
            customer: built.customer
        });
    } catch (e) {
        console.error(e);
        return res.status(500).json({ error: true, message: 'Erro ao salvar orçamento.' });
    }
});

app.patch('/api/budgets/:id', verifyLogin, async (req, res) => {
    const id = String(req.params.id || '').trim();
    if (!id) return res.status(400).json({ error: true, message: 'ID inválido.' });

    const snap = await firestore.collection(BUDGETS_COLLECTION).doc(id).get();
    if (!snap.exists) {
        return res.status(404).json({ error: true, message: 'Orçamento não encontrado.' });
    }
    const prev = snap.data() || {};
    if (isBudgetFinalized(prev)) {
        return res.status(400).json({ error: true, message: 'Orçamentos finalizados não podem ser editados.' });
    }

    const built = await buildBudgetRecordFromBody(req.body || {}, {
        id,
        code: prev.code,
        createdAt: prev.createdAt,
        prevStatus: 'draft'
    });
    if (built.error) {
        return res.status(400).json({ error: true, message: built.message });
    }

    try {
        await db.update(BUDGETS_COLLECTION, id, budgetFirestorePatchFromBuilt(built));
        const budget = await fetchBudgetNormalized(id);
        return res.json({
            error: false,
            budget: budget || built.budget,
            customerCreated: built.customerCreated,
            customer: built.customer
        });
    } catch (e) {
        console.error(e);
        return res.status(500).json({ error: true, message: 'Erro ao atualizar orçamento.' });
    }
});

app.delete('/api/budgets/:id', verifyLogin, async (req, res) => {
    const id = String(req.params.id || '').trim();
    if (!id) return res.status(400).json({ error: true, message: 'ID inválido.' });

    const snap = await firestore.collection(BUDGETS_COLLECTION).doc(id).get();
    if (!snap.exists) {
        return res.status(404).json({ error: true, message: 'Orçamento não encontrado.' });
    }
    const prev = snap.data() || {};
    if (isBudgetFinalized(prev)) {
        return res.status(400).json({ error: true, message: 'Orçamentos finalizados não podem ser excluídos.' });
    }

    try {
        await firestore.collection(BUDGETS_COLLECTION).doc(id).delete();
        await deleteCashFlowEntriesForBudget(id);
        return res.json({ error: false, message: 'Orçamento excluído.' });
    } catch (e) {
        console.error(e);
        return res.status(500).json({ error: true, message: 'Erro ao excluir orçamento.' });
    }
});

app.post('/api/budgets/template', verifyLogin, (req, res) => {
    const kind = String(req.body?.kind || 'image').trim().toLowerCase();
    const budget = req.body?.budget;
    if (!budget || typeof budget !== 'object') {
        return res.status(400).json({ error: true, message: 'Orçamento inválido para template.' });
    }
    try {
        if (kind === 'whatsapp' || kind === 'email') {
            const html = renderBudgetTemplateText(kind, budget, req);
            return res.json({ error: false, html });
        }
        if (kind !== 'image' && kind !== 'pdf') {
            return res.status(400).json({ error: true, message: 'Tipo de template inválido.' });
        }
        const html = renderBudgetTemplateHtml(kind, budget, req);
        return res.json({ error: false, html });
    } catch (e) {
        console.error(e);
        return res.status(500).json({ error: true, message: 'Erro ao gerar template.' });
    }
});

app.patch('/api/budgets/:id/finalize', verifyLogin, async (req, res) => {
    const id = String(req.params.id || '').trim();
    if (!id) return res.status(400).json({ error: true, message: 'ID inválido.' });
    try {
        const snap = await firestore.collection(BUDGETS_COLLECTION).doc(id).get();
        if (!snap.exists) return res.status(404).json({ error: true, message: 'Orçamento não encontrado.' });
        const prev = snap.data() || {};
        const enriched = await enrichBudgetItemsWithCost(Array.isArray(prev.items) ? prev.items : []);
        const total = Number(prev.total) || 0;
        const costTotal = enriched.costTotal;
        let profit = Math.round((total - costTotal) * 100) / 100;
        if (!Number.isFinite(profit)) profit = 0;
        const patch = {
            status: 'finalized',
            items: enriched.items,
            costTotal,
            profit,
            updatedAt: FieldValue.serverTimestamp(),
            finalizedAt: FieldValue.serverTimestamp()
        };
        await db.update(BUDGETS_COLLECTION, id, patch);
        const budget = await fetchBudgetNormalized(id);
        if (!budget) {
            return res.status(500).json({ error: true, message: 'Erro ao carregar orçamento finalizado.' });
        }
        const notifications = await dispatchBudgetNotifications(budget);
        const cashFlowEntry = await createCashFlowFromBudget(budget);
        return res.json({ error: false, budget, notifications, cashFlowEntry });
    } catch (e) {
        console.error(e);
        return res.status(500).json({ error: true, message: 'Erro ao finalizar orçamento.' });
    }
});
const MP_TOKEN = process.env.MERCADOPAGO_ACCESS_TOKEN;
const MP_DEVICE_ID = process.env.MERCADOPAGO_DEVICE_ID || "PAX_Q92__Q92-1733817193";
const MP_ENABLED = Boolean(MP_TOKEN && MP_DEVICE_ID);
const MP_QR_EXTERNAL_POS_ID = process.env.MERCADOPAGO_QR_EXTERNAL_POS_ID
    ? String(process.env.MERCADOPAGO_QR_EXTERNAL_POS_ID).trim()
    : '';
const MP_QR_MODE_RAW = (process.env.MERCADOPAGO_QR_MODE || 'dynamic').toLowerCase();
const MP_QR_MODE = ['static', 'dynamic', 'hybrid'].includes(MP_QR_MODE_RAW) ? MP_QR_MODE_RAW : 'dynamic';

const api = axios.create({
    baseURL: "https://api.mercadopago.com",
    headers: { Authorization: `Bearer ${MP_TOKEN}`, "Content-Type": "application/json" },
});

const POINT_PAYMENT_TYPE_MAP = {
    credit_card: 'credit_card',
    debit_card: 'debit_card',
    pix: 'bank_transfer'
};
const POINT_FINAL_STATUSES = new Set(['processed', 'canceled', 'expired', 'failed']);
const POINT_FAILURE_REASON = {
    canceled: 'Pagamento cancelado na maquininha.',
    expired: 'Tempo para pagamento expirou na maquininha.',
    failed: 'Falha ao processar pagamento na maquininha.'
};

let cachedPointTerminal = null;
let activePointOrderId = null;
const pendingPointSales = new Map();
const PIX_PENDING_STATUSES = new Set(['pending', 'in_process']);
const MP_TERMINAL_BUSY_CODES = new Set([
    'already_queued_order_on_terminal',
    'property_value',
    'terminal_busy'
]);

let pointPaymentLock = Promise.resolve();

function withPointPaymentLock(task) {
    const run = pointPaymentLock.then(() => task());
    pointPaymentLock = run.catch(() => {});
    return run;
}

function getMpErrorCode(err) {
    return String(err?.response?.data?.errors?.[0]?.code || '').trim();
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function toMoneyAmount(value) {
    return fromCents(toCents(value)).toFixed(2);
}

async function resolvePointTerminalId() {
    if (cachedPointTerminal) return cachedPointTerminal.id;
    const { data: res } = await api.get('/terminals/v1/list?limit=50&offset=0');
    const terminals = Array.isArray(res?.data?.terminals) ? res.data.terminals : [];
    if (terminals.length === 0) throw new Error('Nenhum terminal Mercado Pago encontrado.');

    const byDevice = terminals.find((t) =>
        String(t?.device_id || '') === String(MP_DEVICE_ID)
        || String(t?.id || '') === String(MP_DEVICE_ID)
    );
    const terminal = byDevice || terminals[0];
    cachedPointTerminal = terminal;
    return terminal.id;
}

function formatMpAxiosError(err) {
    const data = err?.response?.data;
    if (data && typeof data === 'object') {
        const first = Array.isArray(data.errors) ? data.errors[0] : null;
        if (first?.details) {
            return { ...data, detailsExpanded: first.details };
        }
        return data;
    }
    const status = err?.response?.status;
    const raw = typeof data === 'string' ? data.replace(/\s+/g, ' ').trim().slice(0, 240) : String(err?.message || err);
    return { status, message: raw };
}

async function fetchMpOrderSafe(orderId) {
    if (!orderId) return null;
    try {
        const { data } = await api.get(`/v1/orders/${orderId}`);
        return data;
    } catch {
        return null;
    }
}

async function isMpOrderFinished(orderId) {
    const order = await fetchMpOrderSafe(orderId);
    return !order || POINT_FINAL_STATUSES.has(order?.status);
}

async function waitForMpOrdersIdle(orderIds, maxMs = 20000) {
    const ids = [...new Set((orderIds || []).filter(Boolean))];
    if (!ids.length) return;
    const deadline = Date.now() + maxMs;
    while (Date.now() < deadline) {
        let allDone = true;
        for (const orderId of ids) {
            const order = await fetchMpOrderSafe(orderId);
            if (order && !POINT_FINAL_STATUSES.has(order.status)) {
                allDone = false;
                break;
            }
        }
        if (allDone) {
            await syncActivePointOrderTracking(ids);
            return;
        }
        await sleep(800);
    }
}

async function postCancelMpOrder(orderId, extraHeaders = {}) {
    await api.post(
        `/v1/orders/${orderId}/cancel`,
        {},
        { headers: { 'X-Idempotency-Key': randomUUID(), ...extraHeaders } }
    );
}

async function releaseActivePointPayment() {
    return withPointPaymentLock(async () => {
        await cancelAllKnownPendingSales();
        return { error: false };
    });
}

async function cancelPointOrder(orderId) {
    if (!orderId) return;
    try {
        await postCancelMpOrder(orderId);
    } catch (err) {
        const status = err?.response?.status;
        const code = getMpErrorCode(err);
        if (status === 404 || code === 'order_already_canceled') return;
        if (await isMpOrderFinished(orderId)) return;

        if (status === 409 && code === 'cannot_cancel_order') {
            try {
                await postCancelMpOrder(orderId, { 'x-allow-cancelable-status': 'at_terminal' });
                return;
            } catch (err2) {
                const code2 = getMpErrorCode(err2);
                if (code2 === 'order_already_canceled' || await isMpOrderFinished(orderId)) return;
                throw err2;
            }
        }

        throw err;
    }
}

async function cancelQrStoreOrder(orderId) {
    if (!orderId) return;
    try {
        await postCancelMpOrder(orderId);
    } catch (err) {
        const status = err?.response?.status;
        const code = getMpErrorCode(err);
        if (status === 404 || code === 'order_already_canceled') return;
        if (await isMpOrderFinished(orderId)) return;
        throw err;
    }
}

async function syncActivePointOrderTracking(orderIds = []) {
    let stillActiveId = null;
    for (const orderId of orderIds) {
        const order = await fetchMpOrderSafe(orderId);
        if (order && !POINT_FINAL_STATUSES.has(order.status)) {
            stillActiveId = orderId;
        }
    }
    if (stillActiveId) {
        activePointOrderId = stillActiveId;
        return;
    }
    if (!orderIds.length || !activePointOrderId || orderIds.includes(activePointOrderId)) {
        activePointOrderId = null;
    }
}

async function cancelAnyPendingPointOrder() {
    if (!activePointOrderId) return;
    const orderId = activePointOrderId;
    try {
        await cancelPointOrder(orderId);
    } catch (e) {
        console.error('Falha ao cancelar order ativa:', formatMpAxiosError(e));
    }
    await syncActivePointOrderTracking([orderId]);
}

async function cancelAllKnownPendingSales() {
    const pointOrderIds = new Set();
    const qrOrderIds = new Set();
    if (activePointOrderId) pointOrderIds.add(activePointOrderId);
    for (const pending of pendingPointSales.values()) {
        if (pending?.mode === 'point' && pending?.pointOrderId) {
            pointOrderIds.add(pending.pointOrderId);
        }
        if (pending?.mode === 'mp_qr_instore' && pending?.qrOrderId) {
            qrOrderIds.add(pending.qrOrderId);
        }
    }
    for (const orderId of pointOrderIds) {
        try {
            await cancelPointOrder(orderId);
        } catch (e) {
            console.error('Falha ao cancelar order pendente:', formatMpAxiosError(e));
        }
    }
    for (const orderId of qrOrderIds) {
        try {
            await cancelQrStoreOrder(orderId);
        } catch (e) {
            console.error('Falha ao cancelar order QR loja:', formatMpAxiosError(e));
        }
    }
    await waitForMpOrdersIdle([...pointOrderIds, ...qrOrderIds]);
    pendingPointSales.clear();
    await syncActivePointOrderTracking([...pointOrderIds, ...qrOrderIds]);
}

function extractPointReason(order) {
    const payment = Array.isArray(order?.transactions?.payments) ? order.transactions.payments[0] : null;
    return (
        payment?.status_detail
        || payment?.status
        || order?.status_detail
        || POINT_FAILURE_REASON[order?.status]
        || 'Pagamento não aprovado pela maquininha.'
    );
}

async function waitPointOrderFinal(orderId) {
    for (let i = 0; i < 45; i++) {
        await sleep(2000);
        const { data: order } = await api.get(`/v1/orders/${orderId}`);
        if (POINT_FINAL_STATUSES.has(order?.status)) return order;
    }
    throw new Error('Tempo limite aguardando confirmação da maquininha.');
}

async function postPointOrder(payload) {
    return api.post('/v1/orders', payload, { headers: { 'X-Idempotency-Key': randomUUID() } });
}

async function createPointOrder({ amount, payment, saleCode, installments = 1 }) {
    return withPointPaymentLock(() => createPointOrderUnlocked({ amount, payment, saleCode, installments }));
}

async function createPointOrderUnlocked({ amount, payment, saleCode, installments = 1 }) {
    if (!MP_ENABLED) {
        throw new Error('Mercado Pago não configurado. Defina MERCADOPAGO_ACCESS_TOKEN e MERCADOPAGO_DEVICE_ID.');
    }
    const defaultType = POINT_PAYMENT_TYPE_MAP[payment];
    if (!defaultType && payment !== 'pix') throw new Error('Forma de pagamento não suportada na maquininha.');

    await cancelAllKnownPendingSales();
    const terminalId = await resolvePointTerminalId();
    const payload = {
        type: 'point',
        external_reference: saleCode,
        description: `Venda ${saleCode}`,
        expiration_time: 'PT10M',
        transactions: { payments: [{ amount: toMoneyAmount(amount) }] },
        config: {
            point: { terminal_id: terminalId, print_on_terminal: 'seller_ticket' }
        }
    };
    if (defaultType) {
        const installmentCount = defaultType === 'credit_card'
            ? Math.min(12, Math.max(1, Number.parseInt(String(installments), 10) || 1))
            : 1;
        const paymentMethod = { default_type: defaultType, default_installments: installmentCount };
        if (defaultType === 'credit_card') {
            paymentMethod.installments_cost = 'buyer';
        }
        payload.config.payment_method = paymentMethod;
    }

    const tryCreate = async () => {
        const { data } = await postPointOrder(payload);
        return data;
    };

    let createdOrder;
    let lastErr;
    const maxAttempts = 4;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        if (attempt > 0) {
            await cancelAllKnownPendingSales();
            await sleep(600 + attempt * 700);
        }
        try {
            createdOrder = await tryCreate();
            lastErr = null;
            break;
        } catch (err) {
            lastErr = err;
            const code = getMpErrorCode(err);
            if (payment === 'pix' && payload.config.payment_method) {
                delete payload.config.payment_method;
                continue;
            }
            const pm = payload.config?.payment_method;
            if (code === 'property_value' && pm?.installments_cost) {
                delete pm.installments_cost;
                continue;
            }
            if (!MP_TERMINAL_BUSY_CODES.has(code)) throw err;
        }
    }
    if (!createdOrder) throw lastErr || new Error('Falha ao criar cobrança na maquininha.');

    activePointOrderId = createdOrder.id;
    return createdOrder;
}

async function getPointOrderStatus(orderId) {
    const { data: order } = await api.get(`/v1/orders/${orderId}`);
    if (POINT_FINAL_STATUSES.has(order?.status)) {
        activePointOrderId = null;
    }
    return order;
}

async function processPointPayment({ amount, payment, saleCode }) {
    const createdOrder = await createPointOrder({ amount, payment, saleCode });
    const finalOrder = await waitPointOrderFinal(createdOrder.id);
    activePointOrderId = null;
    return finalOrder;
}

async function qrEmvToPngBase64(emv) {
    if (!emv) return '';
    const buf = await QRCode.toBuffer(String(emv), {
        type: 'png',
        margin: 2,
        width: 320,
        errorCorrectionLevel: 'M'
    });
    return buf.toString('base64');
}

async function createInstoreQrOrder({ amount, saleCode, saleId }) {
    if (!MP_TOKEN) {
        throw new Error('Mercado Pago não configurado. Defina MERCADOPAGO_ACCESS_TOKEN.');
    }
    if (!MP_QR_EXTERNAL_POS_ID) {
        throw new Error('QR de loja/caixa não configurado. Defina MERCADOPAGO_QR_EXTERNAL_POS_ID (external_id do caixa).');
    }
    await cancelAllKnownPendingSales();
    const amtStr = toMoneyAmount(amount);
    const externalReference = String(saleId || saleCode || randomUUID()).slice(0, 64);
    const payload = {
        type: 'qr',
        total_amount: amtStr,
        description: `Venda ${saleCode}`.slice(0, 150),
        external_reference: externalReference,
        expiration_time: 'PT15M',
        config: {
            qr: {
                external_pos_id: MP_QR_EXTERNAL_POS_ID,
                mode: MP_QR_MODE
            }
        },
        transactions: {
            payments: [{ amount: amtStr }]
        }
    };
    const { data: createdOrder } = await api.post('/v1/orders', payload, {
        headers: { "X-Idempotency-Key": randomUUID() }
    });
    const qrData = createdOrder?.type_response?.qr_data ? String(createdOrder.type_response.qr_data) : '';
    let qrBase64 = '';
    if (qrData) {
        qrBase64 = await qrEmvToPngBase64(qrData);
    }
    return { order: createdOrder, qrData, qrBase64 };
}

async function createOnlinePixPayment({ amount, saleCode }) {
    await cancelAllKnownPendingSales();
    const payerEmail = process.env.MERCADOPAGO_PIX_PAYER_EMAIL || 'fernandoj132sj@gmail.com';
    const payload = {
        transaction_amount: fromCents(toCents(amount)),
        description: `Venda ${saleCode}`,
        payment_method_id: 'pix',
        external_reference: saleCode,
        payer: { email: payerEmail }
    };
    const { data } = await api.post('/v1/payments', payload, { headers: { "X-Idempotency-Key": randomUUID() } });
    return data;
}

async function getOnlinePixPaymentStatus(paymentId) {
    const { data } = await api.get(`/v1/payments/${paymentId}`);
    return data;
}

async function finalizeSaleInDb({ saleId, saleRecord, stockUpdates }) {
    const financials = await enrichSaleRecordFinancials(saleRecord);
    const enrichedRecord = {
        ...saleRecord,
        items: financials.items,
        costTotal: financials.costTotal,
        profit: financials.profit
    };

    const batch = firestore.batch();
    const saleRef = firestore.collection(SALES_COLLECTION).doc(saleId);
    batch.set(saleRef, enrichedRecord);

    const updatedProducts = [];
    for (const u of stockUpdates) {
        const ref = firestore.collection(PRODUCTS_COLLECTION).doc(u.id);
        batch.update(ref, { qty: u.nextQty });
        updatedProducts.push(normalizeProduct({ ...u.p, id: u.id, qty: u.nextQty }));
    }

    const cfPayload = buildCashFlowPayloadFromSale(saleId, enrichedRecord);
    const cfRef = firestore.collection(CASH_FLOW_COLLECTION).doc(cfPayload.id);
    batch.set(cfRef, cfPayload);

    await batch.commit();
    const cashFlowEntry = normalizeCashFlowRow({
        ...cfPayload,
        createdAt: new Date().toISOString()
    });
    return { updatedProducts, cashFlowEntry };
}

app.post('/api/sales', verifyLogin, async (req, res) => {
    const body = req.body || {};
    const rawItems = Array.isArray(body.items) ? body.items : [];
    if (rawItems.length === 0) {
        return res.status(400).json({ error: true, message: 'Nenhum item na venda.' });
    }

    const payment = normalizePaymentKey(body.payment);
    if (!PAYMENT_KEYS.has(payment)) {
        return res.status(400).json({ error: true, message: 'Forma de pagamento inválida.' });
    }

    let creditInstallments = 1;
    if (payment === 'credit_card') {
        const parsed = Number.parseInt(String(body.installments ?? body.creditInstallments ?? 1), 10);
        if (Number.isFinite(parsed) && parsed >= 1 && parsed <= 12) creditInstallments = parsed;
    }

    const discountAdj = parseAdjustment(body, 'discount');
    const extraAdj = parseAdjustment(body, 'extra');
    const clientLabel = body.client != null ? String(body.client).trim() : '';
    const client = clientLabel || 'Balcão';

    const allowInsufficientStock = body.allowInsufficientStock === true;
    const resolvedItems = [];
    const stockUpdates = [];
    let subtotalCents = 0;
    let costTotalCents = 0;

    for (const row of rawItems) {
        const isCustom = row.custom === true || String(row.id || '').startsWith('custom:');
        const qty = parsePositiveInt(row.qty);
        if (!qty) {
            return res.status(400).json({ error: true, message: 'Quantidade inválida no carrinho.' });
        }

        if (isCustom) {
            const name = String(row.name || '').trim();
            const price = parseMoneyField(row.price) ?? Number(row.price) ?? 0;
            if (!name) {
                return res.status(400).json({ error: true, message: 'Nome do item personalizado é obrigatório.' });
            }
            if (!Number.isFinite(price) || price < 0) {
                return res.status(400).json({ error: true, message: 'Preço do item personalizado inválido.' });
            }
            const lineTotal = lineCostFromUnit(price, qty);
            const customId = String(row.id || '').trim() || `custom:${randomUUID()}`;
            subtotalCents += toCents(lineTotal);
            resolvedItems.push({
                id: customId,
                sku: '',
                name,
                category: 'custom',
                custom: true,
                price,
                cost: 0,
                qty,
                lineTotal,
                lineCost: 0
            });
            continue;
        }

        const id = String(row.id || '').trim();
        if (!id) {
            return res.status(400).json({ error: true, message: 'Item inválido no carrinho.' });
        }

        const snap = await firestore.collection(PRODUCTS_COLLECTION).doc(id).get();
        if (!snap.exists) {
            return res.status(400).json({ error: true, message: `Produto não encontrado (${id}).` });
        }
        const p = snap.data();
        if (p.active === false) {
            return res.status(400).json({ error: true, message: `Produto inativo: ${p.name || id}.` });
        }
        const tracksStock = productTracksStock(p);
        const stock = Number.parseInt(String(p.qty), 10) || 0;
        if (tracksStock && stock < qty && !allowInsufficientStock) {
            return res.status(400).json({
                error: true,
                stockInsufficient: true,
                message: `Estoque insuficiente para "${p.name || 'produto'}". Disponível: ${stock}.`
            });
        }
        const price = parseMoneyField(p.price) || Number(p.price) || 0;
        const cost = productUnitCost(p);
        const lineTotal = lineCostFromUnit(price, qty);
        const lineCost = lineCostFromUnit(cost, qty);
        subtotalCents += toCents(lineTotal);
        costTotalCents += toCents(lineCost);
        const nextQty = tracksStock ? stock - qty : stock;
        resolvedItems.push({
            id,
            sku: p.sku != null ? String(p.sku) : '',
            name: p.name != null ? String(p.name) : '',
            category: p.category != null ? String(p.category) : '',
            itemType: p.itemType != null ? String(p.itemType) : 'product',
            price,
            cost: productUnitCost(p),
            qty,
            lineTotal,
            lineCost
        });
        if (tracksStock) stockUpdates.push({ id, nextQty, p });
    }

    const subtotal = fromCents(subtotalCents);
    const costTotal = fromCents(costTotalCents);
    const { discountAmount, extraAmount, total } = computeSaleAmounts(subtotal, discountAdj, extraAdj);
    const profit = Math.round((total - costTotal) * 100) / 100;

    const saleId = randomUUID();
    const code = saleDisplayCode();
    const user = req.session.user && typeof req.session.user === 'object' ? req.session.user : null;

    const saleRecord = {
        id: saleId,
        code,
        client,
        payment,
        items: resolvedItems,
        adjustments: {
            discount: { type: discountAdj.type, value: discountAdj.value, amount: discountAmount },
            extra: { type: extraAdj.type, value: extraAdj.value, amount: extraAmount }
        },
        subtotal,
        discount: discountAmount,
        extra: extraAmount,
        total,
        costTotal,
        profit,
        createdAt: FieldValue.serverTimestamp()
    };

    if (payment === 'credit_card') {
        saleRecord.creditInstallments = creditInstallments;
        saleRecord.installmentsCost = 'buyer';
    }

    let pointPaymentInfo = null;
    if (payment === 'money') {
        const raw = body.cashReceived;
        const str = raw == null ? '' : String(raw).trim();
        let receivedRounded;
        let changeRounded;
        if (str === '') {
            receivedRounded = Math.round(total * 100) / 100;
            changeRounded = 0;
        } else {
            const rawReceived = Number(raw);
            if (!Number.isFinite(rawReceived) || rawReceived <= 0) {
                return res.status(400).json({ error: true, message: 'Valor recebido inválido.' });
            }
            receivedRounded = Math.round(rawReceived * 100) / 100;
            if (receivedRounded + 1e-6 < total) {
                return res.status(400).json({ error: true, message: 'Valor recebido menor que o total da venda.' });
            }
            changeRounded = Math.round((receivedRounded - total) * 100) / 100;
        }
        saleRecord.cashReceived = receivedRounded;
        saleRecord.change = changeRounded;
    } else if (payment === 'pix') {
        const pendingToken = randomUUID();
        if (MP_QR_EXTERNAL_POS_ID) {
            let qrResult;
            try {
                qrResult = await createInstoreQrOrder({ amount: total, saleCode: code, saleId });
            } catch (e) {
                const details = e?.response?.data?.errors?.[0]?.details;
                console.error('Falha Mercado Pago QR loja:', e?.response?.data || e);
                return res.status(502).json({
                    error: true,
                    message: e.message || 'Falha ao gerar cobrança PIX (QR loja).',
                    payment: {
                        provider: 'mercado_pago_qr_instore',
                        approved: false,
                        reason: 'Erro ao criar pedido QR da loja.',
                        details: Array.isArray(details) ? details.join(' | ') : undefined
                    }
                });
            }
            const qrOrder = qrResult.order;
            pendingPointSales.set(pendingToken, {
                mode: 'mp_qr_instore',
                saleId,
                saleRecord,
                stockUpdates,
                resolvedItems,
                discountAmount,
                extraAmount,
                subtotal,
                total,
                client,
                payment,
                code,
                qrOrderId: qrOrder?.id || null,
                qrData: qrResult.qrData || '',
                qrBase64: qrResult.qrBase64 || '',
                createdAtMs: Date.now()
            });
            return res.json({
                error: false,
                pending: true,
                token: pendingToken,
                payment: {
                    provider: 'mercado_pago_qr_instore',
                    status: qrOrder?.status || 'created',
                    orderId: qrOrder?.id || null,
                    qrData: qrResult.qrData || '',
                    qrBase64: qrResult.qrBase64 || '',
                    qrTicketUrl: ''
                }
            });
        }
        let pixPayment;
        try {
            pixPayment = await createOnlinePixPayment({ amount: total, saleCode: code });
        } catch (e) {
            const details = e?.response?.data?.errors?.[0]?.details;
            console.error('Falha Mercado Pago PIX:', e?.response?.data || e);
            return res.status(502).json({
                error: true,
                message: e.message || 'Falha ao gerar PIX online.',
                payment: {
                    provider: 'mercado_pago_pix_online',
                    approved: false,
                    reason: 'Erro ao gerar QR Code PIX.',
                    details: Array.isArray(details) ? details.join(' | ') : undefined
                }
            });
        }
        pendingPointSales.set(pendingToken, {
            mode: 'pix_online',
            saleId,
            saleRecord,
            stockUpdates,
            resolvedItems,
            discountAmount,
            extraAmount,
            subtotal,
            total,
            client,
            payment,
            code,
            pixPaymentId: pixPayment?.id || null,
            createdAtMs: Date.now()
        });
        return res.json({
            error: false,
            pending: true,
            token: pendingToken,
            payment: {
                provider: 'mercado_pago_pix_online',
                status: pixPayment?.status || 'pending',
                paymentId: pixPayment?.id || null,
                qrData: pixPayment?.point_of_interaction?.transaction_data?.qr_code || '',
                qrBase64: pixPayment?.point_of_interaction?.transaction_data?.qr_code_base64 || '',
                qrTicketUrl: pixPayment?.point_of_interaction?.transaction_data?.ticket_url || ''
            }
        });
    } else {
        let pointOrder;
        try {
            pointOrder = await createPointOrder({
                amount: total,
                payment,
                saleCode: code,
                installments: creditInstallments
            });
        } catch (e) {
            const mpErr = e?.response?.data?.errors?.[0];
            const details = mpErr?.details;
            console.error('Falha Mercado Pago:', e?.response?.data || e);
            const detailsText = Array.isArray(details)
                ? details.map((d) => (typeof d === 'string' ? d : JSON.stringify(d))).join(' | ')
                : undefined;
            return res.status(502).json({
                error: true,
                message: e.message || 'Falha ao comunicar com a maquininha. Tente novamente em alguns segundos.',
                payment: {
                    provider: 'mercado_pago_point',
                    approved: false,
                    reason: 'Erro de comunicação com a maquininha.',
                    details: detailsText
                }
            });
        }
        const pendingToken = randomUUID();
        pendingPointSales.set(pendingToken, {
            mode: 'point',
            saleId,
            saleRecord,
            stockUpdates,
            resolvedItems,
            discountAmount,
            extraAmount,
            subtotal,
            total,
            client,
            payment,
            code,
            pointOrderId: pointOrder?.id || null,
            createdAtMs: Date.now()
        });
        return res.json({
            error: false,
            pending: true,
            token: pendingToken,
            payment: {
                provider: 'mercado_pago_point',
                status: pointOrder?.status || 'created',
                orderId: pointOrder?.id || null,
                qrData: pointOrder?.point_of_interaction?.transaction_data?.qr_code || '',
                qrBase64: pointOrder?.point_of_interaction?.transaction_data?.qr_code_base64 || ''
            }
        });
    }


    if (user && (user.name || user.email)) {
        saleRecord.cashier = {
            name: user.name != null ? String(user.name) : '',
            email: user.email != null ? String(user.email) : ''
        };
    }

    let updatedProducts = [];
    let cashFlowEntry = null;
    try {
        const finalized = await finalizeSaleInDb({ saleId, saleRecord, stockUpdates });
        updatedProducts = finalized.updatedProducts;
        cashFlowEntry = finalized.cashFlowEntry;
    } catch (e) {
        console.error(e);
        return res.status(500).json({ error: true, message: 'Erro ao registrar venda no banco.' });
    }

    const createdAtIso = new Date().toISOString();
    const saleResponse = {
        id: saleId,
        code,
        date: createdAtIso,
        client,
        payment,
        items: resolvedItems.map((i) => ({
            id: i.id,
            name: i.name,
            category: i.category,
            price: i.price,
            qty: i.qty
        })),
        discount: discountAmount,
        extra: extraAmount,
        subtotal,
        total,
        adjustments: saleRecord.adjustments
    };
    if (saleRecord.cashReceived != null) saleResponse.cashReceived = saleRecord.cashReceived;
    if (saleRecord.change != null) saleResponse.change = saleRecord.change;

    if (pointPaymentInfo) saleResponse.payment = pointPaymentInfo;
    return res.json({ error: false, sale: saleResponse, products: updatedProducts, cashFlowEntry });
});

app.get('/api/sales/pending/:token', verifyLogin, async (req, res) => {
    const token = String(req.params.token || '').trim();
    const pending = pendingPointSales.get(token);
    if (!pending) {
        return res.status(404).json({ error: true, message: 'Pagamento pendente não encontrado.' });
    }

    try {
        if (pending.mode === 'pix_online') {
            const pix = await getOnlinePixPaymentStatus(pending.pixPaymentId);
            const pixStatus = String(pix?.status || '');
            if (PIX_PENDING_STATUSES.has(pixStatus)) {
                return res.json({
                    error: false,
                    pending: true,
                    payment: {
                        provider: 'mercado_pago_pix_online',
                        status: pixStatus,
                        paymentId: pending.pixPaymentId,
                        qrData: pix?.point_of_interaction?.transaction_data?.qr_code || '',
                        qrBase64: pix?.point_of_interaction?.transaction_data?.qr_code_base64 || '',
                        qrTicketUrl: pix?.point_of_interaction?.transaction_data?.ticket_url || ''
                    }
                });
            }
            if (pixStatus !== 'approved') {
                const reason = String(pix?.status_detail || 'Pagamento PIX não aprovado.');
                pendingPointSales.delete(token);
                return res.status(400).json({
                    error: true,
                    pending: false,
                    message: `Pagamento não aprovado (${pixStatus || 'sem status'}).`,
                    payment: {
                        provider: 'mercado_pago_pix_online',
                        approved: false,
                        status: pixStatus,
                        reason,
                        paymentId: pending.pixPaymentId
                    }
                });
            }
        } else if (pending.mode === 'mp_qr_instore') {
            const order = await getPointOrderStatus(pending.qrOrderId);
            const status = String(order?.status || '');
            if (!POINT_FINAL_STATUSES.has(status)) {
                return res.json({
                    error: false,
                    pending: true,
                    payment: {
                        provider: 'mercado_pago_qr_instore',
                        status,
                        orderId: pending.qrOrderId,
                        qrData: pending.qrData || '',
                        qrBase64: pending.qrBase64 || ''
                    }
                });
            }
            if (status !== 'processed') {
                const reason = extractPointReason(order);
                pendingPointSales.delete(token);
                return res.status(400).json({
                    error: true,
                    pending: false,
                    message: `Pagamento não aprovado (${status || 'sem status'}).`,
                    payment: {
                        provider: 'mercado_pago_qr_instore',
                        approved: false,
                        status,
                        reason,
                        orderId: pending.qrOrderId
                    }
                });
            }
        } else {
            const order = await getPointOrderStatus(pending.pointOrderId);
            const status = String(order?.status || '');
            if (!POINT_FINAL_STATUSES.has(status)) {
                return res.json({
                    error: false,
                    pending: true,
                    payment: {
                        provider: 'mercado_pago_point',
                        status,
                        orderId: pending.pointOrderId,
                        qrData: order?.point_of_interaction?.transaction_data?.qr_code || '',
                        qrBase64: order?.point_of_interaction?.transaction_data?.qr_code_base64 || ''
                    }
                });
            }

            if (status !== 'processed') {
                const reason = extractPointReason(order);
                pendingPointSales.delete(token);
                return res.status(400).json({
                    error: true,
                    pending: false,
                    message: `Pagamento não aprovado (${status || 'sem status'}).`,
                    payment: {
                        provider: 'mercado_pago_point',
                        approved: false,
                        status,
                        reason,
                        orderId: pending.pointOrderId
                    }
                });
            }
        }

        const successPayment = pending.mode === 'pix_online'
            ? { provider: 'mercado_pago_pix_online', approved: true, status: 'approved', paymentId: pending.pixPaymentId }
            : pending.mode === 'mp_qr_instore'
                ? { provider: 'mercado_pago_qr_instore', approved: true, status: 'processed', orderId: pending.qrOrderId }
                : { provider: 'mercado_pago_point', approved: true, status: 'processed', orderId: pending.pointOrderId };

        if (pending.mode === 'point') {
            pending.saleRecord.paymentGateway = {
                provider: 'mercado_pago_point',
                status: successPayment.status,
                orderId: pending.pointOrderId
            };
        } else if (pending.mode === 'mp_qr_instore') {
            pending.saleRecord.paymentGateway = {
                provider: 'mercado_pago_qr_instore',
                status: successPayment.status,
                orderId: pending.qrOrderId
            };
        } else {
            pending.saleRecord.paymentGateway = {
                provider: 'mercado_pago_pix_online',
                status: successPayment.status,
                paymentId: pending.pixPaymentId
            };
        }

        if (pending.saleRecord.cashier == null) {
            const user = req.session.user && typeof req.session.user === 'object' ? req.session.user : null;
            if (user && (user.name || user.email)) {
                pending.saleRecord.cashier = {
                    name: user.name != null ? String(user.name) : '',
                    email: user.email != null ? String(user.email) : ''
                };
            }
        }

        const { updatedProducts, cashFlowEntry } = await finalizeSaleInDb({
            saleId: pending.saleId,
            saleRecord: pending.saleRecord,
            stockUpdates: pending.stockUpdates
        });
        pendingPointSales.delete(token);

        const saleResponse = {
            id: pending.saleId,
            code: pending.code,
            date: new Date().toISOString(),
            client: pending.client,
            payment: pending.payment,
            items: pending.resolvedItems.map((i) => ({
                id: i.id,
                name: i.name,
                category: i.category,
                price: i.price,
                qty: i.qty
            })),
            discount: pending.discountAmount,
            extra: pending.extraAmount,
            subtotal: pending.subtotal,
            total: pending.total,
            adjustments: pending.saleRecord.adjustments,
            paymentGateway: pending.saleRecord.paymentGateway
        };
        return res.json({
            error: false,
            pending: false,
            sale: saleResponse,
            products: updatedProducts,
            payment: successPayment,
            cashFlowEntry
        });
    } catch (e) {
        console.error('Falha ao verificar pagamento pendente:', e?.response?.data || e);
        return res.status(502).json({
            error: true,
            pending: true,
            message: 'Erro ao consultar status do pagamento.'
        });
    }
});

app.get('/api/customers', verifyLogin, async (req, res) => {
    try {
        const customers = await loadCustomersNormalized();
        return res.json({ error: false, customers });
    } catch (e) {
        console.error(e);
        return res.status(500).json({ error: true, message: 'Erro ao carregar clientes.' });
    }
});

app.post('/api/customers', verifyLogin, async (req, res) => {
    const body = req.body || {};
    const name = String(body.name || '').trim();
    if (!name) {
        return res.status(400).json({ error: true, message: 'Nome do cliente é obrigatório.' });
    }

    const id = randomUUID();
    const requests = Array.isArray(body.requests) ? body.requests.map(normalizeCustomerRequest) : [];

    const payload = {
        id,
        name,
        doc: String(body.doc || '').trim(),
        phone: String(body.phone || '').trim(),
        email: String(body.email || '').trim(),
        address: String(body.address || '').trim(),
        notes: String(body.notes || '').trim(),
        requests,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp()
    };

    try {
        await db.create(CUSTOMERS_COLLECTION, id, payload);
    } catch (e) {
        console.error(e);
        return res.status(500).json({ error: true, message: 'Erro ao criar cliente.' });
    }

    let sales = [];
    try {
        sales = await db.findAll({ colecao: SALES_COLLECTION });
    } catch {
        sales = [];
    }
    const saleMap = salesTotalsByClientKey(Array.isArray(sales) ? sales : []);
    const nameKey = name.toLowerCase();
    const stats = saleMap.get(nameKey) || { purchases: 0, spent: 0 };

    const createdSnap = await firestore.collection(CUSTOMERS_COLLECTION).doc(id).get();
    const data = createdSnap.data() || {};

    return res.json({ error: false, customer: normalizeCustomerRow({ ...data, id }, stats) });
});

app.patch('/api/customers/:id', verifyLogin, async (req, res) => {
    const id = String(req.params.id || '').trim();
    if (!id) {
        return res.status(400).json({ error: true, message: 'ID inválido.' });
    }

    const snap = await firestore.collection(CUSTOMERS_COLLECTION).doc(id).get();
    if (!snap.exists) {
        return res.status(404).json({ error: true, message: 'Cliente não encontrado.' });
    }

    const prev = snap.data() || {};
    const body = req.body || {};
    const patch = { updatedAt: FieldValue.serverTimestamp() };

    if (body.name !== undefined) {
        const nm = String(body.name).trim();
        if (!nm) {
            return res.status(400).json({ error: true, message: 'Nome inválido.' });
        }
        patch.name = nm;
    }
    if (body.doc !== undefined) patch.doc = String(body.doc || '').trim();
    if (body.phone !== undefined) patch.phone = String(body.phone || '').trim();
    if (body.email !== undefined) patch.email = String(body.email || '').trim();
    if (body.address !== undefined) patch.address = String(body.address || '').trim();
    if (body.notes !== undefined) patch.notes = String(body.notes || '').trim();

    if (body.requests !== undefined) {
        if (!Array.isArray(body.requests)) {
            return res.status(400).json({ error: true, message: 'Lista de requisições inválida.' });
        }
        patch.requests = body.requests.map(normalizeCustomerRequest);
    }

    try {
        await db.update(CUSTOMERS_COLLECTION, id, patch);
    } catch (e) {
        console.error(e);
        return res.status(500).json({ error: true, message: 'Erro ao atualizar cliente.' });
    }

    let sales = [];
    try {
        sales = await db.findAll({ colecao: SALES_COLLECTION });
    } catch {
        sales = [];
    }
    const saleMap = salesTotalsByClientKey(Array.isArray(sales) ? sales : []);
    const merged = { id, ...prev, ...patch };
    delete merged.updatedAt;

    const finalName = String(merged.name !== undefined ? merged.name : prev.name || '').trim().toLowerCase();
    const stats = finalName ? saleMap.get(finalName) || { purchases: 0, spent: 0 } : { purchases: 0, spent: 0 };

    const freshSnap = await firestore.collection(CUSTOMERS_COLLECTION).doc(id).get();
    const data = freshSnap.data() || {};
    return res.json({ error: false, customer: normalizeCustomerRow({ ...data, id }, stats) });
});

app.delete('/api/customers/:id', verifyLogin, async (req, res) => {
    const id = String(req.params.id || '').trim();
    if (!id) {
        return res.status(400).json({ error: true, message: 'ID inválido.' });
    }

    const snap = await firestore.collection(CUSTOMERS_COLLECTION).doc(id).get();
    if (!snap.exists) {
        return res.status(404).json({ error: true, message: 'Cliente não encontrado.' });
    }

    try {
        await db.delete(CUSTOMERS_COLLECTION, id);
    } catch (e) {
        console.error(e);
        return res.status(500).json({ error: true, message: 'Erro ao remover cliente.' });
    }

    return res.json({ error: false });
});

app.post('/api/customers/:id/requests', verifyLogin, async (req, res) => {
    const id = String(req.params.id || '').trim();
    if (!id) {
        return res.status(400).json({ error: true, message: 'ID inválido.' });
    }

    const snap = await firestore.collection(CUSTOMERS_COLLECTION).doc(id).get();
    if (!snap.exists) {
        return res.status(404).json({ error: true, message: 'Cliente não encontrado.' });
    }

    const prev = snap.data() || {};
    const prevReq = Array.isArray(prev.requests) ? prev.requests.map(normalizeCustomerRequest) : [];
    const incoming = normalizeCustomerRequest(req.body || {});
    if (!incoming.title) {
        return res.status(400).json({ error: true, message: 'Título da requisição é obrigatório.' });
    }

    const nextRequests = [...prevReq, incoming];
    try {
        await db.update(CUSTOMERS_COLLECTION, id, {
            requests: nextRequests,
            updatedAt: FieldValue.serverTimestamp()
        });
    } catch (e) {
        console.error(e);
        return res.status(500).json({ error: true, message: 'Erro ao registrar requisição.' });
    }

    let sales = [];
    try {
        sales = await db.findAll({ colecao: SALES_COLLECTION });
    } catch {
        sales = [];
    }
    const saleMap = salesTotalsByClientKey(Array.isArray(sales) ? sales : []);
    const finalName = String(prev.name || '').trim().toLowerCase();
    const stats = finalName ? saleMap.get(finalName) || { purchases: 0, spent: 0 } : { purchases: 0, spent: 0 };

    const freshSnap = await firestore.collection(CUSTOMERS_COLLECTION).doc(id).get();
    const data = freshSnap.data() || {};
    return res.json({ error: false, customer: normalizeCustomerRow({ ...data, id }, stats) });
});

app.post('/api/cash-flow/rebuild', verifyLogin, async (req, res) => {
    try {
        const stats = await rebuildAllFinancialData();
        await firestore.collection('infocore').doc('meta').set(
            { [FINANCIAL_REBUILD_FLAG]: true, rebuiltAt: FieldValue.serverTimestamp() },
            { merge: true }
        );
        return res.json({ error: false, message: 'Dados financeiros recalculados.', stats });
    } catch (e) {
        console.error(e);
        return res.status(500).json({ error: true, message: 'Erro ao recalcular fluxo de caixa.' });
    }
});

app.get('/api/cash-flow', verifyLogin, async (req, res) => {
    try {
        const entries = await loadCashFlowNormalized();
        let filtered = entries;
        const qType = String(req.query.type || '').toLowerCase();
        if (qType === 'income' || qType === 'expense') {
            filtered = entries.filter((e) => e.type === qType);
        }
        const from = String(req.query.from || '').trim();
        const to = String(req.query.to || '').trim();
        if (from) filtered = filtered.filter((e) => !e.date || e.date >= from);
        if (to) filtered = filtered.filter((e) => !e.date || e.date <= to);
        return res.json({ error: false, entries: filtered });
    } catch (e) {
        console.error(e);
        return res.status(500).json({ error: true, message: 'Erro ao carregar fluxo de caixa.' });
    }
});

app.post('/api/cash-flow', verifyLogin, async (req, res) => {
    const body = req.body || {};
    const amount = parseMoneyField(body.amount);
    if (amount <= 0) {
        return res.status(400).json({ error: true, message: 'Informe um valor maior que zero.' });
    }

    const type = String(body.type || 'income').toLowerCase() === 'expense' ? 'expense' : 'income';
    const dateRaw = body.date != null ? String(body.date).trim().slice(0, 10) : '';
    const date = dateRaw || new Date().toISOString().slice(0, 10);
    const id = randomUUID();

    const payload = {
        id,
        type,
        amount,
        category: String(body.category || '').trim(),
        description: String(body.description || '').trim(),
        date,
        createdAt: FieldValue.serverTimestamp()
    };

    try {
        await db.create(CASH_FLOW_COLLECTION, id, payload);
    } catch (e) {
        console.error(e);
        return res.status(500).json({ error: true, message: 'Erro ao registrar lançamento.' });
    }

    const freshSnap = await firestore.collection(CASH_FLOW_COLLECTION).doc(id).get();
    const data = freshSnap.data() || {};
    return res.json({ error: false, entry: normalizeCashFlowRow({ ...data, id }) });
});

app.patch('/api/cash-flow/:id', verifyLogin, async (req, res) => {
    const id = String(req.params.id || '').trim();
    if (!id) {
        return res.status(400).json({ error: true, message: 'ID inválido.' });
    }

    const snap = await firestore.collection(CASH_FLOW_COLLECTION).doc(id).get();
    if (!snap.exists) {
        return res.status(404).json({ error: true, message: 'Lançamento não encontrado.' });
    }

    const prev = snap.data() || {};
    if (isPdvCashFlowEntry(prev)) {
        return res.status(403).json({
            error: true,
            message: 'Lançamentos de venda do PDV não podem ser editados. Altere na venda ou exclua a venda no sistema.'
        });
    }
    const body = req.body || {};
    const patch = {};

    if (body.type !== undefined) {
        patch.type = String(body.type).toLowerCase() === 'expense' ? 'expense' : 'income';
    }
    if (body.amount !== undefined) {
        const amt = parseMoneyField(body.amount);
        if (amt <= 0) {
            return res.status(400).json({ error: true, message: 'Valor inválido.' });
        }
        patch.amount = amt;
    }
    if (body.category !== undefined) patch.category = String(body.category || '').trim();
    if (body.description !== undefined) patch.description = String(body.description || '').trim();
    if (body.date !== undefined) {
        const d = String(body.date || '').trim().slice(0, 10);
        patch.date = d;
    }

    if (Object.keys(patch).length === 0) {
        return res.status(400).json({ error: true, message: 'Nada para atualizar.' });
    }

    try {
        await db.update(CASH_FLOW_COLLECTION, id, patch);
    } catch (e) {
        console.error(e);
        return res.status(500).json({ error: true, message: 'Erro ao atualizar lançamento.' });
    }

    const merged = { id, ...prev, ...patch };
    return res.json({ error: false, entry: normalizeCashFlowRow(merged) });
});

app.delete('/api/cash-flow/:id', verifyLogin, async (req, res) => {
    const id = String(req.params.id || '').trim();
    if (!id) {
        return res.status(400).json({ error: true, message: 'ID inválido.' });
    }

    const snap = await firestore.collection(CASH_FLOW_COLLECTION).doc(id).get();
    if (!snap.exists) {
        return res.status(404).json({ error: true, message: 'Lançamento não encontrado.' });
    }

    const prev = snap.data() || {};
    if (isPdvCashFlowEntry(prev)) {
        return res.status(403).json({
            error: true,
            message: 'Lançamentos gerados por vendas do PDV não podem ser excluídos aqui.'
        });
    }

    try {
        await db.delete(CASH_FLOW_COLLECTION, id);
    } catch (e) {
        console.error(e);
        return res.status(500).json({ error: true, message: 'Erro ao excluir lançamento.' });
    }

    return res.json({ error: false });
});

app.get('/api/services/templates', verifyLogin, (req, res) => {
    const deviceType = String(req.query.deviceType || 'Celular').trim();
    return res.json({
        error: false,
        deviceType,
        template: getServiceChecklistTemplate(deviceType)
    });
});

app.get('/api/service-work-templates', verifyLogin, async (req, res) => {
    const templates = await loadServiceWorkTemplatesNormalized();
    const activeOnly = String(req.query.active || '') === '1';
    return res.json({
        error: false,
        templates: activeOnly ? templates.filter((t) => t.active) : templates
    });
});

app.get('/api/service-work-templates/:id', verifyLogin, async (req, res) => {
    const id = String(req.params.id || '').trim();
    const snap = await firestore.collection(SERVICE_WORK_TEMPLATES_COLLECTION).doc(id).get();
    if (!snap.exists) {
        return res.status(404).json({ error: true, message: 'Template não encontrado.' });
    }
    return res.json({
        error: false,
        template: normalizeServiceWorkTemplateRow({ id, ...(snap.data() || {}) })
    });
});

app.post('/api/service-work-templates', verifyLogin, async (req, res) => {
    if (req.session.user?.type !== 'admin') {
        return res.status(403).json({ error: true, message: 'Acesso restrito ao administrador.' });
    }
    const body = req.body || {};
    const name = String(body.name || '').trim();
    if (!name) {
        return res.status(400).json({ error: true, message: 'Informe o nome do template.' });
    }
    const stages = Array.isArray(body.stages) ? body.stages : [];
    if (!stages.length) {
        return res.status(400).json({ error: true, message: 'Adicione ao menos uma etapa padrão.' });
    }
    const id = randomUUID();
    const now = new Date().toISOString();
    const payload = normalizeServiceWorkTemplateRow({
        id,
        name,
        description: body.description,
        icon: body.icon,
        deviceTypes: body.deviceTypes,
        stages,
        active: body.active !== false,
        createdAt: now,
        updatedAt: now
    });
    try {
        await db.create(SERVICE_WORK_TEMPLATES_COLLECTION, id, payload);
    } catch (e) {
        console.error(e);
        return res.status(500).json({ error: true, message: 'Erro ao criar template.' });
    }
    return res.json({ error: false, template: payload });
});

app.patch('/api/service-work-templates/:id', verifyLogin, async (req, res) => {
    if (req.session.user?.type !== 'admin') {
        return res.status(403).json({ error: true, message: 'Acesso restrito ao administrador.' });
    }
    const id = String(req.params.id || '').trim();
    const snap = await firestore.collection(SERVICE_WORK_TEMPLATES_COLLECTION).doc(id).get();
    if (!snap.exists) {
        return res.status(404).json({ error: true, message: 'Template não encontrado.' });
    }
    const prev = normalizeServiceWorkTemplateRow({ id, ...(snap.data() || {}) });
    const body = req.body || {};
    const merged = normalizeServiceWorkTemplateRow({
        ...prev,
        name: body.name != null ? body.name : prev.name,
        description: body.description != null ? body.description : prev.description,
        icon: body.icon != null ? body.icon : prev.icon,
        deviceTypes: body.deviceTypes != null ? body.deviceTypes : prev.deviceTypes,
        stages: body.stages != null ? body.stages : prev.stages,
        active: body.active != null ? body.active !== false : prev.active,
        updatedAt: new Date().toISOString()
    });
    if (!merged.name) {
        return res.status(400).json({ error: true, message: 'Nome inválido.' });
    }
    try {
        await db.update(SERVICE_WORK_TEMPLATES_COLLECTION, id, merged);
    } catch (e) {
        console.error(e);
        return res.status(500).json({ error: true, message: 'Erro ao atualizar template.' });
    }
    return res.json({ error: false, template: merged });
});

app.delete('/api/service-work-templates/:id', verifyLogin, async (req, res) => {
    if (req.session.user?.type !== 'admin') {
        return res.status(403).json({ error: true, message: 'Acesso restrito ao administrador.' });
    }
    const id = String(req.params.id || '').trim();
    try {
        await db.delete(SERVICE_WORK_TEMPLATES_COLLECTION, id);
    } catch (e) {
        console.error(e);
        return res.status(500).json({ error: true, message: 'Erro ao excluir template.' });
    }
    return res.json({ error: false });
});

app.post('/api/services/template', verifyLogin, async (req, res) => {
    if (req.session.user?.type !== 'admin') {
        return res.status(403).json({ error: true, message: 'Acesso restrito ao administrador.' });
    }
    const kind = String(req.body?.kind || 'image').trim();
    let service = normalizeServiceOrderRow(req.body?.service || {});
    if (!service.id && !service.code) {
        return res.status(400).json({ error: true, message: 'OS inválida.' });
    }
    if (service.id) {
        const snap = await firestore.collection(SERVICE_ORDERS_COLLECTION).doc(service.id).get();
        if (snap.exists) {
            service = normalizeServiceOrderRow({ id: service.id, ...(snap.data() || {}) });
        }
    }
    const configs = await getConfigsSafe();
    if (!service.shareToken) {
        const share = await ensureServiceShareToken(service, req);
        service = share.service;
    }
    const allowed = new Set(['image', 'pdf', 'whatsapp', 'report']);
    const k = allowed.has(kind) ? kind : 'image';
    if (k === 'whatsapp') {
        return res.json({ error: false, text: renderServiceTemplateText('whatsapp', service, req, { configs }) });
    }
    const html = renderServiceTemplateHtml(k === 'report' ? 'image' : k, service, req, { configs });
    return res.json({ error: false, html });
});

app.post('/api/services/:id/share', verifyLogin, async (req, res) => {
    if (req.session.user?.type !== 'admin') {
        return res.status(403).json({ error: true, message: 'Acesso restrito ao administrador.' });
    }
    const id = String(req.params.id || '').trim();
    const snap = await firestore.collection(SERVICE_ORDERS_COLLECTION).doc(id).get();
    if (!snap.exists) {
        return res.status(404).json({ error: true, message: 'Ordem de serviço não encontrada.' });
    }
    let service = normalizeServiceOrderRow({ id, ...(snap.data() || {}) });
    const body = req.body || {};
    const report = await dispatchServiceShare(service, req, {
        sendWhatsapp: Boolean(body.sendWhatsapp),
        includeLink: body.includeLink !== false,
        includeQr: Boolean(body.includeQr),
        includePdf: Boolean(body.includePdf),
        includeImage: Boolean(body.includeImage),
        reportImageBase64: body.reportImageBase64 ? String(body.reportImageBase64) : ''
    });
    if (body.markDelivered && report.share?.service) {
        try {
            await db.update(SERVICE_ORDERS_COLLECTION, id, {
                status: 'delivered',
                updatedAt: new Date().toISOString()
            });
            report.service = normalizeServiceOrderRow({
                ...report.service,
                status: 'delivered'
            });
        } catch (e) {
            console.error(e);
        }
    }
    const ok = !body.sendWhatsapp || (report.whatsapp && report.whatsapp.sent);
    return res.json({
        error: false,
        success: ok,
        shareUrl: report.shareUrl,
        qrDataUrl: report.qrDataUrl,
        whatsapp: report.whatsapp,
        service: report.service
    });
});

app.get('/api/services', verifyLogin, async (req, res) => {
    if (req.session.user?.type !== 'admin') {
        return res.status(403).json({ error: true, message: 'Acesso restrito ao administrador.' });
    }
    const services = await loadServiceOrdersNormalized();
    return res.json({ error: false, services });
});

app.get('/api/services/:id', verifyLogin, async (req, res) => {
    if (req.session.user?.type !== 'admin') {
        return res.status(403).json({ error: true, message: 'Acesso restrito ao administrador.' });
    }
    const id = String(req.params.id || '').trim();
    if (!id) {
        return res.status(400).json({ error: true, message: 'ID inválido.' });
    }
    const snap = await firestore.collection(SERVICE_ORDERS_COLLECTION).doc(id).get();
    if (!snap.exists) {
        return res.status(404).json({ error: true, message: 'Ordem de serviço não encontrada.' });
    }
    const service = normalizeServiceOrderRow({ id, ...(snap.data() || {}) });
    return res.json({ error: false, service });
});

app.post('/api/services', verifyLogin, async (req, res) => {
    const body = req.body || {};
    const customerName = String(body.customerName || '').trim();
    const deviceType = String(body.deviceType || 'Celular').trim() || 'Celular';
    const deviceBrandModel = String(body.deviceBrandModel || '').trim();
    const issueReport = String(body.issueReport || '').trim();
    const budgetBody = body.budget && typeof body.budget === 'object' ? body.budget : null;
    const budgetRawNotes = budgetBody
        ? String(budgetBody.notes || '').trim()
        : String(body.budgetRawNotes || '').trim();
    const estimateValueRaw = body.estimateValue;
    let estimateValue = estimateValueRaw === '' || estimateValueRaw == null
        ? null
        : Math.max(0, Number(estimateValueRaw) || 0);
    if (budgetBody && Array.isArray(budgetBody.items) && budgetBody.items.length) {
        const subtotal = budgetBody.items.reduce((sum, item) => {
            const qty = Math.max(0, Number(item.qty) || 0);
            const unit = Math.max(0, Number(item.unitPrice) || 0);
            return sum + (qty * unit);
        }, 0);
        const discount = Math.max(0, Number(budgetBody.discount) || 0);
        const extra = Math.max(0, Number(budgetBody.extra) || 0);
        estimateValue = Math.max(0, Math.round((subtotal - discount + extra) * 100) / 100);
    }

    let incomingChecklist = Array.isArray(body.checklist) ? body.checklist : [];
    let checklist = incomingChecklist.length
        ? incomingChecklist.map(normalizeServiceChecklistItem).filter((item) => item.label)
        : defaultServiceChecklistState(deviceType);

    const workTemplateId = String(body.workTemplateId || '').trim();
    let workTemplateName = String(body.workTemplateName || '').trim();
    const applyTemplateIds = Array.isArray(body.applyTemplateIds)
        ? body.applyTemplateIds.map((id) => String(id).trim()).filter(Boolean)
        : [];
    const appliedTemplateNames = [];

    if (workTemplateId) {
        const tplSnap = await firestore.collection(SERVICE_WORK_TEMPLATES_COLLECTION).doc(workTemplateId).get();
        if (tplSnap.exists) {
            const tpl = normalizeServiceWorkTemplateRow({ id: workTemplateId, ...(tplSnap.data() || {}) });
            workTemplateName = tpl.name;
            appliedTemplateNames.push(tpl.name);
            checklist = applyWorkTemplateToChecklist(checklist, tpl, deviceType);
        }
    }
    if (applyTemplateIds.length) {
        for (const tid of applyTemplateIds) {
            if (workTemplateId && String(tid) === workTemplateId) continue;
            const tplSnap = await firestore.collection(SERVICE_WORK_TEMPLATES_COLLECTION).doc(String(tid).trim()).get();
            if (tplSnap.exists) {
                const tpl = normalizeServiceWorkTemplateRow({ id: tplSnap.id, ...(tplSnap.data() || {}) });
                checklist = applyWorkTemplateToChecklist(checklist, tpl, deviceType);
                if (tpl.name) appliedTemplateNames.push(tpl.name);
            }
        }
        checklist = reorderChecklistByTemplateSequence(checklist, applyTemplateIds);
        if (appliedTemplateNames.length) {
            workTemplateName = appliedTemplateNames.join(' → ');
        }
    }

    const defectiveItems = checklist.filter((item) => item.defective);
    const customerPhone = String(body.customerPhone || '').trim();
    if (!customerName) {
        return res.status(400).json({ error: true, message: 'Informe o nome do cliente.' });
    }
    if (!isValidServicePhone(customerPhone)) {
        return res.status(400).json({ error: true, message: 'Informe o WhatsApp/telefone do cliente (mín. 10 dígitos).' });
    }
    if (!deviceBrandModel) {
        return res.status(400).json({ error: true, message: 'Informe marca/modelo do aparelho.' });
    }
    if (!defectiveItems.length && !issueReport) {
        return res.status(400).json({
            error: true,
            message: 'Marque ao menos um serviço/defeito ou preencha o relato do problema.'
        });
    }

    const id = randomUUID();
    const now = new Date().toISOString();
    const code = serviceDisplayCode();
    const serviceDraft = normalizeServiceOrderRow({
        id,
        code,
        budgetId: '',
        customerId: String(body.customerId || '').trim(),
        customerName,
        customerPhone,
        customerEmail: String(body.customerEmail || '').trim(),
        deviceType,
        deviceBrandModel,
        accessories: String(body.accessories || '').trim(),
        issueReport,
        budgetRawNotes,
        estimateValue,
        checklist,
        progressNotes: [],
        status: 'open',
        priority: String(body.priority || 'normal'),
        createdAt: now,
        updatedAt: now,
        createdBy: {
            name: req.session.user?.name || '',
            email: req.session.user?.email || ''
        },
        workTemplateId: applyTemplateIds[0] || workTemplateId || '',
        workTemplateIds: applyTemplateIds.length ? applyTemplateIds : (workTemplateId ? [workTemplateId] : []),
        workTemplateName
    });

    let budgetLink;
    try {
        budgetLink = await createLinkedBudgetForService(serviceDraft, req.session.user, budgetBody);
    } catch (e) {
        console.error(e);
        return res.status(500).json({ error: true, message: 'Erro ao criar orçamento vinculado.' });
    }
    if (budgetLink.error) {
        return res.status(400).json({ error: true, message: budgetLink.message || 'Erro ao criar orçamento vinculado.' });
    }

    const payload = normalizeServiceOrderRow({
        ...serviceDraft,
        budgetId: budgetLink.budgetId,
        customerId: budgetLink.budget?.customerId || serviceDraft.customerId,
        customerName: budgetLink.budget?.customerName || serviceDraft.customerName,
        customerPhone: budgetLink.budget?.customerPhone || serviceDraft.customerPhone,
        customerEmail: budgetLink.budget?.customerEmail || serviceDraft.customerEmail
    });

    const firestorePayload = serviceOrderFirestorePayload(payload);

    try {
        await db.create(SERVICE_ORDERS_COLLECTION, id, firestorePayload);
    } catch (e) {
        console.error('[OS] Erro ao gravar ordem:', e);
        try {
            await firestore.collection(BUDGETS_COLLECTION).doc(budgetLink.budgetId).delete();
        } catch (cleanupErr) {
            console.error(cleanupErr);
        }
        return res.status(500).json({ error: true, message: 'Erro ao criar ordem de serviço.' });
    }

    return res.json({
        error: false,
        service: payload,
        budget: budgetLink.budget,
        customerCreated: budgetLink.customerCreated
    });
});

app.patch('/api/services/:id', verifyLogin, async (req, res) => {
    if (req.session.user?.type !== 'admin') {
        return res.status(403).json({ error: true, message: 'Acesso restrito ao administrador.' });
    }
    const id = String(req.params.id || '').trim();
    if (!id) {
        return res.status(400).json({ error: true, message: 'ID inválido.' });
    }

    const snap = await firestore.collection(SERVICE_ORDERS_COLLECTION).doc(id).get();
    if (!snap.exists) {
        return res.status(404).json({ error: true, message: 'Ordem de serviço não encontrada.' });
    }

    const body = req.body || {};
    const prev = normalizeServiceOrderRow({ id, ...(snap.data() || {}) });
    const patch = {};

    if (body.status != null) patch.status = String(body.status || '').trim();
    if (body.priority != null) patch.priority = String(body.priority || '').trim();
    if (Array.isArray(body.checklist)) patch.checklist = body.checklist.map(normalizeServiceChecklistItem).filter((item) => item.label);
    if (Array.isArray(body.progressNotes)) {
        patch.progressNotes = body.progressNotes.map((n) => ({
            id: n?.id != null ? String(n.id) : randomUUID(),
            text: String(n?.text || '').trim(),
            createdAt: n?.createdAt || new Date().toISOString()
        })).filter((n) => n.text);
    }
    if (body.deviceBrandModel != null) patch.deviceBrandModel = String(body.deviceBrandModel || '').trim();
    if (body.accessories != null) patch.accessories = String(body.accessories || '').trim();

    const merged = normalizeServiceOrderRow({
        ...prev,
        ...patch,
        updatedAt: new Date().toISOString()
    });

    try {
        await db.update(SERVICE_ORDERS_COLLECTION, id, {
            status: merged.status,
            priority: merged.priority,
            checklist: merged.checklist,
            progressNotes: merged.progressNotes,
            deviceBrandModel: merged.deviceBrandModel,
            accessories: merged.accessories,
            workTemplateId: merged.workTemplateId,
            workTemplateName: merged.workTemplateName,
            shareToken: merged.shareToken,
            shareCreatedAt: merged.shareCreatedAt,
            updatedAt: merged.updatedAt
        });
    } catch (e) {
        console.error(e);
        return res.status(500).json({ error: true, message: 'Erro ao atualizar ordem de serviço.' });
    }

    return res.json({ error: false, service: merged });
});

app.post('/api/services/:id/checklist/:itemKey/photos', verifyLogin, (req, res, next) => {
    upload.array('photos', 6)(req, res, (err) => {
        if (err) {
            return res.status(400).json({ error: true, message: err.message || 'Upload inválido.' });
        }
        next();
    });
}, async (req, res) => {
    const id = String(req.params.id || '').trim();
    const itemKey = String(req.params.itemKey || '').trim();
    const phase = String(req.query.phase || 'intake').trim() === 'tech' ? 'tech' : 'intake';
    if (!id || !itemKey) {
        return res.status(400).json({ error: true, message: 'Parâmetros inválidos.' });
    }
    if (phase === 'tech' && req.session.user?.type !== 'admin') {
        return res.status(403).json({ error: true, message: 'Acesso restrito ao administrador.' });
    }

    const snap = await firestore.collection(SERVICE_ORDERS_COLLECTION).doc(id).get();
    if (!snap.exists) {
        return res.status(404).json({ error: true, message: 'Ordem de serviço não encontrada.' });
    }

    const prev = normalizeServiceOrderRow({ id, ...(snap.data() || {}) });
    const files = Array.isArray(req.files) ? req.files : [];
    if (!files.length) {
        return res.status(400).json({ error: true, message: 'Selecione pelo menos uma foto.' });
    }

    const caption = String(req.body?.caption || '').trim();
    const newPhotos = files.map((file) => normalizeServicePhotoItem({
        id: randomUUID(),
        url: `/uploads/${file.filename}`,
        caption,
        createdAt: new Date().toISOString()
    }));

    const photoKind = String(req.query.kind || 'general').toLowerCase();
    const checklist = (prev.checklist || []).map((item) => {
        if (String(item.key) !== itemKey) return item;
        if (phase === 'intake') {
            return { ...item, photos: [...(item.photos || []), ...newPhotos] };
        }
        if (photoKind === 'before') {
            return { ...item, beforePhotos: [...(item.beforePhotos || []), ...newPhotos.map((p) => ({ ...p, kind: 'before' }))] };
        }
        if (photoKind === 'after') {
            return { ...item, afterPhotos: [...(item.afterPhotos || []), ...newPhotos.map((p) => ({ ...p, kind: 'after' }))] };
        }
        return { ...item, techPhotos: [...(item.techPhotos || []), ...newPhotos] };
    });

    const updatedAt = new Date().toISOString();
    try {
        await db.update(SERVICE_ORDERS_COLLECTION, id, { checklist, updatedAt });
    } catch (e) {
        console.error(e);
        return res.status(500).json({ error: true, message: 'Erro ao salvar fotos.' });
    }

    return res.json({
        error: false,
        service: normalizeServiceOrderRow({ ...prev, checklist, updatedAt })
    });
});

app.get('/api/sales/:id', verifyLogin, async (req, res) => {
    const id = String(req.params.id || '').trim();
    if (!id) {
        return res.status(400).json({ error: true, message: 'ID inválido.' });
    }
    try {
        const snap = await firestore.collection(SALES_COLLECTION).doc(id).get();
        if (!snap.exists) {
            return res.status(404).json({ error: true, message: 'Venda não encontrada.' });
        }
        const data = snap.data() || {};
        return res.json({ error: false, sale: normalizeSaleRow({ ...data, id }) });
    } catch (e) {
        console.error(e);
        return res.status(500).json({ error: true, message: 'Erro ao carregar venda.' });
    }
});

app.delete('/api/sales/pending/active', verifyLogin, async (req, res) => {
    try {
        const result = await releaseActivePointPayment();
        return res.json(result);
    } catch (e) {
        console.error('Falha ao liberar terminal:', formatMpAxiosError(e));
        return res.json({ error: false, cancelWarning: true });
    }
});

app.delete('/api/sales/pending/:token', verifyLogin, async (req, res) => {
    const token = String(req.params.token || '').trim();
    return withPointPaymentLock(async () => {
        const pending = pendingPointSales.get(token);
        const trackedOrderIds = [];
        let cancelWarning = false;

        if (pending) {
            if (pending?.pointOrderId) trackedOrderIds.push(pending.pointOrderId);
            if (pending?.qrOrderId) trackedOrderIds.push(pending.qrOrderId);
            try {
                if (pending?.mode === 'point') await cancelPointOrder(pending.pointOrderId);
                if (pending?.mode === 'mp_qr_instore') await cancelQrStoreOrder(pending.qrOrderId);
                await waitForMpOrdersIdle(trackedOrderIds);
            } catch (e) {
                cancelWarning = true;
                console.error('Falha ao cancelar pagamento pendente:', formatMpAxiosError(e));
            } finally {
                pendingPointSales.delete(token);
            }
        } else if (activePointOrderId) {
            trackedOrderIds.push(activePointOrderId);
            try {
                await cancelPointOrder(activePointOrderId);
                await waitForMpOrdersIdle(trackedOrderIds);
            } catch (e) {
                cancelWarning = true;
                console.error('Falha ao cancelar order ativa (token ausente):', formatMpAxiosError(e));
            }
        }

        await syncActivePointOrderTracking(trackedOrderIds);
        return res.json({ error: false, cancelWarning });
    });
});

app.get('/sells', verifyLogin, (req, res) => res.redirect('/cash-flow'));

app.get('/products', verifyLogin, (req, res) => {
    renderAppShell(res, 'products', req.session.user);
});

app.get('/clients', verifyLogin, (req, res) => {
    renderAppShell(res, 'clients', req.session.user);
});

app.get('/cash-flow', verifyLogin, (req, res) => {
    renderAppShell(res, 'cashflow', req.session.user);
});

app.get('/analytics', verifyLogin, (req, res) => {
    renderAppShell(res, 'analytics', req.session.user);
});

app.get('/config', verifyAdmin, async (req, res) => {
    const configs = await getConfigsSafe();
    res.render('layout', {
        body: 'config',
        appData: {
            user: req.session.user,
            configs,
            whatsapp: whatsappClient.getStatus()
        }
    });
});

app.get('/api/whatsapp/status', verifyLogin, (req, res) => {
    if (req.session.user?.type !== 'admin') {
        return res.status(403).json({ error: true, message: 'Acesso restrito ao administrador.' });
    }
    return res.json({ error: false, ...whatsappClient.getStatus() });
});

app.post('/api/whatsapp/connect', verifyLogin, async (req, res) => {
    if (req.session.user?.type !== 'admin') {
        return res.status(403).json({ error: true, message: 'Acesso restrito ao administrador.' });
    }
    try {
        const data = await whatsappClient.start();
        return res.json({ error: false, ...data });
    } catch (e) {
        console.error(e);
        return res.status(500).json({ error: true, message: e.message || 'Falha ao conectar WhatsApp.' });
    }
});

app.post('/api/whatsapp/disconnect', verifyLogin, async (req, res) => {
    if (req.session.user?.type !== 'admin') {
        return res.status(403).json({ error: true, message: 'Acesso restrito ao administrador.' });
    }
    try {
        const data = await whatsappClient.logout();
        return res.json({ error: false, ...data });
    } catch (e) {
        console.error(e);
        return res.status(500).json({ error: true, message: e.message || 'Falha ao desconectar.' });
    }
});

app.use((err, req, res, next) => {
    console.error('Erro não tratado:', err);
    const isApi = String(req.path || '').startsWith('/api/');
    if (isApi) {
        return res.status(500).json({ error: true, message: 'Erro interno do servidor.' });
    }
    return res.status(500).send('Erro interno do servidor. <a href="/dashboard">Voltar ao início</a>');
});

let port = process.env.PORT || 3131;
app.listen(port, () => {
    whatsappClient.startIfSessionExists().then((st) => {
        if (st.sessionExists) {
            console.log(`[WhatsApp] Sessão salva — status: ${st.status}`);
        }
    }).catch((e) => console.error('[WhatsApp] auto-start', e));
    const dataHora = new Date();
    const formatado = d => ('0' + d).slice(-2);
    const dataHoraFormatada = `${formatado(dataHora.getDate())}/${formatado(dataHora.getMonth() + 1)}/${dataHora.getFullYear()} ${formatado(dataHora.getHours())}:${formatado(dataHora.getMinutes())}:${formatado(dataHora.getSeconds())}`;
    console.log(`
  ╔══════════════════════════════════════════╗
  ║    InfoCore System - Servidor Rodando    ║
  ╚══════════════════════════════════════════╝
  
  🌐 Local: http://localhost:${port}
  
  🕒 Iniciado em: ${dataHoraFormatada}
  
  
  ⚡ Pressione Ctrl+C para parar o servidor
  
  `);
});