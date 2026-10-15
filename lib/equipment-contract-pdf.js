'use strict';
const PDFDocument=require('pdfkit');
const {CHECKS,clauses}=require('./equipment-contract-domain');
const money=v=>Number(v||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const date=v=>v?String(v).split('-').reverse().join('/'):'Não informado';
function buildPdf(c) {
  return new Promise((resolve,reject)=>{
    const doc=new PDFDocument({size:'A4',margins:{top:92,bottom:60,left:48,right:48},bufferPages:true,autoFirstPage:false,info:{Title:`${c.code} - Contrato de equipamento ${c.condition==='new'?'novo':'usado'}`,Author:c.sellerName,Subject:'Venda, entrega e garantia'}});
    const chunks=[];doc.on('data',x=>chunks.push(x));doc.on('error',reject);doc.on('end',()=>resolve(Buffer.concat(chunks)));
    const width=499;
    let copyLabel='';
    const pageCopies=[];
    const header=()=>{
      pageCopies.push(copyLabel);
      doc.font('Helvetica-Bold').fontSize(17).fillColor('#152c51').text((c.sellerName||'InfoCore').slice(0,48),48,32,{width:320,lineBreak:false});
      doc.font('Helvetica').fontSize(9).fillColor('#536176').text(`${c.code} | ${c.status==='issued'?'EMITIDO':'RASCUNHO - NÃO ASSINAR'}`,48,55,{width,lineBreak:false});
      doc.fontSize(8).text(copyLabel,48,67,{width,lineBreak:false});
      doc.moveTo(48,80).lineTo(547,80).lineWidth(2).strokeColor('#4969ad').stroke();doc.font('Helvetica').fontSize(12).fillColor('#263244');doc.x=48;doc.y=92;
    };
    doc.on('pageAdded',header);
    const ensure=h=>{if(doc.y+h>doc.page.height-65)doc.addPage();};
    const title=t=>{ensure(55);doc.font('Helvetica-Bold').fontSize(19).fillColor('#152c51').text(t,{width});doc.moveDown(.65);};
    const section=t=>{ensure(55);doc.moveDown(.5);doc.font('Helvetica-Bold').fontSize(12).fillColor('#315a9d').text(t,{width});doc.moveDown(.4);};
    const paragraph=t=>{doc.font('Helvetica').fontSize(12).fillColor('#263244').text(t,{width,lineGap:3});doc.moveDown(.55);};
    const field=(label,value)=>{
      const text=String(value||'Não informado');
      doc.font('Helvetica').fontSize(12);
      ensure(Math.min(135,doc.heightOfString(text,{width,lineGap:2})+31));
      doc.font('Helvetica-Bold').fontSize(9).fillColor('#66758a').text(label.toUpperCase(),{width});
      doc.font('Helvetica').fontSize(12).fillColor('#152033').text(text,{width,lineGap:2});doc.moveDown(.55);
    };
    const signature=label=>{
      ensure(65);doc.moveDown(1.7);const y=doc.y;
      doc.moveTo(48,y).lineTo(500,y).lineWidth(.7).strokeColor('#748093').stroke();doc.y=y+8;
      doc.font('Helvetica-Bold').fontSize(10).fillColor('#263244').text(label,{width});doc.moveDown(.65);
    };
    const signatures=()=>{
      ensure(245);
      section('Assinaturas obrigatórias · preencher à mão');
      signature('Assinatura do comprador');
      signature('Assinatura do representante da loja');
      signature('Assinatura da testemunha');
    };
    const renderContract=()=>{
    doc.addPage();title(`Venda de equipamento ${c.condition==='new'?'novo':'usado'}`);
    paragraph('Contrato de compra e venda, entrega e garantia. Os dados abaixo e as condições das páginas seguintes compõem um único documento.');
    section('01 / Partes');
    field('Vendedor',`${c.sellerName} · CNPJ ${c.sellerDoc}\n${c.sellerAddress}\nContato: ${c.sellerPhone} · Representante: ${c.sellerRepresentative}`);
    field('Comprador',`${c.customerName} · CPF/CNPJ ${c.customerDoc}\n${c.customerAddress}\n${c.customerPhone}${c.customerEmail?' · '+c.customerEmail:''}${c.customerRepresentative?'\nRepresentante: '+c.customerRepresentative:''}`);
    section('02 / Equipamento');
    field('Tipo / marca / modelo',`${c.deviceType} · ${c.model}`);field('Número de série / identificação',c.serial);
    for(const [l,k] of [['Configuração','configuration'],['Estado e limitações informadas','physicalCondition'],['Bateria','battery'],['Itens incluídos','accessories'],['Software e serviços','software']])field(l,c[k]);
    section('03 / Condições comerciais');
    field('Data e valor',`${date(c.saleDate)} · ${money(c.price)} · ${c.channel==='remote'?'Contratação fora da loja':'Compra presencial'}`);
    field('Pagamento acordado',c.paymentTerms);field('Recebimentos e saldo declarados',c.paymentRecord);
    if(c.invoice)field('Documento fiscal',c.invoice);
    if(c.saleSnapshot)field('Venda vinculada no PDV',`${c.saleSnapshot.code} · Total da venda: ${money(c.saleSnapshot.total)}. O valor deste equipamento é o indicado acima.`);
    if(c.commercialNotes)field('Condições adicionais',c.commercialNotes);
    ensure(200);title('Condições contratuais');
    (c.clauses||clauses(c)).forEach(([heading,text],i)=>{doc.font('Helvetica').fontSize(12);ensure(Math.min(650,doc.heightOfString(text,{width,lineGap:3})+65));section(`${i+1}. ${heading}`);paragraph(text);});
    doc.addPage();title('Termo de entrega e conferência');
    field('Equipamento',`${c.deviceType} · ${c.model} · ${c.serial}`);
    field('Data e local da entrega',`${date(c.deliveryDate)} · ${c.deliveryPlace}`);
    section('Conferência registrada na plataforma');
    const labels={ok:'Conferido',exception:'Com ressalva',na:'Não aplicável',pending:'Pendente'};
    CHECKS.forEach((name,i)=>{ensure(25);doc.font('Helvetica').fontSize(12).fillColor('#263244').text(`${labels[c.checks[i]]||'Pendente'} — ${name}`,{width,lineGap:2});doc.moveDown(.35);});
    if(c.deliveryNotes)field('Ressalvas e observações',c.deliveryNotes);
    paragraph('Ao assinar, o comprador confirma o recebimento do equipamento e dos itens descritos, com ciência das condições registradas. A conferência não representa renúncia à garantia legal. A emissão na plataforma não equivale à assinatura.');
    signatures();
    };
    const renderWarranty=()=>{
    doc.addPage();title('Via do cliente / Garantia');
    field('Contrato / comprador',`${c.code} · ${c.customerName}`);
    field('Equipamento e identificação',`${c.condition==='new'?'Novo':'Usado'} · ${c.deviceType} · ${c.model}\n${c.serial}`);
    field('Configuração',c.configuration);field('Entrega',`${date(c.deliveryDate)} · ${c.deliveryPlace}`);
    section('Garantia legal de 90 dias');
    paragraph('Para vícios aparentes ou de fácil constatação, o prazo começa na entrega. Em vícios ocultos, começa quando o defeito se evidencia, conforme o CDC. As condições contratuais deste documento se aplicam integralmente. Guarde esta via e o comprovante de compra; a falta desta folha, isoladamente, não extingue seus direitos.');
    if(c.warrantyExtra)field('Garantia adicional da loja',c.warrantyExtra);
    if(c.manufacturerWarranty)field('Garantia do fabricante',c.manufacturerWarranty);
    field('Onde solicitar atendimento',`${c.sellerName} · ${c.sellerPhone}\n${c.sellerAddress}`);
    paragraph('Informe a identificação do equipamento e o problema observado. O atendimento será registrado em protocolo ou ordem de serviço. Antes de encaminhar o equipamento, combine a entrega e mantenha cópia de segurança de seus arquivos.');
    signatures();
    };
    for(const label of ['Via do cliente','Via da loja']){
      copyLabel=label;renderContract();
      if(label==='Via do cliente')renderWarranty();
    }
    const range=doc.bufferedPageRange();
    for(let i=range.start;i<range.start+range.count;i++){
      doc.switchToPage(i);doc.page.margins.bottom=0;
      doc.font('Helvetica').fontSize(8).fillColor('#66758a').text(`${c.code} · ${pageCopies[i]} · ${i+1} / ${range.count}`,48,810,{width,align:'right',lineBreak:false});
    }
    doc.end();
  });
}
module.exports={buildPdf};
