/**
 * Tile lookup for a packed texture atlas (public/atlas/*.json). Pure data – shared by the mesh
 * worker (which needs tile ids) and the renderer (which needs rectangles and animation frames).
 */
export interface AtlasTile {
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  frames?: [number, number][];
  seq?: [number, number][];
  interpolate?: boolean;
}

export interface AtlasJson {
  width: number;
  height: number;
  tiles: AtlasTile[];
}

export class AtlasIndex {
  readonly width: number;
  readonly height: number;
  readonly tiles: AtlasTile[];
  private readonly byName = new Map<string, number>();
  /** Tile ids that animate, for the per-tick frame update. */
  readonly animated: number[] = [];

  constructor(json: AtlasJson) {
    this.width = json.width;
    this.height = json.height;
    this.tiles = json.tiles;
    json.tiles.forEach((t, i) => {
      this.byName.set(t.name, i);
      if (t.frames && t.frames.length > 1) this.animated.push(i);
    });
  }

  /** Tile id for a texture name such as "block/stone"; 0 (the missing-texture checker) if unknown. */
  tile(name: string): number {
    return this.byName.get(name) ?? 0;
  }

  has(name: string): boolean {
    return this.byName.has(name);
  }

  /**
   * Where a point inside a tile lands in atlas uv space, taking (0,0) as the tile's top-left corner
   * and (1,1) as its bottom-right. The atlas is uploaded with flipY off, so v runs down the image
   * exactly as a tile's y does and there is nothing to undo — the chunk shader reads it the same
   * way. Flipping v here instead put a mined block in whatever texture sat lower down the sheet.
   */
  uv(id: number, u: number, v: number): [number, number] {
    const t = this.tiles[id] ?? this.tiles[0];
    return [(t.x + u * t.w) / this.width, (t.y + v * t.h) / this.height];
  }

  get count(): number {
    return this.tiles.length;
  }
}
