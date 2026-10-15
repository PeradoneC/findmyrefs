import { expect, test } from "@playwright/test";

// Spec section 12 end-to-end flow, using the free mock providers:
// create project -> enter prompt -> analyze (mock) -> search -> add result -> add note -> restart/reopen.
test("free workflow persists across a restart", async ({ page }) => {
  const paidRequests: string[] = [];
  page.on("request", (req) => {
    if (req.url().includes("anthropic.com")) paidRequests.push(req.url());
  });

  await page.goto("/");
  await page.getByLabel("New project name").fill("E2E winter fox");
  await page.getByRole("button", { name: "Create project" }).click();

  await page
    .getByLabel("Describe the artwork you want to create")
    .fill(
      "A lonely red fox in a misty bamboo forest at golden hour, watercolor, low angle. No people.",
    );
  await page.getByRole("button", { name: "Analyze brief" }).click();
  await expect(page.getByRole("textbox", { name: "Category name" }).first()).toHaveValue("Subject");
  await expect(page.getByRole("textbox", { name: "Subject query 1" })).toHaveValue("red fox");

  // The user can edit generated queries before searching.
  await page.getByRole("textbox", { name: "Subject query 1" }).fill("red fox portrait");

  await page.getByRole("button", { name: "Search references" }).click();
  await expect(page.getByRole("heading", { name: "Results" })).toBeVisible();
  await expect(page.getByText(/unique results from/)).toBeVisible({ timeout: 15_000 });
  await expect(page.locator(".screen-header").getByText("Demo data")).toBeVisible();
  const firstCard = page.getByRole("article").first();
  await expect(firstCard.getByText("Demo", { exact: true })).toBeVisible();
  await expect(firstCard.getByRole("heading")).toContainText("Demo: red fox portrait");

  await firstCard.getByRole("button", { name: "Add to board" }).click();
  await expect(firstCard.getByRole("button", { name: "On board" })).toBeDisabled();

  await page.getByRole("button", { name: /^Board/ }).click();
  const card = page.getByTestId("board-card");
  await expect(card).toHaveCount(1);

  // Drag the card to a new position.
  const handle = card.getByRole("button", { name: /^Move/ });
  const box = (await handle.boundingBox())!;
  await page.mouse.move(box.x + 30, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 230, box.y + 160, { steps: 8 });
  await page.mouse.up();
  const movedLeft = await card.evaluate((el) => (el as HTMLElement).style.left);
  expect(movedLeft).not.toBe("32px");

  await card
    .getByRole("textbox", { name: /^Notes for/ })
    .fill("Use this fur texture and rim light");
  await card.getByRole("textbox", { name: /^Notes for/ }).blur();
  await page.waitForTimeout(300);

  // "Restart": reload the app and reopen the project.
  await page.reload();
  await page.getByRole("button", { name: "Open" }).click();
  await expect(page.getByLabel("Describe the artwork you want to create")).toHaveValue(
    /lonely red fox/,
  );
  await expect(page.getByRole("textbox", { name: "Subject query 1" })).toHaveValue(
    "red fox portrait",
  );

  await page.getByRole("button", { name: /^Board/ }).click();
  const reopened = page.getByTestId("board-card");
  await expect(reopened).toHaveCount(1);
  await expect(reopened.getByRole("textbox", { name: /^Notes for/ })).toHaveValue(
    "Use this fur texture and rim light",
  );
  expect(await reopened.evaluate((el) => (el as HTMLElement).style.left)).toBe(movedLeft);

  expect(paidRequests).toEqual([]);
});

test("search errors are visible and recoverable", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("New project name").fill("Errors");
  await page.getByRole("button", { name: "Create project" }).click();
  await page.getByLabel("Describe the artwork you want to create").fill("castle");
  await page.getByRole("button", { name: "Analyze brief" }).click();
  await page.getByRole("textbox", { name: "Subject query 1" }).fill("castle __error__");
  await page.getByRole("button", { name: "Search references" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "failed" })).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByRole("button", { name: "Retry failed" })).toBeVisible();
  // The other queries still produced results.
  await expect(page.getByRole("article").first()).toBeVisible();
});
