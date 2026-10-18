// An access token for Google Cloud calls made by the server (Vertex AI). On the owner's machine the local gcloud login is used (AEGIS_VERTEX_AUTH=gcloud); on Cloud Run the service account's own token
// from the metadata server. Tokens are never logged or stored.
import { execFile } from 'node:child_process';

const METADATA_TOKEN = 'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token';

export function gcloudToken(): Promise<string> {
  return new Promise((resolve, reject) => execFile('gcloud', ['auth', 'print-access-token'], { shell: process.platform === 'win32', timeout: 20_000 }, (err, out) => (err ? reject(new Error('gcloud could not give an access token')) : resolve(String(out).trim()))));
}
export async function metadataToken(fetchImpl: typeof fetch = fetch): Promise<string> {
  const r = await fetchImpl(METADATA_TOKEN, { headers: { 'Metadata-Flavor': 'Google' } });
  if (!r.ok) throw new Error(`no service account token (HTTP ${r.status})`);
  return ((await r.json()) as { access_token: string }).access_token;
}
export const tokenFor = (auth: 'gcloud' | 'metadata', fetchImpl: typeof fetch = fetch): (() => Promise<string>) => (auth === 'gcloud' ? gcloudToken : () => metadataToken(fetchImpl));
