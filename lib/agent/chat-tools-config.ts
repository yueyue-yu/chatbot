export function getOptionalChatTools<T>({
  createWebSearchTool,
  searchEnabled,
}: {
  createWebSearchTool: () => T;
  searchEnabled: boolean;
}) {
  if (!searchEnabled) {
    return {};
  }

  return {
    webSearch: createWebSearchTool(),
  };
}
