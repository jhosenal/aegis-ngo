import { isIP } from 'node:net';

export interface FetchPolicy { allowlist: string[]; maxBytes: number; timeoutMs: number; maxRedirects: number }
export interface Resolver { resolve(host: string): Promise<string[]> }
interface FetchDeps { resolver: Resolver; fetchImpl: typeof fetch; /** Sent only to the host of the first URL: a redirect to another host never receives them (an API key must not leak). */ headers?: Record<string, string> }

function isPublicIpv4(address: string): boolean {
  const octets = address.split('.').map(Number);
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a, b, c] = octets as [number, number, number, number];
  return a !== 0 && a !== 10 && a !== 127 && a < 224
    && !(a === 100 && b >= 64 && b <= 127)
    && !(a === 169 && b === 254)
    && !(a === 172 && b >= 16 && b <= 31)
    && !(a === 192 && (b === 168 || (b === 0 && c === 0) || (b === 0 && c === 2)))
    && !(a === 198 && (b === 18 || b === 19 || b === 51))
    && !(a === 203 && b === 0 && c === 113);
}

function ipv6Words(address: string): number[] | null {
  const normalized = address.toLowerCase().split('%')[0];
  if (!normalized) return null;
  const halves = normalized.split('::');
  if (halves.length > 2) return null;
  const parseHalf = (half: string): number[] | null => {
    if (!half) return [];
    const words: number[] = [];
    for (const part of half.split(':')) {
      if (part.includes('.')) {
        if (isIP(part) !== 4) return null;
        const octets = part.split('.').map(Number);
        words.push(((octets[0] ?? 0) << 8) | (octets[1] ?? 0), ((octets[2] ?? 0) << 8) | (octets[3] ?? 0));
      } else if (/^[0-9a-f]{1,4}$/i.test(part)) words.push(Number.parseInt(part, 16));
      else return null;
    }
    return words;
  };
  const left = parseHalf(halves[0] ?? '');
  const right = parseHalf(halves[1] ?? '');
  if (!left || !right) return null;
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || (halves.length === 2 && missing < 1)) return null;
  return [...left, ...Array.from({ length: missing }, () => 0), ...right];
}

function isPublicIpv6(address: string): boolean {
  const words = ipv6Words(address);
  if (!words || words.length !== 8) return false;
  if (words.every((word) => word === 0)) return false;
  if (words.slice(0, 7).every((word) => word === 0) && words[7] === 1) return false;
  if ((words[0]! & 0xfe00) === 0xfc00) return false;
  if ((words[0]! & 0xffc0) === 0xfe80) return false;
  if ((words[0]! & 0xff00) === 0xff00) return false;
  if (words.slice(0, 5).every((word) => word === 0) && words[5] === 0xffff) {
    const v4 = `${words[6]! >> 8}.${words[6]! & 255}.${words[7]! >> 8}.${words[7]! & 255}`;
    return isPublicIpv4(v4);
  }
  if (words[0] === 0x2001 && words[1] === 0x0db8) return false;
  return true;
}

function isPublicAddress(address: string): boolean {
  const version = isIP(address);
  return version === 4 ? isPublicIpv4(address) : version === 6 && isPublicIpv6(address);
}

async function assertAllowedTarget(target: URL, policy: FetchPolicy, resolver: Resolver): Promise<void> {
  if (target.protocol !== 'https:') throw new Error('Only HTTPS URLs are allowed');
  if (!policy.allowlist.includes(target.hostname)) throw new Error('Host is not allowlisted');
  const addresses = await resolver.resolve(target.hostname);
  if (addresses.length === 0 || addresses.some((address) => !isPublicAddress(address))) {
    throw new Error('Host resolves to a non-public address');
  }
}

async function readLimited(response: Response, maxBytes: number, signal: AbortSignal): Promise<string> {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      if (signal.aborted) throw new Error('Fetch timed out');
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maxBytes) {
        await reader.cancel();
        throw new Error('Response exceeds maximum size');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  const text = new TextDecoder().decode(bytes);
  if (/<!DOCTYPE[\s\S]*<!ENTITY/i.test(text)) throw new Error('XML external entities are not allowed');
  return text;
}

export async function safeFetch(
  url: string,
  policy: FetchPolicy,
  deps: FetchDeps,
): Promise<{ status: number; text: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), policy.timeoutMs);
  let current: URL;
  try {
    current = new URL(url);
    const firstHost = current.host;
    for (let redirects = 0; ; redirects += 1) {
      await assertAllowedTarget(current, policy, deps.resolver);
      const response = await deps.fetchImpl(current, { method: 'GET', redirect: 'manual', signal: controller.signal, ...(deps.headers && current.host === firstHost ? { headers: deps.headers } : {}) });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get('location');
        if (location === null) throw new Error('Redirect response has no location');
        if (redirects >= policy.maxRedirects) throw new Error('Too many redirects');
        current = new URL(location, current);
        continue;
      }
      const text = await readLimited(response, policy.maxBytes, controller.signal);
      return { status: response.status, text };
    }
  } catch (error) {
    if (controller.signal.aborted) throw new Error('Fetch timed out', { cause: error });
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
