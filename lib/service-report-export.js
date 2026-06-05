/**
 * Gera arquivos de relatório (PDF / PNG) para envio por WhatsApp.
 */
const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');

function ensureUploadsDir(baseDir) {
    const dir = path.join(baseDir, 'uploads');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return dir;
}

function saveBase64Png(base64, uploadDir, filename) {
    const raw = String(base64 || '').replace(/^data:image\/\w+;base64,/, '').trim();
    if (!raw) throw new Error('Imagem do relatório inválida.');
    const buf = Buffer.from(raw, 'base64');
    if (!buf.length) throw new Error('Imagem do relatório vazia.');
    const filePath = path.join(uploadDir, filename);
    fs.writeFileSync(filePath, buf);
    return filePath;
}

function writeServiceReportPdf(service, uploadDir, meta = {}) {
    const token = service.shareToken || service.id || 'os';
    const fileName = `os-report-${token}.pdf`;
    const filePath = path.join(uploadDir, fileName);
    const stages = (service.checklist || []).filter((i) => i.defective);
    const storeName = meta.storeName || 'InfoCore';

    return new Promise((resolve, reject) => {
        const doc = new PDFDocument({ size: 'A4', margin: 48 });
        const stream = fs.createWriteStream(filePath);
        doc.pipe(stream);

        doc.fontSize(18).fillColor('#0f172a').text(storeName, { align: 'center' });
        doc.moveDown(0.4);
        doc.fontSize(14).text(`Ordem de serviço ${service.code || ''}`, { align: 'center' });
        doc.moveDown(1);

        doc.fontSize(11).fillColor('#334155');
        doc.text(`Cliente: ${service.customerName || '-'}`);
        doc.text(`Aparelho: ${service.deviceType || ''} ${service.deviceBrandModel || ''}`);
        if (meta.shareUrl) doc.text(`Link do relatório: ${meta.shareUrl}`);
        doc.moveDown(0.8);

        stages.forEach((item, index) => {
            doc.fontSize(12).fillColor('#0f172a').text(`Etapa ${index + 1}: ${item.label || 'Serviço'}`);
            doc.fontSize(10).fillColor('#475569');
            if (item.customerNote) doc.text(`Relato: ${item.customerNote}`);
            if (item.techNote) doc.text(`Serviço: ${item.techNote}`);
            doc.text(`Status: ${item.done ? 'Concluído' : 'Em andamento'}`);
            doc.moveDown(0.6);
        });

        if (!stages.length) {
            doc.fontSize(10).fillColor('#64748b').text('Nenhuma etapa registrada.');
        }

        doc.end();
        stream.on('finish', () => resolve({ filePath, fileName }));
        stream.on('error', reject);
    });
}

async function buildServiceReportFiles(service, baseDir, options = {}) {
    const uploadDir = ensureUploadsDir(baseDir);
    const out = { pdfPath: '', imagePath: '' };

    if (options.includePdf) {
        const pdf = await writeServiceReportPdf(service, uploadDir, {
            storeName: options.storeName,
            shareUrl: options.shareUrl
        });
        out.pdfPath = pdf.filePath;
        out.pdfFileName = pdf.fileName;
    }

    if (options.includeImage && options.imageBase64) {
        const token = service.shareToken || service.id || 'os';
        out.imagePath = saveBase64Png(
            options.imageBase64,
            uploadDir,
            `os-report-${token}.png`
        );
    }

    return out;
}

module.exports = {
    buildServiceReportFiles,
    ensureUploadsDir
};
