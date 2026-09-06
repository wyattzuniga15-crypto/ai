/** Messages between the main thread and the world worker. */
import type { ModelsJson } from './models.ts';
import type { AtlasJson } from '../render/atlasIndex.ts';
import type { MeshBuffers } from './mesher.ts';

export interface InitMessage { type: 'init'; seed: number; models: ModelsJson; atlas: AtlasJson }
export interface ViewMessage { type: 'view'; cx: number; cz: number; distance: number }
export interface ChunkSourceMessage { type: 'chunkSource'; cx: number; cz: number; blocks: Uint16Array | null; biomes: Uint8Array | null }
export interface SetBlockMessage { type: 'setBlock'; x: number; y: number; z: number; state: number }
export interface SetBlocksMessage { type: 'setBlocks'; edits: Int32Array }
export interface RemeshMessage { type: 'remeshAll' }
export type ToWorker = InitMessage | ViewMessage | ChunkSourceMessage | SetBlockMessage | SetBlocksMessage | RemeshMessage;

export interface ChunkMessage { type: 'chunk'; cx: number; cz: number; blocks: Uint16Array; biomes: Uint8Array; light: Uint8Array }
export interface MeshMessage { type: 'mesh'; cx: number; sy: number; cz: number; solid: MeshBuffers | null; translucent: MeshBuffers | null }
export interface UnloadMessage { type: 'unload'; cx: number; cz: number }
export interface NeedChunkMessage { type: 'needChunk'; keys: [number, number][] }
/** Block writes made by world generation into chunks the main thread already holds (local x,y,z,state). */
export interface PatchMessage { type: 'patch'; cx: number; cz: number; edits: Int32Array }
export interface LightMessage { type: 'light'; cx: number; cz: number; light: Uint8Array }
export interface ReadyMessage { type: 'ready' }
export interface StatsMessage { type: 'stats'; chunks: number; pending: number; meshed: number }
export type FromWorker = ChunkMessage | MeshMessage | UnloadMessage | NeedChunkMessage | PatchMessage | LightMessage | ReadyMessage | StatsMessage;

export const packKey = (cx: number, cz: number): number => (cx + 32768) * 65536 + (cz + 32768);
export const unpackKey = (k: number): [number, number] => [Math.floor(k / 65536) - 32768, (k % 65536) - 32768];
