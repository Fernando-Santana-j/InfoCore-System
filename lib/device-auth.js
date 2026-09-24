const { createHash, timingSafeEqual } = require('node:crypto');

function readDeviceAuthConfig(env = process.env) {
    const token = String(env.INFOCORE_PDV_DEVICE_TOKEN || '').trim();
    const userEmail = String(env.INFOCORE_PDV_DEVICE_USER_EMAIL || '').trim();

    if (!token && !userEmail) return null;
    if (!token || !userEmail) {
        throw new Error('Configure INFOCORE_PDV_DEVICE_TOKEN e INFOCORE_PDV_DEVICE_USER_EMAIL em conjunto.');
    }
    if (token.length < 32) {
        throw new Error('INFOCORE_PDV_DEVICE_TOKEN deve ter pelo menos 32 caracteres aleatorios.');
    }

    return { token, userEmail };
}

function bearerToken(authorization = '') {
    const match = /^Bearer\s+(.+)$/i.exec(String(authorization).trim());
    return match ? match[1].trim() : '';
}

function tokenDigest(value) {
    return createHash('sha256').update(String(value)).digest();
}

function authorizeDevice(authorization, expectedToken) {
    const suppliedToken = bearerToken(authorization);
    if (!suppliedToken || !expectedToken) return false;
    return timingSafeEqual(tokenDigest(suppliedToken), tokenDigest(expectedToken));
}

module.exports = {
    authorizeDevice,
    bearerToken,
    readDeviceAuthConfig
};
