'use strict';

const { api } = require('./api-client');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Poll `probe` until it returns a truthy value or the timeout elapses. */
async function waitFor(probe, { timeoutMs = 30_000, intervalMs = 250, description = 'condition' } = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const value = await probe();
      if (value) return value;
    } catch (err) {
      lastError = err;
    }
    await sleep(intervalMs);
  }
  const reason = lastError ? ` (last error: ${lastError.cause?.code || lastError.message})` : '';
  throw new Error(`Timed out after ${timeoutMs} ms waiting for ${description}${reason}`);
}

/**
 * The API is "ready" when HTTP is up AND its Mongo connection works.
 * `GET /` does not touch the DB (and app.listen() runs before mongoose connects),
 * so we additionally sign in with an unknown user: 404 proves a DB round-trip.
 */
async function waitForApiReady({ timeoutMs = 60_000 } = {}) {
  await waitFor(async () => (await api.root()).status === 200, { timeoutMs, description: 'API HTTP listener' });
  await waitFor(
    async () => (await api.auth.signin({ username: '__readiness_probe__', password: 'x' })).status === 404,
    { timeoutMs, description: 'API <-> MongoDB connectivity' },
  );
}

module.exports = { sleep, waitFor, waitForApiReady };
