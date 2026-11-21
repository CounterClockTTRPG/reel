import { readFileSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";

const studio = () => (JSON.parse(readFileSync(join(import.meta.dirname, ".state.json"), "utf8")) as { studio: string }).studio;
const chapterFile = () => join(studio(), "projects/demo/missions/tour/chapters/01-basics.yaml");

test("Make spends at most what its dialog showed", async ({ page }) => {
  let sent: { kind: string; args: Record<string, unknown> } | null = null;
  await page.route("**/api/jobs", async (route) => {
    sent = route.request().postDataJSON();
    await route.fulfill({ status: 202, json: { id: "x", kind: "make", target: "demo/tour", status: "queued", created: new Date().toISOString() } });
  });
  await page.goto("/p/demo/m/tour");
  await page.getByRole("button", { name: "Make", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: /Make it/ }).click();
  await expect.poll(() => sent).not.toBeNull();
  expect(sent!.kind).toBe("make");
  expect(sent!.args.yes).toBeUndefined();
  expect(typeof sent!.args.budget).toBe("number");
});

test("a chapter changed on disk keeps the owner's unsaved edits", async ({ page }) => {
  await page.goto("/p/demo/m/tour");
  await page.getByRole("tab", { name: "Script" }).click();
  const editor = page.locator(".cm-content").first();
  await editor.click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type("\n# my unsaved note");
  writeFileSync(chapterFile(), `${readFileSync(chapterFile(), "utf8")}# changed elsewhere\n`);
  utimesSync(chapterFile(), new Date(), new Date(Date.now() + 60_000));
  await page.getByRole("button", { name: "Save chapter" }).first().click();
  await expect(page.getByText("Changed on disk").first()).toBeVisible();
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(1000); // the mission is reloaded after a failed save
  await expect(editor).toContainText("my unsaved note");
  expect(readFileSync(chapterFile(), "utf8")).not.toContain("my unsaved note");
});

test("a style field saves again after a conflict", async ({ page }) => {
  const project = join(studio(), "projects/demo/project.yaml");
  await page.goto("/p/demo");
  const field = page.getByLabel("Music loudness");
  await expect(field).toBeVisible();
  utimesSync(project, new Date(), new Date(Date.now() + 120_000));
  await field.fill("-27");
  await field.blur();
  await expect(page.getByText("Changed on disk")).toBeVisible();
  await field.fill("-26");
  await field.blur();
  await expect.poll(() => readFileSync(project, "utf8")).toContain("loudness: -26");
});
