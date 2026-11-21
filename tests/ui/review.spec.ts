import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";

const take = () => (JSON.parse(readFileSync(join(import.meta.dirname, ".state.json"), "utf8")) as { take: string }).take;

test("the take page shows a frame per caption and the video with its chapters", async ({ page }) => {
  await page.goto("/p/demo/m/tour/t/1");
  await expect(page.getByRole("heading", { name: "Take 1" })).toBeVisible();
  await expect(page.locator(".frame img")).toHaveCount(3);
  await expect(page.locator('video track[kind="chapters"]')).toHaveCount(1);
});

test("flagging a scene saves the note for the retake", async ({ page }) => {
  await page.goto("/p/demo/m/tour/t/1");
  await page.getByRole("button", { name: "Flag search" }).click();
  await page.getByLabel("Why flag search").fill("The answer appears too late");
  await page.getByRole("button", { name: "Flag for a retake" }).click();
  await expect(page.getByText("flagged: The answer appears too late")).toBeVisible();
  const review = JSON.parse(readFileSync(join(take(), "review.json"), "utf8"));
  expect(review.scenes.search).toMatchObject({ state: "flagged", note: "The answer appears too late", by: "owner" });
});
