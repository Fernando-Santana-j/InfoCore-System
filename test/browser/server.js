"use strict";
// Browser fixtures run real operational routers and page assets, with an isolated DB.
const express = require("express");
const path = require("node:path");
const MemoryFirestore = require("../helpers/memory-firestore");
const { operationalFields } = require("../../lib/operations-domain");
const fs = require("node:fs");
const vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "../../index.js"), "utf8");
const budgetDomain = require("../../lib/budget-domain");
const context = { budgetDomain, selectBudgetOption: budgetDomain.bestOption };
vm.runInNewContext(
  source.slice(
    source.indexOf("function publicBudgetOption("),
    source.indexOf("function setPrivateShareHeaders("),
  ),
  context,
);
const app = express();
app.use(express.json());
app.set("views", path.join(__dirname, "../../views"));
app.set("view engine", "ejs");
app.use(express.static(path.join(__dirname, "../../public")));
const admin = {
  id: "admin",
  email: "admin@example.test",
  name: "Ana",
  type: "admin",
};
const service = {
  id: "os",
  code: "OS-001",
  customerId: "c",
  customerName: "Maria",
  customerPhone: "79999999999",
  deviceBrandModel: "Notebook",
  deviceType: "Notebook",
  issueReport: "Não liga",
  status: "done",
  checklist: [],
  createdAt: "2026-10-01T00:00:00Z",
  budgetId: "b",
  estimateValue: 100,
  ...operationalFields({}),
};
const budget = {
  id: "b",
  code: "ORC-001",
  customerId: "c",
  customerName: "Maria",
  status: "draft",
  issuedAt: "2026-10-07",
  validUntil: "2026-11-07",
  warrantyText: "Garantia descrita por item no comprovante.",
  notes: "Retirada mediante conferência.",
  deadline: "Até 3 dias úteis após aprovação",
  options: [
    {
      id: "o",
      name: "Reparo",
      recommended: true,
      items: [
        {
          id: "i",
          name: "Diagnóstico",
          kind: "custom",
          qty: 1,
          unitPrice: 100,
          unitCost: 20,
          total: 100,
        },
      ],
      total: 100,
      subtotal: 100,
    },
  ],
  total: 100,
};
let db;
function reset() {
  db = new MemoryFirestore({
    "users/admin": admin,
    "users/tech": {
      id: "tech",
      name: "João",
      email: "tech@example.test",
      type: "technician",
    },
    "service_orders/os": service,
    "budgets/b": budget,
    "customers/c": { id: "c", name: "Maria", phone:"79999999999", email:"maria@example.test" },
    "products/p": {
      id: "p",
      name: "SSD",
      qty: 5,
      cost: 50,
      price: 100,
      itemType: "product",
      active: true,
    },
    "sales/s": {
      id: "s",
      code: "VENDA-001",
      client: "Maria",
      customerId: "c",
      total: 100,
      amountPaid: 20,
      cashier: admin,
    },
  });
}
reset();
const proxy = {
  collection: (...a) => db.collection(...a),
  runTransaction: (...a) => db.runTransaction(...a),
};
const models = {
  invalidate() {},
  findAll: async ({ colecao }) =>
    (await db.collection(colecao).get()).docs.map((d) => ({
      ...d.data(),
      id: d.id,
    })),
};
app.use((req, res, next) => {
  const role=req.get('x-test-role') || 'admin';
  req.session = { user: role === 'anonymous' ? null : role === 'admin' ? admin : {id:role,email:role+'@example.test',name:role === 'technician' ? 'Técnico' : 'Caixa',type:role} };
  next();
});
const verifyLogin = (q, r, n) => q.session.user ? n() : r.status(401).json({error:true});
const verifyAdminApi = (q, r, n) => q.session.user?.type === 'admin' ? n() : r.status(403).json({error:true});
const authContext={firestore:proxy,BUDGETS_COLLECTION:'budgets'};
vm.runInNewContext(source.slice(source.indexOf('async function verifyBudgetEditor('),source.indexOf('function isBudgetFinalized(')),authContext);
const deps = {
  firestore: proxy,
  models,
  verifyLogin,
  verifyAdminApi,
  normalizeService: (s) => ({ ...s, ...operationalFields(s) }),
  budgetForUser: (b) => b,
  saleForUser: (s) => s,
  QRCode: require("qrcode"),
};
require("../../lib/operations-routes")(app, deps);
require("../../lib/register-routes")(app, deps);
require("../../lib/customer-interests")(app, deps);
app.post(
  "/api/budgets/:id/public-link",
  require("../../lib/budget-public-link")({
    ...deps,
    fetchBudgetNormalized: async (id) => ({
      ...(await db.collection("budgets").doc(id).get()).data(),
      id,
    }),
  }),
);
require('../../lib/budget-requests').install(app,{
 ...deps,photoDir:'/tmp/infocore-browser-request-photos',buildBudget:async(body,{id})=>{
  const option=budgetDomain.computeOption({id:'o',name:'Proposta',items:body.items});
  return {payload:{...body,id,code:'ORC-SOL',createdAt:new Date().toISOString(),issuedAt:'2026-10-08',validUntil:'2026-11-08',options:[option],selectedOptionId:'o'}};
 }
});
app.post('/api/budgets',verifyAdminApi,(req,res)=>res.json({error:false}));
app.post('/api/budgets/image',authContext.verifyBudgetEditor,require('multer')({storage:require('multer').memoryStorage()}).single('image'),(req,res)=>res.json({imageUrl:'/img/logo_bg.png'}));
app.post("/__reset", (req, res) => {
  reset();
  res.json({ ok: true });
});
app.post('/__approve-budget/:id', async (req,res) => {
 await db.collection('budgets').doc(req.params.id).update({status:'approved',total:150});
 res.json({ok:true});
});
app.get('/services/:id', async (req,res) => {
 const data=await appData(req.session.user);
 data.service={...operationalFields({}),...db.records.get('service_orders/'+req.params.id)};
 res.render('layout',{body:'service-work',bootstrap:'',currentPath:req.path,appData:data});
});
app.post('/__budget', async (req, res) => {
  await db.collection('budgets').doc('b').set(req.body, {merge:true});
  res.json({ok:true});
});
async function appData(user = admin) {
  return {
    user,
    configs: { storeName: "InfoCore Teste" },
    cart: [],
    products: await models.findAll({ colecao: "products" }),
    sales: [],
    budgets: await models.findAll({ colecao: "budgets" }),
    customers: await models.findAll({ colecao: "customers" }),
    clients: [],
    services: await models.findAll({ colecao: "service_orders" }),
    service: { ...db.records.get("service_orders/os") },
    cashFlowEntries: [],
    budgetTemplates: [],
    serviceWorkTemplates: [],
    serviceChecklistTemplates: { base: [], byDevice: {} },
    whatsapp: {},
  };
}
app.get("/api/customers", async(req,res)=>res.json({customers:await models.findAll({colecao:"customers"})}));
app.get("/api/bootstrap/:scope", async (req, res) => res.json(await appData(req.session.user)));
app.get("/api/services/work-templates", (req, res) =>
  res.json({ templates: [] }),
);
app.get("/api/config", async (req, res) => res.json({ configs: {} }));
app.post("/api/budgets/template", (req, res) =>
  res.json({
    html: "<html><body><h1>Orçamento ORC-001</h1><p>Maria · R$ 100,00</p></body></html>",
  }),
);
app.get("/api/shared-notes", (req, res) =>
  res.json({ notes: { content: "" } }),
);
app.get("/p/orcamento/:token", async (req, res) => {
  const rows = await models.findAll({ colecao: "budgets" });
  const b = rows.find((b) => b.publicToken === req.params.token);
  if (!b) return res.sendStatus(404);
  res.render("budget-share-public", {
    budget: context.publicBudgetView(b),
    configs: { storeName: "InfoCore" },
    response: {},
    token: req.params.token,
  });
});
app.get("/services/os", async (req, res) =>
  res.render("layout", {
    body: "service-work",
    bootstrap: "",
    currentPath: req.path,
    appData: await appData(req.session.user),
  }),
);
for (const page of [
  "budgets",
  "budget-requests",
  "pdv",
  "attendances",
  "services",
  "dashboard",
  "cashflow",
  "clients",
  "analytics",
  "config",
])
  app.get("/" + page, async (req, res) =>
    res.render("layout", {
      body: page,
      bootstrap: page,
      currentPath: req.path,
      appData: await appData(req.session.user),
    }),
  );
app.use("/api", (req, res) =>
  res.json({
    error: false,
    templates: [],
    service: db.records.get("service_orders/os"),
  }),
);
app.listen(3199, "127.0.0.1", () =>
  console.log("Isolated browser fixtures on 3199"),
);
