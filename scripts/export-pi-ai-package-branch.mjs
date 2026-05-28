#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

function redact(value) {
  return value
    .replace(/https:\/\/[^\s/@]+:[^\s/@]+@/g, "https://<redacted>@")
    .replace(/https:\/\/[^\s/@]+@/g, "https://<redacted>@");
}

function run(command, args, options = {}) {
  const cwd = options.cwd ?? process.cwd();
  console.log(`$ ${command} ${args.map(redact).join(" ")}`);
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
  });

  if (result.status !== 0) {
    if (options.capture) {
      if (result.stdout) process.stdout.write(result.stdout);
      if (result.stderr) process.stderr.write(result.stderr);
    }
    throw new Error(
      `${command} ${args.join(" ")} failed with exit code ${result.status ?? "unknown"}`,
    );
  }

  return options.capture ? result.stdout.trim() : "";
}

function git(args, options = {}) {
  return run("git", args, options);
}

function clearDirectoryExceptGit(directory) {
  for (const entry of readdirSync(directory)) {
    if (entry === ".git") continue;
    rmSync(join(directory, entry), { recursive: true, force: true });
  }
}

function checkoutTargetBranch(directory, remoteUrl, targetBranch) {
  git(["init"], { cwd: directory });
  git(["remote", "add", "origin", remoteUrl], { cwd: directory });

  const remoteBranch = run(
    "git",
    ["ls-remote", "--heads", remoteUrl, targetBranch],
    { capture: true },
  );

  if (remoteBranch.length > 0) {
    git(
      [
        "fetch",
        "--depth=1",
        "origin",
        `refs/heads/${targetBranch}:refs/remotes/origin/${targetBranch}`,
      ],
      { cwd: directory },
    );
    git(["checkout", "-B", targetBranch, `refs/remotes/origin/${targetBranch}`], {
      cwd: directory,
    });
  } else {
    git(["checkout", "--orphan", targetBranch], { cwd: directory });
  }
}

function hasStagedChanges(directory) {
  const result = spawnSync("git", ["diff", "--cached", "--quiet"], {
    cwd: directory,
    stdio: "inherit",
  });
  if (result.status === 0) return false;
  if (result.status === 1) return true;
  throw new Error(
    `git diff --cached --quiet failed with exit code ${result.status ?? "unknown"}`,
  );
}

function parsePackOutput(output) {
  const parsed = JSON.parse(output);
  if (!Array.isArray(parsed) || parsed.length !== 1) {
    throw new Error("Expected npm pack --json to return exactly one package");
  }
  const entry = parsed[0];
  if (typeof entry.filename !== "string") {
    throw new Error("npm pack --json output did not include a filename");
  }
  return entry.filename;
}

const repoRoot = git(["rev-parse", "--show-toplevel"], { capture: true });
const sourceCommit = git(["rev-parse", "HEAD"], { cwd: repoRoot, capture: true });
const sourceBranch = git(["branch", "--show-current"], {
  cwd: repoRoot,
  capture: true,
});
const exportBranch = process.env.PI_AI_EXPORT_BRANCH ?? "pi-ai";
const remoteName = process.env.PI_AI_EXPORT_REMOTE ?? "origin";
const pushExport = process.env.PI_AI_EXPORT_PUSH !== "0";
const buildPackage = process.env.PI_AI_EXPORT_SKIP_BUILD !== "1";
const remoteUrl =
  process.env.PI_AI_EXPORT_REMOTE_URL ??
  git(["remote", "get-url", "--push", remoteName], {
    cwd: repoRoot,
    capture: true,
  });

if (buildPackage) {
  run("npm", ["--workspace", "packages/ai", "run", "build"], { cwd: repoRoot });
}

const scratchDir = mkdtempSync(join(tmpdir(), "pi-ai-export-"));
const packDir = join(scratchDir, "pack");
const branchDir = join(scratchDir, "branch");

try {
  mkdirSync(packDir, { recursive: true });
  mkdirSync(branchDir, { recursive: true });

  const packOutput = run(
    "npm",
    ["pack", "--workspace", "packages/ai", "--pack-destination", packDir, "--json"],
    { cwd: repoRoot, capture: true },
  );
  const tarballName = parsePackOutput(packOutput);
  const tarballPath = join(packDir, basename(tarballName));
  const unpackDir = join(packDir, "unpacked");
  mkdirSync(unpackDir, { recursive: true });
  run("tar", ["-xzf", tarballPath, "-C", unpackDir]);

  checkoutTargetBranch(branchDir, remoteUrl, exportBranch);
  clearDirectoryExceptGit(branchDir);
  cpSync(join(unpackDir, "package"), branchDir, { recursive: true });

  writeFileSync(
    join(branchDir, ".pi-ai-source.json"),
    `${JSON.stringify(
      {
        package: "@earendil-works/pi-ai",
        sourceBranch,
        sourceCommit,
        generatedAt: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
  );

  git(["config", "user.name", "github-actions[bot]"], { cwd: branchDir });
  git(["config", "user.email", "github-actions[bot]@users.noreply.github.com"], {
    cwd: branchDir,
  });
  git(["add", "--all"], { cwd: branchDir });

  if (!hasStagedChanges(branchDir)) {
    console.log(`No changes to export for ${exportBranch}`);
  } else {
    git(["commit", "-m", `build(ai): export pi-ai from ${sourceCommit.slice(0, 12)}`], {
      cwd: branchDir,
    });
  }

  if (pushExport) {
    git(["push", "origin", `HEAD:refs/heads/${exportBranch}`], { cwd: branchDir });
  } else {
    console.log(`Export prepared at ${branchDir}`);
  }
} finally {
  if (process.env.PI_AI_EXPORT_KEEP_SCRATCH === "1") {
    console.log(`Kept export scratch directory at ${scratchDir}`);
  } else {
    rmSync(scratchDir, { recursive: true, force: true });
  }
}
