/**
 * Minimal structured logger. Not pulling in a dependency (winston/pino) to
 * keep the project lightweight — swap this out easily if the project grows.
 */
function ts() {
  return new Date().toISOString();
}

const logger = {
  info: (msg, meta) => console.log(`[${ts()}] INFO  ${msg}`, meta !== undefined ? meta : ''),
  warn: (msg, meta) => console.warn(`[${ts()}] WARN  ${msg}`, meta !== undefined ? meta : ''),
  error: (msg, meta) => console.error(`[${ts()}] ERROR ${msg}`, meta !== undefined ? meta : ''),
};

module.exports = logger;
