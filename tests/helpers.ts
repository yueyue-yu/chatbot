import type { Page } from "@playwright/test";
import { generateId } from "ai";

export function generateRandomTestUser() {
  const email = `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@playwright.com`;
  const password = generateId();

  return {
    email,
    password,
  };
}

export function generateTestMessage() {
  return `Test message ${Date.now()}`;
}

export async function registerAndAuthenticate(page: Page) {
  const user = generateRandomTestUser();

  await page.goto("/register", { waitUntil: "domcontentloaded" });
  await page.getByPlaceholder("you@someo.ne").fill(user.email);
  await page.getByLabel("Password").fill(user.password);
  await page.getByRole("button", { name: /sign up/i }).click();
  await page.getByTestId("multimodal-input").waitFor({
    state: "visible",
    timeout: 30_000,
  });

  return user;
}
