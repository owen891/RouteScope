import { Suspense, useEffect, useState } from "react"
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom"
import { useTheme } from "next-themes"
import { ExternalLink, LogOut, Menu, Moon, PanelLeftClose, PanelLeftOpen, RefreshCw, Sun, User } from "lucide-react"
import { useAuth } from "@/lib/auth-context"
import { useAppVersion } from "@/lib/queries"
import { useTriggerRefresh } from "@/lib/refresh-context"
import { appRedirects, findAppRoute, findSectionLabel, navigationSections, visibleNavigation, type AppRouteDefinition } from "@/lib/app-navigation"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { PRODUCT_NAME, PRODUCT_TITLE_CHANGED_EVENT, productDocumentTitle } from "@/lib/product-brand"
import { BrandMark } from "@/components/brand-mark"

type ReleaseLineKind = "feature" | "fix" | "note"

type ReleaseNote = {
  id: string
  version: string
  title?: string
  publishedAt: string
  href: string
  items: Array<{
    kind: ReleaseLineKind
    text: string
  }>
}

const SIDEBAR_COLLAPSED_STORAGE_KEY = "routescope.sidebar.collapsed"

const LOCAL_RELEASE_NOTES: ReleaseNote[] = [
  {
    id: "v0.1.0",
    version: "0.1.0",
    title: "此版本是我们的 Local Ops 基线版，把核心功能全部对齐到同一个控制台里。",
    publishedAt: "2026-07-31",
    href: "https://github.com/owen891/RouteScope",
    items: [
      { kind: "feature", text: "统一控制平台：集中管理 NewAPI、Sub2API、Upstream Sync 和 Gateway。" },
      { kind: "feature", text: "渠道管理：支持新增、编辑、启停、鉴权、代理测试、充值与账户巡检。" },
      { kind: "feature", text: "监控总览：集中查看余额、汇率、公告、订阅、失败状态和成本波动。" },
      { kind: "feature", text: "Gateway 运行能力：提供模型映射、路由策略、访问控制、转发链路和用量统计。" },
      { kind: "feature", text: "决策与上下文视图：整合可用性、成本、健康度和策略信息，辅助运维判断。" },
      { kind: "feature", text: "通知中心：支持 Telegram、飞书、钉钉、QQ Bot、邮件、Webhook 等告警投递。" },
      { kind: "feature", text: "Captcha 与外部集成：支持多家 Captcha 供应商与余额检查，减少自动化任务中断。" },
      { kind: "feature", text: "运行时配置热更新：认证、代理、通知和调度策略可在线生效，降低变更成本。" },
      { kind: "note", text: "部署与数据：继续兼容 SQLite / MySQL，主发布形态保持 Docker Compose 单体容器。" },
      { kind: "fix", text: "控制平台壳层重做：侧栏账号、登出、版本入口和更新说明弹窗已统一整理。" },
    ],
  },
]

function readSidebarCollapsed() {
  if (typeof window === "undefined") return false
  try {
    return window.localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === "true"
  } catch {
    return false
  }
}

function normalizeVersion(value?: string | null) {
  return value?.trim().replace(/^v/i, "") ?? ""
}

function formatVersion(value?: string | null) {
  const normalized = normalizeVersion(value)
  return normalized ? `v${normalized}` : "未检测"
}

function formatReleaseDate(value?: string | null) {
  if (!value) return "未知日期"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "未知日期"
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

function RouteLink({
  route,
  onNavigate,
  collapsed = false,
}: {
  route: AppRouteDefinition
  onNavigate?: () => void
  collapsed?: boolean
}) {
  const Icon = route.icon
  return (
    <NavLink
      to={route.href}
      end={route.exact}
      onClick={onNavigate}
      title={collapsed ? route.title : undefined}
      className={({ isActive }) => cn(
        "group flex min-h-9 items-center rounded-md text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        collapsed
          ? "mx-auto size-9 justify-center border border-transparent px-0"
          : "gap-2 border-l-2 border-transparent px-3",
        isActive
          ? collapsed
            ? "border-brand/30 bg-brand/10 font-medium text-brand"
            : "border-brand bg-brand/10 font-medium text-brand"
          : "text-muted-foreground hover:bg-sidebar-accent/70 hover:text-foreground",
      )}
      aria-label={route.title}
    >
      <Icon className="size-4 shrink-0" aria-hidden="true" />
      {collapsed ? null : (
        <span className="min-w-0 truncate">
          <span className="block truncate">{route.title}</span>
          {route.navHint ? <span className="block truncate text-[10px] font-normal opacity-70">{route.navHint}</span> : null}
        </span>
      )}
    </NavLink>
  )
}

function SidebarToggleButton({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  return (
    <TooltipProvider delayDuration={250}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="size-8 rounded-md border border-transparent p-0 text-sidebar-foreground hover:border-sidebar-border hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            aria-label={collapsed ? "展开侧边栏" : "收起侧边栏"}
            aria-expanded={!collapsed}
            aria-controls="desktop-sidebar"
            data-testid="sidebar-toggle"
            title={collapsed ? "展开侧边栏" : "收起侧边栏"}
            onClick={onToggle}
          >
            {collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="right">{collapsed ? "展开侧边栏" : "收起侧边栏"}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

function Navigation({ onNavigate, collapsed = false }: { onNavigate?: () => void; collapsed?: boolean }) {
  return (
    <nav aria-label="主导航" className={cn("space-y-5", collapsed && "space-y-3")}>
      {navigationSections.map((section) => {
        const routes = visibleNavigation.filter((route) => route.section === section.id)
        if (routes.length === 0) return null
        return (
          <div key={section.id} className="space-y-1">
            {!collapsed && section.id !== "overview" ? <p className="px-3 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">{section.label}</p> : null}
            {routes.map((route) => <RouteLink key={route.id} route={route} onNavigate={onNavigate} collapsed={collapsed} />)}
          </div>
        )
      })}
    </nav>
  )
}

function IconButton({ label, children, onClick, disabled }: { label: string; children: React.ReactNode; onClick?: () => void; disabled?: boolean }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button type="button" variant="ghost" size="icon-sm" aria-label={label} title={label} onClick={onClick} disabled={disabled}>
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

export function ControlPlaneShell() {
  return <ModernControlPlaneShell />
}

function ModernControlPlaneShell() {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const { theme, setTheme } = useTheme()
  const { username, authDisabled, logout } = useAuth()
  const refresh = useTriggerRefresh()
  const appVersion = useAppVersion()
  const [menuOpen, setMenuOpen] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [versionDialogOpen, setVersionDialogOpen] = useState(false)
  const [savedAppTitle, setSavedAppTitle] = useState("")
  const [sidebarCollapsed, setSidebarCollapsed] = useState(readSidebarCollapsed)

  const route = findAppRoute(pathname)
  const sectionLabel = route ? findSectionLabel(route.section) : ""
  const version = appVersion.data?.version?.trim() || "0.1.0"
  const repoURL = appVersion.data?.repo_url?.trim() || "https://github.com/owen891/RouteScope"
  const currentVersionTag = formatVersion(version)

  useEffect(() => setMounted(true), [])

  function toggleSidebar() {
    setSidebarCollapsed((current) => {
      const next = !current
      try {
        window.localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, String(next))
      } catch {
        // Ignore storage failures; the in-memory toggle still works.
      }
      return next
    })
  }

  useEffect(() => {
    const handleTitleChanged = (event: Event) => {
      const title = (event as CustomEvent<string>).detail?.trim()
      setSavedAppTitle(title || PRODUCT_NAME)
    }
    window.addEventListener(PRODUCT_TITLE_CHANGED_EVENT, handleTitleChanged)
    return () => window.removeEventListener(PRODUCT_TITLE_CHANGED_EVENT, handleTitleChanged)
  }, [])

  const appTitle = savedAppTitle || appVersion.data?.title?.trim() || PRODUCT_NAME

  useEffect(() => {
    document.title = productDocumentTitle(route?.title, appTitle)
  }, [appTitle, route])

  const isDark = mounted && theme === "dark"

  function handleRefresh() {
    setRefreshing(true)
    refresh()
    window.setTimeout(() => setRefreshing(false), 800)
  }

  function openVersionDialog(onAfterAction?: () => void) {
    onAfterAction?.()
    setVersionDialogOpen(true)
  }

  function renderSidebarFooter(onAfterAction?: () => void, collapsed = false) {
    const accountLabel = authDisabled
      ? "账号：本地管理员"
      : `账号：${username || "管理员"}`
    const accountName = authDisabled ? "本地管理员" : username || "管理员"

    return (
      <TooltipProvider delayDuration={250}>
        <div className={cn("flex items-center gap-1", collapsed ? "flex-col" : "min-w-0")}>
          <Button
            type="button"
            variant="ghost"
            className={cn(
              "rounded-md hover:bg-sidebar-accent/70",
              collapsed ? "size-9 justify-center p-0" : "h-auto min-w-0 flex-1 justify-start gap-2 px-2 py-2 text-left",
            )}
            aria-label={accountLabel}
            title={accountLabel}
            onClick={() => { onAfterAction?.(); navigate("/settings") }}
          >
            <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-sidebar-accent text-sidebar-accent-foreground">
              <User className="size-4" aria-hidden="true" />
            </span>
            {collapsed ? null : (
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium text-sidebar-foreground">{accountName}</span>
                <span className="block truncate text-[11px] text-muted-foreground">账号设置</span>
              </span>
            )}
          </Button>
          {!authDisabled ? (
            <IconButton label={`登出${username ? `：${username}` : ""}`} onClick={() => { onAfterAction?.(); logout() }}>
              <LogOut />
            </IconButton>
          ) : null}
        </div>
      </TooltipProvider>
    )
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="flex min-h-screen">
        <aside
          id="desktop-sidebar"
          data-sidebar-collapsed={sidebarCollapsed}
          className={cn(
            "sticky top-0 hidden h-screen shrink-0 border-r border-sidebar-border bg-sidebar transition-[width] duration-200 ease-in-out lg:flex lg:flex-col",
            sidebarCollapsed ? "w-[4.5rem]" : "w-64",
          )}
        >
          <div className={cn("flex h-16 items-center border-b border-sidebar-border", sidebarCollapsed ? "justify-center px-2" : "gap-2 px-4")}>
            <div className="flex min-w-0 items-center gap-2">
              <BrandMark className={cn(sidebarCollapsed ? "size-8" : "size-10")} />
              {sidebarCollapsed ? null : (
                <div className="min-w-0">
                  <h1 className="truncate text-base font-semibold text-sidebar-foreground">{appTitle}</h1>
                </div>
              )}
            </div>
          </div>
          <div className="flex min-h-0 flex-1">
            <div className={cn("min-w-0 flex-1 overflow-y-auto", sidebarCollapsed ? "px-2 py-3" : "px-3 py-5")}>
              {sidebarCollapsed ? (
                <div className="mb-3 flex justify-center">
                  <SidebarToggleButton collapsed={sidebarCollapsed} onToggle={toggleSidebar} />
                </div>
              ) : null}
              <Navigation collapsed={sidebarCollapsed} />
            </div>
            {!sidebarCollapsed ? (
              <div className="w-10 shrink-0 pt-2">
                <SidebarToggleButton collapsed={sidebarCollapsed} onToggle={toggleSidebar} />
              </div>
            ) : null}
          </div>
          <div className={cn("border-t border-sidebar-border", sidebarCollapsed ? "p-2" : "p-3")}>
            {renderSidebarFooter(undefined, sidebarCollapsed)}
          </div>
        </aside>

        <div className="min-w-0 flex-1">
          <header className="sticky top-0 z-30 border-b border-border bg-background/95 backdrop-blur-sm">
            <div className="mx-auto flex min-h-14 max-w-[120rem] items-center gap-2 px-3 py-2 sm:px-6 lg:px-8">
              <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
                <SheetTrigger asChild>
                  <Button type="button" variant="ghost" size="icon-sm" className="lg:hidden" aria-label="打开导航" title="打开导航"><Menu /></Button>
                </SheetTrigger>
                <SheetContent side="left" className="w-[min(86vw,20rem)] bg-sidebar px-0">
                  <SheetHeader className="border-b border-sidebar-border px-5 pb-4">
                    <SheetTitle className="flex items-center gap-2 text-left"><BrandMark className="size-7" />{appTitle}</SheetTitle>
                  </SheetHeader>
                  <div className="min-h-0 flex-1 overflow-y-auto px-3 py-5"><Navigation onNavigate={() => setMenuOpen(false)} /></div>
                  <div className="mt-auto border-t border-sidebar-border p-3">{renderSidebarFooter(() => setMenuOpen(false))}</div>
                </SheetContent>
              </Sheet>

              <div className="flex min-w-0 flex-1 items-center gap-2">
                <BrandMark className="size-7 lg:hidden" />
                <span className="min-w-0 max-w-[9rem] truncate text-sm font-semibold text-foreground lg:hidden" title={appTitle}>{appTitle}</span>
                <span className="hidden shrink-0 text-muted-foreground sm:inline lg:hidden">/</span>
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-2">
                    <h1 className="sr-only sm:not-sr-only sm:truncate sm:text-sm sm:font-medium sm:text-foreground">
                      {route?.title ?? "控制台"}
                    </h1>
                    {route && sectionLabel !== route.title ? <span className="hidden shrink-0 text-xs font-normal text-muted-foreground sm:inline">{sectionLabel}</span> : null}
                  </div>
                  {route?.description ? <p className="hidden truncate text-[11px] text-muted-foreground sm:block">{route.description}</p> : null}
                </div>
              </div>

              <TooltipProvider delayDuration={250}>
                <IconButton label="刷新数据" onClick={handleRefresh} disabled={refreshing}><RefreshCw className={cn(refreshing && "animate-spin")} /></IconButton>
                <IconButton label={isDark ? "切换到浅色主题" : "切换到深色主题"} onClick={() => setTheme(isDark ? "light" : "dark")}><>{isDark ? <Sun /> : <Moon />}</></IconButton>
              </TooltipProvider>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 shrink-0 gap-1.5 rounded-md px-2.5 text-xs font-medium text-muted-foreground hover:text-foreground"
                aria-label={`版本信息 ${currentVersionTag}`}
                title={`版本信息 ${currentVersionTag}`}
                onClick={() => openVersionDialog()}
              >
                <span className="size-1.5 rounded-full bg-emerald-500" aria-hidden="true" />
                {currentVersionTag}
              </Button>
            </div>
          </header>
          <main className="mx-auto w-full max-w-[120rem] space-y-4 px-3 py-4 pb-8 sm:space-y-5 sm:px-6 sm:py-5 lg:px-8">
            <Suspense
              fallback={(
                <div className="space-y-3" aria-live="polite" aria-busy="true">
                  <div className="h-6 w-40 animate-pulse rounded bg-muted" />
                  <div className="h-28 animate-pulse rounded-md border border-border bg-muted/30" />
                  <span className="sr-only">加载页面...</span>
                </div>
              )}
            >
              <Outlet />
            </Suspense>
          </main>
        </div>
      </div>

      <Dialog open={versionDialogOpen} onOpenChange={setVersionDialogOpen}>
        <DialogContent className="flex max-h-[min(82dvh,38rem)] w-[calc(100vw-1.5rem)] max-w-xl flex-col gap-0 overflow-hidden p-0 sm:max-w-xl">
          <DialogHeader className="border-b border-border px-5 py-4 pr-12 text-left">
            <DialogTitle className="text-base">RouteScope 版本信息</DialogTitle>
            <DialogDescription>本地发布版本与功能更新记录。</DialogDescription>
          </DialogHeader>

          <div className="grid shrink-0 grid-cols-2 border-b border-border">
            <div className="px-5 py-3.5">
              <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">当前版本</p>
              <p className="mt-1 text-xl font-semibold">{currentVersionTag}</p>
            </div>
            <div className="border-l border-border px-5 py-3.5">
              <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">发布状态</p>
              <p className="mt-1 flex items-center gap-2 text-sm font-medium">
                <span className="size-1.5 rounded-full bg-emerald-500" aria-hidden="true" />
                本地发布
              </p>
            </div>
          </div>

          <ScrollArea className="min-h-0 flex-1">
            <div className="space-y-5 px-5 py-4">
              {LOCAL_RELEASE_NOTES.map((release) => {
                const isCurrent = normalizeVersion(release.version) === normalizeVersion(version)

                return (
                  <section key={release.id}>
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <a
                        href={release.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-sm font-semibold text-foreground transition-colors hover:text-brand"
                      >
                        {formatVersion(release.version)}
                        <ExternalLink className="size-3.5" />
                      </a>
                      <span className="text-xs text-muted-foreground">{formatReleaseDate(release.publishedAt)}</span>
                      {isCurrent ? <span className="text-xs text-emerald-600 dark:text-emerald-400">当前版本</span> : null}
                    </div>
                    {release.title ? <p className="mt-1.5 text-sm leading-5 text-muted-foreground">{release.title}</p> : null}
                    <ul className="mt-3 grid gap-y-2">
                      {release.items.map((line, lineIndex) => (
                        <li key={`${release.id}-${lineIndex}`} className="flex min-w-0 items-start gap-2 text-sm leading-5 text-foreground/90">
                          <span
                            className={cn(
                              "mt-1.5 size-1.5 shrink-0 rounded-full",
                              line.kind === "feature" && "bg-emerald-500",
                              line.kind === "fix" && "bg-amber-500",
                              line.kind === "note" && "bg-slate-400",
                            )}
                            aria-hidden="true"
                          />
                          <span>{line.text}</span>
                        </li>
                      ))}
                    </ul>
                  </section>
                )
              })}
            </div>
          </ScrollArea>

          <DialogFooter className="shrink-0 border-t border-border px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
            <Button type="button" variant="ghost" size="sm" className="justify-start px-2 text-muted-foreground" asChild>
              <a href={repoURL} target="_blank" rel="noopener noreferrer">
                项目仓库
                <ExternalLink className="size-3.5" />
              </a>
            </Button>
            <Button type="button" size="sm" className="rounded-md px-4" onClick={() => setVersionDialogOpen(false)}>关闭</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="sr-only" aria-live="polite">{appRedirects.length} 个旧入口保持兼容</div>
    </div>
  )
}
