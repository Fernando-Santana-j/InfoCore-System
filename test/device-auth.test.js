const test = require('node:test');
const assert = require('node:assert/strict');
const {
    authorizeDevice,
    bearerToken,
    readDeviceAuthConfig
} = require('../lib/device-auth');

test('lê uma configuração válida de login do dispositivo', () => {
    const config = readDeviceAuthConfig({
        INFOCORE_PDV_DEVICE_TOKEN: 'a'.repeat(32),
        INFOCORE_PDV_DEVICE_USER_EMAIL: 'pdv@infocore.test'
    });
    assert.deepEqual(config, {
        token: 'a'.repeat(32),
        userEmail: 'pdv@infocore.test'
    });
});

test('mantém o login de dispositivo desativado quando nenhuma variável existe', () => {
    assert.equal(readDeviceAuthConfig({}), null);
});

test('rejeita configuração parcial ou token curto', () => {
    assert.throws(
        () => readDeviceAuthConfig({ INFOCORE_PDV_DEVICE_TOKEN: 'a'.repeat(32) }),
        /em conjunto/
    );
    assert.throws(
        () => readDeviceAuthConfig({
            INFOCORE_PDV_DEVICE_TOKEN: 'curto',
            INFOCORE_PDV_DEVICE_USER_EMAIL: 'pdv@infocore.test'
        }),
        /pelo menos 32/
    );
});

test('extrai e valida o Bearer token sem aceitar formatos ambíguos', () => {
    const token = 'segredo-aleatorio-com-mais-de-32-caracteres';
    assert.equal(bearerToken(`Bearer ${token}`), token);
    assert.equal(authorizeDevice(`Bearer ${token}`, token), true);
    assert.equal(authorizeDevice('Basic abc', token), false);
    assert.equal(authorizeDevice('Bearer incorreto', token), false);
});
