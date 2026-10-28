import { describe, expect, it } from "vitest";
import { resolveEnabled } from "../src/ledger/gate.js";
import { OM_ENABLED, type Entry } from "../src/ledger/types.js";

function toggle(enabled: boolean): Entry {
	return { type: "custom", customType: OM_ENABLED, id: "toggle", data: { enabled } };
}

describe("resolveEnabled", () => {
	it("uses the configured default when the branch has no explicit toggle", () => {
		expect(resolveEnabled([], true)).toBe(true);
		expect(resolveEnabled([], false)).toBe(false);
	});

	it("lets the latest explicit session toggle override the configured default", () => {
		expect(resolveEnabled([toggle(false)], true)).toBe(false);
		expect(resolveEnabled([toggle(true)], false)).toBe(true);
		expect(resolveEnabled([toggle(true), toggle(false)], true)).toBe(false);
	});
});
