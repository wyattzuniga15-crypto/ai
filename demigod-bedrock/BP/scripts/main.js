// Demigod: Chronicles of Olympus — Bedrock edition.
//
// Everything the Java build does with events and attachments, this does with the Script API
// and dynamic properties. Same numbers, same rules, same voice. Where Bedrock has no seam for
// a feature the Java build hangs off — keybinds, custom /commands, custom dimensions — the
// mechanic keeps its meaning and changes its door: the G key is a held Birthright, commands
// answer to "!chronoly" in chat, and the Underworld and Olympus are far places in this world.

import { world, system, EquipmentSlot, ItemStack } from "@minecraft/server";

// ---------------------------------------------------------------------------- constants ----

const DIVINE = new Set([
  "chronoly:celestial_bronze_sword", "chronoly:celestial_bronze_dagger",
  "chronoly:imperial_gold_sword", "chronoly:stygian_iron_sword",
  "chronoly:riptide", "chronoly:hunting_knives", "chronoly:electric_spear",
]);
const BYPASSES = new Set(["chronoly:backbiter"]);

const MONSTERS = new Set([
  "minecraft:zombie","minecraft:husk","minecraft:drowned","minecraft:skeleton","minecraft:stray",
  "minecraft:wither_skeleton","minecraft:spider","minecraft:cave_spider","minecraft:creeper",
  "minecraft:enderman","minecraft:witch","minecraft:blaze","minecraft:ghast","minecraft:magma_cube",
  "minecraft:phantom","minecraft:vindicator","minecraft:pillager","minecraft:ravager",
  "minecraft:evoker","minecraft:hoglin","minecraft:zoglin","minecraft:piglin_brute",
  "minecraft:warden","minecraft:wither","minecraft:ender_dragon",
]);
const MORTALS = new Set([
  "minecraft:villager_v2","minecraft:villager","minecraft:wandering_trader","minecraft:iron_golem",
  "minecraft:cow","minecraft:sheep","minecraft:pig","minecraft:chicken","minecraft:horse",
  "minecraft:donkey","minecraft:llama","minecraft:cat","minecraft:wolf","minecraft:fox",
  "minecraft:rabbit","minecraft:goat",
]);

const GODS = ["poseidon","zeus","hades","apollo","ares","hermes","athena","hecate"];
const BIG_THREE = ["poseidon","zeus","hades"];

const BOSSES = {
  "chronoly:minotaur":      { name:"The Minotaur", dmg:12 },
  "chronoly:hydra":         { name:"The Hydra", dmg:9 },
  "chronoly:cerberus":      { name:"Cerberus", dmg:10, relic:"chronoly:helm_of_darkness" },
  "chronoly:fury":          { name:"Alecto", dmg:8 },
  "chronoly:lydian_drakon": { name:"The Lydian Drakon", dmg:16, relic:"chronoly:master_bolt" },
  "chronoly:medusa":        { name:"Medusa", dmg:7, relic:"chronoly:aegis" },
  "chronoly:nemean_lion":   { name:"The Nemean Lion", dmg:13, relic:"chronoly:nemean_pelt" },
  "chronoly:chimera":       { name:"The Chimera", dmg:14 },
  "chronoly:charybdis":     { name:"Charybdis", dmg:11 },
};
// The Hydra guards the Fleece in the Java build; identical here.
BOSSES["chronoly:hydra"].relic = "chronoly:golden_fleece";

const BOAST_WORDS = new Set(["ez","easy","gg","rekt","unstoppable","invincible","untouchable","noob"]);
const BOAST_PHRASES = ["too easy","i win","i won","cant touch me","can't touch me","no match",
  "already won","cannot lose","cant lose","can't lose"];

// Far places standing in for dimensions Bedrock will not let an addon add.
const UW = { x: 8, y: 63, z: 100008 };          // shore; gate at z+26, Asphodel z+80
const UW_ELYSIUM = { x: 188, y: 63, z: 100008 };
const UW_PUNISH = { x: -172, y: 63, z: 100008 };
const OLY = { x: 8, y: 200, z: -100008 };

// ---------------------------------------------------------------------------- state ----

function data(p) {
  try { return JSON.parse(p.getDynamicProperty("chronoly:data") ?? "{}"); }
  catch { return {}; }
}
function save(p, d) { p.setDynamicProperty("chronoly:data", JSON.stringify(d)); }
function flag(d, f) { d.flags = d.flags ?? {}; if (d.flags[f]) return false; d.flags[f] = 1; return true; }
function hasFlag(d, f) { return !!(d.flags ?? {})[f]; }
function maxEnergy(d) { return 100 + (d.favor ?? 0) * 0.4; }
function tierOf(favor) { return favor >= 850 ? "T4" : favor >= 500 ? "T3" : favor >= 200 ? "T2" : "T1"; }
function addFavor(p, d, amount) { d.favor = Math.max(0, (d.favor ?? 0) + amount); }

const recentCombat = new Map();   // playerId -> tick
const killSites = new Map();      // playerId -> [{x,y,z,t}]
const bossState = new Map();      // entityId -> per-fight state
let tick = 0;

function say(p, msg) { try { p.sendMessage(msg); } catch { } }
function mainhand(entity) {
  try { return entity.getComponent("minecraft:equippable")?.getEquipment(EquipmentSlot.Mainhand)?.typeId; }
  catch { return undefined; }
}
function isBoss(e) { return e && BOSSES[e.typeId] !== undefined; }
function fleshOf(e) {
  if (e.typeId === "minecraft:player") return data(e).parent ? "DEMIGOD" : "MORTAL";
  if (isBoss(e) || MONSTERS.has(e.typeId)) return "MONSTER";
  return "MORTAL";
}

// ---------------------------------------------------------------------------- the Mist ----
// Bedrock cannot cancel damage from a stable script, so the rule is enforced by undoing:
// a blow that should phase through is healed back in full, with the lesson attached.

world.afterEvents.entityHurt.subscribe((ev) => {
  try {
    const victim = ev.hurtEntity;
    const attacker = ev.damageSource?.damagingEntity;
    if (!victim || !attacker) return;
    if (attacker.typeId === "minecraft:player") recentCombat.set(attacker.id, tick);
    if (victim.typeId === "minecraft:player") recentCombat.set(victim.id, tick);

    const weapon = mainhand(attacker);
    if (weapon && BYPASSES.has(weapon)) { bossHurt(victim, ev.damage, true); return; }
    const divine = weapon !== undefined && DIVINE.has(weapon);
    const flesh = fleshOf(victim);

    let phases = false;
    if (divine && flesh === "MORTAL") phases = true;
    if (!divine && flesh === "MONSTER" && attacker.typeId === "minecraft:player") phases = true;

    // The Nemean Lion's hide turns even divine metal outside the roar window.
    if (!phases && victim.typeId === "chronoly:nemean_lion") {
      const st = bossState.get(victim.id) ?? {};
      if (!(st.mouthOpen > 0)) phases = true;
    }

    if (phases) {
      const hp = victim.getComponent("minecraft:health");
      if (hp) hp.setCurrentValue(Math.min(hp.effectiveMax, hp.currentValue + ev.damage));
      if (attacker.typeId === "minecraft:player") {
        const d = data(attacker);
        const lesson = divine ? "lesson_bronze_mortal" : "lesson_steel_monster";
        if (flag(d, lesson)) {
          say(attacker, divine
            ? "§7The bronze passes through as though nothing were there. §8It was never for them."
            : "§7The blade finds nothing to bite. §8Ordinary metal will not touch them.");
          save(attacker, d);
        }
      }
      return;
    }
    bossHurt(victim, ev.damage, false);
  } catch { }
});

function bossHurt(victim, amount, fire) {
  if (victim.typeId !== "chronoly:hydra") return;
  const st = bossState.get(victim.id) ?? (bossState.set(victim.id, {}), bossState.get(victim.id));
  const burning = fire; // Backbiter counts as decisive; real fire arrives with no attacker entity
  if (burning) { if ((st.heads ?? 0) > 0) st.heads--; }
  else if (amount > 6) st.heads = Math.min(6, (st.heads ?? 0) + 1);
}

// ---------------------------------------------------------------------------- claiming & kills ----

world.afterEvents.entityDie.subscribe((ev) => {
  try {
    const dead = ev.deadEntity;
    const killer = ev.damageSource?.damagingEntity;

    if (dead.typeId === "minecraft:player") { pendingJudgment.add(dead.id); return; }
    if (!killer || killer.typeId !== "minecraft:player") return;
    const p = killer;
    const d = data(p);

    // remember the site for the burial rite
    const list = killSites.get(p.id) ?? [];
    list.push({ x: dead.location.x, y: dead.location.y, z: dead.location.z, t: tick });
    while (list.length > 5) list.shift();
    killSites.set(p.id, list);

    const monster = isBoss(dead) || MONSTERS.has(dead.typeId);

    if (monster && !d.parent) { claim(p, d); save(p, d); return; }
    if (!d.parent) return;

    if (monster) {
      const before = tierOf(d.favor ?? 0);
      addFavor(p, d, 6);
      if (p.getComponent("minecraft:health").currentValue < 4) {
        addFavor(p, d, 15);
        say(p, "§6You should not have won that. §7Winning anyway is the kind of thing that gets noticed.");
      }
      if (tierOf(d.favor) !== before) {
        say(p, "§6Something in you settles and grows heavier. §e" + tierOf(d.favor)
          + "§6 — and whatever is out there can smell it.");
      }
    }
    if (dead.typeId.startsWith("minecraft:villager") || dead.typeId === "minecraft:wandering_trader") {
      addFavor(p, d, -25);
      d.killedHelpless = (d.killedHelpless ?? 0) + 1;
      if (flag(d, "lesson_helpless")) {
        say(p, "§cThey could not fight back. §7The gods keep a different ledger for that.");
      }
    }

    if (isBoss(dead)) {
      addFavor(p, d, 90);
      d.killedBoss = 1;
      const info = BOSSES[dead.typeId];
      if (info.relic) {
        p.dimension.spawnItem(itemStack(info.relic), dead.location);
      }
      bossState.delete(dead.id);
      // quest?
      if (d.quest && d.quest.target === dead.typeId) {
        const sworn = hasFlag(d, "oath_" + d.quest.target + "_" + d.quest.deadline);
        addFavor(p, d, sworn ? 240 : 120);
        d.completedQuest = 1;
        d.quest = undefined;
        say(p, "§6§lThe prophecy is spent. §7You did what it said, more or less.");
        if (sworn) say(p, "§5The river remembers you kept your word.");
      }
    }
    save(p, d);
  } catch { }
});

function itemStack(id) { return new ItemStack(id, 1); }

function claim(p, d) {
  const roll = Math.random();
  let god;
  if (roll < 0.03) god = BIG_THREE[Math.floor(Math.random() * 3)];
  else {
    const rest = GODS.filter((g) => !BIG_THREE.includes(g));
    god = rest[Math.floor(Math.random() * rest.length)];
  }
  d.parent = god; d.favor = 0; d.energy = 100; d.overdraw = 0;
  const cap = god.charAt(0).toUpperCase() + god.slice(1);
  for (const other of world.getPlayers()) {
    say(other, "§6§lA sign burns in the air. §e" + p.name + " §7is claimed by §6" + cap + "§7.");
  }
  say(p, "§7Your fatal flaw is part of the inheritance. Hold your §eBirthright §7and use it to cast.");
  try { p.runCommand("give @s chronoly:birthright"); } catch { }
}

// ---------------------------------------------------------------------------- burial ----

world.afterEvents.playerPlaceBlock.subscribe((ev) => {
  try {
    const id = ev.block.typeId;
    if (!["minecraft:dirt","minecraft:coarse_dirt","minecraft:podzol","minecraft:gravel","minecraft:mud"].includes(id)) return;
    const p = ev.player;
    const list = killSites.get(p.id);
    if (!list) return;
    for (let i = list.length - 1; i >= 0; i--) {
      const s = list[i];
      if (tick - s.t > 1200) { list.splice(i, 1); continue; }
      const dx = ev.block.location.x - s.x, dy = ev.block.location.y - s.y, dz = ev.block.location.z - s.z;
      if (dx*dx + dy*dy + dz*dz > 9) continue;
      list.splice(i, 1);
      const d = data(p);
      if (!d.parent) return;
      addFavor(p, d, 5);
      if (flag(d, "lesson_burial")) {
        say(p, "§5Somewhere below, something nods. §7The dead are his, and he notices who is careful with them.");
      }
      save(p, d);
      return;
    }
  } catch { }
});

// ---------------------------------------------------------------------------- chat: commands & boasting ----

world.beforeEvents.chatSend.subscribe((ev) => {
  try {
    const p = ev.sender;
    const msg = ev.message.trim();
    if (msg.startsWith("!chronoly") || msg.startsWith("!ch ")) {
      ev.cancel = true;
      const args = msg.replace(/^!chronoly\s*|^!ch\s*/, "").split(/\s+/);
      system.run(() => command(p, args));
      return;
    }
    const last = recentCombat.get(p.id);
    if (last !== undefined && tick - last <= 400) {
      const lower = msg.toLowerCase();
      let boast = BOAST_PHRASES.some((ph) => lower.includes(ph));
      if (!boast) boast = lower.split(/[^a-z']+/).some((w) => BOAST_WORDS.has(w));
      if (boast) system.run(() => {
        const d = data(p);
        if (!d.parent) return;
        addFavor(p, d, -20); save(p, d);
        say(p, "§cSomething vast pauses to listen. §7The fight is not over, and now they are watching to see if you were right.");
      });
    }
  } catch { }
});

function command(p, args) {
  const d = data(p);
  const sub = (args[0] ?? "help").toLowerCase();
  switch (sub) {
    case "status": {
      const god = d.parent ? d.parent : "unclaimed";
      say(p, "§6§lDemigod §7— parent: §e" + god + "§7, favour: §e" + Math.round(d.favor ?? 0)
        + " (" + tierOf(d.favor ?? 0) + ")§7, energy: §b" + Math.round(d.energy ?? 0) + "/" + Math.round(maxEnergy(d)));
      if (d.quest) say(p, "§7Quest: destroy §f" + BOSSES[d.quest.target].name + "§7.");
      break;
    }
    case "cast": cast(p, d); break;
    case "prophecy": prophecy(p, d); break;
    case "quest":
      say(p, d.quest ? "§7Destroy §f" + BOSSES[d.quest.target].name + "§7. §8"
        + Math.max(0, Math.round((d.quest.deadline - tick) / 1200)) + " minutes remain."
        : "§7The Oracle has not spoken for you. §8!chronoly prophecy");
      break;
    case "oath": {
      if (!d.parent) { say(p, "§7The river does not know you yet."); break; }
      if (!d.quest) { say(p, "§7An oath needs something to swear to. §8Ask the Oracle first."); break; }
      const key = "oath_" + d.quest.target + "_" + d.quest.deadline;
      if (!flag(d, key)) { say(p, "§7You have already sworn. §8It heard you the first time."); break; }
      say(p, "§5§lYou swear it on the River Styx.");
      say(p, "§7Thunder, somewhere, on a clear day. §8Double pay, or the river collects.");
      break;
    }
    case "travel": travel(p, d, (args[1] ?? "").toLowerCase()); break;
    case "charon": charon(p, d); break;
    case "camp": if ((args[1] ?? "") === "build") buildCamp(p); break;
    default:
      say(p, "§6§lDemigod: Chronicles of Olympus");
      say(p, "§e!chronoly status §7— parent, favour, energy, quest");
      say(p, "§e!chronoly cast §7— your birthright (or use the Birthright item)");
      say(p, "§e!chronoly prophecy §7— the Oracle sends you somewhere");
      say(p, "§e!chronoly oath §7— swear the quest on the Styx");
      say(p, "§e!chronoly travel underworld|olympus|home");
      say(p, "§e!chronoly charon §7— a drachma buys the crossing out");
      say(p, "§e!chronoly camp build §7— raise Camp Half-Blood here");
      say(p, "§7Celestial bronze passes through mortals. Ordinary steel passes through monsters. §8You are hurt by both.");
  }
  save(p, d);
}

// ---------------------------------------------------------------------------- abilities ----

function cast(p, d) {
  if (!d.parent) { say(p, "§7You are unclaimed. No god has spoken for you yet."); return; }
  if ((d.overdraw ?? 0) > maxEnergy(d) * 0.9) {
    say(p, "§8You are too spent. Everything is grey and far away."); return;
  }
  const cost = { poseidon:45, zeus:45, hades:35, apollo:30, ares:30 }[d.parent] ?? 25;
  const loc = p.location, dim = p.dimension;
  const view = p.getViewDirection();
  const name = (() => {
    switch (d.parent) {
      case "poseidon": {
        for (const e of dim.getEntities({ location: loc, maxDistance: 5.5 })) {
          if (e.id === p.id) continue;
          try { e.applyDamage(7, { cause: "entityAttack", damagingEntity: p }); } catch { }
          try {
            const away = { x: e.location.x - loc.x, z: e.location.z - loc.z };
            const len = Math.hypot(away.x, away.z) || 1;
            e.applyKnockback(away.x / len, away.z / len, 1.1, 0.75);
          } catch { }
        }
        try { p.runCommand("particle minecraft:huge_explosion_emitter ~ ~ ~"); } catch { }
        return "Earthshaker";
      }
      case "zeus": {
        const t = { x: loc.x + view.x * 24, y: loc.y + view.y * 24, z: loc.z + view.z * 24 };
        try { dim.spawnEntity("minecraft:lightning_bolt", t); } catch { }
        return "Lightning Bolt";
      }
      case "hades": {
        const t = { x: loc.x + view.x * 16, y: loc.y + Math.max(0, view.y * 16) + 1, z: loc.z + view.z * 16 };
        try { p.teleport(t); p.addEffect("nausea", 60, { amplifier: 0 }); } catch { }
        return "Shadow Travel";
      }
      case "apollo": {
        for (const q of dim.getPlayers({ location: loc, maxDistance: 8 })) {
          try { const h = q.getComponent("minecraft:health");
                h.setCurrentValue(Math.min(h.effectiveMax, h.currentValue + 8));
                q.addEffect("regeneration", 120, { amplifier: 1 }); } catch { }
        }
        return "Healing Hymn";
      }
      case "ares": {
        for (const e of dim.getEntities({ location: loc, maxDistance: 10, families: ["monster"] })) {
          try { e.addEffect("weakness", 200, { amplifier: 1 });
                e.addEffect("slowness", 100, { amplifier: 1 }); } catch { }
        }
        try { p.addEffect("strength", 300, { amplifier: 1 });
              p.addEffect("resistance", 300, { amplifier: 0 }); } catch { }
        return "War Cry";
      }
      case "hermes": {
        const t = { x: loc.x + view.x * 12, y: loc.y + Math.max(0, view.y * 12) + 1, z: loc.z + view.z * 12 };
        try { p.teleport(t); p.addEffect("speed", 200, { amplifier: 1 }); } catch { }
        return "Blink";
      }
      case "athena": {
        let n = 0;
        for (const e of dim.getEntities({ location: loc, maxDistance: 28, families: ["monster"] })) {
          try { e.runCommand("effect @s glowing 30 0 true"); n++; } catch { }
        }
        try { p.addEffect("night_vision", 1200, { amplifier: 0 }); } catch { }
        say(p, "§9You count " + n + " of them, and where each one is standing.");
        return "Tactical Sight";
      }
      case "hecate": {
        for (const off of [1.5, -1.5]) {
          try {
            const s = dim.spawnEntity("minecraft:skeleton", { x: loc.x + off, y: loc.y, z: loc.z });
            s.addEffect("wither", 1200, { amplifier: 0 });
          } catch { }
        }
        try { p.addEffect("night_vision", 2400, { amplifier: 0 }); } catch { }
        return "Witchlight";
      }
    }
    return null;
  })();
  if (!name) { say(p, "§7Your parent has granted you nothing yet."); return; }
  const pool = d.energy ?? 0;
  const fromPool = Math.min(pool, cost);
  d.energy = pool - fromPool;
  d.overdraw = (d.overdraw ?? 0) + (cost - fromPool);
  say(p, "§b" + name + (cost > fromPool ? " §8— and it cost you more than you had." : ""));
}

world.afterEvents.itemUse.subscribe((ev) => {
  try {
    const p = ev.source;
    const id = ev.itemStack?.typeId ?? "";
    if (id === "chronoly:birthright") { const d = data(p); cast(p, d); save(p, d); return; }
    if (!id.startsWith("chronoly:")) return;
    const d = data(p);
    const spend = (cost) => {
      const fromPool = Math.min(d.energy ?? 0, cost);
      d.energy = (d.energy ?? 0) - fromPool;
      d.overdraw = (d.overdraw ?? 0) + (cost - fromPool);
    };
    const loc = p.location, dim = p.dimension, view = p.getViewDirection();
    switch (id) {
      case "chronoly:master_bolt": {
        spend(60);
        const t = { x: loc.x + view.x * 30, y: loc.y + view.y * 30, z: loc.z + view.z * 30 };
        for (const o of [-2.5, 0, 2.5]) {
          try { dim.spawnEntity("minecraft:lightning_bolt", { x: t.x + o, y: t.y, z: t.z + o }); } catch { }
        }
        say(p, "§e§lThe sky does what you tell it."); break;
      }
      case "chronoly:helm_of_darkness": {
        spend(45);
        try { p.addEffect("invisibility", 600, { amplifier: 0 }); } catch { }
        for (const e of dim.getEntities({ location: loc, maxDistance: 16 })) {
          if (e.id === p.id) continue;
          try { e.addEffect("weakness", 200, { amplifier: 1 }); e.addEffect("slowness", 200, { amplifier: 1 }); } catch { }
        }
        say(p, "§8You put it on and the world forgets there was ever anyone here."); break;
      }
      case "chronoly:golden_fleece": {
        spend(20);
        for (const q of dim.getPlayers({ location: loc, maxDistance: 12 })) {
          try { const h = q.getComponent("minecraft:health");
                h.setCurrentValue(Math.min(h.effectiveMax, h.currentValue + 14));
                q.addEffect("regeneration", 300, { amplifier: 2 });
                q.extinguishFire(false); } catch { }
        }
        say(p, "§6Everything near it starts getting better."); break;
      }
      case "chronoly:aegis": {
        spend(30);
        for (const e of dim.getEntities({ location: loc, maxDistance: 14, families: ["monster"] })) {
          try { e.addEffect("slowness", 200, { amplifier: 4 }); e.addEffect("weakness", 200, { amplifier: 2 }); } catch { }
        }
        try { p.addEffect("resistance", 300, { amplifier: 1 }); } catch { }
        say(p, "§7Everything that looks at it stops looking at anything."); break;
      }
      case "chronoly:yankees_cap": {
        spend(25);
        try { p.addEffect("invisibility", 1200, { amplifier: 0 }); } catch { }
        say(p, "§9You are not here. §7You have not been here for a while."); break;
      }
      case "chronoly:electric_spear": {
        spend(15);
        for (const e of dim.getEntities({ location: loc, maxDistance: 5 })) {
          if (e.id === p.id) continue;
          try { e.applyDamage(12, { cause: "lightning" }); e.addEffect("slowness", 60, { amplifier: 3 }); } catch { }
        }
        break;
      }
      case "chronoly:travelers_token": {
        spend(30);
        const t = { x: loc.x + view.x * 24, y: loc.y + Math.max(0, view.y * 24) + 1, z: loc.z + view.z * 24 };
        try { p.teleport(t); } catch { }
        break;
      }
    }
    save(p, d);
  } catch { }
});

// Ambrosia burns. The counter cools slowly; a mortal simply dies.
world.afterEvents.itemCompleteUse.subscribe((ev) => {
  try {
    const p = ev.source;
    const id = ev.itemStack?.typeId;
    if (id !== "chronoly:ambrosia" && id !== "chronoly:nectar") return;
    const d = data(p);
    if (!d.parent) {
      try { p.applyDamage(500); } catch { }
      say(p, "§cIt tastes like a memory, and then like burning. This was never meant for you.");
      return;
    }
    const heal = id === "chronoly:ambrosia" ? 10 : 6;
    const burn = id === "chronoly:ambrosia" ? 40 : 20;
    try { const h = p.getComponent("minecraft:health");
          h.setCurrentValue(Math.min(h.effectiveMax, h.currentValue + heal)); } catch { }
    d.burn = (d.burn ?? 0) + burn;
    if (d.burn > 100) {
      try { p.setOnFire(8, false); p.applyDamage(8); } catch { }
      say(p, "§6§lYou are burning from the inside out. §cYou had too much.");
    } else if (flag(d, "lesson_ambrosia")) {
      say(p, "§6It tastes like your mother's cooking, whatever that was. §7Do not have much more.");
    }
    save(p, d);
  } catch { }
});

// ---------------------------------------------------------------------------- the Oracle ----

function prophecy(p, d) {
  if (!d.parent) { say(p, "§7The Oracle looks through you. §8Come back claimed."); return; }
  if (d.quest) { say(p, "§7One prophecy at a time. §8Finish what you were given."); return; }
  const ids = Object.keys(BOSSES);
  const target = ids[Math.floor(Math.random() * ids.length)];
  const deadline = tick + 72000;
  d.quest = { target, deadline };
  say(p, "§5§lThe Oracle of Delphi");
  say(p, "§dYou shall go where the ground forgets the sun,");
  say(p, "§dand finish what an older war begun —");
  say(p, "§dthe " + BOSSES[target].name.replace("The ", "").toLowerCase() + " waits, and counts what you hold dear;");
  say(p, "§dthe road back home will cost you what brought you here.");
  say(p, "§7Your quest: §fdestroy " + BOSSES[target].name + "§7. §8Sixty minutes.");
  // The prophecy is a contract: the named monster spawns, out there, now.
  const a = Math.random() * Math.PI * 2;
  const dist = 90 + Math.random() * 50;
  const sx = Math.round(p.location.x + Math.cos(a) * dist);
  const sz = Math.round(p.location.z + Math.sin(a) * dist);
  try {
    p.runCommand(`execute positioned ${sx} 320 ${sz} run summon ${target} ~ ~ ~`);
  } catch {
    try { p.dimension.spawnEntity(target, { x: sx, y: p.location.y + 20, z: sz }); } catch { }
  }
  const winds = ["east","southeast","south","southwest","west","northwest","north","northeast"];
  say(p, "§7Somewhere to the §f" + winds[Math.round(a / (Math.PI / 4)) & 7]
    + "§7, something feels the words land on it, and turns around.");
}

// ---------------------------------------------------------------------------- places ----

function fill(p, x1,y1,z1, x2,y2,z2, block) {
  try { p.runCommand(`fill ${x1} ${y1} ${z1} ${x2} ${y2} ${z2} ${block}`); } catch { }
}

function buildUnderworld(p) {
  if (world.getDynamicProperty("chronoly:uw_built")) return;
  world.setDynamicProperty("chronoly:uw_built", true);
  const { x, y, z } = UW;
  // shore
  fill(p, x-14, y-1, z-10, x+14, y-1, z+10, "gray_concrete_powder");
  fill(p, x-14, y, z-10, x+14, y+7, z+10, "air");
  fill(p, x-14, y-1, z-14, x+14, y, z-11, "water");
  // gate
  fill(p, x-3, y, z+26, x+3, y+6, z+26, "polished_blackstone");
  fill(p, x-1, y, z+26, x+1, y+4, z+26, "air");
  // Asphodel
  fill(p, x-26, y-1, z+54, x+26, y-1, z+106, "gray_concrete_powder");
  fill(p, x-26, y, z+54, x+26, y+9, z+106, "air");
  // Elysium
  fill(p, UW_ELYSIUM.x-26, y-1, z-26, UW_ELYSIUM.x+26, y-1, z+26, "grass_block");
  fill(p, UW_ELYSIUM.x-26, y, z-26, UW_ELYSIUM.x+26, y+11, z+26, "air");
  fill(p, UW_ELYSIUM.x-26, y-1, z, UW_ELYSIUM.x+26, y-1, z, "gold_block");
  // Punishment
  fill(p, UW_PUNISH.x-26, y-1, z-26, UW_PUNISH.x+26, y-1, z+26, "polished_blackstone");
  fill(p, UW_PUNISH.x-26, y, z-26, UW_PUNISH.x+26, y+9, z+26, "air");
  fill(p, UW_PUNISH.x-26, y-1, z-26, UW_PUNISH.x-26, y-1, z+26, "lava");
  try { p.runCommand(`execute positioned ${x} ${y} ${z+30} run summon chronoly:cerberus ~ ~ ~`); } catch { }
}

function buildOlympus(p) {
  if (world.getDynamicProperty("chronoly:oly_built")) return;
  world.setDynamicProperty("chronoly:oly_built", true);
  const { x, y, z } = OLY;
  fill(p, x-15, y-1, z-15, x+15, y-1, z+15, "smooth_quartz");
  fill(p, x-15, y, z-15, x+15, y+9, z+15, "air");
  fill(p, x-2, y-1, z+15, x+2, y-1, z+34, "smooth_quartz");
  fill(p, x-24, y-1, z+35, x+24, y-1, z+83, "smooth_quartz");
  fill(p, x-24, y, z+35, x+24, y+13, z+83, "air");
  // hearth + thrones sketched in blocks; the full horseshoe is the Java build's luxury
  fill(p, x-1, y-1, z+58, x+1, y-1, z+60, "nether_bricks");
  try { p.runCommand(`setblock ${x} ${y} ${z+59} campfire`); } catch { }
  for (let i = 0; i < 12; i++) {
    const left = i % 2 === 0;
    const tx = x + (left ? -16 : 16);
    const tz = z + 44 + Math.floor(i / 2) * 6;
    fill(p, tx-2, y, tz, tx+2, y+1, tz, "quartz_block");
  }
}

function travel(p, d, where) {
  switch (where) {
    case "underworld":
      buildUnderworld(p);
      d.home = { x: p.location.x, y: p.location.y, z: p.location.z };
      try { p.teleport({ x: UW.x, y: UW.y, z: UW.z }); } catch { }
      say(p, "§7The air smells like old pennies and dead flowers. §8Find your way out, or pay the ferryman.");
      break;
    case "olympus":
      buildOlympus(p);
      d.home = { x: p.location.x, y: p.location.y, z: p.location.z };
      try { p.teleport({ x: OLY.x, y: OLY.y, z: OLY.z }); } catch { }
      say(p, "§e§lThe six hundredth floor. §6Everything is marble and nobody is looking at you yet.");
      break;
    case "home": {
      const h = d.home ?? { x: 0, y: 100, z: 0 };
      try { p.teleport(h); } catch { }
      say(p, "§7Back where the air is ordinary.");
      break;
    }
    default: say(p, "§7!chronoly travel underworld|olympus|home");
  }
}

function charon(p, d) {
  try {
    p.runCommand("clear @s chronoly:golden_drachma 0 1");
    const h = d.home ?? { x: 0, y: 100, z: 0 };
    p.teleport(h);
    say(p, "§6The drachma disappears into an Italian suit. §7\"Mind the step.\"");
  } catch {
    say(p, "§7Charon looks at your empty hands. §8A drachma, or you wait like everybody else.");
  }
}

function buildCamp(p) {
  const { x, y, z } = { x: Math.round(p.location.x), y: Math.round(p.location.y), z: Math.round(p.location.z) };
  fill(p, x-48, y-1, z-48, x+48, y-1, z+48, "grass_block");
  for (let i = 0; i < 20; i++) {
    const a = (i / 20) * Math.PI * 1.2 - Math.PI * 0.1;
    const cx = x + Math.round(Math.cos(a) * 30);
    const cz = z + Math.round(Math.sin(a) * 30);
    fill(p, cx-3, y, cz-3, cx+3, y+3, cz+3, "oak_planks");
    fill(p, cx-2, y, cz-2, cx+2, y+3, cz+2, "air");
  }
  world.setDynamicProperty("chronoly:camp", JSON.stringify({ x, y, z }));
  say(p, "§6Camp Half-Blood stands. §7Twenty cabins, and inside the borders nothing can smell you.");
}

// ---------------------------------------------------------------------------- judgment ----

const pendingJudgment = new Set();

world.afterEvents.playerSpawn.subscribe((ev) => {
  try {
    const p = ev.player;
    if (ev.initialSpawn) {
      const d = data(p);
      if (!d.parent && flag(d, "satyr_0")) {
        say(p, "§aA satyr falls into step beside you. §f\"Don't panic. Keep walking. Act normal.\"");
        say(p, "§f\"Kill something that shouldn't exist and your parent will speak for you. Ordinary metal won't touch them — craft celestial bronze.\"");
        say(p, "§8(!chronoly help for everything.)");
        save(p, d);
      }
      return;
    }
    if (!pendingJudgment.delete(p.id)) return;
    const d = data(p);
    if (!d.parent) return;
    addFavor(p, d, -40);
    buildUnderworld(p);
    say(p, "§8You do not wake up. You arrive.");
    say(p, "§5§lThe Judgment Pavilion");
    let dest, why;
    if (hasFlag(d, "broke_oath") || (d.killedHelpless ?? 0) >= 3) {
      dest = UW_PUNISH; why = "§4The Fields of Punishment. §7You did something specific to end up here.";
    } else if (d.completedQuest || (d.favor ?? 0) >= 700) {
      dest = UW_ELYSIUM; why = "§6Elysium. §7It is warm, and it is beautiful, and leaving is going to be hard.";
    } else {
      dest = { x: UW.x, y: UW.y, z: UW.z + 80 }; why = "§7Asphodel. An endless grey crowd, and nobody is looking for you.";
    }
    d.home = d.home ?? { x: 0, y: 100, z: 0 };
    system.runTimeout(() => { try { p.teleport(dest); say(p, why); } catch { } }, 20);
    save(p, d);
  } catch { }
});

// ---------------------------------------------------------------------------- the second hand ----

// Everything on a one-second pulse: energy, burn, HUD, quests, boss mechanics.
system.runInterval(() => {
  tick += 20;
  try {
    for (const p of world.getPlayers()) {
      const d = data(p);
      if (!d.parent) continue;

      // regeneration on the parent's terms, simplified to what Bedrock can cheaply see
      let rate = 1.0;
      const night = world.getTimeOfDay() > 13000;
      switch (d.parent) {
        case "poseidon": if (p.isInWater) rate *= 4; break;
        case "zeus": if (p.location.y > 100) rate += 1.5; break;
        case "hades": if (night) rate *= 3; break;
        case "apollo": rate = night ? 0.05 : rate * 3.5; break;
        case "hermes": if (p.isSprinting) rate += 1.2; break;
        case "hecate": if (night) rate *= 1.8; break;
      }
      d.energy = Math.min(maxEnergy(d), (d.energy ?? 0) + rate);
      d.overdraw = Math.max(0, (d.overdraw ?? 0) - 1.5);
      if ((d.burn ?? 0) > 0) d.burn -= 0.15;

      // quest expiry
      if (d.quest && tick > d.quest.deadline) {
        const sworn = hasFlag(d, "oath_" + d.quest.target + "_" + d.quest.deadline);
        d.quest = undefined;
        addFavor(p, d, sworn ? -150 : -40);
        say(p, "§8The deadline passes. §7Whatever you were sent for, somebody else will have to go.");
        if (sworn) { d.flags["broke_oath"] = 1;
          say(p, "§4§lYou swore on the Styx. §cThe river collects."); }
      }

      // the HUD is an actionbar line, which is what Bedrock gives us
      try {
        p.onScreenDisplay.setActionBar(
          "§7Child of §f" + d.parent.charAt(0).toUpperCase() + d.parent.slice(1)
          + " §8| §b" + Math.round(d.energy) + "/" + Math.round(maxEnergy(d))
          + ((d.overdraw ?? 0) > 0 ? " §8(−" + Math.round(d.overdraw) + ")" : "")
          + " §8| §e" + Math.round(d.favor ?? 0) + " " + tierOf(d.favor ?? 0));
      } catch { }
      save(p, d);
    }

    // boss mechanics, once a second, straight from the Java build
    for (const dim of ["overworld"].map((k) => world.getDimension(k))) {
      for (const boss of dim.getEntities({ families: ["chronoly_boss"] })) {
        const st = bossState.get(boss.id) ?? (bossState.set(boss.id, { heavyCd: 6 }), bossState.get(boss.id));
        const kind = boss.typeId;
        const near = dim.getPlayers({ location: boss.location, maxDistance: 24 });

        // the telegraphed heavy blow, for everything that fights with its body
        if (!["chronoly:medusa","chronoly:charybdis","chronoly:fury"].includes(kind)) {
          if (st.heavyWind > 0) {
            st.heavyWind--;
            if (st.heavyWind === 0) {
              for (const q of dim.getPlayers({ location: boss.location, maxDistance: 4 })) {
                try { q.applyDamage(Math.round(BOSSES[kind].dmg * 1.5), { cause: "entityAttack", damagingEntity: boss });
                      const away = { x: q.location.x - boss.location.x, z: q.location.z - boss.location.z };
                      const len = Math.hypot(away.x, away.z) || 1;
                      q.applyKnockback(away.x / len, away.z / len, 1.4, 0.5); } catch { }
              }
            }
          } else if ((st.heavyCd = (st.heavyCd ?? 6) - 1) <= 0
                     && dim.getPlayers({ location: boss.location, maxDistance: 7 }).length > 0) {
            st.heavyCd = 8; st.heavyWind = 1;
            try { boss.runCommand("effect @s glowing 1 0 true"); } catch { }
            for (const q of near) say(q, "§c§lIt rears back. §7Move.");
          }
        }

        switch (kind) {
          case "chronoly:medusa":
            for (const q of near) {
              const to = { x: boss.location.x - q.location.x, y: (boss.location.y + 1.6) - (q.location.y + 1.6), z: boss.location.z - q.location.z };
              const len = Math.hypot(to.x, to.y, to.z) || 1;
              const view = q.getViewDirection();
              const dot = (to.x * view.x + to.y * view.y + to.z * view.z) / len;
              if (dot > 0.86) {
                try { q.addEffect("slowness", 60, { amplifier: 3 });
                      q.addEffect("mining_fatigue", 60, { amplifier: 2 });
                      q.applyDamage(2, { cause: "magic" }); } catch { }
                const d = data(q);
                if (flag(d, "lesson_medusa")) { say(q, "§2Your legs are getting heavy. §7Stop looking at her."); save(q, d); }
              }
            }
            break;
          case "chronoly:charybdis": {
            try { boss.runCommand("effect @s water_breathing 3 0 true"); } catch { }
            for (const q of dim.getPlayers({ location: boss.location, maxDistance: 20 })) {
              const to = { x: boss.location.x - q.location.x, z: boss.location.z - q.location.z };
              const dist = Math.hypot(to.x, to.z);
              if (dist < 1.5) continue;
              try { q.applyKnockback(to.x / dist, to.z / dist, 0.42, 0.05); } catch { }
              if (dist < 6) { try { q.applyDamage(4, { cause: "drowning" }); q.addEffect("slowness", 40, { amplifier: 2 }); } catch { } }
            }
            break;
          }
          case "chronoly:hydra":
            if ((st.heads ?? 0) > 0 && (st.regenCd = (st.regenCd ?? 5) - 1) <= 0) {
              st.regenCd = 5;
              try { const h = boss.getComponent("minecraft:health");
                    h.setCurrentValue(Math.min(h.effectiveMax, h.currentValue + st.heads * 4)); } catch { }
              for (const q of near) say(q, "§2Another head pushes its way out. §7Fire. It has to be fire.");
            }
            break;
          case "chronoly:nemean_lion":
            if (st.mouthOpen > 0) st.mouthOpen--;
            else if ((st.roarCd = (st.roarCd ?? 7) - 1) <= 0) {
              st.roarCd = 7; st.mouthOpen = 2;
              try { boss.runCommand("effect @s glowing 2 0 true"); } catch { }
              for (const q of near) say(q, "§eThe lion roars — §7its mouth is open. That is the only way in.");
            }
            break;
          case "chronoly:chimera":
            if ((st.fireCd = (st.fireCd ?? 5) - 1) <= 0) {
              st.fireCd = 5;
              for (const q of dim.getPlayers({ location: boss.location, maxDistance: 14 })) {
                try { q.setOnFire(5, true); q.addEffect("poison", 120, { amplifier: 1 }); } catch { }
              }
            }
            break;
          case "chronoly:lydian_drakon":
            if ((st.poisonCd = (st.poisonCd ?? 6) - 1) <= 0) {
              st.poisonCd = 6;
              for (const q of dim.getPlayers({ location: boss.location, maxDistance: 12 })) {
                try { q.addEffect("poison", 100, { amplifier: 1 }); } catch { }
              }
            }
            break;
        }
      }
    }
  } catch { }
}, 20);
