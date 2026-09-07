# Minecraft AI Player

An AI that joins a Minecraft server the same way you do — as a player. It has a
player model and a name tag, it picks the right tool out of its own inventory,
it mines what you ask it to, and it fights back when something hostile turns up.

It is a client, not a mod. Nothing is installed on the server and nothing is
installed on your game, so it works against vanilla Minecraft, Paper, Spigot, a
LAN world, or a realm you can log into.

```sh
npm install
node index.js --host play.example.net --owners YourName
```

Then, in the game's chat:

```
!mine iron 16
!fight
!follow me
```

## What it does

**It looks like a player,** because it is one. It opens an ordinary client
connection, so the server holds a real player entity for it: other players see a
skin, a name tag and a swinging arm, and it shows up in the tab list.

**It picks the right tool.** Before every block it works out which item in its
inventory breaks that block fastest *while still dropping the goods* — mining
stone with your fist is quick in the sense that nothing comes of it. It reads
real dig times from the game's own data, counts Efficiency, and leaves a nearly
broken tool in the bag when something else will do.

**It mines what you name.** `!mine iron 16` covers the ore in both its stone and
deepslate forms; `!mine wood 64` covers every log and stem the version has. It
walks to each block, breaks it, and picks up what drops. It refuses to dig next
to lava or out from under gravel, and it will not break a chest to shorten a
walk.

**It fights.** It equips the best weapon it owns, ranked by damage per second
rather than by damage per swing — which is why it takes a sword over an axe —
raises a shield if it has one, and respects the attack cooldown, because a swing
thrown early does a fraction of the damage. It measures reach the way Minecraft
does, from its eyes to the corner of the mob's hitbox, so it does not stand a
step away swinging at nothing. It jumps into its hits for criticals. It keeps
its distance from creepers and backs off between swings. It leaves neutral mobs
like endermen alone until they start something, and it runs from a warden rather
than dying to one.

**It looks after itself.** It eats before it starves, picking food that does not
waste half the meal, and it retreats when its health drops rather than trading
hits until it dies. Anything urgent interrupts whatever it was doing and hands
control back afterwards: a creeper does not wait for the current block to
finish breaking.

## Talking to it

Address it with `!` or by name — `!mine iron 10`, `Claudius, mine iron 10`.

| Command | What it does |
| --- | --- |
| `mine <block> [n]` | Mine n of something: `mine iron 16`, `mine wood 64`, `mine ancient debris 4` |
| `come` / `come <player>` | Walk to whoever asked, or to a named player |
| `follow [player]` | Keep pace with somebody until told otherwise |
| `goto <x> <y> <z>` | Walk to a position |
| `fight [mob]` | Clear out what is nearby, or hunt one kind of mob |
| `guard` / `passive` | Whether it starts fights. Passive still defends nothing — it just stops picking them |
| `gear` | Put on the best armour and hold the best weapon it has |
| `status` / `inventory` | What it is doing, and what it is carrying |
| `drop <item> [n]` | Hand something over |
| `eat` | Eat now rather than waiting to get hungry |
| `stop` | Drop the current job |
| `help` | The short version of this table |

`--owners Steve,Alex` limits who it listens to. Left off, it takes orders from
anyone in chat.

## Connecting

| | |
| --- | --- |
| `--host` | Server address. Default `localhost` |
| `--port` | Default `25565` |
| `--username` | The name it joins under. Default `Claudius` |
| `--auth` | `offline` for a LAN or cracked server, `microsoft` for a real account |
| `--version` | Force a Minecraft version. Left off, it negotiates whatever the server speaks |
| `--owners` | Comma-separated names allowed to command it |
| `--prefix` | Chat prefix. Default `!` |
| `--stance` | `guard` (default) or `passive` |

A Microsoft account signs in through the usual device-code prompt:

```sh
node index.js --host play.example.net --auth microsoft --username you@example.com
```

Nothing is stored in this repository. A password, if a server needs one, comes
from the `MC_PASSWORD` environment variable — never a flag, which would land in
your shell history. `MC_HOST`, `MC_PORT`, `MC_USERNAME`, `MC_AUTH`, `MC_OWNERS`
and `LOG_LEVEL` work too.

### Behaviour

| | Default | |
| --- | --- | --- |
| `--engageRadius` | 16 | How far off a hostile mob still counts as its problem |
| `--eatBelow` | 16 | Hunger level that sends it looking for food |
| `--fleeBelow` | 6 | Health at which it stops fighting and runs |
| `--searchRadius` | 48 | How far it looks for blocks to mine |
| `--durabilityReserve` | 3 | Uses left at which a tool is "too worn to risk" if there is an alternative |
| `--criticals` | on | Jump into hits for the 1.5× damage |
| `--explore` | on | Dig a corridor to look further when a seam runs out |

## How it decides

Everything reactive outranks whatever it was told to do, and control comes back
when the interruption is over:

```
flee  (hurt, and something is hunting it)
 └ eat   (hungry, and nothing is hunting it)
    └ defend  (something hostile is in range and the stance allows it)
       └ order   (mine / follow / goto / hunt — whatever you last asked for)
          └ idle
```

The pieces are split so the decisions can be tested without a server: `gear.js`
chooses tools, weapons, armour and food; `threat.js` decides what is worth
fighting and what to fight first; `targets.js` turns a word typed in chat into
real block names; `commands.js` is the grammar. Those are pure functions over
plain data. `mining.js`, `combat.js` and `survival.js` are the behaviours that
drive the bot, and `brain.js` arbitrates between them.

## Testing

```sh
npm test        # 48 unit tests over the decision logic
npm run test:e2e   # 10 scenarios against a real Minecraft server
npm run lint
```

The end-to-end suite is not mocked. It boots [flying-squid](https://github.com/PrismarineJS/flying-squid),
a Minecraft server written in JavaScript, on a loopback port; joins it with this
bot and with a second client playing the owner; and drives the bot through chat
exactly the way a person would. It checks that the server holds a real player
entity for the bot, that `!mine iron 3` leaves three fewer ore blocks in the
world and that the pickaxe — not the shovel — was in its hand while it dug, that
it closes on a zombie and kills it, that its swings never come faster than the
sword cooldown, that `passive` really does stop it swinging, and that `stop`
stops it.

`VERBOSE=1` shows the bot's own reasoning as it goes.

Two things the test server cannot show, both flying-squid limitations rather
than the bot's: it renders peer players with a broken entity type on 1.20, so
the second client's view of the player model is not worth asserting on (the
server's own record is checked instead), and it deletes a dead mob without
telling clients, which is why the bot also watches for the death animation
rather than trusting the entity list alone — a habit that is worth having on a
real server too.

## Limits worth knowing

- It fights in melee. It does not use a bow, and it will not win against a
  warden, a wither or the dragon — it is written to run from those.
- It does not craft or smelt. It mines what is there and carries it.
- `explore` digs a corridor when a seam runs out. It does not sink a shaft to
  find a new one, so for ore, start it somewhere underground.
- One inventory, no chests: it will not bank what it collects, so a long job
  ends when the pack is full.
- Bot accounts are against the rules on many public servers. Use it on your own
  server, a LAN world, or one where you have asked.
