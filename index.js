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
const { randomUUID } = require('crypto');
// const config = require('./config/config.json');

const PRODUCTS_COLLECTION = 'products';
const SALES_COLLECTION = 'sales';
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

function productSkuFromId(id) {
    const hex = String(id || '').replace(/-/g, '');
    const part = (hex.slice(0, 10) || randomUUID().replace(/-/g, '').slice(0, 10)).toUpperCase();
    return `PRD-${part}`;
}

function normalizeProduct(row) {
    const d = row && typeof row === 'object' ? row : {};
    const id = d.id != null ? d.id : '';
    let sku = String(d.sku || '');
    if (!sku && id) sku = productSkuFromId(id);
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
        const rows = await db.findAll({ colecao: PRODUCTS_COLLECTION });
        const list = Array.isArray(rows) ? rows : [];
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
    next()
    return
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
    req.session.user = {
        name: 'fernando',
        type: 'admin',
        email: 'admin@infocoretech.com.br',
        pass: 'Junio132sj.',
        error: false
      }

    res.render('layout', { body: 'dashboard',appData:{configs:configs, user:req.session.user, products} });
});

app.get('/pdv',verifyLogin, async (req, res) => {
    req.session.user = {
        name: 'fernando',
        type: 'admin',
        email: 'admin@infocoretech.com.br',
        pass: 'Junio132sj.',
        error: false
      }

    let configs = await db.findOne({ colecao: 'infocore', doc: 'configs' });
    
    const products = await loadProductsFromDb();
    res.render('layout', { body: 'pdv',appData:{configs:configs, user:req.session.user, products} });
});

app.get('/stock',verifyLogin, async (req, res) => {
    req.session.user = {
        name: 'fernando',
        type: 'admin',
        email: 'admin@infocoretech.com.br',
        pass: 'Junio132sj.',
        error: false
      };

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
    const sku = productSkuFromId(id);
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
    if (user && (user.name || user.email)) {
        saleRecord.cashier = {
            name: user.name != null ? String(user.name) : '',
            email: user.email != null ? String(user.email) : ''
        };
    }

    const batch = firestore.batch();
    const saleRef = firestore.collection(SALES_COLLECTION).doc(saleId);
    batch.set(saleRef, saleRecord);

    const updatedProducts = [];
    for (const u of stockUpdates) {
        const ref = firestore.collection(PRODUCTS_COLLECTION).doc(u.id);
        batch.update(ref, { qty: u.nextQty });
        updatedProducts.push(normalizeProduct({ ...u.p, id: u.id, qty: u.nextQty }));
    }

    try {
        await batch.commit();
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

    return res.json({ error: false, sale: saleResponse, products: updatedProducts });
});

app.get('/sells', (req, res) => {
    res.render('layout', { body: 'sells' });
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