"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const MemoryFirestore = require("./helpers/memory-firestore");
const { commitSale, quantities } = require("../lib/sale-transaction");
const {
  equipmentId,
  canDeliver,
  repairMetrics,
  date,
  hash,
} = require("../lib/operations-domain");
const install = require("../lib/operations-routes");
const installRegister = require("../lib/register-routes");
const admin = { email: "admin@example.test", type: "admin", name: "Admin" };
function server(db, user = admin, whatsapp) {
  const routes = new Map();
  const app = {};
  for (const method of ["get", "post", "patch", "delete"])
    app[method] = (path, ...handlers) =>
      routes.set(`${method} ${path}`, handlers);
  const login = (q, r, n) => n();
  const verifyAdminApi = (q, r, n) =>
    q.session.user.type === "admin" ? n() : r.status(403).json({ error: true });
  const deps = {
    firestore: db,
    models: {
      invalidate() {},
      findAll: async ({ colecao }) =>
        (await db.collection(colecao).get()).docs.map((d) => ({
          ...d.data(),
          id: d.id,
        })),
    },
    verifyLogin: login,
    verifyAdminApi,
    normalizeService: (s) => s,
    budgetForUser: (b) => b,
    saleForUser: (s) => s,
    QRCode: {},
    whatsapp,
  };
  install(app, deps);
  installRegister(app, deps);
  return async (method, path, params = {}, body = {}) => {
    const req = {
      body,
      params,
      session: { user },
      get: () => "localhost",
      protocol: "http",
    };
    let status = 200,
      result;
    const res = {
      status(s) {
        status = s;
        return this;
      },
      json(j) {
        result = j;
        return this;
      },
    };
    const handlers = routes.get(`${method} ${path}`);
    assert.ok(handlers, path);
    let i = 0;
    const next = () => handlers[i++]?.(req, res, next);
    await next();
    return { status, body: result };
  };
}
test("sale transaction aggregates repeated lines, preserves reservations and rolls back overselling", async () => {
  const db = new MemoryFirestore({
    "products/p": { qty: 5, reservedQty: 2 },
    ["register_active/" + hash(admin.email)]: { id: "shift", netCash: 0 },
  });
  const options = {
    firestore: db,
    saleId: "s",
    record: { total: 50, amountPaid: 10, payment: "money", cashier: admin },
    cashFlow: { id: "cash-s", amount: 10 },
    stockUpdates: [
      { id: "p", quantity: 2 },
      { id: "p", quantity: 2 },
    ],
  };
  await assert.rejects(commitSale(options), /Estoque/);
  assert.equal(db.records.get("products/p").qty, 5);
  assert.ok(!db.records.has("sales/s"));
  options.stockUpdates = [
    { id: "p", quantity: 1 },
    { id: "p", quantity: 2 },
  ];
  await commitSale(options);
  await commitSale(options);
  assert.equal(db.records.get("products/p").qty, 2);
  assert.equal(
    db.records.get("register_active/" + hash(admin.email)).netCash,
    10,
  );
  assert.equal((await db.collection("cash_flow").get()).size, 1);
});
test("two simultaneous tills cannot sell the same last available unit", async () => {
  const db = new MemoryFirestore({ "products/p": { qty: 1 } });
  const attempt = (id) =>
    commitSale({
      firestore: db,
      saleId: id,
      record: { total: 1, cashier: admin },
      cashFlow: { id: "cf" + id },
      stockUpdates: [{ id: "p", quantity: 1 }],
    });
  const results = await Promise.allSettled([attempt("a"), attempt("b")]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(db.records.get("products/p").qty, 0);
});
test("persisted payment survives store recreation and remains replayable after archival", async () => {
  const db = new MemoryFirestore();
  let store = require("../lib/durable-payments")(db);
  await store.set("token", { saleId: "sale" });
  store = require("../lib/durable-payments")(db);
  assert.equal((await store.get("token")).saleId, "sale");
  await store.delete("token");
  assert.equal((await store.values()).length, 0);
  assert.equal((await store.get("token")).saleId, "sale");
});
test("equipment identity is stable; delivery requires all confirmations", () => {
  assert.equal(equipmentId(" AB 123 "), equipmentId("ab123"));
  assert.equal(canDeliver({}), false);
  assert.equal(
    canDeliver({
      delivery: {
        tested: true,
        accessoriesChecked: true,
        customerConfirmed: true,
        receivedBy: "Cliente",
        confirmedAt: "2026-10-07",
      },
    }),
    true,
  );
  assert.throws(() => date("2026-02-30"));
  assert.throws(() => quantities([{ id: "p", quantity: -1 }]));
});
test("service edits use optimistic versions and reject self-linked returns", async () => {
  const db = new MemoryFirestore({
    "service_orders/os": { customerId: "c", operationalVersion: 0 },
  });
  const call = server(db);
  let r = await call(
    "patch",
    "/api/work/services/:id",
    { id: "os" },
    { version: 0, technician: "Joana", serial: "123" },
  );
  assert.equal(r.status, 200);
  r = await call(
    "patch",
    "/api/work/services/:id",
    { id: "os" },
    { version: 0, technician: "Outra" },
  );
  assert.equal(r.status, 400);
  assert.equal(db.records.get("service_orders/os").technician, "Joana");
  r = await call(
    "patch",
    "/api/work/services/:id",
    { id: "os" },
    { version: 1, originalServiceId: "os" },
  );
  assert.equal(r.status, 400);
});
test("reservations cannot be oversubscribed or consumed twice", async () => {
  const db = new MemoryFirestore({
    "products/p": { name: "SSD", qty: 2, cost: 50 },
    "service_orders/os": { status: "open" },
  });
  const call = server(db);
  const results = await Promise.all([
    call(
      "post",
      "/api/work/services/:id/reservations",
      { id: "os" },
      { productId: "p", qty: 2 },
    ),
    call(
      "post",
      "/api/work/services/:id/reservations",
      { id: "os" },
      { productId: "p", qty: 1 },
    ),
  ]);
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 400]);
  const id = (await db.collection("work_reservations").get()).docs[0].id;
  assert.equal(
    (
      await call("post", "/api/work/reservations/:id/:action", {
        id,
        action: "consume",
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await call("post", "/api/work/reservations/:id/:action", {
        id,
        action: "consume",
      })
    ).status,
    400,
  );
  assert.equal(db.records.get("products/p").qty, 0);
  assert.equal(db.records.get("service_orders/os").partsCost, 100);
});
test("delivery gate and contact deduplication persist evidence", async () => {
  const db = new MemoryFirestore({ "service_orders/os": { status: "done" } });
  const call = server(db);
  assert.equal(
    (await call("post", "/api/work/services/:id/deliver", { id: "os" }, {}))
      .status,
    400,
  );
  assert.equal(
    (
      await call(
        "post",
        "/api/work/services/:id/deliver",
        { id: "os" },
        {
          tested: true,
          accessoriesChecked: true,
          customerConfirmed: true,
          receivedBy: "Maria",
        },
      )
    ).status,
    200,
  );
  const body = { kind: "Retirada", day: "2026-10-07" };
  assert.equal(
    (await call("post", "/api/work/services/:id/reminders", { id: "os" }, body))
      .status,
    200,
  );
  assert.equal(
    (await call("post", "/api/work/services/:id/reminders", { id: "os" }, body))
      .status,
    400,
  );
});
test("partial receipts are idempotent and shift differences reflect cash only", async () => {
  const db = new MemoryFirestore({
    "sales/s": { total: 100, amountPaid: 20, cashier: admin, client: "Maria" },
  });
  const call = server(db);
  await call("post", "/api/work/register/open", {}, { opening: 50 });
  const body = {
    amount: 30,
    payment: "money",
    requestId: "12345678-1234-1234-1234-123456789012",
  };
  assert.equal(
    (
      await call(
        "post",
        "/api/work/sales/:id/:action",
        { id: "s", action: "receive" },
        body,
      )
    ).status,
    200,
  );
  await call(
    "post",
    "/api/work/sales/:id/:action",
    { id: "s", action: "receive" },
    body,
  );
  assert.equal(db.records.get("sales/s").amountPaid, 50);
  const closed = await call(
    "post",
    "/api/work/register/close",
    {},
    { counted: 78 },
  );
  assert.equal(closed.body.register.expected, 80);
  assert.equal(closed.body.register.difference, -2);
});
test("technicians cannot reserve inventory, refund sales or change profiles", async () => {
  const call = server(new MemoryFirestore(), {
    email: "tech@example.test",
    type: "technician",
  });
  assert.equal(
    (
      await call(
        "post",
        "/api/work/services/:id/reservations",
        { id: "os" },
        { qty: 1 },
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await call(
        "patch",
        "/api/work/users/:id/role",
        { id: "u" },
        { type: "admin" },
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await call(
        "post",
        "/api/work/sales/:id/:action",
        { id: "s", action: "refund" },
        { amount: 1 },
      )
    ).status,
    403,
  );
});
test("repair metrics include idle reason, labor, parts and rework", () => {
  const m = repairMetrics([
    {
      id: "s",
      estimateValue: 500,
      partsCost: 100,
      laborHours: 2,
      hourlyCost: 50,
      reworkCost: 25,
      originalServiceId: "original",
      createdAt: "2026-10-01T00:00:00Z",
      delivery: { confirmedAt: "2026-10-02T00:00:00Z" },
      blockedHours: { pecas: 12 },
    },
  ]);
  assert.equal(m.margins[0].profit, 275);
  assert.equal(m.averageHours, 24);
  assert.equal(m.returnRate, 100);
  assert.equal(m.blockedHours.pecas, 12);
});

test("payment recovery refuses another sale or an amount mismatch", () => {
  const { validateRecoveredPayment } = require("../lib/payment-recovery");
  const pending = { saleId: "s", code: "V001", total: 100 };
  assert.throws(
    () =>
      validateRecoveredPayment(pending, {
        external_reference: "other",
        transaction_amount: 100,
      }),
    /referência/,
  );
  assert.throws(
    () =>
      validateRecoveredPayment(pending, {
        external_reference: "V001",
        transaction_amount: 99,
      }),
    /valor/,
  );
  assert.equal(
    validateRecoveredPayment(pending, {
      external_reference: "V001",
      transaction_amount: 100,
    }),
    true,
  );
  assert.equal(
    validateRecoveredPayment(pending, {
      external_reference: "s",
      transactions: { payments: [{ amount: "100.00" }] },
    }),
    true,
  );
});

test("WhatsApp reminder is sent once and uncertain delivery cannot be retried silently", async () => {
  let sends = 0;
  const db = new MemoryFirestore({
    "service_orders/os": { customerPhone: "79999999999" },
  });
  const call = server(db, admin, {
    isReady: () => true,
    sendText: async () => {
      sends++;
      throw new Error("connection lost");
    },
  });
  const payload = {
    kind: "Retirada",
    day: "2026-10-07",
    message: "Seu equipamento está pronto.",
  };
  assert.equal(
    (
      await call(
        "post",
        "/api/work/services/:id/reminders/send",
        { id: "os" },
        payload,
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await call(
        "post",
        "/api/work/services/:id/reminders/send",
        { id: "os" },
        { ...payload, kind: " retirada " },
      )
    ).status,
    400,
  );
  assert.equal(sends, 1);
  assert.equal(
    (await db.collection("work_reminders").get()).docs[0].data().status,
    "unknown",
  );
});
