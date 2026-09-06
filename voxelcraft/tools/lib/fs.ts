import fs from 'node:fs';
import path from 'node:path';

export function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

export function readJson<T = unknown>(file: string): T {
  return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
}

export function writeJson(file: string, value: unknown, pretty = false): void {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, pretty ? JSON.stringify(value, null, 2) + '\n' : JSON.stringify(value));
}

/** Recursively copy a directory tree (files only, overwrites). */
export function copyDir(src: string, dest: string, filter?: (rel: string) => boolean): number {
  let n = 0;
  if (!fs.existsSync(src)) return 0;
  const walk = (dir: string) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const from = path.join(dir, ent.name);
      const rel = path.relative(src, from);
      if (ent.isDirectory()) walk(from);
      else if (!filter || filter(rel)) {
        const to = path.join(dest, rel);
        ensureDir(path.dirname(to));
        fs.copyFileSync(from, to);
        n++;
      }
    }
  };
  walk(src);
  return n;
}

export function listFiles(dir: string, ext?: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => !ext || f.endsWith(ext))
    .sort();
}

export function stripNs(id: string): string {
  return id.startsWith('minecraft:') ? id.slice('minecraft:'.length) : id;
}
