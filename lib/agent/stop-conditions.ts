import { hasToolCall, stepCountIs } from "ai";

export const chatAgentStopConditions = [
  stepCountIs(5),
  hasToolCall("askUserQuestion"),
] as const;
