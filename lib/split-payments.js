"use strict";
const METHODS = new Set(["money", "pix", "credit_card", "debit_card"]);
function validateSplitPayments(rows, total, confirmed) {
  if (confirmed !== true)
    throw new Error(
      "Confirme o recebimento de todos os valores antes de registrar.",
    );
  if (!Array.isArray(rows) || rows.length < 2 || rows.length > 4)
    throw new Error("Informe de dois a quatro meios de pagamento.");
  const seen = new Set();
  const payments = rows.map((row) => {
    const value = row.amount;
    if (!METHODS.has(row.method) || seen.has(row.method))
      throw new Error("Meio de pagamento inválido ou repetido.");
    seen.add(row.method);
    const amount = Number(value);
    const cents = Math.round(amount * 100);
    if (
      value === null ||
      typeof value === "boolean" ||
      !Number.isFinite(amount) ||
      !Number.isSafeInteger(cents) ||
      cents <= 0 ||
      Math.abs(amount * 100 - cents) > 1e-6
    )
      throw new Error("Informe valores positivos com até duas casas decimais.");
    return { method: row.method, amount: cents / 100 };
  });
  if (
    payments.reduce((sum, p) => sum + Math.round(p.amount * 100), 0) !==
    Math.round(total * 100)
  )
    throw new Error("A soma dos pagamentos deve ser igual ao total da venda.");
  return payments;
}
module.exports = { validateSplitPayments };
