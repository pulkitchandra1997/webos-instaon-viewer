'use strict';

function fault(code, message) {
  const error = new Error(message);
  error.code = code;
  if (code === 'ABORT_ERR') error.name = 'AbortError';
  return error;
}

// Accepts the AbortSignal interface without requiring AbortController (Node 12
// does not supply one globally). The owner of the signal supplies cancellation.
function onAbort(signal, callback) {
  if (!signal) return function () {};
  if (signal.aborted) { callback(); return function () {}; }
  signal.addEventListener('abort', callback, { once: true });
  return function () { signal.removeEventListener('abort', callback); };
}

function positive(value, fallback, name) {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value <= 0) throw fault('ERR_INSTAON_OPTIONS', 'Invalid ' + name);
  return value;
}

module.exports = { fault, onAbort, positive };
