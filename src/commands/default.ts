import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { loadConfig, saveEnabledByDefault, type ConfigScope } from "../config.js";
import type { Runtime } from "../runtime.js";

const SCOPES: ConfigScope[] = ["project", "global"];

export function registerDefaultCommand(pi: ExtensionAPI, runtime: Runtime): void {
	pi.registerCommand("om:default", {
		description: "Set observational-memory's startup default (project scope overrides global)",
		getArgumentCompletions: (prefix) => {
			const parts = prefix.toLowerCase().split(/\s+/);
			const options = parts.length === 1
				? ["on", "off"]
				: parts.length === 2 && ["on", "off"].includes(parts[0])
					? SCOPES
					: [];
			const partial = parts.at(-1) ?? "";
			const matches = options.filter((option) => option.startsWith(partial));
			return matches.map((value) => ({ value, label: value }));
		},
		handler: async (args: string, ctx: any) => {
			runtime.ensureConfig(ctx.cwd);
			const parts = args.trim().toLowerCase().split(/\s+/).filter(Boolean);
			if (parts.length === 0) {
				if (ctx.hasUI) {
					ctx.ui.notify([
						`OM startup default: ${runtime.config.enabledByDefault ? "on" : "off"}`,
						"Usage: /om:default on|off [project|global]",
						"Project scope is the default and overrides global scope. This does not change the current session.",
					].join("\n"), "info");
				}
				return;
			}

			const [value, rawScope, ...extra] = parts;
			if (!(["on", "off"].includes(value) && (!rawScope || SCOPES.includes(rawScope as ConfigScope)) && extra.length === 0)) {
				if (ctx.hasUI) ctx.ui.notify("Usage: /om:default on|off [project|global]", "warning");
				return;
			}

			const scope = (rawScope || "project") as ConfigScope;
			const enabled = value === "on";
			try {
				saveEnabledByDefault(ctx.cwd, enabled, scope);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				if (ctx.hasUI) ctx.ui.notify(`Could not save OM default: ${message}`, "error");
				return;
			}

			const effectiveDefault = loadConfig(ctx.cwd).enabledByDefault;
			runtime.config.enabledByDefault = effectiveDefault;
			const setting = scope === "project"
				? `Project OM default set to ${enabled ? "on" : "off"} (overrides global).`
				: `Global OM default set to ${enabled ? "on" : "off"}; project settings override global when set.`;
			if (ctx.hasUI) {
				ctx.ui.notify(`${setting} Effective project default: ${effectiveDefault ? "on" : "off"}. Current session unchanged.`, "info");
			}
		},
	});
}
