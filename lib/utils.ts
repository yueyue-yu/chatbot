import type {
  UIMessage,
  UIMessagePart,
} from 'ai';
import { type ClassValue, clsx } from 'clsx';
import { formatISO } from 'date-fns';
import { twMerge } from 'tailwind-merge';
import type { DBMessage, Document } from '@/lib/db/schema';
import { ChatbotError, type ErrorCode } from './errors';
import type { ChatMessage, ChatTools, CustomUIDataTypes } from './types';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

async function readErrorResponse(response: Response) {
  try {
    const payload = await response.clone().json();

    if (payload && typeof payload === "object") {
      const { code, cause, error, message } = payload as Record<string, unknown>;

      return {
        cause: typeof cause === "string" ? cause : undefined,
        code: typeof code === "string" ? code : undefined,
        message:
          typeof message === "string"
            ? message
            : typeof error === "string"
              ? error
              : undefined,
      };
    }
  } catch (_error) {
    try {
      const text = await response.clone().text();

      return {
        cause: undefined,
        code: undefined,
        message: text || undefined,
      };
    } catch (_nestedError) {
      return {
        cause: undefined,
        code: undefined,
        message: undefined,
      };
    }
  }

  return {
    cause: undefined,
    code: undefined,
    message: undefined,
  };
}

export const fetcher = async (url: string) => {
  const response = await fetch(url);

  if (!response.ok) {
    const { code, cause, message } = await readErrorResponse(response);

    if (code) {
      throw new ChatbotError(code as ErrorCode, cause);
    }

    throw new Error(message || `Request failed with status ${response.status}`);
  }

  return response.json();
};

export async function fetchWithErrorHandlers(
  input: RequestInfo | URL,
  init?: RequestInit,
) {
  try {
    const response = await fetch(input, init);

    if (!response.ok) {
      const { code, cause, message } = await readErrorResponse(response);

      if (code) {
        throw new ChatbotError(code as ErrorCode, cause);
      }

      throw new Error(message || `Request failed with status ${response.status}`);
    }

    return response;
  } catch (error: unknown) {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      throw new ChatbotError('offline:chat');
    }

    throw error;
  }
}

export function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function getDocumentTimestampByIndex(
  documents: Document[],
  index: number,
) {
  if (!documents) { return new Date(); }
  if (index > documents.length) { return new Date(); }

  return documents[index].createdAt;
}

export function sanitizeText(text: string) {
  return text.replace('<has_function_call>', '');
}

export function convertToUIMessages(messages: DBMessage[]): ChatMessage[] {
  return messages.map((message) => ({
    id: message.id,
    role: message.role as 'user' | 'assistant' | 'system',
    parts: message.parts as UIMessagePart<CustomUIDataTypes, ChatTools>[],
    metadata: {
      createdAt: formatISO(message.createdAt),
    },
  }));
}

export function getTextFromMessage(message: ChatMessage | UIMessage): string {
  return message.parts
    .filter((part) => part.type === 'text')
    .map((part) => (part as { type: 'text'; text: string}).text)
    .join('');
}
