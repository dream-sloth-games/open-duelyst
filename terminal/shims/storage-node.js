'use strict';

// Node.js Map-backed key-value store matching the store2 API surface used by the SDK.
// store2 uses browser localStorage; this shim works in Node.js environments.

const _store = new Map();

function makeStore(prefix) {
  return {
    get(key) {
      const val = _store.get(`${prefix}:${key}`);
      return val !== undefined ? val : null;
    },
    set(key, val) {
      _store.set(`${prefix}:${key}`, val);
      return val;
    },
    remove(key) {
      _store.delete(`${prefix}:${key}`);
    },
    has(key) {
      return _store.has(`${prefix}:${key}`);
    },
    namespace(ns) {
      return makeStore(`${prefix}/${ns}`);
    },
    clearAll() {
      for (const k of _store.keys()) {
        if (k.startsWith(`${prefix}:`)) _store.delete(k);
      }
    },
  };
}

module.exports = makeStore('duelyst');
