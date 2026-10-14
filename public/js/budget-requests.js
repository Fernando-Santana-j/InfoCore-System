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
  const $ = (id) => document.getElementById(id);
  const statusLabels = {
    open: "Aguardando análise",
    in_review: "Em análise",
    approved: "Aprovada",
    converted: "Orçamento criado",
    rejected: "Recusada",
  };
  let savedRequest = null;
  let rows = [],
    selected = "",
    requestId = crypto.randomUUID(),
    pendingFiles = [],
    previewUrls = [],
    busy = false;
  const canReview = () =>
    ["admin", "technician"].includes(window.appData.user.type);
  const destinations = {
    budget_only: "Somente orçamento",
    service_after_approval: "OS após aprovação do orçamento",
  };
  function destinationOptions(value) {
    return Object.entries(destinations)
      .map(
        ([key, label]) =>
          `<option value="${key}" ${value === key ? "selected" : ""}>${label}</option>`,
      )
      .join("");
  }
  async function api(url, body, method = "POST") {
    const r = await fetch(url, {
      method: body ? method : "GET",
      headers:
        body instanceof FormData ? {} : { "Content-Type": "application/json" },
      ...(body
        ? { body: body instanceof FormData ? body : JSON.stringify(body) }
        : {}),
    });
    const j = await r.json();
    if (!r.ok || j.error)
      throw new Error(
        j.message || "Não foi possível concluir. Tente novamente.",
      );
    return j;
  }
  const photoMarkup = (photos) =>
    (photos || [])
      .map(
        (p) =>
          `<a href="${esc(p.url)}" target="_blank" rel="noopener noreferrer"><img src="${esc(p.url)}" alt="${esc(p.caption || "Foto para análise")}" loading="lazy"><small>${esc(p.caption || "Ampliar foto")}</small></a>`,
      )
      .join("");
  let intakeReady = false;
  let customerRows = [];
  let customerMatches = [], customerActiveIndex = -1;
  const customerSearchText = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR');
  function hideCustomerResults() {
    $('requestCustomerResults').hidden = true;
    $('requestCustomerSearch').setAttribute('aria-expanded', 'false');
    $('requestCustomerSearch').removeAttribute('aria-activedescendant');
  }
  function highlightCustomer(index) {
    customerActiveIndex = index;
    $('requestCustomerResults').querySelectorAll('[data-customer-index]').forEach((el, i) => {
      el.classList.toggle('is-active', i === index);
      el.setAttribute('aria-selected', String(i === index));
    });
    const option = $('requestCustomerOption' + index);
    if (option) $('requestCustomerSearch').setAttribute('aria-activedescendant', option.id);
    else $('requestCustomerSearch').removeAttribute('aria-activedescendant');
  }
  function renderCustomerResults() {
    if (savedRequest || busy) return hideCustomerResults();
    const query = customerSearchText($('requestCustomerSearch').value.trim());
    const digits = query.replace(/\D/g, '');
    customerMatches = customerRows.filter(c => !query || [c.name,c.phone,c.email,c.doc].some(value => customerSearchText(value).includes(query)) ||
      (digits.length >= 3 && /^[\d\s()+.\/-]+$/.test(query) && [c.phone,c.doc].some(value => String(value || '').replace(/\D/g, '').includes(digits)))).slice(0,20);
    $('requestCustomerResults').innerHTML = customerMatches.length ? customerMatches.map((c,i) =>
      `<div id="requestCustomerOption${i}" role="option" aria-selected="false" class="request-ac-item" data-customer-index="${i}"><span class="request-ac-title">${esc(c.name)}</span><span class="request-ac-meta">${esc([c.phone,c.email,c.doc].filter(Boolean).join(' · ') || 'Sem contato cadastrado')}</span></div>`
    ).join('') : '<div class="request-ac-empty">Nenhum cliente encontrado. Preencha os dados abaixo ou tente outra busca.</div>';
    $('requestCustomerResults').hidden = false;
    $('requestCustomerSearch').setAttribute('aria-expanded', 'true');
    highlightCustomer(customerMatches.length ? 0 : -1);
  }
  function applyRequestCustomer(customer) {
    if (savedRequest || busy) return;
    $('requestCustomerId').value = customer?.id || '';
    $('requestCustomerSearch').value = customer?.name || '';
    for (const [field,key] of [['customerName','name'],['customerPhone','phone'],['customerEmail','email']]) {
      $('requestForm').elements[field].value = customer?.[key] || '';
    }
    $('requestCustomerHint').textContent = customer ? 'Cliente selecionado. Confira os contatos abaixo.' : 'Preencha os dados do cliente abaixo.';
    hideCustomerResults();
    $('requestForm').dispatchEvent(new Event('input', {bubbles:true}));
  }
  async function loadIntakeOptions() {
    const hasCustomers = Array.isArray(window.appData?.customers);
    const options = await api('/api/budget-requests/intake-options' + (hasCustomers ? '' : '?customers=1'));
    customerRows = (hasCustomers ? window.appData.customers : (options.customers || [])).slice().sort((a,b) => String(a.name || '').localeCompare(String(b.name || ''), 'pt-BR'));
    $('requestProblems').innerHTML = (options.problems || []).map(p => `<label><input type="checkbox" name="problems" value="${esc(p)}">${esc(p)}</label>`).join('');
    hideCustomerResults();
  }
  function renderList() {
    const q = $("requestSearch").value.trim().toLocaleLowerCase("pt-BR"),
      status = $("requestFilter").value;
    const filtered = rows.filter(
      (r) =>
        (!status || r.status === status) &&
        [r.code, r.customerName, r.device]
          .join(" ")
          .toLocaleLowerCase("pt-BR")
          .includes(q),
    );
    $("requestList").innerHTML =
      filtered
        .map(
          (r) =>
            `<button class="request-row" type="button" data-request="${esc(r.id)}" aria-pressed="${selected === r.id}"><span><small>${esc(r.code)}</small><strong>${esc(r.customerName)}</strong><span>${esc(r.device)}</span></span><span class="request-status status-${esc(r.status)}">${esc(r.serviceOrderId ? "OS criada" : statusLabels[r.status] || r.status)}</span></button>`,
        )
        .join("") ||
      '<p class="request-empty">Nenhuma solicitação nesta seleção.</p>';
  }
  async function refresh() {
    if ($('serviceIntakeModal')) {
      if (selected) {
        const result = await api('/api/budget-requests/' + encodeURIComponent(selected));
        rows = [result.request];
        renderDetail();
      }
      return;
    }
    const j = await api("/api/budget-requests");
    rows = j.requests || [];
    if (!$("requestProblems").children.length)
      $("requestProblems").innerHTML = j.problems
        .map(
          (p) =>
            `<label><input type="checkbox" name="problems" value="${esc(p)}">${esc(p)}</label>`,
        )
        .join("");
    renderList();
    if (selected) renderDetail();
  }
  function renderDetail() {
    const r = rows.find((x) => x.id === selected);
    if (!r) return;
    const canAttach =
      r.status === "open" &&
      (canReview() ||
        r.createdByKey ===
          (window.appData.user.email || window.appData.user.id));
    const detail = $("requestDetail");
    detail.hidden = false;
    detail.innerHTML = `<header class="request-list-heading"><div><p class="request-kicker">${esc(r.code)}</p><h3 tabindex="-1">${esc(r.customerName)}</h3></div><span class="request-status status-${esc(r.status)}">${esc(statusLabels[r.status])}</span></header>
 <dl class="request-facts"><div><dt>Contato</dt><dd>${esc(r.customerPhone)}${r.customerEmail ? "<br>" + esc(r.customerEmail) : ""}</dd></div><div><dt>Equipamento</dt><dd>${esc(r.device)}</dd></div><div><dt>Registrado por</dt><dd>${esc(r.createdBy?.name || "Equipe")} · ${esc(new Date(r.createdAt).toLocaleString("pt-BR"))}</dd></div></dl>
 <dl class="request-facts">${[
   ["Tipo", r.deviceType],
   ["Identificação", r.serialNumber],
   ["Acessórios", r.accessories],
   [
     "Prioridade",
     { normal: "Normal", high: "Alta", urgent: "Urgente" }[r.priority],
   ],
 ]
   .filter(([, v]) => v)
   .map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`)
   .join("")}</dl>
 ${r.physicalCondition ? `<div class="request-review"><strong>Estado físico na entrada</strong><p class="request-description">${esc(r.physicalCondition)}</p></div>` : ""}
 <div class="request-tags">${(r.problems || []).map((p) => `<span>${esc(p)}</span>`).join("")}</div><p class="request-description">${esc(r.description || "Relato registrado no checklist acima.")}</p><div class="request-photos">${photoMarkup(r.photos)}</div>
 ${canAttach ? '<label class="request-field">Adicionar fotos à solicitação<input class="form-input" id="requestMorePhotos" type="file" multiple accept="image/jpeg,image/png,image/webp"><small>Até 6 fotos no total. Disponível enquanto aguarda análise.</small></label>' : ""}
 ${r.reviewNotes ? `<div class="request-review"><strong>Análise técnica</strong><p class="request-description">${esc(r.reviewNotes)}</p><small>${esc(r.reviewedBy?.name || "Equipe técnica")}</small></div>` : ""}
 ${canReview() && !["converted", "rejected"].includes(r.status) ? `<form id="requestReviewForm"><label class="request-field">Parecer técnico<textarea class="form-input" id="requestReviewNotes" rows="3" maxlength="3000" placeholder="Diagnóstico, verificações e serviços recomendados">${esc(r.reviewNotes || "")}</textarea></label><div class="request-actions"><button type="button" class="btn btn-ghost" data-review="in_review">Iniciar análise</button><button type="button" class="btn btn-primary" data-review="approved">Aprovar solicitação</button><button type="button" class="btn btn-ghost" data-review="rejected">Recusar com parecer</button></div></form>` : ""}
 ${canReview() && !r.serviceOrderId && r.status !== "rejected" ? `<div class="request-review"><label class="request-field">Encaminhamento<select class="form-input" id="requestDestination">${destinationOptions(r.destination || "budget_only")}</select></label><p class="text-muted">A escolha não cria uma OS automaticamente. Para abrir a OS, primeiro registre a aprovação do orçamento.</p><button type="button" class="btn btn-ghost" id="requestSaveDestination">Salvar encaminhamento</button></div>` : `<p>Encaminhamento: ${esc(destinations[r.destination] || destinations.budget_only)}</p>`}
 ${r.serviceOrderId ? `<a class="btn btn-primary" href="/services/${encodeURIComponent(r.serviceOrderId)}">Abrir ordem de serviço →</a>` : r.budgetId && canReview() && r.destination === "service_after_approval" ? '<div class="request-review"><strong>Próximo passo: ordem de serviço</strong><p>Depois de registrar o orçamento como Aprovado, crie a OS. Cliente, equipamento, relato, checklist, fotos e parecer serão preservados.</p><button type="button" class="btn btn-primary" id="requestCreateService">Criar OS com os dados da solicitação</button></div>' : ""}
 ${r.status === "approved" && canReview() ? '<div class="request-review"><p>A criação gera um rascunho com os dados deste atendimento. Revise os itens e preços antes de enviar ao cliente.</p><button type="button" class="btn btn-primary" id="requestCreateBudget">Criar orçamento rascunho →</button></div>' : ""}
 ${r.budgetId ? `<p>Orçamento vinculado: ${true ? `<a href="/budgets?open=${encodeURIComponent(r.budgetId)}">Abrir orçamento →</a>` : "Criado pela equipe."}</p>` : ""}<p id="requestDetailStatus" role="status" aria-live="polite"></p>`;
  }
  function validateFiles(files, existing = 0) {
    if (files.length + existing > 6)
      throw new Error("Selecione no máximo seis fotos por solicitação.");
    for (const f of files)
      if (f.size > 8 * 1024 * 1024 || !/^image\/(jpeg|png|webp)$/.test(f.type))
        throw new Error("Use fotos JPG, PNG ou WebP de até 8 MB.");
  }
  async function uploadFiles(id, files, onProgress) {
    while (files.length) {
      const f = files[0],
        body = new FormData();
      body.append("image", f);
      body.append("caption", f.name.slice(0, 180));
      await api(`/api/budget-requests/${encodeURIComponent(id)}/photos`, body);
      files.shift();
      onProgress?.();
    }
  }
  async function action(task, status) {
    if (busy) return;
    busy = true;
    const buttons = [...document.querySelectorAll(".request-page button, #requestModalSubmit")];
    const inputs = [
      ...document.querySelectorAll(
        ".request-page input,.request-page textarea,.request-page select",
      ),
    ].map((el) => [el, el.disabled]);
    buttons.forEach((b) => (b.disabled = true));
    inputs.forEach(([el]) => (el.disabled = true));
    status.textContent = "Salvando…";
    try {
      await task();
      const liveStatus = $(status.id) || status;
      liveStatus.textContent = "Salvo.";
    } catch (e) {
      status.textContent =
        (savedRequest && status.id === "requestCreateStatus"
          ? "Solicitação salva. As fotos restantes não foram enviadas; clique em Enviar solicitação para tentar novamente. "
          : "") + e.message;
      showToast(e.message, "error");
    } finally {
      busy = false;
      buttons.forEach((b) => (b.disabled = false));
      inputs.forEach(
        ([el, disabled]) =>
          (el.disabled =
            disabled ||
            (!!savedRequest &&
              (el.type === "checkbox" || el.tagName === "SELECT") &&
              !!el.closest("#requestForm"))),
      );
    }
  }
  function watchDraft() {
    WorkDrafts.watch("request-intake", $("requestForm"), () => ({
      fields: WorkDrafts.fields($("requestForm")),
      id: requestId,
      saved: savedRequest,
      photos: pendingFiles,
    }));
  }
  function boot() {
    whenAppReady(async () => {
      const customerSearch = $('requestCustomerSearch');
      customerSearch.addEventListener('input', renderCustomerResults);
      customerSearch.addEventListener('focus', renderCustomerResults);
      customerSearch.addEventListener('keydown', event => {
        const list = $('requestCustomerResults');
        if (event.key === 'Escape' && !list.hidden) {
          event.preventDefault(); event.stopPropagation(); hideCustomerResults(); return;
        }
        if (event.key === 'Tab') return hideCustomerResults();
        if (['ArrowDown','ArrowUp'].includes(event.key)) {
          event.preventDefault();
          if (list.hidden) renderCustomerResults();
          else if (customerMatches.length) highlightCustomer((customerActiveIndex + (event.key === 'ArrowDown' ? 1 : -1) + customerMatches.length) % customerMatches.length);
          $('requestCustomerOption' + customerActiveIndex)?.scrollIntoView({block:'nearest'});
        }
        if (event.key === 'Enter') {
          event.preventDefault();
          if (!list.hidden && customerMatches[customerActiveIndex]) applyRequestCustomer(customerMatches[customerActiveIndex]);
        }
      });
      $('requestCustomerResults').addEventListener('mousedown', event => event.preventDefault());
      $('requestCustomerResults').addEventListener('click', event => {
        const option = event.target.closest('[data-customer-index]');
        if (option) applyRequestCustomer(customerMatches[Number(option.dataset.customerIndex)]);
      });
      $('requestCustomerResults').addEventListener('pointermove', event => {
        const option = event.target.closest('[data-customer-index]');
        if (option) highlightCustomer(Number(option.dataset.customerIndex));
      });
      document.addEventListener('click', event => {
        if (!$('requestCustomerAcWrap').contains(event.target)) hideCustomerResults();
      });
      $('requestCustomerManual').addEventListener('click', () => {
        applyRequestCustomer(null);
        $('requestForm').elements.customerName.focus();
      });
      $('requestForm').elements.customerName.addEventListener('input', () => {
        if (savedRequest) return;
        $('requestCustomerId').value = '';
        customerSearch.value = '';
        $('requestCustomerHint').textContent = 'Preenchimento manual. Confira os contatos antes de enviar.';
      });
      $("requestForm").addEventListener("submit", (e) => {
        e.preventDefault();
        const form = e.currentTarget,
          values = Object.fromEntries(new FormData(form));
        values.problems = [
          ...form.querySelectorAll('[name="problems"]:checked'),
        ].map((el) => el.value);
        values.id = requestId;
        void action(async () => {
          validateFiles(pendingFiles);
          const j = savedRequest
            ? { request: savedRequest }
            : await api("/api/budget-requests", values);
          savedRequest = j.request;
          await WorkDrafts.flush("request-intake");
          selected = j.request.id;
          form
            .querySelectorAll("input:not([type=file]),textarea,select")
            .forEach((el) => {
              el.readOnly = true;
              if (el.tagName === "SELECT") el.disabled = true;
              if (el.type === "checkbox") el.disabled = true;
            });
          await uploadFiles(selected, pendingFiles, () => {
            $("requestCreateStatus").textContent =
              `Enviando fotos… ${pendingFiles.length} restante(s)`;
            void WorkDrafts.flush("request-intake");
          });
          await WorkDrafts.clear("request-intake");
          form.reset();
          hideCustomerResults();
          savedRequest = null;
          form.querySelectorAll("input,textarea,select").forEach((el) => {
            el.readOnly = false;
            el.disabled = false;
          });
          previewUrls.forEach(URL.revokeObjectURL);
          previewUrls = [];
          $("requestPhotoPreview").innerHTML = "";
          requestId = crypto.randomUUID();
          watchDraft();
          await refresh();
          $("requestDetail").scrollIntoView({
            behavior: "smooth",
            block: "start",
          });
        }, $("requestCreateStatus"));
      });
      $("requestPhotos").addEventListener("change", (e) => {
        try {
          const files = [...e.target.files];
          validateFiles(files);
          pendingFiles = files;
          previewUrls.forEach(URL.revokeObjectURL);
          previewUrls = files.map((f) => URL.createObjectURL(f));
          $("requestPhotoPreview").innerHTML = previewUrls
            .map((url, i) => `<img src="${url}" alt="${esc(files[i].name)}">`)
            .join("");
        } catch (err) {
          e.target.value = "";
          pendingFiles = [];
          previewUrls.forEach(URL.revokeObjectURL);
          previewUrls = [];
          $("requestPhotoPreview").innerHTML = "";
          $("requestCreateStatus").textContent = err.message;
        }
      });
      $("requestSearch").addEventListener("input", renderList);
      $("requestFilter").addEventListener("change", renderList);
      $("requestRefresh").addEventListener("click", () =>
        action(refresh, $("requestListStatus")),
      );
      $("requestList").addEventListener("click", (e) => {
        const b = e.target.closest("[data-request]");
        if (!b) return;
        selected = b.dataset.request;
        renderList();
        renderDetail();
        $("requestDetail").scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
        $("requestDetail").querySelector("h3").focus({ preventScroll: true });
      });
      $("requestDetail").addEventListener("click", (e) => {
        const review = e.target.closest("[data-review]");
        if (review) {
          const body = {
            status: review.dataset.review,
            destination: $("requestDestination")?.value || "budget_only",
            reviewNotes: $("requestReviewNotes").value,
          };
          void action(async () => {
            await api(
              `/api/budget-requests/${encodeURIComponent(selected)}/review`,
              body,
              "PATCH",
            );
            await refresh();
          }, $("requestDetailStatus"));
        }
        if (e.target.closest("#requestSaveDestination")) {
          const destination = $("requestDestination").value;
          void action(async () => {
            await api(
              `/api/budget-requests/${encodeURIComponent(selected)}/destination`,
              { destination },
              "PATCH",
            );
            await refresh();
          }, $("requestDetailStatus"));
        }
        if (e.target.closest("#requestCreateService"))
          void action(async () => {
            const j = await api(
              `/api/budget-requests/${encodeURIComponent(selected)}/service`,
              {},
            );
            location.assign("/services/" + encodeURIComponent(j.serviceId));
          }, $("requestDetailStatus"));
        if (e.target.closest("#requestCreateBudget"))
          void action(async () => {
            const j = await api(
              `/api/budget-requests/${encodeURIComponent(selected)}/budget`,
              {},
            );
            location.assign("/budgets?open=" + encodeURIComponent(j.budgetId));
          }, $("requestDetailStatus"));
      });
      $("requestDetail").addEventListener("change", (e) => {
        if (e.target.id !== "requestMorePhotos") return;
        const files = [...e.target.files];
        void action(async () => {
          validateFiles(
            files,
            (rows.find((r) => r.id === selected)?.photos || []).length,
          );
          await uploadFiles(selected, files);
          await refresh();
        }, $("requestDetailStatus"));
      });
      const modal = $("serviceIntakeModal");
      const closeModal = () => {
        if (busy) return;
        hideCustomerResults();
        modal?.classList.remove("open");
        document.body.style.overflow = "";
        $("btnOpenServiceIntakeModal")?.focus();
        void WorkDrafts.flush("request-intake");
      };
      let opening = false;
      $("btnOpenServiceIntakeModal")?.addEventListener("click", async () => {
        if (opening) return;
        opening = true;
        const trigger = $('btnOpenServiceIntakeModal');
        trigger.disabled = true;
        try {
          if (!intakeReady) await initializeIntake();
          modal.classList.add('open');
          document.body.style.overflow = 'hidden';
          $('requestCustomerSearch').focus();
        } catch (error) { showToast(error.message, 'error'); }
        finally { opening = false; trigger.disabled = false; }
      });
      $("closeServiceIntakeModalBtn")?.addEventListener("click", closeModal);
      $("cancelServiceIntakeBtn")?.addEventListener("click", closeModal);
      modal?.addEventListener("keydown", (e) => {
        if (e.key === "Escape") closeModal();
        if (e.key !== "Tab") return;
        const focusable = [
          ...modal.querySelectorAll(
            "button:not(:disabled),a[href],input:not(:disabled),textarea:not(:disabled),select:not(:disabled)",
          ),
        ].filter((el) => el.getClientRects().length);
        const first = focusable[0],
          last = focusable.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      });
      async function initializeIntake() {
        await loadIntakeOptions();
        await refresh();
        $("requestForm")
          .querySelectorAll("input,textarea,select")
          .forEach((el, i) => {
            // Preserve draft field IDs from the previous form, which included a select.
            if (!el.id) el.id = "requestField" + (i + 1);
          });
        const draft = await WorkDrafts.restore("request-intake");
        if (draft) {
          WorkDrafts.fill(draft.fields);
          requestId = draft.id || requestId;
          savedRequest = draft.saved || null;
          pendingFiles = draft.photos || [];
          previewUrls = pendingFiles.map((f) => URL.createObjectURL(f));
          $("requestPhotoPreview").innerHTML = previewUrls
            .map(
              (url, i) =>
                `<img src="${url}" alt="${esc(pendingFiles[i].name)}">`,
            )
            .join("");
          $("requestCreateStatus").textContent = savedRequest
            ? "Solicitação salva. Envie novamente para concluir as fotos pendentes."
            : "Rascunho recuperado, incluindo fotos selecionadas.";
        }
        hideCustomerResults();
        if (savedRequest) $('requestForm').querySelectorAll('input:not([type=file]),textarea,select').forEach(el => {
          el.readOnly = true;
          if (el.tagName === 'SELECT' || el.type === 'checkbox') el.disabled = true;
        });
        watchDraft();
        intakeReady = true;
        const id = new URLSearchParams(location.search).get("open");
        if (id && !modal) {
          if (!rows.some((r) => r.id === id)) {
            const j = await api(
              "/api/budget-requests/" + encodeURIComponent(id),
            );
            rows.push(j.request);
          }
          selected = id;
          renderDetail();
          $("requestDetail").scrollIntoView();
        }
      }
      if (!modal) {
        try { await initializeIntake(); }
        catch (e) { $('requestListStatus').textContent = e.message; }
      }
    });
  }
  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
