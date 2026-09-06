/**
 * Renders inventory icons: flat item sprites straight from the item atlas, and 3D block icons
 * rendered from the baked block model with vanilla GUI lighting. Results are cached data URLs.
 */
import * as THREE from 'three';
import type { LoadedAtlas } from '../render/atlas.ts';
import type { ModelBaker } from '../world/models.ts';
import { blocks } from '../blocks/registry.ts';
import { items } from '../items/registry.ts';
import { tintColor } from '../world/mesher.ts';
import { biomeIndex } from '../world/biomes.ts';

const SIZE = 48;

export class ItemIcons {
  private readonly cache = new Map<string, string>();
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.OrthographicCamera;
  private readonly material: THREE.MeshBasicMaterial;
  private readonly sprite = document.createElement('canvas');
  private readonly plains = biomeIndex('plains');

  constructor(private readonly blockAtlas: LoadedAtlas, private readonly itemAtlas: LoadedAtlas, private readonly baker: ModelBaker) {
    const canvas = document.createElement('canvas');
    canvas.width = SIZE;
    canvas.height = SIZE;
    this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: false, preserveDrawingBuffer: true });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    const d = 0.8;
    this.camera = new THREE.OrthographicCamera(-d, d, d, -d, 0.01, 10);
    this.camera.position.set(0, 0, 5);
    this.camera.lookAt(0, 0, 0);
    this.material = new THREE.MeshBasicMaterial({ map: blockAtlas.texture, vertexColors: true, transparent: true, alphaTest: 0.1, side: THREE.DoubleSide });
    this.sprite.width = SIZE;
    this.sprite.height = SIZE;
  }

  /** Data URL for an item id (or empty string when nothing can be drawn). */
  icon(id: string): string {
    const cached = this.cache.get(id);
    if (cached !== undefined) return cached;
    let url = '';
    try {
      const def = items.byId.get(id);
      const model = this.baker.itemModel(id, def?.block);
      if (model?.kind === 'sprite') url = this.drawSprite(model.textures);
      else if (model?.kind === 'model') url = this.drawModel(id, model.model, model.display?.gui);
      else if (def?.block && blocks.has(def.block)) {
        const bm = this.baker.modelFor(blocks.defaultState(def.block), 0);
        url = this.drawModel(id, bm, undefined);
      }
      if (!url) url = this.drawSprite([`item/${id}`]);
    } catch (e) {
      console.warn('icon failed for', id, e);
    }
    this.cache.set(id, url);
    return url;
  }

  private drawSprite(textures: string[]): string {
    const g = this.sprite.getContext('2d')!;
    g.clearRect(0, 0, SIZE, SIZE);
    g.imageSmoothingEnabled = false;
    let drew = false;
    for (const t of textures) {
      const atlas = t.startsWith('block/') ? this.blockAtlas : this.itemAtlas;
      if (!atlas.index.has(t)) continue;
      const tile = atlas.index.tiles[atlas.index.tile(t)];
      const img = new ImageData(new Uint8ClampedArray(tile.w * tile.h * 4), tile.w, tile.h);
      for (let y = 0; y < tile.h; y++) {
        const src = ((tile.y + y) * atlas.width + tile.x) * 4;
        img.data.set(atlas.pixels.subarray(src, src + tile.w * 4), y * tile.w * 4);
      }
      const tmp = document.createElement('canvas');
      tmp.width = tile.w;
      tmp.height = tile.h;
      tmp.getContext('2d')!.putImageData(img, 0, 0);
      g.drawImage(tmp, 0, 0, tile.w, tile.h, 0, 0, SIZE, SIZE);
      drew = true;
    }
    return drew ? this.sprite.toDataURL() : '';
  }

  private drawModel(id: string, model: { quads: { pos: Float32Array; uv: Float32Array; tile: number; dir: number; tint: number; shade: boolean }[] }, gui?: { rotation?: number[]; translation?: number[]; scale?: number[] }): string {
    const def = items.byId.get(id);
    const blockDef = def?.block && blocks.has(def.block) ? blocks.get(def.block) : undefined;
    const state = blockDef ? blockDef.default : 0;
    const pos: number[] = [];
    const uv: number[] = [];
    const col: number[] = [];
    const idx: number[] = [];
    const shades = [0.5, 1.0, 0.8, 0.8, 0.6, 0.6];
    let v = 0;
    for (const q of model.quads) {
      const tile = this.blockAtlas.index.tiles[q.tile];
      const tint = blockDef ? tintColor(blockDef, state, q.tint, this.plains) : 0xffffff;
      // vanilla GUI light: brighter from the top-left-front
      const s = q.shade ? shades[q.dir] : 1;
      for (let i = 0; i < 4; i++) {
        pos.push(q.pos[i * 3] - 0.5, q.pos[i * 3 + 1] - 0.5, q.pos[i * 3 + 2] - 0.5);
        uv.push((tile.x + q.uv[i * 2] * tile.w) / this.blockAtlas.width, 1 - (tile.y + q.uv[i * 2 + 1] * tile.h) / this.blockAtlas.height);
        col.push(((tint >> 16) & 255) / 255 * s, ((tint >> 8) & 255) / 255 * s, (tint & 255) / 255 * s);
      }
      idx.push(v, v + 1, v + 2, v, v + 2, v + 3);
      v += 4;
    }
    if (!v) return '';
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.setIndex(idx);
    const mesh = new THREE.Mesh(geo, this.material);
    const rot = gui?.rotation ?? [30, 225, 0];
    const scale = gui?.scale ?? [0.625, 0.625, 0.625];
    mesh.rotation.set(THREE.MathUtils.degToRad(rot[0]), THREE.MathUtils.degToRad(rot[1]), THREE.MathUtils.degToRad(rot[2]), 'XYZ');
    mesh.scale.set(scale[0] * 1.6, scale[1] * 1.6, scale[2] * 1.6);
    const tr = gui?.translation ?? [0, 0, 0];
    mesh.position.set(tr[0] / 16, tr[1] / 16, tr[2] / 16);
    this.scene.add(mesh);
    this.renderer.render(this.scene, this.camera);
    this.scene.remove(mesh);
    geo.dispose();
    return this.renderer.domElement.toDataURL();
  }
}
