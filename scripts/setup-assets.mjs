// Downloads the baked terrain data (dem/ and atlas/) that is too large to keep in git.
// Usage: node scripts/setup-assets.mjs [--if-missing] [--force] [--from <archive.tar.gz>]
// HELIOS_ASSETS_URL overrides the download URL in scripts/assets.json.
import { spawnSync } from 'node:child_process';
import http from 'node:http';
import https from 'node:https';
import { createWriteStream, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { ASSETS_DIR, missingFiles, readManifest, sha256 } from './assets-lib.mjs';

/** GET with redirect following (GitHub release assets redirect to a CDN). Resolves with the response stream. */
function open(url, redirects = 5) {
  return new Promise((resolvePromise, reject) => {
    const client = url.startsWith('https:') ? https : http;
    client
      .get(url, { headers: { 'user-agent': 'helios-luna-setup' } }, (res) => {
        const { statusCode = 0, headers } = res;
        if (statusCode >= 300 && statusCode < 400 && headers.location) {
          res.resume();
          if (redirects === 0) return reject(new Error('too many redirects'));
          return resolvePromise(open(new URL(headers.location, url).href, redirects - 1));
        }
        if (statusCode !== 200) {
          res.resume();
          return reject(new Error(`HTTP ${statusCode}`));
        }
        resolvePromise(res);
      })
      .on('error', reject);
  });
}

const args = process.argv.slice(2);
const ifMissing = args.includes('--if-missing');
const force = args.includes('--force');
const fromIdx = args.indexOf('--from');
const localArchive = fromIdx >= 0 ? resolve(args[fromIdx + 1] ?? '') : process.env.HELIOS_ASSETS_FILE;

const manifest = readManifest();
const total = Object.keys(manifest.files).length;

if (!force && missingFiles(manifest).length === 0) {
  if (!ifMissing) console.log(`Terrain data already installed (${total} files).`);
  process.exit(0);
}

const fail = (msg) => {
  console.error(`\n${msg}\n`);
  console.error('Manual options:');
  console.error("  - download the archive from the repository's Releases page, then run");
  console.error('      npm run setup -- --from path/to/' + manifest.archive);
  console.error('  - or rebuild everything from raw NASA data: see "Regenerating the data" in README.md');
  process.exit(1);
};

const url = process.env.HELIOS_ASSETS_URL ?? manifest.url;
const work = mkdtempSync(join(tmpdir(), 'helios-assets-'));
let archive = localArchive;

try {
  if (!archive) {
    if (!url || url.includes('<'))
      fail('scripts/assets.json has no download URL yet. Set "url" to the release asset link.');
    console.log(`Downloading terrain data (${(manifest.bytes / 1e6).toFixed(0)} MB)\n  ${url}`);
    archive = join(work, manifest.archive);
    let got = 0;
    let last = 0;
    const len = manifest.bytes;
    const counter = new Transform({
      transform(chunk, _enc, cb) {
        got += chunk.length;
        const pct = Math.min(100, Math.floor((got / len) * 100));
        if (process.stdout.isTTY && pct !== last) {
          last = pct;
          process.stdout.write(`\r  ${pct}%  ${(got / 1e6).toFixed(0)} / ${(len / 1e6).toFixed(0)} MB`);
        }
        cb(null, chunk);
      },
    });
    const res = await open(url).catch((e) => fail(`Download failed: ${e.message}`));
    await pipeline(res, counter, createWriteStream(archive));
    if (process.stdout.isTTY) process.stdout.write('\n');
  } else if (!existsSync(archive)) {
    fail(`Archive not found: ${archive}`);
  }

  const digest = await sha256(archive);
  if (digest !== manifest.sha256) {
    fail(
      `Checksum mismatch.\n  expected ${manifest.sha256}\n  got      ${digest}\nThe file is corrupt or is not the archive this commit expects.`,
    );
  }

  mkdirSync(ASSETS_DIR, { recursive: true });
  console.log('Extracting...');
  const r = spawnSync('tar', ['-xzf', archive, '-C', ASSETS_DIR], { stdio: 'inherit' });
  if (r.status !== 0)
    fail('Could not extract the archive. A working `tar` is required (built in on macOS, Linux and Windows 10+).');

  const still = missingFiles(manifest);
  if (still.length)
    fail(`Extraction finished but ${still.length} files are missing or the wrong size, e.g. ${still[0][0]}.`);
  console.log(`Installed ${total} terrain files into frontend/public/assets.`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
