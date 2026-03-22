import test from "node:test";
import assert from "node:assert/strict";
import { chatAgentStopConditions } from "./stop-conditions";

test("chat agent stops when askUserQuestion is called in the current step", async () => {
  const shouldStop = await chatAgentStopConditions[1]({
    steps: [
      {
        toolCalls: [
          {
            toolCallId: "ask-user-question-1",
            toolName: "askUserQuestion",
          },
        ],
      } as never,
    ],
  });

  assert.equal(shouldStop, true);
});

test("chat agent does not stop early when askUserQuestion was not called", async () => {
  const shouldStop = await chatAgentStopConditions[1]({
    steps: [
      {
        toolCalls: [
          {
            toolCallId: "create-document-1",
            toolName: "createDocument",
          },
        ],
      } as never,
    ],
  });

  assert.equal(shouldStop, false);
});
