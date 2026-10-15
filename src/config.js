// Read once at startup. Every value has a safe default except where noted, and
// a malformed value stops the process instead of being replaced by the default.

function readInt(env, name, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer in [${min}, ${max}], got "${raw}"`);
  }
  return value;
}

/**
 * @param {Record<string, string | undefined>} env
 */
export function loadConfig(env = process.env) {
  const tokenSecret = env.ADMISSION_TOKEN_SECRET || null;
  if (tokenSecret !== null && tokenSecret.length < 32) {
    throw new Error('ADMISSION_TOKEN_SECRET must be at least 32 characters');
  }

  return Object.freeze({
    host: env.HOST || '127.0.0.1',
    port: readInt(env, 'PORT', 4010, { max: 65535 }),
    logLevel: env.LOG_LEVEL || 'info',

    // null → an ephemeral key is generated per process (see app.js).
    tokenSecret,
    tokenKid: env.ADMISSION_TOKEN_KID || 'mock-1',
    tokenTtlMs: readInt(env, 'TOKEN_TTL_SECONDS', 15 * 60, { min: 1 }) * 1000,
    tokenRateLimitPerSecond: readInt(env, 'TOKEN_RATE_LIMIT_PER_SECOND', 10, { min: 1 }),

    saleStartsInMs: readInt(env, 'SALE_STARTS_IN_SECONDS', 0) * 1000,
    holdTtlMs: readInt(env, 'HOLD_TTL_SECONDS', 8 * 60, { min: 1 }) * 1000,

    targetActiveShoppers: readInt(env, 'TARGET_ACTIVE_SHOPPERS', 200, { min: 1 }),
    maxReleaseRate: readInt(env, 'MAX_RELEASE_RATE', 50, { min: 1 }),
    rateCommandTtlMs: 30_000,
    holdP99LimitMs: 300,
    paymentAgeLimitMs: 30_000,

    pspMaxTps: readInt(env, 'PSP_MAX_TPS', 300, { min: 1 }),
    breakerFailureThreshold: 5,
    breakerCooldownMs: 10_000,
    reconcileAfterMs: readInt(env, 'RECONCILE_AFTER_SECONDS', 5) * 1000,

    maxBodyBytes: 64 * 1024,
  });
}
