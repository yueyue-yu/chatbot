import { expect, test } from "@playwright/test";
import { registerAndAuthenticate } from "../helpers";

type ChatApiRequestBody = {
  id: string;
  searchEnabled: boolean;
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
        parts: Array<{ type: string }>;
      };
    }
);

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

function createPngBuffer() {
  return Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4//8/AwAI/AL+KDv2GQAAAABJRU5ErkJggg==",
    "base64"
  );
}

function getChatRequestBody(request: { postDataJSON(): unknown }) {
  return request.postDataJSON() as ChatApiRequestBody;
}

test.describe("Composer Prompt Input", () => {
  test.describe.configure({ timeout: 30_000 });

  test.beforeEach(async ({ page }) => {
    await registerAndAuthenticate(page);
    await page.route("**/api/models", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          capabilities: {
            reasoning: true,
            tools: true,
            vision: true,
          },
          defaultModel: {
            description: "Default model",
            id: "chat-model",
            name: "chat-model",
            provider: "openai",
          },
          models: [
            {
              description: "Default model",
              id: "chat-model",
              name: "chat-model",
              provider: "openai",
            },
          ],
        }),
      });
    });
  });

  test("shows action menu entries for images and screenshot", async ({
    page,
  }) => {
    await page.goto("/");

    await page.getByTestId("composer-action-menu-trigger").click({
      timeout: 5000,
    });

    await expect(page.getByText("Add images")).toBeVisible({ timeout: 5000 });
    await expect(page.getByText("Add screenshot")).toBeVisible({
      timeout: 5000,
    });
  });

  test("sends searchEnabled=true when search is toggled on", async ({
    page,
  }) => {
    await page.goto("/");

    await page.route("**/api/chat", async (route) => {
      await route.fulfill({
        status: 200,
        headers: {
          "cache-control": "no-cache",
          connection: "keep-alive",
          "content-type": "text/event-stream",
          "x-vercel-ai-ui-message-stream": "v1",
        },
        body: createUiMessageStreamBody("Search response"),
      });
    });

    const requestPromise = page.waitForRequest(
      (request) =>
        request.url().includes("/api/chat") && request.method() === "POST"
    );

    await page.getByTestId("search-button").click({ timeout: 5000 });
    await expect(page.getByTestId("search-button")).toHaveAttribute(
      "aria-pressed",
      "true",
      { timeout: 5000 }
    );

    await page.getByTestId("multimodal-input").fill("Search for this");
    await page.getByTestId("send-button").click();

    const request = await requestPromise;
    const body = getChatRequestBody(request);
    expect(body.searchEnabled).toBe(true);
  });

  test("adds a screenshot preview from the composer action menu", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      const originalCreateElement = document.createElement.bind(document);

      Object.defineProperty(navigator, "mediaDevices", {
        configurable: true,
        value: {
          getDisplayMedia: async () =>
            ({
              getTracks: () => [{ stop: () => undefined }],
            }) as MediaStream,
        },
      });

      document.createElement = ((
        tagName: string,
        options?: ElementCreationOptions
      ) => {
        const element = originalCreateElement(tagName, options);

        if (tagName === "video") {
          Object.defineProperty(element, "videoWidth", {
            configurable: true,
            value: 2,
          });
          Object.defineProperty(element, "videoHeight", {
            configurable: true,
            value: 2,
          });
          Object.defineProperty(element, "play", {
            configurable: true,
            value: async () => undefined,
          });
          Object.defineProperty(element, "srcObject", {
            configurable: true,
            get() {
              return null;
            },
            set() {
              return undefined;
            },
          });
        }

        if (tagName === "canvas") {
          Object.defineProperty(element, "getContext", {
            configurable: true,
            value: () => ({
              drawImage: () => undefined,
            }),
          });
          Object.defineProperty(element, "toBlob", {
            configurable: true,
            value: (callback: BlobCallback) =>
              callback?.(
                new Blob([Uint8Array.from([137, 80, 78, 71])], {
                  type: "image/png",
                })
              ),
          });
        }

        return element;
      }) as typeof document.createElement;
    });

    await page.route("**/api/files/upload", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          url: "https://example.com/screenshot.png",
          pathname: "screenshot.png",
          contentType: "image/png",
        }),
      });
    });

    await page.goto("/");

    await page.getByTestId("composer-action-menu-trigger").click({
      timeout: 5000,
    });
    await page.getByText("Add screenshot").click({ timeout: 5000 });

    await expect(page.getByTestId("input-attachment-preview")).toBeVisible({
      timeout: 5000,
    });
  });

  test("resets search toggle when starting a new chat", async ({ page }) => {
    await page.goto("/");

    await page.getByTestId("search-button").click({ timeout: 5000 });
    await expect(page.getByTestId("search-button")).toHaveAttribute(
      "aria-pressed",
      "true",
      { timeout: 5000 }
    );

    await page.goto("/");

    await expect(page.getByTestId("search-button")).toHaveAttribute(
      "aria-pressed",
      "false",
      { timeout: 5000 }
    );
  });

  test("shows an uploaded image preview", async ({ page }) => {
    await page.route("**/api/files/upload", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          url: "https://example.com/uploaded.png",
          pathname: "uploaded.png",
          contentType: "image/png",
        }),
      });
    });

    await page.goto("/");

    await page.setInputFiles('input[type="file"]', {
      buffer: createPngBuffer(),
      mimeType: "image/png",
      name: "uploaded.png",
    });

    await expect(page.getByTestId("input-attachment-preview")).toBeVisible({
      timeout: 5000,
    });
  });
});
