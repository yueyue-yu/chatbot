import { expect, test } from "@playwright/test";

test.describe("Authentication Pages", () => {
  test("redirects unauthenticated protected page access to /login", async ({
    page,
  }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL("/login");
  });

  test("login page renders correctly", async ({ page }) => {
    await page.goto("/login", { waitUntil: "domcontentloaded" });
    await expect(page.getByPlaceholder("you@someo.ne")).toBeVisible();
    await expect(page.getByLabel("Password")).toBeVisible();
    await expect(page.getByRole("button", { name: /sign in/i })).toBeVisible();
    await expect(page.getByText("No account?")).toBeVisible();
  });

  test("register page renders correctly", async ({ page }) => {
    await page.goto("/register", { waitUntil: "domcontentloaded" });
    await expect(page.getByPlaceholder("you@someo.ne")).toBeVisible();
    await expect(page.getByLabel("Password")).toBeVisible();
    await expect(page.getByRole("button", { name: /sign up/i })).toBeVisible();
    await expect(page.getByText("Have an account?")).toBeVisible();
  });

  test("can navigate from login to register", async ({ page }) => {
    await page.goto("/login", { waitUntil: "domcontentloaded" });
    await page.getByRole("link", { name: "Sign up" }).click();
    await expect(page).toHaveURL("/register");
  });

  test("can navigate from register to login", async ({ page }) => {
    await page.goto("/register", { waitUntil: "domcontentloaded" });
    await page.getByRole("link", { name: "Sign in" }).click();
    await expect(page).toHaveURL("/login");
  });
});
