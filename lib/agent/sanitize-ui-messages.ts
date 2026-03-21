type MessageWithParts = {
  parts: unknown[];
  role?: unknown;
};

function isMessageWithParts(message: unknown): message is MessageWithParts {
  return (
    typeof message === "object" &&
    message !== null &&
    "parts" in message &&
    Array.isArray(message.parts)
  );
}

export function sanitizeAgentUIMessages<T>(messages: T[]): T[] {
  return messages.flatMap((message) => {
    if (!isMessageWithParts(message)) {
      return [message];
    }

    return [
      {
        ...message,
        parts: message.parts,
      } as T,
    ];
  });
}
