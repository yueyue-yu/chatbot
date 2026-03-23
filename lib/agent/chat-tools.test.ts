import assert from "node:assert/strict";
import test from "node:test";
import { getOptionalChatTools } from "./chat-tools-config";

test("creates chat tools without webSearch when search is disabled", () => {
  const tools = getOptionalChatTools({
    createWebSearchTool: () => ({ kind: "web-search" }),
    searchEnabled: false,
  });

  assert.equal("webSearch" in tools, false);
});

test("creates chat tools with webSearch when search is enabled", () => {
  const tools = getOptionalChatTools({
    createWebSearchTool: () => ({ kind: "web-search" }),
    searchEnabled: true,
  });

  assert.equal("webSearch" in tools, true);
});
