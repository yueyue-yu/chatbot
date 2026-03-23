import type { ToolSet, UIMessageStreamWriter } from "ai";
import type { Session } from "next-auth";
import { askUserQuestion } from "@/lib/agent/tools/ask-user-question";
import { createDocument } from "@/lib/agent/tools/create-document";
import { editDocument } from "@/lib/agent/tools/edit-document";
import { requestSuggestions } from "@/lib/agent/tools/request-suggestions";
import { updateDocument } from "@/lib/agent/tools/update-document";
import { createWebSearchTool } from "@/lib/agent/tools/web-search";
import type { ChatMessage } from "@/lib/types";

type CreateChatToolsProps = {
  dataStream: UIMessageStreamWriter<ChatMessage>;
  modelId: string;
  searchEnabled: boolean;
  session: Session;
};

export function createChatTools({
  dataStream,
  modelId,
  searchEnabled,
  session,
}: CreateChatToolsProps) {
  const tools = {
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

  if (!searchEnabled) {
    return tools satisfies ToolSet;
  }

  return {
    ...tools,
    webSearch: createWebSearchTool(),
  } satisfies ToolSet;
}
