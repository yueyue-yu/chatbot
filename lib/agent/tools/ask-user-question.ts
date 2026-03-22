import { tool } from "ai";
import { z } from "zod";

const askUserQuestionOptionSchema = z.object({
  label: z.string().min(1).max(80),
  value: z.string().min(1).max(200).optional(),
  description: z.string().min(1).max(160).optional(),
});

export const askUserQuestion = () =>
  tool({
    description:
      "Ask the user one concise follow-up question only when critical information is missing. Provide 2-5 mutually exclusive options. Do not include an 'Other' option because the UI already adds it.",
    inputSchema: z.object({
      question: z.string().min(1).max(200),
      options: z.array(askUserQuestionOptionSchema).min(2).max(5),
      placeholder: z.string().min(1).max(120).optional(),
    }),
  });
