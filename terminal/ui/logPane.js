'use strict';

const MAX_LOG_ENTRIES = 100;

class LogPane {
  constructor() {
    this._entries = [];
    this._box = null;
  }

  /**
   * Attach to a blessed box element.
   * @param {Object} box - blessed box
   */
  attach(box) {
    this._box = box;
  }

  /**
   * Add a log entry and refresh the display.
   * @param {string} msg
   */
  log(msg) {
    const timestamp = new Date().toLocaleTimeString('en-US', { hour12: false });
    this._entries.unshift(`[${timestamp}] ${msg}`);
    if (this._entries.length > MAX_LOG_ENTRIES) {
      this._entries = this._entries.slice(0, MAX_LOG_ENTRIES);
    }
    this._refresh();
  }

  /**
   * Log a game step event in human-readable form.
   * @param {Object} stepEvent - The SDK step event object
   */
  logStep(stepEvent) {
    try {
      const step = stepEvent && stepEvent.step;
      if (!step) return;
      const action = step.getAction ? step.getAction() : step.action;
      if (!action) return;
      const type = action.getType ? action.getType() : (action.type || 'action');
      const owner = action.getOwnerId ? action.getOwnerId() : '';
      const ownerLabel = owner ? owner.slice(0, 8) : '?';
      this.log(`${ownerLabel}: ${type}`);
    } catch (e) {
      this.log('(step)');
    }
  }

  /**
   * Return all entries as a single string for non-blessed display.
   */
  getText() {
    return this._entries.join('\n');
  }

  _refresh() {
    if (this._box) {
      this._box.setContent(this._entries.join('\n'));
      if (this._box.screen) this._box.screen.render();
    }
  }
}

module.exports = new LogPane();
