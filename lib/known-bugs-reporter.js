'use strict';

/**
 * Jest reporter that prints a summary of the known bugs reproduced during the run,
 * so a green xfail run still makes every detected defect visible.
 */

const fs = require('node:fs');
const { REGISTRY, LEDGER } = require('./known-bugs');
const config = require('./config');

class KnownBugsReporter {
  onRunComplete() {
    const lines = [];
    const out = (s = '') => lines.push(s);

    out('');
    out('──────────────────────── Known bugs ────────────────────────');
    if (config.knownBugsMode === 'strict') {
      out('Mode: strict — assertions for known bugs ran as normal expectations (failures above).');
      out(`Registered: ${Object.keys(REGISTRY).join(', ')}. Details: docs/bugs/README.md`);
    } else {
      let entries = [];
      try {
        entries = fs.readFileSync(LEDGER, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
      } catch {
        /* nothing recorded */
      }
      const byBug = new Map();
      for (const e of entries) {
        if (!byBug.has(e.bugId)) byBug.set(e.bugId, []);
        byBug.get(e.bugId).push(e);
      }
      out(`Mode: xfail — ${entries.length} assertion(s) reproduced ${byBug.size} known bug(s). Run "npm run test:strict" to see them fail.`);
      for (const id of Object.keys(REGISTRY)) {
        const hits = byBug.get(id) || [];
        out(`  ${hits.length ? '✗ reproduced' : '· not hit   '}  ${id}  ${REGISTRY[id]}  (${hits.length} test${hits.length === 1 ? '' : 's'})`);
      }
    }
    out('Bug reports: docs/bugs/');
    out('────────────────────────────────────────────────────────────');
    process.stdout.write(`${lines.join('\n')}\n`);
  }
}

module.exports = KnownBugsReporter;
