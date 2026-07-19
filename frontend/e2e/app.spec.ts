import { expect, test, type Page, type Route } from "@playwright/test"

const channel = {
  id: 1,
  name: "Fixture Channel",
  type: "newapi",
  site_url: "https://fixture.example.com",
  username: "operator",
  sort_order: 0,
  user_id: "1",
  credential_mode: "token",
  login_extra_params: "",
  turnstile_enabled: false,
  ignore_announcements: false,
  subscription_enabled: false,
  proxy_enabled: false,
  captcha_config_id: null,
  balance_threshold: 0,
  recharge_multiplier: null,
  recharge_multiplier_mode: "divide",
  monitor_enabled: true,
  last_balance: 12.5,
  last_balance_at: "2026-07-19T09:00:00Z",
  today_cost: 0,
  total_cost: 0,
  last_error: "",
  created_at: "2026-07-19T09:00:00Z",
  updated_at: "2026-07-19T09:00:00Z",
}

const config = {
  config_path: "/tmp/config.yaml",
  config: {
    app: { title: "Fixture Ops", notificationPrefix: "" },
    auth: {
      enabled: true,
      username: "admin",
      passwordConfigured: true,
      tokenSecretConfigured: true,
      sessionTTLHours: 24,
    },
    scheduler: {
      balanceCron: "0 */5 * * * *",
      rateCron: "0 */10 * * * *",
      concurrency: 2,
      retention: {
        cron: "0 0 3 * * *",
        monitorLogsDays: 30,
        balanceSnapshotsDays: 30,
        notificationLogsDays: 30,
        announcementsDays: 30,
      },
    },
    notifications: {
      batchRateChanges: true,
      minChangePct: 1,
      balanceLowCooldownMinutes: 30,
      subscriptionDailyRemainingThresholdPct: 20,
      subscriptionWeeklyRemainingThresholdPct: 20,
      subscriptionMonthlyRemainingThresholdPct: 20,
      subscriptionExpiryThresholdHours: 24,
      subscriptionAlertCooldownMinutes: 60,
      sendMaxAttempts: 3,
    },
    proxy: {
      enabled: false,
      versionCheckEnabled: false,
      protocol: "http",
      host: "",
      port: 0,
      username: "",
      passwordConfigured: false,
    },
    upstream: { timeoutSeconds: 30, userAgent: "fixture" },
  },
}

async function json(route: Route, body: unknown, status = 200) {
  await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) })
}

async function installApiFixture(page: Page, options: { authEnabled?: boolean; protectedProbe?: boolean } = {}) {
  const authEnabled = options.authEnabled ?? false
  let anonymousChannelReads = 0
  await page.route("**/api/**", async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const path = url.pathname.replace(/^\/api/, "")

    if (path === "/auth/me") {
      if (authEnabled && !request.headers().authorization) return json(route, { error: "unauthorized" }, 401)
      return json(route, { username: "admin", auth_disabled: !authEnabled })
    }
    if (path === "/auth/login" && request.method() === "POST") {
      return json(route, { token: "fixture-token", username: "admin" })
    }
    if (path === "/auth/logout") return json(route, {})
    if (path === "/version" || path === "/version?force=1") {
      return json(route, { name: "upstream-ops", title: "Fixture Ops", version: "0.0.6", latest_version: "0.0.6" })
    }
    if (path === "/channels" && request.method() === "GET") {
      if (url.search) return json(route, { items: [channel], total: 1, page: 1, page_size: 9, pages: 1 })
      if (!request.headers().authorization && authEnabled) return json(route, { error: "unauthorized" }, 401)
      if (!request.headers().authorization && options.protectedProbe && ++anonymousChannelReads > 1) return json(route, { error: "unauthorized" }, 401)
      return json(route, [channel])
    }
    if (path === "/dashboard/summary") return json(route, {
      total_channels: 1, active_channels: 1, failed_channels: 0, total_balance: 12.5,
      today_total_cost: 0, total_cost: 0, lowest_balance: { channel_id: 1, name: channel.name, balance: 12.5 },
      channels: [{ id: 1, name: channel.name, type: "newapi", monitor_enabled: true, last_balance: 12.5, today_cost: 0, total_cost: 0 }],
      recent_rate_changes: [],
    })
    if (path.startsWith("/dashboard/")) return json(route, [])
    if (path === "/rate-changes") return json(route, { items: [], total: 0, page: 1, page_size: 20, pages: 0 })
    if (path.startsWith("/channels/") && path.endsWith("/rates")) return json(route, [])
    if (path === "/notifications/channels" && request.method() === "GET") return json(route, [])
    if (path === "/notifications/logs") return json(route, { items: [], total: 0, page: 1, page_size: 10, pages: 0 })
    if (path === "/captcha-configs") return json(route, [])
    if (path === "/announcements") return json(route, { items: [], total: 0, page: 1, page_size: 10, pages: 0 })
    if (path === "/settings/config") return json(route, config)
    if (path === "/channels" && request.method() === "POST") return json(route, { id: 2 })
    if (path.startsWith("/notifications/channels") && ["POST", "PUT"].includes(request.method())) return json(route, { id: 2 })
    return json(route, {})
  })
}

async function login(page: Page) {
  await page.getByLabel("账号").fill("admin")
  await page.getByLabel("密码").fill("fixture-password")
  await page.getByRole("button", { name: /登录/ }).click()
  await expect(page.getByText("Fixture Channel").first()).toBeVisible()
}

test("auth gate protects the app and accepts a fixture login", async ({ page }) => {
  await installApiFixture(page, { authEnabled: true })
  await page.goto("/")
  await expect(page.getByLabel("账号")).toBeVisible()
  await expect(page.getByLabel("密码")).toBeVisible()
  await login(page)
  await expect(page.getByRole("button", { name: "系统设置" })).toBeVisible()
})

test("import preview renders conflict and malformed-row feedback locally", async ({ page }) => {
  await installApiFixture(page)
  await page.goto("/")
  await expect(page.getByText("Fixture Channel").first()).toBeVisible()
  await page.getByRole("button", { name: /^导入$/ }).click()
  await page.locator("textarea").fill(JSON.stringify({
    version: 2,
    accounts: [
      { site_name: "Fixture Channel", site_url: "https://fixture.example.com", site_type: "sub2api", account_info: { username: "a", access_token: "t" } },
      { site_name: "Broken", site_url: "not-a-url", site_type: "sub2api", account_info: { username: "b", access_token: "t" } },
    ],
  }))
  await expect(page.getByText(/预览 2 行/)).toBeVisible()
  await expect(page.getByText(/不支持|无效|错误/).first()).toBeVisible()
  await expect(page.getByText("Broken", { exact: true })).toBeVisible()
})

test("notification form exposes QQ group/private and query-auth controls", async ({ page }) => {
  await installApiFixture(page)
  await page.goto("/settings")
  await page.getByRole("tab", { name: /通知渠道/ }).click()
  await page.getByRole("button", { name: /新增渠道/ }).click()
  await page.locator("#notify-name").fill("Fixture QQ")
  await page.getByRole("combobox").first().click()
  await page.getByRole("option", { name: /QQ/ }).click()
  await page.locator("#qq-base").fill("http://127.0.0.1:5700")
  await page.locator("#qq-group").fill("123456")
  await expect(page.locator("#qq-query-auth")).toBeVisible()
  await page.locator("#qq-query-auth").click()
  await page.getByRole("combobox").nth(1).click()
  await page.getByRole("option", { name: /私聊/ }).click()
  await expect(page.locator("#qq-user")).toBeVisible()
  await page.locator("#qq-user").fill("10001")
})

test("production checklist reports protected anonymous API", async ({ page }) => {
  await installApiFixture(page, { protectedProbe: true })
  await page.goto("/settings")
  await expect(page.getByText(/匿名 API 实测/)).toBeVisible()
  await expect(page.getByText(/受保护|401/)).toBeVisible({ timeout: 10_000 })
})
