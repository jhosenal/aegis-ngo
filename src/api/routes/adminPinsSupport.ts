/** The OpenAQ key from the environment, or undefined. Never logged or returned. */
export function openAqKeyFromEnv(): string | undefined {
  const key = (process.env['AEGIS_OPENAQ_API_KEY'] ?? '').trim();
  return key.length > 0 ? key : undefined;
}
