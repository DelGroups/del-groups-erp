// Server deploy script: the Docker build cache is pruned so the disk cannot fill up.
//   npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const script = readFileSync(new URL("../scripts/server/erp-deploy.sh", import.meta.url), "utf8");

test("old build cache is pruned before the build and after a healthy deploy", () => {
  assert.match(script, /docker builder prune -f --filter "until=\$BUILD_CACHE_MAX_AGE"/);
  const calls = [...script.matchAll(/^\s+prune_build_cache$/gm)];
  assert.equal(calls.length, 2);
  const before = script.indexOf("    prune_build_cache\n");
  assert.ok(before > 0 && before < script.indexOf('echo "==> building image"'), "prune comes before the build");
  assert.ok(script.lastIndexOf("prune_build_cache") > script.indexOf("docker image prune -f"), "prune after healthy deploy");
});

test("pruning never stops a deploy and never touches volumes", () => {
  assert.match(script, /docker builder prune[^\n]*\|\| true/);
  assert.doesNotMatch(script, /--volumes|volume prune|system prune/);
});
