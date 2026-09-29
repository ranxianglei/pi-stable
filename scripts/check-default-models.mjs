import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const MODEL_RESOLVER_RELATIVE = join("packages", "coding-agent", "src", "core", "model-resolver.ts");
const MODEL_DATA_RELATIVE = join("packages", "ai", "src", "providers", "data");
// Providers without generated catalog data (documented special cases).
const NO_CATALOG_PROVIDERS = new Set(["radius"]);
// Cloudflare AI Gateway defaults may reference Workers AI models as "workers-ai/<worker>/<model>";
// those resolve through the cloudflare-workers-ai catalog (see docs/providers.md).
const WORKERS_AI_PREFIX = "workers-ai/";
const WORKERS_AI_CATALOG_PROVIDER = "cloudflare-workers-ai";
const MAX_LISTED_MODELS = 15;

/**
 * Extract the [provider, modelId] pairs pinned in the defaultModelPerProvider map.
 * Accepts the full source of model-resolver.ts.
 */
export function parseDefaultModelPins(source) {
	const lines = source.split("\n");
	const startLine = lines.findIndex((line) => line.includes("defaultModelPerProvider"));
	if (startLine === -1) {
		throw new Error("defaultModelPerProvider declaration not found");
	}
	let endLine = -1;
	for (let i = startLine + 1; i < lines.length; i += 1) {
		if (lines[i].trimStart().startsWith("}")) {
			endLine = i;
			break;
		}
	}
	if (endLine === -1) {
		throw new Error("could not find the end of the defaultModelPerProvider block");
	}
	const block = lines.slice(startLine, endLine).join("\n");
	const pins = [];
	const entryPattern = /^\s*["']?([A-Za-z0-9_-]+)["']?\s*:\s*["']([^"']+)["']/gm;
	for (const match of block.matchAll(entryPattern)) {
		pins.push({ provider: match[1], id: match[2] });
	}
	return pins;
}

/**
 * Validate pinned defaults against generated catalogs (provider -> Set of model ids).
 * Returns a list of human-readable errors; empty means every pin resolves.
 */
export function validateDefaultModelPins(pins, catalogs) {
	const errors = [];
	for (const pin of pins) {
		if (NO_CATALOG_PROVIDERS.has(pin.provider)) {
			continue;
		}
		let ids = catalogs.get(pin.provider);
		let candidate = pin.id;
		if (ids === undefined && pin.provider === "cloudflare-ai-gateway" && pin.id.startsWith(WORKERS_AI_PREFIX)) {
			ids = catalogs.get(WORKERS_AI_CATALOG_PROVIDER);
			candidate = pin.id.slice(WORKERS_AI_PREFIX.length);
		}
		if (ids === undefined) {
			errors.push(
				`default model "${pin.id}" for provider "${pin.provider}" cannot be validated: no generated catalog data for that provider`,
			);
			continue;
		}
		if (!ids.has(candidate)) {
			const listed = [...ids].slice(0, MAX_LISTED_MODELS).join(", ");
			const suffix = ids.size > MAX_LISTED_MODELS ? ", ..." : "";
			errors.push(
				`default model "${pin.id}" for provider "${pin.provider}" does not exist in the generated catalog (available: ${listed}${suffix})`,
			);
		}
	}
	return errors;
}

function fail(message) {
	console.error(message);
	process.exit(1);
}

function main() {
	const root = fileURLToPath(new URL("..", import.meta.url));

	let resolverSource;
	try {
		resolverSource = readFileSync(join(root, MODEL_RESOLVER_RELATIVE), "utf8");
	} catch {
		fail(`Could not read ${MODEL_RESOLVER_RELATIVE}`);
	}

	let pins;
	try {
		pins = parseDefaultModelPins(resolverSource);
	} catch (error) {
		fail(`Failed to parse defaultModelPerProvider: ${error.message}`);
	}

	const dataDir = join(root, MODEL_DATA_RELATIVE);
	let entries;
	try {
		entries = readdirSync(dataDir, { withFileTypes: true });
	} catch {
		fail("Generated model data is missing. Run `npm run hydrate:model-data` first.");
	}
	const jsonFiles = entries.filter((entry) => entry.isFile() && entry.name.endsWith(".json")).map((entry) => entry.name);
	if (jsonFiles.length === 0) {
		fail("Generated model data is empty. Run `npm run hydrate:model-data` first.");
	}

	const catalogs = new Map();
	for (const file of jsonFiles) {
		const provider = file.slice(0, -".json".length);
		const parsed = JSON.parse(readFileSync(join(dataDir, file), "utf8"));
		const ids = new Set();
		for (const group of Object.values(parsed)) {
			for (const id of Object.keys(group)) {
				ids.add(id);
			}
		}
		catalogs.set(provider, ids);
	}

	const errors = validateDefaultModelPins(pins, catalogs);
	if (errors.length > 0) {
		for (const error of errors) {
			console.error(error);
		}
		process.exit(1);
	}
	console.log(`All ${pins.length} default model pins resolve in the generated catalog.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	main();
}
