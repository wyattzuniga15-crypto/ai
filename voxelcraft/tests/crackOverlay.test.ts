/**
 * The block-breaking overlay. The atlas is uploaded with flipY off, so a tile's uv runs down the
 * sheet exactly as its y does; flipping it turned a block being mined into whatever texture sat
 * lower down the atlas — a broken plank wore a smithing table.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { AtlasIndex, type AtlasJson } from '../src/render/atlasIndex.ts';

const file = path.join(process.cwd(), 'public', 'atlas', 'blocks.json');
const built = fs.existsSync(file);
const index = built ? new AtlasIndex(JSON.parse(fs.readFileSync(file, 'utf8')) as AtlasJson) : null;

/** Which tile a uv lands in, by walking back to atlas pixels. */
function tileAt(i: AtlasIndex, u: number, v: number): string | undefined {
  const px = u * i.width;
  const py = v * i.height;
  return i.tiles.find((t) => px >= t.x && px < t.x + t.w && py >= t.y && py < t.y + t.h)?.name;
}

describe.runIf(built)('crack overlay tiles', () => {
  it('maps every destroy stage onto its own tile and no other', () => {
    const i = index!;
    for (let stage = 0; stage < 10; stage++) {
      const name = `block/destroy_stage_${stage}`;
      const id = i.tile(name);
      expect([stage, i.tiles[id].name]).toEqual([stage, name]);
      // the four corners and the middle of the tile all have to land inside it
      for (const [u, v] of [[0.01, 0.01], [0.99, 0.01], [0.01, 0.99], [0.99, 0.99], [0.5, 0.5]]) {
        expect([stage, u, v, tileAt(i, ...i.uv(id, u, v))]).toEqual([stage, u, v, name]);
      }
    }
  });

  it('reads v down the sheet, the way the chunk shader does', () => {
    // the shader takes rect.xy + uv * rect.zw straight off the tile table, with no flip; a uv that
    // flipped v would land 2 * (0.5 - y/height) away, which is a different tile entirely
    const i = index!;
    const id = i.tile('block/destroy_stage_0');
    const t = i.tiles[id];
    expect(i.uv(id, 0, 0)).toEqual([t.x / i.width, t.y / i.height]);
    expect(tileAt(i, t.x / i.width + 0.001, 1 - t.y / i.height - 0.001)).not.toBe(t.name);
  });
});
