# 1.21.11 API deltas found the hard way

Every one of these cost a CI round trip. Written down so they cost it once.

| Was (≤1.21.8) | Is (1.21.11) |
|---|---|
| `net.minecraft.resources.ResourceLocation` | `net.minecraft.resources.Identifier` |
| `@EventBusSubscriber(bus = ...)` | no `bus` attribute — register listeners explicitly |
| `AttachmentType.Builder#serialize(Codec)` | takes a `MapCodec` (use `RecordCodecBuilder.mapCodec`) |
| `MobEffects.MOVEMENT_SLOWDOWN` | `MobEffects.SLOWNESS` |
| `MobEffects.MOVEMENT_SPEED` | `MobEffects.SPEED` |
| `MobEffects.CONFUSION` | `MobEffects.NAUSEA` |
| `MobEffects.DAMAGE_BOOST` | `MobEffects.STRENGTH` |
| `MobEffects.DAMAGE_RESISTANCE` | `MobEffects.RESISTANCE` |
| `ServerPlayer#serverLevel()` | gone — cast `(ServerLevel) player.level()` |
| `ServerPlayer#getServer()` | gone — `((ServerLevel) player.level()).getServer()` |
| `net.minecraft.world.entity.monster.Skeleton` | `...monster.skeleton.Skeleton` |
| `Entity#moveTo(x, y, z)` | gone — `setPos(x, y, z)` |
| `CommandSourceStack#hasPermission(int)` | gone — permission levels are `PermissionCheck`s |
| `PlayerList#isOp(GameProfile)` | `isOp(NameAndId)` — `player.nameAndId()` |
| `GameProfile#getName()` | gone — `entity.getName().getString()` |
| `Level#isDay()` | gone — `level.getDayTime() % 24000L < 12000L` |
| `KeyMapping(String, IKeyConflictContext, Type, int, String)` | last argument is a `Category` object, not a String |
| GeckoLib 4 `new AnimationController<>(this, name, ticks, handler)` | GeckoLib 5 drops the animatable: `(name, ticks, handler)` |
| GeckoLib 4 `software.bernie.geckolib.animation.PlayState` | moved; location still unconfirmed |
| `net.minecraft.gametest.framework.GameTest` (annotation) | not a rename — the entire `net.minecraft.gametest` tree is absent from the compile classpath (measured, run 42) |

## Confirmed working (guessed right, first try)

- `KeyMapping.Category.GAMEPLAY` as the last constructor argument
- `ClientPacketDistributor.sendToServer(payload)` for client→server
- `RegisterGuiLayersEvent#registerAboveAll(Identifier, layer)` for a HUD
- `PacketDistributor.sendToPlayer(player, payload)` for server→client
- `ServerPlayer#teleportTo(ServerLevel, x, y, z, Set, yaw, pitch, boolean)` — cross-dimension travel

## How to use this file

Read it before writing, not after failing. `ResourceKey#location` was already in the table above
when I wrote `level.dimension().location()` in CampWard and lost a round trip to it. The table is
only worth having if it is consulted.

## Deliberately routed around

- `Item#appendHoverText` — signature unverified, and 1.21.11 has moved comparable methods. Item
  lore goes through NeoForge's `ItemTooltipEvent` instead: one call site to be wrong about rather
  than fourteen overrides. The lines themselves are data in `Lore`, so the delivery mechanism can
  change without touching the writing.

## Still unverified

- `ServerPlayer#teleportTo(ServerLevel, x, y, z, Set, yaw, pitch, boolean)` — the cross-dimension
  signature. All dimension travel goes through `ChDimensions#travel` so there is one call site.
- The whole GameTest entry point — and the first guess about it was wrong in kind, not in detail.
  `gameTestApi` reported `net.minecraft.gametest.**` completely empty, with
  `net.neoforged.fml.startup.GameTestServer` the only test-shaped class on the classpath. That is
  the launcher, not the framework, so this is not an annotation that moved: the test framework is
  simply not among the artifacts ModDevGradle puts on the dev classpath. Adding it is a dependency
  question, not a source-code one. `src/gametest/java` holds the four tests, compiled only under
  `-PwithGameTest` so they cannot reach the jar. Read the `gameTestApi` output in the gametest job
  before touching `ChGameTests` again.
- Everything at runtime. CI compiles and packages; it never launches a game. That is still true —
  the tests written to change it do not compile yet.
