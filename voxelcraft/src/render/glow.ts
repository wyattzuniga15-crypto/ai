/**
 * The outline vanilla draws around a glowing entity, seen through blocks.
 *
 * Vanilla renders glowing entities into their own buffer and runs an edge filter over it. Doing
 * that here would mean a second render target and a full-screen pass for something that is usually
 * off, so the outline is drawn with the stencil buffer instead: the model is stamped into the
 * stencil at its own size, then drawn again slightly fattened, painting only where the stamp is
 * missing. What is left is the fringe — an outline. Neither pass tests depth, so the outline shows
 * through walls the way the effect does.
 */
import * as THREE from 'three';
import type { BuiltModel } from '../entities/boxModel.ts';

/** Drawn after everything else, the stamp first. */
const MASK_ORDER = 900;
const HULL_ORDER = 901;
/** How far the hull is pushed out, in Minecraft model pixels. */
const THICKNESS = 0.75;

/**
 * A box grown by a fixed amount on every face. Each mesh a box model builds holds exactly one box,
 * so pushing each vertex out from the box's own centre widens it without moving it.
 */
export function expandGeometry(geo: THREE.BufferGeometry, amount = THICKNESS): THREE.BufferGeometry {
  const out = geo.clone();
  out.computeBoundingBox();
  const c = new THREE.Vector3();
  out.boundingBox!.getCenter(c);
  const pos = out.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    pos.setXYZ(
      i,
      pos.getX(i) + Math.sign(pos.getX(i) - c.x) * amount,
      pos.getY(i) + Math.sign(pos.getY(i) - c.y) * amount,
      pos.getZ(i) + Math.sign(pos.getZ(i) - c.z) * amount,
    );
  }
  pos.needsUpdate = true;
  out.computeBoundingSphere();
  return out;
}

/** The stencil stamp: no colour, no depth, marks every pixel the model covers. */
function maskMaterial(map: THREE.Texture | null): THREE.MeshBasicMaterial {
  const m = new THREE.MeshBasicMaterial({ map, alphaTest: 0.1, side: THREE.DoubleSide, transparent: true });
  m.colorWrite = false;
  m.depthTest = false;
  m.depthWrite = false;
  m.stencilWrite = true;
  m.stencilRef = 1;
  m.stencilFunc = THREE.AlwaysStencilFunc;
  m.stencilZPass = THREE.ReplaceStencilOp;
  m.stencilFail = THREE.ReplaceStencilOp;
  m.stencilZFail = THREE.ReplaceStencilOp;
  return m;
}

/** The outline itself: flat colour, drawn only outside the stamp. */
function hullMaterial(color: number): THREE.MeshBasicMaterial {
  // transparent, though it paints solid: three draws every opaque material before any transparent
  // one, so an opaque hull would run before the stamp and the stencil test would find nothing.
  const m = new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, transparent: true });
  m.depthTest = false;
  m.depthWrite = false;
  m.stencilWrite = true;
  m.stencilRef = 1;
  m.stencilFunc = THREE.NotEqualStencilFunc;
  m.stencilZPass = THREE.KeepStencilOp;
  m.stencilFail = THREE.KeepStencilOp;
  m.stencilZFail = THREE.KeepStencilOp;
  return m;
}

/**
 * The extra meshes that outline one built model. They hang off the same part groups as the meshes
 * they copy, so they follow every animation the model plays without any per-frame work.
 */
export class GlowOutline {
  private readonly added: THREE.Mesh[] = [];
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly mask: THREE.MeshBasicMaterial;
  private readonly hull: THREE.MeshBasicMaterial;
  private shown = true;

  constructor(model: BuiltModel, color = 0xffffff) {
    const main = model.materials[0] ?? null;
    this.mask = maskMaterial(main?.map ?? null);
    this.hull = hullMaterial(color);
    // Only the skin is outlined: the layer meshes (markings, badges, collars) sit on top of it and
    // would stamp the same silhouette twice for nothing.
    const sources: THREE.Mesh[] = [];
    model.group.traverse((o) => {
      if ((o as THREE.Mesh).isMesh && (o as THREE.Mesh).material === main) sources.push(o as THREE.Mesh);
    });
    for (const src of sources) {
      const parent = src.parent;
      if (!parent) continue;
      const stamp = new THREE.Mesh(src.geometry, this.mask);
      stamp.renderOrder = MASK_ORDER;
      stamp.frustumCulled = false;
      parent.add(stamp);
      this.added.push(stamp);
      const grown = expandGeometry(src.geometry);
      this.geometries.push(grown);
      const edge = new THREE.Mesh(grown, this.hull);
      edge.renderOrder = HULL_ORDER;
      edge.frustumCulled = false;
      parent.add(edge);
      this.added.push(edge);
    }
  }

  get meshCount(): number {
    return this.added.length;
  }

  get visible(): boolean {
    return this.shown;
  }

  setVisible(v: boolean): void {
    if (this.shown === v) return;
    this.shown = v;
    for (const m of this.added) m.visible = v;
  }

  setColor(color: number): void {
    this.hull.color.setHex(color);
  }

  dispose(): void {
    for (const m of this.added) m.parent?.remove(m);
    for (const g of this.geometries) g.dispose();
    this.added.length = 0;
    this.geometries.length = 0;
    this.mask.dispose();
    this.hull.dispose();
  }
}
