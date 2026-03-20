import "server-only";

import { createCustomChatModel, type ModelCapabilities } from "@/lib/ai/models";
import { isTestEnvironment } from "@/lib/constants";
import { ChatbotError } from "@/lib/errors";

function readRequiredEnv(name: string): string {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new ChatbotError("bad_request:provider", `${name} is not configured`);
  }

  return value;
}

function parseBooleanEnv(name: string) {
  return process.env[name]?.trim().toLowerCase() === "true";
}

export function getOpenAICompatibleConfig() {
  if (isTestEnvironment) {
    return {
      apiKey: process.env.OPENAI_COMPAT_API_KEY?.trim() || "test-api-key",
      baseURL:
        process.env.OPENAI_COMPAT_BASE_URL?.trim() || "https://example.com/v1",
      defaultModel:
        process.env.OPENAI_COMPAT_DEFAULT_MODEL?.trim() || "chat-model",
    };
  }

  return {
    apiKey: readRequiredEnv("OPENAI_COMPAT_API_KEY"),
    baseURL: readRequiredEnv("OPENAI_COMPAT_BASE_URL"),
    defaultModel: readRequiredEnv("OPENAI_COMPAT_DEFAULT_MODEL"),
  };
}

export function getConfiguredDefaultModel() {
  return createCustomChatModel(getOpenAICompatibleConfig().defaultModel);
}

export function getAvailableModels() {
  return [getConfiguredDefaultModel()];
}

export function getModelCapabilities(): ModelCapabilities {
  return {
    reasoning: parseBooleanEnv("OPENAI_COMPAT_SUPPORTS_REASONING"),
    tools: parseBooleanEnv("OPENAI_COMPAT_SUPPORTS_TOOLS"),
    vision: parseBooleanEnv("OPENAI_COMPAT_SUPPORTS_VISION"),
  };
}

export function resolveChatModel(modelId: string | null | undefined) {
  const normalizedModelId = modelId?.trim();

  if (normalizedModelId) {
    return normalizedModelId;
  }

  return getOpenAICompatibleConfig().defaultModel;
}
