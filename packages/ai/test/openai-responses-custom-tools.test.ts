import type { ResponseStreamEvent } from "openai/resources/responses/responses.js";
import { describe, expect, it, vi } from "vitest";
import {
	convertResponsesMessages,
	convertResponsesTools,
	processResponsesStream,
} from "../src/providers/openai-responses-shared.ts";
import type {
	AssistantMessage,
	AssistantMessageEvent,
	Context,
	Model,
	Tool,
	ToolResultMessage,
	Usage,
} from "../src/types.ts";
import { AssistantMessageEventStream } from "../src/utils/event-stream.ts";
import { APPLY_PATCH_TOOL, SAMPLE_APPLY_PATCH_INPUT } from "./apply-patch-tool-fixture.ts";

const usage: Usage = {
	input: 0,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0,
	totalTokens: 0,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

const model: Model<"openai-responses"> = {
	id: "gpt-5-mini",
	name: "GPT-5 Mini",
	api: "openai-responses",
	provider: "openai",
	baseUrl: "https://api.openai.com/v1",
	reasoning: true,
	input: ["text", "image"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 400000,
	maxTokens: 128000,
};

function createOutput(): AssistantMessage {
	return {
		role: "assistant",
		content: [],
		api: model.api,
		provider: model.provider,
		model: model.id,
		usage: { ...usage, cost: { ...usage.cost } },
		stopReason: "stop",
		timestamp: Date.now(),
	};
}

async function* customToolEvents(input: string): AsyncIterable<ResponseStreamEvent> {
	yield {
		type: "response.output_item.added",
		output_index: 0,
		item: {
			type: "custom_tool_call",
			id: "ctc_patch",
			call_id: "call_patch",
			name: "apply_patch",
			input: "",
		},
	} as ResponseStreamEvent;
	yield {
		type: "response.custom_tool_call_input.delta",
		output_index: 0,
		item_id: "ctc_patch",
		sequence_number: 1,
		delta: input.slice(0, 16),
	} as ResponseStreamEvent;
	yield {
		type: "response.custom_tool_call_input.delta",
		output_index: 0,
		item_id: "ctc_patch",
		sequence_number: 2,
		delta: input.slice(16),
	} as ResponseStreamEvent;
	yield {
		type: "response.custom_tool_call_input.done",
		output_index: 0,
		item_id: "ctc_patch",
		sequence_number: 3,
		input,
	} as ResponseStreamEvent;
	yield {
		type: "response.output_item.done",
		output_index: 0,
		item: {
			type: "custom_tool_call",
			id: "ctc_patch",
			call_id: "call_patch",
			name: "apply_patch",
			input,
		},
	} as ResponseStreamEvent;
	yield {
		type: "response.completed",
		sequence_number: 4,
		response: {
			id: "resp_test",
			status: "completed",
			usage: {
				input_tokens: 5,
				output_tokens: 3,
				total_tokens: 8,
				input_tokens_details: { cached_tokens: 0 },
			},
		},
	} as ResponseStreamEvent;
}

describe("OpenAI Responses custom tools", () => {
	it("serializes custom tool definitions to native Responses custom tools", () => {
		const readTool: Tool = {
			name: "read_file",
			description: "Read a file",
			parameters: {
				type: "object",
				properties: { path: { type: "string" } },
				required: ["path"],
			} as Tool["parameters"],
		};
		const tools = [readTool, APPLY_PATCH_TOOL];

		expect(convertResponsesTools(tools, { strict: null })).toEqual([
			{
				type: "function",
				name: "read_file",
				description: "Read a file",
				parameters: readTool.parameters,
				strict: null,
			},
			{
				type: "custom",
				name: "apply_patch",
				description: APPLY_PATCH_TOOL.description,
				format: APPLY_PATCH_TOOL.format,
			},
		]);
	});

	it("streams custom tool calls as raw-input tool calls", async () => {
		const input = SAMPLE_APPLY_PATCH_INPUT;
		const output = createOutput();
		const stream = new AssistantMessageEventStream();
		const pushSpy = vi.spyOn(stream, "push");

		await processResponsesStream(customToolEvents(input), output, stream, model);

		expect(output.stopReason).toBe("toolUse");
		expect(output.content).toHaveLength(1);
		const toolCall = output.content[0];
		expect(toolCall?.type).toBe("toolCall");
		if (!toolCall || toolCall.type !== "toolCall") {
			throw new Error("Expected toolCall block");
		}
		expect(toolCall).toMatchObject({
			id: "call_patch|ctc_patch",
			name: "apply_patch",
			kind: "custom",
			input,
			arguments: { input },
		});
		expect("partialInput" in toolCall).toBe(false);

		const emittedEvents = pushSpy.mock.calls.map(([event]) => event as AssistantMessageEvent);
		const deltas = emittedEvents.filter((event) => event.type === "toolcall_delta");
		expect(deltas.map((event) => (event.type === "toolcall_delta" ? event.delta : "")).join("")).toBe(input);
		const toolCallEnd = emittedEvents.find((event) => event.type === "toolcall_end");
		expect(toolCallEnd).toBeDefined();
		if (!toolCallEnd || toolCallEnd.type !== "toolcall_end") {
			throw new Error("Expected toolcall_end event");
		}
		expect(toolCallEnd.toolCall).toBe(toolCall);
	});

	it("replays custom tool calls and outputs with custom Responses item types", () => {
		const input = SAMPLE_APPLY_PATCH_INPUT;
		const assistant: AssistantMessage = {
			role: "assistant",
			content: [
				{
					type: "toolCall",
					id: "call_patch|ctc_patch",
					name: "apply_patch",
					kind: "custom",
					input,
					arguments: { input },
				},
			],
			api: "openai-responses",
			provider: "openai",
			model: model.id,
			usage,
			stopReason: "toolUse",
			timestamp: Date.now() - 1000,
		};
		const toolResult: ToolResultMessage = {
			role: "toolResult",
			toolCallId: "call_patch|ctc_patch",
			toolName: "apply_patch",
			content: [{ type: "text", text: "Done" }],
			isError: false,
			timestamp: Date.now(),
		};
		const context: Context = {
			messages: [{ role: "user", content: "Patch it", timestamp: Date.now() - 2000 }, assistant, toolResult],
		};

		const responseInput = convertResponsesMessages(model, context, new Set(["openai"]));
		const customToolCall = responseInput.find((item) => item.type === "custom_tool_call");
		const customToolOutput = responseInput.find((item) => item.type === "custom_tool_call_output");

		expect(customToolCall).toMatchObject({
			type: "custom_tool_call",
			id: "ctc_patch",
			call_id: "call_patch",
			name: "apply_patch",
			input,
		});
		expect(customToolOutput).toMatchObject({
			type: "custom_tool_call_output",
			call_id: "call_patch",
			output: "Done",
		});
		expect(responseInput.some((item) => item.type === "function_call")).toBe(false);
		expect(responseInput.some((item) => item.type === "function_call_output")).toBe(false);
	});

	it("upgrades fallback-shaped apply_patch history when custom tool support is available", () => {
		const assistant: AssistantMessage = {
			role: "assistant",
			content: [
				{
					type: "toolCall",
					id: "call_patch|fc_patch",
					name: "apply_patch",
					arguments: { input: SAMPLE_APPLY_PATCH_INPUT },
				},
			],
			api: "openai-completions",
			provider: "openai",
			model: "gpt-4.1",
			usage,
			stopReason: "toolUse",
			timestamp: Date.now() - 1000,
		};
		const toolResult: ToolResultMessage = {
			role: "toolResult",
			toolCallId: "call_patch|fc_patch",
			toolName: "apply_patch",
			content: [{ type: "text", text: "Done" }],
			isError: false,
			timestamp: Date.now(),
		};
		const context: Context = {
			tools: [APPLY_PATCH_TOOL],
			messages: [{ role: "user", content: "Patch it", timestamp: Date.now() - 2000 }, assistant, toolResult],
		};

		const responseInput = convertResponsesMessages(model, context, new Set(["openai"]));
		const customToolCall = responseInput.find((item) => item.type === "custom_tool_call");
		const customToolOutput = responseInput.find((item) => item.type === "custom_tool_call_output");

		expect(customToolCall).toMatchObject({
			type: "custom_tool_call",
			call_id: "call_patch",
			name: "apply_patch",
			input: SAMPLE_APPLY_PATCH_INPUT,
		});
		expect(customToolCall?.id).toMatch(/^ctc_/);
		expect(customToolOutput).toMatchObject({
			type: "custom_tool_call_output",
			call_id: "call_patch",
			output: "Done",
		});
		expect(responseInput.some((item) => item.type === "function_call")).toBe(false);
		expect(responseInput.some((item) => item.type === "function_call_output")).toBe(false);
	});
});
