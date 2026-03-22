import { z } from "zod";

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

const toolMessageSchema = z.object({
  id: z.string().uuid(),
  role: z.literal("assistant"),
  parts: z
    .array(z.object({ type: z.string() }).passthrough())
    .min(1)
    .refine(
      (parts) =>
        parts.some(
          (p) =>
            p.type === "tool-askUserQuestion" &&
            p.state === "output-available"
        ),
      { message: "Must include a resolved tool-askUserQuestion part" }
    ),
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
