import { z } from "zod";

export const postRequestBodySchema = z.object({
  messages: z.array(z.unknown()),
  selectedModel: z.string().trim().optional().default(""),
});

export type PostRequestBody = z.infer<typeof postRequestBodySchema>;
