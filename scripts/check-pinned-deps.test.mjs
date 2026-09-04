import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const pinnedDepsScript = fileURLToPath(new URL("./check-pinned-deps.mjs", import.meta.url));

async function writeManifest(root, relativeDirectory, manifest) {
	const directory = join(root, relativeDirectory);
	await mkdir(directory, { recursive: true });
	await writeFile(join(directory, "package.json"), `${JSON.stringify(manifest, null, "\t")}\n`);
}

function runPinnedDepsCheck(root) {
	return spawnSync(process.execPath, [pinnedDepsScript], {
		cwd: root,
		encoding: "utf8",
	});
}

test("exempts the exact-name workspace package pi-stable while still pinning external ranges", async () => {
	const root = await mkdtemp(join(tmpdir(), "pi-pinned-deps-"));
	try {
	// coding-agent publishes as exactly `pi-stable` (no `-` suffix)
	await writeManifest(root, "packages/coding-agent", {
		name: "pi-stable",
		version: "2.0.0",
	});
	// lockstep sync rewrites the internal specifier to a range; an external
	// dep (`chalk`) is left as a range too, so it must still fail
	await writeManifest(root, "packages/server", {
		name: "pi-stable-server",
	dependencies: {
		"pi-stable": "^2.0.0",
		chalk: "^1.0.0",
	},
});

	const result = runPinnedDepsCheck(root);
	assert.equal(result.status, 1, result.stderr);
	// the only unpinned external is chalk: the failure must name chalk
	assert.ok(result.stderr.includes("dependencies.chalk"), result.stderr);
	// `pi-stable` is an internal workspace package, so it must not be flagged
	assert.ok(!result.stderr.includes("dependencies.pi-stable "), result.stderr);

} finally {
	await rm(root, { recursive: true, force: true });
}
});
