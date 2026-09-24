'use strict';

const { closeDb } = require('../lib/db');

// Each test file gets its own module registry (and therefore its own Mongo client).
afterAll(async () => {
  await closeDb();
});
