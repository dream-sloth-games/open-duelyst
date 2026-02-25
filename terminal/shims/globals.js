'use strict';

// Install global shims required by SDK browser-specific code.
// These must be set up BEFORE any SDK module is required.

// --- TelemetryManager shim ---
// networkManager.coffee calls TelemetryManager.getInstance().setSignal(...)
// as a bare global (no import at top of file).
global.TelemetryManager = {
  _instance: null,
  getInstance() {
    if (!this._instance) {
      this._instance = {
        setSignal() {},
        clearSignal() {},
        removeSignal() {},
      };
    }
    return this._instance;
  },
};

// --- Backbone shim ---
// networkManager.coffee uses `new Backbone.Collection()` in the constructor
// and connect() method. Backbone is a global (no import in that file).
global.Backbone = {
  Collection: class Collection {
    constructor(models) {
      this.models = models || [];
    }
    add(models) {
      if (!Array.isArray(models)) models = [models];
      this.models.push(...models);
    }
    remove(id) {
      this.models = this.models.filter((m) => m.id !== id);
    }
    reset() {
      this.models = [];
    }
    find(fn) {
      return this.models.find(fn);
    }
    filter(fn) {
      return this.models.filter(fn);
    }
    get length() {
      return this.models.length;
    }
  },
};

// --- Storage cache shim ---
// app/common/storage.js uses store2 (browser localStorage wrapper).
// Pre-populate the require cache so SDK code gets our Node.js store instead.
// This must happen before any SDK code is required.
const path = require('path');
const NodeStorage = require('./storage-node');

try {
  const storageModulePath = require.resolve(
    path.join(__dirname, '../../app/common/storage'),
  );
  if (!require.cache[storageModulePath]) {
    require.cache[storageModulePath] = {
      id: storageModulePath,
      filename: storageModulePath,
      loaded: true,
      exports: NodeStorage,
      parent: null,
      children: [],
      paths: [],
    };
  }
} catch (e) {
  // If resolution fails, storage.js will load with store2 which may work anyway
}
