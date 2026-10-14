/* Operational controls and the dedicated attendance queue. */
(() => {
  "use strict";
  const esc = (v) =>
    String(v ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
  const amount = (n) =>
    Number(n || 0).toLocaleString("pt-BR", {
      style: "currency",
      currency: "BRL",
    });
  const when = (value) => {
    if (!value) return "—";
    const d = new Date(value?._seconds ? value._seconds * 1000 : value);
    return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("pt-BR");
  };
  const url = (v) => encodeURIComponent(v || "");
  const field = (name, label, value = "", type = "text") =>
    `<label class="work-field">${esc(label)}<input class="form-input" name="${name}" type="${type}" value="${esc(value)}" ${type === "number" ? 'min="0" step="0.01"' : ""}></label>`;
  const button = (label, action, extra = "") =>
    `<button class="btn btn-ghost btn-sm" type="button" data-work-action="${action}" ${extra}>${esc(label)}</button>`;
  const admin = () => window.appData?.user?.type === "admin";
  async function api(path, body, method = body ? "POST" : "GET") {
    const r = await fetch(path, {
      method,
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const j = await r.json();
    if (path.startsWith('/api/sales/pending/') && (j.pending === false || j.sale)) {
      const key=`infocore:sale-request:${window.appData?.user?.email || ''}`;
      try {
        const attempt=JSON.parse(sessionStorage.getItem(key)||'null');
        if (attempt?.pendingToken && path===`/api/sales/pending/${encodeURIComponent(attempt.pendingToken)}`) sessionStorage.removeItem(key);
      } catch { /* A missing local attempt does not affect reconciliation. */ }
      window.dispatchEvent(new Event('work-held-changed'));
    }
    if (!r.ok || j.error)
      throw new Error(j.message || "Não foi possível concluir.");
    return j;
  }
  function panel(title) {
    const el = document.createElement("section");
    el.className = "work-panel";
    el.innerHTML = `<h3>${esc(title)}</h3><div data-work-body></div><p role="status" data-work-status></p>`;
    document.getElementById("content").prepend(el);
    return el;
  }
  function message(p, text, error = false) {
    const el = p.querySelector("[data-work-status]");
    el.textContent = text;
    el.classList.toggle("work-error", error);
  }
  function bind(p, fn) {
    p.addEventListener("click", async (e) => {
      const b = e.target.closest("[data-work-action]");
      if (!b || p.dataset.busy === "true") return;
      // Prevent adjacent forms from being edited while a refresh replaces their DOM.
      p.dataset.busy = "true";
      const controls = [...p.querySelectorAll("button,input,select,textarea")];
      const values = new Map(controls.map((c) => [c, c.disabled]));
      // Capture FormData before disabling controls (disabled fields are omitted).
      const forms = [...p.querySelectorAll("form")];
      forms.forEach(
        (f) => (f._workValues = Object.fromEntries(new FormData(f))),
      );
      controls.forEach((c) => (c.disabled = true));
      try {
        await fn(b.dataset.workAction, b);
        message(p, "Dados atualizados.");
      } catch (err) {
        message(p, err.message, true);
      } finally {
        values.forEach((disabled, c) => {
          c.disabled = disabled;
        });
        forms.forEach((f) => delete f._workValues);
        delete p.dataset.busy;
      }
    });
  }
  function data(form) {
    return form._workValues || Object.fromEntries(new FormData(form));
  }
  const list = (items, render, empty = "Nenhum registro.") =>
    `<div class="work-list">${items.length ? items.map(render).join("") : `<p>${esc(empty)}</p>`}</div>`;
  const row = (title, detail, actions = "") =>
    `<div class="work-row"><div><strong>${esc(title)}</strong><small>${esc(detail)}</small></div><div class="work-actions">${actions}</div></div>`;

  async function overview() {
    const p = panel("Seu próximo atendimento");
    try {
      const j = await api("/api/work/overview");
      p.querySelector("[data-work-body]").innerHTML = list(
        j.tasks,
        (t) =>
          row(
            t.kind,
            `${t.title} · ${t.detail}`,
            `<a class="btn btn-ghost btn-sm" href="${esc(t.href)}">Abrir atendimento →</a>`,
          ),
        "Nenhuma pendência operacional no momento.",
      );
    } catch (e) {
      message(p, e.message, true);
    }
  }

  async function workshop() {
    const p = panel("Ficha do atendimento");
    const id = window.appData.service.id;
    async function refresh() {
      const j = await api(`/api/work/services/${url(id)}`);
      const s = j.service,
        b = j.budget,
        v = j.sale;
      p.dataset.version = s.operationalVersion || 0;
      p.querySelector("[data-work-body]").innerHTML = `
            <p>${esc(s.customerName)} · ${esc(s.deviceBrandModel)} · ${esc(s.code)}</p>
            <div class="work-actions">${b ? `<a href="/budgets?open=${url(b.id)}">Orçamento ${esc(b.code)}</a>` : "Sem orçamento vinculado"} ${v ? `<a href="/cash-flow">Venda ${esc(v.code)}</a>` : ""} ${s.customerId ? `<a href="/clients?timeline=${url(s.customerId)}">Histórico do cliente</a>` : ""}</div>
            <p>Próximo passo: ${esc(s.nextAction || "Defina a ação abaixo")} · ${v ? `Venda ${amount(v.total)} · recebido ${amount(v.amountPaid)} · saldo ${amount(v.balance)}` : `Estimativa ${amount(s.estimateValue)} · pagamento ainda não vinculado`}</p>
            <form id="workServiceForm"><details open><summary>Responsável, prazo e equipamento</summary><div class="work-grid">
            ${field("technician", "Técnico responsável", s.technician)}${field("dueDate", "Previsão de conclusão", s.dueDate, "date")}${field("nextAction", "Próxima ação", s.nextAction)}${field("blockedReason", "Motivo do bloqueio", s.blockedReason)}${field("followUpDate", "Próximo retorno ao cliente", s.followUpDate, "date")}${field("serial", "Número de série / IMEI", s.serial)}
            </div></details><details><summary>Garantia, retorno e custos</summary><div class="work-grid">${field("warrantyUntil", "Garantia até", s.warrantyUntil, "date")}${field("warrantyCoverage", "Item / serviço coberto", s.warrantyCoverage)}<label class="work-field">OS original (em caso de retorno)<select class="form-input" name="originalServiceId"><option value="">Atendimento sem retorno vinculado</option>${[
              ...j.history,
              ...(j.original && !j.history.some((h) => h.id === j.original.id)
                ? [j.original]
                : []),
            ]
              .filter((h) => h.id !== s.id)
              .map(
                (h) =>
                  `<option value="${esc(h.id)}" ${h.id === s.originalServiceId ? "selected" : ""}>${esc(h.code)} · garantia até ${when(h.warrantyUntil)}</option>`,
              )
              .join(
                "",
              )}</select><small>Salve a série/IMEI para localizar OS anteriores deste equipamento.</small></label>${field("returnCause", "Causa do retorno", s.returnCause)}${field("laborHours", "Horas trabalhadas", s.laborHours, "number")}
            ${admin() ? field("hourlyCost", "Custo por hora (R$)", s.hourlyCost, "number") + field("reworkCost", "Custo adicional de retrabalho (R$)", s.reworkCost, "number") : ""}</div></details><div class="work-actions">${button("Salvar ficha", "save-service")}</div></form>
            ${s.equipmentId ? `<div class="work-row"><img src="/api/work/equipment/${url(s.equipmentId)}/qr" alt="QR da ficha do equipamento"><div><a target="_blank" rel="noopener" href="/api/work/equipment/${url(s.equipmentId)}/qr">Abrir etiqueta QR para imprimir</a><p>A ficha exige login na oficina.</p></div></div>` : ""}
            <details><summary>Histórico deste equipamento (${j.history.length})</summary>${list(j.history, (h) => row(h.code, `${h.issueReport || h.deviceBrandModel} · ${when(h.createdAt)} · ${h.status}`, `<a href="/services/${url(h.id)}">Abrir OS</a>`))}</details>
            <details><summary>Compras e peças reservadas</summary><p>Marcar compra como recebida confirma a chegada. Cadastre a entrada física no Catálogo antes de reservar. Consumir uma reserva baixa o estoque e registra o custo na OS.</p>
            ${list(j.purchases, (r) => row(`${r.description} · ${r.supplier}`, `${r.orderCode || ""} · ${r.status} · previsão ${when(r.expectedAt)}`, r.status === "ordered" ? button("Recebida", "purchase-received", `data-id="${esc(r.id)}"`) + button("Cancelar pedido", "purchase-cancelled", `data-id="${esc(r.id)}"`) : ""))}
            <form id="workPurchaseForm"><div class="work-grid">${field("supplier", "Fornecedor")}${field("description", "Peça solicitada")}${field("orderCode", "Número do pedido")}${field("expectedAt", "Previsão de chegada", "", "date")}</div>${button("Registrar pedido", "purchase")}</form>
            ${list(j.reservations, (r) => row(r.name, `${r.qty} un. · ${r.status}`, admin() && r.status === "reserved" ? button("Aplicar no reparo", "consume", `data-id="${esc(r.id)}"`) + button("Liberar reserva", "release", `data-id="${esc(r.id)}"`) : ""))}
            ${admin() ? `<form id="workReserveForm"><div class="work-grid"><label class="work-field">Peça do Catálogo<select class="form-input" name="productId">${(j.products || []).map((p) => `<option value="${esc(p.id)}" ${p.available <= 0 ? "disabled" : ""}>${esc(p.name)} · ${p.available} disponíveis</option>`).join("")}</select></label>${field("qty", "Quantidade", 1, "number")}</div>${button("Reservar peça", "reserve")}</form><p>Custo de peças aplicadas: ${amount(s.partsCost)}</p>` : ""}</details>
            <details><summary>Pós-venda e contatos</summary><p>Envie pela conexão da loja ou registre um contato realizado manualmente. Cada assunto tem uma única tentativa por data.</p>
            <a class="btn btn-ghost btn-sm" target="_blank" rel="noopener" href="https://wa.me/${url(
              (String(s.customerPhone || "")
                .replace(/\D/g, "")
                .startsWith("55")
                ? ""
                : "55") + String(s.customerPhone || "").replace(/\D/g, ""),
            )}?text=${url(`Olá! Sobre seu atendimento ${s.code}: ${s.nextAction || "podemos conversar?"}`)}">Abrir WhatsApp</a>
            <form id="workReminderForm"><div class="work-grid">${field("kind", "Assunto (ex.: retirada)")}${field("day", "Data do contato", new Date().toISOString().slice(0, 10), "date")}${field("notes", "Resumo do contato manual")}<label class="work-field">Mensagem para enviar<textarea name="message" class="form-input" rows="3" maxlength="2000"></textarea></label></div>${button("Enviar lembrete pelo WhatsApp", "send-reminder")}${button("Confirmar contato manual", "reminder")}</form>
            ${list(j.reminders, (r) => row(r.kind, `${when(r.day)} · ${{ sent: "Enviado", sending: "Envio iniciado", unknown: "Sem confirmação", operator_confirmed: "Contato confirmado pelo operador" }[r.status] || r.status} · ${r.notes || ""} · ${r.operator}`))}</details>
            <details><summary>Checklist e confirmação de entrega</summary>${s.delivery ? `<p>Recebido por ${esc(s.delivery.receivedBy)} em ${when(s.delivery.confirmedAt)}.</p>` : `<form id="workDeliveryForm"><label class="work-check"><input type="checkbox" name="tested"> Funcionamento testado</label><label class="work-check"><input type="checkbox" name="accessoriesChecked"> Acessórios conferidos</label><label class="work-check"><input type="checkbox" name="customerConfirmed"> Cliente confirmou o recebimento</label>${field("receivedBy", "Nome de quem recebeu")}${button("Registrar entrega", "deliver")}</form><p>Disponível após concluir o reparo. Esta confirmação fica registrada no histórico.</p>`}</details>`;
    }
    bind(p, async (action, b) => {
      const base = `/api/work/services/${url(id)}`;
      if (action === "save-service")
        await api(
          base,
          {
            ...data(p.querySelector("#workServiceForm")),
            version: Number(p.dataset.version),
          },
          "PATCH",
        );
      if (action === "purchase")
        await api(
          `${base}/purchases`,
          data(p.querySelector("#workPurchaseForm")),
        );
      if (action.startsWith("purchase-"))
        await api(
          `/api/work/purchases/${url(b.dataset.id)}`,
          { status: action === "purchase-received" ? "received" : "cancelled" },
          "PATCH",
        );
      if (action === "reserve")
        await api(
          `${base}/reservations`,
          data(p.querySelector("#workReserveForm")),
        );
      if (["consume", "release"].includes(action))
        await api(`/api/work/reservations/${url(b.dataset.id)}/${action}`, {});
      if (action === "send-reminder")
        await api(
          `${base}/reminders/send`,
          data(p.querySelector("#workReminderForm")),
        );
      if (action === "reminder")
        await api(
          `${base}/reminders`,
          data(p.querySelector("#workReminderForm")),
        );
      if (action === "deliver") {
        const f = p.querySelector("#workDeliveryForm");
        await api(`${base}/deliver`, {
          receivedBy: f.elements.receivedBy.value,
          tested: f.elements.tested.checked,
          accessoriesChecked: f.elements.accessoriesChecked.checked,
          customerConfirmed: f.elements.customerConfirmed.checked,
        });
        location.reload();
        return;
      }
      await refresh();
    });
    await refresh();
  }
  async function queue() {
    const p = panel("Fila por responsável e próxima ação");
    const equipment = new URLSearchParams(location.search).get("equipment");
    let services = window.appData.services || [];
    if (equipment) {
      const j = await api(`/api/work/equipment/${url(equipment)}`);
      services = j.history;
    }
    const body = p.querySelector("[data-work-body]");
    body.innerHTML = `<label class="work-field">Buscar técnico, série, cliente ou bloqueio<input class="form-input" data-work-search type="search" placeholder="Digite para filtrar a fila"></label><div data-work-queue></div>`;
    function render() {
      const q = body.querySelector("input").value.toLowerCase();
      const filtered = services
        .filter(
          (s) =>
            (equipment || s.status !== "delivered") &&
            [
              s.technician,
              s.serial,
              s.customerName,
              s.blockedReason,
              s.nextAction,
            ]
              .join(" ")
              .toLowerCase()
              .includes(q),
        )
        .sort((a, b) =>
          (a.dueDate || "9999").localeCompare(b.dueDate || "9999"),
        );
      body.querySelector("[data-work-queue]").innerHTML = list(filtered, (s) =>
        row(
          `${s.code} · ${s.customerName}`,
          `${s.technician || "Sem responsável"} · ${when(s.dueDate)} · ${s.nextAction || "Próxima ação não definida"}${s.blockedReason ? " · Bloqueio: " + s.blockedReason : ""}`,
          `<a href="/services/${url(s.id)}">Abrir ficha →</a>`,
        ),
      );
    }
    body.querySelector("input").addEventListener("input", render);
    render();
  }
  async function held() {
    const p = panel("Continue um atendimento");
    p.classList.add('attendance-panel');
    let currentTab = 'held';
    let search = '';
    const modes = {creation_pending:'Cobrança sem vínculo',pix_online:'Pix',mp_qr_instore:'Pix na loja',point:'Maquininha'};
    function applyView() {
      p.querySelectorAll('[data-attendance-tab]').forEach(b => { const active = b.dataset.attendanceTab === currentTab; b.setAttribute('aria-pressed', String(active)); });
      p.querySelectorAll('[data-attendance-section]').forEach(section => { section.hidden = section.dataset.attendanceSection !== currentTab; });
      p.querySelectorAll('[data-attendance-section="held"] .work-row').forEach(row => { row.hidden = !row.textContent.toLocaleLowerCase('pt-BR').includes(search.toLocaleLowerCase('pt-BR')); });
      const empty = p.querySelector('[data-search-empty]');
      if (empty) empty.hidden = !search || [...p.querySelectorAll('[data-attendance-section="held"] .work-row')].some(row => !row.hidden);
    }
    p.addEventListener('click', event => {
      const tab = event.target.closest('[data-attendance-tab]');
      if (tab) { currentTab = tab.dataset.attendanceTab; applyView(); }
    });
    p.addEventListener('input', event => { if (event.target.id === 'attendanceSearch') { search = event.target.value; applyView(); } });
    async function refresh() {
      const [h, j] = await Promise.all([
        api("/api/work/held-sales"),
        api("/api/work/payments"),
      ]);
      p._held = h.sales;
      p.querySelector("[data-work-body]").innerHTML =
        `<p class="attendance-intro">Retome uma venda guardada ou confira uma cobrança em andamento.</p>
        <div class="attendance-toolbar"><div class="attendance-tabs" role="group" aria-label="Tipo de atendimento"><button type="button" data-attendance-tab="held">Vendas suspensas <span>${h.sales.length}</span></button><button type="button" data-attendance-tab="payments">Pagamentos pendentes <span>${j.payments.length}</span></button></div>${button("Atualizar", "refresh")}</div>
        <section data-attendance-section="held" aria-label="Vendas suspensas"><label class="work-field attendance-search" for="attendanceSearch">Buscar atendimento<input class="form-input" id="attendanceSearch" type="search" placeholder="Nome do cliente" value="${esc(search)}"></label>
        <p class="attendance-hint">Carrinhos guardados, sem cobrança. Ao retomar, os preços e o estoque serão conferidos no PDV.</p>
        ${list(h.sales, (s) => row(s.customer || "Balcão", `${s.cart.reduce((sum,item)=>sum+Number(item.qty || 0),0)} unidade(s) · ${s.cart.length} tipo(s) de item · ${when(s.heldAt)}`, button("Retomar", "resume", `data-id="${esc(s.id)}"`)), "Nenhum atendimento suspenso. Use Suspender (F8) no PDV para guardar uma venda.")}
        <p data-search-empty hidden>Nenhum atendimento encontrado para esta busca.</p></section>
        <section data-attendance-section="payments" aria-label="Pagamentos pendentes"><p class="attendance-hint">Consulte a cobrança existente antes de tentar cobrar novamente. A confirmação conclui a venda e atualiza o estoque.</p>${list(j.payments, (s) => row(s.code, `${amount(s.total)} · ${modes[s.mode] || 'Pagamento em consulta'}`, button("Consultar pagamento", "reconcile", `data-id="${esc(s.token)}"`)), "Tudo em dia. Não há cobranças aguardando consulta.")}
            ${
              admin() && j.payments.some((s) => s.mode === "creation_pending")
                ? `<details class="attendance-recovery"><summary>Recuperar uma cobrança sem vínculo</summary><form id="workPaymentRecovery"><p>Se a criação foi interrompida, localize a cobrança existente no Mercado Pago pela referência da venda e informe seu ID. O sistema confere referência e valor antes de vincular.</p><div class="work-grid"><label class="work-field">Venda sem vínculo<select class="form-input" name="token">${j.payments
                    .filter((s) => s.mode === "creation_pending")
                    .map(
                      (s) =>
                        `<option value="${esc(s.token)}">${esc(s.code)} · ${amount(s.total)}</option>`,
                    )
                    .join(
                      "",
                    )}</select></label>${field("providerId", "ID da cobrança no Mercado Pago")}</div>${button("Recuperar vínculo existente", "recover-payment")}</form></details>`
                : ""
            }</section>`;
      applyView();
    }
    bind(p, async (action, b) => {
      if (action === "recover-payment") {
        const values = data(p.querySelector("#workPaymentRecovery"));
        await api(`/api/sales/pending/${url(values.token)}/recover`, {
          providerId: values.providerId,
        });
      }
      if (action === "resume") {
        location.assign(`/pdv?resume=${url(b.dataset.id)}`);
        return;
      }
      if (action === "reconcile") {
        const j = await api(`/api/sales/pending/${url(b.dataset.id)}`);
        if (j.pending)
          throw new Error(
            j.message ||
              "Pagamento ainda pendente no provedor. Consulte novamente após a confirmação.",
          );
        showToast("Pagamento conciliado com venda e estoque.", "success");
      }
      await refresh();
    });
    window.addEventListener("work-held-changed", () => {
      if (p.dataset.busy !== "true") refresh().catch((e) => message(p, e.message, true));
    });
    await refresh();
  }
  async function register() {
    const p = panel("Caixa por operador e recebimentos");
    let receiptId = crypto.randomUUID();
    async function refresh() {
      const [j, r] = await Promise.all([
        api("/api/work/register"),
        api("/api/work/receivables"),
      ]);
      p.querySelector("[data-work-body]").innerHTML =
        `<p>Vendas representam o valor negociado; recebimentos representam dinheiro recebido. O fechamento abaixo considera dinheiro das vendas e recebimentos registrados durante a abertura. Lançamentos manuais do extrato devem ser conferidos separadamente.</p>
            ${j.active ? `<p class="work-amount">Esperado em dinheiro: ${amount(j.active.opening + j.active.netCash)}</p><form id="workRegisterForm"><div class="work-grid">${field("counted", "Dinheiro contado", "", "number")}${field("notes", "Observação da diferença")}</div>${button("Fechar meu caixa", "close")}</form>` : `<form id="workRegisterForm"><div class="work-grid">${field("opening", "Fundo de abertura em dinheiro", 0, "number")}</div>${button("Abrir meu caixa", "open")}</form>`}
            <details><summary>Fechamentos anteriores</summary>${list(
              j.history.filter((h) => h.status === "closed"),
              (h) =>
                row(
                  when(h.closedAt),
                  `Esperado ${amount(h.expected)} · contado ${amount(h.counted)} · diferença ${amount(h.difference)}`,
                ),
            )}</details>
            <details open><summary>Recebimentos e devoluções de vendas</summary><p>Registre somente valores já confirmados. Esta ação registra o recebimento; não efetua cobrança ou estorno no Mercado Pago. Devoluções registradas aqui não repõem estoque.</p>
            <form id="workReceiptForm"><div class="work-grid"><label class="work-field">Venda<select class="form-input" name="saleId">${r.sales.map((s) => `<option value="${esc(s.id)}">${esc(s.code)} · ${esc(s.client)} · saldo ${amount(s.balance)} · recebido ${amount(s.paid)} · devolvido ${amount(s.refunded)}</option>`).join("")}</select></label>${field("amount", "Valor confirmado", "", "number")}<label class="work-field">Meio<select class="form-input" name="payment"><option value="money">Dinheiro</option><option value="pix">Pix confirmado</option><option value="credit_card">Crédito confirmado</option><option value="debit_card">Débito confirmado</option></select></label>${field("notes", "Motivo / comprovante")}</div>${button("Registrar recebimento", "receive")}${admin() ? button("Registrar devolução", "refund") : ""}</form></details>`;
    }
    bind(p, async (action) => {
      if (["open", "close"].includes(action))
        await api(
          `/api/work/register/${action}`,
          data(p.querySelector("#workRegisterForm")),
        );
      else {
        const values = data(p.querySelector("#workReceiptForm"));
        await api(`/api/work/sales/${url(values.saleId)}/${action}`, {
          ...values,
          requestId: receiptId,
        });
        receiptId = crypto.randomUUID();
      }
      await refresh();
    });
    await refresh();
  }
  async function timeline() {
    const p = panel("Histórico completo do cliente");
    const customers = window.appData.customers || [];
    p.querySelector("[data-work-body]").innerHTML =
      `<label class="work-field">Cliente<select class="form-input" data-work-customer><option value="">Selecione</option>${customers.map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join("")}</select></label><div data-work-events></div>`;
    const select = p.querySelector("select");
    async function load() {
      if (!select.value) return;
      try {
        const j = await api(`/api/work/clients/${url(select.value)}/timeline`);
        p.querySelector("[data-work-events]").innerHTML = list(j.events, (e) =>
          row(
            `${e.kind} · ${e.title}`,
            when(e.at),
            `<a href="${esc(e.href)}">Abrir</a>`,
          ),
        );
      } catch (e) {
        message(p, e.message, true);
      }
    }
    select.addEventListener("change", load);
    select.value = new URLSearchParams(location.search).get("timeline") || "";
    await load();
  }
  async function metrics() {
    const p = panel("Qualidade e rentabilidade dos reparos");
    const j = await api("/api/work/metrics");
    p.querySelector("[data-work-body]").innerHTML =
      `<div class="work-grid"><div>Retornos vinculados<p class="work-amount">${j.returnCount} / ${j.total} (${j.returnRate.toFixed(1)}%)</p></div><div>Tempo médio até entrega confirmada<p class="work-amount">${j.averageHours.toFixed(1)} h</p></div></div><p>Margem estimada com base no valor previsto da OS, peças aplicadas, horas × custo/hora e retrabalho. Não representa recebimento realizado.</p>${list(j.margins, (m) => row(m.code, `Receita estimada ${amount(m.estimatedRevenue)} · custo ${amount(m.cost)} · resultado ${amount(m.profit)}`, `<a href="/services/${url(m.id)}">Abrir OS</a>`))}<details><summary>Horas paradas por motivo</summary>${list(Object.entries(j.blockedHours), ([reason, h]) => row(reason, `${h.toFixed(1)} horas`))}</details>`;
  }
  async function databaseUsage() {
    const p = panel("Uso local de leituras do banco");
    const body = p.querySelector("[data-work-body]");
    const update = async () => {
      try {
        const j = await api("/api/work/database-usage");
        body.innerHTML = `<p>${esc(j.note)}</p><p>Desde ${esc(new Date(j.metrics.startedAt).toLocaleString('pt-BR'))}</p>${list(Object.entries(j.metrics.collections), ([name,m])=>row(name, `${m.queries} consultas iniciadas · ${m.documents} documentos retornados · ${m.cacheHits} usos de cache · ${m.sharedReads} consultas agrupadas · ${m.failures} falhas`))}<button type="button" class="btn btn-ghost btn-sm" data-refresh-usage>Atualizar contadores</button><p>Contingência no servidor: execute <code>node scripts/contingency.js</code> para gerar a consulta local sem acessar o Firebase.</p>`;
        body.querySelector('[data-refresh-usage]').onclick = update;
      } catch(error) {message(p,error.message,true);}
    };
    await update();
  }
  async function roles() {
    await databaseUsage();
    const p = panel("Perfis de acesso");
    const [j, audit] = await Promise.all([
      api("/api/work/users"),
      api("/api/work/audit"),
    ]);
    p.querySelector("[data-work-body]").innerHTML =
      "<p>Técnicos acessam somente a oficina. Alterações passam a valer no próximo login.</p>" +
      list(j.users, (u) => {
        const options = [
          ["user", "Caixa"],
          ["technician", "Técnico"],
          ["admin", "Administrador"],
        ]
          .map(
            ([v, l]) =>
              `<option value="${v}" ${u.type === v ? "selected" : ""}>${l}</option>`,
          )
          .join("");
        return row(
          u.name,
          u.email,
          `<select class="form-input" data-user="${esc(u.id)}">${options}</select>` +
            button("Salvar perfil", "role", `data-id="${esc(u.id)}"`),
        );
      });
    p.querySelector("[data-work-body]").insertAdjacentHTML(
      "beforeend",
      `<details><summary>Últimas alterações críticas</summary>${list(audit.events, (e) => row(e.action, `${when(e.at)} · ${e.actor?.email || e.actor || ""} · ${e.targetId}`))}</details>`,
    );
    bind(p, async (_, b) => {
      const select = [...p.querySelectorAll("select")].find(
        (s) => s.dataset.user === b.dataset.id,
      );
      const j = await api(
        `/api/work/users/${url(b.dataset.id)}/role`,
        { type: select.value },
        "PATCH",
      );
      showToast(j.message, "success");
    });
  }
  window.__dataReady
    .then(async () => {
      const page = document.body.dataset.page;
      const tasks = {
        dashboard: overview,
        "service-work": workshop,
        services: queue,
        attendances: held,
        cashflow: register,
        clients: timeline,
        analytics: metrics,
        config: roles,
      };
      if (tasks[page]) await tasks[page]();
      if (page === "budgets") {
        const id = new URLSearchParams(location.search).get("open");
        if (id) {
          const b = (window.appData.budgets || []).find((b) => b.id === id);
          if (b) setTimeout(() => window.openEditBudget(b), 100);
        }
      }
    })
    .catch((e) => {
      const p = panel("Controles operacionais");
      message(p, e.message, true);
    });
})();
