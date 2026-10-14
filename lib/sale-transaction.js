"use strict";
const { hash } = require("./operations-domain");
function quantities(stockUpdates) {
  const demand = new Map();
  for (const u of stockUpdates) {
    const qty = Number(u.quantity ?? Number(u.p.qty) - Number(u.nextQty));
    if (!Number.isSafeInteger(qty) || qty <= 0)
      throw new Error("Quantidade de estoque inválida.");
    demand.set(u.id, (demand.get(u.id) || 0) + qty);
  }
  return demand;
}
async function commitSale({
  firestore,
  saleId,
  record,
  stockUpdates,
  cashFlow,
}) {
  const demand = quantities(stockUpdates);
  return firestore.runTransaction(async (tx) => {
    const saleRef = firestore.collection("sales").doc(saleId);
    const existing = await tx.get(saleRef);
    if (existing.exists) return { products: [], duplicate: true };
    const refs = [...demand.keys()].map((id) =>
      firestore.collection("products").doc(id),
    );
    const snapshots = await Promise.all(refs.map((ref) => tx.get(ref)));
    const products = snapshots.map((snap, i) => {
      if (!snap.exists) throw new Error("Produto removido durante a venda.");
      const p = snap.data();
      const qty = Number(p.qty || 0) - demand.get(refs[i].id);
      if (
        qty < Number(p.reservedQty || 0) &&
        (Number(p.reservedQty || 0) > 0 || !record.allowInsufficientStock)
      ) {
        throw new Error(
          "Estoque disponível mudou. Revise a venda; se o pagamento foi aprovado, reconcilie a pendência.",
        );
      }
      return { ...p, id: refs[i].id, qty };
    });
    const registerRef = firestore
      .collection("register_active")
      .doc(
        hash(
          record.cashier?.email ||
            record.cashier?.id ||
            record.cashier?.name ||
            "",
        ),
      );
    const register = await tx.get(registerRef);
    const finalRecord = {
      ...record,
      initialAmountPaid:
        record.initialAmountPaid ?? record.amountPaid ?? record.total,
    };
    const cashAmount = record.payment === "mixed"
      ? (record.payments || []).filter(p => p.method === "money").reduce((sum, p) => sum + p.amount, 0)
      : record.payment === "money" ? Number(record.amountPaid ?? record.total) : 0;
    if (register.exists && cashAmount > 0) {
      tx.update(registerRef, {
        netCash:
          Math.round(
            (Number(register.data().netCash || 0) +
              cashAmount) *
              100,
          ) / 100,
      });
      finalRecord.registerId = register.data().id;
    }
    tx.create(saleRef, finalRecord);
    products.forEach((p, i) => tx.update(refs[i], { qty: p.qty }));
    tx.set(firestore.collection("cash_flow").doc(cashFlow.id), cashFlow);
    tx.set(firestore.collection("audit_events").doc(`sale-${saleId}`), {
      action: "sale.completed",
      targetId: saleId,
      actor: record.cashier || null,
      at: new Date().toISOString(),
    });
    return { products, duplicate: false };
  });
}
module.exports = { quantities, commitSale };
