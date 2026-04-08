//TODO-------------importes------------
const express = require('express')
const fs = require('fs');
const bodyParser = require('body-parser');
const session = require('express-session')
const path = require('path');
const multer = require('multer')
const cookieParser = require("cookie-parser");
const mercadopago = require('mercadopago');
// const config = require('./config/config.json');

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
        cb(null, __dirname + '/uploads/')
    },
    filename: function (req, file, cb) {
        const codigo = require('crypto').randomBytes(42).toString('hex');
        const originalName = file.originalname;
        const extension = originalName.substr(originalName.lastIndexOf('.'));
        const fileName = codigo + extension;
        cb(null, `${fileName}`)
    }
});

const upload = multer({ storage });









//TODO------------WEB PAGE--------------

app.get('/', (req, res) => {
    res.render('layout', { body: 'dashboard' });
});

app.get('/dashboard', (req, res) => {
    res.render('layout', { body: 'dashboard' });
});

app.get('/pdv', (req, res) => {
    res.render('layout', { body: 'pdv' });
});

app.get('/stock', (req, res) => {
    res.render('layout', { body: 'stock' });
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

