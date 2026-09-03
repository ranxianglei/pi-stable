/**
 * Assistant messages that contain only tool calls must serialize with an
 * empty-string content, never null: some OpenAI-compatible proxies reject or
 * hang on "content": null (issue #1).
 */
import { describe, expect, it } from "vitest";
import { convertMessages } from "../src/api/openai-completions.ts";
import { getModel } from "../src/compat.ts";
import type {
	AssistantMessage,
	Context,
	Model,
	OpenAICompletionsCompat,
	ToolResultMessage,
	Usage,
} from "../src/types.ts";

const emptyUsage: Usage = {
	input: 0,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0,
	totalTokens: 0,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

const compat: Omit<Required<OpenAICompletionsCompat>, "deferredToolsMode"> & {
	deferredToolsMode?: OpenAICompletionsCompat["deferredToolsMode"];
} = {
	supportsStore: true,
	supportsDeveloperRole: true,
	supportsReasoningEffort: true,
	supportsUsageInStreaming: true,
	maxTokensField: "max_completion_tokens",
	requiresToolResultName: false,
	requiresAssistantAfterToolResult: false,
	requiresThinkingAsText: false,
	requiresReasoningContentOnAssistantMessages: false,
	thinkingFormat: "openai",
	openRouterRouting: {},
	vercelGatewayRouting: {},
	chatTemplateKwargs: {},
	zaiToolStream: false,
	supportsStrictMode: true,
	supportsOpenAIGrammarTools: false,
	cacheControlFormat: "anthropic",
	sendSessionAffinityHeaders: false,
	sessionAffinityFormat: "openai",
	supportsLongCacheRetention: true,
};

function makeToolCallOnlyAssistant(id: string, command: string, timestamp: number) {
	return {
		role: "assistant",
		content: [{ type: "toolCall", id, name: "bash", arguments: { command } }],
		api: "openai-completions",
		provider: "openai",
		model: "gpt-4o-mini",
		usage: emptyUsage,
		stopReason: "toolUse",
		timestamp,
	} satisfies AssistantMessage;
}

function buildToolResult(toolCallId: string, timestamp: number): ToolResultMessage {
	return {
		role: "toolResult",
		toolCallId,
		toolName: "bash",
		content: [{ type: "text", text: "ok" }],
		isError: false,
		timestamp,
	};
}

describe("openai-completions assistant content", () => {
	it("uses empty string content for tool-call-only assistant messages without tool results", () => {
		const { compat: _compat, ...baseModel } = getModel("openai", "gpt-4o-mini");
		const model: Model<"openai-completions"> = {
			...baseModel,
			api: "openai-completions",
		};
		const now = Date.now();
		const assistantMessage = makeToolCallOnlyAssistant("tool-1", "ls", now);
		const context: Context = {
			messages: [{ role: "user", content: "List the files", timestamp: now - 1 }, assistantMessage],
		};
		const messages = convertMessages(model, context, compat);
		const assistantPayload = messages.find((m) => m.role === "assistant") as
			| {
					role: "assistant";
					content: string | Array<unknown>;
					tool_calls?: unknown;
			  }
			| undefined;
		expect(assistantPayload).toBeTruthy();
		expect(assistantPayload?.tool_calls).toBeTruthy();
		expect(assistantPayload?.content).toBe("");
		expect(assistantPayload?.content).not.toBe(null);
	});

	it("uses empty string content for tool-call-only assistant messages after tool results", () => {
		const { compat: _compat, ...baseModel } = getModel("openai", "gpt-4o-mini");
		const model: Model<"openai-completions"> = {
			...baseModel,
			api: "openai-completions",
		};
		const now = Date.now();
		const assistantMessage = makeToolCallOnlyAssistant("tool-1", "ls", now);
		const context: Context = {
			messages: [
				{ role: "user", content: "List the files", timestamp: now - 1 },
				assistantMessage,
				buildToolResult("tool-1", now + 1),
			],
		};
		const messages = convertMessages(model, context, compat);
		const assistantPayload = messages.find((m) => m.role === "assistant") as
			| {
					role: "assistant";
					content: string | Array<unknown>;
			  }
			| undefined;
		expect(assistantPayload?.content).toBe("");
	});
});
