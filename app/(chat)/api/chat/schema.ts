import { z } from "zod";
import {
  askUserQuestionInputSchema,
  askUserQuestionOutputSchema,
} from "@/lib/agent/tools/ask-user-question";

const textPartSchema = z.object({
  type: z.enum(["text"]),
  text: z.string().min(1).max(2000),
});

const filePartSchema = z.object({
  type: z.enum(["file"]),
  mediaType: z.enum(["image/jpeg", "image/png"]),
  name: z.string().min(1).max(100),
  url: z.string().url(),
});

const partSchema = z.union([textPartSchema, filePartSchema]);

const userMessageSchema = z.object({
  id: z.string().uuid(),
  role: z.enum(["user"]),
  parts: z.array(partSchema),
});

const askUserQuestionToolPartSchema = z.object({
  type: z.literal("tool-askUserQuestion"),
  input: askUserQuestionInputSchema,
  output: askUserQuestionOutputSchema,
  state: z.literal("output-available"),
  toolCallId: z.string().min(1),
});

const stepStartPartSchema = z.object({
  type: z.literal("step-start"),
});

const toolMessageSchema = z.object({
  id: z.string().uuid(),
  role: z.literal("assistant"),
  parts: z.array(z.union([stepStartPartSchema, askUserQuestionToolPartSchema])).min(1),
});

const requestBaseSchema = z.object({
  id: z.string().uuid(),
  selectedChatModel: z.string(),
  selectedVisibilityType: z.enum(["public", "private"]),
});

export const postRequestBodySchema = z.union([
  requestBaseSchema.extend({
    message: userMessageSchema,
  }),
  requestBaseSchema.extend({
    toolMessage: toolMessageSchema,
  }),
]);

export type PostRequestBody = z.infer<typeof postRequestBodySchema>;
