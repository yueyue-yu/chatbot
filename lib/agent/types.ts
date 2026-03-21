import type { InferUITool, UIMessage } from "ai";
import type { createDocument } from "@/lib/agent/tools/create-document";
import type { editDocument } from "@/lib/agent/tools/edit-document";
import type { updateDocument } from "@/lib/agent/tools/update-document";

type createDocumentTool = InferUITool<ReturnType<typeof createDocument>>;
type editDocumentTool = InferUITool<ReturnType<typeof editDocument>>;
type updateDocumentTool = InferUITool<ReturnType<typeof updateDocument>>;

export type AgentTools = {
  createDocument: createDocumentTool;
  editDocument: editDocumentTool;
  updateDocument: updateDocumentTool;
};

export type AgentMessage = UIMessage<unknown, never, AgentTools>;

export type AgentMessagePart = AgentMessage["parts"][number];

export type CreateDocumentToolPart = Extract<
  AgentMessagePart,
  { type: "tool-createDocument" }
>;

export type EditDocumentToolPart = Extract<
  AgentMessagePart,
  { type: "tool-editDocument" }
>;

export type UpdateDocumentToolPart = Extract<
  AgentMessagePart,
  { type: "tool-updateDocument" }
>;

export type AgentArtifactToolPart =
  | CreateDocumentToolPart
  | EditDocumentToolPart
  | UpdateDocumentToolPart;
