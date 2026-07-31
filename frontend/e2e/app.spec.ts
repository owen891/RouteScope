import { expect, test, type Page, type Route } from "@playwright/test"

const channel = {
  id: 1,
  name: "Fixture Channel",
  type: "newapi",
  site_url: "https://fixture.example.com",
  username: "operator",
  sort_order: 0,
  favorite: false,
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

async function installApiFixture(page: Page, options: { authEnabled?: boolean; protectedProbe?: boolean; emptyComparisons?: boolean; paginatedRateChanges?: boolean } = {}) {
  const authEnabled = options.authEnabled ?? false
  let appTitle = "Fixture Ops"
  let anonymousChannelReads = 0
  const state = {
    primaryConfirmRequests: 0,
    adjustmentConfirmRequests: 0,
    adjustmentGrossMarginPct: 20,
    batchRateRequests: 0,
    channelRateRequests: 0,
    usageAnalyticsRequests: 0,
    gatewayProviderOptionRequests: 0,
    gatewayPriceRequests: 0,
    gatewayUsageRequests: 0,
    gatewayUsageModelRequests: 0,
    gatewayUsageStatsRequests: 0,
    favorite: false,
    primarySaved: false,
    rateChangeQueries: [] as string[],
  }
  let adjustmentRatio = 0.5
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
      return json(route, { name: "upstream-ops", title: appTitle, version: "0.0.6", latest_version: "0.0.6" })
    }
    if (path === "/channels" && request.method() === "GET") {
      const fixtureChannel = { ...channel, favorite: state.favorite }
      if (url.search) return json(route, { items: [fixtureChannel], total: 1, page: 1, page_size: 9, pages: 1 })
      if (!request.headers().authorization && authEnabled) return json(route, { error: "unauthorized" }, 401)
      if (!request.headers().authorization && options.protectedProbe && ++anonymousChannelReads > 1) return json(route, { error: "unauthorized" }, 401)
      return json(route, [fixtureChannel])
    }
    if (path === "/channels/1/favorite" && request.method() === "PUT") {
      const body = request.postDataJSON() as { favorite?: boolean }
      if (typeof body.favorite !== "boolean") return json(route, { error: "favorite is required" }, 400)
      state.favorite = body.favorite
      return json(route, { ...channel, favorite: state.favorite })
    }
    if (path === "/dashboard/summary") return json(route, {
      total_channels: 1, active_channels: 1, failed_channels: 0, total_balance: 12.5,
      today_total_cost: 0, total_cost: 0, lowest_balance: { channel_id: 1, name: channel.name, balance: 12.5 },
      channels: [{ id: 1, name: channel.name, type: "newapi", monitor_enabled: true, last_balance: 12.5, today_cost: 0, total_cost: 0 }],
      recent_rate_changes: [],
    })
    if (path.startsWith("/dashboard/")) return json(route, [])
    if (path === "/rate-changes") {
      state.rateChangeQueries.push(url.search)
      if (!url.searchParams.has("channel_id")) {
        return json(route, { items: [], total: 0, page: 1, page_size: 20, pages: 0 })
      }
      const changes = [
        {
          id: 1,
          channel_id: 1,
          remote_group_id: 101,
          model_name: "Fixture Group 1",
          old_ratio: 0.2,
          new_ratio: 0.1,
          old_completion_ratio: 1,
          new_completion_ratio: 1,
          changed_at: "2026-07-19T10:00:00Z",
        },
        {
          id: 2,
          channel_id: 1,
          remote_group_id: 102,
          model_name: "Fixture Group 2",
          old_ratio: 0.3,
          new_ratio: 0.2,
          old_completion_ratio: 1,
          new_completion_ratio: 0.8,
          changed_at: "2026-07-19T11:00:00Z",
        },
      ]
      const modelName = url.searchParams.get("model_name")
      const pageNumber = Number(url.searchParams.get("page") ?? "1")
      const pageSize = Number(url.searchParams.get("page_size") ?? "20")
      const paginatedChanges = options.paginatedRateChanges && modelName === "Fixture Group 2"
        ? Array.from({ length: 21 }, (_, index) => ({
            ...changes[1],
            id: 100 + index,
            old_ratio: 0.3 + index * 0.01,
            new_ratio: 0.2 + index * 0.01,
            changed_at: new Date(Date.UTC(2026, 6, 19, 11 + index)).toISOString(),
          })).reverse()
        : changes
      const filtered = modelName ? paginatedChanges.filter((item) => item.model_name === modelName) : paginatedChanges
      const items = filtered.slice((pageNumber - 1) * pageSize, pageNumber * pageSize)
      return json(route, {
        items,
        total: filtered.length,
        page: pageNumber,
        page_size: pageSize,
        pages: Math.max(1, Math.ceil(filtered.length / pageSize)),
      })
    }
    if (path === "/channels/rates") {
      state.batchRateRequests++
      return json(route,
        options.emptyComparisons ? [] : Array.from({ length: 9 }, (_, index) => ({
          id: index + 1,
          channel_id: 1,
          remote_group_id: 101 + index,
          model_name: `Fixture Group ${index + 1}`,
          ratio: 0.1 + index * 0.1,
          completion_ratio: 1,
          first_seen_at: "2026-07-19T09:00:00Z",
          last_seen_at: "2026-07-19T09:00:00Z",
        })),
      )
    }
    if (path.startsWith("/channels/") && path.endsWith("/rates")) {
      state.channelRateRequests++
      return json(route,
      options.emptyComparisons ? [] : Array.from({ length: 9 }, (_, index) => ({
        id: index + 1,
        channel_id: 1,
        remote_group_id: 101 + index,
        model_name: `Fixture Group ${index + 1}`,
        ratio: 0.1 + index * 0.1,
        completion_ratio: 1,
        first_seen_at: "2026-07-19T09:00:00Z",
        last_seen_at: "2026-07-19T09:00:00Z",
      })),
      )
    }
    if (path === "/notifications/channels" && request.method() === "GET") return json(route, [])
    if (path === "/notifications/logs") return json(route, { items: [], total: 0, page: 1, page_size: 10, pages: 0 })
    if (path === "/feishu/status") return json(route, {
      enabled: true,
      configured: true,
      encryption_configured: true,
      admin_auth_enabled: true,
      callback_path: "/callbacks/feishu",
      bound: false,
      bind_code_ttl_minutes: 10,
      bind_code_max_attempts: 5,
    })
    if (path === "/captcha-configs") return json(route, [])
    if (path === "/announcements") return json(route, { items: [], total: 0, page: 1, page_size: 10, pages: 0 })
    if (path === "/observations") return json(route, [{
      id: 1, channel_id: 1, kind: "rate", source: "manual", success: true,
      summary: "groups=1", sampled_at: "2026-07-19T09:00:00Z", created_at: "2026-07-19T09:00:00Z",
    }])
    if (path === "/health-probes/configs" || path === "/health-probes/runs") return json(route, [])
    if (path === "/comparisons/rates") return json(route, options.emptyComparisons ? {
      deviation_pct: 20,
      generated_at: "2026-07-19T09:00:00Z",
      model_names: [],
      models: [],
    } : {
      deviation_pct: 20,
      generated_at: "2026-07-19T09:00:00Z",
      model_names: ["gpt-pro"],
      models: [{
        model_name: "gpt-pro", count: 1, min_ratio: 0.2, max_ratio: 0.2, median_ratio: 0.2,
        entries: [{
          channel_id: 1, channel_name: channel.name, channel_type: "newapi", ratio: 0.2,
          completion_ratio: 1, last_seen_at: "2026-07-19T09:00:00Z", deviation_pct: 0, outlier: false,
        }],
      }],
    })
    if (path === "/route-advice" && request.method() === "GET") return json(route, {
      model_name: "gpt-pro", generated_at: "2026-07-19T09:00:00Z", recommended_channel_id: 1,
      current_primary: state.primarySaved ? { model_name: "gpt-pro", channel_id: 1 } : null,
      candidates: [{
        priority: 1, channel_id: 1, channel_name: channel.name, channel_type: "newapi",
        eligible: true, recommended: true, current_primary: state.primarySaved, score: 95, ratio: 0.2,
        completion_ratio: 1, rate_seen_at: "2026-07-19T09:00:00Z", balance: 12.5,
        balance_threshold: 1, health_status: "healthy", reasons: ["no_channel_error", "rate_fresh"], risks: [],
      }],
    })
    if (path === "/route-advice/audits") return json(route, [])
    if (path === "/route-advice/primary" && request.method() === "POST") {
      const body = request.postDataJSON() as { confirm?: boolean }
      if (body.confirm) {
        state.primaryConfirmRequests++
        state.primarySaved = true
      }
      return json(route, { changed: true, primary: { model_name: "gpt-pro", channel_id: 1 } })
    }
    if (path === "/adjustments/config" && request.method() === "GET") {
      return json(route, { gross_margin_pct: state.adjustmentGrossMarginPct })
    }
    if (path === "/adjustments/config" && request.method() === "PUT") {
      const body = request.postDataJSON() as { gross_margin_pct: number }
      state.adjustmentGrossMarginPct = body.gross_margin_pct
      return json(route, { gross_margin_pct: state.adjustmentGrossMarginPct })
    }
    if (path === "/adjustments/targets") return json(route, [{ id: 1, name: "Fixture Sub2API", enabled: true }])
    if (path === "/adjustments/groups") return json(route, [{
      id: 1, target_id: 1, remote_group_id: 10, name: "GPT mix", platform: "openai",
      ratio: adjustmentRatio, status: "active", last_sync_at: "2026-07-19T09:00:00Z",
    }])
    if (path === "/adjustments/audits") return json(route, [])
    if (path === "/adjustments/preview" && request.method() === "POST") {
      const body = request.postDataJSON() as { new_ratio: number }
      return json(route, {
        action: "execute", target_id: 1, target_name: "Fixture Sub2API", remote_group_id: 10,
        group_name: "GPT mix", group_status: "active", before_ratio: adjustmentRatio,
        after_ratio: body.new_ratio, change_percent: ((body.new_ratio - adjustmentRatio) / adjustmentRatio) * 100,
        impact_scope: "该 Sub2API 分组下所有未设置专属倍率的用户与 API Key",
        executable: body.new_ratio !== adjustmentRatio, blockers: [], generated_at: "2026-07-19T09:00:00Z",
      })
    }
    if (path === "/adjustments/execute" && request.method() === "POST") {
      const body = request.postDataJSON() as { confirm?: boolean; new_ratio: number }
      if (!body.confirm) return json(route, { error: "explicit confirmation is required" }, 400)
      state.adjustmentConfirmRequests++
      const before = adjustmentRatio
      adjustmentRatio = body.new_ratio
      return json(route, {
        id: 7, action: "execute", target_id: 1, target_name: "Fixture Sub2API",
        remote_group_id: 10, group_name: "GPT mix", before_ratio: before,
        after_ratio: adjustmentRatio, operator: "admin", input: "{}", status: "succeeded",
        created_at: "2026-07-19T09:00:00Z", completed_at: "2026-07-19T09:00:01Z",
      })
    }
    if (path === "/gateway/groups") return json(route, { items: [{
      id: 1,
      name: "Fixture Gateway",
      status: "active",
      rate_sort_direction: "asc",
      models_mode: "auto",
      retry_enabled: true,
      retry_count: 0,
      failover_enabled: true,
      failover_max: 1,
      created_at: "2026-07-19T09:00:00Z",
      updated_at: "2026-07-19T09:00:00Z",
    }] })
    if (path === "/gateway/groups/1/keys") return json(route, { items: [] })
    if (path === "/gateway/groups/1/routes") return json(route, { items: [] })
    if (path === "/gateway/providers/options") {
      state.gatewayProviderOptionRequests++
      return json(route, { items: [] })
    }
    if (path === "/gateway/prices") {
      state.gatewayPriceRequests++
      return json(route, { items: [] })
    }
    if (path === "/gateway/usage/models") {
      state.gatewayUsageModelRequests++
      return json(route, { items: [{ model: "gpt-pro", count: 2 }] })
    }
    if (path === "/gateway/usage/keys") return json(route, { items: [] })
    if (path === "/gateway/usage/stats") {
      state.gatewayUsageStatsRequests++
      return json(route, {
      total_requests: 2, success_count: 2, error_count: 0,
      total_input_tokens: 1000, total_output_tokens: 500,
      total_cache_creation_tokens: 0, total_cache_read_tokens: 0,
      total_tokens: 1500, total_cost: 0.02, total_actual_cost: 0.01,
      average_duration_ms: 850, endpoints: [],
      })
    }
    if (path === "/channels/usage-analytics") {
      state.usageAnalyticsRequests++
      return json(route, { data: {
      source: "upstream_api",
      start_date: url.searchParams.get("start_date") || "2026-07-23",
      end_date: url.searchParams.get("end_date") || "2026-07-29",
      totals: {
        requests: 2905,
        input_tokens: 24060000,
        output_tokens: 1610000,
        cache_creation_tokens: 0,
        cache_read_tokens: 225250000,
        total_tokens: 250920000,
        actual_cost: 8.791,
        standard_cost: 293.0328,
        average_duration_ms: 15080,
      },
      channels: [{
        channel_id: 1,
        channel_name: "Walkcoding",
        channel_type: "sub2api",
        source: "upstream_api",
        start_date: "2026-07-23",
        end_date: "2026-07-29",
        granularity: "day",
        fetched_at: "2026-07-29T12:00:00Z",
        cached: true,
        stale: false,
        refreshing: false,
        totals: {
          requests: 2855,
          input_tokens: 23560000,
          output_tokens: 1560000,
          cache_creation_tokens: 0,
          cache_read_tokens: 220800000,
          total_tokens: 245920000,
          actual_cost: 8.491,
          standard_cost: 287.9328,
          average_duration_ms: 15080,
        },
        models: [
          { model: "gpt-5.6-sol", requests: 2766, input_tokens: 22500000, output_tokens: 1450000, cache_creation_tokens: 0, cache_read_tokens: 214910000, total_tokens: 238860000, actual_cost: 8.37, standard_cost: 283.95 },
          { model: "gpt-5.6-terra", requests: 83, input_tokens: 1050000, output_tokens: 104000, cache_creation_tokens: 0, cache_read_tokens: 5876000, total_tokens: 7030000, actual_cost: 0.117, standard_cost: 3.91 },
          { model: "gpt-5.5", requests: 6, input_tokens: 10000, output_tokens: 6000, cache_creation_tokens: 0, cache_read_tokens: 13310, total_tokens: 29310, actual_cost: 0.0022, standard_cost: 0.072 },
        ],
        groups: [{ group_id: 3, group_name: "Codex - 特价（0.03）", requests: 2855, total_tokens: 245920000, actual_cost: 8.491, standard_cost: 287.9328 }],
        trend: [
          { date: "2026-07-28", requests: 1200, input_tokens: 10000000, output_tokens: 610000, cache_creation_tokens: 0, cache_read_tokens: 100000000, total_tokens: 110610000, actual_cost: 3.8, standard_cost: 126.6 },
          { date: "2026-07-29", requests: 1655, input_tokens: 13560000, output_tokens: 950000, cache_creation_tokens: 0, cache_read_tokens: 120800000, total_tokens: 135310000, actual_cost: 4.691, standard_cost: 161.3328 },
        ],
      }, {
        channel_id: 2,
        channel_name: "Fixture Upstream B",
        channel_type: "sub2api",
        source: "upstream_api",
        start_date: "2026-07-23",
        end_date: "2026-07-29",
        granularity: "day",
        fetched_at: "2026-07-29T12:00:00Z",
        cached: true,
        stale: false,
        refreshing: false,
        totals: {
          requests: 50,
          input_tokens: 500000,
          output_tokens: 50000,
          cache_creation_tokens: 0,
          cache_read_tokens: 4450000,
          total_tokens: 5000000,
          actual_cost: 0.3,
          standard_cost: 5.1,
          average_duration_ms: 12000,
        },
        models: [
          { model: "gpt-5.6-sol", requests: 50, input_tokens: 500000, output_tokens: 50000, cache_creation_tokens: 0, cache_read_tokens: 4450000, total_tokens: 5000000, actual_cost: 0.3, standard_cost: 5.1 },
        ],
        groups: [{ group_id: 4, group_name: "Codex - 标准", requests: 50, total_tokens: 5000000, actual_cost: 0.3, standard_cost: 5.1 }],
        trend: [
          { date: "2026-07-29", requests: 50, input_tokens: 500000, output_tokens: 50000, cache_creation_tokens: 0, cache_read_tokens: 4450000, total_tokens: 5000000, actual_cost: 0.3, standard_cost: 5.1 },
        ],
      }],
      errors: [],
      cache: {
        persisted: true,
        fresh_for_seconds: 600,
        cached_channels: 2,
        live_channels: 0,
        refreshing_channels: 0,
        generated_at: "2026-07-29T12:00:00Z",
      },
      } })
    }
    if (path === "/channels/model-prices") return json(route, { data: { items: [
      {
        channel_id: 1,
        channel_name: "Fixture Upstream A",
        channel_type: "sub2api",
        source_name: "Claude Pool",
        platform: "anthropic",
        group_id: 11,
        group_name: "标准组",
        rate_multiplier: 0.8,
        peak_rate_enabled: true,
        peak_rate_multiplier: 1.5,
        model_name: "claude-3-5-sonnet",
        billing_mode: "token",
        tier_label: "默认",
        base_input_price_per_million: 3,
        base_output_price_per_million: 15,
        input_price_per_million: 2.4,
        output_price_per_million: 12,
        peak_input_price_per_million: 3.6,
        peak_output_price_per_million: 18,
        cache_write_price_per_million: 3,
        cache_read_price_per_million: 0.24,
      },
      {
        channel_id: 1,
        channel_name: "Fixture Upstream A",
        channel_type: "sub2api",
        source_name: "OpenAI Pool",
        platform: "openai",
        group_id: 12,
        group_name: "VIP 组",
        rate_multiplier: 0.5,
        peak_rate_enabled: false,
        peak_rate_multiplier: 1,
        model_name: "gpt-pro",
        billing_mode: "token",
        tier_label: "默认",
        base_input_price_per_million: 2,
        base_output_price_per_million: 8,
        input_price_per_million: 1,
        output_price_per_million: 4,
      },
      {
        channel_id: 1,
        channel_name: "Fixture Upstream A",
        channel_type: "sub2api",
        source_name: "OpenAI Backup",
        platform: "openai",
        group_id: 13,
        group_name: "高价备用组",
        rate_multiplier: 1,
        peak_rate_enabled: false,
        peak_rate_multiplier: 1,
        model_name: "gpt-pro",
        billing_mode: "token",
        tier_label: "默认",
        base_input_price_per_million: 2,
        base_output_price_per_million: 8,
        input_price_per_million: 2,
        output_price_per_million: 8,
      },
      {
        channel_id: 2,
        channel_name: "Fixture Upstream B",
        channel_type: "sub2api",
        source_name: "OpenAI Pool B",
        platform: "openai",
        group_id: 22,
        group_name: "B 默认组",
        rate_multiplier: 0.6,
        peak_rate_enabled: false,
        peak_rate_multiplier: 1,
        model_name: "gpt-pro",
        billing_mode: "token",
        tier_label: "默认",
        base_input_price_per_million: 2,
        base_output_price_per_million: 8,
        input_price_per_million: 1.2,
        output_price_per_million: 4.8,
      },
      {
        channel_id: 2,
        channel_name: "Fixture Upstream B",
        channel_type: "sub2api",
        source_name: "Qwen Pool",
        platform: "qwen",
        group_id: 21,
        group_name: "默认组",
        rate_multiplier: 1,
        peak_rate_enabled: false,
        peak_rate_multiplier: 1,
        model_name: "qwen-max",
        billing_mode: "token",
        tier_label: "默认",
        base_input_price_per_million: 1.6,
        base_output_price_per_million: 6.4,
        input_price_per_million: 1.6,
        output_price_per_million: 6.4,
      },
      {
        channel_id: 1,
        channel_name: "Fixture Upstream A",
        channel_type: "sub2api",
        source_name: "Image Pool",
        platform: "google",
        group_id: 31,
        group_name: "图片组",
        rate_multiplier: 0.8,
        peak_rate_enabled: true,
        peak_rate_multiplier: 1.5,
        model_name: "imagen-3",
        billing_mode: "image",
        tier_label: "2K",
        min_tokens: 0,
        base_per_request_price: 0.1,
        per_request_price: 0.08,
        peak_per_request_price: 0.12,
      },
    ], errors: [] } })
    if (path === "/gateway/usage") {
      state.gatewayUsageRequests++
      return json(route, { items: [], total: 0, page: 1, page_size: 50, pages: 0 })
    }
    if (path === "/settings/config") {
      if (request.method() === "PUT") {
        const body = request.postDataJSON() as { app?: { title?: string } }
        appTitle = body.app?.title?.trim() || "RouteScope"
        return json(route, { config_path: config.config_path, message: "saved" })
      }
      return json(route, {
        ...config,
        config: {
          ...config.config,
          app: { ...config.config.app, title: appTitle },
        },
      })
    }
    if (path === "/channels" && request.method() === "POST") return json(route, { id: 2 })
    if (path.startsWith("/notifications/channels") && ["POST", "PUT"].includes(request.method())) return json(route, { id: 2 })
    return json(route, {})
  })
  return state
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
  await expect(page.getByRole("link", { name: "系统设置" })).toBeVisible()
})

test("import preview renders conflict and malformed-row feedback locally", async ({ page }) => {
  await installApiFixture(page)
  await page.goto("/ops/channels")
  await expect(page.getByText("Fixture Channel").first()).toBeVisible()
  await page.getByRole("button", { name: /^导入$/ }).click()
  await page.locator("textarea").fill(JSON.stringify({
    version: 2,
    accounts: [
      { site_name: "Fixture Channel", site_url: "https://fixture.example.com", site_type: "sub2api", account_info: { username: "a", access_token: "t" } },
      { site_name: "Broken", site_url: "", site_type: "sub2api", account_info: { username: "b", access_token: "t" } },
    ],
  }))
  await expect(page.getByText(/预览 2 行/)).toBeVisible()
  await expect(page.getByText(/不支持|无效|错误|缺少/).first()).toBeVisible()
  await expect(page.getByText("Broken", { exact: true })).toBeVisible()
})

test("channel favorites persist through the channels saved view", async ({ page }) => {
  await installApiFixture(page)
  await page.goto("/ops/channels")

  await page.getByRole("button", { name: "收藏 Fixture Channel" }).click()
  await expect(page.getByText("已收藏 Fixture Channel")).toBeVisible()

  await page.goto("/favorites")
  await expect(page).toHaveURL(/\/ops\/channels\?scope=favorites$/)
  await expect(page.getByRole("navigation", { name: "主导航" }).getByRole("link", { name: "收藏渠道", exact: true })).toHaveCount(0)
  await expect(page.getByText("Fixture Channel").first()).toBeVisible()
  await expect(page.getByRole("button", { name: "取消收藏 Fixture Channel" })).toBeVisible()

  await page.getByRole("group", { name: "渠道范围" }).getByRole("button", { name: "全部", exact: true }).click()
  await expect(page).toHaveURL(/\/ops\/channels$/)
  await expect(page.getByRole("heading", { name: "上游管理" })).toBeVisible()

  await page.getByRole("group", { name: "渠道范围" }).getByRole("button", { name: /收藏 1/ }).click()
  await expect(page).toHaveURL(/\/ops\/channels\?scope=favorites$/)

  await page.getByRole("button", { name: "取消收藏 Fixture Channel" }).click()
  await expect(page.getByText("还没有收藏渠道")).toBeVisible()
})

test("channel list view toggles and persists", async ({ page }) => {
  const state = await installApiFixture(page)
  await page.goto("/ops/channels")

  const viewSwitcher = page.getByRole("group", { name: "渠道视图" })
  await viewSwitcher.getByRole("button", { name: "列表", exact: true }).click()
  await expect(
    viewSwitcher.getByRole("button", { name: "列表", exact: true }),
  ).toHaveAttribute("aria-pressed", "true")
  await expect(page.getByRole("table")).toBeVisible()
  await expect(page.getByRole("columnheader", { name: "渠道" })).toBeVisible()
  await expect(page.getByRole("columnheader", { name: "余额" })).toBeVisible()
  const headers = page.getByTestId("channel-list-table").getByRole("columnheader")
  await expect(headers.nth(2)).toHaveText("状态")
  await expect(headers.nth(3)).toHaveText("分组")
  await expect(headers.nth(4)).toHaveText("余额")
  await expect(headers.nth(5)).toContainText("实际单价")
  await expect(headers.nth(6)).toContainText("7 日用量")
  await expect(headers.nth(7)).toHaveText("平均耗时")
  await expect(headers.nth(8)).toHaveText("今日消费")
  const sortableHeaders = page.getByTestId("channel-list-table").getByRole("button", { name: /排序/ })
  await expect(sortableHeaders).toHaveCount(5)
  const balanceHeader = headers.nth(4)
  const balanceSort = balanceHeader.getByRole("button")
  await balanceSort.click()
  await expect(balanceHeader).toHaveAttribute("aria-sort", "ascending")
  await balanceSort.click()
  await expect(balanceHeader).toHaveAttribute("aria-sort", "descending")
  await balanceSort.click()
  await expect(balanceHeader).toHaveAttribute("aria-sort", "none")
  const channelRow = page.getByTestId("channel-list-table").getByRole("row").filter({ hasText: "Fixture Channel" })
  await expect(channelRow.getByText("245.9M", { exact: true })).toBeVisible()
  await expect(channelRow.getByText("2,855 次", { exact: true })).toBeVisible()
  await expect(channelRow.getByText("$0.0345", { exact: true })).toBeVisible()
  await expect(channelRow.getByText("$0.0030 / 次", { exact: true })).toBeVisible()
  await expect(channelRow.getByText("15.08s", { exact: true })).toBeVisible()
  const usageRequestsBeforeRefresh = state.usageAnalyticsRequests
  await page.getByRole("button", { name: "刷新数据", exact: true }).click()
  await expect.poll(() => state.usageAnalyticsRequests).toBeGreaterThan(usageRequestsBeforeRefresh)
  const syncAction = page.getByRole("button", { name: "同步 Fixture Channel", exact: true })
  await expect(syncAction).toBeVisible()
  const actionRight = await syncAction.evaluate((element) => element.getBoundingClientRect().right)
  await expect.poll(() => state.batchRateRequests).toBeGreaterThan(0)
  expect(state.batchRateRequests).toBeLessThanOrEqual(2)
  expect(state.channelRateRequests).toBe(0)
  const viewportWidth = await page.evaluate(() => window.innerWidth)
  expect(actionRight).toBeLessThanOrEqual(viewportWidth)
  await expect(page.getByText("Fixture Group 4", { exact: true })).toBeVisible()
  await expect(page.getByText("Fixture Group 5", { exact: true })).toHaveCount(0)
  await page.getByRole("button", { name: "展开另外 5 个分组" }).click()
  await expect(page.getByText("Fixture Group 9", { exact: true })).toBeVisible()
  await expect(page.getByRole("button", { name: "收起 5 个分组" })).toHaveAttribute(
    "aria-expanded",
    "true",
  )

  await page.reload()
  const reloadedSwitcher = page.getByRole("group", { name: "渠道视图" })
  await expect(
    reloadedSwitcher.getByRole("button", { name: "列表", exact: true }),
  ).toHaveAttribute("aria-pressed", "true")
  await expect(page.getByRole("table")).toBeVisible()

  await reloadedSwitcher.getByRole("button", { name: "卡片", exact: true }).click()
  await expect(
    reloadedSwitcher.getByRole("button", { name: "卡片", exact: true }),
  ).toHaveAttribute("aria-pressed", "true")
  await expect(page.getByRole("table")).toHaveCount(0)
})

test("channel list gives groups more room than status on wide screens", async ({ page }) => {
  await page.setViewportSize({ width: 2048, height: 900 })
  await installApiFixture(page)
  await page.goto("/ops/channels")
  await page.getByRole("group", { name: "渠道视图" })
    .getByRole("button", { name: "列表", exact: true })
    .click()

  const table = page.getByTestId("channel-list-table")
  await expect(table).toBeVisible()
  const metrics = await table.evaluate((element) => {
    const headers = Array.from(element.querySelectorAll("thead th"))
    const width = element.getBoundingClientRect().width
    return {
      width,
      statusWidth: headers.find((header) => header.textContent?.trim() === "状态")?.getBoundingClientRect().width ?? 0,
      groupWidth: headers.find((header) => header.textContent?.trim() === "分组")?.getBoundingClientRect().width ?? 0,
      overflow:
        document.documentElement.scrollWidth - document.documentElement.clientWidth,
    }
  })
  expect(metrics.groupWidth).toBeGreaterThan(metrics.statusWidth)
  expect(metrics.groupWidth / metrics.width).toBeLessThan(0.25)
  expect(metrics.overflow).toBeLessThanOrEqual(1)
})

test("gateway quickstart is open by default and persists its state", async ({ page }) => {
  await installApiFixture(page)
  await page.goto("/gateway")

  await expect(page.getByRole("heading", { name: "API 转发" })).toBeVisible()
  await expect(page.getByText("它解决什么需求？", { exact: true })).toHaveCount(0)
  await expect(page.getByRole("tab", { name: "路由配置" })).toBeVisible()
  await expect(page.getByRole("tab", { name: "网关计费价" })).toBeVisible()

  const collapse = page.getByRole("button", { name: "收起使用指南", exact: true })
  await expect(collapse).toHaveAttribute("aria-expanded", "true")
  await expect(page.getByText("添加上游连接", { exact: true })).toBeVisible()

  await collapse.click()
  await expect(page.getByRole("button", { name: "展开使用指南", exact: true }))
    .toHaveAttribute("aria-expanded", "false")
  await page.reload()
  await expect(page.getByRole("button", { name: "展开使用指南", exact: true }))
    .toHaveAttribute("aria-expanded", "false")
})

test("gateway defers secondary tab data until the operator opens it", async ({ page }) => {
  const state = await installApiFixture(page)
  await page.goto("/gateway")
  await expect(page.getByRole("heading", { name: "Fixture Gateway", exact: true })).toBeVisible()

  expect(state.gatewayProviderOptionRequests).toBe(0)
  expect(state.gatewayPriceRequests).toBe(0)
  expect(state.gatewayUsageRequests).toBe(0)
  expect(state.gatewayUsageModelRequests).toBe(0)
  expect(state.gatewayUsageStatsRequests).toBe(0)

  await page.getByRole("tab", { name: "上游连接" }).click()
  await expect.poll(() => state.gatewayProviderOptionRequests).toBeGreaterThan(0)
  expect(state.gatewayPriceRequests).toBe(0)
  expect(state.gatewayUsageRequests).toBe(0)

  await page.getByRole("tab", { name: "使用记录" }).click()
  await expect.poll(() => state.gatewayUsageRequests).toBeGreaterThan(0)
  await expect.poll(() => state.gatewayUsageModelRequests).toBeGreaterThan(0)
  await expect.poll(() => state.gatewayUsageStatsRequests).toBeGreaterThan(0)
  expect(state.gatewayPriceRequests).toBe(0)

  await page.getByRole("tab", { name: /网关计费/ }).click()
  await expect.poll(() => state.gatewayPriceRequests).toBeGreaterThan(0)
})

test("gateway quickstart keeps metadata and actions usable on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await installApiFixture(page)
  await page.goto("/gateway")

  const quickstart = page.getByText("API 转发接入指南", { exact: true }).locator("..")
  const baseURL = page.getByTestId("gateway-base-url")
  const expand = page.getByRole("button", { name: /使用指南/, exact: true })
  const usage = page.getByRole("button", { name: "查看使用记录", exact: true })
  await expect(baseURL).toBeVisible()
  await expect(expand).toBeVisible()
  await expect(usage).toBeVisible()

  const metrics = await page.evaluate(() => {
    const base = document.querySelector('[data-testid="gateway-base-url"]')
    const buttons = Array.from(document.querySelectorAll("button")).filter((button) =>
      ["查看使用记录", "展开使用指南", "收起使用指南"].includes(button.textContent?.trim() ?? ""),
    )
    return {
      baseWidth: base?.getBoundingClientRect().width ?? 0,
      buttonWidths: buttons.map((button) => button.getBoundingClientRect().width),
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    }
  })
  expect(metrics.baseWidth).toBeGreaterThan(260)
  expect(metrics.buttonWidths).toHaveLength(2)
  expect(Math.min(...metrics.buttonWidths)).toBeGreaterThan(130)
  expect(metrics.overflow).toBeLessThanOrEqual(1)
  await expect(quickstart).toBeVisible()
})

test("real upstream usage is the primary cost page", async ({ page }) => {
  await installApiFixture(page)
  await page.goto("/usage-costs")

  await expect(page.getByRole("heading", { name: "真实消费" })).toBeVisible()
  await expect(page.getByRole("link", { name: "真实消费", exact: true })).toHaveAttribute("aria-current", "page")
  await expect(page.getByText("上游账单 API", { exact: true })).toBeVisible()
  await expect(page.getByText("actual_cost / cost", { exact: false })).toBeVisible()
  await expect(page.getByText("Walkcoding", { exact: true }).first()).toBeVisible()
  await expect(page.getByText("渠道性价比与稳定性", { exact: true })).toBeVisible()
  await expect(page.getByText("综合推荐：Walkcoding", { exact: true })).toBeVisible()
  await expect(page.getByText("建议依据", { exact: true })).toBeVisible()
  await expect(page.getByRole("tab", { name: "渠道总览", exact: true })).toHaveAttribute("data-state", "active")
  await page.getByRole("tab", { name: "模型消费", exact: true }).click()
  await expect(page.getByText("gpt-5.6-sol", { exact: true }).first()).toBeVisible()
  const modelTable = page.getByRole("table").filter({ has: page.getByRole("columnheader", { name: "模型", exact: true }) })
  const modelHeaders = modelTable.getByRole("columnheader")
  await expect(modelHeaders.nth(0)).toHaveText("模型")
  await expect(modelHeaders.nth(1)).toHaveText("上游渠道")
  await expect(modelTable.getByRole("columnheader", { name: "输入 Token", exact: true })).toBeVisible()
  await expect(modelTable.getByRole("columnheader", { name: "输出 Token", exact: true })).toBeVisible()
  await expect(modelTable.getByRole("columnheader", { name: "缓存读取", exact: true })).toBeVisible()
  await expect(modelTable.getByRole("columnheader", { name: "百万 Token 费用", exact: true })).toBeVisible()
  await expect(modelTable.getByRole("columnheader", { name: "单次调用均价", exact: true })).toBeVisible()
  await expect(modelTable.getByText("2 个渠道 · 2 条记录", { exact: true })).toBeVisible()
  await expect(modelTable.getByText("Fixture Upstream B", { exact: true })).toBeVisible()

  await page.getByRole("combobox", { name: "模型筛选" }).click()
  await page.getByRole("option", { name: "gpt-5.6-sol（2 个渠道）", exact: true }).click()
  await expect(modelTable.getByText("gpt-5.6-terra", { exact: true })).toHaveCount(0)
  await expect(modelTable.getByText("gpt-5.5", { exact: true })).toHaveCount(0)
  await expect(modelTable.getByText("Walkcoding", { exact: true })).toBeVisible()
  await expect(modelTable.getByText("Fixture Upstream B", { exact: true })).toBeVisible()
  const walkcodingRow = modelTable.getByRole("row").filter({ hasText: "Walkcoding" })
  await expect(walkcodingRow.getByText("$0.0350", { exact: true })).toBeVisible()
  await expect(walkcodingRow.getByText("$0.0030", { exact: true })).toBeVisible()
  const fixtureRow = modelTable.getByRole("row").filter({ hasText: "Fixture Upstream B" })
  await expect(fixtureRow.getByText("$0.0600", { exact: true })).toBeVisible()
  await expect(fixtureRow.getByText("$0.0060", { exact: true })).toBeVisible()
  await expect(page.getByText("2,905", { exact: true }).first()).toBeVisible()
  await expect(page.getByText("250.9M", { exact: true }).first()).toBeVisible()
  await expect(page.getByText("$8.79", { exact: true }).first()).toBeVisible()
  await expect(page.getByText("标准 $293.03", { exact: false }).first()).toBeVisible()
  await expect(page.getByText("实际每百万 Token", { exact: true })).toBeVisible()
  await expect(page.getByText("单次调用均价", { exact: true }).first()).toBeVisible()
  await expect(page.getByText("$0.0350", { exact: true }).first()).toBeVisible()
  await expect(page.getByText("$0.0030", { exact: true }).first()).toBeVisible()
  await expect(page.getByText("快照 2", { exact: false })).toBeVisible()
  await page.getByRole("tab", { name: "使用分布", exact: true }).click()
  await expect(page.getByText("上游消费分布", { exact: true })).toBeVisible()
  await expect(page.getByText("分组使用分布", { exact: true })).toBeVisible()
  await expect(page.getByText("Codex - 特价（0.03）", { exact: true })).toBeVisible()
  const groupTable = page.getByRole("table").filter({ has: page.getByRole("columnheader", { name: "上游 / 分组", exact: true }) })
  const walkcodingDistributionCard = page.getByRole("button", { name: "选择上游 Walkcoding", exact: true })
  await expect(walkcodingDistributionCard).toHaveAttribute("aria-pressed", "false")
  await walkcodingDistributionCard.click()
  await expect(walkcodingDistributionCard).toHaveAttribute("aria-pressed", "true")
  await expect(groupTable.getByText("Walkcoding", { exact: true })).toBeVisible()
  await expect(groupTable.getByText("Fixture Upstream B", { exact: true })).toHaveCount(0)
  await page.getByRole("button", { name: "清除筛选", exact: true }).click()
  await expect(groupTable.getByText("Fixture Upstream B", { exact: true })).toBeVisible()
})

test("legacy model price route opens real upstream usage", async ({ page }) => {
  await installApiFixture(page)
  await page.goto("/model-prices")
  await expect(page.getByRole("heading", { name: "真实消费" })).toBeVisible()
  await expect(page).toHaveURL(/\/model-prices/)
})

test("real upstream usage stays within the mobile viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await installApiFixture(page)
  await page.goto("/usage-costs")

  await expect(page.getByRole("heading", { name: "真实消费" })).toBeVisible()
  await page.getByRole("tab", { name: "模型消费", exact: true }).click()
  await expect(page.getByText("gpt-5.6-sol", { exact: true }).last()).toBeVisible()
  const mobileModelCards = page.locator("div.md\\:hidden")
  await expect(mobileModelCards.getByText("百万 Token 费用", { exact: true }).first()).toBeVisible()
  await expect(mobileModelCards.getByText("单次调用均价", { exact: true }).first()).toBeVisible()
  const walkcodingCard = mobileModelCards.locator("div.space-y-3").filter({ hasText: "Walkcoding" }).first()
  await expect(walkcodingCard.getByText("$0.0350", { exact: true })).toBeVisible()
  await expect(walkcodingCard.getByText("$0.0030", { exact: true })).toBeVisible()
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(1)
})

test("notification form exposes QQ group/private and query-auth controls", async ({ page }) => {
  await installApiFixture(page)
  await page.goto("/notifications")
  await page.getByRole("button", { name: /新增/ }).click()
  await page.locator("#notify-name").fill("Fixture QQ")
  await page.getByRole("combobox").first().click()
  await page.getByRole("option", { name: "QQ 机器人 (OneBot)" }).click()
  await page.locator("#qq-base").fill("http://127.0.0.1:5700")
  await page.locator("#qq-group").fill("123456")
  await expect(page.locator("#qq-query-auth")).toBeVisible()
  await page.locator("#qq-query-auth").click()
  await page.getByRole("combobox").nth(1).click()
  await page.getByRole("option", { name: /私聊/ }).click()
  await expect(page.locator("#qq-user")).toBeVisible()
  await page.locator("#qq-user").fill("10001")
})

test("Feishu control lives in notification center instead of system settings", async ({ page }) => {
  await installApiFixture(page)
  await page.goto("/notifications")

  await page.getByRole("tab", { name: "飞书控制" }).click()
  await expect(page.getByText("飞书控制通道", { exact: true })).toBeVisible()
  await expect(page.getByText(/\/callbacks\/feishu/)).toBeVisible()

  await page.goto("/settings")
  await expect(page.getByRole("tab", { name: /飞书控制/ })).toHaveCount(0)
  await expect(page.getByRole("option", { name: "飞书控制" })).toHaveCount(0)
})

test("production checklist reports protected anonymous API", async ({ page }) => {
  await installApiFixture(page, { protectedProbe: true })
  await page.goto("/settings")
  await page.getByRole("tab", { name: "数据备份", exact: true }).click()
  await expect(page.getByText(/匿名 API 实测/)).toBeVisible()
  await expect(page.getByText(/受保护|401/)).toBeVisible({ timeout: 10_000 })
})

test("settings page renders without invalid nested HTML warnings", async ({ page }) => {
  const consoleErrors: string[] = []
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text())
  })

  await installApiFixture(page)
  await page.goto("/settings")
  await expect(page.getByRole("heading", { name: "系统设置" })).toBeVisible()
  await expect(page.getByText("设置目录", { exact: true })).toHaveCount(0)
  await expect(page.locator("#settings-area")).toHaveCount(0)
  await expect(page.getByRole("tab", { name: /通知接入/ })).toHaveCount(0)
  await expect(page.getByText("资源管理", { exact: true })).toHaveCount(0)
  await expect(page.locator("main").getByRole("link", { name: "通知中心", exact: true })).toHaveCount(0)
  await expect(page.locator("main").getByRole("link", { name: "Captcha", exact: true })).toHaveCount(0)

  const nestingWarnings = consoleErrors.filter((entry) =>
    entry.includes("cannot be a descendant") || entry.includes("cannot contain a nested"),
  )
  expect(nestingWarnings).toEqual([])
})

test("settings sections switch through the shared tabs", async ({ page }) => {
  await installApiFixture(page)
  await page.goto("/settings")

  await expect(page.getByRole("tab", { name: "运行配置", exact: true })).toHaveAttribute("data-state", "active")
  await page.getByRole("tab", { name: "通知策略", exact: true }).click()
  await expect(page.getByText("通知策略", { exact: true }).first()).toBeVisible()
  await page.getByRole("tab", { name: "上游请求", exact: true }).click()
  await expect(page.getByText("上游请求", { exact: true }).first()).toBeVisible()
  await page.getByRole("tab", { name: "代理 IP", exact: true }).click()
  await expect(page.getByText("代理 IP", { exact: true }).first()).toBeVisible()
  await page.getByRole("tab", { name: "数据备份", exact: true }).click()
  await expect(page.getByText("数据与备份", { exact: true }).first()).toBeVisible()
  await page.getByRole("tab", { name: "运行配置", exact: true }).click()
  await expect(page.getByText("应用信息", { exact: true }).first()).toBeVisible()
})

test("saved app title updates the shell without a browser reload", async ({ page }) => {
  await installApiFixture(page)
  await page.goto("/settings")

  await expect(page.getByRole("heading", { name: "Fixture Ops", exact: true })).toBeVisible()
  await page.getByLabel("应用标题", { exact: true }).fill("Fixture Control")
  await page.getByRole("button", { name: "保存", exact: true }).click()

  await expect(page.getByRole("heading", { name: "Fixture Control", exact: true })).toBeVisible()
  await expect(page).toHaveTitle("系统设置 · Fixture Control")
})

test("settings keeps unsaved notification prefix edits during refresh", async ({ page }) => {
  await installApiFixture(page)
  await page.goto("/settings")

  const prefix = page.getByRole("textbox", { name: "通知前缀", exact: true })
  await prefix.fill("[临时前缀]")
  await page.getByRole("button", { name: "刷新数据", exact: true }).click()
  await expect(prefix).toHaveValue("[临时前缀]")
})

test("comparison drill-down and the legacy route advice URL stay compatible", async ({ page }) => {
  await installApiFixture(page)
  await page.goto("/comparisons")
  await page.getByRole("link", { name: "采集记录" }).click()
  await expect(page).toHaveURL(/\/activity\?view=observations&channel_id=1&kind=rate/)
  await expect(page.getByText("获取到 1 个倍率分组")).toBeVisible()

  await page.goto("/route-advice")
  await expect(page).toHaveURL(/\/comparisons$/)
  await expect(page.getByRole("heading", { name: "分组倍率", level: 1 })).toBeVisible()
  await expect(page.getByRole("link", { name: "路由建议", exact: true })).toHaveCount(0)
})

test("selecting a group filters its rate change history", async ({ page }) => {
  const state = await installApiFixture(page)
  await page.goto("/comparisons")

  const history = page.getByTestId("rate-change-history")
  await expect(history.getByText("Fixture Group 1", { exact: true })).toBeVisible()
  await expect(history.getByText("Fixture Group 2", { exact: true })).toBeVisible()

  await page.getByRole("row", { name: "Fixture Group 2，查看倍率变化" }).click()
  await expect(history.getByText("Fixture Group 2 倍率变化", { exact: true })).toBeVisible()
  await expect(history.getByText("Fixture Group 2", { exact: true })).toBeVisible()
  await expect(history.getByText("Fixture Group 1", { exact: true })).toHaveCount(0)
  const selectedChange = history.getByTestId("rate-change-item").filter({ hasText: "Fixture Group 2" })
  await expect(selectedChange.getByText("0.30", { exact: true })).toBeVisible()
  await expect(selectedChange.getByText("0.20", { exact: true })).toBeVisible()
  await expect(history.getByTestId("rate-trend-chart")).toBeVisible()
  await expect.poll(() => state.rateChangeQueries.some((query) =>
    query.includes("remote_group_id=102") && query.includes("model_name=Fixture+Group+2"),
  )).toBe(true)

  await history.getByRole("button", { name: "全部分组" }).click()
  await expect(history.getByText("Fixture Group 1", { exact: true })).toBeVisible()
})

test("selected group rate history supports pagination", async ({ page }) => {
  const state = await installApiFixture(page, { paginatedRateChanges: true })
  await page.goto("/comparisons")

  await page.getByRole("row", { name: "Fixture Group 2，查看倍率变化" }).click()
  const history = page.getByTestId("rate-change-history")
  await expect(history.getByText("第 1 / 2 页", { exact: true })).toBeVisible()
  await history.getByRole("button", { name: "下一页变更" }).click()
  await expect(history.getByText("第 2 / 2 页", { exact: true })).toBeVisible()
  await expect.poll(() => state.rateChangeQueries.some((query) => query.includes("page=2"))).toBe(true)
})

test("comparison empty state sends the operator back to channel sync", async ({ page }) => {
  await installApiFixture(page, { emptyComparisons: true })
  await page.goto("/comparisons")
  await expect(page.getByText("还没有倍率快照", { exact: false })).toBeVisible()
  await expect(page.getByRole("link", { name: "去总览同步倍率" })).toHaveAttribute("href", "/")
  await expect(page.getByRole("link", { name: "查看采集与健康" })).toHaveAttribute("href", "/activity?view=observations")
})

test("notification and captcha empty states keep only the setup action", async ({ page }) => {
  await installApiFixture(page)
  await page.goto("/notifications")
  await expect(page.getByText("还没有通知渠道", { exact: true })).toBeVisible()
  await expect(page.getByText("上次发送", { exact: true })).toHaveCount(0)

  await page.goto("/captcha")
  await expect(page.getByText("还没有验证码服务", { exact: true })).toBeVisible()
  await expect(page.getByRole("navigation", { name: "主导航" }).getByRole("link", { name: "Captcha", exact: true })).toHaveCount(0)
})

test("comparison uses a mobile group selector without page overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await installApiFixture(page)
  await page.goto("/comparisons")

  await expect(page.getByLabel("选择渠道", { exact: true })).toBeVisible()
  await expect(page.locator("h3").filter({ hasText: "上游渠道" })).toBeHidden()
  await expect(page.getByRole("columnheader", { name: "描述" })).toBeHidden()
  await expect(page.getByRole("columnheader", { name: "最近见到" })).toBeVisible()
  await page.getByRole("row", { name: "Fixture Group 1，查看倍率变化" }).click()
  const history = page.getByTestId("rate-change-history")
  await expect(history.getByText("Fixture Group 1 倍率变化", { exact: true })).toBeVisible()
  const visibleChange = history.getByTestId("rate-change-item")
  await expect.poll(async () => visibleChange.evaluate((element) => {
    const rect = element.getBoundingClientRect()
    return rect.top >= 0 && rect.bottom <= window.innerHeight + 1
  })).toBe(true)
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(1)
})

test("legacy route advice redirects without mobile overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await installApiFixture(page)
  await page.goto("/route-advice")
  await expect(page).toHaveURL(/\/comparisons$/)
  await expect(page.getByLabel("选择渠道", { exact: true })).toBeVisible()
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(1)
})

test("adjustment dry-run requires explicit confirmation before execution", async ({ page }) => {
  const state = await installApiFixture(page)
  await page.goto("/adjustments")
  await expect(page).toHaveURL(/\/relay\?view=adjustments$/)
  await expect(page.getByRole("tab", { name: "倍率调整", exact: true })).toHaveAttribute("data-state", "active")
  await page.locator("#new-ratio").fill("0.7")
  await page.getByRole("button", { name: "生成预览" }).click()
  await expect(page.getByText("0.5 → 0.7")).toBeVisible()
  expect(state.adjustmentConfirmRequests).toBe(0)
  await page.getByRole("button", { name: "进入二次确认" }).click()
  await expect(page.getByRole("heading", { name: "二次确认调价" })).toBeVisible()
  expect(state.adjustmentConfirmRequests).toBe(0)
  await page.getByRole("button", { name: "确认执行" }).click()
  await expect.poll(() => state.adjustmentConfirmRequests).toBe(1)
})

test("adjustment gross margin persists and updates the suggested ratio", async ({ page }) => {
  const state = await installApiFixture(page)
  await page.goto("/adjustments")

  await expect(page.getByLabel("毛利率 (%)", { exact: true })).toHaveValue("20")
  await page.getByRole("button", { name: "采用建议倍率", exact: true }).click()
  await expect(page.locator("#new-ratio")).toHaveValue("0.625")

  await page.getByLabel("毛利率 (%)", { exact: true }).fill("25")
  await expect(page.locator("#new-ratio")).toHaveValue("0.666666667")
  await page.getByRole("button", { name: "保存毛利率", exact: true }).click()
  await expect.poll(() => state.adjustmentGrossMarginPct).toBe(25)
})

test("adjustment page stays within the mobile viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await installApiFixture(page)
  await page.goto("/adjustments")
  await expect(page.getByRole("tab", { name: "倍率调整", exact: true })).toHaveAttribute("data-state", "active")
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(1)
})
