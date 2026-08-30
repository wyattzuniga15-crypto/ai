#!/usr/bin/env sh
# Compiles and runs the Minecraft-free core/ domain model.
#
# This exists because the full Gradle build needs maven.neoforged.net and Mojang's piston-meta,
# which are not reachable from every environment. core/ imports no Minecraft types by design
# (ARCHITECTURE §2), so it can always be verified with nothing but a JDK and Maven Central.
set -eu

here=$(cd "$(dirname "$0")/.." && pwd)
cd "$here"

JUNIT_VERSION=1.11.4
JUNIT_JAR=.tools/junit.jar

if [ ! -f "$JUNIT_JAR" ]; then
    mkdir -p .tools
    curl -sSfL -o "$JUNIT_JAR" \
      "https://repo1.maven.org/maven2/org/junit/platform/junit-platform-console-standalone/${JUNIT_VERSION}/junit-platform-console-standalone-${JUNIT_VERSION}.jar"
fi

rm -rf build/core-classes
mkdir -p build/core-classes
find src -name '*.java' > build/core-sources.txt
javac -Xlint:all -Werror -cp "$JUNIT_JAR" -d build/core-classes @build/core-sources.txt

java -jar "$JUNIT_JAR" execute \
    --class-path build/core-classes \
    --scan-class-path \
    --details=summary \
    --disable-ansi-colors
