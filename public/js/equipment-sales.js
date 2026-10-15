(() => {
  'use strict';
  const $=id=>document.getElementById(id);
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let options,contracts=[],current=null,dirty=false,busy=false;
  const groups=[['equipment','01 · Equipamento'],['customer','02 · Comprador'],['seller','03 · Loja e representante'],['commercial','04 · Venda e pagamento'],['delivery','05 · Entrega e conferência'],['warranty','06 · Garantia obrigatória']];
  const dateToday=()=>new Date().toLocaleDateString('en-CA',{timeZone:'America/Maceio'});
  const uuid=()=>globalThis.crypto?.randomUUID?.()||'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,c=>{const r=Math.floor(Math.random()*16);return(c==='x'?r:(r&3)|8).toString(16);});
  async function api(url,method='GET',body){const r=await fetch(url,{method,credentials:'same-origin',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});const d=await r.json();if(!r.ok||d.error)throw new Error(d.message||'Não foi possível carregar os dados.');return d;}
  function message(text,error=false){$('equipmentMessage').textContent=text;$('equipmentMessage').classList.toggle('error',error);}
  async function run(fn){if(busy)return;busy=true;sync();try{await fn();}catch(e){message(e.message,true);showToast(e.message,'error');}finally{busy=false;sync();}}
  function confirmAction(title,text){return new Promise(resolve=>{const dialog=$('equipmentConfirm');$('equipmentConfirmTitle').textContent=title;$('equipmentConfirmText').textContent=text;const finish=v=>{dialog.close();resolve(v);};$('equipmentConfirmCancel').onclick=()=>finish(false);$('equipmentConfirmOk').onclick=()=>finish(true);dialog.oncancel=e=>{e.preventDefault();finish(false);};dialog.showModal();});}
  async function mayLeave(){return !dirty||await confirmAction('Descartar alterações?','Há alterações não salvas neste rascunho. Deseja descartá-las e continuar?');}
  function fieldHtml(f){const id='equipment-'+f.name,attrs=`id="${id}" name="${f.name}" class="form-input" ${f.required?'required':''} maxlength="${f.maxLength}"`;
    const input=f.type==='textarea'?`<textarea ${attrs} rows="2"></textarea>`:f.type==='select'?`<select ${attrs}>${f.options.map(([v,l])=>`<option value="${v}">${esc(l)}</option>`).join('')}</select>`:`<input ${attrs} type="${f.type}" ${f.type==='number'?'min="0" max="999999999" step="0.01"':''}>`;
    return `<label class="${f.type==='textarea'?'equipment-field-wide':''}" for="${id}">${esc(f.label)}${f.required?' *':''}${input}</label>`;
  }
  function renderForm(){
    $('equipmentSections').innerHTML=groups.map(([key,title])=>`<details class="equipment-section" ${['equipment','customer','commercial','delivery','warranty'].includes(key)?'open':''}><summary>${title}</summary>${key==='warranty'?'<p class="equipment-hint">A folha de garantia acompanha sempre a via do cliente, com os dados já preenchidos no contrato.</p><div id="equipmentWarrantySummary" class="equipment-warranty-summary" aria-live="polite"></div><details class="equipment-extra-warranty"><summary>Garantias adicionais, se houver</summary>':''}${key==='delivery'?'<div class="equipment-reuse"><label><input type="checkbox" id="equipmentSameDate"> Entrega na data do contrato</label><label><input type="checkbox" id="equipmentSamePlace"> Entrega no endereço da loja</label></div>':''}<div class="equipment-fields-grid">${options.fields.filter(f=>f.group===key).map(fieldHtml).join('')}</div>${key==='warranty'?'</details>':''}${key==='delivery'?`<div class="equipment-checks">${options.checks.map((name,i)=>`<label>${esc(name)}<select class="form-input" name="check${i}" aria-label="Conferência: ${esc(name)}"><option value="pending">Não conferido</option><option value="ok">Conferido</option><option value="exception">Com ressalva</option><option value="na">Não aplicável</option></select></label>`).join('')}</div>`:''}</details>`).join('');
    $('equipmentCustomer').innerHTML='<option value="">Selecionar cliente (opcional)</option>'+options.customers.map(c=>`<option value="${esc(c.id)}">${esc(c.name)} · ${esc(c.doc||c.phone)}</option>`).join('');
    $('equipmentSale').innerHTML='<option value="">Sem vínculo / registro manual</option>'+options.sales.map(s=>`<option value="${esc(s.id)}">${esc(s.code)} · ${esc(typeof s.client==='string'?s.client:s.client?.name)} · ${formatCurrency(s.total)}</option>`).join('');
  }
  function syncReuse(){
    const form=$('equipmentForm');
    for(const [toggle,target,source] of [['equipmentSameDate','deliveryDate','saleDate'],['equipmentSamePlace','deliveryPlace','sellerAddress']]){
      const same=$(toggle).checked;
      if(same)form.elements[target].value=form.elements[source].value;
      form.elements[target].closest('label').hidden=same;
    }
    const value=key=>form.elements[key].value||'A preencher no contrato';
    $('equipmentWarrantySummary').innerHTML=`<strong>Garantia legal · 90 dias</strong><dl><dt>Comprador</dt><dd>${esc(value('customerName'))}</dd><dt>Equipamento</dt><dd>${esc(value('model'))}</dd><dt>Identificação</dt><dd>${esc(value('serial'))}</dd><dt>Entrega</dt><dd>${esc(value('deliveryDate').split('-').reverse().join('/'))}</dd><dt>Atendimento</dt><dd>${esc(value('sellerName'))} · ${esc(value('sellerPhone'))}<br>${esc(value('sellerAddress'))}</dd></dl><small>Preenchimento automático. Assinaturas do comprador, da loja e da testemunha somente no papel.</small>`;
  }
  function fill(c){current=c;const form=$('equipmentForm');options.fields.forEach(f=>{form.elements[f.name].value=c[f.name]??'';});options.checks.forEach((_,i)=>{form.elements['check'+i].value=c.checks?.[i]||'pending';});
    if(c.saleId&&!options.sales.some(s=>s.id===c.saleId))$('equipmentSale').add(new Option(c.saleSnapshot?.code||c.saleId,c.saleId));
    $('equipmentSale').value=c.saleId||'';$('equipmentCustomer').value='';$('equipmentSaleHint').textContent=c.saleSnapshot?`Venda vinculada: ${c.saleSnapshot.code}. O vínculo não gera nova movimentação financeira.`:'A vinculação não movimenta caixa ou estoque novamente.';$('equipmentSameDate').checked=c.deliveryDate===c.saleDate;$('equipmentSamePlace').checked=c.deliveryPlace===c.sellerAddress;dirty=false;if(!$('equipmentEditor').open)$('equipmentEditor').showModal();message(c.status==='issued'?'Contrato emitido. Abra o PDF, imprima e colha as assinaturas no papel.':'Preencha os dados e salve. Os campos com * são necessários para emitir.');sync();renderList();}
  function fresh(){fill({...options.defaults,id:uuid(),revision:0,status:'draft',condition:'used',channel:'store',saleDate:dateToday(),deliveryDate:dateToday(),deliveryPlace:options.defaults.sellerAddress,deviceType:'Notebook',checks:options.checks.map(()=>'pending')});}
  function payload(){const form=$('equipmentForm');return{...Object.fromEntries(options.fields.map(f=>[f.name,form.elements[f.name].value])),checks:options.checks.map((_,i)=>form.elements['check'+i].value),saleId:$('equipmentSale').value,revision:current.revision};}
  function sync(){if(!current)return;syncReuse();const issued=current.status==='issued';$('equipmentCode').textContent=current.code||'NOVO CONTRATO';$('equipmentTitle').textContent=$('equipmentForm').elements.condition.value==='new'?'Equipamento novo':'Equipamento usado';$('equipmentStatus').textContent=issued?'Emitido':dirty?'Alterações não salvas':'Rascunho';$('equipmentStatus').classList.toggle('issued',issued);$('equipmentFields').disabled=issued||busy;
    for(const id of ['equipmentSave','equipmentPreview','equipmentIssue']){$(id).hidden=issued;$(id).disabled=busy;}
    $('equipmentNew').disabled=busy;$('equipmentRefresh').disabled=busy;$('equipmentClose').disabled=busy;
    for(const id of ['equipmentPdf','equipmentDownload']){$(id).hidden=!issued;$(id).href=`/api/equipment-contracts/${encodeURIComponent(current.id)}/pdf${id==='equipmentDownload'?'?download=1':''}`;}
  }
  function renderList(){const q=$('equipmentSearch').value.toLowerCase();const list=contracts.filter(c=>`${c.code} ${c.customerName} ${c.model} ${c.serial}`.toLowerCase().includes(q));$('equipmentList').innerHTML=list.length?list.map(c=>`<button type="button" class="equipment-contract-card ${current?.id===c.id?'active':''}" data-id="${esc(c.id)}"><small>${esc(c.code)} · ${c.status==='issued'?'Emitido':'Rascunho'} · ${c.condition==='new'?'Novo':'Usado'}</small><strong>${esc(c.customerName||'Cliente não preenchido')}</strong><small>${esc(c.model||'Equipamento não preenchido')} · ${formatCurrency(Number(c.price)||0)}</small></button>`).join(''):'<p class="equipment-empty">Nenhum contrato encontrado. Comece um novo contrato para preparar a venda.</p>';}
  async function refresh(){contracts=(await api('/api/equipment-contracts')).contracts;renderList();}
  async function save(){const d=await api(`/api/equipment-contracts/${current.id}`,'PUT',payload());current=d.contract;dirty=false;contracts=[current,...contracts.filter(c=>c.id!==current.id)];renderList();message('Rascunho salvo. Confira os dados antes de emitir.');sync();return current;}
  function requiredValid(){const form=$('equipmentForm');const invalid=[...form.elements].find(e=>e.willValidate&&!e.checkValidity());if(invalid){invalid.closest('details')?.setAttribute('open','');invalid.focus();invalid.reportValidity();return false;}return true;}
  function importCustomer(c){if(!c)return;for(const [key,value] of Object.entries({customerName:c.name,customerDoc:c.doc,customerPhone:c.phone,customerEmail:c.email,customerAddress:c.address}))$('equipmentForm').elements[key].value=value||'';}
  async function init(){
    options=await api('/api/equipment-contracts/options');renderForm();await refresh();
    $('equipmentForm').onsubmit=e=>e.preventDefault();
    $('equipmentForm').addEventListener('input',()=>{dirty=true;sync();});$('equipmentForm').addEventListener('change',()=>{dirty=true;sync();});
    $('equipmentCustomer').onchange=()=>{importCustomer(options.customers.find(c=>c.id===$('equipmentCustomer').value));dirty=true;sync();};
    $('equipmentSale').onchange=()=>{const s=options.sales.find(s=>s.id===$('equipmentSale').value);if(s){importCustomer(options.customers.find(c=>c.id===s.customerId));const f=$('equipmentForm').elements;if(!f.customerName.value)f.customerName.value=typeof s.client==='string'?s.client:s.client?.name||'';if(!f.model.value)f.model.value=s.items.map(i=>i.name).join(' / ').slice(0,240);if(f.price.value==='')f.price.value=s.total;$('equipmentSaleHint').textContent=`Venda ${s.code}: ${formatCurrency(s.total)}. Confira o valor e a identificação do equipamento; a venda pode conter outros itens.`;}else $('equipmentSaleHint').textContent='A vinculação não movimenta caixa ou estoque novamente.';dirty=true;sync();};
    $('equipmentSave').onclick=()=>run(save);
    $('equipmentPreview').onclick=()=>{if(busy)return;const win=window.open('about:blank','_blank');if(win)win.opener=null;run(async()=>{try{await save();const url=`/api/equipment-contracts/${current.id}/pdf`;if(win)win.location.href=url;else message('Rascunho salvo. Permita a abertura de uma nova aba e clique em Prévia PDF novamente.');}catch(e){win?.close();throw e;}});};
    $('equipmentIssue').onclick=async()=>{if(busy||!requiredValid())return;if(!await confirmAction('Emitir contrato para assinatura?','Confira comprador, equipamento, valores e resultados da entrega. A versão emitida não poderá ser alterada. As três assinaturas (comprador, loja e testemunha) serão obrigatoriamente feitas no papel, nas duas vias. A garantia será incluída automaticamente na via do cliente.'))return;run(async()=>{await save();const d=await api(`/api/equipment-contracts/${current.id}/issue`,'POST',{revision:current.revision});fill(d.contract);contracts=[d.contract,...contracts.filter(c=>c.id!==d.contract.id)];renderList();});};
    $('equipmentNew').onclick=async()=>{if(!busy&&await mayLeave())fresh();};
    $('equipmentClose').onclick=async()=>{if(!busy&&await mayLeave()){dirty=false;$('equipmentEditor').close();}};
    $('equipmentEditor').oncancel=e=>{e.preventDefault();$('equipmentClose').click();};
    $('equipmentRefresh').onclick=()=>run(refresh);$('equipmentSearch').oninput=renderList;
    $('equipmentList').onclick=async e=>{const button=e.target.closest('[data-id]');if(!button||busy||!await mayLeave())return;run(async()=>fill((await api(`/api/equipment-contracts/${encodeURIComponent(button.dataset.id)}`)).contract));};
    window.addEventListener('beforeunload',e=>{if(dirty){e.preventDefault();e.returnValue='';}});
    markNavActive('/equipment-sales');updateTopbarTitle('Venda de equipamentos');
  }
  whenAppReady(()=>init().catch(e=>{message(e.message+' Recarregue a página para tentar novamente.',true);$('equipmentForm').hidden=true;$('equipmentNew').disabled=true;}));
})();
