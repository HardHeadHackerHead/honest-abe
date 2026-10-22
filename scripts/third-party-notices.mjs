// Generates THIRD_PARTY_NOTICES.md: the licenses of every Rust crate compiled
// into the app (src-tauri) and every production npm dependency bundled into
// the UI. Dev and build-only dependencies aren't shipped, so they're left out.
//
// Usage: npm install && node scripts/third-party-notices.mjs
// Needs cargo (for `cargo metadata`) and node_modules; no other tools.

import { execFileSync } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const rootDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const outFile = path.join(rootDir, 'THIRD_PARTY_NOTICES.md');

const LICENSE_FILE = /^(licen[cs]e|copying|notice|unlicense)([-._].*)?$/i;

// Crates that vendor C/C++ sources with their own license, relative to the crate root
const VENDORED_LICENSE_DIRS = {
  'whisper-rs-sys': ['whisper.cpp'],
};

function readLicenseTexts(dir) {
  if (!dir || !fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => LICENSE_FILE.test(f) && fs.statSync(path.join(dir, f)).isFile())
    .sort()
    .map((f) => fs.readFileSync(path.join(dir, f), 'utf8').replace(/\r\n/g, '\n').trim())
    .filter(Boolean);
}

// ---------- Rust ----------

function rustPackages() {
  const meta = JSON.parse(execFileSync(
    'cargo',
    ['metadata', '--format-version', '1', '--locked', '--manifest-path', path.join(rootDir, 'src-tauri', 'Cargo.toml')],
    { maxBuffer: 256 * 1024 * 1024, encoding: 'utf8' },
  ));
  const byId = new Map(meta.packages.map((p) => [p.id, p]));
  const nodes = new Map(meta.resolve.nodes.map((n) => [n.id, n]));
  const rootId = meta.resolve.root;

  // Follow normal dependencies only (all platforms, so the list covers every
  // installer); dev- and build-dependencies never end up in the binary.
  const seen = new Set();
  const queue = [rootId];
  while (queue.length) {
    const id = queue.pop();
    for (const dep of nodes.get(id)?.deps ?? []) {
      if (!dep.dep_kinds.some((k) => k.kind === null)) continue;
      if (seen.has(dep.pkg)) continue;
      seen.add(dep.pkg);
      queue.push(dep.pkg);
    }
  }

  return [...seen].map((id) => {
    const p = byId.get(id);
    const dir = path.dirname(p.manifest_path);
    const texts = readLicenseTexts(dir);
    for (const sub of VENDORED_LICENSE_DIRS[p.name] ?? []) texts.push(...readLicenseTexts(path.join(dir, sub)));
    if (!texts.length && p.license_file) texts.push(...readLicenseTexts(path.dirname(path.join(dir, p.license_file))));
    return {
      name: p.name,
      version: p.version,
      license: p.license || (p.license_file ? `See ${p.license_file}` : 'UNKNOWN'),
      url: p.repository || p.homepage || `https://crates.io/crates/${p.name}`,
      texts,
    };
  });
}

// ---------- npm ----------

function npmPackages() {
  const lock = JSON.parse(fs.readFileSync(path.join(rootDir, 'package-lock.json'), 'utf8'));
  const out = [];
  for (const [key, entry] of Object.entries(lock.packages ?? {})) {
    if (!key.startsWith('node_modules/') || entry.dev || entry.devOptional) continue;
    const dir = path.join(rootDir, key);
    // Platform-specific optional packages that aren't installed here are skipped
    if (!fs.existsSync(dir)) continue;
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
    const name = key.slice(key.lastIndexOf('node_modules/') + 'node_modules/'.length);
    const license = typeof pkg.license === 'string' ? pkg.license : pkg.license?.type ?? entry.license ?? 'UNKNOWN';
    const repo = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url;
    out.push({
      name,
      version: pkg.version,
      license,
      url: pkg.homepage || repo || `https://www.npmjs.com/package/${name}`,
      texts: readLicenseTexts(dir),
    });
  }
  return out;
}

// ---------- Output ----------

function dedupe(list) {
  const map = new Map();
  for (const p of list) map.set(`${p.name}@${p.version}`, p);
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
}

function section(title, packages) {
  const lines = [`## ${title}`, '', `${packages.length} packages.`, '', '| Package | Version | License |', '|---|---|---|'];
  for (const p of packages) lines.push(`| [${p.name}](${p.url.replace(/^git\+/, '')}) | ${p.version} | ${p.license} |`);
  lines.push('');
  return lines;
}

function licenseTexts(packages) {
  // Many packages share identical license files; print each text once with
  // every package that uses it.
  const groups = new Map();
  const missing = [];
  for (const p of packages) {
    if (!p.texts.length) { missing.push(p); continue; }
    for (const text of p.texts) {
      const hash = crypto.createHash('sha256').update(text).digest('hex');
      if (!groups.has(hash)) groups.set(hash, { text, users: [] });
      groups.get(hash).users.push(`${p.name} ${p.version}`);
    }
  }
  const lines = ['## License texts', ''];
  for (const { text, users } of [...groups.values()].sort((a, b) => a.users[0].localeCompare(b.users[0]))) {
    lines.push(`### Used by: ${[...new Set(users)].join(', ')}`, '', '```text', text.replace(/```/g, "'''"), '```', '');
  }
  if (missing.length) {
    lines.push('### Packages without a license file', '',
      'These packages ship no license file; their license is the SPDX expression listed above, whose standard text applies.', '');
    for (const p of missing) lines.push(`- ${p.name} ${p.version}: ${p.license}`);
    lines.push('');
  }
  return lines;
}

const rust = dedupe(rustPackages());
const npm = dedupe(npmPackages());

const doc = [
  '# Third-Party Notices',
  '',
  'Abe is licensed under AGPL-3.0-or-later (see [LICENSE](LICENSE)). It includes the third-party software listed below,',
  'each under its own license. This file is generated by `node scripts/third-party-notices.mjs`; do not edit it by hand.',
  '',
  '## Not bundled: Whisper models',
  '',
  'The Whisper speech recognition models (GGML format, from [ggerganov/whisper.cpp on Hugging Face](https://huggingface.co/ggerganov/whisper.cpp))',
  'are released by OpenAI under the MIT license. They are downloaded at runtime when you choose a local model and are not',
  'included in the Abe installers. whisper.cpp itself (MIT) is compiled into the app through the `whisper-rs-sys` crate below.',
  '',
  ...section('Rust crates', rust),
  ...section('npm packages (bundled into the UI)', npm),
  ...licenseTexts([...rust, ...npm]),
].join('\n');

fs.writeFileSync(outFile, doc);
console.log(`Wrote ${path.relative(rootDir, outFile)}: ${rust.length} crates, ${npm.length} npm packages`);
