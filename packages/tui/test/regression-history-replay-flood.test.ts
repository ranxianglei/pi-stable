import assert from "node:assert";
import { describe, it } from "node:test";
import { type Component, TUI } from "../src/tui.ts";
import { VirtualTerminal } from "./virtual-terminal.ts";

// Regression test for issue #3: with a long history, content changes above the
// visible viewport (tool output collapse, streaming message finalizing) used to
// trigger a full redraw that rewrote every line, replaying the whole
// conversation on screen.

class Lines implements Component {
	private lines: string[];

	constructor(lines: string[] = []) {
		this.lines = lines;
	}

	set(lines: string[]): void {
		this.lines = lines;
	}

	resize(n: number): void {
		this.lines = this.lines.slice(0, n);
	}

	render(): string[] {
		return this.lines;
	}

	invalidate(): void {}
}

const HISTORY_LENGTH = 500;

function setup() {
	const terminal = new VirtualTerminal(60, 24);
	let written = 0;
	const origWrite = terminal.write.bind(terminal);
	terminal.write = (data: string): void => {
		written += data.length;
		origWrite(data);
	};
	const tui = new TUI(terminal);
	const history = new Lines(Array.from({ length: HISTORY_LENGTH }, (_, i) => `history ${i}`));
	const tool = new Lines();
	const footer = new Lines(["footer"]);
	tui.addChild(history);
	tui.addChild(tool);
	tui.addChild(footer);
	tui.start();
	return {
		terminal,
		tui,
		history,
		tool,
		bytes: (): number => written,
		resetBytes: (): void => {
			written = 0;
		},
	};
}

describe("TUI history replay flood (issue #3)", () => {
	it("does not replay the whole history when content above the viewport shrinks", async () => {
		const { terminal, tui, tool, bytes, resetBytes } = setup();
		tool.set(Array.from({ length: 100 }, (_, i) => `tool line ${i}`));
		tui.requestRender();
		await terminal.waitForRender();
		resetBytes();

		// Collapse the tool output: the change starts far above the viewport.
		tool.resize(2);
		tui.requestRender();
		await terminal.waitForRender();

		// The visible screen shows the tail of the (shorter) content, pinned to
		// the bottom.
		const viewport = terminal.getViewport();
		assert.ok(viewport.at(-1)?.includes("footer"), "footer should be on the bottom row");
		assert.ok(
			viewport.some((line) => line.includes("history 499")),
			"history tail should be visible",
		);

		// Only a screen-sized repaint is allowed, not the full ~500-line history.
		assert.ok(bytes() < 5000, `shrink render should be bounded by terminal size, wrote ${bytes()} bytes`);

		// The scrollback above the viewport is kept (not cleared for the redraw).
		assert.ok(terminal.getScrollBuffer().length > 100, "scrollback should be preserved");

		tui.stop();
	});

	it("pins the tail to the bottom after a small shrink above the viewport", async () => {
		const { terminal, tui, tool } = setup();
		tool.set(Array.from({ length: 40 }, (_, i) => `tool line ${i}`));
		tui.requestRender();
		await terminal.waitForRender();

		// Small shrink (fewer than `height` lines) whose change point is above
		// the viewport: the active tail must stay visible and bottom-pinned.
		tool.resize(30);
		tui.requestRender();
		await terminal.waitForRender();

		const viewport = terminal.getViewport();
		assert.ok(viewport.at(-1)?.includes("footer"), "footer should be on the bottom row");
		assert.ok(viewport.every((line, i) => i < viewport.length - 1 || line.trim() !== ""));

		tui.stop();
	});

	it("writes nothing when only lines above the viewport change in place", async () => {
		const { terminal, tui, history, tool, bytes, resetBytes } = setup();
		tool.set(Array.from({ length: 100 }, (_, i) => `tool line ${i}`));
		tui.requestRender();
		await terminal.waitForRender();
		resetBytes();

		// Edit of a single line far above the viewport (line count unchanged).
		const historyLines = Array.from({ length: HISTORY_LENGTH }, (_, i) => `history ${i}`);
		historyLines[100] = "history 100 edited";
		history.set(historyLines);
		tui.requestRender();
		await terminal.waitForRender();

		assert.strictEqual(bytes(), 0, "no terminal output expected for above-viewport in-place edit");

		tui.stop();
	});
});
