import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { DataSource } from '../frontend/src/math/engine';

export const DATA_DIR = join(import.meta.dirname, '..', 'frontend', 'public', 'assets');
export const VALID_DIR = join(import.meta.dirname, 'raw', 'validation'); // non-shipped reference ephemerides
const tryRead = async (p: string) => {
  try {
    return await readFile(join(DATA_DIR, p));
  } catch {
    return await readFile(join(VALID_DIR, p));
  }
};
export const nodeSource: DataSource = {
  async json(p) {
    return JSON.parse((await tryRead(p)).toString('utf8'));
  },
  async bin(p) {
    const b = await tryRead(p);
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
  },
};
