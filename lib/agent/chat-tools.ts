import type { UIMessageStreamWriter } from "ai";
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
  session: Session;
};

export function createChatTools({
  dataStream,
  modelId,
  session,
}: CreateChatToolsProps) {
  return {
    askUserQuestion: askUserQuestion(),
    webSearch: createWebSearchTool(),
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
