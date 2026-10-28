import { OM_ENABLED, type Entry } from "./types.js";

/** Explicit session state overrides the configured default; absent state falls back to config. */
export function resolveEnabled(branch: Entry[], defaultEnabled: boolean): boolean {
	for (let i = branch.length - 1; i >= 0; i--) {
		const entry = branch[i];
		if (entry.type === "custom" && entry.customType === OM_ENABLED) {
			return (entry.data as { enabled?: boolean } | undefined)?.enabled ?? false;
		}
	}
	return defaultEnabled;
}
