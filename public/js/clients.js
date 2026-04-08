function initClients() {

    updateTopbarTitle('Clientes');
    markNavActive('/clients');
    renderClients();

}

function renderClients() {
    const { clients } = window.appData;

    const search = document.getElementById('clientSearch')?.value?.toLowerCase() || '';
    let list = [...clients];

    if (search) {
        list = list.filter(c =>
            c.name.toLowerCase().includes(search) ||
            c.email.toLowerCase().includes(search) ||
            c.doc.includes(search)
        );
    }

    const table = document.getElementById('clientsTable');
    if (!table) return;

    table.innerHTML = list.map(c => `
    <tr>
      <td class="mono" style="color:var(--text3)">#${String(c.id).padStart(4, '0')}</td>
      <td style="font-weight:700">
        <div style="display:flex;align-items:center;gap:8px;">
          <div style="width:28px;height:28px;border-radius:50%;background:linear-gradient(135deg,var(--gold2),var(--purple));display:flex;align-items:center;justify-content:center;font-size:0.7rem;font-weight:700;color:#fff;flex-shrink:0">
            ${c.name.charAt(0)}
          </div>
          ${c.name}
        </div>
      </td>
      <td class="mono" style="color:var(--text2)">${c.doc}</td>
      <td>${c.phone}</td>
      <td style="color:var(--text2)">${c.email}</td>
      <td class="mono">${c.purchases}</td>
      <td class="mono" style="font-weight:700;color:var(--gold)">${formatCurrency(c.spent)}</td>
      <td>
        <button class="btn btn-ghost btn-sm">📊 Histórico</button>
      </td>
    </tr>
  `).join('');
}

function filterClients() {
    renderClients();
}

function addClient() {
    const { clients } = window.appData;

    const name = document.getElementById('newClientName').value.trim();
    const doc = document.getElementById('newClientDoc').value.trim();
    const phone = document.getElementById('newClientPhone').value.trim();
    const email = document.getElementById('newClientEmail').value.trim();

    if (!name) {
        showToast('Nome é obrigatório!', 'error');
        return;
    }

    const id = Math.max(...clients.map(c => c.id), 0) + 1;
    clients.push({ id, name, doc, phone, email, purchases: 0, spent: 0 });

    closeModal('addClient');
    ['newClientName', 'newClientDoc', 'newClientPhone', 'newClientEmail', 'newClientAddr'].forEach(f => {
        const el = document.getElementById(f);
        if (el) el.value = '';
    });

    renderClients();
    showToast(`Cliente "${name}" cadastrado!`, 'success');
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        if (typeof initClients === 'function') initClients();
    });
} else {
    if (typeof initClients === 'function') initClients();
}
