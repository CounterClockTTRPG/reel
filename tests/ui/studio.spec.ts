import { readFileSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";

const state = () => JSON.parse(readFileSync(join(import.meta.dirname, ".state.json"), "utf8")) as { studio: string; vault: string; take: string };
const projectFile = () => join(state().studio, "projects/demo/project.yaml");

test("the studio lists its projects and missions", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Demo" }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Demo: a tour" }).first()).toBeVisible();
});

test("a style change in the project page lands in project.yaml", async ({ page }) => {
  await page.goto("/p/demo");
  const field = page.getByLabel("Music loudness");
  await field.fill("-30");
  await field.blur();
  await expect.poll(() => readFileSync(projectFile(), "utf8")).toContain("loudness: -30");
  expect(readFileSync(projectFile(), "utf8")).toContain("# A demo project against the fixture app.");
});

test("a change to a file edited on disk meanwhile is refused", async ({ page }) => {
  await page.goto("/p/demo");
  await expect(page.getByLabel("Music loudness")).toBeVisible();
  writeFileSync(projectFile(), readFileSync(projectFile(), "utf8").replace("name: Demo", "name: Demo"));
  utimesSync(projectFile(), new Date(), new Date(Date.now() + 60_000));
  const field = page.getByLabel("Music loudness");
  await field.fill("-29");
  await field.blur();
  await expect(page.getByText("Changed on disk")).toBeVisible();
  expect(readFileSync(projectFile(), "utf8")).not.toContain("loudness: -29");
});
