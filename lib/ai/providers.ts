import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { customProvider } from "ai";
import { isTestEnvironment } from "../constants";
import { getOpenAICompatibleConfig } from "./provider-config";

export const myProvider = isTestEnvironment
  ? (() => {
      const { chatModel, titleModel } = require("./models.mock");
      return customProvider({
        languageModels: {
          "chat-model": chatModel,
          "title-model": titleModel,
        },
      });
    })()
  : null;

let openAICompatibleProvider: ReturnType<typeof createOpenAICompatible> | null =
  null;

function getOpenAICompatibleProvider() {
  if (!openAICompatibleProvider) {
    const { apiKey, baseURL } = getOpenAICompatibleConfig();

    openAICompatibleProvider = createOpenAICompatible({
      apiKey,
      baseURL,
      name: "openai-compatible",
    });
  }

  return openAICompatibleProvider;
}

export function getLanguageModel(modelId: string) {
  if (isTestEnvironment && myProvider) {
    return myProvider.languageModel(modelId);
  }

  return getOpenAICompatibleProvider().chatModel(modelId);
}

export function getTitleModel() {
  if (isTestEnvironment && myProvider) {
    return myProvider.languageModel("title-model");
  }

  return getOpenAICompatibleProvider().chatModel(
    getOpenAICompatibleConfig().defaultModel
  );
}
