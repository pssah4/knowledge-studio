/** Structured failures cross every host adapter without pretending an operation succeeded. */
export class WikiError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'WikiError';
    this.code = code;
    this.details = details;
  }
}
export function requireThat(condition, code, message, details) {
  if (!condition) throw new WikiError(code, message, details);
}
export function relativePath(value, {root = false} = {}) {
  requireThat(typeof value === 'string', 'path', 'A relative path is required.');
  if (root && (value === '' || value === '.')) return '';
  requireThat(value.length > 0 && value.length <= 4096 && !/[\\:\x00-\x1f]/.test(value)
    && !value.split('/').some(p => !p || p === '.' || p === '..'),
  'path', 'Invalid relative path or traversal.', {path:value});
  return value;
}
export function nonempty(value, label, max = 10000) {
  requireThat(typeof value === 'string' && value.trim() && value.length <= max,
    'input', `Supply ${label}.`);
  return value.trim();
}
