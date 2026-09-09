/**
 * Colour handling. Minecraft multiplies a texture's bytes by the tint and the light level as they
 * stand and puts the result on the screen; it has no linear working space. Three's default does,
 * and mixing the two renders the world at about half brightness.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import fs from 'node:fs';
import path from 'node:path';
import '../src/render/renderer.ts';

describe('the colour pipeline', () => {
  it('does no colour management, the way Mojang does none', () => {
    expect(THREE.ColorManagement.enabled).toBe(false);
  });

  it('leaves every texture and every renderer in plain sRGB numbers', () => {
    // the terrain shader writes gl_FragColor itself, so it never gets three's encode back: one
    // texture left decoding to linear is enough to darken half the game
    const bad: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith('.ts')) {
          const src = fs.readFileSync(full, 'utf8');
          for (const line of src.split('\n')) {
            if (/ColorSpace\s*=\s*THREE\.SRGBColorSpace/.test(line)) bad.push(`${full}: ${line.trim()}`);
          }
        }
      }
    };
    walk('src');
    expect(bad).toEqual([]);
  });
});
