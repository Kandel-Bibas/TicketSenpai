const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };

/**
 * JSON-lines logger. Callers must never pass admission tokens, payment tokens
 * or signing keys as fields.
 * @param {{ level?: keyof typeof LEVELS, write?: (line: string) => void, now?: () => number }} [options]
 */
export function createLogger({ level = 'info', write = (line) => process.stdout.write(line), now = Date.now } = {}) {
  if (!(level in LEVELS)) throw new Error(`Unknown log level "${level}"`);
  const threshold = LEVELS[level];
  const emit = (name) => (msg, fields = {}) => {
    if (LEVELS[name] < threshold) return;
    write(JSON.stringify({ time: new Date(now()).toISOString(), level: name, msg, ...fields }) + '\n');
  };
  return { debug: emit('debug'), info: emit('info'), warn: emit('warn'), error: emit('error') };
}
