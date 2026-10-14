const test = require("node:test");
const assert = require("node:assert/strict");
const { validateSplitPayments } = require("../lib/split-payments");
const { commitSale } = require("../lib/sale-transaction");
const { hash } = require("../lib/operations-domain");
const MemoryFirestore = require("./helpers/memory-firestore");
const parts = [
  { method: "pix", amount: 50 },
  { method: "money", amount: 50 },
];
test("split payments require exact cents and explicit receipt confirmation", () => {
  assert.deepEqual(validateSplitPayments(parts, 100, true), parts);
  assert.throws(() => validateSplitPayments(parts, 100, false), /Confirme/);
  assert.throws(() => validateSplitPayments(parts, 99.99, true), /soma/);
  assert.throws(
    () =>
      validateSplitPayments(
        [
          { method: "pix", amount: 50 },
          { method: "pix", amount: 50 },
        ],
        100,
        true,
      ),
    /repetido/,
  );
  for (const amount of [-1, Infinity, NaN, 1.001, null, true]) {
    assert.throws(() =>
      validateSplitPayments([{ method: "pix", amount }, parts[1]], 100, true),
    );
  }
  assert.deepEqual(
    validateSplitPayments(
      [
        { method: "pix", amount: 0.1 },
        { method: "money", amount: 0.2 },
      ],
      0.3,
      true,
    ),
    [
      { method: "pix", amount: 0.1 },
      { method: "money", amount: 0.2 },
    ],
  );
});
test("mixed sale updates only cash share, stores allocations and is idempotent", async () => {
  const email = "cashier@example.test";
  const registerKey = "register_active/" + hash(email);
  const db = new MemoryFirestore({
    "products/p": { qty: 2 },
    [registerKey]: { id: "shift", netCash: 10 },
  });
  const args = {
    firestore: db,
    saleId: "split",
    record: {
      total: 100,
      amountPaid: 100,
      payment: "mixed",
      payments: parts,
      cashier: { email },
    },
    cashFlow: {
      id: "split-flow",
      amount: 100,
      payment: "mixed",
      payments: parts,
    },
    stockUpdates: [{ id: "p", quantity: 1 }],
  };
  await commitSale(args);
  await commitSale(args);
  assert.equal(db.records.get(registerKey).netCash, 60);
  assert.equal(db.records.get("products/p").qty, 1);
  assert.deepEqual(db.records.get("sales/split").payments, parts);
  assert.equal(db.records.get("sales/split").initialAmountPaid, 100);
  assert.equal((await db.collection("cash_flow").get()).size, 1);
});

test("real sale handler bypasses gateway for confirmed split and rejects mismatched total", async () => {
  const fs = require("node:fs");
  const vm = require("node:vm");
  const source = fs.readFileSync(require.resolve("../index"), "utf8");
  const start = source.indexOf("app.post('/api/sales',");
  const end = source.indexOf(
    "app.post('/api/sales/pending/:token/recover'",
    start,
  );
  const handlerSource = source
    .slice(source.indexOf("async (req, res) => {", start), end)
    .trim()
    .slice(0, -2);
  const stored = [];
  const sandbox = {
    require: (path) => require("../" + path),
    PAYMENT_KEYS: new Set(["money", "pix", "credit_card", "debit_card"]),
    randomUUID: () => "sale-split",
    saleDisplayCode: () => "V-001",
    parseMoneyField: Number,
    lineCostFromUnit: (price, qty) => price * qty,
    FieldValue: { serverTimestamp: () => "2026-10-08" },
    finalizeSaleInDb: async ({ saleRecord }) => {
      stored.push(saleRecord);
      return { updatedProducts: [], cashFlowEntry: null };
    },
    // Any accidental gateway branch fails this test immediately.
    pendingPointSales: {
      set: () => {
        throw new Error("Unexpected gateway call");
      },
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(
    source.slice(
      source.indexOf("function normalizePaymentKey("),
      source.indexOf("function saleDisplayCode("),
    ),
    sandbox,
  );
  const handler = vm.runInContext("(" + handlerSource + ")", sandbox);
  async function run(payments, confirmed = true) {
    const req = {
      body: {
        items: [{ custom: true, name: "Serviço", price: 100, qty: 1 }],
        payment: "mixed",
        payments,
        paymentsConfirmed: confirmed,
      },
      session: { user: { name: "Caixa", email: "cashier@example.test" } },
      saleRequestRef: { update: async () => {} },
    };
    const res = {
      statusCode: 200,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(body) {
        this.body = body;
        return this;
      },
    };
    await handler(req, res);
    return res;
  }
  const valid = await run(parts);
  assert.equal(valid.statusCode, 200);
  assert.equal(valid.body.sale.payment, "mixed");
  assert.equal(stored.length, 1);
  assert.equal(stored[0].amountPaid, 100);
  assert.equal(
    (await run([{ method: "pix", amount: 40 }, parts[1]])).statusCode,
    400,
  );
  assert.equal((await run(parts, false)).statusCode, 400);
  assert.equal(stored.length, 1);
});
