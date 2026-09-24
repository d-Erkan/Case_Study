#!/usr/bin/env node
'use strict';

/**
 * Environment lifecycle for the system under test (SUT).
 *
 *   node scripts/env.js up      clone SUT at the pinned commit (if needed), build & start it, wait until ready
 *   node scripts/env.js down    stop it and delete its volumes (clean slate)
 *   node scripts/env.js reset   down + up
 *   node scripts/env.js status  docker compose ps
 *   node scripts/env.js logs    tail API logs
 *
 * The SUT is cloned into .sut/app (git-ignored) and run with its OWN docker-compose.yml,
 * unmodified. Written in Node rather than bash so it also works on Windows.
 */

const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const config = require('../lib/config');
const { waitForApiReady } = require('../lib/wait');

const log = (m) => console.log(`[env] ${m}`);

function run(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, { stdio: 'inherit', ...opts });
  if (res.error) throw new Error(`Cannot run "${cmd}": ${res.error.message}`);
  if (res.status !== 0) throw new Error(`"${cmd} ${args.join(' ')}" exited with code ${res.status}`);
}

function capture(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts }).trim();
}

function checkPrerequisites() {
  for (const [cmd, args, hint] of [
    ['git', ['--version'], 'Install git'],
    ['docker', ['compose', 'version'], 'Install Docker Desktop / Docker Engine with the Compose v2 plugin'],
    ['docker', ['info', '--format', '{{.ServerVersion}}'], 'Start the Docker daemon (Docker Desktop)'],
  ]) {
    try {
      capture(cmd, args);
    } catch {
      throw new Error(`Prerequisite check failed: "${cmd} ${args.join(' ')}". ${hint}.`);
    }
  }
}

/** Clone the SUT at the pinned commit. Never touches a checkout with local modifications. */
function ensureSutCheckout() {
  const { url, ref, dir } = config.sutRepo;
  if (!fs.existsSync(path.join(dir, '.git'))) {
    log(`Cloning SUT ${url} -> ${path.relative(config.ROOT, dir)}`);
    fs.mkdirSync(path.dirname(dir), { recursive: true });
    run('git', ['clone', '--quiet', url, dir]);
  }
  const head = capture('git', ['-C', dir, 'rev-parse', 'HEAD']);
  if (head !== ref) {
    if (capture('git', ['-C', dir, 'status', '--porcelain'])) {
      throw new Error(`${dir} has local modifications; refusing to switch it to ${ref}. Delete .sut/ to re-clone.`);
    }
    log(`Checking out pinned SUT commit ${ref.slice(0, 12)}`);
    run('git', ['-C', dir, 'fetch', '--quiet', 'origin']);
    run('git', ['-C', dir, 'checkout', '--quiet', '--detach', ref]);
  }
  log(`SUT at ${capture('git', ['-C', dir, 'log', '-1', '--format=%h %s'])}`);
}

/** Compose invocation: the SUT's own file, plus the optional extra-CA build override. */
function composeArgs() {
  const files = ['-f', path.join(config.sutRepo.dir, 'docker-compose.yml')];
  const env = { ...process.env, QA_ROOT: config.ROOT };
  if (process.env.EXTRA_CA_CERT) {
    const certsDir = path.join(config.ROOT, '.sut', 'certs');
    fs.mkdirSync(certsDir, { recursive: true });
    fs.copyFileSync(path.resolve(process.env.EXTRA_CA_CERT), path.join(certsDir, 'extra-ca.crt'));
    files.push('-f', path.join(config.ROOT, 'docker', 'compose.extra-ca.yml'));
    log(`EXTRA_CA_CERT set — building the API image with ${process.env.EXTRA_CA_CERT} trusted`);
  }
  return { args: ['compose', '-p', config.composeProject, ...files], env };
}

function compose(extra, opts = {}) {
  const { args, env } = composeArgs();
  run('docker', [...args, ...extra], { env, ...opts });
}

async function up() {
  checkPrerequisites();
  ensureSutCheckout();
  log('Building and starting containers (first run downloads images and npm packages) ...');
  compose(['up', '--detach', '--build', '--wait', '--wait-timeout', '180']);
  log(`Waiting for API readiness at ${config.apiBaseUrl} ...`);
  await waitForApiReady({ timeoutMs: 90_000 });
  log('Environment is up. Next: npm run test:setup  (or directly: npm test)');
}

function down() {
  if (!fs.existsSync(config.sutRepo.dir)) return log('Nothing to stop (.sut/app does not exist).');
  compose(['down', '--volumes', '--remove-orphans']);
  log('Environment stopped and volumes removed.');
}

const commands = {
  up,
  down,
  reset: async () => {
    down();
    await up();
  },
  status: () => compose(['ps']),
  logs: () => compose(['logs', '--tail', '200', 'app']),
};

const cmd = process.argv[2];
if (!commands[cmd]) {
  console.error(`Usage: node scripts/env.js <${Object.keys(commands).join('|')}>`);
  process.exit(2);
}
Promise.resolve()
  .then(commands[cmd])
  .catch((err) => {
    console.error(`[env] FAILED: ${err.message}`);
    process.exitCode = 1;
  });
