"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, Timestamp } = require("firebase-admin/firestore");
const { commitSale } = require("../lib/sale-transaction");
const { buildBackup } = require("../lib/backup-format");
async function main() {
  assert.match(
    process.env.FIRESTORE_EMULATOR_HOST || "",
    /^(127\.0\.0\.1|localhost):\d+$/,
    "Emulador local obrigatório.",
  );
  const app = initializeApp({ projectId: "demo-infocore-transactions" });
  const db = getFirestore(app);
  const run = Date.now().toString();
  const productId = "product-" + run;
  try {
    await db
      .collection("products")
      .doc(productId)
      .set({ qty: 1, reservedQty: 0 });
    const sale = (id) =>
      commitSale({
        firestore: db,
        saleId: id,
        record: {
          id,
          total: 10,
          amountPaid: 10,
          cashier: { email: "test@example.test" },
          payment: "money",
          createdAt: new Timestamp(1, 0),
        },
        stockUpdates: [{ id: productId, quantity: 1 }],
        cashFlow: { id: "cf-" + id, amount: 10 },
      });
    const results = await Promise.allSettled([
      sale("a-" + run),
      sale("b-" + run),
    ]);
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal(
      (await db.collection("products").doc(productId).get()).data().qty,
      0,
    );
    const successful =
      results.findIndex((r) => r.status === "fulfilled") === 0
        ? "a-" + run
        : "b-" + run;
    await sale(successful);
    assert.equal(
      (await db.collection("products").doc(productId).get()).data().qty,
      0,
    );
    const store = require("../lib/durable-payments")(db);
    await store.set("pending-" + run, {
      saleId: successful,
      owner: "test@example.test",
      createdAt: new Timestamp(1, 0),
    });
    const restarted = require("../lib/durable-payments")(db);
    assert.equal((await restarted.get("pending-" + run)).saleId, successful);
    const backup = buildBackup([
      {
        path: "products/restore-" + run,
        data: {
          name: "SSD de teste",
          qty: 3,
          at: new Timestamp(1, 5000),
          blob: Buffer.from("binary"),
        },
      },
      {
        path: "operator_work/test/held_sales/restore-" + run,
        data: { cart: [{ id: "p", qty: 1 }], heldAt: "2026-10-07" },
      },
    ]);
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), "infocore-restore-"));
    const file = path.join(folder, "backup.json");
    fs.writeFileSync(file, JSON.stringify(backup), { mode: 0o600 });
    const result = spawnSync(
      process.execPath,
      ["scripts/backup.js", "restore-emulator", file],
      {
        cwd: path.join(__dirname, ".."),
        env: process.env,
        encoding: "utf8",
        timeout: 30000,
      },
    );
    assert.equal(result.status, 0, result.stderr || result.stdout);
    console.log(result.stdout.trim());
    const exported = path.join(folder, "exported.json");
    const exportedResult = spawnSync(
      process.execPath,
      ["scripts/backup.js", "export", exported],
      {
        cwd: path.join(__dirname, ".."),
        env: process.env,
        encoding: "utf8",
        timeout: 30000,
      },
    );
    assert.equal(
      exportedResult.status,
      0,
      exportedResult.stderr || exportedResult.stdout,
    );
    const exportedBackup = JSON.parse(fs.readFileSync(exported, "utf8"));
    assert.equal(
      exportedBackup.sha256,
      backup.sha256,
      "Export must include held sales under nonexistent parent documents.",
    );
    console.log(
      "Exportação recursiva conferida, incluindo vendas suspensas sem documento pai.",
    );
    console.log(
      "Firestore local: concorrência, repetição, persistência e restauração validados.",
    );
  } finally {
    await db.terminate();
  }
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
