"use client";

import { BrainIcon, EyeIcon, WrenchIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import {
  ModelSelector,
  ModelSelectorContent,
  ModelSelectorGroup,
  ModelSelectorInput,
  ModelSelectorItem,
  ModelSelectorList,
  ModelSelectorLogo,
  ModelSelectorName,
  ModelSelectorTrigger,
} from "@/components/ai-elements/model-selector";
import { Button } from "@/components/ui/button";
import {
  type ChatModel,
  CUSTOM_MODEL_PROVIDER_ID,
  CUSTOM_MODEL_PROVIDER_NAME,
  createCustomChatModel,
  type ModelCapabilities,
  type ModelsResponse,
} from "@/lib/ai/models";
import { cn, fetcher } from "@/lib/utils";

function getCookie(name: string) {
  return document.cookie
    .split("; ")
    .find((row) => row.startsWith(`${name}=`))
    ?.split("=")[1];
}

function setCookie(name: string, value: string) {
  const maxAge = 60 * 60 * 24 * 365;
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=${maxAge}`;
}

export function AgentModelSelector({
  selectedModelId,
  onModelChange,
}: {
  selectedModelId: string;
  onModelChange: (modelId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const { data: modelsData } = useSWR<ModelsResponse>(
    `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/models`,
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 3_600_000 }
  );

  const capabilities: ModelCapabilities | undefined = modelsData?.capabilities;
  const configuredModels = modelsData?.models ?? [];
  const defaultModel = modelsData?.defaultModel;
  const customModelId = query.trim();

  useEffect(() => {
    if (selectedModelId) {
      return;
    }

    const cookieModel = getCookie("agent-model");
    const initialModelId =
      decodeURIComponent(cookieModel ?? "") ||
      defaultModel?.id ||
      configuredModels[0]?.id;

    if (initialModelId) {
      onModelChange(initialModelId);
    }
  }, [configuredModels, defaultModel, onModelChange, selectedModelId]);

  const applyModel = useCallback(
    (modelId: string) => {
      const trimmedModelId = modelId.trim();

      if (!trimmedModelId) {
        return;
      }

      onModelChange(trimmedModelId);
      setCookie("agent-model", trimmedModelId);
      setOpen(false);
      setQuery("");

      setTimeout(() => {
        document
          .querySelector<HTMLTextAreaElement>("[data-testid='agent-input']")
          ?.focus();
      }, 50);
    },
    [onModelChange]
  );

  const selectedModel = useMemo(
    () =>
      configuredModels.find((model) => model.id === selectedModelId) ??
      (selectedModelId ? createCustomChatModel(selectedModelId) : undefined) ??
      defaultModel ??
      configuredModels[0] ?? {
        description: "Model served by your configured OpenAI-compatible provider",
        id: "",
        name: "Configured model",
        provider: CUSTOM_MODEL_PROVIDER_ID,
      },
    [configuredModels, defaultModel, selectedModelId]
  );

  const showCustomOption =
    customModelId.length > 0 &&
    !configuredModels.some((model) => model.id === customModelId);

  return (
    <ModelSelector onOpenChange={setOpen} open={open}>
      <ModelSelectorTrigger asChild>
        <Button
          className="h-9 max-w-[220px] justify-between gap-1.5 rounded-xl px-3 text-[12px] text-muted-foreground transition-colors hover:text-foreground"
          data-testid="agent-model-selector"
          variant="outline"
        >
          <ModelSelectorLogo provider={CUSTOM_MODEL_PROVIDER_ID} />
          <ModelSelectorName>{selectedModel.name}</ModelSelectorName>
        </Button>
      </ModelSelectorTrigger>

      <ModelSelectorContent>
        <ModelSelectorInput
          onValueChange={setQuery}
          placeholder="Search or enter model..."
          value={query}
        />

        <ModelSelectorList>
          {showCustomOption && (
            <ModelSelectorGroup heading="Custom">
              <ModelSelectorItem
                className={cn(
                  "flex w-full",
                  customModelId === selectedModel.id &&
                    "border-b border-dashed border-foreground/50"
                )}
                onSelect={() => applyModel(customModelId)}
                value={`custom:${customModelId}`}
              >
                <ModelSelectorLogo provider={CUSTOM_MODEL_PROVIDER_ID} />
                <ModelSelectorName>
                  Use custom model: {customModelId}
                </ModelSelectorName>
                <div className="ml-auto flex items-center gap-2 text-foreground/70">
                  {capabilities?.tools && <WrenchIcon className="size-3.5" />}
                  {capabilities?.vision && <EyeIcon className="size-3.5" />}
                  {capabilities?.reasoning && <BrainIcon className="size-3.5" />}
                </div>
              </ModelSelectorItem>
            </ModelSelectorGroup>
          )}

          {configuredModels.length > 0 && (
            <ModelSelectorGroup heading={CUSTOM_MODEL_PROVIDER_NAME}>
              {configuredModels.map((model: ChatModel) => (
                <ModelSelectorItem
                  className={cn(
                    "flex w-full",
                    model.id === selectedModel.id &&
                      "border-b border-dashed border-foreground/50"
                  )}
                  key={model.id}
                  onSelect={() => applyModel(model.id)}
                  value={model.id}
                >
                  <ModelSelectorLogo provider={CUSTOM_MODEL_PROVIDER_ID} />
                  <ModelSelectorName>{model.name}</ModelSelectorName>
                  <div className="ml-auto flex items-center gap-2 text-foreground/70">
                    {capabilities?.tools && <WrenchIcon className="size-3.5" />}
                    {capabilities?.vision && <EyeIcon className="size-3.5" />}
                    {capabilities?.reasoning && <BrainIcon className="size-3.5" />}
                  </div>
                </ModelSelectorItem>
              ))}
            </ModelSelectorGroup>
          )}
        </ModelSelectorList>
      </ModelSelectorContent>
    </ModelSelector>
  );
}
