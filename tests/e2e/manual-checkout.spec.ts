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
  await expect(
    page.getByRole("heading", { name: /Привет, Али/ }),
  ).toBeVisible();
});

test("owner records missing departure through reports with manual label and exported provenance", async ({
  page,
}) => {
  const me = await (await page.request.get("/api/me")).json();
  const created = await page.request.post("/api/meetings", {
    headers: { origin: new URL(page.url()).origin },
    data: {
      title: "Ручной уход E2E",
      status: "OPEN",
      starts_at: new Date(Date.now() - 600000).toISOString(),
      ends_at: new Date(Date.now() + 3600000).toISOString(),
      latitude: 45,
      longitude: 78,
      attendees: [{ user_id: me.id, required: true }],
    },
  });
  expect(created.status()).toBe(201);
  const { id } = await created.json();
  const qr = await (await page.request.get(`/api/meetings/${id}/qr`)).json();
  const challenge = await (
    await page.request.post(`/api/meetings/${id}/challenge`, {
      headers: { origin: new URL(page.url()).origin },
      data: { action: "check-in" },
    })
  ).json();
  const marked = await page.request.post(`/api/meetings/${id}/check-in`, {
    headers: { origin: new URL(page.url()).origin },
    data: {
      challenge: challenge.challenge,
      token: qr.token,
      geo: { latitude: 45, longitude: 78, accuracy: 10, timestamp: Date.now() },
    },
  });
  expect(marked.status()).toBe(200);
  expect(
    (
      await page.request.patch(`/api/meetings/${id}`, {
        headers: { origin: new URL(page.url()).origin },
        data: { status: "CLOSED" },
      })
    ).status(),
  ).toBe(200);
  await page.reload();
  await page.getByRole("button", { name: "Отчёты", exact: true }).click();
  await page
    .getByRole("row")
    .filter({ hasText: "Ручной уход E2E" })
    .getByRole("button", { name: "Внести забытый уход" })
    .click();
  await page.waitForTimeout(1100);
  const local = new Date(Date.now() + 5 * 3600000).toISOString().slice(0, 19);
  await page.getByLabel("Фактический уход · Asia/Almaty (UTC+5)").fill(local);
  await page
    .getByLabel("Причина ручного внесения")
    .fill("Забыл уход, время со слов участника");
  await page.getByRole("button", { name: "Сохранить ручной уход" }).click();
  await expect(
    page.getByRole("row").filter({ hasText: "Ручной уход E2E" }),
  ).toContainText("Внесено владельцем вручную, без GPS");
  const exported = await page.request.get(
    `/api/reports?format=csv&meeting=${id}`,
  );
  expect(exported.status()).toBe(200);
  expect(await exported.text()).toContain("OWNER_MANUAL");
});
test("QR explains future opening without reporting a lost connection", async ({
  page,
}) => {
  const created = await page.request.post("/api/meetings", {
    headers: { origin: new URL(page.url()).origin },
    data: {
      title: "Будущий QR E2E",
      status: "OPEN",
      starts_at: new Date(Date.now() + 3600000).toISOString(),
      ends_at: new Date(Date.now() + 7200000).toISOString(),
      latitude: 45,
      longitude: 78,
    },
  });
  expect(created.status()).toBe(201);
  await page.reload();
  await page.getByRole("button", { name: "Собрания", exact: true }).click();
  await page
    .getByRole("button")
    .filter({
      has: page.getByRole("heading", { name: "Будущий QR E2E", exact: true }),
    })
    .click();
  await page.getByRole("button", { name: "Показать QR" }).click();
  await expect(page.getByText(/QR будет доступен с/)).toBeVisible();
  await expect(
    page.getByText("Есть соединение", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByText("Соединение потеряно", { exact: false }),
  ).toHaveCount(0);
});
