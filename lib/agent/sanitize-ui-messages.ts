function isLegacyPlanTaskPart(part: unknown) {
  return (
    typeof part === "object" &&
    part !== null &&
    "type" in part &&
    part.type === "tool-planTask"
  );
}

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

    const sanitizedParts = message.parts.filter(
      (part) => !isLegacyPlanTaskPart(part)
    );

    if (sanitizedParts.length === 0 && message.role === "assistant") {
      return [];
    }

    return [
      {
        ...message,
        parts: sanitizedParts,
      } as T,
    ];
  });
}
