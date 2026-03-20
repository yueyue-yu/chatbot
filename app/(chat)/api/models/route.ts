import {
  getAvailableModels,
  getConfiguredDefaultModel,
  getModelCapabilities,
} from "@/lib/ai/provider-config";

export function GET() {
  const headers = {
    "Cache-Control": "public, max-age=86400, s-maxage=86400",
  };

  return Response.json(
    {
      capabilities: getModelCapabilities(),
      defaultModel: getConfiguredDefaultModel(),
      models: getAvailableModels(),
    },
    { headers }
  );
}
