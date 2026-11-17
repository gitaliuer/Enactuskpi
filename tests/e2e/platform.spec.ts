import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
const credentials = JSON.parse(
  readFileSync(".local/e2e-credentials.json", "utf8"),
);
test("closed access, owner creates department and task through real API and UI", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "С возвращением" }),
  ).toBeVisible();
  const unauthorized = await page.request.get("/api/meetings");
  expect(unauthorized.status()).toBe(401);
  await page.getByLabel("Логин", { exact: true }).fill(credentials.login);
  await page.getByLabel("Пароль", { exact: true }).fill(credentials.password);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: /Привет, Али/ }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Отделы", exact: true }).click();
  await page.getByRole("button", { name: "Добавить отдел" }).click();
  await page.getByLabel("Название отдела").fill("Проектный отдел");
  await page
    .getByRole("button", { name: "Создать отдел", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Проектный отдел", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Задачи", exact: true }).click();
  await page
    .getByRole("button", { name: "Создать задачу", exact: true })
    .click();
  await page
    .getByLabel("Название", { exact: true })
    .fill("Подготовить исследование");
  await page
    .getByLabel("Ответственный", { exact: true })
    .selectOption({ label: "Али · e2e-owner" });
  await page.getByLabel("Срок · Asia/Almaty").fill("2026-12-01T18:00");
  await page
    .getByRole("button", { name: "Создать задачу", exact: true })
    .last()
    .click();
  await expect(
    page.getByRole("button", { name: /Подготовить исследование/ }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: /Привет, Али/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Подготовить исследование/ }),
  ).toBeVisible();
  const csrf = await page.request.post("/api/departments", {
    headers: { origin: "https://evil.invalid" },
    data: { name: "Несанкционированный" },
  });
  expect(csrf.status()).toBe(403);
  await page.screenshot({
    path: ".local/dashboard-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: ".local/dashboard-mobile.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
test("member cannot escalate, export, inspect foreign tasks or edit attendance", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("Логин", { exact: true }).fill(credentials.memberLogin);
  await page
    .getByLabel("Пароль", { exact: true })
    .fill(credentials.memberPassword);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: /Привет, Тестовый/ }),
  ).toBeVisible();
  expect((await page.request.get("/api/permissions")).status()).toBe(403);
  expect((await page.request.get("/api/reports?format=csv")).status()).toBe(
    403,
  );
  const taskRows = await (await page.request.get("/api/tasks")).json();
  expect(taskRows).toEqual([]);
  expect(
    (
      await page.request.post("/api/permissions", {
        headers: { origin: "http://localhost:3100" },
        data: {
          grantee_id: "00000000-0000-0000-0000-000000000000",
          permission: "users.manage",
          scope_type: "TEAM",
        },
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await page.request.patch(
        "/api/attendance/00000000-0000-0000-0000-000000000000",
        {
          headers: { origin: "http://localhost:3100" },
          data: { check_in_at: new Date().toISOString() },
        },
      )
    ).status(),
  ).toBe(404);
});
test("QR link, explicit geolocated arrival/departure and anonymous feedback use persisted records", async ({
  page,
  context,
  request,
}) => {
  const origin = "http://localhost:3100";
  expect(
    (
      await request.post("/api/auth/login", {
        headers: { origin },
        data: { login: credentials.login, password: credentials.password },
      })
    ).ok(),
  ).toBe(true);
  const users = await (await request.get("/api/users")).json();
  const member = users.find((u: any) => u.login === credentials.memberLogin);
  const at = (minutes: number) =>
    new Date(Date.now() + minutes * 60000).toISOString();
  const created = await request.post("/api/meetings", {
    headers: { origin },
    data: {
      title: "E2E проверка собрания",
      status: "OPEN",
      starts_at: at(-5),
      ends_at: at(60),
      registration_open_at: at(-10),
      registration_close_at: at(30),
      checkout_close_at: at(90),
      latitude: 45,
      longitude: 78,
      location_label: "Тестовая аудитория",
      attendees: [{ user_id: member.id, required: true }],
    },
  });
  expect(created.status()).toBe(201);
  const m = await created.json();
  const qr = await (await request.get(`/api/meetings/${m.id}/qr`)).json();
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: 45, longitude: 78, accuracy: 10 });
  await page.goto(`/#meeting=${m.id}&token=${qr.token}`);
  await page.getByLabel("Логин", { exact: true }).fill(credentials.memberLogin);
  await page
    .getByLabel("Пароль", { exact: true })
    .fill(credentials.memberPassword);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  expect(page.url()).not.toContain("token=");
  await page.getByRole("button", { name: "Я пришёл", exact: true }).click();
  await expect(
    page
      .getByRole("dialog")
      .getByRole("button", { name: "Я ухожу", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Я ухожу", exact: true })
    .click();
  await expect(page.getByText("Уход отмечен", { exact: true })).toBeVisible();
  const row = await (await page.request.get("/api/me/attendance")).json();
  expect(
    row.rows.find((r: any) => r.meeting_id === m.id).check_out_at,
  ).toBeTruthy();
  await request.patch(`/api/meetings/${m.id}`, {
    headers: { origin },
    data: { status: "CLOSED" },
  });
  await page.getByRole("button", { name: "Закрыть", exact: true }).click();
  await page.goto("/");
  await page.getByRole("button", { name: "Собрания", exact: true }).click();
  await page.getByRole("button", { name: /E2E проверка собрания/ }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "Оставить отзыв" }).click();
  await page.getByLabel("Ваш отзыв").fill("E2E анонимная обратная связь");
  await page
    .getByRole("button", { name: "Отправить отзыв", exact: true })
    .click();
  await expect(page.getByText("Спасибо! Отзыв отправлен.")).toBeVisible();
  const feedback = await (await request.get("/api/feedback")).json();
  expect(
    feedback.find((f: any) => f.comment === "E2E анонимная обратная связь")
      .author_user_id,
  ).toBeNull();
});

test("activation fragment survives Strict Mode effect replay and is consumed once", async ({
  page,
  request,
}) => {
  const origin = "http://localhost:3100";
  await request.post("/api/auth/login", {
    headers: { origin },
    data: { login: credentials.login, password: credentials.password },
  });
  const invited = await request.post("/api/users", {
    headers: { origin },
    data: { login: "activation-regression", display_name: "Тест активации" },
  });
  expect(invited.status()).toBe(201);
  const { activation_path } = await invited.json();
  const password = "test-only-" + crypto.randomUUID();
  await page.goto(activation_path);
  await expect(
    page.getByRole("heading", { name: "Добро пожаловать", exact: true }),
  ).toBeVisible();
  expect(page.url()).not.toContain("#");
  await page.getByLabel("Пароль — минимум 12 символов").fill(password);
  await page.getByRole("button", { name: "Активировать аккаунт" }).click();
  await expect(
    page.getByRole("heading", { name: "С возвращением" }),
  ).toBeVisible();
  await page.getByLabel("Логин", { exact: true }).fill("activation-regression");
  await page.getByLabel("Пароль", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: /Привет, Тест/ }),
  ).toBeVisible();
});

test("activation works when preview strips URL fragment by pasting the invitation", async ({
  page,
  request,
}) => {
  const origin = "http://localhost:3100";
  await request.post("/api/auth/login", {
    headers: { origin },
    data: { login: credentials.login, password: credentials.password },
  });
  const invite = await request.post("/api/users", {
    headers: { origin },
    data: { login: "activation-manual", display_name: "Ручной код" },
  });
  expect(invite.status()).toBe(201);
  const { activation_path } = await invite.json();
  await page.goto("/activate");
  await page
    .getByLabel("Код активации или ссылка-приглашение")
    .fill(origin + activation_path);
  await page
    .getByLabel("Пароль — минимум 12 символов")
    .fill("test-only-" + crypto.randomUUID());
  await page.getByRole("button", { name: "Активировать аккаунт" }).click();
  await expect(
    page.getByRole("heading", { name: "С возвращением" }),
  ).toBeVisible();
});
