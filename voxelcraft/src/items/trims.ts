/** Armor trim patterns and materials (data/trims.json, generated from the vanilla data pack). */
import trimsJson from '../../data/trims.json';

export interface TrimPattern { id: string; name: string; template: string; decal: boolean }
export interface TrimMaterial { id: string; name: string; item: string; color: string }

const data = trimsJson as { patterns: TrimPattern[]; materials: TrimMaterial[] };
export const trimPatterns: TrimPattern[] = data.patterns;
export const trimMaterials: TrimMaterial[] = data.materials;

const patternById = new Map(trimPatterns.map((p) => [p.id, p]));
const materialById = new Map(trimMaterials.map((m) => [m.id, m]));
const materialByItem = new Map(trimMaterials.map((m) => [m.item, m]));

export const trimPattern = (id: string): TrimPattern | undefined => patternById.get(id);
export const trimMaterial = (id: string): TrimMaterial | undefined => materialById.get(id);
/** The trim material an ingredient item provides (`redstone` → redstone, `lapis_lazuli` → lapis). */
export const trimMaterialForItem = (itemId: string): TrimMaterial | undefined => materialByItem.get(itemId);
