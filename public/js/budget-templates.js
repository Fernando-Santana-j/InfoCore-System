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
    showToast('Preparando impressão...', 'info');
    try {
        const html = await fetchBudgetTemplateHtml('pdf', budget);
        const w = window.open('', '_blank');
        if (!w) {
            showToast('Permita pop-ups para gerar o PDF.', 'error');
            return;
        }
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
      @page { size: A4 portrait; margin: 4mm; }
      html, body { margin: 0; padding: 0; height: 100%; overflow: hidden; }
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
        showToast(e.message || 'Erro ao gerar PDF.', 'error');
    }
}

async function copyBudgetTemplateText(kind, budget) {
    const html = await fetchBudgetTemplateHtml(kind, budget);
    await navigator.clipboard.writeText(html);
}
