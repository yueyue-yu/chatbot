"use client";

import { useMemo } from "react";
import useSWR, { useSWRConfig } from "swr";
import { unstable_serialize } from "swr/infinite";
import { updateChatVisibility } from "@/app/(chat)/actions";
import {
  type ChatHistory,
  getChatHistoryPaginationKey,
} from "@/components/chat/sidebar-history";
import { toast } from "@/components/chat/toast";
import type { VisibilityType } from "@/components/chat/visibility-selector";

export function useChatVisibility({
  chatId,
  initialVisibilityType,
}: {
  chatId: string;
  initialVisibilityType: VisibilityType;
}) {
  const { mutate, cache } = useSWRConfig();
  const historyPages: ChatHistory[] | undefined = cache.get(
    unstable_serialize(getChatHistoryPaginationKey)
  )?.data;
  const history = historyPages?.flatMap((page) => page.chats) ?? [];

  const { data: localVisibility, mutate: setLocalVisibility } = useSWR(
    `${chatId}-visibility`,
    null,
    {
      fallbackData: initialVisibilityType,
    }
  );

  const visibilityType = useMemo(() => {
    const chat = history.find((currentChat) => currentChat.id === chatId);
    if (!chat) {
      return localVisibility;
    }
    return chat.visibility;
  }, [history, chatId, localVisibility]);

  const setHistoryVisibility = (updatedVisibilityType: VisibilityType) => {
    mutate(
      unstable_serialize(getChatHistoryPaginationKey),
      (pages: ChatHistory[] | undefined) =>
        pages?.map((page) => ({
          ...page,
          chats: page.chats.map((chat) =>
            chat.id === chatId
              ? { ...chat, visibility: updatedVisibilityType }
              : chat
          ),
        })),
      { revalidate: false }
    );
  };

  const setVisibilityType = (updatedVisibilityType: VisibilityType) => {
    const previousVisibilityType = visibilityType ?? initialVisibilityType;

    setLocalVisibility(updatedVisibilityType, { revalidate: false });
    setHistoryVisibility(updatedVisibilityType);

    updateChatVisibility({
      chatId,
      visibility: updatedVisibilityType,
    }).catch(() => {
      setLocalVisibility(previousVisibilityType, { revalidate: false });
      setHistoryVisibility(previousVisibilityType);
      toast({
        type: "error",
        description: "Failed to update chat visibility.",
      });
    });
  };

  return { visibilityType, setVisibilityType };
}
