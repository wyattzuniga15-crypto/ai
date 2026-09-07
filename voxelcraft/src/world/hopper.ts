/**
 * Hoppers. Vanilla moves one item every eight ticks: out into whatever the hopper faces first, then
 * in from whatever sits above it. Furnaces take their items by side (input from above, fuel from
 * the side, the finished item out of the bottom), and a composter takes compostables in and gives
 * bone meal back, which is what makes a hopper worth pointing at one.
 */
import { blocks } from '../blocks/registry.ts';
import { CONTAINER_SIZES, containerKind, createBlockEntity, type BlockEntity, type ContainerEntity, type FurnaceEntity } from '../blocks/blockEntity.ts';
import { compost, composterLevel, composterState, isCompostable } from '../blocks/composter.ts';
import { isFuel } from '../items/smelting.ts';
import { items } from '../items/registry.ts';
import type { Slot } from '../items/inventory.ts';

export interface HopperWorld {
  getBlock(x: number, y: number, z: number): number;
  setBlock(x: number, y: number, z: number, state: number): void;
  getBlockEntity(x: number, y: number, z: number): BlockEntity | null;
  setBlockEntity(x: number, y: number, z: number, e: BlockEntity): void;
  markModified(x: number, z: number): void;
  random(): number;
}

/** Ticks a hopper waits between moves, as vanilla times it. */
export const HOPPER_COOLDOWN = 8;

/** 1 for every hopper state, so a chunk can be swept for them as quickly as it is for chests. */
export const hopperStates: Uint8Array = (() => {
  const table = new Uint8Array(blocks.maxState + 1);
  const def = blocks.byId.get('hopper');
  if (def) for (let s = def.min; s <= def.max; s++) table[s] = 1;
  return table;
})();

const FACING: Record<string, [number, number, number]> = {
  down: [0, -1, 0], north: [0, 0, -1], south: [0, 0, 1], west: [-1, 0, 0], east: [1, 0, 0], up: [0, 1, 0],
};

const idOf = (state: number) => (state === 0 ? 'air' : blocks.blockOf(state).id);

const FURNACES = new Set(['furnace', 'blast_furnace', 'smoker']);

/** The container at a position, making its block entity if the block has one and it is missing. */
export function containerAt(w: HopperWorld, x: number, y: number, z: number): { entity: ContainerEntity | FurnaceEntity; kind: string } | null {
  const state = w.getBlock(x, y, z);
  if (state === 0) return null;
  const id = blocks.blockOf(state).id;
  const kind = FURNACES.has(id) ? id : containerKind(id);
  if (!kind) return null;
  let entity = w.getBlockEntity(x, y, z) as ContainerEntity | FurnaceEntity | null;
  if (!entity) {
    entity = createBlockEntity(id) as ContainerEntity | FurnaceEntity | null;
    if (!entity) return null;
    w.setBlockEntity(x, y, z, entity);
  }
  return { entity, kind };
}

/** Whether a slot of a container will take an item coming in from a direction, vanilla's rules. */
function accepts(kind: string, slot: number, stack: Slot, from: string): boolean {
  if (!stack) return false;
  if (FURNACES.has(kind)) {
    if (from === 'up') return slot === 0;
    if (from === 'down') return slot === 2 && stack.id === 'bucket';
    return slot === 1 && isFuel(stack);
  }
  if (kind === 'shulker_box') return !stack.id.endsWith('shulker_box');
  return true;
}

/** Which slots a hopper may take from: a furnace only lets go of what it has finished. */
function takeable(kind: string, slot: number): boolean {
  if (FURNACES.has(kind)) return slot === 2;
  return true;
}

/** Puts one item into a container, merging where it can. Returns true when it went in. */
export function insertOne(target: { entity: ContainerEntity | FurnaceEntity; kind: string }, stack: { id: string; count: number; damage?: number }, from: string): boolean {
  const size = FURNACES.has(target.kind) ? 3 : CONTAINER_SIZES[target.kind] ?? target.entity.items.length;
  const max = items.maxStack(stack.id);
  const one = { ...stack, count: 1 };
  for (let i = 0; i < size; i++) {
    const slot = target.entity.items[i];
    if (!slot || slot.id !== stack.id || slot.count >= max || slot.damage !== stack.damage) continue;
    if (!accepts(target.kind, i, one, from)) continue;
    slot.count++;
    return true;
  }
  for (let i = 0; i < size; i++) {
    if (target.entity.items[i]) continue;
    if (!accepts(target.kind, i, one, from)) continue;
    target.entity.items[i] = one;
    return true;
  }
  return false;
}

/** The direction an item arriving from `facing` is coming from, which is what vanilla asks. */
const OPPOSITE: Record<string, string> = { down: 'up', up: 'down', north: 'south', south: 'north', west: 'east', east: 'west' };

/** Moves one item out of a hopper into whatever it faces. */
function pushOut(w: HopperWorld, x: number, y: number, z: number, hopper: ContainerEntity, facing: string): boolean {
  const [dx, dy, dz] = FACING[facing] ?? FACING.down;
  const tx = x + dx;
  const ty = y + dy;
  const tz = z + dz;
  const from = OPPOSITE[facing] ?? 'up';
  const slot = hopper.items.findIndex((s) => s && s.count > 0);
  if (slot < 0) return false;
  const stack = hopper.items[slot]!;
  // a composter in front takes what can be composted, on the same odds a hand would
  if (idOf(w.getBlock(tx, ty, tz)) === 'composter') {
    if (!isCompostable(stack.id)) return false;
    const state = w.getBlock(tx, ty, tz);
    const result = compost(state, stack.id, w.random());
    if (!result) return false;
    if (result.filled) w.setBlock(tx, ty, tz, result.state);
    if (--stack.count <= 0) hopper.items[slot] = null;
    return true;
  }
  const target = containerAt(w, tx, ty, tz);
  if (!target) return false;
  if (!insertOne(target, stack, from)) return false;
  if (--stack.count <= 0) hopper.items[slot] = null;
  w.markModified(tx, tz);
  return true;
}

/** Takes one item from whatever is above the hopper. */
function pullIn(w: HopperWorld, x: number, y: number, z: number, hopper: ContainerEntity): boolean {
  const above = w.getBlock(x, y + 1, z);
  // a ready composter hands its bone meal down
  if (idOf(above) === 'composter' && composterLevel(above) >= 8) {
    if (!insertOne({ entity: hopper, kind: 'hopper' }, { id: 'bone_meal', count: 1 }, 'up')) return false;
    w.setBlock(x, y + 1, z, composterState(0));
    return true;
  }
  const source = containerAt(w, x, y + 1, z);
  if (!source) return false;
  for (let i = 0; i < source.entity.items.length; i++) {
    const stack = source.entity.items[i];
    if (!stack || stack.count <= 0 || !takeable(source.kind, i)) continue;
    if (!insertOne({ entity: hopper, kind: 'hopper' }, stack, 'up')) continue;
    if (--stack.count <= 0) source.entity.items[i] = null;
    w.markModified(x, z);
    return true;
  }
  return false;
}

/**
 * One hopper tick: nothing happens while it is on cooldown or held by a signal, and a move sets the
 * cooldown again. Returns true when something moved.
 */
export function tickHopper(w: HopperWorld, x: number, y: number, z: number, entity: ContainerEntity, powered: boolean): boolean {
  const state = w.getBlock(x, y, z);
  if (idOf(state) !== 'hopper') return false;
  if (entity.cooldown && entity.cooldown > 0) {
    entity.cooldown--;
    return false;
  }
  if (powered) return false;
  const facing = blocks.prop(state, 'facing') ?? 'down';
  let moved = pushOut(w, x, y, z, entity, facing);
  if (pullIn(w, x, y, z, entity)) moved = true;
  if (moved) {
    entity.cooldown = HOPPER_COOLDOWN;
    w.markModified(x, z);
  }
  return moved;
}
