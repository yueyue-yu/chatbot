import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

async function registerAndOpenAgent(page: Page) {
  const email = `agent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@playwright.com`;
  const password = "playwright-pass";

  await page.goto("/register");
  await page.getByPlaceholder("user@acme.com").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign Up" }).click();

  for (let attempt = 0; attempt < 10; attempt += 1) {
    await page.goto("/agent");

    if (page.url().endsWith("/agent")) {
      return;
    }

    await page.waitForTimeout(300);
  }

  throw new Error("Failed to establish an authenticated session for /agent.");
}

test.describe("Agent Demo", () => {
  test("redirects unauthenticated users to /login", async ({ page }) => {
    await page.goto("/agent");
    await expect(page).toHaveURL("/login");
  });

  test("rejects unauthenticated /api/agent requests", async ({ page }) => {
    await page.goto("/login");

    const result = await page.evaluate(async () => {
      const response = await fetch("/api/agent", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messages: [],
          selectedModel: "",
        }),
      });

      return {
        payload: await response.json(),
        status: response.status,
      };
    });

    expect(result.status).toBe(401);
    expect(result.payload.message).toMatch(/sign in/i);
  });

  test("shows the independent /agent UI after authentication", async ({ page }) => {
    await registerAndOpenAgent(page);

    await expect(page.getByTestId("agent-input")).toBeVisible();
    await expect(page.getByTestId("agent-model-selector")).toBeVisible();
    await expect(page.getByText("Document tool agent demo")).toBeVisible();
  });

  test("submits to /api/agent and renders the document tool result", async ({
    page,
  }) => {
    await registerAndOpenAgent(page);

    let chatRouteHits = 0;
    page.on("request", (request) => {
      if (request.url().includes("/api/chat")) {
        chatRouteHits += 1;
      }
    });

    const agentRequestPromise = page.waitForRequest(
      (request) =>
        request.url().includes("/api/agent") && request.method() === "POST"
    );

    await page
      .getByTestId("agent-input")
      .fill("Write short release notes for a small feature release");
    await page.getByTestId("agent-send-button").click();

    const request = await agentRequestPromise;
    const body = request.postDataJSON() as {
      messages: Array<{
        parts: Array<{ text: string; type: "text" }>;
        role: "user";
      }>;
      selectedModel: string;
    };

    expect(body.messages.at(-1)?.role).toBe("user");
    expect(body.messages.at(-1)?.parts).toEqual([
      {
        text: "Write short release notes for a small feature release",
        type: "text",
      },
    ]);
    expect(typeof body.selectedModel).toBe("string");

    await expect(page.getByText("Create document")).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByText("Artifact ID")).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.locator("[data-role='assistant']").first()).toBeVisible({
      timeout: 30_000,
    });

    expect(chatRouteHits).toBe(0);
  });

  test("keeps agent-model separate from chat-model", async ({ page }) => {
    await registerAndOpenAgent(page);

    await page.getByTestId("agent-model-selector").click();
    await page.getByPlaceholder("Search or enter model...").fill("agent-demo-model");
    await page.getByText("Use custom model: agent-demo-model").click();

    let cookies = await page.evaluate(() => document.cookie);
    expect(cookies).toContain("agent-model=agent-demo-model");

    await page.goto("/");
    await page.getByTestId("model-selector").click();
    await page.getByPlaceholder("Search or enter model...").fill("chat-demo-model");
    await page.getByText("Use custom model: chat-demo-model").click();

    cookies = await page.evaluate(() => document.cookie);
    expect(cookies).toContain("agent-model=agent-demo-model");
    expect(cookies).toContain("chat-model=chat-demo-model");
  });
});
