# Verification tools

The mod's Minecraft-facing surface is checked against the official Yarn
mappings rather than by eye. That matters most for mixins: a renamed method in a
new Minecraft version is a silent failure at game launch, but a named error
here.

```
git clone --depth 1 --branch 1.21.4 https://github.com/FabricMC/yarn /tmp/yarn
python3 tools/index_yarn.py /tmp/yarn /tmp/yarn-index.json
python3 tools/verify_against_yarn.py /tmp/yarn-index.json
```

`index_yarn.py` turns a Yarn checkout into a symbol index, remapping descriptors
from intermediary to Yarn names. It also recovers whether each method is static,
which the descriptors do not record: Enigma numbers a static method's first
parameter 0 and an instance method's 1, so the lowest `ARG` index tells them
apart. That is what catches a mixin handler declared as an instance method
against a static target, which otherwise fails only at runtime.

`verify_against_yarn.py` checks every `net.minecraft` import, every `@Mixin`
target, every injected method name and descriptor, every `@Shadow` and
`@Accessor` field, and every handler's staticness.

Run both after changing the Minecraft version in `gradle.properties`, against
the matching Yarn branch.
