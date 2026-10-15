'use strict';
const VERSION = 2;
const CHECKS = ['Liga e inicializa', 'Tela / saída de vídeo', 'Armazenamento', 'Memória', 'USB / conexões', 'Rede / Wi-Fi', 'Áudio', 'Bateria / carregamento', 'Carregador / cabo de energia', 'Acessórios e estado físico'];
const fields = [
  ['condition','Modelo do contrato','select','equipment',true,[['used','Equipamento usado'],['new','Equipamento novo']]],
  ['deviceType','Tipo de equipamento','text','equipment',true],
  ['model','Marca e modelo','text','equipment',true],
  ['serial','Número de série / identificação física','text','equipment',true],
  ['configuration','Configuração (processador, RAM, armazenamento etc.)','textarea','equipment',true],
  ['physicalCondition','Estado físico, marcas e limitações conhecidas','textarea','equipment',true],
  ['battery','Bateria: saúde, autonomia medida ou não aplicável','textarea','equipment',true],
  ['accessories','Acessórios, carregador e itens incluídos','textarea','equipment',true],
  ['software','Sistema operacional, licenças e serviços incluídos','textarea','equipment',true],
  ['customerName','Nome / razão social do comprador','text','customer',true],
  ['customerDoc','CPF / CNPJ do comprador','text','customer',true],
  ['customerPhone','Telefone / WhatsApp','text','customer',true],
  ['customerEmail','E-mail','email','customer',false],
  ['customerAddress','Endereço completo do comprador','textarea','customer',true],
  ['customerRepresentative','Representante do comprador (se aplicável)','text','customer',false],
  ['sellerName','Nome / razão social da loja','text','seller',true],
  ['sellerDoc','CNPJ da loja','text','seller',true],
  ['sellerAddress','Endereço e local do atendimento em garantia','textarea','seller',true],
  ['sellerPhone','Telefone para atendimento','text','seller',true],
  ['sellerRepresentative','Representante da loja que assina','text','seller',true],
  ['saleDate','Data do contrato','date','commercial',true],
  ['price','Valor deste equipamento (R$)','number','commercial',true],
  ['paymentTerms','Forma de pagamento, entrada, parcelas e vencimentos','textarea','commercial',true],
  ['paymentRecord','Valores efetivamente recebidos e saldo / comprovantes','textarea','commercial',true],
  ['invoice','Documento fiscal / referência (se disponível)','text','commercial',false],
  ['channel','Forma de contratação','select','commercial',true,[['store','Presencial na loja'],['remote','Fora da loja / internet / telefone']]],
  ['commercialNotes','Outras condições comerciais','textarea','commercial',false],
  ['deliveryDate','Data da entrega','date','delivery',true],
  ['deliveryPlace','Local da entrega','text','delivery',true],
  ['deliveryNotes','Ressalvas e observações da conferência','textarea','delivery',false],
  ['warrantyExtra','Garantia contratual adicional','textarea','warranty',false],
  ['manufacturerWarranty','Garantia do fabricante e canal de atendimento','textarea','warranty',false],
].map(([name,label,type,group,required,options]) => ({name,label,type,group,required,options:options||[],maxLength:type==='textarea'?1600:240}));
const fail = (message,status=400) => Object.assign(new Error(message),{status});
function normalize(body={}, complete=false) {
  const data={};
  for (const f of fields) {
    const raw = body[f.name] ?? '';
    if (!['string','number'].includes(typeof raw)) throw fail(`Campo inválido: ${f.label}.`);
    const value=String(raw).trim();
    if(value.length>f.maxLength) throw fail(`${f.label}: limite de ${f.maxLength} caracteres.`);
    if(complete && f.required && !value) throw fail(`Preencha: ${f.label}.`);
    if(f.type==='select' && !f.options.some(([key])=>key===value)) throw fail(`Escolha: ${f.label}.`);
    if(f.type==='date' && value && (!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value))||new Date(value).toISOString().slice(0,10)!==value)) throw fail(`Data inválida: ${f.label}.`);
    if(f.type==='number') {
      if(value && (!Number.isFinite(Number(value)) || Number(value)<0 || Number(value)>999999999 || Math.abs(Number(value)*100-Math.round(Number(value)*100))>0.00001)) throw fail('Informe um valor válido com até duas casas decimais.');
      data[f.name]=value===''?'':Math.round(Number(value)*100)/100;
    } else data[f.name]=value;
  }
  if(complete && data.deliveryDate<data.saleDate) throw fail('A entrega não pode ser anterior à data do contrato.');
  data.checks=CHECKS.map((_,i)=> {
    const v=body.checks?.[i] || 'pending';
    if(!['pending','ok','exception','na'].includes(v)) throw fail('Resultado de conferência inválido.');
    if(complete && v==='pending') throw fail('Conclua todos os itens da conferência de entrega.');
    return v;
  });
  if(complete && data.checks.includes('exception')&&!data.deliveryNotes) throw fail('Descreva as ressalvas da conferência de entrega.');
  data.saleId=String(body.saleId||'').trim();
  if(data.saleId && !/^[a-zA-Z0-9_-]{1,150}$/.test(data.saleId)) throw fail('Referência da venda inválida.');
  return data;
}
function clauses(c) {
  return [
    ['Objeto e composição do contrato',`A loja vende ao comprador o equipamento ${c.condition==='new'?'novo':'usado'} identificado neste documento. Configuração, identificação, acessórios, condições comerciais, conferência e termo de garantia integram a contratação. O fornecedor declara a origem lícita e a disponibilidade do bem para venda.`],
    [c.condition==='new'?'Condição de equipamento novo':'Condição de equipamento usado',c.condition==='new'?'O equipamento é vendido como novo, sem uso anterior pelo consumidor. Abertura de embalagem para montagem, configuração ou testes deve ser informada, assim como componentes ou acessórios que não sejam novos. Produtos de exposição, recondicionados ou usados não devem ser apresentados como novos.':'O equipamento possui utilização anterior. Marcas de uso, peças substituídas, limitações e defeitos conhecidos devem constar expressamente do estado físico e da configuração. A ciência dessas características não representa renúncia a direitos sobre vícios ocultos ou falhas diferentes das informadas.'],
    ['Preço, pagamento e documentação','O valor e as condições de pagamento são os preenchidos neste contrato. Apenas os recebimentos expressamente registrados e comprovados representam quitação; a assinatura, isoladamente, não declara pagamento integral. O contrato não substitui documento fiscal. Alterações comerciais devem ser documentadas e aceitas pelas partes.'],
    ['Entrega e conferência','O termo de entrega registra o equipamento, os acessórios e os testes efetivamente realizados. Itens não aplicáveis e ressalvas são identificados na página de conferência. A assinatura confirma o recebimento nas condições registradas, sem afastar vícios não perceptíveis nos testes.'],
    ['Garantia legal','O prazo para reclamar de vícios aparentes ou de fácil constatação é de 90 dias, contado da entrega. Para vícios ocultos, a contagem começa quando o defeito se evidencia, conforme o CDC. A cobertura legal independe de garantia adicional.'],
    ['Garantias adicionais','A garantia contratual oferecida pela loja complementa a legal. Prazo, cobertura, forma de atendimento e eventuais ônus devem estar descritos no campo próprio. A garantia do fabricante segue seu termo, sem afastar responsabilidades legais da loja.'],
    ['Atendimento e solução','O comprador pode comunicar a falha pelos contatos da loja e apresentar o equipamento para análise, mediante registro do atendimento. Em regra, o saneamento ocorre em até 30 dias; preservam-se as hipóteses legais de solução imediata e as alternativas de substituição, restituição ou abatimento previstas no CDC.'],
    ['Danos posteriores e intervenções','Danos causados após a entrega por queda, líquido, alimentação elétrica inadequada, uso indevido ou intervenção técnica dependem de relação demonstrável com a falha para exclusão da cobertura. Abertura do equipamento ou rompimento de lacre não anulam automaticamente a garantia. O diagnóstico deve distinguir desgaste informado, falha coberta e dano posterior.'],
    ['Bateria e desempenho','A condição e os testes da bateria estão registrados neste documento. Autonomia varia conforme uso, brilho, programas e conservação. Estimativas não são promessa de duração invariável, mas essa variação não exclui defeitos nem permite omitir limitações conhecidas. O mesmo vale para desempenho e compatibilidade da configuração informada.'],
    ['Programas, contas e arquivos','Licenças, instalações e serviços incluídos são os expressamente descritos. O comprador deve manter cópias de segurança e evitar entregar senhas desnecessárias. Formatação, migração ou acesso a arquivos em atendimento posterior exigem alinhamento prévio. Esta recomendação não exclui responsabilidade por danos imputáveis ao fornecedor.'],
    ['Contratação fora do estabelecimento',c.channel==='remote'?'Na contratação fora da loja, aplica-se o direito de arrependimento de 7 dias, nos termos do art. 49 do CDC, com devolução dos valores pagos. O comprador pode usar os canais da loja para solicitar orientação de devolução.':'Na compra presencial, trocas por preferência dependem da política comercial informada. Permanecem os direitos relativos a vícios, descumprimento da oferta e demais hipóteses legais.'],
    ['Dados pessoais','A loja utiliza os dados necessários para executar a venda, emitir documentos, prestar garantia, cumprir obrigações legais e exercer direitos. O acesso deve ser restrito e o compartilhamento limitado a essas finalidades. O titular pode solicitar informações e exercer seus direitos pelo contato da loja. Este contrato não autoriza publicidade nem uso irrestrito de dados.'],
    ['Solução de divergências','As partes buscarão solução pelos canais informados, sem impedir recurso ao Procon, ao consumidor.gov.br quando aplicável, ou ao Judiciário. Prevalecem as normas obrigatórias de defesa do consumidor e o foro legalmente competente. Nenhuma condição adicional pode afastar esses direitos.']
  ];
}
function sellerDefaults(config={},user={}) {
  return {sellerName:config.storeName||'InfoCore',sellerDoc:config.storeDoc||'66.569.675/0001-64',sellerAddress:config.storeAddress||'Praça Abel Jacó dos Santos, 889, Centro, Simão Dias/SE',sellerPhone:config.storePhone||'(79) 99134-3921',sellerRepresentative:user.name||''};
}
module.exports={VERSION,CHECKS,fields,normalize,clauses,sellerDefaults,fail};
