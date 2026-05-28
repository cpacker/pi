import type { CustomTool, Tool, ToolCall, ToolDefinition } from "../types.ts";
export declare function isCustomTool(tool: ToolDefinition): tool is CustomTool;
export declare function resolveFunctionTools(providerName: string, tools: ToolDefinition[]): Tool[];
export declare function isCustomToolCall(toolCall: ToolCall): boolean;
export declare function customToolInputField(tool?: CustomTool): string;
export declare function customToolCallArguments(input: string, tool?: CustomTool): Record<string, string>;
export declare function customToolCallInput(toolCall: ToolCall, tool?: CustomTool): string | undefined;
export declare function functionToolCallArguments(toolCall: ToolCall, tool?: CustomTool): Record<string, any>;
//# sourceMappingURL=tool-support.d.ts.map