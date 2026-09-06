import { fileURLToPath } from 'node:url';
import path from 'node:path';

/** Repository root of the voxelcraft project (the directory that holds package.json). */
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const CACHE = path.join(ROOT, '.cache');
export const ASSETS = path.join(ROOT, 'assets');
export const PUBLIC = path.join(ROOT, 'public');
export const DATA = path.join(ROOT, 'data');

/** Minecraft version whose data and assets this project mirrors. */
export const MC_VERSION = '1.21.11';

export const jarDir = (version = MC_VERSION) => path.join(CACHE, 'mc', version);
export const mcDataDir = (version = MC_VERSION) => path.join(CACHE, 'minecraft-data', version);
