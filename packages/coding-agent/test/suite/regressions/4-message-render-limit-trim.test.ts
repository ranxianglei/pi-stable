import type { AgentMessage } from "pi-stable-agent-core";
import type { AssistantMessage, ToolResultMessage, Usage, UserMessage } from "pi-stable-ai";
import { type Component, Container, type MarkdownTheme, Text, type TUI } from "pi-stable-tui";
import { beforeAll, describe, expect, test, vi } from "vitest";
import type { SessionEntry } from "../../../src/core/session-manager.ts";
import type { ToolExecutionComponent } from "../../../src/modes/interactive/components/tool-execution.ts";
import { InteractiveMode } from "../../../src/modes/interactive/interactive-mode.ts";
import { initTheme } from "../../../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../../../src/utils/ansi.ts";

const TOOL_CALL_ID = "tool-4";
const TOOL_NAME = "slow_tool";

const EMPTY_USAGE: Usage = {
	input: 0,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0,
	totalTokens: 0,
	cost: {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		total: 0,
	},
};

type FakeThis = {
	pendingTools: Map<string, ToolExecutionComponent>;
	chatContainer: Container;
	footer: { invalidate(): void };
	ui: TUI;
	settingsManager: {
		getShowImages(): boolean;
		getImageWidthCells(): number;
		getShowCacheMissNotices(): boolean;
		getCodeBlockIndent(): number;
		getMessageRenderLimit(): number;
	};
	sessionManager: { getCwd(): string; getEntries(): SessionEntry[] };
	session: { retryAttempt: number; modelRegistry: { find(provider: string, modelId: string): undefined } };
	toolOutputExpanded: boolean;
	outputPad: number;
	hideThinkingBlock: boolean;
	hiddenThinkingLabel: string;
	updateEditorBorderColor(): void;
	getRegisteredToolDefinition(toolName: string): undefined;
	materializedChatItems: Component[][];
	messageLimitNoticeText: Text | undefined;
	hiddenEarlierMessageCount: number;
	getMarkdownThemeWithSettings(): MarkdownTheme;
	getUserMessageText(message: AgentMessage): string;
	addMessageToChat(message: AgentMessage, options?: { populateHistory?: boolean }): void;
	recordChatItem(children: Component[]): void;
	renderSessionEntries(entries: SessionEntry[], options?: { updateFooter?: boolean; populateHistory?: boolean }): void;
};

function createFakeThis(messageRenderLimit: number): FakeThis {
	const chatContainer = new Container();
	// Copy prototype methods as own properties: internal this.method dispatch must resolve,
	// but the class instance fields (session/settingsManager/...) are getter-only accessors
	// that reject assignment on a prototype-chained object.
	const fakeThis = {} as FakeThis & Record<string, unknown>;
	for (const [name, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(InteractiveMode.prototype))) {
		if (typeof descriptor.value === "function") {
			Object.defineProperty(fakeThis, name, descriptor);
		}
	}
	Object.assign(fakeThis, {
		pendingTools: new Map<string, ToolExecutionComponent>(),
		chatContainer,
		footer: { invalidate: vi.fn() },
		ui: { requestRender: vi.fn() } as unknown as TUI,
		settingsManager: {
			getShowImages: () => false,
			getImageWidthCells: () => 60,
			getShowCacheMissNotices: () => false,
			getCodeBlockIndent: () => 0,
			getMessageRenderLimit: () => messageRenderLimit,
		},
		sessionManager: { getCwd: () => process.cwd(), getEntries: () => [] },
		session: { retryAttempt: 0, modelRegistry: { find: () => undefined } },
		toolOutputExpanded: false,
		outputPad: 1,
		hideThinkingBlock: false,
		hiddenThinkingLabel: "Thinking...",
		updateEditorBorderColor: vi.fn(),
		getRegisteredToolDefinition: (_toolName: string) => undefined,
		materializedChatItems: [],
		messageLimitNoticeText: undefined,
		hiddenEarlierMessageCount: 0,
	});
	return fakeThis;
}

function createUserMessage(text: string): UserMessage {
	return {
		role: "user",
		content: [{ type: "text", text }],
		timestamp: Date.now(),
	};
}

function createAssistantToolCallMessage(): AssistantMessage {
	return {
		role: "assistant",
		content: [
			{
				type: "toolCall",
				id: TOOL_CALL_ID,
				name: TOOL_NAME,
				arguments: { delayMs: 10_000 },
			},
		],
		api: "test-api",
		provider: "test-provider",
		model: "test-model",
		usage: EMPTY_USAGE,
		stopReason: "toolUse",
		timestamp: Date.now(),
	};
}

function createToolResultMessage(text: string): ToolResultMessage {
	return {
		role: "toolResult",
		toolCallId: TOOL_CALL_ID,
		toolName: TOOL_NAME,
		content: [{ type: "text", text }],
		isError: false,
		timestamp: Date.now(),
	};
}

function createSessionEntries(messages: AgentMessage[]): SessionEntry[] {
	let parentId: string | null = null;
	return messages.map((message, index) => {
		const entry: SessionEntry = {
			type: "message",
			id: `entry-${index}`,
			parentId,
			timestamp: new Date().toISOString(),
			message,
		};
		parentId = entry.id;
		return entry;
	});
}

function renderChat(container: Container): string {
	return stripAnsi(container.render(120).join("\n"));
}

function countNotices(rendered: string): number {
	return rendered.split("earlier message").length - 1;
}

describe("InteractiveMode terminal.messageRenderLimit continuous trimming", () => {
	beforeAll(() => {
		initTheme("dark");
	});

	test("rebuild renders only the trailing N messages plus a notice", () => {
		const fakeThis = createFakeThis(3);

		fakeThis.renderSessionEntries(
			createSessionEntries([
				createUserMessage("msg-1"),
				createUserMessage("msg-2"),
				createUserMessage("msg-3"),
				createUserMessage("msg-4"),
				createUserMessage("msg-5"),
			]),
		);

		const rendered = renderChat(fakeThis.chatContainer);
		expect(rendered).toContain("… 2 earlier messages not shown (kept in session)");
		expect(countNotices(rendered)).toBe(1);
		expect(rendered).not.toContain("msg-1");
		expect(rendered).not.toContain("msg-2");
		expect(rendered).toContain("msg-3");
		expect(rendered).toContain("msg-4");
		expect(rendered).toContain("msg-5");
	});

	test("live appends beyond the limit drop the oldest items continuously", () => {
		const fakeThis = createFakeThis(3);

		for (const text of ["live-a", "live-b", "live-c", "live-d", "live-e"]) {
			fakeThis.addMessageToChat(createUserMessage(text));
		}

		const rendered = renderChat(fakeThis.chatContainer);
		expect(rendered).toContain("… 2 earlier messages not shown (kept in session)");
		expect(countNotices(rendered)).toBe(1);
		expect(rendered).not.toContain("live-a");
		expect(rendered).not.toContain("live-b");
		expect(rendered).toContain("live-c");
		expect(rendered).toContain("live-d");
		expect(rendered).toContain("live-e");
		expect(fakeThis.ui.requestRender).toHaveBeenCalled();
	});

	test("default limit 0 keeps every appended message without a notice", () => {
		const fakeThis = createFakeThis(0);

		for (const text of ["keep-a", "keep-b", "keep-c", "keep-d", "keep-e"]) {
			fakeThis.addMessageToChat(createUserMessage(text));
		}

		const rendered = renderChat(fakeThis.chatContainer);
		expect(rendered).not.toContain("not shown (kept in session)");
		for (const text of ["keep-a", "keep-b", "keep-c", "keep-d", "keep-e"]) {
			expect(rendered).toContain(text);
		}
		expect(fakeThis.materializedChatItems.length).toBe(5);
	});

	test("live growth after a limited rebuild keeps trimming and updates the notice in place", () => {
		const fakeThis = createFakeThis(2);

		fakeThis.renderSessionEntries(
			createSessionEntries([
				createUserMessage("r1"),
				createUserMessage("r2"),
				createUserMessage("r3"),
				createUserMessage("r4"),
			]),
		);
		expect(fakeThis.hiddenEarlierMessageCount).toBe(2);

		fakeThis.addMessageToChat(createUserMessage("r5"));
		fakeThis.addMessageToChat(createUserMessage("r6"));

		const rendered = renderChat(fakeThis.chatContainer);
		expect(rendered).toContain("… 4 earlier messages not shown (kept in session)");
		expect(countNotices(rendered)).toBe(1);
		for (const text of ["r1", "r2", "r3", "r4"]) {
			expect(rendered).not.toContain(text);
		}
		expect(rendered).toContain("r5");
		expect(rendered).toContain("r6");
	});

	test("assistant tool components participate in trimming after a rebuild", () => {
		const fakeThis = createFakeThis(2);

		fakeThis.renderSessionEntries(
			createSessionEntries([createAssistantToolCallMessage(), createToolResultMessage("RESULT-A")]),
		);
		fakeThis.addMessageToChat(createUserMessage("after-tool"));

		const rendered = renderChat(fakeThis.chatContainer);
		expect(rendered).toContain("… 1 earlier message not shown (kept in session)");
		expect(rendered).toContain(TOOL_NAME);
		expect(rendered).toContain("RESULT-A");
		expect(rendered).toContain("after-tool");
	});

	test("trimming tolerates children already removed from the container", () => {
		const fakeThis = createFakeThis(1);

		const gone = new Text("gone-item", 0, 0);
		fakeThis.chatContainer.addChild(gone);
		fakeThis.recordChatItem([gone]);
		fakeThis.chatContainer.removeChild(gone);

		const stays = new Text("stays-item", 0, 0);
		fakeThis.chatContainer.addChild(stays);
		fakeThis.recordChatItem([stays]);

		const rendered = renderChat(fakeThis.chatContainer);
		expect(rendered).toContain("stays-item");
		expect(rendered).not.toContain("gone-item");
		expect(rendered).toContain("… 1 earlier message not shown (kept in session)");
	});
});
