/** What a world's generator has to offer the worker, whichever dimension it builds. */
import type { ChunkData } from '../chunk.ts';
import type { BlockAccess } from './features.ts';
import type { StructureSpot } from './generator.ts';
import type { StructureSet } from './structures.ts';

export interface TerrainGenerator {
  /** Stone, water and the shape of the land: everything a chunk needs before its neighbours exist. */
  generateTerrain(chunk: ChunkData): void;
  /** What grows on it, once the neighbouring chunks are there to write into. */
  decorate(chunk: ChunkData, world: BlockAccess): void;
  /** Chests, spawners and mobs the last decorate produced. */
  structureSpots: StructureSpot[];
  structures: StructureSet[];
}
