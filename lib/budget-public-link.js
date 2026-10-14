"use strict";
const { randomUUID } = require("node:crypto");
module.exports =
  ({ firestore, models, fetchBudgetNormalized, budgetForUser }) =>
  async (req, res) => {
    try {
      const ref = firestore.collection("budgets").doc(String(req.params.id));
      const token = await firestore.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) throw new Error("Orçamento não encontrado.");
        const b = snap.data();
        const token = b.publicToken || randomUUID();
        tx.update(ref, {
          publicToken: token,
          publicLinkCreatedAt:
            b.publicLinkCreatedAt || new Date().toISOString(),
          status: b.status === "draft" ? "sent" : b.status,
          updatedAt: new Date().toISOString(),
        });
        return token;
      });
      models.invalidate("budgets");
      const base = String(
        process.env.APP_PUBLIC_BASE_URL ||
          `${req.protocol}://${req.get("host")}`,
      ).replace(/\/$/, "");
      res.json({
        error: false,
        token,
        url: `${base}/p/orcamento/${token}`,
        budget: budgetForUser(
          await fetchBudgetNormalized(ref.id),
          req.session.user,
        ),
      });
    } catch (e) {
      res.status(400).json({ error: true, message: e.message });
    }
  };
