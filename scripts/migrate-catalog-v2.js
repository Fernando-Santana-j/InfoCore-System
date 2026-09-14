#!/usr/bin/env node

/* Normaliza products sem apagar documentos. Execute sem --apply para simular. */
const fs = require('fs');
const path = require('path');
const db = require('../firebase/db');
const { FieldValue } = require('firebase-admin/firestore');

const APPLY = process.argv.includes('--apply');
const COLLECTION = 'products';
const now = new Date().toISOString();

function num(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function classify(data) {
    return String(data.itemType || '').toLowerCase() === 'service' ? 'service' : 'product';
}

async function main() {
    const snap = await db.collection(COLLECTION).get();
    const updates = [];
    const summary = { total: snap.size, products: 0, services: 0, legacy: 0 };
    const backup = [];

    snap.docs.forEach((doc) => {
        const data = doc.data() || {};
        const explicit = data.itemType === 'product' || data.itemType === 'service';
        if (!explicit) summary.legacy++;
        const itemType = classify(data);
        summary[`${itemType}s` ]++;
        backup.push({ id: doc.id, data });
        const patch = { schemaVersion: 2, itemType, updatedAt: now };
        if (itemType === 'service') {
            patch.trackStock = FieldValue.delete();
            patch.qty = FieldValue.delete();
            patch.min = FieldValue.delete();
            patch.partsCost = num(data.partsCost, 0);
        } else {
            patch.trackStock = data.trackStock !== false;
            patch.qty = Math.max(0, Math.trunc(num(data.qty, 0)));
            patch.min = Math.max(0, Math.trunc(num(data.min, 0)));
            patch.partsCost = FieldValue.delete();
            patch.serviceDuration = FieldValue.delete();
        }
        updates.push({ ref: doc.ref, patch });
    });

    console.log(JSON.stringify({ mode: APPLY ? 'apply' : 'dry-run', summary }, null, 2));
    if (!APPLY) return;

    const backupPath = path.join('/tmp', `infocore-products-backup-${Date.now()}.json`);
    fs.writeFileSync(backupPath, JSON.stringify(backup, null, 2));
    for (let i = 0; i < updates.length; i += 400) {
        const batch = db.batch();
        updates.slice(i, i + 400).forEach(({ ref, patch }) => batch.update(ref, patch));
        await batch.commit();
    }
    console.log(`Aplicados ${updates.length} documentos. Backup: ${backupPath}`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => db.terminate());
