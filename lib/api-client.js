'use strict';

/**
 * Thin HTTP client for the API under test.
 *
 * Deliberately minimal: it never throws on non-2xx responses and always returns
 * status, headers, raw text and parsed JSON (when parseable), so tests can assert
 * on the exact wire-level behaviour — including non-JSON error pages.
 * Uses Node's built-in fetch (no extra dependency).
 */

const { apiBaseUrl } = require('./config');

const DEFAULT_TIMEOUT_MS = 10_000;

async function request(method, path, { token, body, headers = {}, rawBody, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const finalHeaders = { ...headers };
  if (token !== undefined) finalHeaders['x-access-token'] = token;

  let payload;
  if (rawBody !== undefined) {
    payload = rawBody;
  } else if (body !== undefined) {
    finalHeaders['content-type'] = 'application/json';
    payload = JSON.stringify(body);
  }

  const res = await fetch(`${apiBaseUrl}${path}`, {
    method,
    headers: finalHeaders,
    body: payload,
    signal: AbortSignal.timeout(timeoutMs),
  });

  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = undefined;
  }

  return {
    status: res.status,
    headers: res.headers,
    contentType: res.headers.get('content-type') || '',
    text,
    body: json,
    request: { method, path, body },
  };
}

const api = {
  request,
  root: () => request('GET', '/'),

  auth: {
    signup: (body) => request('POST', '/api/auth/signup', { body }),
    signin: (body) => request('POST', '/api/auth/signin', { body }),
    refreshToken: (body) => request('POST', '/api/auth/refreshtoken', { body }),
  },

  boards: {
    all: (token) => request('GET', '/api/test/all', { token }),
    user: (token) => request('GET', '/api/test/user', { token }),
    mod: (token) => request('GET', '/api/test/mod', { token }),
    admin: (token) => request('GET', '/api/test/admin', { token }),
  },

  tutorials: {
    list: (token, query = '') => request('GET', `/api/tutorials${query}`, { token }),
    published: (token) => request('GET', '/api/tutorials/published', { token }),
    get: (token, id) => request('GET', `/api/tutorials/${id}`, { token }),
    create: (token, body) => request('POST', '/api/tutorials', { token, body }),
    update: (token, id, body) => request('PUT', `/api/tutorials/${id}`, { token, body }),
    remove: (token, id) => request('DELETE', `/api/tutorials/${id}`, { token }),
    removeAll: (token) => request('DELETE', '/api/tutorials', { token }),
  },
};

module.exports = { api };
