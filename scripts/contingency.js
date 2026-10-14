'use strict';
// Reads only local snapshots: this command never imports Firebase or makes network calls.
const fs = require('node:fs/promises');
const path = require('node:path');
const {COLLECTIONS,DEFAULT_DIR}=require('../lib/local-snapshots');
const {verifyBackup,decode}=require('../lib/backup-format');
const esc = value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function report(dir=DEFAULT_DIR, output=path.join(dir,'consulta-offline.html')) {
    const sections=[];const failures=[];
    for(const collection of COLLECTIONS) {
        try {
            const backup=JSON.parse(await fs.readFile(path.join(dir,collection+'.json'),'utf8'));
            verifyBackup(backup);
            if(backup.documents.some(d=>!d.path.startsWith(collection+'/') || d.path.split('/').length!==2))throw Error('Coleção divergente');
            sections.push(`<section><h2>${esc(collection)}${collection === "budget_requests" ? " — até 150 solicitações mais recentes" : ""}</h2><p>Copiado em ${esc(backup.createdAt)} · ${backup.documents.length} registros</p>${backup.documents.map(d=>{
                const row=decode(d.data);
                return `<details class="record"><summary>${esc([row.code,row.name||row.customerName||row.client,d.path.split('/')[1]].filter(Boolean).join(' · '))}</summary><pre>${esc(JSON.stringify(row,null,2))}</pre></details>`;
            }).join('')}</section>`);
        } catch(error) {failures.push(collection+': '+(error.code==='ENOENT'?'ainda não copiada':error.message));}
    }
    if(!sections.length)throw Error('Nenhuma cópia local válida disponível. Ela começa a ser formada após leituras bem-sucedidas com esta versão.');
    const html=`<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none';style-src 'unsafe-inline';script-src 'unsafe-inline';connect-src 'none';img-src 'none'"><title>InfoCore — Consulta de contingência</title><style>body{font:16px system-ui;margin:0;background:#f5f6f8;color:#18202b}main{max-width:1000px;margin:auto;padding:24px}section,header{background:white;border:1px solid #dce1e7;border-radius:14px;padding:20px;margin-bottom:20px}h1{font-size:1.6rem}p{line-height:1.6}input{box-sizing:border-box;width:100%;padding:14px;border:1px solid #aaa;border-radius:8px;font:inherit}details{padding:12px;border-bottom:1px solid #ddd}summary{cursor:pointer;overflow-wrap:anywhere}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:13px}.notice{color:#814800}</style><main><header><h1>Consulta de contingência</h1><p class="notice">Somente leitura · cópia parcial dos dados já consultados. Os registros podem estar desatualizados. Este arquivo não registra vendas, pagamentos, alterações de estoque ou aprovações.</p><p>Gerado em ${esc(new Date().toISOString())}. Cada coleção informa a data da sua própria cópia. Guarde este arquivo em local privado: ele contém dados internos e pessoais.</p><input id="search" placeholder="Buscar cliente, código, produto ou descrição" aria-label="Buscar registros"></header>${sections.join('')}<section><h2>Coleções sem cópia utilizável</h2><p>${esc(failures.join('\n')||'Todas as coleções previstas possuem uma cópia. Isso não inclui subcoleções nem anexos.')}</p></section></main><script>document.getElementById('search').addEventListener('input',function(){const q=this.value.toLocaleLowerCase('pt-BR');document.querySelectorAll('.record').forEach(el=>el.hidden=!el.textContent.toLocaleLowerCase('pt-BR').includes(q));});</script></html>`;
    await fs.writeFile(output,html,{mode:0o600});
    return output;
}
module.exports={report};
if(require.main===module) report(process.argv[2]||DEFAULT_DIR,process.argv[3]).then(file=>console.log('Consulta local criada: '+file)).catch(error=>{console.error(error.message);process.exitCode=1});
