const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');
const { initializeApp, applicationDefault } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

require('dotenv').config();

function loadFirebaseCredential() {
  const inline = String(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '').trim();
  if (inline) {
    try {
      return admin.credential.cert(JSON.parse(inline));
    } catch (error) {
      throw new Error(`FIREBASE_SERVICE_ACCOUNT_JSON inválido: ${error.message}`);
    }
  }

  const configuredPath = String(process.env.FIREBASE_SERVICE_ACCOUNT_FILE || '').trim();
  const fallbackPath = path.join(__dirname, '..', 'config', 'firebase-config.json');
  const credentialPath = configuredPath
    ? path.resolve(configuredPath)
    : fallbackPath;

  if (fs.existsSync(credentialPath)) {
    try {
      const serviceAccount = JSON.parse(fs.readFileSync(credentialPath, 'utf8'));
      return admin.credential.cert(serviceAccount);
    } catch (error) {
      throw new Error(`Credencial Firebase inválida em ${credentialPath}: ${error.message}`);
    }
  }

  // Permite execução em ambientes Google Cloud que fornecem Application Default Credentials.
  try {
    return applicationDefault();
  } catch (error) {
    throw new Error(
      'Credencial Firebase não encontrada. Defina FIREBASE_SERVICE_ACCOUNT_JSON, '
      + 'FIREBASE_SERVICE_ACCOUNT_FILE ou crie config/firebase-config.json.'
    );
  }
}

const app = initializeApp({ credential: loadFirebaseCredential() });
const db = getFirestore(app);

module.exports = db;
module.exports.app = app;
