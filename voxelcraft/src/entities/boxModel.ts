/**
 * Box-model builder for mobs: vanilla-style part hierarchies (pivot + boxes with the standard
 * texture net) built into Three.js groups. Definitions are written in Minecraft's model space
 * (units of 1/16, y down, front toward -z) and converted here.
 */
import * as THREE from 'three';

export interface BoxDef {
  /** Texture net origin in pixels. */
  uv: [number, number];
  /** x, y, z of the box corner and w, h, d, in Minecraft model space (y down). */
  box: [number, number, number, number, number, number];
  inflate?: number;
  mirror?: boolean;
  /** Mirror every face vertically (chest-style models that vanilla renders without the y flip). */
  flipV?: boolean;
}

export interface PartDef {
  name: string;
  pivot: [number, number, number];
  boxes: BoxDef[];
  rotation?: [number, number, number];
  parent?: string;
  /** Optional separate texture (sheep wool layer). */
  texture?: string;
  /** Hidden until animation shows it (e.g. baby/variant parts). */
  hidden?: boolean;
}

export interface ModelDef {
  texture: string;
  texW: number;
  texH: number;
  parts: PartDef[];
}

export interface BuiltModel {
  group: THREE.Group;
  parts: Map<string, THREE.Group>;
  materials: THREE.MeshBasicMaterial[];
  /** Rotation each part is built with, so animations can pose relative to the model's rest pose. */
  basePose: Map<string, THREE.Euler>;
  /** Material per texture the model was built with, so skin layers can be swapped by name. */
  layers: Map<string, THREE.MeshBasicMaterial>;
}

const textureCache = new Map<string, THREE.Texture>();

function prepare(t: THREE.Texture, path: string): THREE.Texture {
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.colorSpace = THREE.SRGBColorSpace;
  textureCache.set(path, t);
  return t;
}

export function entityTexture(base: string, path: string): THREE.Texture {
  return textureCache.get(path) ?? prepare(new THREE.TextureLoader().load(`${base}textures/entity/${path}`), path);
}

/** Loads entity textures ahead of synchronous use (item icons); missing files are skipped. */
export async function preloadEntityTextures(base: string, paths: Iterable<string>): Promise<void> {
  const loader = new THREE.TextureLoader();
  await Promise.all([...new Set(paths)].filter((p) => !textureCache.has(p)).map(async (p) => {
    try {
      prepare(await loader.loadAsync(`${base}textures/entity/${p}`), p);
    } catch {
      /* missing texture: the model falls back to the loader's empty texture */
    }
  }));
}

/**
 * Sets one BoxGeometry face's uvs from a pixel rectangle (v grows downward in the texture).
 * Faces in BoxGeometry order: px, nx, py, ny, pz, nz. `rot` rotates the rectangle in 90° steps.
 */
function setFace(uv: THREE.BufferAttribute, face: number, u1: number, v1: number, u2: number, v2: number, texW: number, texH: number, rot = 0, mirror = false, flipV = false): void {
  if (flipV) [v1, v2] = [v2, v1];
  let corners: [number, number][] = [[u1, v1], [u2, v1], [u1, v2], [u2, v2]]; // TL, TR, BL, BR
  if (mirror) corners = [corners[1], corners[0], corners[3], corners[2]];
  for (let r = 0; r < rot; r++) corners = [corners[2], corners[0], corners[3], corners[1]];
  for (let i = 0; i < 4; i++) uv.setXY(face * 4 + i, corners[i][0] / texW, 1 - corners[i][1] / texH);
}

export function boxGeometry(def: BoxDef, texW: number, texH: number): THREE.BufferGeometry {
  const [x, y, z, w, h, d] = def.box;
  const inf = def.inflate ?? 0;
  const [u, v] = def.uv;
  const geo = new THREE.BoxGeometry(w + inf * 2, h + inf * 2, d + inf * 2);
  // Minecraft space -> world space: (x, y, z) -> (-x, -y, z); the box spans [x, x+w] etc.
  geo.translate(-(x + w / 2), -(y + h / 2), z + d / 2);
  const uv = geo.getAttribute('uv') as THREE.BufferAttribute;
  const m = def.mirror ?? false;
  const fv = def.flipV ?? false;
  // net: [top][bottom] over [right][front][left][back]; "right" is the mob's right (-x in MC space -> +x here)
  setFace(uv, 0, u, v + d, u + d, v + d + h, texW, texH, 0, m, fv); // px  <- right
  setFace(uv, 1, u + d + w, v + d, u + 2 * d + w, v + d + h, texW, texH, 0, m, fv); // nx  <- left
  setFace(uv, 2, u + d, v, u + d + w, v + d, texW, texH, 2, m, fv); // py  <- top (rotated: the front edge is the lower texture row)
  setFace(uv, 3, u + d + w, v, u + d + 2 * w, v + d, texW, texH, 2, m, fv); // ny  <- bottom
  setFace(uv, 4, u + 2 * d + w, v + d, u + 2 * d + 2 * w, v + d + h, texW, texH, 0, m, fv); // pz  <- back
  setFace(uv, 5, u + d, v + d, u + d + w, v + d + h, texW, texH, 0, m, fv); // nz  <- front
  if (m) {
    // mirrored parts swap left/right nets
    setFace(uv, 0, u + d + w, v + d, u + 2 * d + w, v + d + h, texW, texH, 0, true, fv);
    setFace(uv, 1, u, v + d, u + d, v + d + h, texW, texH, 0, true, fv);
  }
  uv.needsUpdate = true;
  return geo;
}

export function buildModel(def: ModelDef, base: string): BuiltModel {
  const group = new THREE.Group();
  const parts = new Map<string, THREE.Group>();
  const basePose = new Map<string, THREE.Euler>();
  const materials: THREE.MeshBasicMaterial[] = [];
  const layers = new Map<string, THREE.MeshBasicMaterial>();
  const matFor = (tex: string) => {
    const existing = layers.get(tex);
    if (existing) return existing;
    const m = new THREE.MeshBasicMaterial({ map: entityTexture(base, tex), transparent: true, alphaTest: 0.1, side: THREE.DoubleSide });
    materials.push(m);
    layers.set(tex, m);
    return m;
  };
  const mainMat = matFor(def.texture);
  for (const p of def.parts) {
    const g = new THREE.Group();
    g.name = p.name;
    g.position.set(-p.pivot[0], -p.pivot[1], p.pivot[2]);
    if (p.rotation) g.rotation.set(-p.rotation[0], -p.rotation[1], p.rotation[2]);
    basePose.set(p.name, g.rotation.clone());
    const mat = p.texture ? matFor(p.texture) : mainMat;
    for (const b of p.boxes) {
      const mesh = new THREE.Mesh(boxGeometry(b, def.texW, def.texH), mat);
      g.add(mesh);
    }
    g.visible = !p.hidden;
    parts.set(p.name, g);
    const parent = p.parent ? parts.get(p.parent) : undefined;
    if (parent) {
      // child pivots are given in model space; make them relative to the parent's pivot
      g.position.sub(parent.position);
      parent.add(g);
    } else group.add(g);
  }
  // whole model: MC units of 1/16, feet at model y=24 (MC) -> world 0
  group.scale.setScalar(1 / 16);
  group.position.y = 24 / 16;
  const root = new THREE.Group();
  root.add(group);
  return { group: root, parts, materials, basePose, layers };
}
