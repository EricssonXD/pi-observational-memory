import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../src/config.js";
import { registerDefaultCommand } from "../src/commands/default.js";

const testPaths = vi.hoisted(() => ({ agentDir: "" }));
vi.mock("@earendil-works/pi-coding-agent", () => ({ getAgentDir: () => testPaths.agentDir }));

let projectDir: string | undefined;
let agentDir: string | undefined;
afterEach(() => {
	if (projectDir) rmSync(projectDir, { recursive: true, force: true });
	if (agentDir) rmSync(agentDir, { recursive: true, force: true });
	projectDir = undefined;
	agentDir = undefined;
	testPaths.agentDir = "";
});

function setup() {
	projectDir = mkdtempSync(join(tmpdir(), "om-default-project-"));
	agentDir = mkdtempSync(join(tmpdir(), "om-default-global-"));
	testPaths.agentDir = agentDir;
	let command: any;
	const pi = { registerCommand: (_name: string, definition: any) => { command = definition; } } as any;
	const runtime: any = {
		config: { enabledByDefault: false },
		enabled: false,
		ensureConfig(cwd: string) { this.config = loadConfig(cwd); },
	};
	const notifications: Array<{ message: string; level: string }> = [];
	const ctx = {
		cwd: projectDir,
		hasUI: true,
		ui: { notify: (message: string, level: string) => notifications.push({ message, level }) },
	};
	registerDefaultCommand(pi, runtime);
	return { command, ctx, notifications, runtime };
}

describe("/om:default", () => {
	it("sets project by default, supports global scope, and leaves current session unchanged", async () => {
		const { command, ctx, notifications, runtime } = setup();
		runtime.enabled = true;

		await command.handler("on", ctx);
		expect(loadConfig(projectDir!).enabledByDefault).toBe(true);
		expect(runtime.enabled).toBe(true);

		await command.handler("off global", ctx);
		expect(JSON.parse(readFileSync(join(agentDir!, "settings.json"), "utf-8"))["observational-memory"].enabledByDefault).toBe(false);
		expect(loadConfig(projectDir!).enabledByDefault).toBe(true);
		expect(notifications.at(-1)?.message).toContain("Effective project default: on.");

		await command.handler("off project", ctx);
		expect(loadConfig(projectDir!).enabledByDefault).toBe(false);
		expect(runtime.enabled).toBe(true);
	});

	it("shows usage and rejects invalid values/scopes without writing settings", async () => {
		const { command, ctx, notifications } = setup();

		await command.handler("", ctx);
		await command.handler("sometimes", ctx);
		await command.handler("on workstation", ctx);

		expect(notifications[0].message).toContain("Usage: /om:default on|off [project|global]");
		expect(notifications.slice(1).every(({ level }) => level === "warning")).toBe(true);
		expect(loadConfig(projectDir!).enabledByDefault).toBe(false);
	});
});
