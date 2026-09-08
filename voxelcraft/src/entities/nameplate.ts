/**
 * The plate a named mob wears over its head, and the line a lead draws between one and whoever is
 * holding it. Both are drawn the way vanilla draws them: the name always turned to the camera, the
 * lead a thin cord that sags between its two ends.
 */
import * as THREE from 'three';

/** How far over a mob's head vanilla hangs its name. */
export const NAME_PLATE_LIFT = 0.5;
/** How tall a name plate is drawn in the world, and how far off it stops being drawn. */
export const NAME_PLATE_HEIGHT = 0.28;
export const NAME_PLATE_RANGE = 24;

/** How far a lead can stretch before it snaps, and where it starts pulling the mob along. */
export const LEASH_BREAK = 10;
export const LEASH_PULL = 6;
/** How hard the lead pulls, and how far the cord sags in the middle. */
export const LEASH_FORCE = 0.02;
export const LEASH_SAG = 0.4;
/** The lead's own colour, which vanilla ties from brown string. */
export const LEASH_COLOR = 0x6b4d2e;

/** The name that turns a sheep into vanilla's rainbow, and how fast the colours run through it. */
export const JEB_NAME = 'jeb_';
export const JEB_PERIOD = 25;

/** The colour a jeb_ sheep is wearing at this moment, blended between the sixteen dyes. */
export function jebColor(age: number, dyes: number[] = JEB_DYES): number {
  const span = dyes.length * JEB_PERIOD;
  const t = ((age % span) + span) % span;
  const i = Math.floor(t / JEB_PERIOD);
  const f = (t % JEB_PERIOD) / JEB_PERIOD;
  const a = dyes[i];
  const b = dyes[(i + 1) % dyes.length];
  const mix = (shift: number) => Math.round(((a >> shift) & 255) * (1 - f) + ((b >> shift) & 255) * f);
  return (mix(16) << 16) | (mix(8) << 8) | mix(0);
}

/** The sixteen dyes, in the order vanilla runs them. */
const JEB_DYES = [
  0xf9fffe, 0xf9801d, 0xc74ebd, 0x3ab3da, 0xfed83d, 0x80c71f, 0xf38baa, 0x474f52,
  0x9d9d97, 0x169c9c, 0x8932b8, 0x3c44aa, 0x835432, 0x5e7c16, 0xb02e26, 0x1d1d21,
];

/** Paints a name onto a canvas and hands back the sprite that carries it. */
export function namePlate(name: string): THREE.Sprite | null {
  if (typeof document === 'undefined') return null;
  const text = name.slice(0, 32);
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const font = 'bold 32px sans-serif';
  ctx.font = font;
  const width = Math.ceil(ctx.measureText(text).width) + 16;
  canvas.width = Math.max(32, width);
  canvas.height = 48;
  const g = canvas.getContext('2d')!;
  g.font = font;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  // vanilla paints the name on a dark plate rather than straight onto the world
  g.fillStyle = 'rgba(0, 0, 0, 0.25)';
  g.fillRect(0, 6, canvas.width, 36);
  g.fillStyle = '#fff';
  g.fillText(text, canvas.width / 2, 24);
  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false }));
  sprite.scale.set((NAME_PLATE_HEIGHT * canvas.width) / canvas.height, NAME_PLATE_HEIGHT, 1);
  sprite.renderOrder = 10;
  return sprite;
}

/** The cord itself: a line of segments that hangs between two points. */
export class LeashLine {
  readonly line: THREE.Line;
  private readonly positions: Float32Array;

  constructor(readonly segments = 12) {
    this.positions = new Float32Array((segments + 1) * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: LEASH_COLOR }));
    this.line.frustumCulled = false;
  }

  /** Strings the cord between two points, letting it sag in the middle as a real one would. */
  update(from: THREE.Vector3, to: THREE.Vector3): void {
    const sag = LEASH_SAG * from.distanceTo(to) * 0.1;
    for (let i = 0; i <= this.segments; i++) {
      const t = i / this.segments;
      const drop = Math.sin(t * Math.PI) * sag;
      this.positions[i * 3] = from.x + (to.x - from.x) * t;
      this.positions[i * 3 + 1] = from.y + (to.y - from.y) * t - drop;
      this.positions[i * 3 + 2] = from.z + (to.z - from.z) * t;
    }
    this.line.geometry.attributes.position.needsUpdate = true;
    this.line.geometry.computeBoundingSphere();
  }

  dispose(): void {
    this.line.geometry.dispose();
    (this.line.material as THREE.Material).dispose();
  }
}
