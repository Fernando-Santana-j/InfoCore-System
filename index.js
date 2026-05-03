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
const { randomUUID } = require("crypto");
const nodemailer = require('nodemailer');
// const config = require('./config/config.json');

const PRODUCTS_COLLECTION = 'products';
const SALES_COLLECTION = 'sales';
const BUDGETS_COLLECTION = 'budgets';
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

function computeSaleAmounts(subtotal, discountAdj, extraAdj) {
    const discount = discountAdj.type === 'percent'
        ? (subtotal * discountAdj.value) / 100
        : discountAdj.value;
    const extra = extraAdj.type === 'percent'
        ? (subtotal * extraAdj.value) / 100
        : extraAdj.value;
    const total = Math.max(0, subtotal - discount + extra);
    return {
        discountAmount: discount,
        extraAmount: extra,
        total
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
            total: Number(item?.total) || 0
        })) : [],
        subtotal,
        discount,
        extra,
        total,
        createdAt: r.createdAt || null,
        updatedAt: r.updatedAt || null,
        finalizedAt: r.finalizedAt || null
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
        items: Array.isArray(r.items) ? r.items.map((item) => ({
            id: item?.id != null ? String(item.id) : '',
            sku: item?.sku != null ? String(item.sku) : '',
            name: item?.name != null ? String(item.name) : '',
            category: item?.category != null ? String(item.category) : '',
            price: Number(item?.price) || 0,
            qty: Number(item?.qty) || 0,
            lineTotal: Number(item?.lineTotal) || ((Number(item?.price) || 0) * (Number(item?.qty) || 0))
        })) : [],
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

function safeTemplateValue(value) {
    return String(value == null ? '' : value);
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

function buildBudgetRowsHtml(budget) {
    const items = Array.isArray(budget?.items) ? budget.items : [];
    return items.map((item) => `
<tr>
  <td style="padding:8px;border-bottom:1px solid #e5e7eb;">${safeTemplateValue(item.name || '')}</td>
  <td style="padding:8px;border-bottom:1px solid #e5e7eb;text-align:center;">${safeTemplateValue(item.qty || 0)}</td>
  <td style="padding:8px;border-bottom:1px solid #e5e7eb;text-align:right;">${moneyBr(item.unitPrice || 0)}</td>
  <td style="padding:8px;border-bottom:1px solid #e5e7eb;text-align:right;font-weight:700;">${moneyBr((Number(item.qty) || 0) * (Number(item.unitPrice) || 0))}</td>
</tr>`).join('');
}

function buildBudgetRowsText(budget) {
    const items = Array.isArray(budget?.items) ? budget.items : [];
    return items.map((item) => `- ${safeTemplateValue(item.name || 'Item')} (x${Number(item.qty) || 0}) ${moneyBr((Number(item.qty) || 0) * (Number(item.unitPrice) || 0))}`).join('\n');
}

function budgetTemplateData(budget) {
    const logoUrl = process.env.APP_PUBLIC_BASE_URL
        ? `${String(process.env.APP_PUBLIC_BASE_URL).replace(/\/$/, '')}/public/img/logo_bg.png`
        : '/public/img/logo_bg.png';
    return {
        code: safeTemplateValue(budget?.code || 'ORC'),
        customerName: safeTemplateValue(budget?.customerName || 'Não informado'),
        customerPhone: safeTemplateValue(budget?.customerPhone || '-'),
        customerEmail: safeTemplateValue(budget?.customerEmail || '-'),
        validUntil: safeTemplateValue(budget?.validUntil || '-'),
        notes: safeTemplateValue(budget?.notes || '-'),
        subtotal: moneyBr(budget?.subtotal || 0),
        discount: moneyBr(budget?.discount || 0),
        extra: moneyBr(budget?.extra || 0),
        total: moneyBr(budget?.total || 0),
        status: safeTemplateValue(String(budget?.status || 'draft') === 'finalized' ? 'Finalizado' : 'Rascunho'),
        itemsRowsHtml: buildBudgetRowsHtml(budget),
        itemsRowsText: buildBudgetRowsText(budget),
        logoUrl
    };
}

function renderBudgetTemplateHtml(kind, budget) {
    const file = kind === 'image' ? 'image.html' : 'pdf.html';
    const fallback = `
<div style="font-family:Arial,sans-serif;max-width:760px;margin:0 auto;">
  <h2>Orçamento {{code}}</h2>
  <p>Cliente: {{customerName}}</p>
  <p>Total: {{total}}</p>
  <table style="width:100%"><tbody>{{itemsRowsHtml}}</tbody></table>
  <p>Assinatura do cliente: ____________________________</p>
</div>`;
    return renderTemplateString(readBudgetTemplate(file, fallback), budgetTemplateData(budget));
}

function renderBudgetTemplateText(kind, budget) {
    const file = kind === 'email' ? 'email.html' : 'whatsapp.txt';
    const fallback = kind === 'email'
        ? `<h2>Orçamento {{code}}</h2><p>Total: {{total}}</p><pre>{{itemsRowsText}}</pre>`
        : `*Orçamento {{code}}*\nTotal: {{total}}\n{{itemsRowsText}}`;
    return renderTemplateString(readBudgetTemplate(file, fallback), budgetTemplateData(budget));
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
    const apiUrl = String(process.env.WHATSAPP_API_URL || '').trim();
    if (!apiUrl) return { sent: false, skipped: true, reason: 'WHATSAPP_API_URL não configurada.' };
    const token = String(process.env.WHATSAPP_API_TOKEN || '').trim();
    const text = renderBudgetTemplateText('whatsapp', budget);
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    await axios.post(apiUrl, { to, message: text }, { headers, timeout: 12000 });
    return { sent: true };
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
    return {
        id,
        sku,
        name: String(d.name || ''),
        category: String(d.category || '').trim() || 'others',
        emoji: String(d.emoji || '📦'),
        image,
        cost: Number(d.cost) || 0,
        price: Number(d.price) || 0,
        qty: Number.parseInt(String(d.qty), 10) || 0,
        min: Number.parseInt(String(d.min), 10) || 0,
        active: d.active !== false,
        description: d.description != null ? String(d.description) : ''
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

app.use(session({
    secret: process.env.SECRET || 'infocore-fajg3bi2bt3fi3nt2fajbf2',
    resave: false,
    saveUninitialized: true,
    cookie: {
        maxAge: 3600000
    }
}));
app.use(cookieParser());

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json())

app.use(express.static('views'));
app.use(express.static('public'));
app.use(express.static('uploads'));
app.use(express.static('src'));

app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use('/uploads', express.static(path.join(__dirname, 'src')));
app.use('/public', express.static(path.join(__dirname, 'public')));

app.set('views', path.join(__dirname, '/views'))
app.set('view engine', 'ejs');


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
        return res.redirect('/login');
    }
    next();
}

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

app.get('/dashboard',verifyLogin, async (req, res) => {
    let configs = await db.findOne({ colecao: 'infocore', doc: 'configs' });
    const products = await loadProductsFromDb();

    res.render('layout', { body: 'dashboard',appData:{configs:configs, user:req.session.user, products} });
});

app.get('/pdv',verifyLogin, async (req, res) => {
   
    let configs = await db.findOne({ colecao: 'infocore', doc: 'configs' });
    
    const products = await loadProductsFromDb();
    const budgetRows = await db.findAll({ colecao: BUDGETS_COLLECTION }).catch(() => []);
    const budgets = Array.isArray(budgetRows) ? budgetRows.map(normalizeBudgetRow) : [];
    res.render('layout', { body: 'pdv',appData:{configs:configs, user:req.session.user, products, budgets} });
});

app.get('/budgets', verifyLogin, async (req, res) => {
    const configs = await db.findOne({ colecao: 'infocore', doc: 'configs' });
    const products = await loadProductsFromDb();
    const budgetRows = await db.findAll({ colecao: BUDGETS_COLLECTION }).catch(() => []);
    const budgets = Array.isArray(budgetRows) ? budgetRows.map(normalizeBudgetRow) : [];
    res.render('layout', { body: 'budgets', appData: { configs, user: req.session.user, products, budgets } });
});

app.get('/stock',verifyLogin, async (req, res) => {
    if (req.session.user.type !== 'admin') {
        return res.redirect('/dashboard');
    }
    const configs = await db.findOne({ colecao: 'infocore', doc: 'configs' });
    const products = await loadProductsFromDb();
    res.render('layout', { body: 'stock', appData: { configs, user: req.session.user, products } });
});

app.post('/api/products', verifyLogin, uploadProductImage, async (req, res) => {
    const body = req.body || {};
    const name = String(body.name || '').trim();
    const category = String(body.category || 'others').trim() || 'others';
    const description = body.description != null ? String(body.description).trim() : '';

    if (!name) {
        return res.status(400).json({ error: true, message: 'Nome do produto é obrigatório.' });
    }

    const cost = parseMoneyField(body.cost);
    const price = parseMoneyField(body.price);
    const qty = Number.parseInt(String(body.qty), 10) || 0;
    const min = Number.parseInt(String(body.min), 10) || 10;

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
        emoji: '📦',
        image,
        cost,
        price,
        qty,
        min,
        active: true
    };
    if (description) payload.description = description;

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
    if (body.cost != null) patch.cost = parseMoneyField(body.cost);
    if (body.price != null) patch.price = parseMoneyField(body.price);
    if (body.qty != null) patch.qty = Number.parseInt(String(body.qty), 10) || 0;
    if (body.min != null) patch.min = Number.parseInt(String(body.min), 10) || 0;
    if (body.description != null) {
        const d = String(body.description).trim();
        if (d) patch.description = d;
    }
    if (req.file) patch.image = `/uploads/${req.file.filename}`;

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

app.post('/api/budgets', verifyLogin, async (req, res) => {
    const body = req.body || {};
    const rawItems = Array.isArray(body.items) ? body.items : [];
    if (rawItems.length === 0) {
        return res.status(400).json({ error: true, message: 'Adicione ao menos 1 item ao orçamento.' });
    }

    const items = [];
    let subtotal = 0;
    for (const row of rawItems) {
        const kind = String(row?.kind || 'custom') === 'product' ? 'product' : 'custom';
        const qty = Number(row?.qty);
        const unitPrice = Number(row?.unitPrice);
        const name = String(row?.name || '').trim();
        if (!Number.isFinite(qty) || qty <= 0 || !Number.isFinite(unitPrice) || unitPrice < 0 || !name) {
            return res.status(400).json({ error: true, message: 'Item inválido no orçamento.' });
        }
        const lineTotal = Math.round(qty * unitPrice * 100) / 100;
        subtotal += lineTotal;
        items.push({
            id: randomUUID(),
            kind,
            productId: row?.productId != null ? String(row.productId) : '',
            sku: row?.sku != null ? String(row.sku) : '',
            name,
            qty,
            unitPrice,
            total: lineTotal
        });
    }

    const discount = Math.max(0, Number(body.discount) || 0);
    const extra = Math.max(0, Number(body.extra) || 0);
    const total = Math.max(0, Math.round((subtotal - discount + extra) * 100) / 100);
    const status = String(body.status || 'draft') === 'finalized' ? 'finalized' : 'draft';
    const now = FieldValue.serverTimestamp();
    const id = randomUUID();
    const code = budgetDisplayCode();
    const payload = {
        id,
        code,
        customerName: String(body.customerName || '').trim(),
        customerPhone: String(body.customerPhone || '').trim(),
        customerEmail: String(body.customerEmail || '').trim(),
        notes: String(body.notes || '').trim(),
        validUntil: String(body.validUntil || '').trim(),
        items,
        subtotal,
        discount,
        extra,
        total,
        status,
        createdAt: now,
        updatedAt: now
    };
    if (status === 'finalized') payload.finalizedAt = now;

    try {
        await db.create(BUDGETS_COLLECTION, id, payload);
        const budget = normalizeBudgetRow(payload);
        let notifications = null;
        if (status === 'finalized') {
            notifications = await dispatchBudgetNotifications(budget);
        }
        return res.json({ error: false, budget, notifications });
    } catch (e) {
        console.error(e);
        return res.status(500).json({ error: true, message: 'Erro ao salvar orçamento.' });
    }
});

app.patch('/api/budgets/:id/finalize', verifyLogin, async (req, res) => {
    const id = String(req.params.id || '').trim();
    if (!id) return res.status(400).json({ error: true, message: 'ID inválido.' });
    const patch = { status: 'finalized', updatedAt: FieldValue.serverTimestamp(), finalizedAt: FieldValue.serverTimestamp() };
    try {
        await db.update(BUDGETS_COLLECTION, id, patch);
        const snap = await firestore.collection(BUDGETS_COLLECTION).doc(id).get();
        if (!snap.exists) return res.status(404).json({ error: true, message: 'Orçamento não encontrado.' });
        const budget = normalizeBudgetRow({ id, ...snap.data() });
        const notifications = await dispatchBudgetNotifications(budget);
        return res.json({ error: false, budget, notifications });
    } catch (e) {
        console.error(e);
        return res.status(500).json({ error: true, message: 'Erro ao finalizar orçamento.' });
    }
});
const MP_TOKEN = process.env.MERCADOPAGO_ACCESS_TOKEN;
const MP_DEVICE_ID = process.env.MERCADOPAGO_DEVICE_ID || "PAX_Q92__Q92-1733817193";
const MP_ENABLED = Boolean(MP_TOKEN && MP_DEVICE_ID);

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

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function toMoneyAmount(value) {
    return (Math.round((Number(value) || 0) * 100) / 100).toFixed(2);
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

async function cancelPointOrder(orderId) {
    if (!orderId) return;
    try {
        await api.put(`/v1/orders/${orderId}/cancel`, {}, { headers: { "X-Idempotency-Key": randomUUID() } });
    } catch (err) {
        const status = err?.response?.status;
        if (status && [400, 404, 409].includes(status)) return;
        throw err;
    }
}

async function cancelAnyPendingPointOrder() {
    if (!activePointOrderId) return;
    await cancelPointOrder(activePointOrderId);
    activePointOrderId = null;
}

async function cancelAllKnownPendingSales() {
    const orderIds = new Set();
    if (activePointOrderId) orderIds.add(activePointOrderId);
    for (const pending of pendingPointSales.values()) {
        if (pending?.mode === 'point' && pending?.pointOrderId) {
            orderIds.add(pending.pointOrderId);
        }
    }
    for (const orderId of orderIds) {
        try {
            await cancelPointOrder(orderId);
        } catch (e) {
            console.error('Falha ao cancelar order pendente:', e?.response?.data || e);
        }
    }
    activePointOrderId = null;
    pendingPointSales.clear();
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

async function createPointOrder({ amount, payment, saleCode }) {
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
        let paymentMethod = { default_type: defaultType, default_installments: 1};
        if (defaultType === 'credit_card') {
            paymentMethod.installments_cost = 'buyer';
        }
        payload.config.payment_method = paymentMethod;
    }

    let createdOrder;
    try {
        ({ data: createdOrder } = await api.post('/v1/orders', payload, { headers: { "X-Idempotency-Key": randomUUID() } }));
    } catch (err) {
        const code = err?.response?.data?.errors?.[0]?.code;
        // Fallback para PIX: alguns terminais rejeitam default_type para QR.
        if (payment === 'pix' && payload.config.payment_method) {
            delete payload.config.payment_method;
            ({ data: createdOrder } = await api.post('/v1/orders', payload, { headers: { "X-Idempotency-Key": randomUUID() } }));
        } else if (code === 'already_queued_order_on_terminal') {
            await cancelAllKnownPendingSales();
            ({ data: createdOrder } = await api.post('/v1/orders', payload, { headers: { "X-Idempotency-Key": randomUUID() } }));
        } else {
            throw err;
        }
    }

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

async function createOnlinePixPayment({ amount, saleCode }) {
    await cancelAllKnownPendingSales();
    const payerEmail = process.env.MERCADOPAGO_PIX_PAYER_EMAIL || 'fernandoj132sj@gmail.com';
    const payload = {
        transaction_amount: Math.round((Number(amount) || 0) * 100) / 100,
        description: `Venda ${saleCode}`,
        payment_method_id: 'pix',
        external_reference: saleCode,
        payer: { email: payerEmail }
    };
    const { data } = await api.post('/v1/payments', payload, { headers: { "X-Idempotency-Key": randomUUID() } });
    console.log(data);
    return data;
}

async function getOnlinePixPaymentStatus(paymentId) {
    const { data } = await api.get(`/v1/payments/${paymentId}`);
    return data;
}

async function finalizeSaleInDb({ saleId, saleRecord, stockUpdates }) {
    const batch = firestore.batch();
    const saleRef = firestore.collection(SALES_COLLECTION).doc(saleId);
    batch.set(saleRef, saleRecord);

    const updatedProducts = [];
    for (const u of stockUpdates) {
        const ref = firestore.collection(PRODUCTS_COLLECTION).doc(u.id);
        batch.update(ref, { qty: u.nextQty });
        updatedProducts.push(normalizeProduct({ ...u.p, id: u.id, qty: u.nextQty }));
    }
    await batch.commit();
    return updatedProducts;
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

    const discountAdj = parseAdjustment(body, 'discount');
    const extraAdj = parseAdjustment(body, 'extra');
    const clientLabel = body.client != null ? String(body.client).trim() : '';
    const client = clientLabel || 'Balcão';

    const lines = [];
    for (const row of rawItems) {
        const id = String(row.id || '').trim();
        const qty = parsePositiveInt(row.qty);
        if (!id || !qty) {
            return res.status(400).json({ error: true, message: 'Item inválido no carrinho.' });
        }
        lines.push({ id, qty });
    }

    const resolvedItems = [];
    const stockUpdates = [];
    let subtotal = 0;

    for (const line of lines) {
        const snap = await firestore.collection(PRODUCTS_COLLECTION).doc(line.id).get();
        if (!snap.exists) {
            return res.status(400).json({ error: true, message: `Produto não encontrado (${line.id}).` });
        }
        const p = snap.data();
        if (p.active === false) {
            return res.status(400).json({ error: true, message: `Produto inativo: ${p.name || line.id}.` });
        }
        const stock = Number.parseInt(String(p.qty), 10) || 0;
        if (stock < line.qty) {
            return res.status(400).json({
                error: true,
                message: `Estoque insuficiente para "${p.name || 'produto'}". Disponível: ${stock}.`
            });
        }
        const price = Number(p.price) || 0;
        const lineTotal = price * line.qty;
        subtotal += lineTotal;
        const nextQty = Math.max(0, stock - line.qty);
        resolvedItems.push({
            id: line.id,
            sku: p.sku != null ? String(p.sku) : '',
            name: p.name != null ? String(p.name) : '',
            category: p.category != null ? String(p.category) : '',
            price,
            qty: line.qty,
            lineTotal
        });
        stockUpdates.push({ id: line.id, nextQty, p });
    }

    const { discountAmount, extraAmount, total } = computeSaleAmounts(subtotal, discountAdj, extraAdj);

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
        createdAt: FieldValue.serverTimestamp()
    };

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
        const pendingToken = randomUUID();
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
            pointOrder = await createPointOrder({ amount: total, payment, saleCode: code });
        } catch (e) {
            const details = e?.response?.data?.errors?.[0]?.details;
            console.error('Falha Mercado Pago:', e?.response?.data || e);
            return res.status(502).json({
                error: true,
                message: e.message || 'Falha ao comunicar com a maquininha.',
                payment: {
                    provider: 'mercado_pago_point',
                    approved: false,
                    reason: 'Erro de comunicação com a maquininha.',
                    details: Array.isArray(details) ? details.join(' | ') : undefined
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
    try {
        updatedProducts = await finalizeSaleInDb({ saleId, saleRecord, stockUpdates });
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
    return res.json({ error: false, sale: saleResponse, products: updatedProducts });
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
            : { provider: 'mercado_pago_point', approved: true, status: 'processed', orderId: pending.pointOrderId };

        if (pending.mode === 'point') {
            pending.saleRecord.paymentGateway = {
                provider: 'mercado_pago_point',
                status: successPayment.status,
                orderId: pending.pointOrderId
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

        const updatedProducts = await finalizeSaleInDb({
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
            payment: successPayment
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

app.delete('/api/sales/pending/:token', verifyLogin, async (req, res) => {
    const token = String(req.params.token || '').trim();
    const pending = pendingPointSales.get(token);
    if (!pending) return res.json({ error: false });
    try {
        if (pending?.mode === 'point') await cancelPointOrder(pending.pointOrderId);
    } catch (e) {
        console.error('Falha ao cancelar pagamento pendente:', e?.response?.data || e);
    } finally {
        pendingPointSales.delete(token);
        if (activePointOrderId === pending.pointOrderId) activePointOrderId = null;
    }
    return res.json({ error: false });
});

app.get('/sells', verifyLogin, async (req, res) => {
    const configs = await db.findOne({ colecao: 'infocore', doc: 'configs' });
    const products = await loadProductsFromDb();
    const salesRows = await db.findAll({ colecao: SALES_COLLECTION }).catch(() => []);
    const sales = Array.isArray(salesRows) ? salesRows.map(normalizeSaleRow) : [];
    res.render('layout', { body: 'sells', appData: { configs, user: req.session.user, products, sales } });
});

app.get('/products', (req, res) => {
    res.render('layout', { body: 'products' });
});

app.get('/clients', (req, res) => {
    res.render('layout', { body: 'clients' });
});

app.get('/analytics', (req, res) => {
    res.render('layout', { body: 'analytics' });
});

app.get('/config', (req, res) => {
    res.render('layout', { body: 'config' });
});

let port = process.env.PORT || 3131;
app.listen(port, () => {
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