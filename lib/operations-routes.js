"use strict";
const databaseAvailability = require("./database-availability");
const { randomUUID } = require("node:crypto");
const {
  text,
  money,
  date,
  hash,
  equipmentId,
  canDeliver,
  repairMetrics,
} = require("./operations-domain");
module.exports = function installOperations(
  app,
  {
    firestore: db,
    models,
    verifyLogin,
    verifyAdminApi,
    normalizeService,
    budgetForUser,
    saleForUser,
    QRCode,
    whatsapp,
  },
) {
  const owner = (req) =>
    text(
      req.session.user.email || req.session.user.id || req.session.user.name,
    );
  const now = () => new Date().toISOString();
  const doc = (collection, id) => db.collection(collection).doc(text(id, 150));
  const rows = (snap) => snap.docs.map((d) => ({ ...d.data(), id: d.id }));
  const handler = (fn) => async (req, res) => {
    try {
      await fn(req, res);
    } catch (e) {
      if (databaseAvailability.observe(e)) return databaseAvailability.respond(e, req, res, () => {});
      console.error("operations", e.message);
      res
        .status(e.status || 400)
        .json({
          error: true,
          message: e.message || "Não foi possível concluir.",
        });
    }
  };
  const requireRow = (snap) => {
    if (!snap.exists) throw new Error("Registro não encontrado.");
    return { ...snap.data(), id: snap.id };
  };
  function audit(tx, req, action, targetId, details = {}) {
    tx.set(doc("audit_events", randomUUID()), {
      action,
      targetId,
      actor: owner(req),
      at: now(),
      details,
    });
  }
  const workshop = (req, res, next) =>
    ["admin", "technician"].includes(req.session.user.type)
      ? next()
      : res
          .status(403)
          .json({ error: true, message: "Acesso da oficina necessário." });
  function safeService(r, req) {
    const v = normalizeService(r);
    if (req.session.user.type !== "admin") {
      delete v.hourlyCost;
      delete v.reworkCost;
      delete v.partsCost;
    }
    return v;
  }

  app.get(
    "/api/work/held-sales",
    verifyLogin,
    handler(async (req, res) => {
      const snap = await db
        .collection("operator_work")
        .doc(hash(owner(req)))
        .collection("held_sales")
        .limit(100)
        .get();
      res.json({ sales: rows(snap) });
    }),
  );
  app.post(
    "/api/work/held-sales",
    verifyLogin,
    handler(async (req, res) => {
      if (
        !Array.isArray(req.body.cart) ||
        !req.body.cart.length ||
        req.body.cart.length > 200 ||
        JSON.stringify(req.body).length > 200000
      )
        throw new Error("Carrinho inválido.");
      const id = /^[a-f0-9-]{36}$/.test(req.body.id || "")
        ? req.body.id
        : randomUUID();
      const payload = {
        id,
        cart: req.body.cart,
        customer: text(req.body.customer),
        notes: text(req.body.notes, 500),
        payment: text(req.body.payment),
        adjustments: req.body.adjustments || {},
        heldAt: now(),
      };
      await db
        .collection("operator_work")
        .doc(hash(owner(req)))
        .collection("held_sales")
        .doc(id)
        .set(payload);
      res.json({ sale: payload });
    }),
  );
  app.delete(
    "/api/work/held-sales/:id",
    verifyLogin,
    handler(async (req, res) => {
      await db
        .collection("operator_work")
        .doc(hash(owner(req)))
        .collection("held_sales")
        .doc(text(req.params.id))
        .delete();
      res.json({ ok: true });
    }),
  );
  app.get(
    "/api/work/payments",
    verifyLogin,
    handler(async (req, res) => {
      const snap = await (
        req.session.user.type === "admin"
          ? db.collection("payment_pending").where("archived", "==", false)
          : db.collection("payment_pending").where("owner", "==", owner(req))
      )
        .limit(100)
        .get();
      res.json({
        payments: rows(snap)
          .filter((p) => !p.archived)
          .map((p) => ({
            token: p.id,
            code: p.code,
            total: p.total,
            mode: p.mode,
            at: p.createdAtMs,
          })),
      });
    }),
  );
  app.get(
    "/api/work/overview",
    verifyLogin,
    handler(async (req, res) => {
      const [services, budgets] = await Promise.all([
        models.findAll({ colecao: "service_orders" }),
        models.findAll({ colecao: "budgets" }),
      ]);
      const today = new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Maceio",
      }).format(new Date());
      const tasks = [];
      services
        .filter(() => ["admin", "technician"].includes(req.session.user.type))
        .forEach((s) => {
          const href = `/services/${encodeURIComponent(s.id)}`;
          if (s.status === "delivered") return;
          if (s.dueDate && s.dueDate < today)
            tasks.push({
              kind: "Prazo vencido",
              title: `${s.code} · ${s.customerName}`,
              detail: s.nextAction || "Revisar previsão com o cliente",
              href,
              due: s.dueDate,
            });
          if (s.status === "done")
            tasks.push({
              kind: "Aguardando retirada",
              title: `${s.code} · ${s.customerName}`,
              detail: s.nextAction || "Confirmar retirada e entrega",
              href,
            });
          if (s.followUpDate && s.followUpDate <= today)
            tasks.push({
              kind: "Retornar ao cliente",
              title: `${s.code} · ${s.customerName}`,
              detail: s.nextAction || "Registrar contato",
              href,
              due: s.followUpDate,
            });
        });
      budgets
        .filter((b) => ["sent", "awaiting"].includes(b.status))
        .forEach((b) =>
          tasks.push({
            kind: "Aprovação pendente",
            title: `${b.code} · ${b.customerName}`,
            detail: "Abrir orçamento e consultar resposta",
            href: `/budgets?open=${encodeURIComponent(b.id)}`,
          }),
        );
      res.json({ tasks: tasks.slice(0, 100), total: tasks.length });
    }),
  );
  app.get(
    "/api/work/services/:id",
    verifyLogin,
    workshop,
    handler(async (req, res) => {
      const service = requireRow(
        await doc("service_orders", req.params.id).get(),
      );
      const [budget, purchases, reservations, reminders, previous, products] =
        await Promise.all([
          service.budgetId ? doc("budgets", service.budgetId).get() : null,
          db
            .collection("work_purchases")
            .where("serviceId", "==", service.id)
            .get(),
          db
            .collection("work_reservations")
            .where("serviceId", "==", service.id)
            .get(),
          db
            .collection("work_reminders")
            .where("serviceId", "==", service.id)
            .get(),
          service.equipmentId
            ? db
                .collection("service_orders")
                .where("equipmentId", "==", service.equipmentId)
                .get()
            : null,
          req.session.user.type === "admin"
            ? models.findAll({ colecao: "products" })
            : [],
        ]);
      const b = budget?.exists
        ? budgetForUser({ ...budget.data(), id: budget.id }, req.session.user)
        : null;
      const sale = b?.saleId ? await doc("sales", b.saleId).get() : null;
      const original = service.originalServiceId
        ? await doc("service_orders", service.originalServiceId).get()
        : null;
      res.json({
        original: original?.exists
          ? safeService({ ...original.data(), id: original.id }, req)
          : null,
        service: safeService(service, req),
        budget: b,
        sale: sale?.exists
          ? saleForUser({ ...sale.data(), id: sale.id }, req.session.user)
          : null,
        purchases: rows(purchases),
        reservations: rows(reservations).map((r) =>
          req.session.user.type === "admin"
            ? r
            : { id: r.id, name: r.name, qty: r.qty, status: r.status },
        ),
        reminders: rows(reminders),
        history: previous ? rows(previous).map((r) => safeService(r, req)) : [],
        products: products
          .filter((p) => p.itemType !== "service" && p.active !== false)
          .map((p) => ({
            id: p.id,
            name: p.name,
            available: Number(p.qty || 0) - Number(p.reservedQty || 0),
          })),
      });
    }),
  );
  app.patch(
    "/api/work/services/:id",
    verifyLogin,
    workshop,
    handler(async (req, res) => {
      const b = req.body;
      const patch = Object.fromEntries(
        [
          "serial",
          "technician",
          "nextAction",
          "blockedReason",
          "warrantyCoverage",
          "returnCause",
        ].map((k) => [
          k,
          text(
            b[k],
            k.includes("Cause") || k.includes("Coverage") ? 1000 : 300,
          ),
        ]),
      );
      for (const k of ["dueDate", "followUpDate", "warrantyUntil"])
        patch[k] = date(b[k]);
      if (
        ["__proto__", "prototype", "constructor"].includes(patch.blockedReason)
      )
        throw new Error("Motivo de bloqueio inválido.");
      patch.laborHours = money(b.laborHours || 0);
      if (req.session.user.type === "admin")
        for (const k of ["hourlyCost", "reworkCost"])
          patch[k] = money(b[k] || 0);
      patch.equipmentId = equipmentId(patch.serial);
      patch.originalServiceId = text(b.originalServiceId, 100);
      const ref = doc("service_orders", req.params.id);
      await db.runTransaction(async (tx) => {
        const prev = requireRow(await tx.get(ref));
        if (Number(b.version) !== Number(prev.operationalVersion || 0))
          throw new Error(
            "Outro usuário atualizou a ficha. Recarregue antes de salvar.",
          );
        if (patch.originalServiceId) {
          if (patch.originalServiceId === prev.id)
            throw new Error("A OS de origem deve ser outra.");
          const original = requireRow(
            await tx.get(doc("service_orders", patch.originalServiceId)),
          );
          if (
            original.customerId !== prev.customerId ||
            (original.equipmentId && original.equipmentId !== patch.equipmentId)
          )
            throw new Error(
              "A OS de origem pertence a outro cliente ou equipamento.",
            );
          if (!patch.returnCause)
            throw new Error("Informe a causa do retorno.");
        }
        const blockedHours = { ...(prev.blockedHours || {}) };
        if (prev.blockedReason !== patch.blockedReason) {
          if (prev.blockedReason && prev.blockedSince)
            blockedHours[prev.blockedReason] =
              (Number(blockedHours[prev.blockedReason]) || 0) +
              Math.max(
                0,
                (Date.now() - new Date(prev.blockedSince).getTime()) / 3600000,
              );
          patch.blockedSince = patch.blockedReason ? now() : null;
        }
        patch.blockedHours = blockedHours;
        patch.operationalVersion = Number(prev.operationalVersion || 0) + 1;
        patch.updatedAt = now();
        tx.update(ref, patch);
        if (patch.equipmentId)
          tx.set(
            doc("equipment", patch.equipmentId),
            {
              serial: patch.serial,
              model: prev.deviceBrandModel || "",
              updatedAt: now(),
            },
            { merge: true },
          );
        audit(tx, req, "service.operations", prev.id, {
          fields: Object.keys(patch),
        });
      });
      models.invalidate("service_orders");
      res.json({ ok: true });
    }),
  );
  app.post(
    "/api/work/services/:id/deliver",
    verifyLogin,
    workshop,
    handler(async (req, res) => {
      const delivery = {
        tested: req.body.tested === true,
        accessoriesChecked: req.body.accessoriesChecked === true,
        customerConfirmed: req.body.customerConfirmed === true,
        receivedBy: text(req.body.receivedBy),
        confirmedAt: now(),
        operator: owner(req),
      };
      if (!canDeliver({ delivery }))
        throw new Error(
          "Complete o checklist e informe quem recebeu o equipamento.",
        );
      await db.runTransaction(async (tx) => {
        const ref = doc("service_orders", req.params.id);
        const s = requireRow(await tx.get(ref));
        if (s.status === "delivered") return;
        if (s.status !== "done")
          throw new Error("Conclua o reparo antes de confirmar a entrega.");
        tx.update(ref, { status: "delivered", delivery, updatedAt: now() });
        audit(tx, req, "service.delivered", ref.id, delivery);
      });
      models.invalidate("service_orders");
      res.json({ ok: true });
    }),
  );
  app.get(
    "/api/work/equipment/:id/qr",
    verifyLogin,
    workshop,
    handler(async (req, res) => {
      requireRow(await doc("equipment", req.params.id).get());
      const url = `${process.env.APP_PUBLIC_BASE_URL || `${req.protocol}://${req.get("host")}`}/services?equipment=${encodeURIComponent(req.params.id)}`;
      res
        .type("image/png")
        .send(await QRCode.toBuffer(url, { width: 320, margin: 2 }));
    }),
  );
  app.get(
    "/api/work/equipment/:id",
    verifyLogin,
    workshop,
    handler(async (req, res) => {
      const equipment = requireRow(await doc("equipment", req.params.id).get());
      const history = rows(
        await db
          .collection("service_orders")
          .where("equipmentId", "==", equipment.id)
          .get(),
      ).map((r) => safeService(r, req));
      res.json({ equipment, history });
    }),
  );
  app.post(
    "/api/work/services/:id/purchases",
    verifyLogin,
    workshop,
    handler(async (req, res) => {
      requireRow(await doc("service_orders", req.params.id).get());
      const b = req.body;
      const supplier = text(b.supplier);
      const description = text(b.description);
      if (!supplier || !description)
        throw new Error("Informe fornecedor e peça.");
      const id = randomUUID();
      await doc("work_purchases", id).set({
        id,
        serviceId: req.params.id,
        supplier,
        description,
        orderCode: text(b.orderCode),
        expectedAt: date(b.expectedAt),
        status: "ordered",
        createdAt: now(),
        actor: owner(req),
      });
      res.json({ ok: true });
    }),
  );
  app.patch(
    "/api/work/purchases/:id",
    verifyLogin,
    workshop,
    handler(async (req, res) => {
      if (!["received", "cancelled"].includes(req.body.status))
        throw new Error("Estado inválido.");
      await db.runTransaction(async (tx) => {
        const ref = doc("work_purchases", req.params.id);
        const p = requireRow(await tx.get(ref));
        if (p.status !== "ordered") throw new Error("Pedido já encerrado.");
        tx.update(ref, { status: req.body.status, updatedAt: now() });
        audit(tx, req, "purchase.status", ref.id, { status: req.body.status });
      });
      res.json({ ok: true });
    }),
  );
  app.post(
    "/api/work/services/:id/reservations",
    verifyLogin,
    verifyAdminApi,
    handler(async (req, res) => {
      const qty = Number(req.body.qty);
      if (!Number.isSafeInteger(qty) || qty <= 0)
        throw new Error("Quantidade inválida.");
      const id = randomUUID();
      await db.runTransaction(async (tx) => {
        const s = requireRow(
          await tx.get(doc("service_orders", req.params.id)),
        );
        if (s.status === "delivered") throw new Error("OS já entregue.");
        const ref = doc("products", req.body.productId);
        const p = requireRow(await tx.get(ref));
        if (
          p.itemType === "service" ||
          p.trackStock === false ||
          p.active === false
        )
          throw new Error("Selecione uma peça ativa com estoque.");
        if (Number(p.qty || 0) - Number(p.reservedQty || 0) < qty)
          throw new Error("Estoque disponível insuficiente.");
        tx.update(ref, { reservedQty: Number(p.reservedQty || 0) + qty });
        tx.create(doc("work_reservations", id), {
          id,
          serviceId: s.id,
          productId: p.id,
          name: p.name || p.id,
          qty,
          unitCost: money(p.cost || 0),
          status: "reserved",
          createdAt: now(),
        });
        audit(tx, req, "part.reserved", s.id, { productId: p.id, qty });
      });
      models.invalidate("products");
      res.json({ ok: true });
    }),
  );
  app.post(
    "/api/work/reservations/:id/:action",
    verifyLogin,
    verifyAdminApi,
    handler(async (req, res) => {
      const action = req.params.action;
      if (!["consume", "release"].includes(action))
        throw new Error("Ação inválida.");
      await db.runTransaction(async (tx) => {
        const ref = doc("work_reservations", req.params.id);
        const r = requireRow(await tx.get(ref));
        if (r.status !== "reserved") throw new Error("Reserva já encerrada.");
        const productRef = doc("products", r.productId);
        const p = requireRow(await tx.get(productRef));
        const serviceRef = doc("service_orders", r.serviceId);
        const s = requireRow(await tx.get(serviceRef));
        if (
          Number(p.reservedQty || 0) < r.qty ||
          (action === "consume" && Number(p.qty || 0) < r.qty)
        )
          throw new Error("Estoque inconsistente; revise o catálogo.");
        tx.update(productRef, {
          reservedQty: Number(p.reservedQty || 0) - r.qty,
          ...(action === "consume" ? { qty: Number(p.qty || 0) - r.qty } : {}),
        });
        if (action === "consume")
          tx.update(serviceRef, {
            partsCost: money(Number(s.partsCost || 0) + r.qty * r.unitCost),
          });
        tx.update(ref, {
          status: action === "consume" ? "consumed" : "released",
          updatedAt: now(),
        });
        audit(tx, req, `part.${action}`, r.serviceId, { reservationId: r.id });
      });
      models.invalidate("products");
      models.invalidate("service_orders");
      res.json({ ok: true });
    }),
  );
  // Record the operator's confirmation, not an unverified WhatsApp delivery receipt.
  app.post(
    "/api/work/services/:id/reminders",
    verifyLogin,
    workshop,
    handler(async (req, res) => {
      const kind = text(req.body.kind, 80);
      const day = date(req.body.day);
      if (!kind || !day) throw new Error("Informe assunto e data.");
      const id = hash(
        `${req.params.id}:${kind.normalize("NFKC").toLowerCase().replace(/\s+/g, " ")}:${day}`,
      );
      await db.runTransaction(async (tx) => {
        requireRow(await tx.get(doc("service_orders", req.params.id)));
        const ref = doc("work_reminders", id);
        if ((await tx.get(ref)).exists)
          throw new Error("Este contato já foi registrado para essa data.");
        tx.create(ref, {
          serviceId: req.params.id,
          kind,
          day,
          notes: text(req.body.notes, 1000),
          operator: owner(req),
          confirmedAt: now(),
          status: "operator_confirmed",
        });
        audit(tx, req, "contact.confirmed", req.params.id, { kind, day });
      });
      res.json({ ok: true });
    }),
  );
  app.post(
    "/api/work/services/:id/reminders/send",
    verifyLogin,
    workshop,
    handler(async (req, res) => {
      const kind = text(req.body.kind, 80),
        day = date(req.body.day),
        message = text(req.body.message, 2000);
      if (!kind || !day || !message)
        throw new Error("Informe assunto, data e mensagem.");
      if (!whatsapp?.isReady())
        throw new Error(
          "WhatsApp desconectado. Conecte em Configurações antes de enviar.",
        );
      const service = requireRow(
        await doc("service_orders", req.params.id).get(),
      );
      if (!/^\+?[\d\s()-]{10,25}$/.test(service.customerPhone || ""))
        throw new Error("Telefone do cliente inválido.");
      const id = hash(
        `${service.id}:${kind.normalize("NFKC").toLowerCase().replace(/\s+/g, " ")}:${day}`,
      );
      const ref = doc("work_reminders", id);
      await db.runTransaction(async (tx) => {
        if ((await tx.get(ref)).exists)
          throw new Error(
            "Já existe contato ou tentativa de envio para este assunto e data. Consulte o histórico.",
          );
        tx.create(ref, {
          serviceId: service.id,
          kind,
          day,
          notes: message,
          status: "sending",
          operator: owner(req),
          createdAt: now(),
        });
        audit(tx, req, "contact.send_requested", service.id, {
          reminderId: id,
        });
      });
      try {
        const result = await whatsapp.sendText(service.customerPhone, message, {
          attempts: 1,
        });
        await ref.update({
          status: "sent",
          messageId: result.messageId || "",
          confirmedAt: now(),
        });
        res.json({ ok: true });
      } catch (e) {
        await ref.update({
          status: "unknown",
          error: text(e.message),
          updatedAt: now(),
        });
        throw new Error(
          "Envio sem confirmação. Confira a conversa no WhatsApp antes de enviar novamente; a tentativa ficou registrada.",
        );
      }
    }),
  );
  app.get(
    "/api/work/clients/:id/timeline",
    verifyLogin,
    handler(async (req, res) => {
      const customer = requireRow(await doc("customers", req.params.id).get());
      const [services, budgets, sales] = await Promise.all([
        db
          .collection("service_orders")
          .where("customerId", "==", customer.id)
          .get(),
        db.collection("budgets").where("customerId", "==", customer.id).get(),
        db.collection("sales").where("client", "==", customer.name).get(),
      ]);
      res.json({
        customer: { id: customer.id, name: customer.name },
        events: [
          ...rows(services).map((s) => ({
            kind: s.originalServiceId ? "Retorno" : "OS",
            title: `${s.code} · ${s.deviceBrandModel || ""}`,
            at: s.createdAt,
            href: `/services/${encodeURIComponent(s.id)}`,
          })),
          ...rows(budgets).map((b) => ({
            kind: "Orçamento",
            title: b.code,
            at: b.createdAt,
            href: `/budgets?open=${encodeURIComponent(b.id)}`,
          })),
          ...rows(sales)
            .filter((s) => s.customerId === customer.id)
            .map((s) => ({
              kind: "Venda",
              title: s.code,
              at: s.createdAt,
              href: "/cash-flow",
            })),
        ].sort((a, b) => String(b.at).localeCompare(String(a.at))),
      });
    }),
  );
  app.get(
    "/api/work/metrics",
    verifyLogin,
    verifyAdminApi,
    handler(async (req, res) => {
      res.json(
        repairMetrics(
          (await models.findAll({ colecao: "service_orders" })).map(
            normalizeService,
          ),
        ),
      );
    }),
  );
  app.get(
    "/api/work/audit",
    verifyLogin,
    verifyAdminApi,
    handler(async (req, res) => {
      const records = await db
        .collection("audit_events")
        .orderBy("at", "desc")
        .limit(100)
        .get();
      res.json({ events: rows(records) });
    }),
  );
  app.get(
    "/api/work/users",
    verifyLogin,
    verifyAdminApi,
    handler(async (req, res) => {
      res.json({
        users: rows(await db.collection("users").get()).map((u) => ({
          id: u.id,
          name: u.name,
          email: u.email,
          type: u.type,
        })),
      });
    }),
  );
  app.patch(
    "/api/work/users/:id/role",
    verifyLogin,
    verifyAdminApi,
    handler(async (req, res) => {
      if (!["admin", "user", "technician"].includes(req.body.type))
        throw new Error("Perfil inválido.");
      await db.runTransaction(async (tx) => {
        const ref = doc("users", req.params.id);
        const u = requireRow(await tx.get(ref));
        if (u.email === owner(req))
          throw new Error("Não altere seu próprio perfil por esta tela.");
        tx.update(ref, { type: req.body.type });
        audit(tx, req, "user.role", u.id, { type: req.body.type });
      });
      res.json({
        ok: true,
        message: "Perfil alterado. O usuário deve sair e entrar novamente.",
      });
    }),
  );
};
