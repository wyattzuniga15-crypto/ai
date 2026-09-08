/** World and simulation constants shared by the main thread and the world worker. */
export const CHUNK_SIZE = 16;
export const WORLD_MIN_Y = -64;
export const WORLD_MAX_Y = 319;
export const WORLD_HEIGHT = 384;
export const SECTION_COUNT = WORLD_HEIGHT / CHUNK_SIZE; // 24
export const SEA_LEVEL = 63;

export const TICKS_PER_SECOND = 20;
export const TICK_MS = 1000 / TICKS_PER_SECOND;
/** Length of a full day/night cycle in ticks (20 real minutes). */
export const DAY_LENGTH = 24000;

export const PLAYER_WIDTH = 0.6;
export const PLAYER_HEIGHT = 1.8;
export const PLAYER_EYE_HEIGHT = 1.62;
export const PLAYER_SNEAK_HEIGHT = 1.5;
export const PLAYER_SNEAK_EYE_HEIGHT = 1.27;
export const BLOCK_REACH = 4.5;
/** How far a swing reaches, and how much further a spear does (Mojang's own piercing reach). */
export const MELEE_REACH = 3;
export const SPEAR_REACH = 4.5;

export const DEFAULT_RENDER_DISTANCE = 8;
export const MC_VERSION = '1.21.11';
