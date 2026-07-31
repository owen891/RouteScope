import { expect, test, type Page, type Route } from "@playwright/test"

// phase09-status: automated pass

const fixtureChannel = {
  id: 9001,
  name: "Phase 09 Fixture Channel",
  type: "newapi",
  site_url: "https://phase09.invalid",
  username: "fixture-operator",
  sort_order: 0,
  favorite: false,
  user_id: "9001",
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
  last_balance: 19.25,
  last_balance_at: "2026-07-30T00:00:00Z",
  today_cost: 0,
  total_cost: 0,
  last_error: "",
  created_at: "2026-07-30T00:00:00Z",
  updated_at: "2026-07-30T00:00:00Z",
}

async function json(route: Route, body: unknown) {
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(body),
  })
}

async function installBaselineFixture(page: Page) {
  await page.route("**/api/**", async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const path = url.pathname.replace(/^\/api/, "")

    if (path === "/auth/me") {
      return json(route, { username: "fixture-operator", auth_disabled: true })
    }
    if (path === "/version") {
      return json(route, {
        name: "upstream-ops",
        title: "Phase 09 Fixture Ops",
        version: "0.0.7",
        latest_version: "0.0.7",
      })
    }
    if (path === "/channels") {
      if (url.searchParams.has("page")) {
        return json(route, {
          items: [fixtureChannel],
          total: 1,
          page: 1,
          page_size: 9,
          pages: 1,
        })
      }
      return json(route, [fixtureChannel])
    }
    if (path === "/dashboard/summary") {
      return json(route, {
        total_channels: 1,
        active_channels: 1,
        failed_channels: 0,
        total_balance: fixtureChannel.last_balance,
        today_total_cost: 0,
        total_cost: 0,
        lowest_balance: {
          channel_id: fixtureChannel.id,
          name: fixtureChannel.name,
          balance: fixtureChannel.last_balance,
        },
        channels: [],
        recent_rate_changes: [],
      })
    }
    if (path.startsWith("/dashboard/")) return json(route, [])
    if (path.startsWith("/channels/") && path.endsWith("/rates")) return json(route, [])
    if (path === "/rate-changes") {
      return json(route, { items: [], total: 0, page: 1, page_size: 100, pages: 0 })
    }
    if (path === "/gateway/usage/stats") {
      return json(route, {
        total_requests: 0,
        total_input_tokens: 0,
        total_output_tokens: 0,
        total_tokens: 0,
        total_cost: 0,
      })
    }
    if (path === "/notifications/channels" || path === "/captcha-configs") {
      return json(route, [])
    }
    if (path === "/notifications/logs" || path === "/announcements") {
      return json(route, { items: [], total: 0, page: 1, page_size: 10, pages: 0 })
    }
    return json(route, {})
  })
}

// phase09-surface: spa:/
test("baseline characterization keeps the dashboard root route directly loadable", async ({ page }) => {
  const pageErrors: Error[] = []
  page.on("pageerror", (error) => pageErrors.push(error))
  await installBaselineFixture(page)

  await page.goto("/")

  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByRole("heading", { name: "Phase 09 Fixture Ops", exact: true })).toBeVisible()
  await expect(page.getByText(fixtureChannel.name).first()).toBeVisible()
  expect(pageErrors).toEqual([])
})
