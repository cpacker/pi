import type { CustomTool, Tool, ToolCall, ToolDefinition } from "../types.ts";

export function isCustomTool(tool: ToolDefinition): tool is CustomTool {
	return "type" in tool && tool.type === "custom";
}

export function resolveFunctionTools(providerName: string, tools: ToolDefinition[]): Tool[] {
	const functionTools: Tool[] = [];
	for (const tool of tools) {
		if (isCustomTool(tool)) {
			if (!tool.fallback) {
				throw new Error(`${providerName} does not support custom/freeform tools: ${tool.name}`);
			}
			functionTools.push({
				name: tool.name,
				description: tool.fallback.description ?? tool.description,
				parameters: tool.fallback.parameters,
			});
			continue;
		}
		functionTools.push(tool);
	}
	return functionTools;
}

export function isCustomToolCall(toolCall: ToolCall): boolean {
	return toolCall.kind === "custom";
}

export function customToolInputField(tool?: CustomTool): string {
	return tool?.fallback?.inputField ?? "input";
}

export function customToolCallArguments(input: string, tool?: CustomTool): Record<string, string> {
	return { [customToolInputField(tool)]: input };
}

export function customToolCallInput(toolCall: ToolCall, tool?: CustomTool): string | undefined {
	if (typeof toolCall.input === "string") return toolCall.input;
	const input = toolCall.arguments[customToolInputField(tool)];
	return typeof input === "string" ? input : undefined;
}

export function functionToolCallArguments(toolCall: ToolCall, tool?: CustomTool): Record<string, any> {
	const input = customToolCallInput(toolCall, tool);
	if (input === undefined) return toolCall.arguments;
	return { ...toolCall.arguments, [customToolInputField(tool)]: input };
}
