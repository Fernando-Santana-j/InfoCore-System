"use strict";
const databaseAvailability = require("./database-availability");
const { randomUUID } = require("node:crypto");
const { hash, money, text } = require("./operations-domain");
module.exports = function registerRoutes(
  app,
  { firestore: db, models, verifyLogin, verifyAdminApi },
) {
  const owner = (req) =>
    String(
      req.session.user.email || req.session.user.id || req.session.user.name,
    );
  const now = () => new Date().toISOString();
  const wrap = (fn) => async (req, res) => {
    try {
      await fn(req, res);
    } catch (e) {
      if (databaseAvailability.observe(e)) return databaseAvailability.respond(e, req, res, () => {});
      res.status(400).json({ error: true, message: e.message });
    }
  };
  const active = (req) =>
    db.collection("register_active").doc(hash(owner(req)));
  app.get(
    "/api/work/register",
    verifyLogin,
    wrap(async (req, res) => {
      const snap = await active(req).get();
      const history = await db
        .collection("register_sessions")
        .where("owner", "==", owner(req))
        .limit(100)
        .get();
      res.json({
        active: snap.exists ? snap.data() : null,
        history: history.docs
          .map((d) => ({ ...d.data(), id: d.id }))
          .sort((a, b) => b.openedAt.localeCompare(a.openedAt)),
      });
    }),
  );
  app.post(
    "/api/work/register/open",
    verifyLogin,
    wrap(async (req, res) => {
      const opening = money(req.body.opening);
      const id = randomUUID();
      await db.runTransaction(async (tx) => {
        const ref = active(req);
        if ((await tx.get(ref)).exists)
          throw new Error("Já existe um caixa aberto para este operador.");
        const record = {
          id,
          owner: owner(req),
          opening,
          netCash: 0,
          openedAt: now(),
          status: "open",
        };
        tx.create(ref, record);
        tx.create(db.collection("register_sessions").doc(id), record);
      });
      res.json({ ok: true });
    }),
  );
  app.post(
    "/api/work/register/close",
    verifyLogin,
    wrap(async (req, res) => {
      const counted = money(req.body.counted);
      const result = await db.runTransaction(async (tx) => {
        const ref = active(req);
        const snap = await tx.get(ref);
        if (!snap.exists) throw new Error("Não há caixa aberto.");
        const s = snap.data();
        const expected = Math.round((s.opening + s.netCash) * 100) / 100;
        const record = {
          ...s,
          counted,
          expected,
          difference: Math.round((counted - expected) * 100) / 100,
          notes: text(req.body.notes, 1000),
          closedAt: now(),
          status: "closed",
        };
        tx.set(db.collection("register_sessions").doc(s.id), record);
        tx.delete(ref);
        tx.create(db.collection("audit_events").doc(randomUUID()), {
          action: "register.closed",
          actor: owner(req),
          at: now(),
          targetId: s.id,
          details: { counted, expected, difference: record.difference },
        });
        return record;
      });
      res.json({ ok: true, register: result });
    }),
  );
  app.get(
    "/api/work/receivables",
    verifyLogin,
    wrap(async (req, res) => {
      const sales = await models.findAll({ colecao: "sales" });
      res.json({
        sales: sales
          .filter(
            (s) =>
              req.session.user.type === "admin" ||
              s.cashier?.email === owner(req),
          )
          .slice(-200)
          .map((s) => ({
            id: s.id,
            code: s.code,
            client: s.client,
            total: Number(s.total) || 0,
            paid: Number(s.amountPaid ?? s.total) || 0,
            refunded: Number(s.refundedTotal) || 0,
            balance: Math.max(
              0,
              Math.round(
                (Number(s.total) - Number(s.amountPaid ?? s.total)) * 100,
              ) / 100,
            ),
          })),
      });
    }),
  );
  app.post(
    "/api/work/sales/:id/:action",
    verifyLogin,
    wrap(async (req, res) => {
      const action = req.params.action;
      if (!["receive", "refund"].includes(action))
        throw new Error("Ação inválida.");
      if (action === "refund" && req.session.user.type !== "admin")
        return res
          .status(403)
          .json({ error: true, message: "Devolução exige administrador." });
      const amount = money(req.body.amount);
      if (amount <= 0) throw new Error("Informe um valor positivo.");
      if (
        !["money", "pix", "credit_card", "debit_card"].includes(
          req.body.payment,
        )
      )
        throw new Error("Meio inválido.");
      if (!/^[a-f0-9-]{36}$/.test(req.body.requestId || ""))
        throw new Error("Identificador de operação inválido.");
      const id = hash(`${owner(req)}:${req.body.requestId}`);
      await db.runTransaction(async (tx) => {
        const eventRef = db.collection("sale_receipts").doc(id);
        const prior = await tx.get(eventRef);
        if (prior.exists) {
          const p = prior.data();
          if (
            p.saleId !== req.params.id ||
            p.amount !== amount ||
            p.action !== action ||
            p.payment !== req.body.payment
          )
            throw new Error("Identificador já utilizado.");
          return;
        }
        const saleRef = db.collection("sales").doc(req.params.id);
        const snap = await tx.get(saleRef);
        if (!snap.exists) throw new Error("Venda não encontrada.");
        const s = snap.data();
        if (
          req.session.user.type !== "admin" &&
          s.cashier?.email !== owner(req)
        )
          throw new Error("Venda de outro operador.");
        const regRef = active(req);
        const reg = await tx.get(regRef);
        const paid = money(s.amountPaid ?? s.total),
          refunded = money(s.refundedTotal || 0);
        if (action === "receive" && amount > money(Math.max(0, s.total - paid)))
          throw new Error("Valor maior que o saldo a receber.");
        if (action === "refund" && amount > money(Math.max(0, paid - refunded)))
          throw new Error("Valor maior que o recebido líquido.");
        if (req.body.payment === "money" && !reg.exists)
          throw new Error("Abra seu caixa antes de registrar dinheiro.");
        const sign = action === "receive" ? 1 : -1;
        const record = {
          id,
          saleId: snap.id,
          action,
          amount,
          payment: req.body.payment,
          notes: text(req.body.notes, 1000),
          operator: owner(req),
          createdAt: now(),
          registerId: reg.exists ? reg.data().id : null,
        };
        tx.create(eventRef, record);
        tx.update(
          saleRef,
          action === "receive"
            ? { amountPaid: money(paid + amount) }
            : { refundedTotal: money(refunded + amount) },
        );
        tx.create(db.collection("cash_flow").doc(id), {
          id,
          type: sign === 1 ? "income" : "expense",
          amount,
          cost: 0,
          profit: 0,
          category: sign === 1 ? "Recebimento de saldo" : "Devolução",
          description: `${s.code} · ${text(s.client)} · ${record.notes}`,
          date: now().slice(0, 10),
          saleId: snap.id,
          source: "sale_receipt",
          payment: req.body.payment,
          createdAt: now(),
        });
        if (reg.exists && req.body.payment === "money")
          tx.update(regRef, {
            netCash:
              Math.round((reg.data().netCash + sign * amount) * 100) / 100,
          });
        tx.create(db.collection("audit_events").doc(id), {
          action: `sale.${action}`,
          actor: owner(req),
          at: now(),
          targetId: snap.id,
          details: { amount, payment: req.body.payment },
        });
      });
      models.invalidate("sales");
      models.invalidate("cash_flow");
      res.json({ ok: true });
    }),
  );
};
