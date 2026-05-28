export function isCustomTool(tool) {
    return "type" in tool && tool.type === "custom";
}
export function resolveFunctionTools(providerName, tools) {
    const functionTools = [];
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
export function isCustomToolCall(toolCall) {
    return toolCall.kind === "custom";
}
export function customToolInputField(tool) {
    return tool?.fallback?.inputField ?? "input";
}
export function customToolCallArguments(input, tool) {
    return { [customToolInputField(tool)]: input };
}
export function customToolCallInput(toolCall, tool) {
    if (typeof toolCall.input === "string")
        return toolCall.input;
    const input = toolCall.arguments[customToolInputField(tool)];
    return typeof input === "string" ? input : undefined;
}
export function functionToolCallArguments(toolCall, tool) {
    const input = customToolCallInput(toolCall, tool);
    if (input === undefined)
        return toolCall.arguments;
    return { ...toolCall.arguments, [customToolInputField(tool)]: input };
}
//# sourceMappingURL=tool-support.js.map