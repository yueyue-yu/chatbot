import type { UIMessageStreamWriter } from "ai";
import { stepCountIs, ToolLoopAgent } from "ai";
import type { Session } from "next-auth";
import { getLanguageModel } from "@/lib/ai/providers";
import { createDocument } from "@/lib/ai/tools/create-document";
import { editDocument } from "@/lib/ai/tools/edit-document";
import { updateDocument } from "@/lib/ai/tools/update-document";
import { agentArtifactsPrompt } from "@/lib/agent/prompts";
import type { ChatMessage } from "@/lib/types";

function createNoopDataStream(): UIMessageStreamWriter<ChatMessage> {
  return {
    merge(_stream) {},
    onError: undefined,
    write(_part) {},
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

  return new ToolLoopAgent({
    model: getLanguageModel(modelId),
    instructions: agentArtifactsPrompt,
    stopWhen: stepCountIs(4),
    tools: {
      createDocument: createDocument({
        dataStream,
        modelId,
        session,
      }),
      editDocument: editDocument({
        dataStream,
        session,
      }),
      updateDocument: updateDocument({
        dataStream,
        modelId,
        session,
      }),
    },
  });
}
