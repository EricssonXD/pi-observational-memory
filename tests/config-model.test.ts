import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadConfig, saveConfiguredModel, saveEnabledByDefault } from "../src/config.js";
import { resolveEnabled } from "../src/ledger/gate.js";

const testPaths = vi.hoisted(() => ({ agentDir: "" }));
vi.mock("@earendil-works/pi-coding-agent", () => ({ getAgentDir: () => testPaths.agentDir }));

describe("observational-memory config", () => {
	let cwd: string | undefined;
	let agentDir: string | undefined;
	afterEach(() => {
		if (cwd) rmSync(cwd, { recursive: true, force: true });
		if (agentDir) rmSync(agentDir, { recursive: true, force: true });
		cwd = undefined;
		agentDir = undefined;
		testPaths.agentDir = "";
	});

	it("defaults the gate off but honors the repo default in project settings", () => {
		cwd = mkdtempSync(join(tmpdir(), "om-project-config-"));
		agentDir = mkdtempSync(join(tmpdir(), "om-global-config-"));
		testPaths.agentDir = agentDir;
		expect(loadConfig(cwd).enabledByDefault).toBe(false);

		const settingsPath = join(cwd, ".pi", "settings.json");
		mkdirSync(join(cwd, ".pi"));
		writeFileSync(settingsPath, JSON.stringify({ "observational-memory": { enabledByDefault: true } }));
		const config = loadConfig(cwd);
		expect(config.enabledByDefault).toBe(true);
		expect(resolveEnabled([], config.enabledByDefault)).toBe(true);
		writeFileSync(settingsPath, JSON.stringify({ "observational-memory": { enabledByDefault: false } }));
		const disabledConfig = loadConfig(cwd);
		expect(disabledConfig.enabledByDefault).toBe(false);
		expect(resolveEnabled([], disabledConfig.enabledByDefault)).toBe(false);
	});

	it("uses the global default when the project has no override", () => {
		cwd = mkdtempSync(join(tmpdir(), "om-project-config-"));
		agentDir = mkdtempSync(join(tmpdir(), "om-global-config-"));
		testPaths.agentDir = agentDir;
		writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ "observational-memory": { enabledByDefault: true } }));
		expect(loadConfig(cwd).enabledByDefault).toBe(true);

		mkdirSync(join(cwd, ".pi"));
		writeFileSync(join(cwd, ".pi", "settings.json"), JSON.stringify({ "observational-memory": { enabledByDefault: false } }));
		expect(loadConfig(cwd).enabledByDefault).toBe(false);
	});

	it("writes project/global defaults without losing other settings and respects project precedence", () => {
		cwd = mkdtempSync(join(tmpdir(), "om-project-config-"));
		agentDir = mkdtempSync(join(tmpdir(), "om-global-config-"));
		testPaths.agentDir = agentDir;
		mkdirSync(join(cwd, ".pi"));
		writeFileSync(join(cwd, ".pi", "settings.json"), JSON.stringify({
			other: "preserved",
			"observational-memory": { enabledByDefault: false, debugLog: true },
		}));
		writeFileSync(join(agentDir, "settings.json"), JSON.stringify({
			globalOther: "preserved",
			"observational-memory": { enabledByDefault: true, passive: true },
		}));
		expect(loadConfig(cwd).enabledByDefault).toBe(false);

		saveEnabledByDefault(cwd, false, "global");
		expect(loadConfig(cwd).enabledByDefault).toBe(false);
		expect(JSON.parse(readFileSync(join(agentDir, "settings.json"), "utf-8"))).toMatchObject({
			globalOther: "preserved",
			"observational-memory": { enabledByDefault: false, passive: true },
		});

		saveEnabledByDefault(cwd, true, "project");
		expect(loadConfig(cwd).enabledByDefault).toBe(true);
		expect(JSON.parse(readFileSync(join(cwd, ".pi", "settings.json"), "utf-8"))).toMatchObject({
			other: "preserved",
			"observational-memory": { enabledByDefault: true, debugLog: true },
		});
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
