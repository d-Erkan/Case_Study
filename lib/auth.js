'use strict';

/**
 * Token management for tests.
 *
 * The SUT's access tokens live only 60 s, so a token minted once at setup time
 * cannot be shared by a multi-minute test run. `tokenFor(persona)` re-uses the
 * token issued by the setup script while it is fresh and transparently signs in
 * again when it is about to expire.
 */

const fs = require('node:fs');
const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');

const config = require('./config');
const { api } = require('./api-client');
const { USERS, PASSWORD } = require('./fixtures');
const { SESSION_FILE } = require('./seed');

// Refresh well before the 60 s expiry so a token never dies mid-test.
const MAX_TOKEN_AGE_MS = (config.sut.accessTokenTtlSec - 20) * 1000;

const cache = new Map();

function loadSessionFile() {
  try {
    const session = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'));
    for (const [persona, s] of Object.entries(session.personas || {})) {
      if (!cache.has(persona)) cache.set(persona, s);
    }
  } catch {
    /* no session file yet — we'll sign in on demand */
  }
}
loadSessionFile();

async function signIn(username, password = PASSWORD) {
  const res = await api.auth.signin({ username, password });
  if (res.status !== 200) throw new Error(`Sign-in failed for ${username}: HTTP ${res.status} ${res.text}`);
  return { ...res.body, issuedAt: Date.now() };
}

/** Fresh, valid access token for a seeded persona ('user' | 'moderator' | 'admin' | 'superuser'). */
async function tokenFor(persona) {
  if (!USERS[persona]) throw new Error(`Unknown persona "${persona}"`);
  const cached = cache.get(persona);
  if (cached && Date.now() - cached.issuedAt < MAX_TOKEN_AGE_MS) return cached.accessToken;
  const session = await signIn(USERS[persona].username);
  cache.set(persona, session);
  return session.accessToken;
}

/** Unique, collision-free credentials for tests that register new accounts. */
function uniqueCredentials(prefix = 'qa') {
  const suffix = `${Date.now().toString(36)}${crypto.randomBytes(3).toString('hex')}`;
  return {
    username: `${prefix}_${suffix}`,
    email: `${prefix}_${suffix}@example.test`,
    password: `Pw-${suffix}`,
  };
}

/** Register a brand-new account through the API and sign it in. */
async function registerAndSignIn({ roles, prefix } = {}) {
  const creds = uniqueCredentials(prefix);
  const signup = await api.auth.signup({ ...creds, ...(roles ? { roles } : {}) });
  if (signup.status !== 200 && signup.status !== 201) {
    throw new Error(`Sign-up failed: HTTP ${signup.status} ${signup.text}`);
  }
  const session = await signIn(creds.username, creds.password);
  return { ...creds, ...session };
}

/** Decode (without verifying) a JWT payload. */
function decodeJwt(token) {
  return jwt.decode(token);
}

/**
 * Craft a token signed with the SUT's secret. Used only where waiting for real
 * expiry (60 s) would make the suite slow; see docs/DESIGN.md for the trade-off.
 */
function forgeToken(payload, { secret = config.sut.jwtSecret, ...options } = {}) {
  return jwt.sign(payload, secret, options);
}

module.exports = { tokenFor, signIn, registerAndSignIn, uniqueCredentials, decodeJwt, forgeToken };
