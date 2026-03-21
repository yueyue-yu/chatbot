import { expect, test } from "@playwright/test";
import { registerAndAuthenticate } from "../helpers";

const DEFAULT_MODEL = process.env.OPENAI_COMPAT_DEFAULT_MODEL ?? "chat-model";

test.describe("Model Selector", () => {
  test.beforeEach(async ({ page }) => {
    await registerAndAuthenticate(page);
    await page.goto("/");
  });

  test("displays a model button", async ({ page }) => {
    const modelButton = page.getByTestId("model-selector").first();
    await expect(modelButton).toBeVisible();
  });

  test("opens model selector popover on click", async ({ page }) => {
    const modelButton = page.getByTestId("model-selector").first();
    await modelButton.click();

    await expect(
      page.getByPlaceholder("Search or enter model...")
    ).toBeVisible();
  });

  test("can search for models", async ({ page }) => {
    const modelButton = page.getByTestId("model-selector").first();
    await modelButton.click();

    const searchInput = page.getByPlaceholder("Search or enter model...");
    await searchInput.fill(DEFAULT_MODEL);

    await expect(page.getByText(DEFAULT_MODEL).first()).toBeVisible();
  });

  test("can close model selector by clicking outside", async ({ page }) => {
    const modelButton = page.getByTestId("model-selector").first();
    await modelButton.click();

    await expect(
      page.getByPlaceholder("Search or enter model...")
    ).toBeVisible();

    await page.keyboard.press("Escape");

    await expect(
      page.getByPlaceholder("Search or enter model...")
    ).not.toBeVisible();
  });

  test("shows model provider groups", async ({ page }) => {
    const modelButton = page.getByTestId("model-selector").first();
    await modelButton.click();

    await expect(page.getByText("OpenAI Compatible")).toBeVisible();
  });

  test("can select a custom model", async ({ page }) => {
    const modelButton = page.getByTestId("model-selector").first();
    await modelButton.click();

    const searchInput = page.getByPlaceholder("Search or enter model...");
    await searchInput.fill("my-custom-model");

    await page.getByText("Use custom model: my-custom-model").click();

    await expect(
      page.getByPlaceholder("Search or enter model...")
    ).not.toBeVisible();

    await expect(
      page.locator("button").filter({ hasText: "my-custom-model" }).first()
    ).toBeVisible();
  });
});
