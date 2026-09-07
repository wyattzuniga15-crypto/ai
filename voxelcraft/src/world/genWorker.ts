/**
 * Terrain generation worker. A small pool of these feeds the world worker with raw terrain over
 * a MessagePort so generation (the slowest pipeline step) runs in parallel; the world worker
 * keeps ownership of the chunks and does decoration, lighting and meshing.
 */
import { ChunkData } from './chunk.ts';
import { buildStructureSets } from './gen/structures.ts';
import { WorldGenerator } from './gen/generator.ts';
import { NetherGenerator } from './gen/nether.ts';
import { EndGenerator } from './gen/end.ts';
import type { TerrainGenerator } from './gen/terrain.ts';
import type { GenInit, GenRequest, GenResult } from './protocol.ts';

const ctx = self as unknown as Worker;
let gen: TerrainGenerator | null = null;
let port: MessagePort | null = null;

function generate(msg: GenRequest): void {
  if (!gen || !port) return;
  const c = new ChunkData(msg.cx, msg.cz);
  gen.generateTerrain(c);
  const result: GenResult = { type: 'terrain', cx: msg.cx, cz: msg.cz, blocks: c.blocks, biomes: c.biomes, heightmap: c.heightmap };
  port.postMessage(result, [c.blocks.buffer, c.biomes.buffer, c.heightmap.buffer]);
}

ctx.onmessage = (ev: MessageEvent<GenInit>) => {
  const msg = ev.data;
  if (msg.type !== 'init') return;
  gen = msg.dimension === 'nether' ? new NetherGenerator(msg.seed) : msg.dimension === 'end' ? new EndGenerator(msg.seed) : new WorldGenerator(msg.seed);
  if (msg.structures) gen.structures = buildStructureSets(msg.structures.index, msg.structures.templates, msg.structures.pools);
  port = msg.port;
  port.onmessage = (e: MessageEvent<GenRequest>) => {
    if (e.data.type === 'gen') generate(e.data);
  };
};
