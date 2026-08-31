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

## Still unverified

- `ServerPlayer#teleportTo(ServerLevel, x, y, z, Set, yaw, pitch, boolean)` — the cross-dimension
  signature. All dimension travel goes through `ChDimensions#travel` so there is one call site.
- Everything at runtime. CI compiles and packages; it never launches a game.
