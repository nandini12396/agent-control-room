import { createHash } from 'node:crypto';

export function fingerprint(value) {
  const normalized = JSON.stringify(value ?? '')
    .toLowerCase()
    .replace(/\b\d+(?:\.\d+)?\b/g, '#')
    .replace(/\s+/g, ' ')
    .trim();
  return createHash('sha1').update(normalized).digest('hex').slice(0, 12);
}
