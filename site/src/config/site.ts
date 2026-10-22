/**
 * Site-wide configuration. Everything an owner is likely to change lives here:
 * URLs, the GitHub repo, release asset names and the donation link.
 */

export const SITE_URL = 'https://getabe.app';
export const SITE_NAME = 'Abe';
export const SITE_TAGLINE = 'Free, open-source voice-to-text for your desktop';
export const SITE_DESCRIPTION =
  'Abe is free, open-source dictation for Windows (macOS and Linux coming soon). Hold a hotkey, talk, and your words appear in any app. Run Whisper locally or bring your own API key. No accounts, no servers.';

export const CONTACT_EMAIL = 'quad@quadslab.io';
export const ORG_NAME = 'Quads Lab';
export const LICENSE_NAME = 'AGPL-3.0-or-later';
export const LICENSE_URL = 'https://www.gnu.org/licenses/agpl-3.0.html';

/** GitHub repository that hosts the source and the release binaries. */
export const GITHUB_OWNER = 'HardHeadHackerHead';
export const GITHUB_REPO = 'honest-abe';
export const GITHUB_URL = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}`;
export const GITHUB_RELEASES_URL = `${GITHUB_URL}/releases`;
export const GITHUB_ISSUES_URL = `${GITHUB_URL}/issues`;
export const GITHUB_API_REPO = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}`;

/**
 * Stripe Payment Link for donations.
 */
export const DONATE_URL = 'https://buy.stripe.com/dRm28q7VlgEa8KZ5Rq3Je00';

export type OS = 'windows' | 'macos' | 'linux';

export interface DownloadAsset {
  id: string;
  os: OS;
  /** Human label, e.g. "Windows" */
  label: string;
  /** Architecture / variant, e.g. "Apple Silicon" */
  variant: string;
  /** Exact file name attached to every GitHub release (version-less). */
  file: string;
  format: string;
  /** Shown as the primary choice for this OS. */
  primary?: boolean;
  /** Not released yet: listed as "Coming soon" without a download link. */
  comingSoon?: boolean;
}

/**
 * Release assets. File names are version-less, so the permanent URL
 * `releases/latest/download/<file>` always points at the newest build.
 */
export const DOWNLOAD_ASSETS: DownloadAsset[] = [
  { id: 'win-x64', os: 'windows', label: 'Windows', variant: '64-bit (x64)', file: 'Abe-windows-x64-setup.exe', format: 'Installer (.exe)', primary: true },
  { id: 'mac-arm64', os: 'macos', label: 'macOS', variant: 'Apple Silicon (M1 and later)', file: 'Abe-macos-arm64.dmg', format: 'Disk image (.dmg)', primary: true, comingSoon: true },
  { id: 'mac-x64', os: 'macos', label: 'macOS', variant: 'Intel', file: 'Abe-macos-x64.dmg', format: 'Disk image (.dmg)', comingSoon: true },
  { id: 'linux-appimage', os: 'linux', label: 'Linux', variant: 'x86_64 AppImage', file: 'Abe-linux-x86_64.AppImage', format: 'AppImage', primary: true, comingSoon: true },
  { id: 'linux-deb', os: 'linux', label: 'Linux', variant: 'Debian / Ubuntu (amd64)', file: 'Abe-linux-amd64.deb', format: 'Debian package (.deb)', comingSoon: true },
];

export const downloadUrl = (file: string) => `${GITHUB_URL}/releases/latest/download/${file}`;

export const NAV_LINKS = [
  { href: '/download', label: 'Download' },
  { href: '/docs', label: 'Docs' },
  { href: '/changelog', label: 'Changelog' },
  { href: '/donate', label: 'Donate' },
];
