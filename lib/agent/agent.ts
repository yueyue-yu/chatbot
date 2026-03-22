import type { UIMessageStreamWriter } from "ai";
import { ToolLoopAgent } from "ai";
import type { Session } from "next-auth";
import { askUserQuestion } from "@/lib/agent/tools/ask-user-question";
import { chatAgentStopConditions } from "@/lib/agent/stop-conditions";
import { createDocument } from "@/lib/agent/tools/create-document";
import { editDocument } from "@/lib/agent/tools/edit-document";
import { requestSuggestions } from "@/lib/agent/tools/request-suggestions";
import { updateDocument } from "@/lib/agent/tools/update-document";
import { type RequestHints, systemPrompt } from "@/lib/ai/prompts";
import { getLanguageModel } from "@/lib/ai/providers";
import { isProductionEnvironment } from "@/lib/constants";
import type { ChatMessage } from "@/lib/types";

function createArtifactTools({
  dataStream,
  modelId,
  session,
}: {
  dataStream: UIMessageStreamWriter<ChatMessage>;
  modelId: string;
  session: Session;
}) {
  return {
    askUserQuestion: askUserQuestion(),
    createDocument: createDocument({
      dataStream,
      modelId,
      session,
    }),
    editDocument: editDocument({
      dataStream,
      session,
    }),
    requestSuggestions: requestSuggestions({
      dataStream,
      modelId,
      session,
    }),
    updateDocument: updateDocument({
      dataStream,
      modelId,
      session,
    }),
  };
}

export function createChatAgent({
  dataStream,
  modelId,
  requestHints,
  session,
}: {
  dataStream: UIMessageStreamWriter<ChatMessage>;
  modelId: string;
  requestHints: RequestHints;
  session: Session;
}) {
  return new ToolLoopAgent({
    model: getLanguageModel(modelId),
    instructions: systemPrompt({ requestHints, supportsTools: true }),
    stopWhen: [...chatAgentStopConditions],
    tools: createArtifactTools({
      dataStream,
      modelId,
      session,
    }),
    experimental_telemetry: {
      isEnabled: isProductionEnvironment,
      functionId: "chat-agent",
    },
  });
}
