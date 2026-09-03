import { describe, expect, it } from "vitest";
import { convertMessages } from "../src/api/openai-completions.ts";
import type { AssistantMessage, Model, OpenAICompletionsCompat, ToolCall, Usage } from "../src/types.ts";

const emptyUsage: Usage = {
	input: 0,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0,
	totalTokens: 0,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

const compat = {
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
	cacheControlFormat: undefined,
	sendSessionAffinityHeaders: false,
	sessionAffinityFormat: "openai",
	supportsLongCacheRetention: true,
} satisfies Omit<Required<OpenAICompletionsCompat>, "cacheControlFormat" | "deferredToolsMode"> & {
	cacheControlFormat?: OpenAICompletionsCompat["cacheControlFormat"];
	deferredToolsMode?: OpenAICompletionsCompat["deferredToolsMode"];
};

function buildModel(baseUrl = "http://127.0.0.1:1"): Model<"openai-completions"> {
	return {
		id: "repro-model",
		name: "Repro Model",
		api: "openai-completions",
		provider: "repro-provider",
		baseUrl,
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128000,
		maxTokens: 4096,
		compat,
	};
}

function buildToolCallAssistant(toolCalls: ToolCall[]): AssistantMessage {
	return {
		role: "assistant",
		content: toolCalls,
		api: "openai-completions",
		provider: "repro-provider",
		model: "repro-model",
		usage: emptyUsage,
		stopReason: "toolUse",
		timestamp: 2,
	};
}

describe("openai-completions assistant content replay", () => {
	it("serializes tool-call-only assistant replay with empty-string content", () => {
		const messages = convertMessages(
			buildModel(),
			{
				messages: [
					{ role: "user", content: "Read README.md", timestamp: 1 },
					buildToolCallAssistant([
						{ type: "toolCall", id: "call_1", name: "read", arguments: { path: "README.md" } },
					]),
				],
			},
			compat,
		);

		expect(messages[1]).toEqual({
			role: "assistant",
			content: "",
			tool_calls: [
				{
					id: "call_1",
					type: "function",
					function: {
						name: "read",
						arguments: '{"path":"README.md"}',
					},
				},
			],
		});
	});

	it("keeps empty-string content when tool results follow the assistant", () => {
		const messages = convertMessages(
			buildModel(),
			{
				messages: [
					{ role: "user", content: "Read README.md", timestamp: 1 },
					buildToolCallAssistant([
						{ type: "toolCall", id: "call_1", name: "read", arguments: { path: "README.md" } },
					]),
					{
						role: "toolResult",
						toolCallId: "call_1",
						toolName: "read",
						content: [{ type: "text", text: "contents" }],
						isError: false,
						timestamp: 3,
					},
				],
			},
			compat,
		);

		expect(messages[1]).toEqual({
			role: "assistant",
			content: "",
			tool_calls: [
				{
					id: "call_1",
					type: "function",
					function: {
						name: "read",
						arguments: '{"path":"README.md"}',
					},
				},
			],
		});
		const toolMessages = messages.slice(2);
		expect(toolMessages.map((message) => message.role)).toEqual(["tool"]);
	});

	it("still skips content-less assistant replays without tool calls", () => {
		const messages = convertMessages(
			buildModel(),
			{
				messages: [
					{ role: "user", content: "Hi", timestamp: 1 },
					{
						role: "assistant",
						content: [{ type: "text", text: "   " }],
						api: "openai-completions",
						provider: "repro-provider",
						model: "repro-model",
						usage: emptyUsage,
						stopReason: "stop",
						timestamp: 2,
					},
					{ role: "user", content: "Continue", timestamp: 3 },
				],
			},
			compat,
		);

		const assistantCount = messages.filter((message) => message.role === "assistant").length;
		expect(assistantCount).toBe(0);
	});
});
