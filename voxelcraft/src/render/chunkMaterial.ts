/** Shader material for chunk geometry: tile-table atlas lookup, vanilla light curve, fog. */
import * as THREE from 'three';
import type { LoadedAtlas } from './atlas.ts';

export interface ChunkUniforms {
  atlas: { value: THREE.Texture };
  tileTable: { value: THREE.Texture };
  tileCount: { value: number };
  dayLight: { value: number };
  ambient: { value: number };
  fogColor: { value: THREE.Color };
  fogNear: { value: number };
  fogFar: { value: number };
  alphaTest: { value: number };
  gamma: { value: number };
}

const vertexShader = /* glsl */ `
attribute float tile;
attribute vec4 color;
attribute vec2 light;
uniform sampler2D tileTable;
uniform float tileCount;
uniform float dayLight;
uniform float ambient;
uniform float gamma;
varying vec2 vUv;
varying vec4 vRect;
varying vec3 vColor;
varying float vFogDepth;

float curve(float lvl) {
  float b = lvl / (4.0 - 3.0 * lvl);
  return b * (1.0 - ambient) + ambient;
}

void main() {
  vRect = texture2D(tileTable, vec2((tile + 0.5) / tileCount, 0.5));
  vUv = uv;
  float sky = light.x / 15.0;
  float blk = light.y / 15.0;
  float skyB = curve(sky) * dayLight;
  float blkB = curve(blk);
  float bright = max(skyB, blkB);
  // "moody" -> "bright" gamma option like vanilla: lift the dark end
  bright = mix(bright, 1.0 - pow(1.0 - bright, 2.0), gamma * 0.6);
  vec3 lightColor = vec3(bright);
  // warm tint where torch light dominates
  float warm = clamp(blkB - skyB, 0.0, 1.0);
  lightColor *= mix(vec3(1.0), vec3(1.0, 0.94, 0.85), warm);
  vColor = color.rgb * color.a * lightColor;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vFogDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
}
`;

const fragmentShader = /* glsl */ `
uniform sampler2D atlas;
uniform vec3 fogColor;
uniform float fogNear;
uniform float fogFar;
uniform float alphaTest;
varying vec2 vUv;
varying vec4 vRect;
varying vec3 vColor;
varying float vFogDepth;

void main() {
  // greedy-merged quads carry uv in block units and repeat the tile; the gradients of the
  // unwrapped uv keep mip selection continuous across the repeats
  vec2 uv = vRect.xy + fract(vUv) * vRect.zw;
  vec4 tex = textureGrad(atlas, uv, dFdx(vUv) * vRect.zw, dFdy(vUv) * vRect.zw);
  if (tex.a < alphaTest) discard;
  vec3 c = tex.rgb * vColor;
  float f = smoothstep(fogNear, fogFar, vFogDepth);
  gl_FragColor = vec4(mix(c, fogColor, f), tex.a);
}
`;

export function createChunkMaterials(atlas: LoadedAtlas): { solid: THREE.ShaderMaterial; translucent: THREE.ShaderMaterial; uniforms: ChunkUniforms } {
  const uniforms: ChunkUniforms = {
    atlas: { value: atlas.texture },
    tileTable: { value: atlas.tileTable },
    tileCount: { value: atlas.tileCount },
    dayLight: { value: 1 },
    ambient: { value: 0.0 },
    fogColor: { value: new THREE.Color(0xc0d8ff) },
    fogNear: { value: 80 },
    fogFar: { value: 128 },
    alphaTest: { value: 0.1 },
    gamma: { value: 0.0 },
  };
  const solid = new THREE.ShaderMaterial({
    uniforms: uniforms as unknown as Record<string, THREE.IUniform>,
    vertexShader,
    fragmentShader,
    side: THREE.FrontSide,
  });
  const translucent = new THREE.ShaderMaterial({
    uniforms: { ...uniforms, alphaTest: { value: 0.0 } } as unknown as Record<string, THREE.IUniform>,
    vertexShader,
    fragmentShader,
    side: THREE.FrontSide,
    transparent: true,
    depthWrite: true,
  });
  return { solid, translucent, uniforms };
}
