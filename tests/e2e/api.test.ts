import { expect, test } from "@playwright/test";
import { registerAndAuthenticate } from "../helpers";

const CHAT_URL_REGEX = /\/chat\/[\w-]+/;
const ERROR_TEXT_REGEX = /error|failed|trouble/i;

type ChatApiRequestBody = {
  id: string;
  selectedChatModel: string;
  selectedVisibilityType: "public" | "private";
} & (
  | {
      message: {
        id: string;
        role: "user";
        parts: Array<
          | { type: "text"; text: string }
          | { type: "file"; url: string; name: string; mediaType: string }
        >;
      };
    }
  | {
      toolMessage: {
        id: string;
        role: "assistant";
        parts: Array<
          | { type: "step-start" }
          | {
              type: "tool-askUserQuestion";
              input: {
                question: string;
                options: Array<{
                  label: string;
                  value?: string;
                  description?: string;
                }>;
                placeholder?: string;
              };
              output: {
                answer: string;
                label: string;
                source: "option" | "other";
              };
              state: "output-available";
              toolCallId: string;
            }
        >;
      };
    }
);

function getChatRequestBody(request: { postDataJSON(): unknown }) {
  return request.postDataJSON() as ChatApiRequestBody;
}

function createDeferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((res) => {
    resolve = res;
  });

  return { promise, resolve };
}

function createUiMessageStreamBody(text: string) {
  const chunks = [
    { type: "start" },
    { type: "start-step" },
    { type: "text-start", id: "text-1" },
    { type: "text-delta", id: "text-1", delta: text },
    { type: "text-end", id: "text-1" },
    { type: "finish-step" },
    { type: "finish", finishReason: "stop" },
  ];

  return `${chunks
    .map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`)
    .join("")}data: [DONE]\n\n`;
}

function createAskUserQuestionStreamBody() {
  const chunks = [
    { type: "start" },
    { type: "start-step" },
    {
      type: "tool-input-start",
      toolCallId: "ask-user-question-1",
      toolName: "askUserQuestion",
    },
    {
      type: "tool-input-available",
      toolCallId: "ask-user-question-1",
      toolName: "askUserQuestion",
      input: {
        question: "Which stack should we target?",
        options: [
          {
            label: "Next.js",
            value: "nextjs",
            description: "Use the App Router implementation",
          },
          {
            label: "Remix",
            value: "remix",
            description: "Target the Remix code path",
          },
        ],
        placeholder: "Describe your preferred stack",
      },
    },
    { type: "finish-step" },
    { type: "finish", finishReason: "tool-calls" },
  ];

  return `${chunks
    .map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`)
    .join("")}data: [DONE]\n\n`;
}

function expectAskUserQuestionToolRequest(
  body: ChatApiRequestBody,
  output: {
    answer: string;
    label: string;
    source: "option" | "other";
  }
) {
  expect("toolMessage" in body).toBe(true);

  if (!("toolMessage" in body)) {
    return;
  }

  expect(body.toolMessage.role).toBe("assistant");
  expect(body.toolMessage.parts.some((part) => part.type === "step-start")).toBe(
    true
  );

  const toolPart = body.toolMessage.parts.find(
    (part): part is Extract<(typeof body.toolMessage.parts)[number], { type: "tool-askUserQuestion" }> =>
      part.type === "tool-askUserQuestion"
  );

  expect(toolPart).toEqual({
    type: "tool-askUserQuestion",
    input: {
      question: "Which stack should we target?",
      options: [
        {
          label: "Next.js",
          value: "nextjs",
          description: "Use the App Router implementation",
        },
        {
          label: "Remix",
          value: "remix",
          description: "Target the Remix code path",
        },
      ],
      placeholder: "Describe your preferred stack",
    },
    output,
    state: "output-available",
    toolCallId: "ask-user-question-1",
  });
}

function expectUserMessageRequest(body: ChatApiRequestBody) {
  expect("message" in body).toBe(true);

  if (!("message" in body)) {
    throw new Error("Expected a user-message /api/chat request.");
  }

  return body.message;
}

test.describe("Chat API Integration", () => {
  test.beforeEach(async ({ page }) => {
    await registerAndAuthenticate(page);
  });

  test("sends message and receives AI response", async ({ page }) => {
    await page.goto("/");

    const input = page.getByTestId("multimodal-input");
    await input.fill("Hello");
    await page.getByTestId("send-button").click();

    // Wait for assistant response to appear
    const assistantMessage = page.locator("[data-role='assistant']").first();
    await expect(assistantMessage).toBeVisible({ timeout: 30_000 });

    // Verify it has some text content
    const content = await assistantMessage.textContent();
    expect(content?.length).toBeGreaterThan(0);
  });

  test("sends only the latest user message in /api/chat request body", async ({
    page,
  }) => {
    await page.goto("/");

    const input = page.getByTestId("multimodal-input");
    const requestPromise = page.waitForRequest(
      (request) =>
        request.url().includes("/api/chat") && request.method() === "POST"
    );

    await input.fill("Hello");
    await page.getByTestId("send-button").click();

    const request = await requestPromise;
    const body = getChatRequestBody(request);
    const message = expectUserMessageRequest(body);

    expect(message.role).toBe("user");
    expect(message.parts).toEqual([
      {
        type: "text",
        text: "Hello",
      },
    ]);
  });

  test("redirects to /chat/:id after sending message", async ({ page }) => {
    await page.goto("/");

    const input = page.getByTestId("multimodal-input");
    await input.fill("Test redirect");
    await page.getByTestId("send-button").click();

    // URL should change to /chat/:id format
    await expect(page).toHaveURL(CHAT_URL_REGEX, { timeout: 10_000 });
  });

  test("clears input immediately after sending", async ({ page }) => {
    await page.goto("/");

    const delayedResponse = createDeferred();
    await page.route("**/api/chat", async (route) => {
      await delayedResponse.promise;
      await route.fulfill({
        status: 200,
        headers: {
          "cache-control": "no-cache",
          connection: "keep-alive",
          "content-type": "text/event-stream",
          "x-vercel-ai-ui-message-stream": "v1",
        },
        body: createUiMessageStreamBody("Delayed response"),
      });
    });

    const input = page.getByTestId("multimodal-input");
    const requestPromise = page.waitForRequest(
      (request) =>
        request.url().includes("/api/chat") && request.method() === "POST"
    );

    await input.fill("Test message");
    await page.getByTestId("send-button").click();
    await requestPromise;

    // Input should clear before the delayed response finishes.
    await expect(input).toHaveValue("");

    delayedResponse.resolve();
    await expect(page.locator("[data-role='assistant']").first()).toBeVisible({
      timeout: 30_000,
    });
  });

  test("restored draft stays cleared after sending", async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem("input", JSON.stringify("Persisted draft"));
    });

    await page.goto("/");

    const input = page.getByTestId("multimodal-input");
    await expect(input).toHaveValue("Persisted draft");

    const requestPromise = page.waitForRequest(
      (request) =>
        request.url().includes("/api/chat") && request.method() === "POST"
    );

    await page.getByTestId("send-button").click();
    await requestPromise;
    await expect(input).toHaveValue("");
    await page.waitForTimeout(150);
    await expect(input).toHaveValue("");
  });

  test("shows stop button during generation", async ({ page }) => {
    await page.goto("/");
    const input = page.getByTestId("multimodal-input");
    await input.fill("Test");
    await page.getByTestId("send-button").click();

    // Stop button should appear during generation
    const stopButton = page.getByTestId("stop-button");
    await expect(stopButton).toBeVisible({ timeout: 5000 });
  });

  test("editing a message still submits the edited user message payload", async ({
    page,
  }) => {
    await page.goto("/");

    const input = page.getByTestId("multimodal-input");
    await input.fill("Original message");
    await page.getByTestId("send-button").click();

    const assistantMessage = page.locator("[data-role='assistant']").first();
    await expect(assistantMessage).toBeVisible({ timeout: 30_000 });

    await page.getByTestId("message-user").first().hover();
    await page.getByTestId("message-edit-button").first().click({
      force: true,
    });

    await expect(input).toHaveValue("Original message");

    const editedText = "Edited message";
    const delayedResponse = createDeferred();
    await page.route("**/api/chat", async (route) => {
      await delayedResponse.promise;
      await route.fulfill({
        status: 200,
        headers: {
          "cache-control": "no-cache",
          connection: "keep-alive",
          "content-type": "text/event-stream",
          "x-vercel-ai-ui-message-stream": "v1",
        },
        body: createUiMessageStreamBody("Edited response"),
      });
    });

    const requestPromise = page.waitForRequest(
      (request) =>
        request.url().includes("/api/chat") && request.method() === "POST"
    );

    await input.fill(editedText);
    await page.getByTestId("send-button").click();

    const request = await requestPromise;
    const body = getChatRequestBody(request);
    const message = expectUserMessageRequest(body);

    expect(message.role).toBe("user");
    expect(message.parts).toEqual([
      {
        type: "text",
        text: editedText,
      },
    ]);

    await expect(page.getByTestId("multimodal-input")).toHaveValue("");
    delayedResponse.resolve();
  });
});

test.describe("Chat Error Handling", () => {
  test.beforeEach(async ({ page }) => {
    await registerAndAuthenticate(page);
  });

  test("handles API error gracefully", async ({ page }) => {
    await page.route("**/api/chat", async (route) => {
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "Internal server error" }),
      });
    });

    await page.goto("/");
    const input = page.getByTestId("multimodal-input");
    await input.fill("Test error");
    await page.getByTestId("send-button").click();

    // Should show error toast or message
    await expect(page.getByText(ERROR_TEXT_REGEX).first()).toBeVisible({
      timeout: 5000,
    });
  });
});

test.describe("Ask User Question Tool", () => {
  test.beforeEach(async ({ page }) => {
    await registerAndAuthenticate(page);
  });

  test("renders ask-user-question options with an Other action", async ({
    page,
  }) => {
    await page.route("**/api/chat", async (route) => {
      await route.fulfill({
        status: 200,
        headers: {
          "cache-control": "no-cache",
          connection: "keep-alive",
          "content-type": "text/event-stream",
          "x-vercel-ai-ui-message-stream": "v1",
        },
        body: createAskUserQuestionStreamBody(),
      });
    });

    await page.goto("/");
    await page.getByTestId("multimodal-input").fill("Help me build this");
    await page.getByTestId("send-button").click();

    await expect(
      page.getByText("Which stack should we target?")
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Next.js" })
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Remix" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Other" })).toBeVisible();
  });

  test("selecting an option submits askUserQuestion tool output", async ({
    page,
  }) => {
    let requestCount = 0;
    await page.route("**/api/chat", async (route) => {
      requestCount += 1;

      await route.fulfill({
        status: 200,
        headers: {
          "cache-control": "no-cache",
          connection: "keep-alive",
          "content-type": "text/event-stream",
          "x-vercel-ai-ui-message-stream": "v1",
        },
        body:
          requestCount === 1
            ? createAskUserQuestionStreamBody()
            : createUiMessageStreamBody("Thanks for the clarification"),
      });
    });

    await page.goto("/");
    await page.getByTestId("multimodal-input").fill("Build the app");
    await page.getByTestId("send-button").click();
    await expect(
      page.getByRole("button", { name: "Next.js" })
    ).toBeVisible();

    const secondRequestPromise = page.waitForRequest(
      (request) =>
        request.url().includes("/api/chat") && request.method() === "POST"
    );

    await page.getByRole("button", { name: "Next.js" }).click();

    const secondRequest = await secondRequestPromise;
    const body = getChatRequestBody(secondRequest);

    expectAskUserQuestionToolRequest(body, {
      answer: "nextjs",
      label: "Next.js",
      source: "option",
    });
  });

  test("Other reveals a text input and submits custom tool output", async ({
    page,
  }) => {
    let requestCount = 0;
    await page.route("**/api/chat", async (route) => {
      requestCount += 1;

      await route.fulfill({
        status: 200,
        headers: {
          "cache-control": "no-cache",
          connection: "keep-alive",
          "content-type": "text/event-stream",
          "x-vercel-ai-ui-message-stream": "v1",
        },
        body:
          requestCount === 1
            ? createAskUserQuestionStreamBody()
            : createUiMessageStreamBody("Custom answer received"),
      });
    });

    await page.goto("/");
    await page.getByTestId("multimodal-input").fill("Build the app");
    await page.getByTestId("send-button").click();

    await page.getByTestId("ask-user-question-other-button").click();
    const customInput = page.getByTestId("ask-user-question-other-input");
    await expect(customInput).toBeVisible();

    const secondRequestPromise = page.waitForRequest(
      (request) =>
        request.url().includes("/api/chat") && request.method() === "POST"
    );

    await customInput.fill("Use SvelteKit instead");
    await page.getByTestId("ask-user-question-other-submit").click();

    const secondRequest = await secondRequestPromise;
    const body = getChatRequestBody(secondRequest);

    expectAskUserQuestionToolRequest(body, {
      answer: "Use SvelteKit instead",
      label: "Use SvelteKit instead",
      source: "other",
    });
  });

  test("composer is disabled while the question is pending and re-enabled after answering", async ({
    page,
  }) => {
    let requestCount = 0;
    await page.route("**/api/chat", async (route) => {
      requestCount += 1;

      await route.fulfill({
        status: 200,
        headers: {
          "cache-control": "no-cache",
          connection: "keep-alive",
          "content-type": "text/event-stream",
          "x-vercel-ai-ui-message-stream": "v1",
        },
        body:
          requestCount === 1
            ? createAskUserQuestionStreamBody()
            : createUiMessageStreamBody("All set"),
      });
    });

    await page.goto("/");
    const composer = page.getByTestId("multimodal-input");
    await composer.fill("Build the app");
    await page.getByTestId("send-button").click();

    await expect(composer).toBeDisabled();
    await page.getByRole("button", { name: "Remix" }).click();
    await expect(composer).toBeEnabled();
  });

  test("answered ask-user-question cards become read-only", async ({
    page,
  }) => {
    let requestCount = 0;
    await page.route("**/api/chat", async (route) => {
      requestCount += 1;

      await route.fulfill({
        status: 200,
        headers: {
          "cache-control": "no-cache",
          connection: "keep-alive",
          "content-type": "text/event-stream",
          "x-vercel-ai-ui-message-stream": "v1",
        },
        body:
          requestCount === 1
            ? createAskUserQuestionStreamBody()
            : createUiMessageStreamBody("Done"),
      });
    });

    await page.goto("/");
    await page.getByTestId("multimodal-input").fill("Build the app");
    await page.getByTestId("send-button").click();

    await page.getByRole("button", { name: "Next.js" }).click();

    await expect(page.getByText("Answer: Next.js")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Next.js" })
    ).not.toBeVisible();
    await expect(page.getByRole("button", { name: "Other" })).not.toBeVisible();
  });
});

test.describe("Suggested Actions", () => {
  test.beforeEach(async ({ page }) => {
    await registerAndAuthenticate(page);
  });

  test("suggested actions are clickable", async ({ page }) => {
    await page.goto("/");

    const suggestions = page.locator(
      "[data-testid='suggested-actions'] button"
    );
    const count = await suggestions.count();

    if (count > 0) {
      await suggestions.first().click();

      // Should redirect after clicking suggestion
      await expect(page).toHaveURL(CHAT_URL_REGEX, { timeout: 10_000 });
    }
  });
});

test.describe("Authentication Requirements", () => {
  test("rejects unauthenticated API access", async ({ page }) => {
    await page.goto("/login");

    const result = await page.evaluate(async () => {
      const response = await fetch("/api/history");

      return {
        payload: await response.json(),
        status: response.status,
      };
    });

    expect(result.status).toBe(401);
    expect(result.payload.message).toMatch(/sign in/i);
  });
});

test.describe("Document API", () => {
  test.beforeEach(async ({ page }) => {
    await registerAndAuthenticate(page);
  });

  test("creates and reads html documents", async ({ page }) => {
    await page.goto("/");

    const result = await page.evaluate(async () => {
      const id = crypto.randomUUID();
      const content =
        "<!doctype html><html><head><title>HTML Test</title></head><body><h1>Hello HTML</h1></body></html>";

      const createResponse = await fetch(`/api/document?id=${id}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          title: "HTML Test",
          content,
          kind: "html",
        }),
      });

      const createPayload = await createResponse.json();

      const readResponse = await fetch(`/api/document?id=${id}`);
      const readPayload = await readResponse.json();

      return {
        createPayload,
        createStatus: createResponse.status,
        readPayload,
        readStatus: readResponse.status,
      };
    });

    expect(result.createStatus).toBe(200);
    expect(result.createPayload.at(-1)?.kind).toBe("html");
    expect(result.readStatus).toBe(200);
    expect(result.readPayload.at(-1)?.kind).toBe("html");
    expect(result.readPayload.at(-1)?.content).toContain("<h1>Hello HTML</h1>");
  });
});
