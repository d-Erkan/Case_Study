'use strict';

const { releaseRunLock } = require('./run-lock');

module.exports = async () => {
  releaseRunLock();
};
