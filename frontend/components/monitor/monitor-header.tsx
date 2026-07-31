import { useEffect, useMemo, useState } from "react"
import { useLocation, useNavigate } from "react-router-dom"
import { useTheme } from "next-themes"
import {
  Activity,
  BadgeDollarSign,
  Github,
  GitCompareArrows,
  Ellipsis,
  Home,
  LogOut,
  Menu,
  Moon,
  Network,
  RefreshCw,
  Settings,
  Star,
  Sun,
  type LucideIcon,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { useAuth } from "@/lib/auth-context"
import { apiFetch } from "@/lib/api"
import { useTriggerRefresh } from "@/lib/refresh-context"
import { useAppVersion, useChannels } from "@/lib/queries"
import type { AppVersion } from "@/lib/api-types"
import { relativeTime } from "@/lib/format"
import { PRODUCT_NAME, productDocumentTitle } from "@/lib/product-brand"
import { toast } from "sonner"

type NavItem = {
  label: string
  path: string
  icon: LucideIcon
  exact?: boolean
}

const overviewItem: NavItem = {
  label: "总览",
  path: "/",
  icon: Home,
  exact: true,
}

const savedChannelsItem: NavItem = {
  label: "收藏",
  path: "/ops/channels?scope=favorites",
  icon: Star,
}

const usageCostsItem: NavItem = {
  label: "真实消费",
  path: "/usage-costs",
  icon: BadgeDollarSign,
}

const healthItem: NavItem = {
  label: "采集与健康",
  path: "/activity?view=observations",
  icon: Activity,
}

const comparisonsItem: NavItem = {
  label: "分组倍率",
  path: "/comparisons",
  icon: GitCompareArrows,
}

const gatewayItem: NavItem = {
  label: "API 转发",
  path: "/gateway",
  icon: Network,
}

const settingsItem: NavItem = {
  label: "系统设置",
  path: "/settings",
  icon: Settings,
}

function isRouteActive(pathname: string, target: string, exact = false) {
  return exact
    ? pathname === target
    : pathname === target || pathname.startsWith(`${target}/`)
}

function routeButtonClass(active: boolean) {
  return cn(
    "h-8 gap-1.5 px-2.5 text-xs font-medium",
    active
      ? "bg-accent text-accent-foreground"
      : "text-muted-foreground hover:bg-muted hover:text-foreground",
  )
}

function routeMenuItemClass(active: boolean) {
  return cn(active && "bg-accent text-accent-foreground")
}

export function MonitorHeader() {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const { theme, setTheme } = useTheme()
  const { username, authDisabled, logout } = useAuth()
  const refresh = useTriggerRefresh()
  const channels = useChannels()
  const appVersion = useAppVersion()
  const [mounted, setMounted] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [checkingVersion, setCheckingVersion] = useState(false)

  const appTitle = appVersion.data?.title?.trim() || PRODUCT_NAME
  const version = appVersion.data?.version?.trim()
  const latestVersion = appVersion.data?.latest_version?.trim()
  const updateAvailable = Boolean(appVersion.data?.update_available && latestVersion)
  const updateURL = appVersion.data?.release_url?.trim() || appVersion.data?.repo_url?.trim()

  useEffect(() => setMounted(true), [])

  useEffect(() => {
    document.title = productDocumentTitle(undefined, appTitle)
  }, [appTitle])

  /**
   * 找出所有渠道中最近一次采集时间——这是“上次采集”展示的依据，
   * 让用户知道页面上的余额到底是多新的快照（区别于“我刚点了刷新”）。
   */
  const lastCollectedAt = useMemo(() => {
    const list = channels.data ?? []
    let best: string | null = null
    let bestT = -Infinity
    for (const channel of list) {
      if (!channel.last_balance_at) continue
      const collectedAt = new Date(channel.last_balance_at).getTime()
      if (Number.isFinite(collectedAt) && collectedAt > bestT) {
        bestT = collectedAt
        best = channel.last_balance_at
      }
    }
    return best
  }, [channels.data])

  const favoriteCount = useMemo(
    () => (channels.data ?? []).filter((channel) => channel.favorite).length,
    [channels.data],
  )

  function handleRefresh() {
    setSyncing(true)
    refresh()
    setTimeout(() => setSyncing(false), 800)
  }

  async function handleCheckVersion() {
    setCheckingVersion(true)
    try {
      const result = await apiFetch<AppVersion>("/version?force=1")
      appVersion.setData(result)
      if (result.update_error) {
        toast.error(result.update_error)
      } else if (result.update_available && result.latest_version) {
        toast.warning(`发现新版本 ${result.latest_version}`)
      } else {
        toast.success("当前已是最新版本")
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "检测更新失败")
    } finally {
      setCheckingVersion(false)
    }
  }

  const isDark = mounted && theme === "dark"

  function renderRouteMenuItem(item: NavItem) {
    const Icon = item.icon
    const active = isRouteActive(pathname, item.path, item.exact)

    return (
      <DropdownMenuItem
        key={item.path}
        onSelect={() => navigate(item.path)}
        className={routeMenuItemClass(active)}
        aria-current={active ? "page" : undefined}
      >
        <Icon className="size-4" />
        <span>{item.label}</span>
      </DropdownMenuItem>
    )
  }

  return (
    <header className="sticky top-0 z-20 border-b border-border bg-background/95 backdrop-blur-sm">
      <div className="mx-auto flex h-12 max-w-[120rem] items-center gap-2 px-3 sm:h-14 sm:px-6 lg:px-8">
        <div className="flex min-w-0 shrink-0 items-center gap-2 sm:gap-2.5 lg:max-w-56 xl:max-w-72">
          <div className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-foreground text-background sm:size-8">
            <Activity className="size-3.5 sm:size-4" strokeWidth={2.5} />
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-sm font-semibold tracking-tight text-foreground sm:text-base">
              {appTitle}
            </h1>
            {version ? (
              <p className="truncate text-[10px] leading-3 text-muted-foreground sm:text-[11px]">
                <button
                  type="button"
                  className="font-medium underline-offset-2 hover:text-foreground hover:underline"
                  onClick={handleCheckVersion}
                  disabled={checkingVersion}
                  title="点击检测更新"
                >
                  {checkingVersion ? "检测中..." : `v${version}`}
                </button>
                {updateAvailable ? (
                  <a
                    href={updateURL || "https://github.com/owen891/RouteScope"}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="ml-1.5 font-medium text-emerald-600 underline-offset-2 hover:text-emerald-700 hover:underline sm:ml-2"
                  >
                    有新版本 {latestVersion}
                  </a>
                ) : null}
              </p>
            ) : null}
          </div>
        </div>

        <nav
          aria-label="主导航"
          className="hidden min-w-0 flex-1 items-center justify-center gap-1 lg:flex"
        >
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate(overviewItem.path)}
            className={routeButtonClass(isRouteActive(pathname, overviewItem.path, true))}
            aria-current={isRouteActive(pathname, overviewItem.path, true) ? "page" : undefined}
          >
            <Home className="size-3.5" />
            总览
          </Button>

          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate(savedChannelsItem.path)}
            className={routeButtonClass(isRouteActive(pathname, "/ops/channels"))}
            aria-label="收藏渠道"
            aria-current={isRouteActive(pathname, "/ops/channels") ? "page" : undefined}
          >
            <Star className="size-3.5" />
            收藏
            {favoriteCount > 0 ? (
              <span className="inline-flex min-w-4 items-center justify-center rounded-full bg-primary/10 px-1 text-[10px] font-semibold leading-4 text-primary">
                {favoriteCount > 99 ? "99+" : favoriteCount}
              </span>
            ) : null}
          </Button>

          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate(usageCostsItem.path)}
            className={routeButtonClass(isRouteActive(pathname, usageCostsItem.path))}
            aria-current={isRouteActive(pathname, usageCostsItem.path) ? "page" : undefined}
          >
            <BadgeDollarSign className="size-3.5" />
            真实消费
          </Button>

          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate(healthItem.path)}
            className={routeButtonClass(isRouteActive(pathname, healthItem.path))}
            aria-current={isRouteActive(pathname, healthItem.path) ? "page" : undefined}
          >
            <Activity className="size-3.5" />
            采集健康
          </Button>

          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate(comparisonsItem.path)}
            className={routeButtonClass(isRouteActive(pathname, comparisonsItem.path))}
            aria-current={isRouteActive(pathname, comparisonsItem.path) ? "page" : undefined}
          >
            <GitCompareArrows className="size-3.5" />
            分组倍率
          </Button>

          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate(settingsItem.path)}
            className={routeButtonClass(isRouteActive(pathname, settingsItem.path))}
            aria-label="系统设置"
            aria-current={isRouteActive(pathname, settingsItem.path) ? "page" : undefined}
          >
            <Settings className="size-3.5" />
            设置
          </Button>

          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate(gatewayItem.path)}
            className={routeButtonClass(isRouteActive(pathname, gatewayItem.path))}
            aria-label="API 转发（独立扩展）"
            aria-current={isRouteActive(pathname, gatewayItem.path) ? "page" : undefined}
            title="为客户端提供统一 API 地址，与 Sub2API 同步无关"
          >
            <Network className="size-3.5" />
            API 转发
          </Button>
        </nav>

        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          <div className="hidden items-center gap-2 lg:flex">
            <span className="hidden whitespace-nowrap text-xs text-muted-foreground 2xl:inline">
              上次采集{" "}
              <span className="font-medium text-foreground">{relativeTime(lastCollectedAt)}</span>
            </span>
            <Tooltip delayDuration={200}>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="icon-sm"
                  onClick={handleRefresh}
                  disabled={syncing}
                  className="border-border bg-background text-foreground hover:bg-muted"
                  aria-label="刷新视图"
                >
                  <RefreshCw className={cn("size-3.5", syncing && "animate-spin")} />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-xs text-xs">
                <p>重新拉取最新的快照数据。</p>
                <p className="mt-1 text-muted-foreground">
                  提示：实际采集由后台定时任务执行，如需立即采集请到具体渠道点“同步”。
                </p>
              </TooltipContent>
            </Tooltip>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="icon-sm"
                  className="border-border bg-background text-foreground hover:bg-muted"
                  aria-label="工具菜单"
                >
                  <Ellipsis className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel className="font-normal">
                  <p className="font-medium text-foreground">
                    {authDisabled ? "本地管理员" : username || "管理员"}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    上次采集 {relativeTime(lastCollectedAt)}
                  </p>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <a
                    href="https://github.com/owen891/RouteScope"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <Github className="size-4" />
                    GitHub 仓库
                  </a>
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setTheme(isDark ? "light" : "dark")}>
                  {isDark ? <Moon className="size-4" /> : <Sun className="size-4" />}
                  {isDark ? "切换浅色主题" : "切换深色主题"}
                </DropdownMenuItem>
                {authDisabled ? null : (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onSelect={logout}>
                      <LogOut className="size-4" />
                      退出登录
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <Button
            variant="outline"
            size="icon-sm"
            onClick={handleRefresh}
            disabled={syncing}
            className="border-border bg-background text-foreground hover:bg-muted lg:hidden"
            aria-label="刷新视图"
          >
            <RefreshCw className={cn("size-3.5", syncing && "animate-spin")} />
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="icon-sm"
                className="border-border bg-background text-foreground hover:bg-muted lg:hidden"
                aria-label="打开导航菜单"
              >
                <Menu className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              <DropdownMenuLabel className="font-normal">
                <p className="font-medium text-foreground">导航</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  上次采集 {relativeTime(lastCollectedAt)}
                </p>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              {renderRouteMenuItem(overviewItem)}
              {renderRouteMenuItem(savedChannelsItem)}
              {renderRouteMenuItem(usageCostsItem)}

              <DropdownMenuLabel className="pb-1 pt-2 text-[11px] font-medium text-muted-foreground">
                上游管理与健康
              </DropdownMenuLabel>
              {renderRouteMenuItem(healthItem)}
              {renderRouteMenuItem(comparisonsItem)}

              {renderRouteMenuItem(settingsItem)}
              <DropdownMenuLabel className="pb-1 pt-2 text-[11px] font-medium text-muted-foreground">
                独立扩展 · 非 Sub2API 同步
              </DropdownMenuLabel>
              {renderRouteMenuItem(gatewayItem)}

              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <a
                  href="https://github.com/owen891/RouteScope"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <Github className="size-4" />
                  GitHub 仓库
                </a>
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setTheme(isDark ? "light" : "dark")}>
                {isDark ? <Moon className="size-4" /> : <Sun className="size-4" />}
                {isDark ? "切换浅色主题" : "切换深色主题"}
              </DropdownMenuItem>
              {authDisabled ? null : (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={logout}>
                    <LogOut className="size-4" />
                    {username ? `${username} · 退出` : "退出登录"}
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  )
}
