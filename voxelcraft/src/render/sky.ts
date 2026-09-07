/** Day/night sky: background and fog colours, sun and moon sprites, light factor for the shader. */
import * as THREE from 'three';
import { DAY_LENGTH } from '../core/constants.ts';

const DAY_SKY = new THREE.Color(0x78a7ff);
const NIGHT_SKY = new THREE.Color(0x02040c);
const DAY_FOG = new THREE.Color(0xc0d8ff);
const NIGHT_FOG = new THREE.Color(0x03050f);
const SUNSET = new THREE.Color(0xffa040);
/** What the sky and fog fade toward while it is raining. */
const STORM_SKY = new THREE.Color(0x4c5566);
const STORM_FOG = new THREE.Color(0x6b7280);
const MOON_FILES = ['first_quarter.png', 'full_moon.png', 'new_moon.png', 'third_quarter.png', 'waning_crescent.png', 'waning_gibbous.png', 'waxing_crescent.png', 'waxing_gibbous.png'];

export class Sky {
  readonly group = new THREE.Group();
  private readonly sun: THREE.Mesh;
  private readonly moon: THREE.Mesh;
  private readonly moonTex: THREE.Texture;
  private readonly moonPhases: THREE.Texture[];
  readonly skyColor = new THREE.Color();
  readonly fogColor = new THREE.Color();
  /** 0..1 factor applied to sky light. */
  dayLight = 1;
  /** The same, before the weather takes its share, so block light is not dimmed twice. */
  dayLightClear = 1;
  /** Sun elevation in [-1, 1]. */
  elevation = 1;

  constructor(base: string) {
    const loader = new THREE.TextureLoader();
    const sunTex = loader.load(`${base}textures/environment/celestial/sun.png`);
    sunTex.magFilter = THREE.NearestFilter;
    sunTex.colorSpace = THREE.SRGBColorSpace;
    this.moonTex = loader.load(`${base}textures/environment/celestial/moon/${MOON_FILES[0]}`);
    this.moonPhases = MOON_FILES.map((f) => { const t = loader.load(`${base}textures/environment/celestial/moon/${f}`); t.magFilter = THREE.NearestFilter; t.colorSpace = THREE.SRGBColorSpace; return t; });
    this.moonTex.magFilter = THREE.NearestFilter;
    this.moonTex.colorSpace = THREE.SRGBColorSpace;
    this.sun = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.MeshBasicMaterial({ map: sunTex, transparent: true, depthWrite: false, depthTest: true, fog: false, blending: THREE.AdditiveBlending }));
    this.moon = new THREE.Mesh(new THREE.PlaneGeometry(50, 50), new THREE.MeshBasicMaterial({ map: this.moonTex, transparent: true, depthWrite: false, depthTest: true, fog: false, blending: THREE.AdditiveBlending }));
    this.sun.renderOrder = -10;
    this.moon.renderOrder = -10;
    this.group.add(this.sun, this.moon);
    this.group.frustumCulled = false;
  }

  /** @param time world time in ticks; @param rain how hard it is coming down, 0 to 1. */
  update(time: number, cameraPos: THREE.Vector3, rain = 0): void {
    const f = ((time % DAY_LENGTH) + DAY_LENGTH) % DAY_LENGTH / DAY_LENGTH; // 0 = 6:00
    const angle = f * Math.PI * 2; // sun angle: 0 at sunrise (east), pi/2 at noon
    const elev = Math.sin(angle);
    this.elevation = elev;
    const t = THREE.MathUtils.clamp(elev * 2.2 + 0.25, 0, 1);
    this.dayLight = 0.27 + 0.73 * THREE.MathUtils.smoothstep(t, 0, 1);
    this.dayLightClear = this.dayLight;
    this.skyColor.copy(NIGHT_SKY).lerp(DAY_SKY, t);
    this.fogColor.copy(NIGHT_FOG).lerp(DAY_FOG, t);
    // sunset / sunrise glow
    const glow = Math.max(0, 1 - Math.abs(elev) * 5) * 0.6;
    this.fogColor.lerp(SUNSET, glow);
    const dist = 400;
    const dirX = Math.cos(angle);
    const dirY = Math.sin(angle);
    this.sun.position.set(cameraPos.x - dirX * dist, cameraPos.y + dirY * dist, cameraPos.z);
    this.sun.lookAt(cameraPos);
    this.moon.position.set(cameraPos.x + dirX * dist, cameraPos.y - dirY * dist, cameraPos.z);
    this.moon.lookAt(cameraPos);
    // rain greys the sky over and dims the day, which is what makes a storm feel like one
    if (rain > 0) {
      this.skyColor.lerp(STORM_SKY, rain * 0.85);
      this.fogColor.lerp(STORM_FOG, rain * 0.85);
      this.dayLight *= 1 - rain * 0.32;
      const sunMat = this.sun.material as THREE.MeshBasicMaterial;
      sunMat.opacity = 1 - rain;
      sunMat.transparent = true;
      const moonMat = this.moon.material as THREE.MeshBasicMaterial;
      moonMat.opacity = 1 - rain;
    } else {
      (this.sun.material as THREE.MeshBasicMaterial).opacity = 1;
      (this.moon.material as THREE.MeshBasicMaterial).opacity = 1;
    }
    const phase = Math.floor(time / DAY_LENGTH) % this.moonPhases.length;
    const mat = this.moon.material as THREE.MeshBasicMaterial;
    if (mat.map !== this.moonPhases[phase]) { mat.map = this.moonPhases[phase]; mat.needsUpdate = true; }
    this.group.position.set(0, 0, 0);
  }
}
