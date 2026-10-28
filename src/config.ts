import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ModelThinkingLevel } from "@earendil-works/pi-ai";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

export interface ConfiguredModel {
	provider: string;
	id: string;
	thinking?: ModelThinkingLevel;
}

export type WorkerRole = "observer" | "consolidator";
export type ConfigScope = "project" | "global";

export interface Config {
	/** Raw-history token size of one observation chunk (fixed boundary). */
	chunkTokens: number;
	/** Overlap between adjacent chunks; default 0 in v1. */
	chunkOverlapTokens: number;
	/** Target size of the active observation pool; the buffer drains back toward this after consolidation. */
	poolTargetTokens: number;
	/** Active-pool token count that triggers a consolidation (200% of target). */
	consolidateAtPoolTokens: number;
	/** Live context-window usage that triggers compaction. */
	compactAtContextTokens: number;
	/** Verbatim raw tail kept after the cutoff; snaps to a chunk boundary. */
	tailTokens: number;
	/**
	 * Target size of `.memory/JOURNEY.md`, the running descriptive project history the
	 * consolidator appends to and pushes into every compaction block. When the file grows past
	 * this, the consolidator compresses its oldest entries (recent history stays detailed).
	 */
	journeyTargetTokens: number;
	/** Max simultaneous in-flight observer subprocesses. */
	observerConcurrency: number;
	models: {
		observer: ConfiguredModel;
		consolidator: ConfiguredModel;
	};
	/**
	 * Resume the agent automatically after a compaction that fired mid-run (a `turn_end` with
	 * pending tool work). A `turn_end` that is also the run's terminal turn never auto-resumes —
	 * it stops as if nothing happened. Default true.
	 */
	resumeAfterMidRunCompaction: boolean;
	/** Initial on/off state for sessions without an explicit ledger toggle. */
	enabledByDefault: boolean;
	/** Power-user setting: disable all triggers (distinct from the on/off gate). */
	passive: boolean;
	/** Emit the NDJSON debug log. */
	debugLog: boolean;
}

export const DEFAULTS: Config = {
	chunkTokens: 10_000,
	chunkOverlapTokens: 0,
	poolTargetTokens: 10_000,
	consolidateAtPoolTokens: 15_000,
	compactAtContextTokens: 150_000,
	tailTokens: 20_000,
	journeyTargetTokens: 1_000,
	observerConcurrency: 4,
	resumeAfterMidRunCompaction: true,
	models: {
		observer: { provider: "openrouter", id: "z-ai/glm-5.3", thinking: "low" },
		consolidator: { provider: "openrouter", id: "z-ai/glm-5.3", thinking: "medium" },
	},
	enabledByDefault: false,
	passive: false,
	debugLog: false,
};

const THINKING_LEVEL_VALUES: readonly ModelThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh"] as const;

const SETTINGS_KEY = "observational-memory";
const PASSIVE_ENV = "PI_OM_PASSIVE";

function positiveIntegerOrUndefined(value: unknown): number | undefined {
	return Number.isInteger(value) && typeof value === "number" && value > 0 ? value : undefined;
}

function isThinkingLevel(value: unknown): value is ModelThinkingLevel {
	return typeof value === "string" && (THINKING_LEVEL_VALUES as readonly string[]).includes(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function nonEmptyString(value: unknown): string | undefined {
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

function normalizeModel(value: unknown, fallback: ConfiguredModel): ConfiguredModel {
	if (!isRecord(value)) return fallback;
	const provider = nonEmptyString(value.provider) ?? fallback.provider;
	const id = nonEmptyString(value.id) ?? fallback.id;
	const model: ConfiguredModel = { provider, id };
	const thinking = isThinkingLevel(value.thinking) ? value.thinking : fallback.thinking;
	if (thinking) model.thinking = thinking;
	return model;
}

function normalizeSettingsConfig(value: Record<string, unknown>, base: Config): Partial<Config> {
	const normalized: Partial<Config> = {};
	const numberKeys = [
		"chunkTokens",
		"chunkOverlapTokens",
		"poolTargetTokens",
		"consolidateAtPoolTokens",
		"compactAtContextTokens",
		"tailTokens",
		"journeyTargetTokens",
		"observerConcurrency",
	] as const;
	for (const key of numberKeys) {
		const normalizedValue = positiveIntegerOrUndefined(value[key]);
		if (normalizedValue !== undefined) normalized[key] = normalizedValue;
	}
	// chunkOverlapTokens may legitimately be 0.
	if (value.chunkOverlapTokens === 0) normalized.chunkOverlapTokens = 0;
	if (typeof value.resumeAfterMidRunCompaction === "boolean")
		normalized.resumeAfterMidRunCompaction = value.resumeAfterMidRunCompaction;
	if (typeof value.enabledByDefault === "boolean") normalized.enabledByDefault = value.enabledByDefault;
	if (typeof value.passive === "boolean") normalized.passive = value.passive;
	if (typeof value.debugLog === "boolean") normalized.debugLog = value.debugLog;
	if (isRecord(value.models)) {
		normalized.models = {
			observer: normalizeModel(value.models.observer, base.models.observer),
			consolidator: normalizeModel(value.models.consolidator, base.models.consolidator),
		};
	}
	return normalized;
}

function readNamespacedSettings(path: string): { settings: Record<string, unknown>; config: Record<string, unknown> } {
	let settings: Record<string, unknown> = {};
	if (existsSync(path)) {
		const parsed: unknown = JSON.parse(readFileSync(path, "utf-8"));
		if (!isRecord(parsed)) throw new Error(`Invalid settings file: ${path}`);
		settings = parsed;
	}
	const config = settings[SETTINGS_KEY];
	if (config !== undefined && !isRecord(config)) throw new Error(`Invalid ${SETTINGS_KEY} settings in ${path}`);
	return { settings, config: (config as Record<string, unknown> | undefined) ?? {} };
}

function writeNamespacedSettings(path: string, settings: Record<string, unknown>, config: Record<string, unknown>): void {
	settings[SETTINGS_KEY] = config;
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(settings, null, 2)}\n`, "utf-8");
}

function configPath(cwd: string, scope: ConfigScope): string {
	return scope === "global" ? join(getAgentDir(), "settings.json") : join(cwd, ".pi", "settings.json");
}

export function saveEnabledByDefault(cwd: string, enabled: boolean, scope: ConfigScope): void {
	const path = configPath(cwd, scope);
	const { settings, config } = readNamespacedSettings(path);
	writeNamespacedSettings(path, settings, { ...config, enabledByDefault: enabled });
}

export function saveConfiguredModel(cwd: string, role: WorkerRole, model: ConfiguredModel): void {
	const path = configPath(cwd, "project");
	const { settings, config } = readNamespacedSettings(path);
	const existingModels = config.models;
	if (existingModels !== undefined && !isRecord(existingModels)) throw new Error(`Invalid models settings in ${path}`);
	const models = (existingModels as Record<string, unknown> | undefined) ?? {};
	const existingModel = models[role];
	if (existingModel !== undefined && !isRecord(existingModel)) throw new Error(`Invalid ${role} model settings in ${path}`);

	writeNamespacedSettings(path, settings, {
		...config,
		models: { ...models, [role]: { ...(existingModel as Record<string, unknown> | undefined), provider: model.provider, id: model.id } },
	});
}

export function readEnvConfig(env: NodeJS.ProcessEnv = process.env): Partial<Config> {
	const rawPassive = env[PASSIVE_ENV];
	if (rawPassive === undefined) return {};
	const passive = rawPassive.trim().toLowerCase();
	if (["1", "true", "yes", "on"].includes(passive)) return { passive: true };
	if (["0", "false", "no", "off"].includes(passive)) return { passive: false };
	return {};
}

function readNamespacedConfig(path: string, base: Config): Partial<Config> {
	if (!existsSync(path)) return {};
	try {
		const raw = JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>;
		const nested = raw[SETTINGS_KEY];
		return isRecord(nested) ? normalizeSettingsConfig(nested, base) : {};
	} catch {
		return {};
	}
}

export function loadConfig(cwd: string, env: NodeJS.ProcessEnv = process.env): Config {
	const globalPath = join(getAgentDir(), "settings.json");
	const projectPath = join(cwd, ".pi", "settings.json");
	const globalConfig = readNamespacedConfig(globalPath, DEFAULTS);
	const projectBase: Config = {
		...DEFAULTS,
		...globalConfig,
		models: { ...DEFAULTS.models, ...globalConfig.models },
	};
	const projectConfig = readNamespacedConfig(projectPath, projectBase);
	const envConfig = readEnvConfig(env);
	return {
		...DEFAULTS,
		...globalConfig,
		...projectConfig,
		...envConfig,
		models: {
			...DEFAULTS.models,
			...globalConfig.models,
			...projectConfig.models,
		},
	};
}
