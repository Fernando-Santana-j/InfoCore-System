"use strict";
const { createHash } = require("node:crypto");
module.exports = function paymentRequestGuard(db, saleForUser = (s) => s) {
  return async (req, res, next) => {
    const key = req.get("Idempotency-Key");
    if (!/^[a-f0-9-]{36}$/.test(key || ""))
      return res
        .status(400)
        .json({
          error: true,
          message:
            "Atualize a página antes de vender (identificador de operação ausente).",
        });
    const owner = String(
      req.session.user.email || req.session.user.id || req.session.user.name,
    );
    const fingerprint = createHash("sha256")
      .update(JSON.stringify(req.body))
      .digest("hex");
    const id = createHash("sha256").update(`${owner}:${key}`).digest("hex");
    const ref = db.collection("sale_requests").doc(id);
    try {
      const previous = await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (snap.exists) return snap.data();
        tx.create(ref, {
          owner,
          fingerprint,
          status: "processing",
          createdAt: new Date().toISOString(),
        });
        return null;
      });
      if (previous) {
        if (previous.fingerprint !== fingerprint)
          return res
            .status(409)
            .json({
              error: true,
              message: "Identificador já usado para outro carrinho.",
            });
        if (previous.response)
          return res.status(previous.httpStatus).json(previous.response);
        if (previous.saleId) {
          const completed = await db
            .collection("sales")
            .doc(previous.saleId)
            .get();
          if (completed.exists)
            return res.json({
              error: false,
              sale: saleForUser(
                { ...completed.data(), id: completed.id },
                req.session.user,
              ),
              products: [],
            });
          const pending = await db
            .collection("payment_pending")
            .doc(previous.saleId)
            .get();
          if (pending.exists && pending.data().mode !== "creation_pending") {
            return res.json({
              error: false,
              pending: true,
              token: previous.saleId,
              payment: { status: "pending" },
            });
          }
        }
        return res
          .status(409)
          .json({
            error: true,
            pending: true,
            message:
              "Esta operação já foi iniciada. Consulte os pagamentos pendentes antes de cobrar novamente.",
          });
      }
      req.saleRequestRef = ref;
      // Persist the exact outcome before acknowledging it to the browser.
      const send = res.json.bind(res);
      res.json = async (body) => {
        try {
          if (
            res.statusCode >= 400 &&
            res.statusCode < 500 &&
            !req.paymentStarted
          )
            await ref.delete();
          else
            await ref.update({
              status: "responded",
              httpStatus: res.statusCode,
              response: JSON.parse(JSON.stringify(body)),
              updatedAt: new Date().toISOString(),
            });
          return send(body);
        } catch (e) {
          return send({
            error: true,
            pending: true,
            message:
              "Resposta não confirmada. Consulte os pagamentos pendentes antes de repetir.",
          });
        }
      };
      next();
    } catch (e) {
      res
        .status(503)
        .json({
          error: true,
          message:
            "Não foi possível reservar a operação. Nenhuma cobrança foi iniciada.",
        });
    }
  };
};
