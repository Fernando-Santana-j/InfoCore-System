async function fetchServiceTemplateHtml(kind, service) {
    const res = await fetch('/api/services/template', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ kind, service })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.error) {
        throw new Error(data.message || 'Erro ao carregar modelo do serviço.');
    }
    if (kind === 'whatsapp') return String(data.text || '');
    return String(data.html || '');
}

function waitForServiceTemplateImages(root) {
    const imgs = [...(root || document).querySelectorAll('img')];
    return Promise.all(imgs.map((img) => {
        if (img.complete && img.naturalWidth > 0) return Promise.resolve();
        return new Promise((resolve) => {
            img.addEventListener('load', resolve, { once: true });
            img.addEventListener('error', resolve, { once: true });
        });
    }));
}

async function downloadServiceTemplateImage(service) {
    try {
        await ensureHtml2Canvas();
    } catch {
        showToast('Biblioteca de imagem indisponível.', 'error');
        return;
    }
    showToast('Gerando imagem...', 'info');
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;left:-10000px;top:0;z-index:-1;background:#f1f5f9;';
    document.body.appendChild(host);
    try {
        const html = await fetchServiceTemplateHtml('image', service);
        host.innerHTML = html;
        const area = host.querySelector('#serviceImageArea') || host.firstElementChild || host;
        await waitForServiceTemplateImages(host);
        const canvas = await html2canvas(area, {
            scale: 2,
            useCORS: true,
            allowTaint: false,
            backgroundColor: '#f1f5f9',
            logging: false
        });
        const link = document.createElement('a');
        link.href = canvas.toDataURL('image/png');
        link.download = `${service?.code || 'servico'}-relatorio.png`;
        link.click();
        showToast('Imagem baixada.', 'success');
    } catch (e) {
        console.error(e);
        showToast(e.message || 'Erro ao gerar imagem.', 'error');
    } finally {
        host.remove();
    }
}

async function printServiceTemplatePdf(service) {
    showToast('Preparando PDF...', 'info');
    try {
        const html = await fetchServiceTemplateHtml('pdf', service);
        const w = window.open('', '_blank');
        if (!w) {
            showToast('Permita pop-ups para gerar o PDF.', 'error');
            return;
        }
        w.document.open();
        w.document.write(`<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <title>OS ${service?.code || ''}</title>
  <style>
    html, body { margin: 0; padding: 0; background: #fff; }
    @media print { @page { size: A4 portrait; margin: 8mm; } }
  </style>
</head>
<body>${html}</body>
</html>`);
        w.document.close();
        await waitForServiceTemplateImages(w.document.body);
        w.focus();
        w.print();
    } catch (e) {
        console.error(e);
        showToast(e.message || 'Erro ao gerar PDF.', 'error');
    }
}

async function captureServiceReportImageBase64(service) {
    await ensureHtml2Canvas();
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;left:-10000px;top:0;z-index:-1;background:#f1f5f9;';
    document.body.appendChild(host);
    try {
        const html = await fetchServiceTemplateHtml('image', service);
        host.innerHTML = html;
        const area = host.querySelector('#serviceImageArea') || host.firstElementChild || host;
        await waitForServiceTemplateImages(host);
        const canvas = await html2canvas(area, {
            scale: 2,
            useCORS: true,
            allowTaint: false,
            backgroundColor: '#f1f5f9',
            logging: false
        });
        const dataUrl = canvas.toDataURL('image/png');
        const i = dataUrl.indexOf(',');
        return i >= 0 ? dataUrl.slice(i + 1) : dataUrl;
    } finally {
        host.remove();
    }
}

async function dispatchServiceShareToCustomer(serviceId, options) {
    const res = await fetch(`/api/services/${encodeURIComponent(serviceId)}/share`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(options)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.error) {
        throw new Error(data.message || 'Erro ao enviar relatório.');
    }
    return data;
}
