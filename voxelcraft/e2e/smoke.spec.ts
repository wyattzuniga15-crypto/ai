import { expect, test, type Page } from '@playwright/test';

interface Voxel {
  game: {
    state: string;
    player: { pos: { x: number; y: number; z: number }; pitch: number; yaw: number; gamemode: string; inventory: { slots: ({ id: string; count: number } | null)[]; selected: number }; onGround: boolean };
    world: { getBlock(x: number, y: number, z: number): number; chunks: Map<string, unknown> };
    input: { locked: boolean };
    time: number;
  };
  blocks: { idOf(state: number): string; defaultState(id: string): number };
}

declare global {
  interface Window { voxelcraft: Voxel }
}

async function startWorld(page: Page, seed: string) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  // the software renderer in headless Chromium cannot keep up with 8 chunks; 3 is plenty for the test
  await page.addInitScript(() => localStorage.setItem('voxelcraft.options', JSON.stringify({ renderDistance: 3, guiScale: 2 })));
  await page.goto('/');
  await page.getByRole('button', { name: 'Singleplayer' }).click({ timeout: 60_000 });
  await page.getByRole('button', { name: 'Create New World' }).click();
  await page.locator('.field input').nth(1).fill(seed);
  await page.getByRole('button', { name: 'Create New World' }).click();
  await page.waitForFunction(() => window.voxelcraft?.game?.state === 'playing', null, { timeout: 90_000 });
  // headless Chromium has no pointer lock; pretend the canvas captured the mouse
  await page.evaluate(() => { window.voxelcraft.game.input.locked = true; });
  await page.waitForTimeout(500);
  return errors;
}

test('loads a world, breaks and places a block, runs a command', async ({ page }) => {
  const errors = await startWorld(page, 'playwright');
  await page.screenshot({ path: 'test-results/spawn.png' });
  const p = await page.evaluate(() => {
    const g = window.voxelcraft.game;
    return { x: g.player.pos.x, y: g.player.pos.y, z: g.player.pos.z, onGround: g.player.onGround };
  });
  expect(p.onGround).toBe(true);

  // look straight down and hold the left mouse button to mine the targeted block
  // (synthetic mouse events carry bogus movement deltas, so aim only after pressing the button)
  await page.mouse.move(640, 360);
  await page.mouse.down({ button: 'left' });
  await page.evaluate(() => { window.voxelcraft.game.player.pitch = -Math.PI / 2 + 0.01; });
  await page.waitForFunction(() => (window.voxelcraft.game as unknown as { target: unknown }).target !== null, null, { timeout: 5_000 });
  const target = await page.evaluate(() => {
    const t = (window.voxelcraft.game as unknown as { target: { x: number; y: number; z: number; state: number } }).target;
    return { x: t.x, y: t.y, z: t.z, id: window.voxelcraft.blocks.idOf(t.state) };
  });
  expect(target.id).not.toBe('air');
  await page.waitForFunction(({ x, y, z }) => window.voxelcraft.game.world.getBlock(x, y, z) === 0, target, { timeout: 15_000 });
  await page.mouse.up({ button: 'left' });
  await page.waitForTimeout(1500); // the drop settles and gets picked up
  const inv = await page.evaluate(() => window.voxelcraft.game.player.inventory.slots.filter(Boolean));
  expect(inv.length).toBeGreaterThan(0);
  await page.screenshot({ path: 'test-results/mined.png' });

  // place the picked-up block on the block in front of the feet
  await page.mouse.down({ button: 'right' });
  await page.evaluate(() => {
    const g = window.voxelcraft.game;
    g.player.inventory.selected = 0;
    g.player.pitch = -Math.PI / 2 + 0.01; // the block we now stand on, after falling into the hole
  });
  await page.waitForFunction(() => (window.voxelcraft.game as unknown as { target: unknown }).target !== null, null, { timeout: 5_000 });
  const placeTarget = await page.evaluate(() => {
    const t = (window.voxelcraft.game as unknown as { target: { x: number; y: number; z: number } }).target;
    return { x: t.x, y: t.y + 1, z: t.z };
  });
  // placing straight below is blocked by the player's own body, so aim at the block one step ahead
  await page.evaluate(() => { window.voxelcraft.game.player.pitch = -1.05; window.voxelcraft.game.player.yaw = 0; });
  await page.waitForTimeout(600);
  await page.mouse.up({ button: 'right' });
  const placedAny = await page.evaluate(({ x, y, z }) => {
    const w = window.voxelcraft.game.world;
    for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) for (let dy = -1; dy <= 1; dy++) if (w.getBlock(x + dx, y + dy, z + dz) !== 0 && (dx !== 0 || dz !== 0 || dy !== -1) && dy >= 0) return window.voxelcraft.blocks.idOf(w.getBlock(x + dx, y + dy, z + dz));
    return 'air';
  }, placeTarget);
  expect(placedAny).not.toBe('air');
  await page.screenshot({ path: 'test-results/placed.png' });

  // chat command
  await page.keyboard.press('t');
  await page.waitForSelector('#chat.open input');
  await page.keyboard.type('/gamemode creative');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.voxelcraft.game.player.gamemode === 'creative');

  expect(errors.filter((e) => !e.includes('WebGL') && !e.includes('GPU'))).toEqual([]);
});
