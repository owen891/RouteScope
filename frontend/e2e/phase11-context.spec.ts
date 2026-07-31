import { expect, test, type Page, type Route } from "@playwright/test"

async function json(route: Route, body: unknown, status = 200) {
  await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) })
}

async function installContextFixture(page: Page) {
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url())
    const path = url.pathname.replace(/^\/api/, "")
    if (path === "/auth/me") return json(route, { username: "fixture", auth_disabled: true })
    if (path === "/version" || path === "/version?force=1") return json(route, { title: "Fixture Ops", version: "0.0.7" })
    if (path === "/channels") {
      return json(route, url.search ? { items: [], total: 0, page: 1, page_size: 81, pages: 0 } : [])
    }
    if (path === "/channels/rates") return json(route, [])
    if (path === "/overview") return json(route, {
      items: [{
        resource: { kind: "channel", id: 1, key: "channel:1", label: "Fixture Channel" },
        channel_name: "Fixture Channel",
        generated_at: "2026-07-30T12:00:00Z",
        fields: {
          health: { value: { status: "healthy" }, source: "observations:probe", freshness: "fresh", confidence: "high", missing: false },
          balance: { value: 12.5, source: "channels:last_balance", sampled_at: "2026-07-30T11:59:00Z", freshness: "fresh", confidence: "high", missing: false },
          rates: { value: { model_count: 2 }, source: "rate_snapshots", freshness: "fresh", confidence: "high", missing: false },
          cost: { value: 1.2, source: "cost_snapshots", freshness: "fresh", confidence: "high", missing: false },
          ttft: { value: { p50_ms: 180, p95_ms: 320 }, source: "gateway_usage_logs", freshness: "fresh", confidence: "medium", missing: false },
          capacity: { value: { sync_accounts_total: 1, sync_accounts_enabled: 1 }, source: "upstream_sync_accounts", freshness: "fresh", confidence: "medium", missing: false },
          incident: { value: [], source: "observations;gateway_usage_logs", freshness: "fresh", confidence: "medium", missing: false },
        },
        links: [{ relation: "gateway_route", resource: { kind: "gateway_route", id: 1, key: "gateway_route:1", label: "route 1" }, source: "gateway_routes.source_channel_id", confidence: "high" }],
        issues: [],
      }],
      total: 1, page: 1, page_size: 50, pages: 1, generated_at: "2026-07-30T12:00:00Z",
    })
    if (path === "/timeline") return json(route, {
      items: [{ id: "observation:1", kind: "observation", action: "health", source: "observations:probe", status: "succeeded", summary: "ok", occurred_at: "2026-07-30T11:59:00Z", confidence: "high", original_id: 1 }],
      total: 1, page: 1, page_size: 30, pages: 1,
    })
    return json(route, {})
  })
}

test("legacy context URL returns to the channel operations entry", async ({ page }) => {
  await installContextFixture(page)
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto("/context")

  await expect(page).toHaveURL(/\/ops\/channels$/)
  await expect(page.getByRole("heading", { name: "上游管理" })).toBeVisible()
  await expect(page.getByRole("navigation", { name: "主导航" }).getByRole("link", { name: "决策上下文", exact: true })).toHaveCount(0)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true)
})

test("legacy context redirect stays within the mobile viewport", async ({ page }) => {
  await installContextFixture(page)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto("/context")

  await expect(page).toHaveURL(/\/ops\/channels$/)
  await expect(page.getByRole("heading", { name: "上游管理" })).toBeVisible()
  const metrics = await page.evaluate(() => ({
    height: document.documentElement.scrollHeight,
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  }))
  expect(metrics.height).toBeLessThan(3200)
  expect(metrics.overflow).toBeLessThanOrEqual(1)
})
