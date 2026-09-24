const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const session = require('express-session');
const { configureLoginSession, sessionExpiresAt, DEFAULT_SESSION_MAX_AGE, REMEMBER_SESSION_MAX_AGE } = require('../lib/session-policy');

test('remember me creates a persistent protected cookie and no server expiry', () => {
    const value = { cookie: new session.Cookie({ httpOnly: true, sameSite: 'lax', secure: true }) };
    configureLoginSession(value, { id: 'u1' }, true);
    assert.equal(value.rememberMe, true);
    assert.equal(value.cookie.originalMaxAge, REMEMBER_SESSION_MAX_AGE);
    assert.equal(sessionExpiresAt(value), null);
    assert.match(value.cookie.serialize('connect.sid', 'test'), /Expires=/);
    assert.match(value.cookie.serialize('connect.sid', 'test'), /HttpOnly; Secure; SameSite=Lax/);
});

test('normal login retains eight-hour expiry and requires explicit remember opt-in', () => {
    for (const remember of [false, undefined, 'false', 'true', 1]) {
        const value = { rememberMe: true, cookie: new session.Cookie() };
        configureLoginSession(value, { id: 'u1' }, remember);
        assert.equal(value.rememberMe, false);
        assert.equal(value.cookie.originalMaxAge, DEFAULT_SESSION_MAX_AGE);
        assert.ok(sessionExpiresAt(value) instanceof Date);
    }
});

function makeStore() {
    const records = new Map();
    const collection = { doc: (id) => ({
        get: async () => ({ exists: records.has(id), data: () => records.get(id) }),
        set: async (data, options) => records.set(id, options?.merge ? { ...records.get(id), ...data } : data),
        delete: async () => records.delete(id)
    }) };
    const source = fs.readFileSync(require.resolve('../index.js'), 'utf8');
    const start = source.indexOf('class FirestoreSessionStore');
    const end = source.indexOf('\napp.use(session({', start);
    const context = {
        session, firestore: { collection: () => collection }, sessionExpiresAt,
        cloneSessionData: (value) => JSON.parse(JSON.stringify(value)),
        toDateSafe: (value) => value ? new Date(value) : null,
        FieldValue: { serverTimestamp: () => new Date() },
        SESSION_CACHE_TTL_MS: 30000, SESSION_CACHE_MAX: 500, SESSION_TOUCH_INTERVAL_MS: 300000,
        process, Date
    };
    vm.runInNewContext(`${source.slice(start, end)}\nthis.Store = FirestoreSessionStore;`, context);
    return { records, Store: context.Store };
}
const call = (store, method, ...args) => new Promise((resolve, reject) => {
    store[method](...args, (error, result) => error ? reject(error) : resolve(result));
});

test('remembered session survives store restart and old cookie dates, supports touch and logout', async () => {
    const { records, Store } = makeStore();
    const value = { cookie: new session.Cookie() };
    configureLoginSession(value, { id: 'u1' }, true);
    await call(new Store(), 'set', 'remembered', value);
    assert.equal(records.get('remembered').expiresAt, null);
    records.get('remembered').session.cookie.expires = '2020-01-01T00:00:00Z';
    const restarted = new Store();
    const restored = await call(restarted, 'get', 'remembered');
    assert.equal(restored.user.id, 'u1');
    await call(restarted, 'touch', 'remembered', restored);
    restarted.cache.clear();
    await call(restarted, 'touch', 'remembered', restored);
    assert.equal(records.get('remembered').expiresAt, null);
    await call(restarted, 'destroy', 'remembered');
    assert.equal(await call(new Store(), 'get', 'remembered'), null);
});

test('normal sessions still expire in the persistent store', async () => {
    const { records, Store } = makeStore();
    const value = { cookie: new session.Cookie() };
    configureLoginSession(value, { id: 'u1' }, false);
    await call(new Store(), 'set', 'normal', value);
    records.get('normal').expiresAt = new Date('2020-01-01');
    assert.equal(await call(new Store(), 'get', 'normal'), null);
    assert.equal(records.has('normal'), false);
});
