import type { OS } from '../config/site';

/** Best-effort OS detection in the browser. Returns null for phones and unknowns. */
export function detectOS(): OS | null {
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  const platform = (nav.userAgentData?.platform || nav.platform || '').toLowerCase();
  const ua = nav.userAgent.toLowerCase();

  if (/android|iphone|ipad|ipod/.test(ua)) return null;
  if (platform.includes('win') || ua.includes('windows')) return 'windows';
  if (platform.includes('mac') || ua.includes('mac os')) {
    // iPadOS reports itself as a Mac; touch points give it away.
    return navigator.maxTouchPoints > 1 ? null : 'macos';
  }
  if (platform.includes('linux') || ua.includes('linux') || ua.includes('x11')) return 'linux';
  return null;
}
