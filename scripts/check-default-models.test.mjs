import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { parseDefaultModelPins, validateDefaultModelPins } from "./check-default-models.mjs";

const SAMPLE_SOURCE = `// comment above the map
const defaultModelPerProvider = {
	openai: "gpt-5.5",
	"zai-coding-cn": "glm-5.3",
	"cloudflare-ai-gateway": "workers-ai/@cf/moonshotai/kimi-k2.6",
	radius: "auto",
};

function other() {
	return {};
}
`;

test("parseDefaultModelPins extracts provider and model id pairs in order", () => {
	assert.deepEqual(parseDefaultModelPins(SAMPLE_SOURCE), [
		{ provider: "openai", id: "gpt-5.5" },
		{ provider: "zai-coding-cn", id: "glm-5.3" },
		{ provider: "cloudflare-ai-gateway", id: "workers-ai/@cf/moonshotai/kimi-k2.6" },
		{ provider: "radius", id: "auto" },
	]);
});

test("parseDefaultModelPins rejects sources without the map", () => {
	assert.throws(() => parseDefaultModelPins("const x = {};\n"), /defaultModelPerProvider declaration not found/);
});

test("validateDefaultModelPins accepts pins that resolve and skips radius", () => {
	const catalogs = new Map([
		["openai", new Set(["gpt-5.5"])],
		["zai", new Set(["glm-4.7", "glm-5.3"])],
	]);
	const errors = validateDefaultModelPins(
		[
			{ provider: "openai", id: "gpt-5.5" },
			{ provider: "zai", id: "glm-5.3" },
			{ provider: "radius", id: "auto" },
		],
		catalogs,
	);
	assert.deepEqual(errors, []);
});

test("validateDefaultModelPins reports dead model ids with available alternatives", () => {
	const catalogs = new Map([["cerebras", new Set(["gpt-oss-120b", "qwen-3.8-27b"])]]);
	const errors = validateDefaultModelPins([{ provider: "cerebras", id: "zai-glm-4.7" }], catalogs);
	assert.equal(errors.length, 1);
	assert.match(errors[0], /does not exist in the generated catalog/);
	assert.match(errors[0], /available: gpt-oss-120b, qwen-3.8-27b/);
});

test("validateDefaultModelPins reports providers without generated catalog data", () => {
	const errors = validateDefaultModelPins([{ provider: "unknown-provider", id: "some-model" }], new Map());
	assert.equal(errors.length, 1);
	assert.match(errors[0], /no generated catalog data/);
});

test("validateDefaultModelPins resolves cloudflare-ai-gateway workers-ai prefixes against cloudflare-workers-ai", () => {
	const catalogs = new Map([["cloudflare-workers-ai", new Set(["@cf/moonshotai/kimi-k2.6", "@cf/openai/gpt-5.5"])]]);
	const ok = validateDefaultModelPins([{ provider: "cloudflare-ai-gateway", id: "workers-ai/@cf/moonshotai/kimi-k2.6" }], catalogs);
	assert.deepEqual(ok, []);
	const dead = validateDefaultModelPins([{ provider: "cloudflare-ai-gateway", id: "workers-ai/@cf/openai/gpt-9.9" }], catalogs);
	assert.equal(dead.length, 1);
	assert.match(dead[0], /does not exist in the generated catalog/);
});

test("the real model-resolver.ts parses to the expected pin set", () => {
	const source = readFileSync(fileURLToPath(new URL("../packages/coding-agent/src/core/model-resolver.ts", import.meta.url)), "utf8");
	const pins = parseDefaultModelPins(source);
	const byProvider = new Map(pins.map((pin) => [pin.provider, pin.id]));
	assert.equal(byProvider.get("radius"), "auto");
	assert.equal(byProvider.get("cerebras"), "gpt-oss-120b");
	assert.equal(byProvider.get("zai"), "glm-5.3");
	assert.equal(byProvider.get("zai-coding-cn"), "glm-5.3");
	assert.equal(byProvider.get("together"), "moonshotai/Kimi-K3");
	assert.equal(byProvider.get("opencode-go"), "kimi-k3");
	assert.equal(byProvider.get("cloudflare-ai-gateway"), "gpt-5.5");
	// Pinned defaults for providers that keep their ids must not drift silently.
	assert.equal(byProvider.get("openai"), "gpt-5.5");
	assert.equal(byProvider.get("minimax"), "MiniMax-M2.7");
});
