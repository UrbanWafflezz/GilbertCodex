import type { ToolDefinition } from "../../types";

export const bridgeSumTool: ToolDefinition = {
  description: "Sum a list of finite numbers through the tool bridge. This is a harmless diagnostic tool.",
  executorMetadata: {
    family: "diagnostic",
    version: 1,
  },
  execute: (args) => {
    const values = Array.isArray(args.values) ? args.values.filter((value): value is number => typeof value === "number" && Number.isFinite(value)) : [];
    const sum = values.reduce((total, value) => total + value, 0);

    return {
      content: `${sum}`,
      data: {
        sum,
        values,
      },
      ok: true,
    };
  },
  id: "bridge_sum",
  inputSchema: {
    additionalProperties: false,
    properties: {
      values: {
        items: {
          type: "number",
        },
        minItems: 1,
        type: "array",
      },
    },
    required: ["values"],
    type: "object",
  },
  permission: "diagnostic",
  risk: "diagnostic",
  title: "Bridge sum",
};
