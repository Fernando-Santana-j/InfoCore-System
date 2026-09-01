const { randomUUID } = require('crypto');

const BUDGET_STATUSES = new Set([
  'draft', 'sent', 'awaiting', 'approved', 'rejected', 'expired',
  'cancelled', 'acquiring_parts', 'converted'
]);
const LEGACY_STATUS_MAP = { finalized: 'sent' };
const ITEM_CONDITIONS = new Set(['new', 'used', 'semi_new', 'refurbished', 'na']);
const PRICE_MODES = new Set(['snapshot', 'live']);
const ADJ_TYPES = new Set(['fixed', 'percent']);
const CARD_INSTALLMENT_RATE = 9.67;
const CARD_INSTALLMENTS = 6;
const OPTION_PRESENTATION_LIMITS = Object.freeze({
  gallery: 8,
  useCases: 12,
  games: 20,
  highlights: 12
});
const OPTION_PRESENTATION_TEXT_LIMITS = Object.freeze({
  id: 80,
  url: 1000,
  alt: 160,
  caption: 300,
  title: 120,
  description: 600,
  gameName: 120,
  resolution: 40,
  quality: 40,
  gameNote: 500,
  highlight: 160,
  performanceNote: 1000
});

function num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}
function cents(v) { return Math.round(num(v) * 100); }
function moneyFromCents(v) { return num(v) / 100; }
function roundMoney(v) { return moneyFromCents(cents(v)); }
function str(v) { return v == null ? '' : String(v).trim(); }
function limitedStr(v, max) { return str(v).slice(0, max); }

function normalizePresentationUrl(value) {
  const url = limitedStr(value, OPTION_PRESENTATION_TEXT_LIMITS.url);
  if (!url || /[\u0000-\u001f\u007f\\]/.test(url)) return '';
  if (/^\/(?:uploads|img|public)(?:\/|$)/i.test(url)) {
    const pathOnly = url.split(/[?#]/, 1)[0];
    return pathOnly.split('/').includes('..') ? '' : url;
  }
  if (!/^https?:\/\//i.test(url)) return '';
  try {
    const parsed = new URL(url);
    return ['http:', 'https:'].includes(parsed.protocol) && parsed.hostname ? url : '';
  } catch (_) {
    return '';
  }
}

function normalizeGallery(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, OPTION_PRESENTATION_LIMITS.gallery).map((entry) => {
    const row = entry && typeof entry === 'object' ? entry : { url: entry };
    const url = normalizePresentationUrl(row.url);
    if (!url) return null;
    return {
      id: limitedStr(row.id, OPTION_PRESENTATION_TEXT_LIMITS.id) || randomUUID(),
      url,
      alt: limitedStr(row.alt, OPTION_PRESENTATION_TEXT_LIMITS.alt),
      caption: limitedStr(row.caption, OPTION_PRESENTATION_TEXT_LIMITS.caption)
    };
  }).filter(Boolean);
}

function normalizeUseCases(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, OPTION_PRESENTATION_LIMITS.useCases).map((entry) => {
    const row = entry && typeof entry === 'object' ? entry : { title: entry };
    const title = limitedStr(row.title, OPTION_PRESENTATION_TEXT_LIMITS.title);
    if (!title) return null;
    return {
      id: limitedStr(row.id, OPTION_PRESENTATION_TEXT_LIMITS.id) || randomUUID(),
      title,
      description: limitedStr(row.description, OPTION_PRESENTATION_TEXT_LIMITS.description)
    };
  }).filter(Boolean);
}

function normalizeFps(value, fallback = 0) {
  if (value == null || (typeof value === 'string' && !value.trim())) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(1000, Math.max(0, Math.round(parsed)));
}

function normalizeGames(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, OPTION_PRESENTATION_LIMITS.games).map((entry) => {
    const row = entry && typeof entry === 'object' ? entry : {};
    const name = limitedStr(row.name, OPTION_PRESENTATION_TEXT_LIMITS.gameName);
    if (!name) return null;
    let fpsMin = normalizeFps(row.fpsMin);
    let fpsMax = normalizeFps(row.fpsMax, fpsMin);
    if (fpsMax < fpsMin) [fpsMin, fpsMax] = [fpsMax, fpsMin];
    return {
      id: limitedStr(row.id, OPTION_PRESENTATION_TEXT_LIMITS.id) || randomUUID(),
      name,
      resolution: limitedStr(row.resolution, OPTION_PRESENTATION_TEXT_LIMITS.resolution),
      quality: limitedStr(row.quality, OPTION_PRESENTATION_TEXT_LIMITS.quality),
      fpsMin,
      fpsMax,
      note: limitedStr(row.note, OPTION_PRESENTATION_TEXT_LIMITS.gameNote)
    };
  }).filter(Boolean);
}

function normalizeOptionPresentation(row = {}) {
  const source = row && typeof row === 'object' ? row : {};
  const gallery = normalizeGallery(source.gallery);
  const legacyImageUrl = normalizePresentationUrl(source.imageUrl);
  return {
    imageUrl: legacyImageUrl || gallery[0]?.url || '',
    gallery,
    useCases: normalizeUseCases(source.useCases),
    games: normalizeGames(source.games),
    highlights: (Array.isArray(source.highlights) ? source.highlights : [])
      .slice(0, OPTION_PRESENTATION_LIMITS.highlights)
      .map((value) => typeof value === 'string' ? limitedStr(value, OPTION_PRESENTATION_TEXT_LIMITS.highlight) : '')
      .filter(Boolean),
    performanceNote: limitedStr(source.performanceNote, OPTION_PRESENTATION_TEXT_LIMITS.performanceNote)
  };
}

function normalizeStatus(v) {
  const raw = str(v).toLowerCase() || 'draft';
  const mapped = LEGACY_STATUS_MAP[raw] || raw;
  return BUDGET_STATUSES.has(mapped) ? mapped : 'draft';
}

function normalizeCondition(v) {
  const raw = str(v).toLowerCase();
  return ITEM_CONDITIONS.has(raw) ? raw : 'new';
}

function normalizePriceMode(v) {
  return PRICE_MODES.has(str(v).toLowerCase()) ? str(v).toLowerCase() : 'snapshot';
}

function normalizeAdjustment(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const type = ADJ_TYPES.has(str(r.type).toLowerCase()) ? str(r.type).toLowerCase() : 'fixed';
  let value = Math.max(0, num(r.value));
  if (type === 'percent') value = Math.min(100, value);
  return { type, value };
}

function applyAdjustment(subtotal, discountRaw, extraRaw) {
  const base = cents(subtotal);
  const discount = normalizeAdjustment(discountRaw);
  const extra = normalizeAdjustment(extraRaw);
  const discountCents = discount.type === 'percent' ? Math.round(base * discount.value / 100) : cents(discount.value);
  const extraCents = extra.type === 'percent' ? Math.round(base * extra.value / 100) : cents(extra.value);
  return {
    discount: { ...discount, amount: moneyFromCents(discountCents) },
    extra: { ...extra, amount: moneyFromCents(extraCents) },
    total: moneyFromCents(Math.max(0, base - discountCents + extraCents))
  };
}

function computeCardPayments(total) {
  const baseCents = Math.max(0, cents(total));
  const installmentTotalCents = Math.round(baseCents * (1 + CARD_INSTALLMENT_RATE / 100));
  return {
    cardTotal: moneyFromCents(installmentTotalCents),
    installmentRate: CARD_INSTALLMENT_RATE,
    installments: CARD_INSTALLMENTS,
    installmentTotal: moneyFromCents(installmentTotalCents),
    installmentValue: moneyFromCents(Math.round(installmentTotalCents / CARD_INSTALLMENTS))
  };
}

function normalizeItem(row = {}, index = 0) {
  const qty = Math.max(0, Math.trunc(num(row.qty)));
  const unitPrice = Math.max(0, num(row.unitPrice ?? row.price));
  const unitCost = Math.max(0, num(row.unitCost ?? row.cost));
  const itemDiscount = normalizeAdjustment(row.discount);
  const gross = moneyFromCents(cents(qty * unitPrice));
  const itemAdj = applyAdjustment(gross, itemDiscount, { type: 'fixed', value: 0 });
  const total = itemAdj.total;
  const lineCost = moneyFromCents(cents(qty * unitCost));
  return {
    id: str(row.id) || randomUUID(),
    kind: str(row.kind).toLowerCase() === 'product' ? 'product' : 'custom',
    productId: str(row.productId),
    sku: str(row.sku),
    name: str(row.name),
    qty,
    unitPrice,
    unitCost,
    lineCost,
    total,
    discount: itemAdj.discount,
    condition: normalizeCondition(row.condition || row.state),
    warranty: str(row.warranty),
    note: str(row.note || row.itemNote),
    priceMode: normalizePriceMode(row.priceMode),
    fixedPrice: row.fixedPrice === true || normalizePriceMode(row.priceMode) === 'snapshot',
    specialOrder: row.specialOrder === true,
    sortOrder: Number.isFinite(Number(row.sortOrder)) ? Number(row.sortOrder) : index
  };
}

function computeOption(option = {}, index = 0) {
  const items = Array.isArray(option.items) ? option.items.map((x, i) => normalizeItem(x, i)) : [];
  const subtotalCents = items.reduce((sum, item) => sum + cents(item.total), 0);
  const costCents = items.reduce((sum, item) => sum + cents(item.lineCost), 0);
  const subtotal = moneyFromCents(subtotalCents);
  const adjustments = applyAdjustment(subtotal, option.discount, option.extra);
  const total = adjustments.total;
  const costTotal = moneyFromCents(costCents);
  const profit = roundMoney(total - costTotal);
  const margin = total > 0 ? Math.round((profit / total) * 10000) / 100 : 0;
  const presentation = normalizeOptionPresentation(option);
  return {
    id: str(option.id) || randomUUID(),
    name: str(option.name) || (index === 0 ? 'Proposta' : `Opção ${index + 1}`),
    description: str(option.description),
    ...presentation,
    recommended: option.recommended === true,
    items,
    subtotal,
    discount: adjustments.discount,
    extra: adjustments.extra,
    total,
    cardPayments: computeCardPayments(total),
    costTotal,
    profit,
    margin
  };
}

function normalizeOptions(body = {}) {
  let rawOptions = Array.isArray(body.options) ? body.options : [];
  if (!rawOptions.length) {
    rawOptions = [{
      id: body.optionId,
      name: body.optionName || 'Proposta',
      recommended: true,
      items: Array.isArray(body.items) ? body.items : [],
      discount: body.adjustments?.discount || { type: 'fixed', value: body.discount || 0 },
      extra: body.adjustments?.extra || { type: 'fixed', value: body.extra || 0 }
    }];
  }
  const options = rawOptions.map((o, i) => computeOption(o, i)).filter((o) => o.items.length > 0);
  if (options.length && !options.some((o) => o.recommended)) options[0].recommended = true;
  if (options.filter((o) => o.recommended).length > 1) {
    let found = false;
    options.forEach((o) => { if (o.recommended && !found) found = true; else o.recommended = false; });
  }
  return options;
}

function bestOption(options, selectedId) {
  if (!Array.isArray(options) || !options.length) return null;
  const selected = options.find((o) => str(o.id) === str(selectedId));
  return selected || options.find((o) => o.recommended) || options[0];
}

function isoDateOnly(input) {
  const s = str(input);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return '';
  const d = new Date(`${s}T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? '' : s;
}
function todayIso(now = new Date()) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
function addDaysIso(dateIso, days) {
  const base = isoDateOnly(dateIso) || todayIso();
  const d = new Date(`${base}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + Math.max(0, Math.trunc(num(days, 7))));
  return d.toISOString().slice(0, 10);
}
function validateDates(issuedAt, validUntil) {
  const issue = isoDateOnly(issuedAt) || todayIso();
  const valid = isoDateOnly(validUntil) || addDaysIso(issue, 7);
  if (valid < issue) return { error: true, message: 'A validade não pode ser anterior à data de emissão.' };
  return { error: false, issuedAt: issue, validUntil: valid };
}

function aggregateProductQuantities(items = []) {
  const grouped = new Map();
  for (const row of Array.isArray(items) ? items : []) {
    const item = row && typeof row === 'object' ? row : {};
    if (str(item.kind).toLowerCase() !== 'product' || !str(item.productId)) continue;
    const qty = Math.max(0, Math.trunc(num(item.qty)));
    if (!qty) continue;
    const id = str(item.productId);
    grouped.set(id, roundMoney((grouped.get(id) || 0) + qty));
  }
  return grouped;
}

function effectiveStatus(status, validUntil, today = todayIso()) {
  const normalized = normalizeStatus(status);
  const valid = isoDateOnly(validUntil);
  const ref = isoDateOnly(today) || todayIso();
  if (['sent', 'awaiting'].includes(normalized) && valid && valid < ref) return 'expired';
  return normalized;
}

function normalizeTemplate(row = {}) {
  const items = Array.isArray(row.items) ? row.items.map((x, i) => normalizeItem(x, i)) : [];
  const subtotal = roundMoney(items.reduce((s, x) => s + x.total, 0));
  const costTotal = roundMoney(items.reduce((s, x) => s + x.lineCost, 0));
  const profit = roundMoney(subtotal - costTotal);
  const margin = subtotal > 0 ? Math.round((profit / subtotal) * 10000) / 100 : 0;
  const presentation = normalizeOptionPresentation(row);
  return {
    id: str(row.id),
    name: str(row.name),
    description: str(row.description),
    ...presentation,
    category: str(row.category) || 'Outros',
    active: row.active !== false,
    internalNotes: str(row.internalNotes),
    customerNotes: str(row.customerNotes || row.notes),
    defaultValidDays: Math.min(90, Math.max(1, Math.trunc(num(row.defaultValidDays, 7)))),
    warrantyText: str(row.warrantyText),
    paymentTerms: str(row.paymentTerms),
    deadline: str(row.deadline),
    includedServices: Array.isArray(row.includedServices) ? row.includedServices.map(str).filter(Boolean) : [],
    items,
    subtotal,
    costTotal,
    profit,
    margin,
    createdAt: row.createdAt || null,
    updatedAt: row.updatedAt || null
  };
}

function statusLabel(status) {
  const map = {
    draft: 'Rascunho', sent: 'Enviado', awaiting: 'Aguardando cliente', approved: 'Aprovado',
    rejected: 'Recusado', expired: 'Expirado', cancelled: 'Cancelado', acquiring_parts: 'Peças em aquisição', converted: 'Convertido em venda'
  };
  return map[normalizeStatus(status)] || 'Rascunho';
}

function sourceLabel(source) {
  const map = { instagram:'Instagram', google:'Google', referral:'Indicação', storefront:'Passou na frente da loja', old_customer:'Cliente antigo', whatsapp:'WhatsApp', facebook:'Facebook', other:'Outro' };
  return map[str(source)] || (str(source) || 'Não informado');
}

function rejectionLabel(reason) {
  const map = { price:'Preço', saving:'Cliente vai juntar dinheiro', competitor:'Comprou em outro lugar', gave_up:'Desistiu', no_response:'Não respondeu', deadline:'Prazo', other:'Outro' };
  return map[str(reason)] || (str(reason) || 'Não informado');
}

module.exports = {
  BUDGET_STATUSES,
  ITEM_CONDITIONS,
  normalizeStatus,
  normalizeCondition,
  normalizePriceMode,
  normalizeAdjustment,
  applyAdjustment,
  computeCardPayments,
  CARD_INSTALLMENT_RATE,
  CARD_INSTALLMENTS,
  normalizeItem,
  normalizeOptionPresentation,
  computeOption,
  normalizeOptions,
  bestOption,
  isoDateOnly,
  todayIso,
  addDaysIso,
  validateDates,
  aggregateProductQuantities,
  effectiveStatus,
  normalizeTemplate,
  statusLabel,
  sourceLabel,
  rejectionLabel,
  roundMoney,
  cents,
  moneyFromCents,
  str,
  num
};
