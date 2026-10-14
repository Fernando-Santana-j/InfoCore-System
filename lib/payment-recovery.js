"use strict";
const { createHash } = require("node:crypto");
function gatewayKey(payload) {
  const h = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
function validateRecoveredPayment(pending, provider) {
  if (
    !provider ||
    ![pending.code, pending.saleId].includes(
      String(provider.external_reference || ""),
    )
  )
    throw new Error("A referência da cobrança não corresponde a esta venda.");
  const raw =
    provider.transaction_amount ??
    provider.total_amount ??
    (Array.isArray(provider.transactions?.payments)
      ? provider.transactions.payments.reduce((s, p) => s + Number(p.amount), 0)
      : NaN);
  const cents = Math.round(Number(raw) * 100);
  if (
    !Number.isFinite(cents) ||
    cents !== Math.round(Number(pending.total) * 100)
  )
    throw new Error("O valor da cobrança não corresponde ao total da venda.");
  return true;
}
module.exports = { validateRecoveredPayment, gatewayKey };
