import { requireUser } from "@/app/(auth)/auth";
import {
  getAvailableModels,
  getConfiguredDefaultModel,
  getModelCapabilities,
} from "@/lib/ai/provider-config";
import { ChatbotError } from "@/lib/errors";

export async function GET() {
  try {
    await requireUser("auth");

    return Response.json(
      {
        capabilities: getModelCapabilities(),
        defaultModel: getConfiguredDefaultModel(),
        models: getAvailableModels(),
      },
      {
        headers: {
          "Cache-Control": "private, max-age=86400",
        },
      }
    );
  } catch (error) {
    if (error instanceof ChatbotError) {
      return error.toResponse();
    }

    throw error;
  }
}
