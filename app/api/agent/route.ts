import { createAgentUIStreamResponse } from "ai";
import { auth } from "@/app/(auth)/auth";
import { createArtifactAgent } from "@/lib/agent/agent";
import { sanitizeAgentUIMessages } from "@/lib/agent/sanitize-ui-messages";
import { getModelCapabilities, resolveChatModel } from "@/lib/ai/provider-config";
import { ChatbotError } from "@/lib/errors";
import { type PostRequestBody, postRequestBodySchema } from "./schema";

export const maxDuration = 30;

export async function POST(request: Request) {
  let requestBody: PostRequestBody;

  try {
    const json = await request.json();
    requestBody = postRequestBodySchema.parse(json);
  } catch (_error) {
    return new ChatbotError("bad_request:agent").toResponse();
  }

  try {
    const session = await auth();

    if (!session?.user || session.user.type === "guest") {
      return new ChatbotError("unauthorized:agent").toResponse();
    }

    const capabilities = getModelCapabilities();

    if (!capabilities.tools) {
      return Response.json(
        {
          message:
            "The current model provider does not support tool calling, so the /agent demo is unavailable.",
        },
        { status: 400 }
      );
    }

    const agent = createArtifactAgent({
      modelId: resolveChatModel(requestBody.selectedModel),
      session,
    });

    return await createAgentUIStreamResponse({
      abortSignal: request.signal,
      agent,
      uiMessages: sanitizeAgentUIMessages(requestBody.messages),
    });
  } catch (error) {
    if (error instanceof ChatbotError) {
      return error.toResponse();
    }

    if (error instanceof Error) {
      return Response.json(
        {
          message: error.message || "Something went wrong while running the agent demo.",
        },
        { status: 500 }
      );
    }

    return Response.json(
      { message: "Something went wrong while running the agent demo." },
      { status: 500 }
    );
  }
}
