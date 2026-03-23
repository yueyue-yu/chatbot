import type { UIMessageStreamWriter } from "ai";
import { ToolLoopAgent } from "ai";
import type { Session } from "next-auth";
import { createChatTools } from "@/lib/agent/chat-tools";
import { chatAgentStopConditions } from "@/lib/agent/stop-conditions";
import { type RequestHints, systemPrompt } from "@/lib/ai/prompts";
import { getLanguageModel } from "@/lib/ai/providers";
import { isProductionEnvironment } from "@/lib/constants";
import type { ChatMessage } from "@/lib/types";

export function createChatAgent({
  dataStream,
  modelId,
  requestHints,
  searchEnabled,
  session,
}: {
  dataStream: UIMessageStreamWriter<ChatMessage>;
  modelId: string;
  requestHints: RequestHints;
  searchEnabled: boolean;
  session: Session;
}) {
  return new ToolLoopAgent({
    model: getLanguageModel(modelId),
    instructions: systemPrompt({ requestHints, supportsTools: true }),
    stopWhen: [...chatAgentStopConditions],
    tools: createChatTools({
      dataStream,
      modelId,
      searchEnabled,
      session,
    }),
    experimental_telemetry: {
      isEnabled: isProductionEnvironment,
      functionId: "chat-agent",
    },
  });
}
