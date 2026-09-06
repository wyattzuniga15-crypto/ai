/** Biome registry built from data/biomes.json (vanilla ids, colours and the generator's surface config). */
import biomesJson from '../../data/biomes.json';

export interface BiomeSurface {
  top: string;
  filler: string;
  underwater?: string;
  trees?: [string, number][];
  grassDensity?: number;
  flowers?: string[];
  extra?: string[];
  snow?: boolean;
}

export interface BiomeDef {
  id: string;
  name: string;
  num: number;
  category: string;
  dimension: string;
  temperature: number;
  precipitation: 'none' | 'rain' | 'snow';
  color: number;
  grassColor?: number;
  foliageColor?: number;
  waterColor?: number;
  waterFogColor?: number;
  skyColor?: number;
  fogColor?: number;
  downfall?: number;
  surface: BiomeSurface;
}

export const biomes: BiomeDef[] = biomesJson as BiomeDef[];
const byId = new Map(biomes.map((b, i) => [b.id, i]));

export function biomeIndex(id: string): number {
  const i = byId.get(id);
  if (i === undefined) throw new Error(`unknown biome ${id}`);
  return i;
}

export function biomeById(id: string): BiomeDef {
  return biomes[biomeIndex(id)];
}

export const DEFAULT_GRASS = 0x91bd59;
export const DEFAULT_FOLIAGE = 0x77ab2f;
export const DEFAULT_WATER = 0x3f76e4;
