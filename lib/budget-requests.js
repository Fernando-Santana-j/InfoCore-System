"use strict";
const databaseAvailability = require("./database-availability");
const { randomUUID } = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const multer = require("multer");
const PROBLEMS = [
  "Não liga",
  "Lentidão",
  "Superaquecimento",
  "Tela / imagem",
  "Bateria / carregamento",
  "Sem internet",
  "Ruído / travamento",
  "Dano físico",
  "Instalação / configuração",
  "Outro",
];
const clean = (v, max = 3000) =>
  String(v || "")
    .trim()
    .slice(0, max);
const fail = (message, status = 400) =>
  Object.assign(new Error(message), { status });
const reviewer = (req) =>
  ["admin", "technician"].includes(req.session.user?.type);
const actor = (req) => ({
  name: clean(req.session.user?.name, 120),
  email: clean(req.session.user?.email, 180),
  id: clean(req.session.user?.id, 120),
});
const owner = (req) => actor(req).email || actor(req).id;
function normalizeInput(body = {}) {
  const data = {
    customerId: clean(body.customerId, 150),
    customerName: clean(body.customerName, 120),
    customerPhone: clean(body.customerPhone, 40),
    customerEmail: clean(body.customerEmail, 180),
    device: clean(body.device, 180),
    description: clean(body.description),
    deviceType: [
      "Celular",
      "Notebook",
      "Computador",
      "Tablet",
      "Impressora",
      "Outro",
    ].includes(body.deviceType)
      ? body.deviceType
      : "Outro",
    serialNumber: clean(body.serialNumber, 120),
    accessories: clean(body.accessories, 500),
    physicalCondition: clean(body.physicalCondition, 1000),
    priority: ["normal", "high", "urgent"].includes(body.priority)
      ? body.priority
      : "normal",
    problems: [
      ...new Set(
        (Array.isArray(body.problems) ? body.problems : []).filter((x) =>
          PROBLEMS.includes(x),
        ),
      ),
    ],
  };
  if (
    !data.customerName ||
    !data.device ||
    (!data.description && !data.problems.length)
  )
    throw fail(
      "Informe cliente, equipamento e ao menos um problema ou descrição.",
    );
  if (data.customerPhone.replace(/\D/g, "").length < 10)
    throw fail("Informe um telefone com DDD.");
  return data;
}
function imageType(buffer) {
  if (buffer.length < 12) return "";
  if (
    buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    return "png";
  if (buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255) return "jpg";
  if (
    buffer.toString("ascii", 0, 4) === "RIFF" &&
    buffer.toString("ascii", 8, 12) === "WEBP"
  )
    return "webp";
  return "";
}
function install(
  app,
  {
    firestore: db,
    models,
    verifyLogin,
    verifyAdminApi,
    buildBudget,
    buildService = (data) => data,
    photoDir = path.join(__dirname, "../private-uploads/budget-requests"),
  },
) {
  const wrap = (fn) => async (req, res) => {
    try {
      await fn(req, res);
    } catch (e) {
      if (databaseAvailability.observe(e)) return databaseAvailability.respond(e, req, res, () => {});
      console.error("budget-request", e.message);
      res.status(e.status || 500).json({
        error: true,
        message: e.status
          ? e.message
          : "Não foi possível concluir. Tente novamente.",
      });
    }
  };
  const destination = (value) => {
    if (!["budget_only", "service_after_approval"].includes(value))
      throw fail("Escolha somente orçamento ou OS após aprovação.");
    return value;
  };
  const ref = (id) => db.collection("budget_requests").doc(clean(id, 150));
  const read = async (id) => {
    const s = await ref(id).get();
    if (!s.exists) throw fail("Solicitação não encontrada.", 404);
    return { ...s.data(), id: s.id };
  };
  const editable = (req, r) => {
    if (!reviewer(req) && r.createdByKey !== owner(req))
      throw fail("Você não pode alterar esta solicitação.", 403);
    if (r.status !== "open")
      throw fail(
        "Anexos só podem ser alterados enquanto a solicitação aguarda análise.",
        409,
      );
  };
  const audit = (tx, req, action, id) =>
    tx.set(db.collection("audit_events").doc(randomUUID()), {
      action,
      targetId: id,
      actor: actor(req),
      at: new Date().toISOString(),
    });
  app.get('/api/budget-requests/intake-options', verifyLogin, wrap(async (req, res) => {
    const customers = req.query?.customers === '1'
      ? (await models.findAll({colecao:'customers'})).map(c => ({id:c.id,name:c.name || '',phone:c.phone || '',email:c.email || '',doc:c.doc || ''}))
      : undefined;
    res.json({problems:PROBLEMS, ...(customers ? {customers} : {})});
  }));
  app.get(
    "/api/budget-requests",
    verifyLogin,
    wrap(async (req, res) => {
      const snap = await db
        .collection("budget_requests")
        .orderBy("createdAt", "desc")
        .limit(150)
        .get();
      const requests = snap.docs.map((d) => ({ ...d.data(), id: d.id }));
      void require('./local-snapshots').capture('budget_requests', requests);
      res.json({
        requests,
        problems: PROBLEMS,
      });
    }),
  );
  app.get(
    "/api/budget-requests/:id",
    verifyLogin,
    wrap(async (req, res) => res.json({ request: await read(req.params.id) })),
  );
  app.post(
    "/api/budget-requests",
    verifyLogin,
    wrap(async (req, res) => {
      const data = normalizeInput(req.body),
        id = clean(req.body.id, 100) || randomUUID();
      if (!/^[a-zA-Z0-9-]{8,100}$/.test(id))
        throw fail("Identificador inválido.");
      await db.runTransaction(async (tx) => {
        const old = await tx.get(ref(id));
        if (old.exists) {
          if (old.data().createdByKey !== owner(req))
            throw fail("Identificador já utilizado.", 409);
          return;
        }
        tx.create(ref(id), {
          ...data,
          id,
          code: "SOL-" + id.slice(0, 8).toUpperCase(),
          status: "open",
          destination: "budget_only",
          photos: [],
          createdBy: actor(req),
          createdByKey: owner(req),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
        audit(tx, req, "budget_request.created", id);
      });
      res.json({ error: false, request: await read(id) });
    }),
  );
  app.patch(
    "/api/budget-requests/:id/review",
    verifyLogin,
    wrap(async (req, res) => {
      if (!reviewer(req))
        throw fail(
          "A análise é exclusiva da equipe técnica e administradores.",
          403,
        );
      const status = clean(req.body.status),
        reviewNotes = clean(req.body.reviewNotes);
      if (!["in_review", "approved", "rejected"].includes(status))
        throw fail("Etapa inválida.");
      if (status !== "in_review" && !reviewNotes)
        throw fail("Descreva a análise antes de aprovar ou recusar.");
      await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref(req.params.id));
        if (!snap.exists) throw fail("Solicitação não encontrada.", 404);
        const old = snap.data();
        if (["converted", "rejected"].includes(old.status))
          throw fail("Esta solicitação está encerrada.", 409);
        tx.update(ref(req.params.id), {
          status,
          reviewNotes,
          destination: destination(
            req.body.destination || old.destination || "budget_only",
          ),
          reviewedBy: actor(req),
          updatedAt: new Date().toISOString(),
        });
        audit(tx, req, "budget_request." + status, req.params.id);
      });
      res.json({ error: false, request: await read(req.params.id) });
    }),
  );
  app.patch(
    "/api/budget-requests/:id/destination",
    verifyLogin,
    wrap(async (req, res) => {
      if (!reviewer(req))
        throw fail(
          "Somente técnico ou ADM pode definir o encaminhamento.",
          403,
        );
      const value = destination(req.body.destination);
      await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref(req.params.id));
        if (!snap.exists) throw fail("Solicitação não encontrada.", 404);
        if (snap.data().serviceOrderId || snap.data().status === "rejected")
          throw fail("O encaminhamento está encerrado.", 409);
        tx.update(ref(req.params.id), {
          destination: value,
          updatedAt: new Date().toISOString(),
        });
        audit(tx, req, "budget_request.destination", req.params.id);
      });
      res.json({ error: false, request: await read(req.params.id) });
    }),
  );
  const createService = wrap(async (req, res) => {
    if (!reviewer(req))
      throw fail("Somente técnico ou ADM pode abrir a ordem de serviço.", 403);
    const requestId = req.params.id;
    let service;
    await db.runTransaction(async (tx) => {
      const snapshot = await tx.get(ref(requestId));
      if (!snapshot.exists) throw fail("Solicitação não encontrada.", 404);
      const r = { ...snapshot.data(), id: snapshot.id };
      if (r.serviceOrderId) {
        const existing = await tx.get(
          db.collection("service_orders").doc(r.serviceOrderId),
        );
        if (!existing.exists)
          throw fail("A OS vinculada não foi encontrada.", 409);
        service = { ...existing.data(), id: existing.id };
        return;
      }
      if (r.destination !== "service_after_approval")
        throw fail("Defina o encaminhamento como OS após aprovação.", 409);
      if (!r.budgetId || r.status !== "converted")
        throw fail("Crie e aprove o orçamento antes de abrir a OS.", 409);
      const budgetRef = db.collection("budgets").doc(r.budgetId);
      const budgetSnap = await tx.get(budgetRef);
      const budget = budgetSnap.data();
      if (
        !budgetSnap.exists ||
        budget.requestId !== r.id ||
        !["approved", "acquiring_parts"].includes(budget.status)
      )
        throw fail("O orçamento precisa estar aprovado para abrir a OS.", 409);
      if (budget.serviceOrderId)
        throw fail("Este orçamento já possui uma OS.", 409);
      const now = new Date().toISOString();
      service = buildService({
        id: "request-" + r.id,
        code: "OS-" + r.id.slice(0, 8).toUpperCase(),
        requestId: r.id,
        intake: r,
        budgetId: r.budgetId,
        customerId: budget.customerId || r.customerId,
        customerName: budget.customerName || r.customerName,
        customerPhone: budget.customerPhone || r.customerPhone,
        customerEmail: budget.customerEmail || r.customerEmail,
        deviceType: r.deviceType || "Outro",
        deviceBrandModel: r.device,
        serialNumber: r.serialNumber || "",
        serial: r.serialNumber || "",
        physicalCondition: r.physicalCondition || "",
        accessories: r.accessories || "",
        priority: r.priority || "normal",
        issueReport: [r.description, (r.problems || []).join(", ")]
          .filter(Boolean)
          .join("\n"),
        budgetRawNotes: budget.notes || "",
        estimateValue: Number(budget.total) || 0,
        checklist: (r.problems || []).map((label, i) => ({
          key: "intake-" + i,
          label,
          workType: "diagnostic",
          defective: true,
          customerNote: "Relatado pelo cliente; confirmar na análise.",
        })),
        progressNotes: [],
        status: "open",
        createdAt: now,
        updatedAt: now,
        createdBy: actor(req),
      });
      tx.create(db.collection("service_orders").doc(service.id), service);
      tx.update(budgetRef, { serviceOrderId: service.id, updatedAt: now });
      tx.update(ref(r.id), { serviceOrderId: service.id, updatedAt: now });
      audit(tx, req, "budget_request.service_created", r.id);
    });
    models?.invalidate?.("budgets");
    models?.invalidate?.("service_orders");
    res.json({ error: false, service, serviceId: service.id });
  });
  app.post("/api/budget-requests/:id/service", verifyLogin, createService);
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 8 * 1024 * 1024, files: 1 },
  }).single("image");
  app.post(
    "/api/budget-requests/:id/photos",
    verifyLogin,
    wrap(async (req, res) => {
      editable(req, await read(req.params.id));
      await new Promise((resolve, reject) =>
        upload(req, res, (e) =>
          e
            ? reject(
                fail(
                  e.code === "LIMIT_FILE_SIZE"
                    ? "Cada foto deve ter até 8 MB."
                    : "Não foi possível receber a foto.",
                ),
              )
            : resolve(),
        ),
      );
      const ext = imageType(req.file?.buffer || Buffer.alloc(0));
      if (!ext) throw fail("Use uma foto JPG, PNG ou WebP válida.");
      const photoId = randomUUID(),
        filename = photoId + "." + ext;
      await fs.mkdir(photoDir, { recursive: true });
      await fs.writeFile(path.join(photoDir, filename), req.file.buffer);
      try {
        await db.runTransaction(async (tx) => {
          const snap = await tx.get(ref(req.params.id));
          if (!snap.exists) throw fail("Solicitação não encontrada.", 404);
          const old = snap.data();
          editable(req, old);
          if ((old.photos || []).length >= 6)
            throw fail("Limite de seis fotos por solicitação.");
          tx.update(ref(req.params.id), {
            photos: [
              ...(old.photos || []),
              {
                id: photoId,
                filename,
                url: `/api/budget-requests/${encodeURIComponent(req.params.id)}/photos/${photoId}`,
                caption: clean(req.body.caption, 180),
              },
            ],
            updatedAt: new Date().toISOString(),
          });
        });
      } catch (e) {
        await fs.unlink(path.join(photoDir, filename)).catch(() => {});
        throw e;
      }
      res.json({ error: false, request: await read(req.params.id) });
    }),
  );
  app.get(
    "/api/budget-requests/:id/photos/:photoId",
    verifyLogin,
    wrap(async (req, res) => {
      const r = await read(req.params.id),
        photo = (r.photos || []).find((p) => p.id === req.params.photoId);
      if (!photo) throw fail("Foto não encontrada.", 404);
      res.set("Cache-Control", "private, no-store");
      res.set("X-Content-Type-Options", "nosniff");
      res.sendFile(path.join(photoDir, path.basename(photo.filename)));
    }),
  );
  app.post(
    "/api/budget-requests/:id/budget",
    verifyLogin,
    wrap(async (req, res) => {
      if (!reviewer(req))
        throw fail(
          "Somente administradores e técnicos podem criar o orçamento após análise.",
          403,
        );
      const r = await read(req.params.id);
      if (r.budgetId) return res.json({ error: false, budgetId: r.budgetId });
      if (r.status !== "approved")
        throw fail("Aprove a análise antes de criar o orçamento.", 409);
      const id = "request-" + r.id;
      const built = await buildBudget(
        {
          customerId: r.customerId,
          customerName: r.customerName,
          customerPhone: r.customerPhone,
          customerEmail: r.customerEmail,
          source: "storefront",
          notes: [
            `Equipamento: ${r.device}`,
            r.description,
            r.problems.length
              ? "Problemas relatados: " + r.problems.join(", ")
              : "",
          ]
            .filter(Boolean)
            .join("\n"),
          internalNotes: r.reviewNotes || "",
          status: "draft",
          items: [
            {
              kind: "custom",
              name: `Serviço — ${r.device}`,
              qty: 1,
              unitPrice: 0,
            },
          ],
        },
        { id, existing: null, prevStatus: null, code: null, createdAt: null },
      );
      if (built.error) throw fail(built.message);
      await db.runTransaction(async (tx) => {
        const latest = await tx.get(ref(r.id));
        if (latest.data()?.budgetId) return;
        if (
          latest.data()?.status !== "approved" ||
          latest.data()?.updatedAt !== r.updatedAt
        )
          throw fail("A solicitação mudou. Atualize e revise novamente.", 409);
        tx.create(db.collection("budgets").doc(id), {
          ...built.payload,
          requestId: r.id,
          intake: r,
        });
        tx.update(ref(r.id), {
          status: "converted",
          budgetId: id,
          updatedAt: new Date().toISOString(),
        });
        audit(tx, req, "budget_request.converted", r.id);
      });
      models?.invalidate?.("budgets");
      res.json({ error: false, budgetId: id });
    }),
  );
  return { createService };
}
module.exports = { install, normalizeInput, imageType, PROBLEMS };
