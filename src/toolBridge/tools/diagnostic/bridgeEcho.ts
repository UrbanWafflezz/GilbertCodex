import type { ToolDefinition } from "../../types";

export const bridgeEchoTool: ToolDefinition = {
  description: "Echo a short message back through the tool bridge. This is a harmless diagnostic tool.",
  executorMetadata: {
    family: "diagnostic",
    version: 1,
  },
  execute: (args) => {
    const rawMessage = typeof args.message === "string" ? args.message : "";
    const message = args.uppercase === true ? rawMessage.toUpperCase() : rawMessage;

    return {
      content: message,
      data: {
        message,
      },
      ok: true,
    };
  },
  id: "bridge_echo",
  inputSchema: {
    additionalProperties: false,
    properties: {
      message: {
        maxLength: 2000,
        minLength: 1,
        type: "string",
      },
      uppercase: {
        type: "boolean",
      },
    },
    required: ["message"],
    type: "object",
  },
  permission: "diagnostic",
  risk: "diagnostic",
  title: "Bridge echo",
};
