import type { UIMessageStreamWriter } from "ai";
import { stepCountIs, ToolLoopAgent } from "ai";
import type { Session } from "next-auth";
import { agentArtifactsPrompt } from "@/lib/agent/prompts";
import { type RequestHints, systemPrompt } from "@/lib/ai/prompts";
import { getLanguageModel } from "@/lib/ai/providers";
import { createDocument } from "@/lib/ai/tools/create-document";
import { editDocument } from "@/lib/ai/tools/edit-document";
import { requestSuggestions } from "@/lib/ai/tools/request-suggestions";
import { updateDocument } from "@/lib/ai/tools/update-document";
import { isProductionEnvironment } from "@/lib/constants";
import type { ChatMessage } from "@/lib/types";

function createNoopDataStream(): UIMessageStreamWriter<ChatMessage> {
  return {
    merge(_stream) {
      return undefined;
    },
    onError: undefined,
    write(_part) {
      return undefined;
    },
  };
}

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

export function createArtifactAgent({
  modelId,
  session,
}: {
  modelId: string;
  session: Session;
}) {
  const dataStream = createNoopDataStream();
  const { requestSuggestions: _requestSuggestions, ...tools } =
    createArtifactTools({
      dataStream,
      modelId,
      session,
    });

  return new ToolLoopAgent({
    model: getLanguageModel(modelId),
    instructions: agentArtifactsPrompt,
    stopWhen: stepCountIs(4),
    tools,
  });
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
    stopWhen: stepCountIs(5),
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
