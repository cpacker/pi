import { beforeEach, describe, expect, it, vi } from "vitest";
import { convertMessages as convertOpenAICompletionsMessages } from "../src/providers/openai-completions.ts";
import { streamSimple } from "../src/stream.ts";
import type {
	AssistantMessage,
	Context,
	Model,
	OpenAICompletionsCompat,
	ToolResultMessage,
	Usage,
} from "../src/types.ts";
import { APPLY_PATCH_TOOL, SAMPLE_APPLY_PATCH_INPUT } from "./apply-patch-tool-fixture.ts";

const mockState = vi.hoisted(() => ({
	lastParams: undefined as unknown,
}));

vi.mock("openai", () => {
	class FakeOpenAI {
		chat = {
			completions: {
				create: (params: unknown) => {
					mockState.lastParams = params;
					const stream = {
						async *[Symbol.asyncIterator]() {
							yield {
								choices: [{ delta: {}, finish_reason: "stop" }],
								usage: {
									prompt_tokens: 1,
									completion_tokens: 1,
									prompt_tokens_details: { cached_tokens: 0 },
									completion_tokens_details: { reasoning_tokens: 0 },
								},
							};
						},
					};
					const promise = Promise.resolve(stream) as Promise<typeof stream> & {
						withResponse: () => Promise<{
							data: typeof stream;
							response: { status: number; headers: Headers };
						}>;
					};
					promise.withResponse = async () => ({
						data: stream,
						response: { status: 200, headers: new Headers() },
					});
					return promise;
				},
			},
		};
	}

	return { default: FakeOpenAI };
});

const usage: Usage = {
	input: 0,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0,
	totalTokens: 0,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

const model: Model<"openai-completions"> = {
	id: "gpt-4.1",
	name: "GPT-4.1",
	api: "openai-completions",
	provider: "openai",
	baseUrl: "https://api.openai.com/v1",
	reasoning: false,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 128000,
	maxTokens: 16000,
};

const compat = {
	supportsDeveloperRole: true,
	requiresAssistantAfterToolResult: false,
	requiresThinkingAsText: false,
	requiresReasoningContentOnAssistantMessages: false,
} as Parameters<typeof convertOpenAICompletionsMessages>[2] & OpenAICompletionsCompat;

function customApplyPatchAssistant(): AssistantMessage {
	return {
		role: "assistant",
		content: [
			{
				type: "toolCall",
				id: "call_patch|ctc_patch",
				name: "apply_patch",
				kind: "custom",
				input: SAMPLE_APPLY_PATCH_INPUT,
				arguments: {},
			},
		],
		api: "openai-responses",
		provider: "openai",
		model: "gpt-5",
		usage,
		stopReason: "toolUse",
		timestamp: Date.now() - 1000,
	};
}

function applyPatchToolResult(): ToolResultMessage {
	return {
		role: "toolResult",
		toolCallId: "call_patch|ctc_patch",
		toolName: "apply_patch",
		content: [{ type: "text", text: "Done" }],
		isError: false,
		timestamp: Date.now(),
	};
}

describe("custom tool fallback history", () => {
	beforeEach(() => {
		mockState.lastParams = undefined;
	});

	it("downgrades custom apply_patch tool definitions in function-only OpenAI Chat requests", async () => {
		await streamSimple(
			model,
			{
				tools: [APPLY_PATCH_TOOL],
				messages: [{ role: "user", content: "Patch it", timestamp: Date.now() }],
			},
			{ apiKey: "test" },
		).result();

		const params = mockState.lastParams as { tools?: unknown[] };
		expect(params.tools).toEqual([
			{
				type: "function",
				function: {
					name: "apply_patch",
					description: APPLY_PATCH_TOOL.description,
					parameters: APPLY_PATCH_TOOL.fallback?.parameters,
					strict: false,
				},
			},
		]);
	});

	it("downgrades custom apply_patch history when replaying to function-only OpenAI Chat Completions", () => {
		const context: Context = {
			tools: [APPLY_PATCH_TOOL],
			messages: [
				{ role: "user", content: "Patch it", timestamp: Date.now() - 2000 },
				customApplyPatchAssistant(),
				applyPatchToolResult(),
			],
		};

		const messages = convertOpenAICompletionsMessages(model, context, compat);
		const assistantMessage = messages.find((message) => message.role === "assistant");
		const toolMessage = messages.find((message) => message.role === "tool");

		expect(assistantMessage).toMatchObject({
			role: "assistant",
			tool_calls: [
				{
					id: "call_patch",
					type: "function",
					function: {
						name: "apply_patch",
						arguments: JSON.stringify({ input: SAMPLE_APPLY_PATCH_INPUT }),
					},
				},
			],
		});
		expect(toolMessage).toMatchObject({
			role: "tool",
			tool_call_id: "call_patch",
			content: "Done",
		});
	});
});
