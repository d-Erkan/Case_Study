'use strict';

/**
 * Single source of truth for environment-dependent settings.
 * Every value can be overridden via environment variables (see .env.example);
 * defaults match the SUT's own docker-compose.yml so a fresh checkout needs no config.
 */

const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

const flag = (name) => ['1', 'true', 'yes'].includes(String(process.env[name] || '').toLowerCase());

module.exports = {
  ROOT,
  STATE_DIR: path.join(ROOT, '.state'),
  REPORTS_DIR: path.join(ROOT, 'reports'),

  apiBaseUrl: (process.env.API_BASE_URL || 'http://localhost:8080').replace(/\/$/, ''),
  mongoUri: process.env.MONGO_URI || 'mongodb://localhost:27017',
  mongoDb: process.env.MONGO_DB || 'bezkoder_db',

  // White-box knowledge taken from the SUT (app/config/auth.config.js).
  sut: {
    jwtSecret: process.env.SUT_JWT_SECRET || 'bezkoder-secret-key',
    accessTokenTtlSec: 60,
    refreshTokenTtlSec: 120,
    bcryptRounds: 8,
    roles: ['user', 'moderator', 'admin'],
  },

  // The application under test is cloned (never vendored) at a pinned commit.
  sutRepo: {
    url: process.env.SUT_REPO_URL || 'https://github.com/attarchi-meatec/jwt-refresh-token-node-js-mongodb.git',
    ref: process.env.SUT_REF || 'efbed6c4d01517fa47b4639a9b2f03b4159ec1c9',
    dir: path.join(ROOT, '.sut', 'app'),
  },
  composeProject: process.env.COMPOSE_PROJECT_NAME || 'jwt-rbac-qa',

  knownBugsMode: (process.env.KNOWN_BUGS || 'xfail').toLowerCase() === 'strict' ? 'strict' : 'xfail',
  skipDestructive: flag('SKIP_DESTRUCTIVE'),
  runSlow: flag('RUN_SLOW'),
  allowRemoteReset: flag('ALLOW_REMOTE_RESET'),
};
