// GOLDEN (frozen by ADR-004: canonical-serialization v1). Do not change semantics; any change needs a new ADR + new vectors.
import { createHash } from 'node:crypto';
import { AegisError } from './errors.js';

const KEY_RE = /^[A-Za-z0-9_]+$/;
export const MAX_DEPTH = 32;

/** Canonical JSON v1: sorted ASCII keys, no whitespace, NFC strings, safe integers only (decimals must be strings), null allowed, undefined rejected. */
export function canonicalize(value: unknown, depth = 0): string {
  if (depth > MAX_DEPTH) throw new AegisError('CANON_TOO_DEEP');
  if (value === null) return 'null';
  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      if (!Number.isSafeInteger(value)) throw new AegisError('CANON_NON_INTEGER', 'Only safe integers are allowed; encode decimals as strings');
      return String(Object.is(value, -0) ? 0 : value);
    case 'string':
      return JSON.stringify(value.normalize('NFC'));
    case 'object': {
      if (Array.isArray(value)) return '[' + value.map((v) => canonicalize(v, depth + 1)).join(',') + ']';
      const proto = Object.getPrototypeOf(value);
      if (proto !== Object.prototype && proto !== null) throw new AegisError('CANON_UNSUPPORTED_TYPE');
      const obj = value as Record<string, unknown>;
      const keys = Object.keys(obj).sort();
      const parts: string[] = [];
      for (const k of keys) {
        if (!KEY_RE.test(k)) throw new AegisError('CANON_BAD_KEY', `Key not allowed: ${k}`);
        if (obj[k] === undefined) throw new AegisError('CANON_UNDEFINED', `Undefined value at key: ${k}`);
        parts.push(JSON.stringify(k) + ':' + canonicalize(obj[k], depth + 1));
      }
      return '{' + parts.join(',') + '}';
    }
    default:
      throw new AegisError('CANON_UNSUPPORTED_TYPE');
  }
}

export const sha256Hex = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');

/** sha256Hex(domain + "\n" + canonicalize(value)). Domain strings used in Aegis: AEG-EVT-v1, AEG-INPUT-v1, AEG-RESULT-v1, AEG-PAYLOAD-v1, AEG-EVIDENCE-v1. */
export const hashWithDomain = (domain: string, value: unknown): string => sha256Hex(domain + '\n' + canonicalize(value));
