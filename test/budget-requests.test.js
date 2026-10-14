const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const DB = require("./helpers/memory-firestore");
const {
  install,
  normalizeInput,
  imageType,
} = require("../lib/budget-requests");
const domain = require("../lib/budget-domain");
const input = {
  id: "request-0000001",
  customerName: "Maria",
  customerPhone: "79999999999",
  device: "Notebook",
  description: "Desliga sozinho",
  problems: ["Superaquecimento", "inventado"],
};
function setup() {
  const db = new DB(),
    routes = new Map(),
    app = {};
  for (const method of ["get", "post", "patch", "delete"])
    app[method] = (p, ...h) => routes.set(method + " " + p, h);
  const drafts = [];
  install(app, {
    firestore: db,
    models: { invalidate() {}, async findAll({colecao}) { return (await db.collection(colecao).get()).docs.map(d=>({...d.data(),id:d.id})); } },
    verifyLogin: (q, r, n) => n(),
    verifyAdminApi: (q, r, n) =>
      q.session.user.type === "admin"
        ? n()
        : r.status(403).json({ error: true }),
    buildBudget: async (body, { id }) => {
      drafts.push(body);
      return { payload: { ...body, id, options: [{ items: body.items }] } };
    },
  });
  const call = async (
    method,
    path,
    role,
    body = {},
    params = { id: input.id },
    query = {},
  ) => {
    const req = {
      query,
      body,
      params,
      session: { user: { type: role, email: role + "@test", name: role } },
    };
    const res = {
      code: 200,
      status(c) {
        this.code = c;
        return this;
      },
      json(b) {
        this.body = b;
        return this;
      },
    };
    let i = 0;
    const h = routes.get(method + " " + path),
      next = () => h[i++]?.(req, res, next);
    await next();
    return res;
  };
  return { db, call, drafts };
}
test("request validates context and restricts checklist to known problems", () => {
  assert.deepEqual(normalizeInput(input).problems, ["Superaquecimento"]);
  assert.throws(() => normalizeInput({ ...input, customerPhone: "123" }));
  assert.throws(() =>
    normalizeInput({ ...input, description: "", problems: [] }),
  );
  assert.throws(() => normalizeInput({ ...input, device: "" }));
  assert.equal(imageType(Buffer.from("<script>alert(1)</script>")), "");
  assert.equal(
    imageType(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0])),
    "png",
  );
});
test("cashier can request but cannot approve or create a quote; technician requires approval", async () => {
  const { db, call } = setup();
  assert.equal(
    (await call("post", "/api/budget-requests", "cashier", input)).code,
    200,
  );
  assert.equal(
    (
      await call("patch", "/api/budget-requests/:id/review", "cashier", {
        status: "approved",
        reviewNotes: "OK",
      })
    ).code,
    403,
  );
  assert.equal(
    (await call("post", "/api/budget-requests/:id/budget", "cashier")).code,
    403,
  );
  assert.equal(
    (await call("post", "/api/budget-requests/:id/budget", "technician")).code,
    409,
  );
  assert.equal(
    (
      await call("patch", "/api/budget-requests/:id/review", "technician", {
        status: "approved",
      })
    ).code,
    400,
  );
  assert.equal(db.records.get("budget_requests/" + input.id).status, "open");
});
test("approved intake converts once and preserves contact, report, photos and analysis", async () => {
  const { db, call, drafts } = setup();
  await call("post", "/api/budget-requests", "cashier", input);
  await call("post", "/api/budget-requests", "cashier", input);
  assert.equal((await db.collection("budget_requests").get()).size, 1);
  await db
    .collection("budget_requests")
    .doc(input.id)
    .update({ photos: [{ id: "p", url: "/api/budget-requests/r/photos/p" }] });
  await call("patch", "/api/budget-requests/:id/review", "technician", {
    status: "approved",
    reviewNotes: "Limpeza e troca de pasta térmica",
  });
  const results = await Promise.all([
    call("post", "/api/budget-requests/:id/budget", "technician"),
    call("post", "/api/budget-requests/:id/budget", "admin"),
  ]);
  assert.ok(results.every((r) => r.code === 200));
  assert.equal(results[0].body.budgetId, results[1].body.budgetId);
  const budget = db.records.get("budgets/" + results[0].body.budgetId);
  assert.equal(budget.customerName, "Maria");
  assert.equal(budget.customerPhone, input.customerPhone);
  assert.match(budget.notes, /Desliga sozinho/);
  assert.match(budget.notes, /Superaquecimento/);
  assert.equal(budget.intake.photos.length, 1);
  assert.match(budget.internalNotes, /pasta térmica/);
  assert.equal(budget.status, "draft");
  assert.equal((await db.collection("budgets").get()).size, 1);
  assert.equal(
    (
      await call("patch", "/api/budget-requests/:id/review", "technician", {
        status: "rejected",
        reviewNotes: "x",
      })
    ).code,
    409,
  );
});
test("technical quote editing requires a valid approved request link; cashier is denied", async () => {
  const source = fs.readFileSync(require.resolve("../index"), "utf8"),
    db = new DB({
      "budgets/b": { requestId: "r" },
      "budget_requests/r": { status: "converted", budgetId: "b" },
      "budgets/unlinked": {},
    });
  const ctx = { firestore: db, BUDGETS_COLLECTION: "budgets" };
  vm.runInNewContext(
    source.slice(
      source.indexOf("async function verifyBudgetEditor("),
      source.indexOf("function isBudgetFinalized("),
    ),
    ctx,
  );
  async function check(role, id) {
    let allowed = false,
      code = 200;
    await ctx.verifyBudgetEditor(
      { session: { user: { type: role } }, params: { id }, query: {} },
      {
        status(c) {
          code = c;
          return this;
        },
        json() {},
      },
      () => {
        allowed = true;
      },
    );
    return { allowed, code };
  }
  assert.deepEqual(await check("technician", "b"), {
    allowed: true,
    code: 200,
  });
  assert.equal((await check("technician", "unlinked")).code, 403);
  assert.equal((await check("cashier", "b")).code, 403);
  assert.equal((await check("admin", "unlinked")).allowed, true);
});
test("item images survive normalization; print includes them only on opt-in", () => {
  const item = domain.normalizeItem({
    id: "i",
    name: "<SSD>",
    qty: 1,
    unitPrice: 100,
    imageUrl: "/uploads/photo.png",
  });
  assert.equal(item.imageUrl, "/uploads/photo.png");
  assert.equal(
    domain.normalizeItem({
      images: [
        "/uploads/a.png",
        "/uploads/b.png",
        "/uploads/c.png",
        "/uploads/d.png",
        "/uploads/e.png",
      ],
    }).images.length,
    4,
  );
  assert.equal(
    domain.normalizeItem({ imageUrl: "javascript:alert(1)" }).imageUrl,
    "",
  );
  const source = fs.readFileSync(require.resolve("../index"), "utf8"),
    ctx = {
      budgetItemConditionLabel: () => "",
      budgetHtmlValue: (v) =>
        String(v)
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/"/g, "&quot;"),
      moneyBr: (n) => String(n),
    };
  vm.runInNewContext(
    source.slice(
      source.indexOf("function buildBudgetRowsHtmlFromItems("),
      source.indexOf("function buildBudgetOptionHtml("),
    ),
    ctx,
  );
  assert.doesNotMatch(ctx.buildBudgetRowsHtmlFromItems([item], true), /<img/);
  assert.match(
    ctx.buildBudgetRowsHtmlFromItems([item], true, true),
    /<img src="\/uploads\/photo.png"/,
  );
  assert.match(
    ctx.buildBudgetRowsHtmlFromItems([item], true, true),
    /&lt;SSD>/,
  );
});

test("service conversion requires reviewer, destination and approved budget; concurrent retries preserve full intake once", async () => {
  const { db, call } = setup();
  await call("post", "/api/budget-requests", "cashier", {
    ...input,
    deviceType: "Notebook",
    serialNumber: "ABC123",
    accessories: "Fonte",
    physicalCondition: "Risco na tampa",
    priority: "high",
  });
  assert.equal(
    (await call("post", "/api/budget-requests/:id/service", "cashier")).code,
    403,
  );
  assert.equal(
    (await call("post", "/api/budget-requests/:id/service", "technician")).code,
    409,
  );
  assert.equal(
    (
      await call("patch", "/api/budget-requests/:id/destination", "cashier", {
        destination: "service_after_approval",
      })
    ).code,
    403,
  );
  await call("patch", "/api/budget-requests/:id/review", "technician", {
    status: "approved",
    reviewNotes: "Verificar refrigeração",
    destination: "service_after_approval",
  });
  const budget = await call(
    "post",
    "/api/budget-requests/:id/budget",
    "technician",
  );
  assert.equal(
    (await call("post", "/api/budget-requests/:id/service", "technician")).code,
    409,
  );
  const budgetRef = db.collection("budgets").doc(budget.body.budgetId);
  await budgetRef.update({ status: "approved", total: 150 });
  await db
    .collection("budget_requests")
    .doc(input.id)
    .update({ photos: [{ id: "p", url: "/api/budget-requests/r/photos/p" }] });
  const responses = await Promise.all([
    call("post", "/api/budget-requests/:id/service", "technician"),
    call("post", "/api/budget-requests/:id/service", "admin"),
  ]);
  assert.ok(responses.every((r) => r.code === 200));
  assert.equal(responses[0].body.serviceId, responses[1].body.serviceId);
  const service = responses[0].body.service;
  assert.equal(service.customerName, "Maria");
  assert.equal(service.serialNumber, "ABC123");
  assert.equal(service.accessories, "Fonte");
  assert.equal(service.physicalCondition, "Risco na tampa");
  assert.equal(service.priority, "high");
  assert.equal(service.intake.photos.length, 1);
  assert.equal(service.intake.reviewNotes, "Verificar refrigeração");
  assert.equal(service.checklist[0].label, "Superaquecimento");
  assert.equal(service.estimateValue, 150);
  assert.equal((await db.collection("service_orders").get()).size, 1);
  assert.equal((await budgetRef.get()).data().serviceOrderId, service.id);
  assert.equal(
    (
      await call("patch", "/api/budget-requests/:id/destination", "admin", {
        destination: "budget_only",
      })
    ).code,
    409,
  );
});

test("budget-only intake cannot create service even when quote is approved", async () => {
  const { db, call } = setup();
  await call("post", "/api/budget-requests", "cashier", input);
  await call("patch", "/api/budget-requests/:id/review", "admin", {
    status: "approved",
    reviewNotes: "Proposta somente",
  });
  const b = await call("post", "/api/budget-requests/:id/budget", "admin");
  await db
    .collection("budgets")
    .doc(b.body.budgetId)
    .update({ status: "approved" });
  assert.equal(
    (await call("post", "/api/budget-requests/:id/service", "admin")).code,
    409,
  );
  assert.equal((await db.collection("service_orders").get()).size, 0);
});

test("real service normalization and persistence preserve request snapshot and intake fields", () => {
  const source = fs.readFileSync(require.resolve("../index"), "utf8");
  const ctx = {
    randomUUID: () => "id",
    serviceDisplayCode: () => "OS-1",
    toDateSafe: (v) => (v ? new Date(v) : null),
    operationalFields: () => ({}),
    normalizePcDiagnostic: () => null,
  };
  vm.runInNewContext(
    source.slice(
      source.indexOf("function normalizeServicePhotoItem("),
      source.indexOf("function serviceForUser("),
    ),
    ctx,
  );
  const start = source.indexOf("function serviceOrderFirestorePayload(");
  vm.runInNewContext(
    source.slice(start, source.indexOf("\nfunction ", start + 1)),
    ctx,
  );
  const row = ctx.serviceOrderFirestorePayload({
    id: "s",
    requestId: "r",
    intake: { description: "Entrada", photos: [{ id: "p" }] },
    serialNumber: "ABC",
    physicalCondition: "Risco",
  });
  assert.equal(row.requestId, "r");
  assert.equal(row.intake.photos[0].id, "p");
  assert.equal(row.serialNumber, "ABC");
  assert.equal(row.physicalCondition, "Risco");
});


test('legacy service endpoint denies cashier and rejects creation without approved-budget selection', async () => {
 const source=fs.readFileSync(require.resolve('../index'),'utf8');
 let handler;
 const ctx={app:{post:(_path,_auth,fn)=>handler=fn},verifyLogin:()=>{}};
 const start=source.indexOf("app.post('/api/services', verifyLogin");
 const end=source.indexOf("\napp.",start+1);
 vm.runInNewContext(source.slice(start,end),ctx);
 async function call(type,body) {const r={code:200,status(n){this.code=n;return this},json(b){this.body=b;return this}};await handler({session:{user:{type}},body},r);return r;}
 assert.equal((await call('cashier',{existingBudgetId:'b'})).code,403);
 assert.equal((await call('admin',{skipBudget:true})).code,400);
 assert.equal((await call('technician',{skipBudget:true})).code,400);
});


test('intake metadata provides checklist without reading requests or customer records',async()=>{
  const {call,db}=setup();
  db.collection=()=>{throw new Error('Unexpected database read')};
  const result=await call('get','/api/budget-requests/intake-options','cashier');
  assert.equal(result.code,200);
  assert.ok(result.body.problems.includes('Não liga'));
  assert.equal(result.body.customers,undefined);
});

test('intake customer choices expose only required contact fields',async()=>{
  const {db,call}=setup();
  await db.collection('customers').doc('c').set({name:'Maria',phone:'79999999999',email:'maria@test',internalNotes:'private'});
  const result=await call('get','/api/budget-requests/intake-options','cashier',{}, {}, {customers:'1'});
  assert.equal(result.code,200);
  assert.deepEqual(result.body.customers,[{id:'c',name:'Maria',phone:'79999999999',email:'maria@test',doc:''}]);
});
