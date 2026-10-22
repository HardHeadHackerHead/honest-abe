/**
 * Cached app version and platform info, plus the "report an issue" link.
 */
import { getVersion } from '@tauri-apps/api/app';
import { platform as getPlatform } from '@tauri-apps/plugin-os';
import { openUrl } from '@tauri-apps/plugin-opener';
import { GITHUB_NEW_ISSUE_URL } from '../constants';

let _appVersion: string | null = null;
let _appPlatform: string | null = null;

export async function getAppVersion(): Promise<string> {
  if (!_appVersion) {
    try { _appVersion = await getVersion(); } catch { _appVersion = '0.0.0'; }
  }
  return _appVersion;
}

function platformFromUserAgent(): string {
  const ua = navigator.userAgent;
  if (/Windows/i.test(ua)) return 'windows';
  if (/Mac/i.test(ua)) return 'macos';
  if (/Linux/i.test(ua)) return 'linux';
  return 'unknown';
}

export async function getAppPlatform(): Promise<string> {
  if (!_appPlatform) {
    try {
      _appPlatform = getPlatform();
    } catch {
      _appPlatform = platformFromUserAgent();
    }
  }
  return _appPlatform;
}

/** Open a prefilled GitHub "new issue" page with version and OS in the body. */
export async function openIssueReport(): Promise<void> {
  const [version, platform] = await Promise.all([getAppVersion(), getAppPlatform()]);
  const body = [
    '**What happened?**',
    '',
    '',
    '**What did you expect?**',
    '',
    '',
    '**Steps to reproduce**',
    '1. ',
    '',
    '---',
    `Abe version: ${version}`,
    `OS: ${platform} (${navigator.userAgent})`,
  ].join('\n');
  await openUrl(`${GITHUB_NEW_ISSUE_URL}?body=${encodeURIComponent(body)}`);
}
