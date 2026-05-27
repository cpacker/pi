import type { CustomTool, Tool } from "../src/types.ts";

// Verbatim from openai/codex codex-rs/core/src/tools/handlers/apply_patch_spec.rs.
export const APPLY_PATCH_DESCRIPTION =
	"Use the `apply_patch` tool to edit files. This is a FREEFORM tool, so do not wrap the patch in JSON.";

// Verbatim from openai/codex codex-rs/core/src/tools/handlers/apply_patch.lark.
export const APPLY_PATCH_LARK_GRAMMAR = `start: begin_patch hunk+ end_patch
begin_patch: "*** Begin Patch" LF
end_patch: "*** End Patch" LF?

hunk: add_hunk | delete_hunk | update_hunk
add_hunk: "*** Add File: " filename LF add_line+
delete_hunk: "*** Delete File: " filename LF
update_hunk: "*** Update File: " filename LF change_move? change?

filename: /(.+)/
add_line: "+" /(.*)/ LF -> line

change_move: "*** Move to: " filename LF
change: (change_context | change_line)+ eof_line?
change_context: ("@@" | "@@ " /(.+)/) LF
change_line: ("+" | "-" | " ") /(.*)/ LF
eof_line: "*** End of File" LF

%import common.LF
`;

export const APPLY_PATCH_FALLBACK_PARAMETERS = {
	type: "object",
	properties: {
		input: {
			type: "string",
			description: "Patch text in the apply_patch grammar.",
		},
	},
	required: ["input"],
	additionalProperties: false,
} as Tool["parameters"];

export const APPLY_PATCH_TOOL: CustomTool = {
	type: "custom",
	name: "apply_patch",
	description: APPLY_PATCH_DESCRIPTION,
	format: {
		type: "grammar",
		syntax: "lark",
		definition: APPLY_PATCH_LARK_GRAMMAR,
	},
	fallback: {
		parameters: APPLY_PATCH_FALLBACK_PARAMETERS,
	},
};

export const SAMPLE_APPLY_PATCH_INPUT = "*** Begin Patch\n*** Add File: a.txt\n+ok\n*** End Patch";
