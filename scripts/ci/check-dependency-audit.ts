const ALLOWED_ADVISORIES = new Map<string, string>([
  [
    "https://github.com/advisories/GHSA-r5fr-rjxr-66jc",
    "Transitive via vinxi -> nitropack/archiver-utils -> lodash. Awaiting upstream toolchain update.",
  ],
  [
    "https://github.com/advisories/GHSA-f23m-r3pf-42rh",
    "Transitive via vinxi -> nitropack/archiver-utils -> lodash. Awaiting upstream toolchain update.",
  ],
  [
    "https://github.com/advisories/GHSA-2328-f5f3-gj25",
    "Transitive via vinxi -> listhen/@vinxi/listhen -> node-forge. Awaiting upstream toolchain update.",
  ],
  [
    "https://github.com/advisories/GHSA-q67f-28xg-22rw",
    "Transitive via vinxi -> listhen/@vinxi/listhen -> node-forge. Awaiting upstream toolchain update.",
  ],
  [
    "https://github.com/advisories/GHSA-5m6q-g25r-mvwx",
    "Transitive via vinxi -> listhen/@vinxi/listhen -> node-forge. Awaiting upstream toolchain update.",
  ],
  [
    "https://github.com/advisories/GHSA-ppp5-5v6c-4jwp",
    "Transitive via vinxi -> listhen/@vinxi/listhen -> node-forge. Awaiting upstream toolchain update.",
  ],
]);

const audit = Bun.spawnSync(["bun", "audit"], {
  stdout: "pipe",
  stderr: "pipe",
  env: process.env,
});

const rawOutput = `${audit.stdout.toString()}${audit.stderr.toString()}`.trim();
console.log(rawOutput);

const advisoryRegex = /(https:\/\/github\.com\/advisories\/GHSA-[a-z0-9-]+)/gi;
const foundAdvisories = new Set<string>();

for (const match of rawOutput.matchAll(advisoryRegex)) {
  foundAdvisories.add(match[1]);
}

if (foundAdvisories.size === 0) {
  if (audit.exitCode !== 0) {
    console.error("[dependency-audit] bun audit failed without parsable advisory output.");
    process.exit(audit.exitCode || 1);
  }
  console.log("[dependency-audit] OK: no dependency advisories reported.");
  process.exit(0);
}

const unknownAdvisories = [...foundAdvisories].filter((url) => !ALLOWED_ADVISORIES.has(url));
if (unknownAdvisories.length > 0) {
  console.error("[dependency-audit] Found unallowlisted advisories:");
  for (const advisory of unknownAdvisories) {
    console.error(` - ${advisory}`);
  }
  process.exit(1);
}

const missingAllowlistEntries = [...ALLOWED_ADVISORIES.keys()].filter((url) => !foundAdvisories.has(url));
if (missingAllowlistEntries.length > 0) {
  console.error("[dependency-audit] Allowlist is stale; one or more accepted advisories disappeared:");
  for (const advisory of missingAllowlistEntries) {
    console.error(` - ${advisory}`);
  }
  console.error("[dependency-audit] Remove stale allowlist entries before merging.");
  process.exit(1);
}

console.warn("[dependency-audit] Only allowlisted upstream advisories remain:");
for (const advisory of foundAdvisories) {
  console.warn(` - ${advisory}: ${ALLOWED_ADVISORIES.get(advisory)}`);
}

console.warn("[dependency-audit] CI is passing because these advisories are currently upstream-only and explicitly tracked.");
