/** Builds small Three.js meshes for single block states (falling blocks, dropped blocks, held items). */
import * as THREE from 'three';
import type { ModelBaker } from '../world/models.ts';
import type { LoadedAtlas } from './atlas.ts';
import { blocks } from '../blocks/registry.ts';
import { tintColor } from '../world/mesher.ts';
import { biomeIndex } from '../world/biomes.ts';
import { FACE_SHADE } from '../world/models.ts';

export class BlockMeshFactory {
  private readonly cache = new Map<number, THREE.BufferGeometry>();
  readonly material: THREE.MeshBasicMaterial;
  private readonly plains = biomeIndex('plains');

  constructor(private readonly baker: ModelBaker, atlas: LoadedAtlas) {
    this.material = new THREE.MeshBasicMaterial({ map: atlas.texture, vertexColors: true, alphaTest: 0.1, side: THREE.DoubleSide });
  }

  geometry(state: number): THREE.BufferGeometry {
    let geo = this.cache.get(state);
    if (geo) return geo;
    const def = blocks.blockOf(state);
    const model = this.baker.modelFor(state, 0.3);
    const atlas = this.baker.atlas;
    const pos: number[] = [];
    const uv: number[] = [];
    const col: number[] = [];
    const idx: number[] = [];
    let v = 0;
    for (const q of model.quads) {
      const tile = atlas.tiles[q.tile];
      const tint = tintColor(def, state, q.tint, this.plains);
      const s = q.shade ? FACE_SHADE[q.dir] : 1;
      for (let i = 0; i < 4; i++) {
        pos.push(q.pos[i * 3], q.pos[i * 3 + 1], q.pos[i * 3 + 2]);
        uv.push((tile.x + q.uv[i * 2] * tile.w) / atlas.width, (tile.y + q.uv[i * 2 + 1] * tile.h) / atlas.height);
        col.push(((tint >> 16) & 255) / 255 * s, ((tint >> 8) & 255) / 255 * s, (tint & 255) / 255 * s);
      }
      idx.push(v, v + 1, v + 2, v, v + 2, v + 3);
      v += 4;
    }
    geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.setIndex(idx);
    geo.computeBoundingSphere();
    this.cache.set(state, geo);
    return geo;
  }

  mesh(state: number): THREE.Mesh {
    return new THREE.Mesh(this.geometry(state), this.material);
  }

  /**
   * A mesh for a model named straight out of the resource pack rather than for a block state, which
   * is how the things vanilla draws as entities on a block model (an item frame) are built. The
   * model's own 0-16 space is scaled down to one block and centred.
   */
  namedMesh(modelName: string): THREE.Mesh | null {
    let geo = this.named.get(modelName);
    if (!geo) {
      const model = this.baker.bake(modelName);
      if (!model?.quads.length) return null;
      const atlas = this.baker.atlas;
      const pos: number[] = [];
      const uv: number[] = [];
      const col: number[] = [];
      const idx: number[] = [];
      let v = 0;
      for (const q of model.quads) {
        const tile = atlas.tiles[q.tile];
        const s = q.shade ? FACE_SHADE[q.dir] : 1;
        for (let i = 0; i < 4; i++) {
          pos.push(q.pos[i * 3] - 0.5, q.pos[i * 3 + 1] - 0.5, q.pos[i * 3 + 2] - 0.5);
          uv.push((tile.x + q.uv[i * 2] * tile.w) / atlas.width, (tile.y + q.uv[i * 2 + 1] * tile.h) / atlas.height);
          col.push(s, s, s);
        }
        idx.push(v, v + 1, v + 2, v, v + 2, v + 3);
        v += 4;
      }
      geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      geo.setIndex(idx);
      geo.computeBoundingSphere();
      this.named.set(modelName, geo);
    }
    return new THREE.Mesh(geo, this.material);
  }

  private readonly named = new Map<string, THREE.BufferGeometry>();
}
