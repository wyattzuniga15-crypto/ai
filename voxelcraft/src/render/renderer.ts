/** Three.js renderer, camera and per-frame plumbing. */
import * as THREE from 'three';

/**
 * Minecraft does no colour management at all: a texture's bytes are multiplied by the tint and the
 * light level as they stand, and the result goes to the screen unchanged. Three's default is a
 * linear working space, which decodes every texture on the way in and re-encodes on the way out —
 * faithful to physics, but not to Mojang, and it left the terrain shader (which does its own
 * writing, and so never got the encode back) rendering the whole world at about half brightness.
 */
THREE.ColorManagement.enabled = false;

export class GameRenderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly canvas: HTMLCanvasElement;

  constructor(container: HTMLElement, fov = 70) {
    this.canvas = document.createElement('canvas');
    this.canvas.id = 'game-canvas';
    container.appendChild(this.canvas);
    // the stencil buffer is off by default in three; the glowing outline stamps its silhouette there
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: false, powerPreference: 'high-performance', alpha: false, stencil: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.renderer.sortObjects = true;
    this.camera = new THREE.PerspectiveCamera(fov, window.innerWidth / window.innerHeight, 0.05, 1200);
    this.camera.rotation.order = 'YXZ';
    window.addEventListener('resize', () => this.resize());
  }

  resize(): void {
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
  }

  setFov(fov: number): void {
    this.camera.fov = fov;
    this.camera.updateProjectionMatrix();
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }
}
