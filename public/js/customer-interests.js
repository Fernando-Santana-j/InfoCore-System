(() => {
  'use strict';
  const $=id=>document.getElementById(id);
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const text=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  const labels={waiting:'Aguardando produto',contacted:'Cliente avisado',done:'Atendido',cancelled:'Cancelado'};
  let editing=null,busy=false;
  const clients=()=>window.appData?.customers || [];
  function whatsapp(customer,interest) {
    let phone=String(customer.phone||'').replace(/\D/g,'');
    if(phone.length===10 || phone.length===11) phone='55'+phone;
    if(!/^\d{12,15}$/.test(phone)) return '';
    const message=`Olá, ${customer.name}! Você comentou que procura ${interest.title}. Podemos conversar sobre as opções?`;
    return `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
  }
  function render() {
    if(!$('interestList')) return;
    const query=text($('interestSearch').value.trim()),filter=$('interestFilter').value;
    const rows=clients().flatMap(customer=>(customer.interests||[]).map(interest=>({customer,interest}))).filter(({customer:c,interest:i})=>
      (filter==='all'||(filter==='active'?['waiting','contacted'].includes(i.status):i.status===filter)) && (!query||text([c.name,c.phone,i.title,i.notes].join(' ')).includes(query))
    ).sort((a,b)=>String(b.interest.createdAt).localeCompare(String(a.interest.createdAt)));
    $('interestCount').textContent=`${rows.length} interesse(s) nesta seleção`;
    $('interestList').innerHTML=rows.length?rows.map(({customer:c,interest:i})=>{
      const wa=whatsapp(c,i);
      return `<article class="interest-card"><div class="interest-heading"><strong>${esc(i.title)}</strong><span class="interest-badge">${esc(labels[i.status]||i.status)}</span></div><button type="button" class="interest-client" data-client="${esc(c.id)}">${esc(c.name)}</button><small>${esc(c.phone||'Sem telefone cadastrado')} · ${esc(new Date(i.createdAt).toLocaleDateString('pt-BR'))}</small>${i.notes?`<p>${esc(i.notes)}</p>`:''}${i.maxBudget!=null?`<p class="interest-budget">Até ${esc(Number(i.maxBudget).toLocaleString('pt-BR',{style:'currency',currency:'BRL'}))}</p>`:''}<div class="interest-actions">${wa?`<a class="btn btn-ghost btn-sm" target="_blank" rel="noopener noreferrer" href="${esc(wa)}">Abrir WhatsApp ↗</a>`:'<small>Cadastre o telefone para abrir o WhatsApp.</small>'}<button type="button" class="btn btn-ghost btn-sm" data-interest="${esc(i.id)}" data-owner="${esc(c.id)}">Editar / atualizar etapa</button></div></article>`;
    }).join(''):'<div class="interest-empty"><strong>Nenhum interesse nesta seleção.</strong><p>Selecione um cliente abaixo e clique em <b>Registrar interesse</b>. Exemplo: notebook usado até R$ 2.000.</p></div>';
  }
  function open(clientId,interestId) {
    const customer=clients().find(c=>c.id===clientId);if(!customer)return;
    const row=(customer.interests||[]).find(i=>i.id===interestId);
    editing={clientId,id:row?.id||crypto.randomUUID(),existing:!!row};
    $('interestForm').reset();
    for(const field of ['title','notes','maxBudget','status']) $('interestForm').elements[field].value=row?.[field]??(field==='status'?'waiting':'');
    $('interestCustomerLabel').textContent=customer.name;
    $('interestDialogTitle').textContent=row?'Editar interesse':'Registrar interesse';
    $('interestSaveStatus').textContent='';
    $('interestDialog').showModal();
    $('interestForm').elements.title.focus();
  }
  function boot() { whenAppReady(()=>{
    render();
    $('interestSearch').addEventListener('input',render);
    $('interestFilter').addEventListener('change',render);
    $('interestList').addEventListener('click',event=>{
      const edit=event.target.closest('[data-interest]'),client=event.target.closest('[data-client]');
      if(edit) open(edit.dataset.owner,edit.dataset.interest);
      if(client){selectClient(client.dataset.client);$('clientDetailMount').scrollIntoView({behavior:'smooth',block:'start'});}
    });
    const close=()=>{if(!busy)$('interestDialog').close();};
    $('interestClose').onclick=close;$('interestCancel').onclick=close;
    $('interestDialog').addEventListener('cancel',event=>{if(busy)event.preventDefault();});
    $('interestRefresh').onclick=async()=>{
      const button=$('interestRefresh');button.disabled=true;
      try{const result=await apiJson('/api/customers?refresh=1');window.appData.customers=result.customers;render();renderClientList($('clientSearch').value);if(selectedId)selectClient(selectedId);}
      catch{}finally{button.disabled=false;}
    };
    $('interestForm').addEventListener('submit',async event=>{
      event.preventDefault();if(busy||!editing)return;
      const form=$('interestForm'),body={...Object.fromEntries(new FormData(form)),id:editing.id};
      busy=true;const controls=[...form.querySelectorAll('input,textarea,select,button')];controls.forEach(el=>el.disabled=true);
      $('interestSaveStatus').textContent='Salvando…';
      try{
        const url=`/api/customers/${encodeURIComponent(editing.clientId)}/interests`+(editing.existing?'/'+encodeURIComponent(editing.id):'');
        const result=await apiJson(url,{method:editing.existing?'PATCH':'POST',body:JSON.stringify(body)});
        const customer=clients().find(c=>c.id===editing.clientId);if(customer)customer.interests=result.interests;
        render();renderClientList($('clientSearch').value);if(selectedId===editing.clientId)selectClient(selectedId);
        $('interestDialog').close();showToast('Interesse salvo.','success');
      }catch(error){$('interestSaveStatus').textContent='Não foi possível confirmar o salvamento. Seus dados foram mantidos; tente novamente.';}
      finally{busy=false;controls.forEach(el=>el.disabled=false);}
    });
  });}
  window.CustomerInterests={open,render};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
})();
