import { expect, test, type Page, type Route } from "@playwright/test"

async function json(route: Route, body: unknown, status = 200) {
  await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) })
}

async function installShellFixture(page: Page) {
  await page.route("**/api/**", async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const path = url.pathname.replace(/^\/api/, "")

    if (path === "/auth/me") return json(route, { username: "fixture", auth_disabled: true })
    if (path === "/version" || path === "/version?force=1") return json(route, { title: "Fixture Ops", version: "0.0.7" })
    if (path === "/channels" && url.search) return json(route, { items: [], total: 0, page: 1, page_size: 9, pages: 0 })
    if (path === "/channels") return json(route, [])
    if (path === "/dashboard/summary") return json(route, {
      total_channels: 0,
      active_channels: 0,
      failed_channels: 0,
      total_balance: 0,
      today_total_cost: 0,
      total_cost: 0,
      lowest_balance: null,
      channels: [],
      recent_rate_changes: [],
    })
    if (path === "/rate-changes") return json(route, { items: [], total: 0, page: 1, page_size: 100, pages: 0 })
    if (path === "/gateway/usage/stats") return json(route, { total_tokens: 0, total_input_tokens: 0, total_output_tokens: 0 })
    if (path === "/notifications/logs") return json(route, { items: [], total: 0, page: 1, page_size: 20, pages: 0 })
    if (path === "/announcements") return json(route, {
      items: [{
        id: 1,
        channel_id: 1,
        type: "notice",
        content: "Fixture announcement",
        published_at: "2026-07-30T11:59:00Z",
        first_seen_at: "2026-07-30T11:59:00Z",
      }],
      total: 1,
      page: 1,
      page_size: 20,
      pages: 1,
    })
    if (path === "/notifications/channels" || path === "/captcha-configs") return json(route, [])
    if (path === "/observations") return json(route, [{
      id: 1,
      channel_id: 1,
      kind: "health",
      source: "probe",
      success: true,
      summary: "ok",
      sampled_at: "2026-07-30T11:59:00Z",
      created_at: "2026-07-30T11:59:00Z",
    }])
    if (path === "/health-probes/configs" || path === "/health-probes/runs") return json(route, [])
    if (path === "/channels/rates") return json(route, [])
    if (path === "/dashboard/balance-trend" || path === "/dashboard/cost-trend") return json(route, [])
    if (path === "/upstream-sync/targets") return json(route, [{
      id: 1,
      name: "Fixture Relay",
      base_url: "https://relay.example.com",
      enabled: true,
      last_check_status: "failed",
      last_check_error: "status 401: Invalid admin API key",
    }])
    if (path === "/upstream-sync/sync-groups") return json(route, [])
    if (path.startsWith("/upstream-sync/")) return json(route, [])
    return json(route, {})
  })
}

test.describe("Phase 10 control plane shell", () => {
  test("desktop sidebar navigates canonical operations and keeps current route visible", async ({ page }, testInfo) => {
    await installShellFixture(page)
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto("/")

    const navigation = page.getByRole("navigation", { name: "主导航" })
    await expect(navigation).toBeVisible()
    await expect(page.getByRole("heading", { name: "Fixture Ops", exact: true })).toBeVisible()
    await expect(page.getByText("Local Control Plane · v0.0.7", { exact: true })).toBeVisible()
    await expect(page).toHaveTitle("总览 · Fixture Ops")
    await expect(navigation.getByRole("link", { name: "总览" })).toHaveAttribute("aria-current", "page")
    await expect(navigation.getByRole("link", { name: "采集与健康" })).toHaveCount(0)
    await expect(navigation.getByRole("link", { name: "路由建议" })).toHaveCount(0)
    await expect(page.locator("header").getByRole("button", { name: "收藏渠道", exact: true })).toHaveCount(0)
    await expect(page.locator("header").getByRole("button", { name: "真实消费", exact: true })).toHaveCount(0)
    await expect(page.locator("header").getByRole("button", { name: "系统设置", exact: true })).toHaveCount(0)

    await navigation.getByRole("link", { name: "上游管理" }).click()
    await expect(page).toHaveURL(/\/ops\/channels$/)
    await expect(page.getByRole("heading", { name: "上游管理" })).toBeVisible()
    await expect(navigation.getByRole("link", { name: "上游管理" })).toHaveAttribute("aria-current", "page")
    await page.screenshot({ path: testInfo.outputPath("desktop-shell.png"), fullPage: true })
  })

  test("desktop sidebar toggles and remembers its collapsed state", async ({ page }) => {
    await installShellFixture(page)
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto("/")

    const sidebar = page.locator("aside[data-sidebar-collapsed]")
    const sidebarToggle = page.getByTestId("sidebar-toggle")
    await expect(sidebar).toHaveAttribute("data-sidebar-collapsed", "false")
    await expect(sidebarToggle).toHaveAttribute("aria-expanded", "true")

    await sidebarToggle.click()
    await expect(sidebar).toHaveAttribute("data-sidebar-collapsed", "true")
    await expect(sidebarToggle).toHaveAttribute("aria-expanded", "false")
    await expect(page.getByRole("heading", { name: "Fixture Ops", exact: true })).toHaveCount(0)
    await expect(page.getByRole("link", { name: "上游管理", exact: true })).toBeVisible()

    await page.reload()
    await expect(page.getByTestId("sidebar-toggle")).toHaveAttribute("aria-expanded", "false")
    await page.getByTestId("sidebar-toggle").click()
    await expect(page.locator("aside[data-sidebar-collapsed]")).toHaveAttribute("data-sidebar-collapsed", "false")
    await expect(page.getByRole("heading", { name: "Fixture Ops", exact: true })).toBeVisible()
  })

  test("mobile drawer uses the same registry and closes after navigation", async ({ page }, testInfo) => {
    await installShellFixture(page)
    await page.setViewportSize({ width: 390, height: 667 })
    await page.goto("/")

    await expect(page.getByRole("navigation", { name: "主导航" })).toBeHidden()
    await page.getByRole("button", { name: "打开导航" }).click()
    const dialog = page.getByRole("dialog")
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole("heading", { name: "Fixture Ops", exact: true })).toBeVisible()
    await expect(dialog.getByText("Local Control Plane · v0.0.7", { exact: true })).toBeVisible()
    const settingsLink = dialog.getByRole("link", { name: "系统设置" })
    await settingsLink.scrollIntoViewIfNeeded()
    await expect(settingsLink).toBeVisible()
    await dialog.getByRole("link", { name: "上游同步" }).click()
    await expect(page).toHaveURL(/\/relay$/)
    await expect(dialog).toBeHidden()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath("mobile-shell.png"), fullPage: true })
  })

  test("favorites redirects to the channels saved view and legacy cost URL stays compatible", async ({ page }) => {
    await installShellFixture(page)
    await page.goto("/favorites")
    await expect(page).toHaveURL(/\/ops\/channels\?scope=favorites$/)
    await expect(page.getByRole("navigation", { name: "主导航" }).getByRole("link", { name: "收藏渠道", exact: true })).toHaveCount(0)
    await page.goto("/model-prices")
    await expect(page).toHaveURL(/\/model-prices$/)
  })

  test("channels saved views stay focused on channel operations instead of overview summaries", async ({ page }) => {
    await installShellFixture(page)
    await page.goto("/ops/channels")

    await expect(page.getByRole("heading", { name: "上游管理", level: 1 })).toBeVisible()
    await expect(page.getByRole("heading", { name: "渠道", level: 2 })).toHaveCount(0)
    await expect(page.getByText("总余额", { exact: true })).toHaveCount(0)
    await expect(page.getByText("余额概览", { exact: true })).toHaveCount(0)
    await expect(page.getByText("最近倍率变动", { exact: true })).toHaveCount(0)

    await page.goto("/favorites")
    await expect(page).toHaveURL(/\/ops\/channels\?scope=favorites$/)
    await expect(page.getByText("还没有收藏渠道", { exact: true })).toBeVisible()
    await expect(page.getByRole("heading", { name: "渠道", level: 2 })).toHaveCount(0)
    await expect(page.getByText("总余额", { exact: true })).toHaveCount(0)
    await expect(page.getByText("余额概览", { exact: true })).toHaveCount(0)
  })

  test("overview summarizes channel risk instead of mounting the channel manager", async ({ page }) => {
    await installShellFixture(page)
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto("/")

    await expect(page.getByTestId("overview-channel-summary")).toBeVisible()
    await expect(page.getByRole("link", { name: /管理渠道/ })).toHaveAttribute("href", "/ops/channels")
    await expect(page.getByRole("group", { name: "渠道视图" })).toHaveCount(0)
    const kpiLayout = await page.getByTestId("overview-kpis").evaluate((element) => {
      const cards = Array.from(element.children).map((child) => child.getBoundingClientRect())
      return {
        count: cards.length,
        firstTop: cards[0]?.top ?? -1,
        secondTop: cards[1]?.top ?? -2,
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      }
    })
    expect(kpiLayout.count).toBe(6)
    expect(Math.abs(kpiLayout.firstTop - kpiLayout.secondTop)).toBeLessThanOrEqual(1)
    expect(kpiLayout.overflow).toBeLessThanOrEqual(1)
    const pageHeight = await page.evaluate(() => document.documentElement.scrollHeight)
    expect(pageHeight).toBeLessThan(2400)
  })

  test("activity previews use page scrolling on mobile", async ({ page }) => {
    await installShellFixture(page)
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto("/activity")

    const overflowY = await page.getByTestId("announcement-preview-list").evaluate(
      (element) => window.getComputedStyle(element).overflowY,
    )
    expect(overflowY).toBe("visible")
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true)
  })

  test("lazy page loading keeps the control plane shell visible", async ({ page }) => {
    await installShellFixture(page)
    await page.route("**/app/gateway-page.tsx*", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 800))
      await route.continue()
    })
    await page.goto("/")

    await page.getByRole("navigation", { name: "主导航" }).getByRole("link", { name: "API 转发" }).click()
    await expect(page.getByRole("navigation", { name: "主导航" })).toBeVisible()
    await expect(page.locator("header")).toBeVisible()
    await expect(page.getByText("加载页面...")).toBeAttached()
    await expect(page).toHaveURL(/\/gateway$/)
  })

  test("relay exposes recovery actions for an invalid admin key", async ({ page }) => {
    await installShellFixture(page)
    await page.goto("/relay")

    await expect(page.getByText("status 401: Invalid admin API key", { exact: true })).toBeVisible()
    await expect(page.getByRole("button", { name: "修复凭据", exact: true })).toBeVisible()
    await expect(page.getByRole("button", { name: "重新检测", exact: true })).toBeVisible()
  })

  test("relay keeps large target groups compact and exposes searchable account details", async ({ page }) => {
    await installShellFixture(page)
    const groups = [
      {
        id: 1,
        target_id: 1,
        remote_group_id: 101,
        name: "WogHub 主池",
        platform: "openai",
        ratio: 1,
        status: "active",
        sort: 0,
      },
      {
        id: 2,
        target_id: 1,
        remote_group_id: 102,
        name: "备用池",
        platform: "anthropic",
        ratio: 0.85,
        status: "active",
        sort: 1,
      },
    ]
    const longAccountName = "https://relay.example.com/accounts/very-long-upstream-account-name-01"
    const upstreams = Array.from({ length: 32 }, (_, index) => ({
      id: index + 1,
      name: index === 0 ? longAccountName : index === 31 ? "Claude 专线" : `OpenAI 账号 ${index + 1}`,
      platform: index === 31 ? "anthropic" : "openai",
      type: index === 31 ? "claude" : "chat-completions",
      status: index === 30 ? "disabled" : "active",
      schedulable: index !== 30,
      concurrency: 10 + index,
      priority: index,
      rate_multiplier: 1 + index / 100,
      load_factor: 1,
      proxy_id: null,
      group_ids: [101],
      group_names: ["WogHub 主池"],
    }))

    await page.route("**/api/**", async (route) => {
      const request = route.request()
      const path = new URL(request.url()).pathname.replace(/^\/api/, "")
      if (path === "/upstream-sync/targets/1/groups/sync" && request.method() === "POST") {
        return json(route, groups)
      }
      if (path === "/upstream-sync/targets/1/upstreams") return json(route, upstreams)
      await route.fallback()
    })

    await page.goto("/relay")
    await page.getByRole("button", { name: "同步分组", exact: true }).click()

    const groupTable = page.getByRole("table").filter({ hasText: "WogHub 主池" })
    const mainRow = groupTable.getByRole("row").filter({ hasText: "WogHub 主池" })
    await expect(groupTable.getByText(longAccountName, { exact: true })).toHaveCount(0)
    await expect(groupTable.getByRole("columnheader", { name: "上游数" })).toHaveCount(0)
    await expect(mainRow.getByRole("button", { name: "查看 WogHub 主池 的 32 个账号" })).toBeVisible()
    expect(await mainRow.evaluate((element) => element.getBoundingClientRect().height)).toBeLessThan(100)

    await mainRow.getByRole("button", { name: "查看 WogHub 主池 的 32 个账号" }).click()
    const dialog = page.getByRole("dialog")
    await expect(dialog.getByRole("heading", { name: "WogHub 主池" })).toBeVisible()
    await expect(dialog.getByText("显示 32 / 32 个账号", { exact: false })).toBeVisible()
    await expect(dialog.getByTitle(longAccountName)).toBeVisible()
    await expect(dialog.getByRole("table", { name: "分组上游账号" }).getByRole("row")).toHaveCount(33)

    await dialog.getByRole("textbox", { name: "搜索上游账号" }).fill("anthropic")
    await expect(dialog.getByText("Claude 专线", { exact: true })).toBeVisible()
    await expect(dialog.getByText("OpenAI 账号 2", { exact: true })).toHaveCount(0)
    await expect(dialog.getByText("显示 1 / 32 个账号", { exact: false })).toBeVisible()
  })

  test("activity page groups alerts and announcements while rate changes stay on overview", async ({ page }) => {
    await installShellFixture(page)
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto("/activity")

    await expect(page.getByRole("heading", { name: "告警动态", level: 1 })).toBeVisible()
    await expect(page.getByText("告警记录", { exact: true })).toBeVisible()
    await expect(page.getByText("上游公告", { exact: true })).toBeVisible()
    await expect(page.getByText("最近倍率变动", { exact: true })).toHaveCount(0)
    await page.getByRole("tab", { name: "采集与健康" }).click()
    await expect(page).toHaveURL(/\/activity\?view=observations$/)
    await expect(page.getByText("最近采集记录", { exact: true })).toBeVisible()
    await expect(page.getByText("健康探测配置", { exact: true })).toBeVisible()
    await expect(page.getByText("最近探测运行", { exact: true })).toBeVisible()
    await page.goto("/observations?channel_id=1&kind=rate")
    await expect(page).toHaveURL(/\/activity\?channel_id=1&kind=rate&view=observations$/)
    await expect(page.getByText("最近采集记录", { exact: true })).toBeVisible()
    await page.goto("/")
    await expect(page.getByText("最近倍率变动", { exact: true })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true)
  })
})
