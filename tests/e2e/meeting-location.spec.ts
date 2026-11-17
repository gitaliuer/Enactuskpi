import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
const credentials = JSON.parse(
  readFileSync(".local/e2e-credentials.json", "utf8"),
);

let ownerCookies: Awaited<
  ReturnType<import("@playwright/test").BrowserContext["cookies"]>
> = [];
// Reuse a single owner login per spec, without weakening production rate limits.
test.beforeAll(async ({ playwright }) => {
  const api = await playwright.request.newContext({
    baseURL: "http://localhost:3100",
  });
  const login = await api.post("/api/auth/login", {
    headers: { origin: "http://localhost:3100" },
    data: { login: credentials.login, password: credentials.password },
  });
  expect(login.status()).toBe(200);
  ownerCookies = (await api.storageState()).cookies;
  await api.dispose();
});
test.beforeEach(async ({ page, context }) => {
  await context.addCookies(ownerCookies);
  await page.goto("/");
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

test("meeting creation needs only start and end and server applies timing rules", async ({
  page,
}) => {
  await expect(page.locator('input[type="datetime-local"]')).toHaveCount(2);
  await expect(
    page.locator(
      '[name="registration_open_at"], [name="registration_close_at"], [name="checkout_close_at"], [name="late_after_minutes"]',
    ),
  ).toHaveCount(0);
  await page.getByLabel("Название", { exact: true }).fill("Простое расписание");
  await page
    .getByLabel("Место, аудитория", { exact: true })
    .fill("Тестовая аудитория");
  await page.getByLabel("Широта точки", { exact: true }).fill("45.015");
  await page.getByLabel("Долгота точки", { exact: true }).fill("78.373");
  await page.getByLabel("Начало", { exact: true }).fill("2026-12-01T17:00");
  await page.getByLabel("Окончание", { exact: true }).fill("2026-12-01T18:00");
  const responsePromise = page.waitForResponse(
    (r) => r.url().endsWith("/api/meetings") && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Создать черновик" }).click();
  const response = await responsePromise;
  expect(response.status()).toBe(201);
  const created = await response.json();
  const detail = await page.request.get(`/api/meetings/${created.id}`);
  const data = await detail.json();
  expect(JSON.stringify(data)).toContain("2026-12-01T11:50:00");
  expect(JSON.stringify(data)).toContain('"late_after_minutes":15');
});
