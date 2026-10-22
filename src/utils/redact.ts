/**
 * Hide anything that looks like an API key before logging it: provider-prefixed
 * keys (sk-, gsk_, ...), bearer tokens and long opaque strings.
 */
export function redactSecrets(text: string): string {
  return text
    .replace(/\b(Bearer\s+)[A-Za-z0-9._~+/=-]{8,}/gi, '$1[redacted]')
    .replace(/\b(?:sk|gsk|xai|pk|rk)[-_][A-Za-z0-9_-]{8,}/g, '[redacted]')
    .replace(/\b[A-Za-z0-9_-]{32,}\b/g, '[redacted]');
}
