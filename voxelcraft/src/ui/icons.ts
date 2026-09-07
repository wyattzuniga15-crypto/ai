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
import { buildModel, entityTexture, preloadEntityTextures } from '../entities/boxModel.ts';
import { specialIcon, type SpecialIcon } from './specialIcons.ts';
import { potionColor, potionOf } from '../items/potions.ts';
import type { ItemStack } from '../items/inventory.ts';

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

  /** Loads the entity textures that special (block-entity rendered) item icons draw from. */
  async preload(): Promise<void> {
    const paths = new Set<string>();
    for (const id of items.byId.keys()) {
      const sp = specialIcon(id);
      if (!sp) continue;
      paths.add(sp.model.texture);
      for (const p of sp.model.parts) if (p.texture) paths.add(p.texture);
    }
    await preloadEntityTextures(import.meta.env.BASE_URL, paths);
  }

  /** Data URL for an item id; items without any drawable model get the magenta/black checker. */
  icon(id: string): string {
    const cached = this.cache.get(id);
    if (cached !== undefined) return cached;
    let url = '';
    try {
      const def = items.byId.get(id);
      const special = specialIcon(id);
      if (special) url = this.drawSpecial(special);
      const model = url ? null : this.baker.itemModel(id, def?.block);
      if (model?.kind === 'sprite') url = this.drawSprite(model.textures);
      else if (model?.kind === 'model') url = this.drawModel(id, model.model, model.display?.gui);
      else if (!url && def?.block && blocks.has(def.block)) {
        const bm = this.baker.modelFor(blocks.defaultState(def.block), 0);
        url = this.drawModel(id, bm, undefined);
      }
      if (!url) url = this.drawSprite([`item/${id}`]);
    } catch (e) {
      console.warn('icon failed for', id, e);
    }
    if (!url) url = this.drawChecker();
    this.cache.set(id, url);
    return url;
  }

  private drawChecker(): string {
    const g = this.sprite.getContext('2d')!;
    g.clearRect(0, 0, SIZE, SIZE);
    for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) {
      g.fillStyle = (x + y) % 2 ? '#000' : '#f800f8';
      g.fillRect(x * SIZE / 2, y * SIZE / 2, SIZE / 2, SIZE / 2);
    }
    return this.sprite.toDataURL();
  }

  /** Renders a block-entity style box model (chest, shulker box, bed, banner, shield, head). */
  private drawSpecial(sp: SpecialIcon): string {
    const base = import.meta.env.BASE_URL;
    const built = buildModel(sp.model, base);
    const shades = [0.6, 0.6, 1.0, 0.5, 0.8, 0.8]; // BoxGeometry face order px, nx, py, ny, pz, nz
    const tintTex = sp.tint ? entityTexture(base, sp.tint.texture) : null;
    built.group.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      const geo = o.geometry as THREE.BufferGeometry;
      const n = geo.getAttribute('position').count;
      const col = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = shades[Math.floor(i / 4)] ?? 1;
      geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
      const mat = o.material as THREE.MeshBasicMaterial;
      mat.vertexColors = true;
      if (tintTex && mat.map === tintTex) mat.color.setHex(sp.tint!.color);
      mat.needsUpdate = true;
    });
    // centre the model, then apply the item's GUI display transform like drawModel
    const center = new THREE.Box3().setFromObject(built.group).getCenter(new THREE.Vector3());
    built.group.position.sub(center);
    const holder = new THREE.Group();
    holder.add(built.group);
    const [rx, ry, rz] = sp.gui.rotation;
    holder.rotation.set(THREE.MathUtils.degToRad(rx), THREE.MathUtils.degToRad(ry), THREE.MathUtils.degToRad(rz), 'XYZ');
    holder.scale.setScalar(sp.gui.scale * 1.6);
    holder.position.set(sp.gui.translation[0] / 16, sp.gui.translation[1] / 16, sp.gui.translation[2] / 16);
    this.scene.add(holder);
    this.renderer.render(this.scene, this.camera);
    this.scene.remove(holder);
    built.group.traverse((o) => { if (o instanceof THREE.Mesh) o.geometry.dispose(); });
    for (const m of built.materials) m.dispose();
    return this.renderer.domElement.toDataURL();
  }

  /** Icon for a particular stack: a potion is tinted by what is in the bottle. */
  forStack(stack: ItemStack): string {
    const potion = potionOf(stack);
    if (!potion) return this.icon(stack.id);
    const color = potionColor(stack);
    const key = `${stack.id}#${color.toString(16)}`;
    const cached = this.cache.get(key);
    if (cached !== undefined) return cached;
    // vanilla draws the liquid tinted under the glass, which is the same two layers we have
    const url = this.drawSprite([`item/${stack.id}_overlay`, `item/${stack.id}`], [color, 0xffffff])
      || this.drawSprite([`item/potion_overlay`, `item/${stack.id}`], [color, 0xffffff])
      || this.icon(stack.id);
    this.cache.set(key, url);
    return url;
  }

  private drawSprite(textures: string[], tints?: number[]): string {
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
      const tint = tints?.[textures.indexOf(t)];
      if (tint !== undefined && tint !== 0xffffff) {
        const r = ((tint >> 16) & 255) / 255;
        const g2 = ((tint >> 8) & 255) / 255;
        const b = (tint & 255) / 255;
        for (let i = 0; i < img.data.length; i += 4) {
          img.data[i] = img.data[i] * r;
          img.data[i + 1] = img.data[i + 1] * g2;
          img.data[i + 2] = img.data[i + 2] * b;
        }
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
        uv.push((tile.x + q.uv[i * 2] * tile.w) / this.blockAtlas.width, (tile.y + q.uv[i * 2 + 1] * tile.h) / this.blockAtlas.height);
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
