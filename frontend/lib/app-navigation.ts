import {
  BadgeDollarSign,
  Bell,
  BellRing,
  Bot,
  GitCompareArrows,
  Gauge,
  HeartPulse,
  Network,
  Settings,
  ShieldCheck,
  Waypoints,
  type LucideIcon,
} from "lucide-react"
import type { ComponentType } from "react"

export type AppPageModule = { default: ComponentType }

export type NavigationSection = "overview" | "operations" | "control" | "costs" | "system"

export interface AppRouteDefinition {
  id: string
  href: string
  title: string
  description: string
  /** Short noun phrase used in the compact sidebar for routes that need extra context. */
  navHint?: string
  section: NavigationSection
  icon: LucideIcon
  exact?: boolean
  showInNavigation?: boolean
  load: () => Promise<AppPageModule>
}

export interface AppRedirectDefinition {
  from: string
  to: string
  reason: string
}

const page = (load: () => Promise<{ default: ComponentType }>): (() => Promise<AppPageModule>) => load

export const navigationSections: Array<{ id: NavigationSection; label: string }> = [
  { id: "overview", label: "总览" },
  { id: "operations", label: "运营" },
  { id: "control", label: "控制" },
  { id: "costs", label: "成本" },
  { id: "system", label: "系统" },
]

/**
 * The only source for SPA route metadata, navigation, breadcrumbs, and route registration.
 * Business pages stay in their existing modules until each later migration phase owns them.
 */
export const appRoutes: AppRouteDefinition[] = [
  {
    id: "overview",
    href: "/",
    title: "总览",
    description: "查看渠道健康、余额、成本和最近运营事实。",
    section: "overview",
    icon: Gauge,
    exact: true,
    load: page(() => import("@/app/page")),
  },
  {
    id: "channels",
    href: "/ops/channels",
    title: "上游管理",
    description: "管理渠道、账号凭据、收藏、同步和渠道级运营动作。",
    section: "operations",
    icon: Waypoints,
    load: page(() => import("@/app/ops-channels-page")),
  },
  {
    id: "observations",
    href: "/observations",
    title: "采集与健康",
    description: "兼容旧入口，打开告警动态中的采集与健康视图。",
    section: "operations",
    icon: HeartPulse,
    showInNavigation: false,
    load: page(() => import("@/app/observations-redirect-page")),
  },
  {
    id: "activity",
    href: "/activity",
    title: "告警动态",
    description: "集中查看告警、公告、采集事实和健康探测；倍率变动保留在总览。",
    section: "operations",
    icon: BellRing,
    load: page(() => import("@/app/activity-page")),
  },
  {
    id: "comparisons",
    href: "/comparisons",
    title: "分组倍率",
    description: "查看每条上游自己的分组倍率和变化历史。",
    section: "costs",
    icon: GitCompareArrows,
    load: page(() => import("@/app/comparisons-page")),
  },
  {
    id: "relay",
    href: "/relay",
    title: "上游同步",
    description: "把渠道账号同步到 Sub2API，管理同步分组、倍率和执行日志。",
    navHint: "同步到 Sub2API",
    section: "control",
    icon: Bot,
    load: page(() => import("@/app/upstream-sync-page")),
  },
  {
    id: "gateway",
    href: "/gateway",
    title: "API 转发",
    description: "给客户端提供统一 /v1 入口，配置上游路由、密钥和用量。",
    navHint: "给客户端提供 /v1",
    section: "control",
    icon: Network,
    load: page(() => import("@/app/gateway-page")),
  },
  {
    id: "usage-costs",
    href: "/usage-costs",
    title: "真实消费",
    description: "查看来自上游的真实请求、Token 和成本。",
    section: "costs",
    icon: BadgeDollarSign,
    load: page(() => import("@/app/usage-costs-page")),
  },
  {
    id: "model-prices-legacy",
    href: "/model-prices",
    title: "真实消费",
    description: "兼容旧版模型价格入口，实际展示真实消费页面。",
    section: "costs",
    icon: BadgeDollarSign,
    showInNavigation: false,
    load: page(() => import("@/app/usage-costs-page")),
  },
  {
    id: "notifications",
    href: "/notifications",
    title: "通知中心",
    description: "检查通知渠道、发送状态和最近失败。",
    section: "system",
    icon: Bell,
    load: page(() => import("@/app/notifications-page")),
  },
  {
    id: "captcha",
    href: "/captcha",
    title: "Captcha",
    description: "管理验证码 Provider 和余额状态。",
    section: "system",
    icon: ShieldCheck,
    showInNavigation: false,
    load: page(() => import("@/app/captcha-page")),
  },
  {
    id: "settings",
    href: "/settings",
    title: "系统设置",
    description: "管理鉴权、代理、通知策略、备份和生产检查。",
    section: "system",
    icon: Settings,
    load: page(() => import("@/app/settings-page")),
  },
]

export const appRedirects: AppRedirectDefinition[] = [
  {
    from: "/favorites",
    to: "/ops/channels?scope=favorites",
    reason: "收藏渠道是上游管理中的 Saved View，不保留重复一级页面。",
  },
  {
    from: "/context",
    to: "/ops/channels",
    reason: "决策上下文暂未形成跨域操作闭环，先回收为渠道运营入口。",
  },
  {
    from: "/route-advice",
    to: "/comparisons",
    reason: "路由建议只记录人工选择且不执行切流，合并到分组倍率分析入口。",
  },
  {
    from: "/adjustments",
    to: "/relay?view=adjustments",
    reason: "倍率调整属于上游同步的受控远端变更流程。",
  },
  {
    from: "/upstream-sync",
    to: "/relay",
    reason: "将历史 Upstream Sync 入口提升为上游同步一级领域。",
  },
]

export const visibleNavigation = appRoutes.filter((route) => route.showInNavigation !== false)

export function findAppRoute(pathname: string): AppRouteDefinition | null {
  const exact = appRoutes.find((route) => route.exact && pathname === route.href)
  if (exact) return exact

  return (
    [...appRoutes]
      .filter((route) => !route.exact && pathname === route.href || (!route.exact && pathname.startsWith(`${route.href}/`)))
      .sort((a, b) => b.href.length - a.href.length)[0] ?? null
  )
}

export function findSectionLabel(section: NavigationSection): string {
  return navigationSections.find((item) => item.id === section)?.label ?? ""
}
