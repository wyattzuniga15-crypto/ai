/** Renders the player model (biped, default skin) into a small canvas for the inventory screen. */
import * as THREE from 'three';
import { buildModel, type BuiltModel, type ModelDef } from '../entities/boxModel.ts';

const SKIN: ModelDef = {
  texture: 'player/wide/steve.png',
  texW: 64,
  texH: 64,
  parts: [
    { name: 'head', pivot: [0, 0, 0], boxes: [{ uv: [0, 0], box: [-4, -8, -4, 8, 8, 8] }, { uv: [32, 0], box: [-4, -8, -4, 8, 8, 8], inflate: 0.5 }] },
    { name: 'body', pivot: [0, 0, 0], boxes: [{ uv: [16, 16], box: [-4, 0, -2, 8, 12, 4] }, { uv: [16, 32], box: [-4, 0, -2, 8, 12, 4], inflate: 0.25 }] },
    { name: 'right_arm', pivot: [-5, 2, 0], boxes: [{ uv: [40, 16], box: [-3, -2, -2, 4, 12, 4] }, { uv: [40, 32], box: [-3, -2, -2, 4, 12, 4], inflate: 0.25 }] },
    { name: 'left_arm', pivot: [5, 2, 0], boxes: [{ uv: [32, 48], box: [-1, -2, -2, 4, 12, 4] }, { uv: [48, 48], box: [-1, -2, -2, 4, 12, 4], inflate: 0.25 }] },
    { name: 'right_leg', pivot: [-1.9, 12, 0], boxes: [{ uv: [0, 16], box: [-2, 0, -2, 4, 12, 4] }, { uv: [0, 32], box: [-2, 0, -2, 4, 12, 4], inflate: 0.25 }] },
    { name: 'left_leg', pivot: [1.9, 12, 0], boxes: [{ uv: [16, 48], box: [-2, 0, -2, 4, 12, 4] }, { uv: [0, 48], box: [-2, 0, -2, 4, 12, 4], inflate: 0.25 }] },
  ],
};

export class PlayerPreview {
  readonly canvas: HTMLCanvasElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly model: BuiltModel;
  private raf = 0;
  private mouse = { x: 0, y: 0 };

  constructor(base: string, width: number, height: number) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = width;
    this.canvas.height = height;
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, alpha: true, antialias: false });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.camera = new THREE.PerspectiveCamera(30, width / height, 0.1, 20);
    this.camera.position.set(0, 1.0, 4.6);
    this.camera.lookAt(0, 1.0, 0);
    this.model = buildModel(SKIN, base);
    for (const m of this.model.materials) m.color.setScalar(1);
    this.scene.add(this.model.group);
    window.addEventListener('mousemove', this.onMove);
    const loop = () => {
      this.render();
      this.raf = requestAnimationFrame(loop);
    };
    loop();
  }

  private readonly onMove = (e: MouseEvent): void => {
    const r = this.canvas.getBoundingClientRect();
    this.mouse = { x: e.clientX - (r.left + r.width / 2), y: e.clientY - (r.top + r.height * 0.25) };
  };

  private render(): void {
    const yaw = Math.atan2(this.mouse.x, 300);
    const pitch = Math.atan2(this.mouse.y, 300);
    this.model.group.rotation.y = Math.PI + yaw * 0.6;
    const head = this.model.parts.get('head');
    if (head) {
      head.rotation.y = -yaw * 0.4;
      head.rotation.x = -pitch * 0.5;
    }
    this.renderer.render(this.scene, this.camera);
  }

  destroy(): void {
    cancelAnimationFrame(this.raf);
    window.removeEventListener('mousemove', this.onMove);
    this.renderer.dispose();
  }
}
