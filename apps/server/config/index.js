'use strict';

/**
 * WinOrbs 2.0 — server configuration boundary.
 *
 * Security rule:
 * - Secrets/configuration come from the environment.
 * - No credential has a fallback value in source control.
 * - Production CORS must be explicitly configured.
 */

function requiredSecret(name) {
  const value = String(process.env[name] || '').trim();
  return value;
}

const isProduction = String(process.env.NODE_ENV || '').toLowerCase() === 'production';

const corsRaw = String(
  process.env.CORS_ORIGIN ||
  (isProduction ? '' : '*')
)
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);

if (isProduction && corsRaw.length === 0) {
  throw new Error('CORS_ORIGIN must be configured in production.');
}

const corsAllowAll = corsRaw.includes('*');

function isOriginAllowed(origin) {
  if (!origin) return true;
  if (corsAllowAll && !isProduction) return true;
  return corsRaw.includes(origin);
}

const adminPassword = requiredSecret('ADMIN_PASSWORD');

module.exports = Object.freeze({
  isProduction,
  corsRaw,
  corsAllowAll,
  isOriginAllowed,
  adminPassword
});
