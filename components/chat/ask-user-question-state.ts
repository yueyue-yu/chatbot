import type { ChatMessage } from "@/lib/types";

type AskUserQuestionPart = Extract<
  ChatMessage["parts"][number],
  { type: "tool-askUserQuestion" }
>;

type AskUserQuestionOption = {
  label: string;
  value?: string;
  description?: string;
};

type PendingAskUserQuestion = {
  messageId: string;
  toolCallId: string;
};

type AskUserQuestionAnswer = AskUserQuestionPart["output"] extends infer Output
  ? Output
  : never;

export function getAskUserQuestionPart(
  message: ChatMessage,
  toolCallId?: string
): AskUserQuestionPart | null {
  for (const part of message.parts) {
    if (part.type !== "tool-askUserQuestion") {
      continue;
    }

    if (!toolCallId || part.toolCallId === toolCallId) {
      return part;
    }
  }

  return null;
}

export function getAskUserQuestionAnswer(
  messages: ChatMessage[],
  messageId: string,
  toolCallId: string
) {
  const message = messages.find((candidate) => candidate.id === messageId);
  const part = message ? getAskUserQuestionPart(message, toolCallId) : null;

  if (!part || part.state !== "output-available") {
    return null;
  }

  return part.output.answer;
}

export function getAskUserQuestionAnswerLabel(
  part: AskUserQuestionPart,
  answer: string | null
) {
  if (!answer) {
    return null;
  }

  if (part.state === "output-available") {
    return part.output.label;
  }

  const questionInput = part.input;
  const options = (questionInput?.options ?? []) as AskUserQuestionOption[];
  const matchedOption = options.find(
    (option) => option.value === answer || option.label === answer
  );

  return matchedOption?.label ?? answer;
}

export function findLatestPendingAskUserQuestion(
  messages: ChatMessage[]
): PendingAskUserQuestion | null {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];

    if (message.role !== "assistant") {
      continue;
    }

    for (let partIndex = message.parts.length - 1; partIndex >= 0; partIndex--) {
      const part = message.parts[partIndex];

      if (
        part.type === "tool-askUserQuestion" &&
        part.state === "input-available"
      ) {
        return {
          messageId: message.id,
          toolCallId: part.toolCallId,
        };
      }
    }
  }

  return null;
}

function getAskUserQuestionOutput(part: AskUserQuestionPart): AskUserQuestionAnswer | null {
  if (part.state !== "output-available") {
    return null;
  }

  return part.output;
}

export function hasPendingAskUserQuestion(messages: ChatMessage[]) {
  return findLatestPendingAskUserQuestion(messages) !== null;
}

export function getAskUserQuestionCardState(
  messages: ChatMessage[],
  messageId: string,
  toolCallId: string
) {
  const message = messages.find((candidate) => candidate.id === messageId);
  const part = message ? getAskUserQuestionPart(message, toolCallId) : null;
  const output = part ? getAskUserQuestionOutput(part) : null;
  const answer = output?.answer ?? null;
  const latestPending = findLatestPendingAskUserQuestion(messages);

  return {
    answer,
    answerLabel: part ? getAskUserQuestionAnswerLabel(part, answer) : answer,
    isPending:
      latestPending?.messageId === messageId &&
      latestPending.toolCallId === toolCallId,
    part,
  };
}
