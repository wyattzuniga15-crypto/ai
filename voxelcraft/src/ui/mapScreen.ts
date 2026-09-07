/**
 * The map view. Vanilla draws a held map in the hand; with no hand to draw it in, the map opens as a
 * page of its own, with the same square of colours and a marker for whoever is holding it.
 */
import { h, button } from './dom.ts';
import { MAP_SIZE, blocksPerPixel, pixelFor, type MapData } from '../world/maps.ts';

/** Draws a map's colours onto a canvas, at `zoom` screen pixels per map pixel. */
export function drawMap(map: MapData, zoom: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = MAP_SIZE;
  canvas.height = MAP_SIZE;
  const g = canvas.getContext('2d')!;
  const img = g.createImageData(MAP_SIZE, MAP_SIZE);
  for (let i = 0; i < MAP_SIZE * MAP_SIZE; i++) {
    const c = map.colors[i];
    if (c < 0) {
      // unexplored ground is the parchment vanilla leaves behind
      img.data[i * 4] = 0xd0;
      img.data[i * 4 + 1] = 0xbe;
      img.data[i * 4 + 2] = 0x92;
      img.data[i * 4 + 3] = 255;
      continue;
    }
    img.data[i * 4] = (c >> 16) & 255;
    img.data[i * 4 + 1] = (c >> 8) & 255;
    img.data[i * 4 + 2] = c & 255;
    img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  canvas.style.cssText = `width:${MAP_SIZE * zoom}px;height:${MAP_SIZE * zoom}px;image-rendering:pixelated;border:${Math.max(2, zoom)}px solid #d0be92;background:#d0be92;`;
  return canvas;
}

/** Opens the map, with the holder's marker on it and its scale written underneath. */
export function openMapScreen(container: HTMLElement, map: MapData, at: { x: number; z: number; yaw: number }, onClose: () => void): () => void {
  const zoom = 3;
  const canvas = drawMap(map, zoom);
  const wrap = h('div');
  wrap.style.cssText = 'position:relative;';
  wrap.append(canvas);
  const pixel = pixelFor(map, at.x, at.z);
  if (pixel) {
    const marker = h('div');
    const border = Math.max(2, zoom);
    marker.style.cssText = `position:absolute;left:${border + pixel.px * zoom - 6}px;top:${border + pixel.pz * zoom - 6}px;width:12px;height:12px;`;
    marker.textContent = '➤';
    marker.style.color = '#fff';
    marker.style.font = '12px sans-serif';
    marker.style.textShadow = '0 0 2px #000';
    marker.style.transform = `rotate(${at.yaw + Math.PI / 2}rad)`;
    wrap.append(marker);
  }
  const scaleLabel = h('div', { text: `Scale 1:${blocksPerPixel(map.scale)}${map.locked ? ' · locked' : ''}` });
  scaleLabel.style.cssText = 'margin-top:8px;font-size:14px;text-shadow:2px 2px #3f3f3f;';
  const root = h('div', { class: 'screen' }, h('h2', { text: `Map #${map.id}` }), wrap, scaleLabel, button('Close', () => finish(), 'tiny'));
  root.addEventListener('mousedown', (e) => e.stopPropagation());
  container.append(root);
  let finished = false;
  const finish = (): void => {
    if (finished) return;
    finished = true;
    root.remove();
    onClose();
  };
  return finish;
}
