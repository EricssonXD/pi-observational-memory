import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { Container, fuzzyFilter, Input, SelectList, Spacer, Text } from "@earendil-works/pi-tui";
import { saveConfiguredModel, type WorkerRole } from "../config.js";
import type { Runtime } from "../runtime.js";

const ROLES: WorkerRole[] = ["observer", "consolidator"];

async function chooseWorkerModel(
	ctx: ExtensionCommandContext,
	role: WorkerRole,
	currentProvider: string,
	currentModel: string,
	initialSearch = "",
): Promise<{ provider: string; id: string } | undefined> {
	const models = ctx.modelRegistry.getAvailable().slice().sort((a, b) => {
		const aIsCurrent = a.provider === currentProvider && a.id === currentModel;
		const bIsCurrent = b.provider === currentProvider && b.id === currentModel;
		return Number(bIsCurrent) - Number(aIsCurrent) || a.provider.localeCompare(b.provider) || a.id.localeCompare(b.id);
	});
	if (models.length === 0) {
		ctx.ui.notify("No models available for configured providers. Use /login to add providers.", "warning");
		return undefined;
	}
	if (!ctx.hasUI) {
		ctx.ui.notify("The observational-memory model picker requires TUI mode.", "warning");
		return undefined;
	}

	return ctx.ui.custom((tui, theme, keybindings, done) => {
		const root = new Container();
		const search = new Input();
		const listContainer = new Container();
		let list: SelectList;

		root.addChild(new Text(theme.fg("accent", theme.bold(`Select ${role} model`))));
		root.addChild(new Text(theme.fg("warning", "Only models from configured providers are shown. Use /login to add providers.")));
		root.addChild(search);
		root.addChild(listContainer);
		root.addChild(new Spacer(1));
		root.addChild(new Text(theme.fg("dim", "↑↓ navigate · type to search · enter select · esc cancel")));

		const updateList = () => {
			const query = search.getValue().trim();
			const filtered = query ? fuzzyFilter(models, query, (model) => `${model.id} ${model.provider} ${model.name}`) : models;
			const items = filtered.map((model) => ({
				value: `${model.provider}\0${model.id}`,
				label: `${model.provider === currentProvider && model.id === currentModel ? "✓ " : ""}${model.id} [${model.provider}]`,
				description: model.name,
			}));
			list = new SelectList(items, 10, {
				selectedPrefix: (text) => theme.fg("accent", text),
				selectedText: (text) => theme.fg("accent", text),
				description: (text) => theme.fg("muted", text),
				scrollInfo: (text) => theme.fg("dim", text),
				noMatch: (text) => theme.fg("warning", text),
			});
			list.setSelectedIndex(query ? 0 : Math.max(0, filtered.findIndex((model) => model.provider === currentProvider && model.id === currentModel)));
			list.onSelect = (item) => {
				const selected = filtered.find((model) => `${model.provider}\0${model.id}` === item.value);
				if (selected) done({ provider: selected.provider, id: selected.id });
			};
			list.onCancel = () => done(undefined);
			listContainer.clear();
			listContainer.addChild(list);
		};
		updateList();
		if (initialSearch) {
			search.setValue(initialSearch);
			updateList();
		}

		return {
			get focused() { return search.focused; },
			set focused(value: boolean) { search.focused = value; },
			render(width: number) { return root.render(width); },
			invalidate() { root.invalidate(); },
			handleInput(data: string) {
				if (keybindings.matches(data, "tui.select.up") || keybindings.matches(data, "tui.select.down") || keybindings.matches(data, "tui.select.confirm") || keybindings.matches(data, "tui.select.cancel")) {
					list.handleInput(data);
				} else {
					search.handleInput(data);
					updateList();
				}
				tui.requestRender();
			},
		};
	}, { overlay: false });
}

export function registerModelCommand(pi: ExtensionAPI, runtime: Runtime): void {
	pi.registerCommand("om:model", {
		description: "Choose the observer or consolidator model",
		getArgumentCompletions: (prefix) => {
			const trimmed = prefix.trim();
			if (trimmed.includes(" ")) return null;
			const matches = ROLES.filter((role) => role.startsWith(trimmed.toLowerCase()));
			return matches.length > 0 ? matches.map((role) => ({ value: role, label: role })) : null;
		},
		handler: async (args, ctx) => {
			runtime.ensureConfig(ctx.cwd);
			const [rawRole, ...searchParts] = args.trim().split(/\s+/);
			const roleText = rawRole?.toLowerCase();
			if (!ROLES.some((candidate) => candidate === roleText)) {
				ctx.ui.notify("Usage: /om:model observer|consolidator [search]", "info");
				return;
			}
			const role = roleText as WorkerRole;

			const current = runtime.config.models[role];
			const selected = await chooseWorkerModel(ctx, role, current.provider, current.id, searchParts.join(" "));
			if (!selected) return;

			const next = { ...current, ...selected };
			try {
				saveConfiguredModel(ctx.cwd, role, next);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				ctx.ui.notify(`Could not save observational-memory model: ${message}`, "error");
				return;
			}
			runtime.config.models[role] = next;
			ctx.ui.notify(`${role} model set: ${next.provider}/${next.id}`, "info");
		},
	});
}
