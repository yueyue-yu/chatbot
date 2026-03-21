import { geolocation, ipAddress } from "@vercel/functions";
import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  generateId,
  stepCountIs,
  streamText,
} from "ai";
import { checkBotId } from "botid/server";
import { after } from "next/server";
import { createResumableStreamContext } from "resumable-stream";
import { auth, type UserType } from "@/app/(auth)/auth";
import { entitlementsByUserType } from "@/lib/ai/entitlements";
import { type RequestHints, systemPrompt } from "@/lib/ai/prompts";
import {
  getModelCapabilities,
  resolveChatModel,
} from "@/lib/ai/provider-config";
import { getLanguageModel } from "@/lib/ai/providers";
import { createDocument } from "@/lib/ai/tools/create-document";
import { editDocument } from "@/lib/ai/tools/edit-document";
import { requestSuggestions } from "@/lib/ai/tools/request-suggestions";
import { updateDocument } from "@/lib/ai/tools/update-document";
import {
  isDevelopmentEnvironment,
  isProductionEnvironment,
  isVercelProductionEnvironment,
} from "@/lib/constants";
import {
  createStreamId,
  deleteChatById,
  getChatById,
  getMessageCountByUserId,
  getMessagesByChatId,
  saveChat,
  saveMessages,
  updateChatTitleById,
} from "@/lib/db/queries";
import type { DBMessage } from "@/lib/db/schema";
import { ChatbotError } from "@/lib/errors";
import { checkIpRateLimit } from "@/lib/ratelimit";
import type { ChatMessage } from "@/lib/types";
import { convertToUIMessages, generateUUID } from "@/lib/utils";
import { generateTitleFromUserMessage } from "../../actions";
import { type PostRequestBody, postRequestBodySchema } from "./schema";

export const maxDuration = 60;

function getStreamContext() {
  try {
    // 为 SSE 响应创建“可恢复流”上下文。
    // 这样在 Redis 可用时，前端断线后仍有机会继续消费同一条流。
    return createResumableStreamContext({ waitUntil: after });
  } catch (_) {
    // 本地开发或当前运行环境不支持时，直接降级为普通流，不阻塞主流程。
    return null;
  }
}

export { getStreamContext };

export async function POST(request: Request) {
  let requestBody: PostRequestBody;

  try {
    // 先解析并校验请求体，确保后续逻辑拿到的是结构正确的数据。
    const json = await request.json();
    requestBody = postRequestBodySchema.parse(json);
  } catch (_) {
    return new ChatbotError("bad_request:api").toResponse();
  }

  try {
    // 从请求体里取出聊天所需的核心参数：
    // - id: chat id
    // - message: 当前新发来的用户消息
    // - selectedChatModel: 用户选择的模型
    // - selectedVisibilityType: 新 chat 的可见性
    const { id, message, selectedChatModel, selectedVisibilityType } =
      requestBody;

    // 并行做两件事：
    // 1. 生产环境校验 bot 防护
    // 2. 获取当前登录用户会话
    const [, session] = await Promise.all([
      isVercelProductionEnvironment
        ? checkBotId().catch(() => null)
        : Promise.resolve(null),
      auth(),
    ]);

    if (!session?.user) {
      return new ChatbotError("unauthorized:chat").toResponse();
    }

    // 规范化模型 id，避免直接使用前端传入值。
    const chatModel = resolveChatModel(selectedChatModel);

    // 先做基于 IP 的限流，拦截明显过快的请求。
    await checkIpRateLimit(ipAddress(request));

    const userType: UserType = session.user.type;

    // 再做基于用户身份的额度校验，例如 1 小时内可发送消息数。
    const messageCount = await getMessageCountByUserId({
      id: session.user.id,
      differenceInHours: 1,
    });

    if (messageCount > entitlementsByUserType[userType].maxMessagesPerHour) {
      return new ChatbotError("rate_limit:chat").toResponse();
    }

    // 读取 chat 主记录，并准备后续需要的历史消息和标题生成任务。
    const chat = await getChatById({ id });
    let messagesFromDb: DBMessage[] = [];
    let titlePromise: Promise<string> | null = null;

    if (chat) {
      // chat 已存在时，先校验归属权，再加载历史消息。
      if (chat.userId !== session.user.id) {
        return new ChatbotError("forbidden:chat").toResponse();
      }
      messagesFromDb = await getMessagesByChatId({ id });
    } else {
      // chat 不存在且当前是用户首条消息时，先创建 chat，
      // 再异步准备一个标题，后面在流里返回给前端并写回数据库。
      await saveChat({
        id,
        userId: session.user.id,
        title: "New chat",
        visibility: selectedVisibilityType,
      });
      titlePromise = generateTitleFromUserMessage({ message });
    }

    // 当前请求固定为单条用户消息：历史消息来自数据库，再拼上当前用户刚发来的这条消息。
    const uiMessages: ChatMessage[] = [
      ...convertToUIMessages(messagesFromDb),
      message as ChatMessage,
    ];

    // 从请求中提取地理位置信息，用于 system prompt 给模型一些上下文提示。
    const { longitude, latitude, city, country } = geolocation(request);

    const requestHints: RequestHints = {
      longitude,
      latitude,
      city,
      country,
    };

    // 当前用户消息先落库，这样即使后续模型流式生成中断，用户输入本身也不会丢失。
    await saveMessages({
      messages: [
        {
          chatId: id,
          id: message.id,
          role: "user",
          parts: message.parts,
          attachments: [],
          createdAt: new Date(),
        },
      ],
    });

    // 根据当前模型配置判断：
    // - 是否是 reasoning model
    // - 是否支持 tools
    // 后面会影响 system prompt、工具启用列表以及推理内容返回方式。
    const capabilities = getModelCapabilities();
    const isReasoningModel = capabilities.reasoning;
    const supportsTools = capabilities.tools;

    // 把 UI 消息格式转换成底层模型可消费的消息格式。
    const modelMessages = await convertToModelMessages(uiMessages);

    // 创建 UI 消息流，统一处理：
    // - 调用模型
    // - 把模型结果转成前端可消费的流
    // - 在结束时把生成结果持久化
    const stream = createUIMessageStream({
      execute: async ({ writer: dataStream }) => {
        // 真正发起模型流式生成。
        const result = streamText({
          model: getLanguageModel(chatModel),
          system: systemPrompt({ requestHints, supportsTools }),
          messages: modelMessages,
          // 最多允许 5 个 step，避免工具调用或推理链无限继续。
          stopWhen: stepCountIs(5),
          experimental_activeTools:
            isReasoningModel && !supportsTools
              ? []
              : [
                  "createDocument",
                  "editDocument",
                  "updateDocument",
                  "requestSuggestions",
                ],
          // 注册所有允许模型调用的工具。
          tools: {
            createDocument: createDocument({
              session,
              dataStream,
              modelId: chatModel,
            }),
            editDocument: editDocument({ dataStream, session }),
            updateDocument: updateDocument({
              session,
              dataStream,
              modelId: chatModel,
            }),
            requestSuggestions: requestSuggestions({
              session,
              dataStream,
              modelId: chatModel,
            }),
          },
          experimental_telemetry: {
            isEnabled: isProductionEnvironment,
            functionId: "stream-text",
          },
        });

        // 把底层模型流转换并合并成 UI 消息流，持续推给前端。
        dataStream.merge(
          result.toUIMessageStream({ sendReasoning: isReasoningModel })
        );

        if (titlePromise) {
          // 如果这是一个新 chat，等标题生成好后通过流推给前端，
          // 同时异步更新数据库中的 chat title。
          const title = await titlePromise;
          dataStream.write({ type: "data-chat-title", data: title });
          updateChatTitleById({ chatId: id, title });
        }
      },
      generateId: generateUUID,
      onFinish: async ({ messages: finishedMessages }) => {
        // 流式生成结束后，把本次新增的 assistant 消息持久化。
        if (finishedMessages.length > 0) {
          await saveMessages({
            messages: finishedMessages.map((currentMessage) => ({
              id: currentMessage.id,
              role: currentMessage.role,
              parts: currentMessage.parts,
              createdAt: new Date(),
              attachments: [],
              chatId: id,
            })),
          });
        }
      },
      onError: (error) => {
        // 业务错误返回可读提示；未知错误统一兜底。
        if (error instanceof ChatbotError) {
          return error.message;
        }

        if (isDevelopmentEnvironment && error instanceof Error) {
          return error.message;
        }

        return "Oops, an error occurred!";
      },
    });

    return createUIMessageStreamResponse({
      stream,
      async consumeSseStream({ stream: sseStream }) {
        // 只有配置了 Redis，才启用“可恢复流”能力。
        if (!process.env.REDIS_URL) {
          return;
        }
        try {
          const streamContext = getStreamContext();
          if (streamContext) {
            // 为当前 chat 生成 streamId，并把 SSE 流注册成可恢复流。
            const streamId = generateId();
            await createStreamId({ streamId, chatId: id });
            await streamContext.createNewResumableStream(
              streamId,
              () => sseStream
            );
          }
        } catch (_) {
          // 可恢复流是增强能力，失败不影响主聊天流程。
        }
      },
    });
  } catch (error) {
    // 统一兜底 POST 处理中的未捕获异常，并记录 vercel 请求 id 便于排查。
    const vercelId = request.headers.get("x-vercel-id");

    if (error instanceof ChatbotError) {
      return error.toResponse();
    }

    console.error("Unhandled error in chat API:", error, { vercelId });
    return new ChatbotError("offline:chat").toResponse();
  }
}

export async function DELETE(request: Request) {
  // DELETE 用于删除整个 chat，会从 query string 中读取 chat id。
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id) {
    return new ChatbotError("bad_request:api").toResponse();
  }

  const session = await auth();

  if (!session?.user) {
    return new ChatbotError("unauthorized:chat").toResponse();
  }

  // 只允许删除当前登录用户自己的 chat。
  const chat = await getChatById({ id });

  if (chat?.userId !== session.user.id) {
    return new ChatbotError("forbidden:chat").toResponse();
  }

  // 删除 chat 后返回删除结果。
  const deletedChat = await deleteChatById({ id });

  return Response.json(deletedChat, { status: 200 });
}
