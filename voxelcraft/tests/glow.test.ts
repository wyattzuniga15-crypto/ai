import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { expandGeometry, GlowOutline } from '../src/render/glow.ts';
import type { BuiltModel } from '../src/entities/boxModel.ts';

/** A two-box model on one material, the shape every mob's skin has. */
function fakeModel(): BuiltModel {
  const mat = new THREE.MeshBasicMaterial();
  const group = new THREE.Group();
  const part = new THREE.Group();
  part.add(new THREE.Mesh(new THREE.BoxGeometry(8, 12, 4), mat));
  part.add(new THREE.Mesh(new THREE.BoxGeometry(4, 4, 4), mat));
  group.add(part);
  return { group, parts: new Map([['body', part]]), materials: [mat], basePose: new Map(), layers: new Map() };
}

describe('expandGeometry', () => {
  it('grows a box by the same amount on every face without moving it', () => {
    const geo = new THREE.BoxGeometry(8, 12, 4);
    geo.translate(3, -5, 7);
    const grown = expandGeometry(geo, 0.75);
    geo.computeBoundingBox();
    grown.computeBoundingBox();
    const a = geo.boundingBox!, b = grown.boundingBox!;
    expect(b.min.x).toBeCloseTo(a.min.x - 0.75);
    expect(b.max.x).toBeCloseTo(a.max.x + 0.75);
    expect(b.min.y).toBeCloseTo(a.min.y - 0.75);
    expect(b.max.y).toBeCloseTo(a.max.y + 0.75);
    expect(b.min.z).toBeCloseTo(a.min.z - 0.75);
    expect(b.max.z).toBeCloseTo(a.max.z + 0.75);
    const ca = new THREE.Vector3(), cb = new THREE.Vector3();
    a.getCenter(ca);
    b.getCenter(cb);
    expect(cb.distanceTo(ca)).toBeCloseTo(0);
  });

  it('leaves the source geometry alone', () => {
    const geo = new THREE.BoxGeometry(2, 2, 2);
    const before = Array.from(geo.getAttribute('position').array);
    expandGeometry(geo, 1);
    expect(Array.from(geo.getAttribute('position').array)).toEqual(before);
  });
});

describe('GlowOutline', () => {
  it('adds a stamp and a hull beside every skin mesh, and takes them away again', () => {
    const model = fakeModel();
    const part = model.parts.get('body')!;
    expect(part.children.length).toBe(2);
    const outline = new GlowOutline(model);
    expect(outline.meshCount).toBe(4); // two boxes, stamped and outlined
    expect(part.children.length).toBe(6);
    outline.dispose();
    expect(part.children.length).toBe(2);
    expect(outline.meshCount).toBe(0);
  });

  it('stamps the silhouette before painting the fringe, and neither tests depth', () => {
    const model = fakeModel();
    const outline = new GlowOutline(model);
    const added = model.parts.get('body')!.children.slice(2) as THREE.Mesh[];
    const stamp = added.filter((m) => m.renderOrder === 900);
    const hull = added.filter((m) => m.renderOrder === 901);
    expect(stamp.length).toBe(2);
    expect(hull.length).toBe(2);
    for (const m of [...stamp, ...hull]) {
      const mat = m.material as THREE.MeshBasicMaterial;
      expect(mat.depthTest).toBe(false);
      expect(mat.stencilWrite).toBe(true);
      // both passes run after the model itself, so they must sort with the transparent ones
      expect(mat.transparent).toBe(true);
    }
    const stampMat = stamp[0].material as THREE.MeshBasicMaterial;
    expect(stampMat.colorWrite).toBe(false);
    expect(stampMat.stencilFunc).toBe(THREE.AlwaysStencilFunc);
    expect(stampMat.stencilZPass).toBe(THREE.ReplaceStencilOp);
    const hullMat = hull[0].material as THREE.MeshBasicMaterial;
    expect(hullMat.colorWrite).toBe(true);
    expect(hullMat.stencilFunc).toBe(THREE.NotEqualStencilFunc); // only outside the stamp
    expect(hullMat.stencilZPass).toBe(THREE.KeepStencilOp);
    outline.dispose();
  });

  it('hides and shows without rebuilding', () => {
    const model = fakeModel();
    const outline = new GlowOutline(model);
    const added = model.parts.get('body')!.children.slice(2);
    expect(outline.visible).toBe(true);
    outline.setVisible(false);
    expect(added.every((m) => !m.visible)).toBe(true);
    outline.setVisible(true);
    expect(added.every((m) => m.visible)).toBe(true);
    expect(outline.meshCount).toBe(4);
    outline.dispose();
  });
});
