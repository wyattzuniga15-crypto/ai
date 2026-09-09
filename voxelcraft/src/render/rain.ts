/**
 * Rain and snow. Vanilla draws a cylinder of falling streaks around whoever is standing in the
 * weather, skipping the columns that have something over them; this is the same, as instanced
 * quads that fall, wrap round and take the snow texture in the cold.
 */
import * as THREE from 'three';

const DROPS = 700;
const RADIUS = 14;
const TOP = 12;
const BOTTOM = -8;

export class RainRenderer {
  private readonly mesh: THREE.InstancedMesh;
  private readonly rainTexture: THREE.Texture;
  private readonly snowTexture: THREE.Texture;
  private readonly x = new Float32Array(DROPS);
  private readonly y = new Float32Array(DROPS);
  private readonly z = new Float32Array(DROPS);
  private readonly speed = new Float32Array(DROPS);
  /** The height of the ground under each drop, so it lands rather than falling through the world. */
  private readonly ground = new Float32Array(DROPS);
  private readonly dummy = new THREE.Object3D();
  private snowing = false;

  constructor(scene: THREE.Scene, base: string) {
    const loader = new THREE.TextureLoader();
    const prepare = (t: THREE.Texture): THREE.Texture => {
      t.magFilter = THREE.NearestFilter;
      t.minFilter = THREE.NearestFilter;
      t.colorSpace = THREE.NoColorSpace;
      t.wrapS = THREE.RepeatWrapping;
      t.wrapT = THREE.RepeatWrapping;
      return t;
    };
    this.rainTexture = prepare(loader.load(`${base}textures/environment/rain.png`));
    this.snowTexture = prepare(loader.load(`${base}textures/environment/snow.png`));
    const material = new THREE.MeshBasicMaterial({ map: this.rainTexture, transparent: true, opacity: 0.6, depthWrite: false, side: THREE.DoubleSide, fog: false });
    this.mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.4, 2.4), material, DROPS);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.mesh.renderOrder = 4;
    scene.add(this.mesh);
    for (let i = 0; i < DROPS; i++) this.reset(i, 0, 0, 0, () => BOTTOM);
  }

  /** Puts one drop back at the top of the column, over whatever ground is under it. */
  private reset(i: number, cx: number, cy: number, cz: number, groundAt: (x: number, z: number) => number): void {
    const angle = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * RADIUS;
    this.x[i] = cx + Math.cos(angle) * r;
    this.z[i] = cz + Math.sin(angle) * r;
    this.y[i] = cy + TOP * (0.5 + Math.random() * 0.5);
    this.speed[i] = this.snowing ? 0.06 + Math.random() * 0.03 : 0.55 + Math.random() * 0.25;
    this.ground[i] = groundAt(this.x[i], this.z[i]);
  }

  /**
   * Moves every drop down a frame. `level` is how hard it is coming down, 0 to 1; nothing is drawn
   * when it is dry, and `snow` swaps the texture for the cold biomes.
   */
  update(camera: THREE.Vector3, level: number, snow: boolean, groundAt: (x: number, z: number) => number, dt: number): void {
    if (level <= 0.01) {
      this.mesh.visible = false;
      return;
    }
    this.mesh.visible = true;
    const material = this.mesh.material as THREE.MeshBasicMaterial;
    const wanted = snow ? this.snowTexture : this.rainTexture;
    if (this.snowing !== snow) {
      this.snowing = snow;
      material.map = wanted;
      material.needsUpdate = true;
    }
    material.opacity = 0.35 + level * 0.4;
    const count = Math.max(1, Math.floor(DROPS * level));
    for (let i = 0; i < DROPS; i++) {
      if (i >= count) {
        this.dummy.position.set(0, -1000, 0);
        this.dummy.scale.setScalar(0);
        this.dummy.updateMatrix();
        this.mesh.setMatrixAt(i, this.dummy.matrix);
        continue;
      }
      this.y[i] -= this.speed[i] * dt * 60;
      const tooFar = Math.abs(this.x[i] - camera.x) > RADIUS + 4 || Math.abs(this.z[i] - camera.z) > RADIUS + 4;
      if (this.y[i] < Math.max(camera.y + BOTTOM, this.ground[i]) || tooFar) this.reset(i, camera.x, camera.y, camera.z, groundAt);
      this.dummy.position.set(this.x[i], this.y[i], this.z[i]);
      this.dummy.scale.set(1, snow ? 0.35 : 1, 1);
      // the streaks always face the player, which is how vanilla billboards them
      this.dummy.rotation.set(0, Math.atan2(camera.x - this.x[i], camera.z - this.z[i]), 0);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.mesh.removeFromParent();
  }
}
