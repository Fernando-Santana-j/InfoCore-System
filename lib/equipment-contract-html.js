'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {CHECKS,clauses}=require('./equipment-contract-domain');
const assets=path.join(__dirname,'../templates/equipment-contracts');
const css=fs.readFileSync(path.join(assets,'original.css'),'utf8');
const logo=`data:image/png;base64,${fs.readFileSync(path.join(assets,'logo.png')).toString('base64')}`;
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const date=v=>v?String(v).split('-').reverse().join('/'):'Não informado';
const money=v=>Number(v||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
function renderHtml(c){
  const condition=c.condition==='new'?'novo':'usado';
  const value=v=>esc(v||'Não informado');
  const field=(label,v,width=12,size='')=>`<div class="field w${width}"><span class="label">${esc(label)}</span><div class="line ${size}">${value(v)}</div></div>`;
  const row=(...fields)=>`<div class="flow-block fields field-row">${fields.join('')}</div>`;
  const section=label=>`<div class="flow-block section-title section-start" data-keep-next><span>${esc(label)}</span></div>`;
  const heading=(kicker,title)=>`<div class="flow-block plain-head" data-keep-next><div><div class="kicker">${esc(kicker)}</div><h2>${esc(title)}</h2></div><div class="micro">Contrato nº ${esc(c.code)}</div></div>`;
  const signatures=(warranty=false)=>`<div class="flow-block ${warranty?'warranty-signoff':'signoff'}"><div class="signatures"><div class="sig">Assinatura do comprador</div><div class="sig">Assinatura da loja</div></div><div class="signature-lower"><div class="sig">Assinatura da testemunha</div><div class="date-sign"><b>${esc(date(c.deliveryDate))}</b><span>Data da entrega</span></div></div><div class="micro signature-note">As três assinaturas são obrigatórias e devem ser feitas à mão.</div></div>`;
  const cover=()=>[
    `<div class="flow-block"><div class="brand-head"><img src="${logo}" alt="InfoCore"><div class="brand-meta"><strong>${value(c.sellerName)}</strong><br>CNPJ ${value(c.sellerDoc)}<br>${value(c.sellerPhone)}<br>${value(c.sellerAddress)}</div></div><div class="accent"></div><div class="eyebrow">Venda de equipamento ${condition}</div><h1>Contrato de venda, entrega e garantia</h1><p class="subtitle">Documento de identificação do equipamento, condições da venda, entrega e garantia legal aplicável.</p><div class="contract-id"><span>Contrato nº</span><b>${esc(c.code)}</b></div></div>`,
    section('Cliente'),
    row(field('Nome completo / razão social',c.customerName,8),field('CPF / CNPJ',c.customerDoc,4)),
    row(field('Endereço',c.customerAddress,8),field('Telefone / WhatsApp',c.customerPhone,4)),
    section('Equipamento'),
    row(field('Tipo do equipamento',c.deviceType,4),field('Marca / modelo',c.model,8)),
    row(field('Configuração',c.configuration,12,'tall')),
    row(field('Estado / condição e marcas de uso informadas',c.physicalCondition,12,'xl')),
    section('Venda'),
    row(field('Valor deste equipamento',money(c.price),4),field('Forma de pagamento',c.paymentTerms,4),field('Data',date(c.saleDate),4)),
    row(field('Observações comerciais',c.commercialNotes||'Condições complementares nas próximas páginas.',12,'tall')),
    `<div class="flow-block info-band"><div><div class="big">90 dias de garantia legal</div><div class="small">Condições completas nas cláusulas e na folha de garantia.</div></div><div class="small" style="max-width:72mm;text-align:right">Venda identificada pelo número deste contrato. Guarde a via de garantia junto ao equipamento.</div></div>`
  ].join('');
  const extra=()=>[
    heading('Identificação e condições complementares','Detalhes do equipamento e da venda'),
    row(field('Número de série / identificação física',c.serial)),
    row(field('Bateria: condição e autonomia informadas',c.battery,12,'tall')),
    row(field('Acessórios e itens incluídos',c.accessories,12,'tall')),
    row(field('Sistema operacional, licenças e serviços',c.software,12,'tall')),
    section('Pagamento e documentação'),
    row(field('Valores recebidos, saldo e comprovantes',c.paymentRecord,12,'tall')),
    row(field('Forma de contratação',c.channel==='remote'?'Fora da loja / internet / telefone':'Presencial na loja',6),field('Documento fiscal / referência',c.invoice||'Não informado',6)),
    c.saleSnapshot?row(field('Venda vinculada no PDV',`${c.saleSnapshot.code} · Total da venda: ${money(c.saleSnapshot.total)}. O preço deste equipamento consta na primeira página.`)): '',
    section('Contatos e representação'),
    row(field('E-mail do comprador',c.customerEmail||'Não informado',6),field('Representante do comprador',c.customerRepresentative||'O próprio comprador',6)),
    row(field('Representante da loja',c.sellerRepresentative)),
    c.warrantyExtra?row(field('Garantia contratual adicional da loja',c.warrantyExtra,12,'tall')):'',
    c.manufacturerWarranty?row(field('Garantia do fabricante',c.manufacturerWarranty,12,'tall')):''
  ].join('');
  const terms=()=>heading('Condições contratuais','Cláusulas da venda')+(c.clauses||clauses(c)).map(([title,text],i)=>`<div class="flow-block clause"><h3><span class="clause-number">${String(i+1).padStart(2,'0')}. </span>${esc(title)}</h3><p>${esc(text)}</p></div>`).join('');
  const delivery=()=>[
    `<div class="flow-block"><div class="doc-tag">Termo de entrega</div><h2 class="delivery-title">Entrega e aceite do equipamento</h2><p class="delivery-intro">Registro da entrega física, conferência do equipamento e aceite da venda.</p></div>`,
    row(field('Contrato nº',c.code,6),field('Equipamento / modelo',c.model,6)),
    row(field('Número de série / identificação',c.serial)),
    section('Conferência no recebimento'),
    `<div class="flow-block checks">${CHECKS.map((label,i)=>{const state=c.checks?.[i]||'pending';return `<div class="check"><span class="box">${{ok:'✓',exception:'!',na:'—',pending:''}[state]}</span><span>${esc(label)}<small>${{ok:'Conferido',exception:'Com ressalva',na:'Não aplicável',pending:'Não conferido'}[state]}</small></span></div>`;}).join('')}</div>`,
    section('Itens e observações da entrega'),
    row(field('Local e data da entrega',`${date(c.deliveryDate)} · ${c.deliveryPlace}`)),
    row(field('Itens entregues',c.accessories,12,'tall')),
    row(field('Ressalvas e observações',c.deliveryNotes||'Sem ressalvas registradas.',12,'tall')),
    `<div class="flow-block declaration"><strong>Declaração de entrega e aceite.</strong> Ao assinar, o comprador confirma o recebimento do equipamento identificado e a ciência de seu estado, das condições comerciais, das cláusulas e da garantia. A assinatura não representa renúncia a direitos legais nem, isoladamente, quitação do pagamento.</div>`,
    signatures()
  ].join('');
  const warranty=()=>[
    `<div class="flow-block warranty-hero"><div><div class="doc-tag">Via do cliente</div><h2>Folha de garantia</h2><p>Guarde esta página. Ela identifica o equipamento e as condições de atendimento vinculadas ao contrato.</p></div><img src="${logo}" alt="InfoCore"></div>`,
    `<div class="flow-block warranty-id"></div>`,
    row(field('Contrato nº',c.code,6),field('Tipo do equipamento',c.deviceType,6)),
    row(field('Marca / modelo',c.model,6),field('Número de série / identificação física',c.serial,6)),
    row(field('Configuração resumida',c.configuration,12,'tall')),
    row(field('Comprador',c.customerName,8),field('Data da entrega',date(c.deliveryDate),4)),
    `<div class="flow-block warranty-rule"><h3>Garantia: 90 dias</h3><p>A cobertura segue o contrato e a legislação aplicável. Para vícios aparentes ou de fácil constatação, o prazo começa na entrega; para vícios ocultos, quando o defeito se evidencia, conforme o CDC. A falta desta folha, isoladamente, não extingue seus direitos.</p><ul class="warranty-bullets"><li>Cobre os vícios abrangidos pela garantia legal.</li><li>Danos posteriores por mau uso, quedas ou líquidos dependem de relação com a falha para exclusão.</li><li>Abertura ou rompimento de lacre não anulam automaticamente a garantia.</li><li>O atendimento poderá exigir diagnóstico técnico.</li></ul></div>`,
    c.warrantyExtra?row(field('Garantia adicional da loja',c.warrantyExtra,12,'tall')):'',
    c.manufacturerWarranty?row(field('Garantia do fabricante',c.manufacturerWarranty,12,'tall')):'',
    `<div class="flow-block service-area"><div class="section-title"><span>Atendimento em garantia</span></div><span class="label">Loja / telefone</span><div class="service-line">${value(c.sellerName)} · ${value(c.sellerPhone)}</div><span class="label">Endereço de atendimento</span><div class="service-line">${value(c.sellerAddress)}</div><p class="micro">Informe o número do contrato e o problema observado. O protocolo e o diagnóstico serão registrados no atendimento. Combine o encaminhamento e mantenha cópia de segurança dos arquivos.</p></div>`,
    signatures(true)
  ].join('');
  const source=(copy,title,body)=>`<article class="sheet-source" data-copy="${esc(copy)}" data-title="${esc(title)}">${body}</article>`;
  let body='';
  for(const copy of ['Via do cliente','Via da loja']){
    body+=source(copy,`Venda de equipamento ${condition}`,cover());
    body+=source(copy,'Condições complementares',extra());
    body+=source(copy,'Condições contratuais',terms());
    body+=source(copy,'Termo de entrega e aceite',delivery());
    if(copy==='Via do cliente')body+=source(copy,'Folha de garantia',warranty());
  }
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${esc(c.code)} · Contrato de equipamento ${condition}</title><style>${css}
    .sheet-source{display:none}.page{height:297mm;min-height:297mm;padding-bottom:16mm}.page-content{height:268mm;overflow:visible}.flow-block{display:flow-root}.fields,.checks{display:grid}.brand-head,.info-band,.plain-head,.warranty-hero{display:flex}.line{height:auto;min-height:7mm;display:block;white-space:pre-wrap;overflow-wrap:anywhere;padding-top:1mm}.line.tall{min-height:13mm}.line.xl{min-height:22mm}.field-row{margin-bottom:4.5mm}.section-start{margin-top:7mm}.clause h3:before{content:none}.clause-number{color:var(--blue)}.brand-meta{max-width:90mm;overflow-wrap:anywhere}.check small{display:block;color:var(--muted);font-size:9px;margin-top:1mm}.box{display:inline-flex;align-items:center;justify-content:center;font-size:10px}.sig{padding-top:7mm}.date-sign{border:0;padding-top:0;display:flex;flex-direction:column;gap:3mm;justify-content:center;white-space:normal}.date-sign b{font-size:12px;color:var(--ink);font-weight:400}.signature-note{text-align:center;margin-top:4mm}.footer{gap:3mm}.footer>span:first-child{max-width:145mm}.footer .page-count{white-space:nowrap}.continuation{margin-bottom:6mm}.continuation .doc-tag{margin-bottom:1mm}.draft-tag{color:var(--violet);font-size:8px;letter-spacing:.05em}.service-line{white-space:pre-wrap;overflow-wrap:anywhere}.clause p{white-space:pre-wrap}.page .signoff,.page .warranty-signoff{break-inside:avoid}
    </style></head><body data-code="${esc(c.code)}" data-draft="${c.status!=='issued'}">${body}<main id="printedPages"></main></body></html>`;
}
// Runs only trusted layout logic in Chromium. All contract values were HTML-escaped above.
function paginate(){
  const target=document.getElementById('printedPages');
  const footerText=source=>`${document.body.dataset.code} · ${source.dataset.copy} · ${source.dataset.title}`;
  for(const source of document.querySelectorAll('.sheet-source')){
    let content,footer;
    const createPage=continuation=>{
      const page=document.createElement('section');page.className='page';page.dataset.copy=source.dataset.copy;
      content=document.createElement('div');content.className='page-content';page.append(content);
      if(continuation){const head=document.createElement('div');head.className='continuation plain-head';const title=document.createElement('h2');title.textContent=source.dataset.title+' · continuação';head.append(title);content.append(head);}
      footer=document.createElement('div');footer.className='footer';const label=document.createElement('span');label.textContent=footerText(source);footer.append(label);
      if(document.body.dataset.draft==='true'){const draft=document.createElement('span');draft.className='draft-tag';draft.textContent='RASCUNHO · NÃO ASSINAR';footer.append(draft);}
      const number=document.createElement('span');number.className='page-count';footer.append(number);page.append(footer);target.append(page);
    };
    createPage(false);
    const fits=()=>content.lastElementChild.getBoundingClientRect().bottom<=content.getBoundingClientRect().bottom+0.5;
    const blocks=[...source.children];
    for(let i=0;i<blocks.length;i++){
      const group=[blocks[i].cloneNode(true)];
      if(blocks[i].hasAttribute('data-keep-next')&&blocks[i+1])group.push(blocks[++i].cloneNode(true));
      const existing=content.children.length;
      group.forEach(block=>content.append(block));
      if(!fits()&&existing){group.forEach(block=>block.remove());createPage(true);group.forEach(block=>content.append(block));}
      if(!fits())throw new Error('Um bloco excedeu a página A4. Revise o tamanho dos campos do contrato.');
    }
  }
  const pages=[...target.querySelectorAll('.page')];
  pages.forEach((page,i)=>page.querySelector('.page-count').textContent=`${i+1} / ${pages.length}`);
  document.querySelectorAll('.sheet-source').forEach(source=>source.remove());
  return {pages:pages.length};
}
module.exports={renderHtml,paginate};
