export const CUSTOM_MODEL_PROVIDER_ID = "openai";
export const CUSTOM_MODEL_PROVIDER_NAME = "OpenAI Compatible";

export type ModelCapabilities = {
  tools: boolean;
  vision: boolean;
  reasoning: boolean;
};

export type ChatModel = {
  id: string;
  name: string;
  provider: string;
  description: string;
};

export type ModelsResponse = {
  capabilities: ModelCapabilities;
  defaultModel: ChatModel;
  models: ChatModel[];
};

export function createCustomChatModel(modelId: string): ChatModel {
  return {
    id: modelId,
    name: modelId,
    provider: CUSTOM_MODEL_PROVIDER_ID,
    description: "Model served by your configured OpenAI-compatible provider",
  };
}
