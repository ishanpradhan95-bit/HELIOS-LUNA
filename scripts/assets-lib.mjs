import { createHash } from 'node:crypto';
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(HERE, '..');
export const ASSETS_DIR = join(ROOT, 'frontend', 'public', 'assets');
export const MANIFEST = join(HERE, 'assets.json');
export const PACKED_DIRS = ['dem', 'atlas'];

export function readManifest() {
  return JSON.parse(readFileSync(MANIFEST, 'utf8'));
}

export function sha256(file) {
  return new Promise((resolve, reject) => {
    const h = createHash('sha256');
    createReadStream(file)
      .on('data', (c) => h.update(c))
      .on('end', () => resolve(h.digest('hex')))
      .on('error', reject);
  });
}

/** Files from the manifest that are missing or have the wrong size under frontend/public/assets. */
/** Files from the manifest that are absent under frontend/public/assets. */
export function absentFiles(manifest) {
  return Object.keys(manifest.files).filter((name) => !existsSync(join(ASSETS_DIR, name)));
}

export function missingFiles(manifest) {
  return Object.entries(manifest.files).filter(([name, size]) => {
    const p = join(ASSETS_DIR, name);
    return !existsSync(p) || statSync(p).size !== size;
  });
}
