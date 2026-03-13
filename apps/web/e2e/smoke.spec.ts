import { expect, test } from "@playwright/test";

test("pair, connect, chat", async ({ page, request }) => {
  await request.post("http://127.0.0.1:8788/auth/logout");
  await page.addInitScript(() => localStorage.clear());
  await page.goto("/chat");

  await expect(page.getByRole("heading", { name: "Pair your local bridge" })).toBeVisible();

  await page.getByRole("button", { name: "Pair bridge" }).click();
  await expect(page.getByRole("heading", { name: "Connect with GitHub" })).toBeVisible();

  await page.getByRole("button", { name: "Connect with GitHub" }).click();
  await expect(page.getByRole("heading", { name: "fake-user" })).toBeVisible();

  await page.getByLabel("Model").selectOption("gpt-4.5");
  await page.getByPlaceholder("Ask through your local Copilot bridge").fill("Ship it");
  await page.getByRole("button", { name: "Send" }).click();

  await expect(page.getByText("Fake bridge online. Ship it")).toBeVisible();
  await expect(page.getByText(/output tokens/i).first()).toBeVisible();
});
