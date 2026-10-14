"use strict";
// Never loads production credentials for verification or an emulator restore.
const fs = require("node:fs");
const { buildBackup, verifyBackup, decode } = require("../lib/backup-format");
async function main() {
  const [action, file] = process.argv.slice(2);
  if (!file || !["export", "verify", "restore-emulator"].includes(action))
    throw new Error(
      "Uso: node scripts/backup.js export|verify|restore-emulator /caminho/backup.json",
    );
  const localDatabase = () => {
    if (
      !/^(127\.0\.0\.1|localhost):\d+$/.test(
        process.env.FIRESTORE_EMULATOR_HOST || "",
      )
    )
      throw new Error("Emulador local obrigatório.");
    const { initializeApp } = require("firebase-admin/app");
    const { getFirestore } = require("firebase-admin/firestore");
    return getFirestore(initializeApp({ projectId: "demo-infocore-restore" }));
  };
  if (action === "export") {
    const db = process.env.FIRESTORE_EMULATOR_HOST
      ? localDatabase()
      : require("../firebase/db");
    const documents = [];
    async function walk(collection) {
      // Subcollections may exist under a parent that has never been written.
      // listDocuments includes those missing parents; a normal query does not.
      for (const ref of await collection.listDocuments()) {
        const d = await ref.get();
        if (d.exists) documents.push({ path: ref.path, data: d.data() });
        for (const child of await ref.listCollections()) await walk(child);
      }
    }
    try {
      for (const c of await db.listCollections()) await walk(c);
      const backup = buildBackup(documents);
      fs.writeFileSync(file, JSON.stringify(backup), {
        mode: 0o600,
        flag: "wx",
      });
      console.log(
        `Backup criado: ${verifyBackup(backup)} documentos. Inclua uploads/ em uma cópia separada.`,
      );
    } finally {
      await db.terminate();
    }
    return;
  }
  const backup = JSON.parse(fs.readFileSync(file, "utf8"));
  const count = verifyBackup(backup);
  if (action === "verify") {
    console.log(`Checksum e estrutura válidos: ${count} documentos.`);
    return;
  }
  if (
    !/^(127\.0\.0\.1|localhost):\d+$/.test(
      process.env.FIRESTORE_EMULATOR_HOST || "",
    )
  )
    throw new Error(
      "Restauração permitida somente em emulador local (FIRESTORE_EMULATOR_HOST).",
    );
  const { initializeApp } = require("firebase-admin/app");
  const {
    getFirestore,
    Timestamp,
    GeoPoint,
  } = require("firebase-admin/firestore");
  const app = initializeApp({ projectId: "demo-infocore-restore" });
  const db = getFirestore(app);
  try {
    for (const d of backup.documents)
      await db.doc(d.path).set(
        decode(d.data, {
          timestamp: (s, n) => new Timestamp(s, n),
          geo: (a, b) => new GeoPoint(a, b),
          reference: (p) => db.doc(p),
        }),
      );
    const restored = [];
    for (const d of backup.documents) {
      const s = await db.doc(d.path).get();
      if (!s.exists) throw new Error(`Ausente: ${d.path}`);
      restored.push({ path: d.path, data: s.data() });
    }
    if (buildBackup(restored).sha256 !== backup.sha256)
      throw new Error("Divergência após restauração.");
    console.log(
      `Restauração local validada por leitura e checksum: ${count} documentos.`,
    );
  } finally {
    await db.terminate();
  }
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
