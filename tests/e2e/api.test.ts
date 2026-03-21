import { expect, test } from "@playwright/test";
import { registerAndAuthenticate } from "../helpers";

const CHAT_URL_REGEX = /\/chat\/[\w-]+/;
const ERROR_TEXT_REGEX = /error|failed|trouble/i;

type ChatApiRequestBody = {
  id: string;
  message: {
    id: string;
    role: "user";
    parts: Array<
      | { type: "text"; text: string }
      | { type: "file"; url: string; name: string; mediaType: string }
    >;
  };
  selectedChatModel: string;
  selectedVisibilityType: "public" | "private";
};

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

    expect(body.message.role).toBe("user");
    expect(body.message.parts).toEqual([
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

    expect(body.message.role).toBe("user");
    expect(body.message.parts).toEqual([
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
