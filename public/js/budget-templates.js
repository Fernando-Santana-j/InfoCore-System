async function fetchBudgetTemplateHtml(kind, budget) {
    const res = await fetch('/api/budgets/template', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ kind, budget })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.error) {
        throw new Error(data.message || 'Erro ao carregar template do orçamento.');
    }
    return String(data.html || '');
}

function waitForBudgetTemplateImages(root) {
    const imgs = [...(root || document).querySelectorAll('img')];
    return Promise.all(imgs.map((img) => {
        if (img.complete && img.naturalWidth > 0) return Promise.resolve();
        return new Promise((resolve) => {
            img.addEventListener('load', resolve, { once: true });
            img.addEventListener('error', resolve, { once: true });
        });
    }));
}

async function loadBudgetTemplatePreview(budget, previewEl) {
    if (!previewEl) return;
    previewEl.innerHTML = '<div style="padding:24px;text-align:center;color:#64748b;">Carregando modelo...</div>';
    try {
        const html = await fetchBudgetTemplateHtml('image', budget);
        previewEl.innerHTML = html;
    } catch (e) {
        console.error(e);
        previewEl.innerHTML = '<div style="padding:24px;color:#b91c1c;">Não foi possível carregar o modelo.</div>';
        showToast(e.message || 'Erro ao carregar modelo.', 'error');
    }
}

async function downloadBudgetTemplateImage(budget) {
    try {
        await ensureHtml2Canvas();
    } catch {
        showToast('Biblioteca de imagem indisponível.', 'error');
        return;
    }
    showToast('Gerando imagem...', 'info');
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;left:-10000px;top:0;z-index:-1;background:#fff;';
    document.body.appendChild(host);
    try {
        const html = await fetchBudgetTemplateHtml('image', budget);
        host.innerHTML = html;
        const area = host.querySelector('#budgetImageArea') || host.firstElementChild || host;
        await waitForBudgetTemplateImages(host);
        const canvas = await html2canvas(area, {
            scale: 2,
            useCORS: true,
            allowTaint: false,
            backgroundColor: '#ffffff',
            logging: false
        });
        const link = document.createElement('a');
        link.href = canvas.toDataURL('image/png');
        link.download = `${budget?.code || 'orcamento'}.png`;
        link.click();
        showToast('Imagem baixada com sucesso.', 'success');
    } catch (e) {
        console.error(e);
        showToast(e.message || 'Erro ao gerar imagem.', 'error');
    } finally {
        host.remove();
    }
}

async function printBudgetTemplatePdf(budget) {
    const w = window.open('', '_blank');
    if (!w) {
        showToast('Permita pop-ups para gerar o PDF.', 'error');
        return;
    }
    showToast('Preparando impressão...', 'info');
    try {
        w.document.open();
        w.document.write('<!doctype html><html><head><meta charset="utf-8"><title>Preparando orçamento…</title></head><body style="font-family:Arial,sans-serif;padding:24px;color:#475569">Preparando orçamento…</body></html>');
        w.document.close();
        const html = await fetchBudgetTemplateHtml('pdf', budget);
        const title = `Orçamento ${budget?.code || ''}`;
        w.document.open();
        w.document.write(`<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <title>${title}</title>
  <style>
    html, body { margin: 0; padding: 0; background: #fff; color: #0f172a; }
    @media print {
      @page { size: A4 portrait; margin: 6mm; }
      html, body { margin: 0; padding: 0; height: auto; overflow: visible; }
      table { break-inside: auto; }
      tr { break-inside: avoid; break-after: auto; }
    }
  </style>
</head>
<body>${html}</body>
</html>`);
        w.document.close();
        await waitForBudgetTemplateImages(w.document.body);
        w.focus();
        w.print();
    } catch (e) {
        console.error(e);
        try { if (w && !w.closed) w.close(); } catch (_) { /* ignore */ }
        showToast(e.message || 'Erro ao gerar PDF.', 'error');
    }
}

async function writeBudgetTextToClipboard(text) {
    const value = String(text || '');
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function' && window.isSecureContext) {
        await navigator.clipboard.writeText(value);
        return;
    }

    // Fallback para instalações locais/LAN em HTTP, onde Clipboard API pode não existir.
    const area = document.createElement('textarea');
    area.value = value;
    area.setAttribute('readonly', '');
    area.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0;';
    document.body.appendChild(area);
    area.focus();
    area.select();
    let copied = false;
    try { copied = document.execCommand('copy'); } finally { area.remove(); }
    if (!copied) throw new Error('Não foi possível copiar automaticamente.');
}

async function copyBudgetTemplateText(kind, budget) {
    const html = await fetchBudgetTemplateHtml(kind, budget);
    await writeBudgetTextToClipboard(html);
}
