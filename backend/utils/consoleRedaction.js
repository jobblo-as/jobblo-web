const util = require('util');
const { redactText } = require('./sanitizer');

/**
 * Every console line the server writes passes through redactText (M12). About 200 call
 * sites log whole error objects, and a MongoDB duplicate-key error carries the user's
 * e-mail or phone number into the process logs. One wrapper here instead of a rule
 * every future `console.error(err)` has to remember. Installed by bootstrap only, so
 * tests that spy on console are unaffected.
 */
function installConsoleRedaction(target = console) {
  for (const level of ['log', 'info', 'warn', 'error']) {
    const original = target[level].bind(target);
    target[level] = (...args) => original(redactText(util.format(...args)));
  }
}

module.exports = { installConsoleRedaction };
