import { compare, valid } from "semver";
import { PACKAGE_NAME } from "../config.ts";
import { getPiUserAgent } from "./pi-user-agent.ts";

const LATEST_VERSION_URL = "https://pi.dev/api/latest-version";
const NPM_REGISTRY_URL = `https://registry.npmjs.org/${PACKAGE_NAME}/latest`;
const DEFAULT_VERSION_CHECK_TIMEOUT_MS = 10000;

export interface LatestPiRelease {
	version: string;
	packageName?: string;
	note?: string;
}

export function comparePackageVersions(leftVersion: string, rightVersion: string): number | undefined {
	const left = valid(leftVersion.trim());
	const right = valid(rightVersion.trim());
	if (!left || !right) {
		return undefined;
	}
	return compare(left, right);
}

export function isNewerPackageVersion(candidateVersion: string, currentVersion: string): boolean {
	const comparison = comparePackageVersions(candidateVersion, currentVersion);
	if (comparison !== undefined) {
		return comparison > 0;
	}
	return candidateVersion.trim() !== currentVersion.trim();
}

export async function getLatestPiRelease(
	currentVersion: string,
	options: { timeoutMs?: number } = {},
): Promise<LatestPiRelease | undefined> {
	if (process.env.PI_OFFLINE) return undefined;
	const timeoutMs = options.timeoutMs ?? DEFAULT_VERSION_CHECK_TIMEOUT_MS;

	// Fork-aware: query npm registry for THIS package (PACKAGE_NAME) first.
	// pi.dev/api/latest-version reports the upstream release, which is wrong
	// for forks (it would "update" a fork back to @earendil-works/pi-*).
	// npm registry is authoritative for the installed package name.
	try {
		const npmRes = await fetch(NPM_REGISTRY_URL, {
			headers: { accept: "application/json" },
			signal: AbortSignal.timeout(timeoutMs),
		});
		if (npmRes.ok) {
			const npmData = (await npmRes.json()) as { version?: unknown };
			if (typeof npmData.version === "string" && npmData.version.trim()) {
				return { version: npmData.version.trim(), packageName: PACKAGE_NAME };
			}
		}
	} catch {
		// npm unreachable — fall through to pi.dev
	}

	// Fallback: pi.dev endpoint. Only trust if it names the same package as
	// ours; otherwise ignore (it is the upstream release, not ours).
	const response = await fetch(LATEST_VERSION_URL, {
		headers: {
			"User-Agent": getPiUserAgent(currentVersion),
			accept: "application/json",
		},
		signal: AbortSignal.timeout(timeoutMs),
	});
	if (!response.ok) return undefined;

	const data = (await response.json()) as {
		packageName?: unknown;
		version?: unknown;
		note?: unknown;
	};
	if (typeof data.version !== "string" || !data.version.trim()) {
		return undefined;
	}
	const upstreamPackageName =
		typeof data.packageName === "string" && data.packageName.trim() ? data.packageName.trim() : undefined;
	if (upstreamPackageName && upstreamPackageName !== PACKAGE_NAME) {
		// pi.dev is reporting the upstream release, not ours. Ignore it.
		return undefined;
	}
	const note = typeof data.note === "string" && data.note.trim() ? data.note.trim() : undefined;
	return {
		version: data.version.trim(),
		packageName: PACKAGE_NAME,
		...(note ? { note } : {}),
	};
}

export async function getLatestPiVersion(
	currentVersion: string,
	options: { timeoutMs?: number } = {},
): Promise<string | undefined> {
	return (await getLatestPiRelease(currentVersion, options))?.version;
}

export async function checkForNewPiVersion(currentVersion: string): Promise<LatestPiRelease | undefined> {
	if (process.env.PI_SKIP_VERSION_CHECK) return undefined;

	try {
		const latestRelease = await getLatestPiRelease(currentVersion);
		if (latestRelease && isNewerPackageVersion(latestRelease.version, currentVersion)) {
			return latestRelease;
		}
		return undefined;
	} catch {
		return undefined;
	}
}
