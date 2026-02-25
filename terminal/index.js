#!/usr/bin/env node
'use strict';

const path = require('path');

// 1. Add the project root to require search paths so SDK modules resolve correctly.
//    This allows require('app/sdk.coffee'), require('app/common/event_types'), etc.
require('app-module-path').addPath(path.join(__dirname, '..'));

// 2. Register the CoffeeScript compiler so .coffee files can be required.
require('coffeescript/register');

// 3. Install global shims BEFORE any SDK code is loaded.
//    networkManager.coffee uses global TelemetryManager, Backbone, and Storage.
require('./shims/globals');

// 4. Start the TUI application.
require('./ui/app').start().catch((err) => {
  console.error('\nFatal error:', err.message);
  if (process.env.DEBUG) console.error(err.stack);
  process.exit(1);
});
