// SAAS-1: scripts/server/erp-deploy.sh with a stub `docker`, in a temporary app folder. Checks the
// guarantees the trial stack adds: off without both env files; on with them; a failure there
// never fails (or rolls back) the production deploy; the env files survive the source switch;
// the build cache is pruned at the end.
//   npm test   (needs bash; skipped where there is none)
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT = fileURLToPath(new URL("../scripts/server/erp-deploy.sh", import.meta.url));
const hasBash = spawnSync("bash", ["-c", "command -v tar && command -v flock >/dev/null || true; echo ok"], { encoding: "utf8" }).stdout?.includes("ok");

// A docker that logs every call and answers like the real one; SAAS_BUILD_FAIL=1 makes the trial
// build fail, SAAS_UNHEALTHY=1 keeps the trial containers "starting".
const DOCKER = `#!/usr/bin/env bash
echo "docker $*" >> "$DOCKER_LOG"
case "$*" in
  *"-p del-groups-saas"*build*) [ "\${SAAS_BUILD_FAIL:-0}" = 1 ] && exit 1; exit 0 ;;
  "inspect -f {{.State.Health.Status}} del-groups-saas-"*) [ "\${SAAS_UNHEALTHY:-0}" = 1 ] && echo starting || echo healthy; exit 0 ;;
  "inspect -f {{.State.Health.Status}} "*) echo healthy; exit 0 ;;
  *) exit 0 ;;
esac
`;
// flock is Linux-only; a stub that always gets the lock (the real one is tested by use on the server).
const FLOCK = "#!/usr/bin/env bash\nexit 0\n";
// The healthy wait sleeps between checks; no need to wait in a test.
const SLEEP = "#!/usr/bin/env bash\nexit 0\n";

function setup({ saas = false } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), "erp-deploy-"));
  const bin = path.join(root, "bin");
  const app = path.join(root, "app");
  const src = path.join(root, "src");
  for (const d of [bin, app, src]) mkdirSync(d, { recursive: true });
  for (const [name, body] of [["docker", DOCKER], ["flock", FLOCK], ["sleep", SLEEP]]) {
    writeFileSync(path.join(bin, name), body);
    chmodSync(path.join(bin, name), 0o755);
  }
  writeFileSync(path.join(app, ".env.production"), "SECRET=prod\n");
  writeFileSync(path.join(app, "old-file.txt"), "from the previous deploy\n");
  if (saas) {
    writeFileSync(path.join(app, ".env.saas"), "CONTROL_PLANE_URL=x\n");
    writeFileSync(path.join(app, ".env.control-panel"), "NEXT_PUBLIC_SUPABASE_URL=x\n");
  }
  writeFileSync(path.join(src, "docker-compose.prod.yml"), "services: {}\n");
  writeFileSync(path.join(src, "docker-compose.saas.yml"), "services: {}\n");
  writeFileSync(path.join(src, "new-file.txt"), "new source\n");
  const tarball = path.join(root, "src.tgz");
  // Relative paths: GNU tar on Windows reads "C:" as a remote host.
  const tar = spawnSync("tar", ["czf", "src.tgz", "-C", "src", "."], { encoding: "utf8", cwd: root });
  assert.equal(tar.status, 0, tar.stderr);
  return { root, bin, app, tarball, log: path.join(root, "docker.log") };
}

function run(ctx, env = {}) {
  const r = spawnSync("bash", [SCRIPT], {
    input: readFileSync(ctx.tarball),
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${ctx.bin}${path.delimiter}${process.env.PATH}`,
      ERP_DEPLOY_APP_DIR: ctx.app,
      ERP_DEPLOY_LOCK: path.join(ctx.root, "deploy.lock"),
      DOCKER_LOG: ctx.log,
      ...env,
    },
  });
  const calls = existsSync(ctx.log) ? readFileSync(ctx.log, "utf8").split("\n").filter(Boolean) : [];
  return { status: r.status, out: `${r.stdout}${r.stderr}`, calls };
}

test("without the two env files the trial stack stays off; production deploys and the cache is pruned", { skip: !hasBash }, () => {
  const ctx = setup();
  try {
    const r = run(ctx);
    assert.equal(r.status, 0, r.out);
    assert.match(r.out, /==> deploy ok/);
    assert.match(r.out, /trial stack: off/);
    assert.ok(!r.calls.some((c) => c.includes("del-groups-saas")), "no saas compose call");
    assert.ok(r.calls.some((c) => c.startsWith("docker compose -p del-groups-erp") && c.endsWith(" up -d")), "production restarted");
    assert.equal(r.calls.at(-1), "docker builder prune -af --filter until=72h");
    // The source was switched and the production env kept.
    assert.ok(existsSync(path.join(ctx.app, "new-file.txt")));
    assert.ok(!existsSync(path.join(ctx.app, "old-file.txt")));
    assert.equal(readFileSync(path.join(ctx.app, ".env.production"), "utf8"), "SECRET=prod\n");
  } finally {
    rmSync(ctx.root, { recursive: true, force: true });
  }
});

test("with both env files the trial stack is built from staging, restarted and checked; the env files survive", { skip: !hasBash }, () => {
  const ctx = setup({ saas: true });
  try {
    const r = run(ctx);
    assert.equal(r.status, 0, r.out);
    assert.match(r.out, /==> trial stack ok/);
    const saas = r.calls.filter((c) => c.includes("-p del-groups-saas"));
    assert.equal(saas.length, 2, saas.join("\n"));
    assert.match(saas[0], / build --quiet$/);
    assert.match(saas[1], / up -d$/);
    assert.match(saas[0], new RegExp(`--env-file ${ctx.app.replace(/\\/g, "\\\\")}.\\.env\\.saas --env-file .*\\.env\\.control-panel -f docker-compose\\.saas\\.yml`));
    // The saas step comes after production is healthy, and the prune after everything.
    const prodUp = r.calls.findIndex((c) => c.startsWith("docker compose -p del-groups-erp") && c.endsWith(" up -d"));
    assert.ok(prodUp >= 0 && prodUp < r.calls.indexOf(saas[0]));
    assert.equal(r.calls.at(-1), "docker builder prune -af --filter until=72h");
    for (const f of [".env.production", ".env.saas", ".env.control-panel"]) assert.ok(existsSync(path.join(ctx.app, f)), `${f} kept`);
  } finally {
    rmSync(ctx.root, { recursive: true, force: true });
  }
});

test("a failing trial build or an unhealthy trial container only warns: the production deploy still succeeds", { skip: !hasBash }, () => {
  for (const env of [{ SAAS_BUILD_FAIL: "1" }, { SAAS_UNHEALTHY: "1" }]) {
    const ctx = setup({ saas: true });
    try {
      const r = run(ctx, env);
      assert.equal(r.status, 0, `${JSON.stringify(env)}\n${r.out}`);
      assert.match(r.out, /==> deploy ok/);
      assert.match(r.out, /!! WARNING: trial stack \(del-groups-saas\) not updated - production deploy is fine/);
      // Nothing touches production after the warning (no rollback, no second production up).
      const prodUps = r.calls.filter((c) => c.startsWith("docker compose -p del-groups-erp") && c.endsWith(" up -d"));
      assert.equal(prodUps.length, 1);
      if (env.SAAS_BUILD_FAIL) assert.ok(!r.calls.some((c) => c.includes("-p del-groups-saas") && c.endsWith(" up -d")), "no saas up after a failed build");
      assert.equal(r.calls.at(-1), "docker builder prune -af --filter until=72h");
    } finally {
      rmSync(ctx.root, { recursive: true, force: true });
    }
  }
});

test("the script is still the forced command production uses: same lock, project, image check and wait", () => {
  const sh = readFileSync(SCRIPT, "utf8").replace(/\r\n/g, "\n");
  assert.match(sh, /APP_DIR=\$\{ERP_DEPLOY_APP_DIR:-\/opt\/del-groups-erp\}/);
  assert.match(sh, /LOCK_FILE=\$\{ERP_DEPLOY_LOCK:-\/run\/lock\/del-groups-erp-deploy\.lock\}/);
  assert.match(sh, /COMPOSE=\(docker compose -p "\$PROJECT" --env-file \.env\.production -f docker-compose\.prod\.yml\)/);
  assert.match(sh, /deploy_saas \|\| echo "!! WARNING/);
  assert.match(sh, /KEEP=\(\.env\.production \.env\.saas \.env\.control-panel\)/);
});
