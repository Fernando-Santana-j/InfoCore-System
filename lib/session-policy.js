const DEFAULT_SESSION_MAX_AGE = 8 * 60 * 60 * 1000;
const REMEMBER_SESSION_MAX_AGE = 400 * 24 * 60 * 60 * 1000;

function configureLoginSession(session, user, remember) {
    session.user = user;
    session.rememberMe = remember === true;
    const maxAge = session.rememberMe ? REMEMBER_SESSION_MAX_AGE : DEFAULT_SESSION_MAX_AGE;
    session.cookie.maxAge = maxAge;
    session.cookie.originalMaxAge = maxAge;
}

function sessionExpiresAt(session, now = Date.now()) {
    // Null also excludes remembered sessions from Firestore TTL deletion.
    if (session?.rememberMe === true) return null;
    const maxAge = Number(session?.cookie?.maxAge) || 0;
    return new Date(now + (maxAge > 0 ? maxAge : 3600000));
}

module.exports = { DEFAULT_SESSION_MAX_AGE, REMEMBER_SESSION_MAX_AGE, configureLoginSession, sessionExpiresAt };
