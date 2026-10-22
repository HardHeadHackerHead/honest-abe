/**
 * Build-time access to GitHub Releases. Every call degrades to `null` / `[]`
 * when the repo is missing, private, rate-limited or the network is down, so
 * the site always builds. Set GITHUB_TOKEN to raise the rate limit (or to read
 * a private repo) in CI.
 */
import { GITHUB_API_REPO } from '../config/site';

export interface Release {
  tag: string;
  name: string;
  version: string;
  url: string;
  publishedAt: string;
  body: string;
  prerelease: boolean;
}

interface GitHubRelease {
  tag_name: string;
  name: string | null;
  html_url: string;
  published_at: string | null;
  body: string | null;
  draft: boolean;
  prerelease: boolean;
}

const cache = new Map<string, Promise<unknown>>();

async function fetchJson<T>(path: string): Promise<T | null> {
  if (process.env.ABE_OFFLINE === '1') return null;
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'getabe.app-build',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  const token = process.env.GITHUB_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;
  try {
    const res = await fetch(`${GITHUB_API_REPO}${path}`, { headers, signal: AbortSignal.timeout(8000) });
    if (!res.ok) {
      console.info(`[github] ${path}: HTTP ${res.status}, using fallback`);
      return null;
    }
    return (await res.json()) as T;
  } catch (err) {
    console.info(`[github] ${path}: ${(err as Error).message}, using fallback`);
    return null;
  }
}

function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  if (!cache.has(key)) cache.set(key, load());
  return cache.get(key) as Promise<T>;
}

const toRelease = (r: GitHubRelease): Release => ({
  tag: r.tag_name,
  name: r.name || r.tag_name,
  version: r.tag_name.replace(/^v/, ''),
  url: r.html_url,
  publishedAt: r.published_at ?? '',
  body: r.body ?? '',
  prerelease: r.prerelease,
});

export function getLatestRelease(): Promise<Release | null> {
  return cached('latest', async () => {
    const data = await fetchJson<GitHubRelease>('/releases/latest');
    return data ? toRelease(data) : null;
  });
}

export function getReleases(): Promise<Release[]> {
  return cached('all', async () => {
    const data = await fetchJson<GitHubRelease[]>('/releases?per_page=50');
    return Array.isArray(data) ? data.filter((r) => !r.draft).map(toRelease) : [];
  });
}

export const formatDate = (iso: string) =>
  iso ? new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' }) : '';
