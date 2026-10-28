// Preloaded by `npm run test:workflows`: the server actions call Next's
// revalidatePath, which needs a running Next request. Outside one it is a
// no-op here — the workflow check reads the database, not cached pages.
const Module = require('node:module');
const path = require('node:path');

const stub = path.join(__dirname, 'next-cache-stub.cjs');
const resolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request === 'next/cache') return stub;
  return resolve.call(this, request, ...rest);
};
