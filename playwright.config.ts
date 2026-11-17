import { defineConfig } from "@playwright/test";
import chromium from "@sparticuz/chromium";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { brotliDecompressSync } from "node:zlib";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
const libs = resolve(".local/chromium-deps");
if (process.platform === "linux" && !existsSync(libs + "/lib/libnspr4.so")) {
  mkdirSync(libs, { recursive: true });
  const archive = libs + "/deps.tar";
  writeFileSync(
    archive,
    brotliDecompressSync(
      readFileSync("node_modules/@sparticuz/chromium/bin/al2023.tar.br"),
    ),
  );
  execFileSync("tar", ["xf", archive, "-C", libs]);
}

export default defineConfig({
  testDir: "tests/e2e",
  workers: 1,
  timeout: 60000,
  use: {
    baseURL: "http://localhost:3100",
    headless: true,
    launchOptions: {
      executablePath: await chromium.executablePath(),
      args: chromium.args.filter(
        (a) =>
          !a.includes("single-process") &&
          !a.includes("disable-web-security") &&
          !a.includes("disable-site-isolation-trials") &&
          !a.includes("allow-running-insecure-content"),
      ),
      env: {
        ...process.env,
        LD_LIBRARY_PATH: libs + "/lib:" + (process.env.LD_LIBRARY_PATH ?? ""),
      },
    },
  },
  webServer: {
    command:
      "LOCAL_DATABASE=1 LOCAL_DATABASE_PATH=.local/e2e APP_ORIGIN=http://localhost:3100 QR_SECRET=isolated-e2e-secret-not-for-production-123 npm run dev -- --port 3100",
    url: "http://localhost:3100",
    reuseExistingServer: false,
    timeout: 120000,
  },
});
