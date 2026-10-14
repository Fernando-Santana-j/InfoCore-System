/* Local recovery is isolated by operator; IndexedDB also preserves selected photos. */
window.WorkDrafts = (() => {
  const open = () =>
    new Promise((resolve, reject) => {
      const request = indexedDB.open("infocore-work-drafts", 1);
      request.onupgradeneeded = () =>
        request.result.createObjectStore("drafts");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  const key = (name) =>
    `${window.appData?.user?.email || window.appData?.user?.id || window.appData?.user?.name}:${name}`;
  async function execute(mode, fn) {
    const db = await open();
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction("drafts", mode);
        const request = fn(tx.objectStore("drafts"));
        tx.oncomplete = () => resolve(request.result);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
  }
  function status(root, text) {
    let el = root.querySelector("[data-draft-status]");
    if (!el) {
      el = document.createElement("p");
      el.dataset.draftStatus = "";
      el.setAttribute("role", "status");
      el.className = "text-sm text-muted";
      (
        root.querySelector(".pdv-modal-header, .svc-create-head, header") ||
        root.firstElementChild
      )?.prepend(el);
    }
    el.textContent = text;
  }
  const controllers = new Map();
  return {
    async flush(name) {
      const c = controllers.get(name);
      if (c?.save) {
        clearTimeout(c.timer);
        await c.save();
      }
    },
    async restore(name) {
      return execute("readonly", (s) => s.get(key(name)));
    },
    async clear(name) {
      const c = controllers.get(name);
      if (c) {
        c.stopped = true;
        clearTimeout(c.timer);
        await c.pending;
      }
      return execute("readwrite", (s) => s.delete(key(name)));
    },
    watch(name, root, capture) {
      const old = controllers.get(name);
      if (old) {
        old.stopped = true;
        clearTimeout(old.timer);
      }
      const c = { stopped: false, pending: Promise.resolve() };
      controllers.set(name, c);
      async function save() {
        if (c.stopped) return;
        if (
          root.classList.contains("open") ||
          root.id === "requestForm" ||
          (root.id === "svcCreateModal" && !root.hidden)
        ) {
          const value = capture();
          const signature = JSON.stringify(value, (_key, v) =>
            v instanceof File
              ? { name: v.name, size: v.size, lastModified: v.lastModified }
              : v,
          );
          if (signature === c.signature) {
            if (!c.stopped) c.timer = setTimeout(save, 1500);
            return;
          }
          status(root, "Salvando rascunho neste navegador…");
          try {
            c.pending = execute("readwrite", (s) => s.put(value, key(name)));
            await c.pending;
            c.signature = signature;
            status(root, "Rascunho salvo neste navegador");
          } catch {
            status(
              root,
              "Falhou ao salvar o rascunho. Mantenha esta janela aberta.",
            );
          }
        }
        if (!c.stopped) c.timer = setTimeout(save, 1500);
      }
      c.save = save;
      c.timer = setTimeout(save, 1500);
    },
    fields(root) {
      return Object.fromEntries(
        [...root.querySelectorAll("input[id],textarea[id],select[id]")]
          .filter((e) => e.type !== "file")
          .map((e) => [e.id, e.type === "checkbox" ? e.checked : e.value]),
      );
    },
    fill(values) {
      Object.entries(values || {}).forEach(([id, value]) => {
        const e = document.getElementById(id);
        if (e && e.type !== "file") {
          if (e.type === "checkbox") e.checked = value;
          else e.value = value;
        }
      });
    },
  };
})();
