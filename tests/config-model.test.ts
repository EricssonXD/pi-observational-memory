import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadConfig, saveConfiguredModel } from "../src/config.js";

const testPaths = vi.hoisted(() => ({ agentDir: "" }));
vi.mock("@earendil-works/pi-coding-agent", () => ({ getAgentDir: () => testPaths.agentDir }));

describe("saveConfiguredModel", () => {
	let cwd: string | undefined;
	let agentDir: string | undefined;
	afterEach(() => {
		if (cwd) rmSync(cwd, { recursive: true, force: true });
		if (agentDir) rmSync(agentDir, { recursive: true, force: true });
		cwd = undefined;
		agentDir = undefined;
		testPaths.agentDir = "";
	});

	it("updates one project model while preserving other settings and thinking level", () => {
		cwd = mkdtempSync(join(tmpdir(), "om-config-"));
		const settingsPath = join(cwd, ".pi", "settings.json");
		mkdirSync(join(cwd, ".pi"));
		writeFileSync(settingsPath, JSON.stringify({
			other: { keep: true },
			"observational-memory": {
				chunkTokens: 5000,
				models: {
					observer: { provider: "old", id: "old-model", thinking: "high" },
					consolidator: { provider: "keep", id: "this-model", thinking: "medium" },
				},
			},
		}));

		saveConfiguredModel(cwd, "observer", { provider: "new", id: "new-model", thinking: "high" });

		const saved = JSON.parse(readFileSync(settingsPath, "utf-8"));
		expect(saved.other).toEqual({ keep: true });
		expect(saved["observational-memory"].chunkTokens).toBe(5000);
		expect(saved["observational-memory"].models).toEqual({
			observer: { provider: "new", id: "new-model", thinking: "high" },
			consolidator: { provider: "keep", id: "this-model", thinking: "medium" },
		});
	});

	it("keeps the global consolidator model when the project overrides only the observer", () => {
		cwd = mkdtempSync(join(tmpdir(), "om-project-config-"));
		agentDir = mkdtempSync(join(tmpdir(), "om-global-config-"));
		testPaths.agentDir = agentDir;
		writeFileSync(join(agentDir, "settings.json"), JSON.stringify({
			"observational-memory": {
				models: {
					observer: { provider: "global", id: "observer" },
					consolidator: { provider: "global", id: "consolidator" },
				},
			},
		}));
		saveConfiguredModel(cwd, "observer", { provider: "project", id: "observer" });

		const config = loadConfig(cwd);
		expect(config.models.observer).toMatchObject({ provider: "project", id: "observer" });
		expect(config.models.consolidator).toMatchObject({ provider: "global", id: "consolidator" });
	});

	it("does not overwrite malformed project settings", () => {
		cwd = mkdtempSync(join(tmpdir(), "om-config-"));
		const settingsPath = join(cwd, ".pi", "settings.json");
		mkdirSync(join(cwd, ".pi"));
		writeFileSync(settingsPath, "{invalid json");

		expect(() => saveConfiguredModel(cwd!, "observer", { provider: "new", id: "new-model" })).toThrow();
		expect(readFileSync(settingsPath, "utf-8")).toBe("{invalid json");
		expect(existsSync(settingsPath)).toBe(true);
	});
});
