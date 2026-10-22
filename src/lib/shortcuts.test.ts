import { describe, expect, it } from "vitest";
import {
	bindingsEqual,
	DEFAULT_SHORTCUTS,
	mergeWithDefaults,
	SHORTCUT_ACTIONS,
	SHORTCUT_GROUPS,
} from "./shortcuts";

describe("component keyboard shortcuts", () => {
	it("places every configurable action in exactly one visible group", () => {
		const groupedActions = SHORTCUT_GROUPS.flatMap((group) => group.actions);

		expect(groupedActions).toHaveLength(SHORTCUT_ACTIONS.length);
		expect(new Set(groupedActions)).toEqual(new Set(SHORTCUT_ACTIONS));
	});

	it("assigns distinct defaults to the component actions", () => {
		const componentActions = SHORTCUT_GROUPS.find(
			(group) => group.i18nKey === "components",
		)?.actions;
		expect(componentActions).toBeDefined();

		for (let index = 0; index < (componentActions?.length ?? 0); index++) {
			for (let otherIndex = index + 1; otherIndex < (componentActions?.length ?? 0); otherIndex++) {
				expect(
					bindingsEqual(
						DEFAULT_SHORTCUTS[componentActions?.[index] ?? "addAnnotation"],
						DEFAULT_SHORTCUTS[componentActions?.[otherIndex] ?? "addAnnotation"],
					),
				).toBe(false);
			}
		}
	});

	it("adds new component defaults to an older saved configuration", () => {
		const savedBeforeComponentShortcuts = {
			addAnnotation: { key: "x" },
		};

		expect(mergeWithDefaults(savedBeforeComponentShortcuts)).toMatchObject({
			addAnnotation: { key: "x" },
			addRectangle: { key: "r" },
			addArrow: { key: "a", shift: true },
			addImage: { key: "i" },
		});
	});
});
