import { streamText } from "ai";
import { htmlPrompt, updateDocumentPrompt } from "@/lib/ai/prompts";
import { getLanguageModel } from "@/lib/ai/providers";
import { createDocumentHandler } from "@/lib/artifacts/server";

function stripFences(content: string): string {
  return content
    .replace(/^```[\w-]*\n?/, "")
    .replace(/\n?```\s*$/, "")
    .trim();
}

const htmlOutputInstructions =
  "Output ONLY the complete single-file HTML document. Inline CSS/JS only. No explanations, no markdown fences, no external resources.";

export const htmlDocumentHandler = createDocumentHandler<"html">({
  kind: "html",
  onCreateDocument: async ({ title, dataStream, modelId }) => {
    let draftContent = "";

    const { fullStream } = streamText({
      model: getLanguageModel(modelId),
      system: `${htmlPrompt}\n\n${htmlOutputInstructions}`,
      prompt: title,
    });

    for await (const delta of fullStream) {
      if (delta.type === "text-delta") {
        draftContent += delta.text;
        dataStream.write({
          type: "data-htmlDelta",
          data: stripFences(draftContent),
          transient: true,
        });
      }
    }

    return stripFences(draftContent);
  },
  onUpdateDocument: async ({ document, description, dataStream, modelId }) => {
    let draftContent = "";

    const { fullStream } = streamText({
      model: getLanguageModel(modelId),
      system: `${updateDocumentPrompt(document.content, "html")}\n\n${htmlPrompt}\n\n${htmlOutputInstructions}`,
      prompt: description,
    });

    for await (const delta of fullStream) {
      if (delta.type === "text-delta") {
        draftContent += delta.text;
        dataStream.write({
          type: "data-htmlDelta",
          data: stripFences(draftContent),
          transient: true,
        });
      }
    }

    return stripFences(draftContent);
  },
});
