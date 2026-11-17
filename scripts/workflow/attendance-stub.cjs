// Preloaded by `npm run test:attendance`: the standalone's one local user is an
// admin, so this lets the check act as the line tablet as well.
const Module = require('node:module');
const path = require('node:path');

const stub = path.join(__dirname, 'attendance-user-stub.cjs');
const resolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request === '@/lib/rbac') return stub;
  return resolve.call(this, request, ...rest);
};
