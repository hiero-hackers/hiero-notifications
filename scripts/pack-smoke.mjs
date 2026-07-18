/**
 * Tarball smoke test: `npm run test:pack`.
 *
 * The unit tests exercise the repo; this exercises the ARTIFACT: `npm pack`,
 * install the tarball into a scratch project, import the library through the
 * published entry point, and run the `hiero-notify` bin — the only way to
 * catch a missing `files` entry, a broken exports condition, or a bin path
 * typo before a consumer does. Offline: no watcher is started.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const scratch = mkdtempSync(join(tmpdir(), "hiero-notifications-pack-smoke-"));

const assert = (cond, why) => {
  if (!cond) {
    console.error(`SMOKE FAIL: ${why}`);
    process.exit(1);
  }
};

try {
  // The `prepare` (build) output lands on stdout too — filename is the LAST line.
  const tarball = execFileSync(npm, ["pack", "--pack-destination", scratch], {
    cwd: root,
    stdio: ["ignore", "pipe", "inherit"],
  })
    .toString()
    .trim()
    .split("\n")
    .pop();

  writeFileSync(
    join(scratch, "package.json"),
    JSON.stringify({ name: "pack-smoke-consumer", private: true, type: "module" }),
  );
  // The tarball's dependencies live on GitHub Packages — the scratch project
  // needs the scope mapping (auth comes from the user/CI npmrc).
  writeFileSync(join(scratch, ".npmrc"), "@hiero-hackers:registry=https://npm.pkg.github.com\n");
  execFileSync(npm, ["install", "--no-audit", "--no-fund", join(scratch, tarball)], {
    cwd: scratch,
    stdio: "inherit",
  });

  // 1. The library entry: exports resolve, a condition composes and runs.
  writeFileSync(
    join(scratch, "smoke.mjs"),
    `
import { anyOf, inflowAtLeast, stakingReward } from "@hiero-hackers/hiero-notifications";
const condition = anyOf(inflowAtLeast(100), stakingReward);
if (condition.name !== "inflow>=100h|staking-reward") {
  console.error("SMOKE FAIL: condition composition: " + condition.name);
  process.exit(1);
}
console.log("library entry ✓");
`,
  );
  execFileSync(process.execPath, ["smoke.mjs"], { cwd: scratch, stdio: "inherit" });

  // 2. The bin: installed, on the scratch project's path, exits 2 with usage.
  const bin = spawnSync(
    npm,
    ["exec", "--no-install", "hiero-notify"],
    { cwd: scratch, encoding: "utf8", timeout: 20000 },
  );
  assert(bin.status === 2, `bin should exit 2 without args, got ${bin.status}`);
  assert(bin.stderr.includes("hiero-notify --config FILE"), "bin should print usage");
  console.log("pack smoke: tarball installs; library and bin both work ✓");
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
