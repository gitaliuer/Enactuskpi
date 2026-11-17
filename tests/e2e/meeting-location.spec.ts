import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
const credentials = JSON.parse(
  readFileSync(".local/e2e-credentials.json", "utf8"),
);

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Логин", { exact: true }).fill(credentials.login);
  await page.getByLabel("Пароль", { exact: true }).fill(credentials.password);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await page.getByRole("button", { name: "Собрания", exact: true }).click();
  await page
    .getByRole("button", { name: "Создать собрание", exact: true })
    .click();
});

test("meeting point fills from one-shot GPS without attendance and stays editable at 360px", async ({
  page,
  context,
}) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({
    latitude: 45.015,
    longitude: 78.373,
    accuracy: 12,
  });
  const posts: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST") posts.push(request.url());
  });
  await page
    .getByRole("button", { name: "Использовать моё местоположение" })
    .click();
  await expect(page.getByLabel("Широта точки", { exact: true })).toHaveValue(
    "45.015000",
  );
  await expect(page.getByLabel("Долгота точки", { exact: true })).toHaveValue(
    "78.373000",
  );
  await expect(page.getByRole("status")).toContainText("±12 м");
  await page.getByLabel("Широта точки", { exact: true }).fill("45.016");
  await expect(page.getByLabel("Широта точки", { exact: true })).toHaveValue(
    "45.016",
  );
  expect(posts).toEqual([]);
  const horizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  expect(horizontalOverflow).toBe(false);
});

test("denied GPS preserves manual coordinates and explains permission", async ({
  page,
}) => {
  await page.evaluate(() => {
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: {
        getCurrentPosition(
          _success: unknown,
          reject: (error: { code: number }) => void,
        ) {
          reject({ code: 1 });
        },
      },
    });
  });
  await page.getByLabel("Широта точки", { exact: true }).fill("45.01");
  await page.getByLabel("Долгота точки", { exact: true }).fill("78.37");
  await page
    .getByRole("button", { name: "Использовать моё местоположение" })
    .click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Разрешите доступ" }),
  ).toBeVisible();
  await expect(page.getByLabel("Широта точки", { exact: true })).toHaveValue(
    "45.01",
  );
  await expect(page.getByLabel("Долгота точки", { exact: true })).toHaveValue(
    "78.37",
  );
});
