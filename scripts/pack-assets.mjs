// Maintainer tool: bundles the baked dem/ and atlas/ folders into one archive for a GitHub Release
// and records its checksum and file list in scripts/assets.json.
// Usage: node scripts/pack-assets.mjs [outDir]   (default: ./release)
import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ASSETS_DIR, MANIFEST, PACKED_DIRS, ROOT, readManifest, sha256 } from './assets-lib.mjs';

const manifest = readManifest();
const outDir = resolve(process.argv[2] ?? join(ROOT, 'release'));
const name = `helios-luna-assets-v${manifest.version}.tar.gz`;
const archive = join(outDir, name);

const files = {};
for (const dir of PACKED_DIRS) {
  for (const f of readdirSync(join(ASSETS_DIR, dir)).sort()) {
    if (f.startsWith('.')) continue;
    files[`${dir}/${f}`] = statSync(join(ASSETS_DIR, dir, f)).size;
  }
}

mkdirSync(outDir, { recursive: true });
const r = spawnSync('tar', ['-czf', archive, '-C', ASSETS_DIR, ...PACKED_DIRS], {
  stdio: 'inherit',
  env: { ...process.env, COPYFILE_DISABLE: '1' },
});
if (r.status !== 0) {
  console.error('tar failed');
  process.exit(1);
}

manifest.archive = name;
manifest.bytes = statSync(archive).size;
manifest.sha256 = await sha256(archive);
manifest.files = files;
writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n');

console.log(`${archive}`);
console.log(`${(manifest.bytes / 1e6).toFixed(1)} MB, ${Object.keys(files).length} files, sha256 ${manifest.sha256}`);
console.log(`Upload it to a GitHub Release and make sure "url" in scripts/assets.json points at it.`);
