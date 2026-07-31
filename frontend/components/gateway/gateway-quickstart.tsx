import { useMemo, useState } from "react"
import {
  CheckCircle2,
  Circle,
  Copy,
  HelpCircle,
  KeyRound,
  ListChecks,
  Network,
  RefreshCw,
  Route,
  ServerCog,
} from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { copyText } from "@/lib/clipboard"
import { cn } from "@/lib/utils"

type GatewayQuickstartProps = {
  providerCount?: number
  groupCount: number
  routeCount: number
  keyCount: number
  clientKey?: string
  refreshing: boolean
  onOpenProviders: () => void
  onOpenGroups: () => void
  onOpenRoutes: () => void
  onOpenKeys: () => void
  onOpenUsage: () => void
  onRefresh: () => void
}

type Step = {
  title: string
  description: string
  done: boolean
  action: string
  onClick: () => void
  icon: typeof ServerCog
  stayOpen?: boolean
}

async function copyValue(value: string, label: string) {
  await copyText(value)
  toast.success(label + "已复制")
}

export function GatewayQuickstart({
  providerCount,
  groupCount,
  routeCount,
  keyCount,
  clientKey,
  refreshing,
  onOpenProviders,
  onOpenGroups,
  onOpenRoutes,
  onOpenKeys,
  onOpenUsage,
  onRefresh,
}: GatewayQuickstartProps) {
  const [open, setOpen] = useState(false)
  const origin = typeof window === "undefined" ? "http://你的-控制台地址" : window.location.origin
  const apiBaseURL = origin + "/v1"
  const usableClientKey = clientKey?.startsWith("sk-") ? clientKey : ""
  const curlKey = usableClientKey || "<在客户端密钥中复制的 sk-* Key>"

  const modelsCurl = useMemo(
    () => ['curl "' + apiBaseURL + '/models"', '-H "Authorization: Bearer ' + curlKey + '"'].join(" "),
    [apiBaseURL, curlKey],
  )
  const chatCurl = useMemo(() => {
    const payload = JSON.stringify({
      model: "gpt-5.4-mini",
      messages: [{ role: "user", content: "只回复 OK" }],
      stream: false,
    })
    return [
      'curl "' + apiBaseURL + '/chat/completions"',
      '-H "Authorization: Bearer ' + curlKey + '"',
      '-H "Content-Type: application/json"',
      "-d '" + payload + "'",
    ].join(" ")
  }, [apiBaseURL, curlKey])

  function openWorkspace(action: () => void) {
    setOpen(false)
    action()
  }

  const providerReady = providerCount == null ? routeCount > 0 : providerCount > 0
  const steps: Step[] = [
    {
      title: "添加上游连接",
      description: "保存可用于模型调用的 sk-* 推理 Key。",
      done: providerReady,
      action: providerReady ? "查看" : "添加",
      onClick: onOpenProviders,
      icon: ServerCog,
    },
    {
      title: "创建网关组",
      description: "建立客户端统一访问入口。",
      done: groupCount > 0,
      action: groupCount > 0 ? "查看" : "创建",
      onClick: onOpenGroups,
      icon: Network,
    },
    {
      title: "添加路由",
      description: "把网关组连接到上游并设置故障切换。",
      done: routeCount > 0,
      action: routeCount > 0 ? "检查" : "添加",
      onClick: onOpenRoutes,
      icon: Route,
    },
    {
      title: "生成客户端 Key",
      description: "供 OpenAI 兼容客户端访问本地 /v1。",
      done: keyCount > 0,
      action: usableClientKey ? "复制" : keyCount > 0 ? "查看" : "生成",
      onClick: usableClientKey
        ? () => void copyValue(usableClientKey, "客户端 Key")
        : onOpenKeys,
      icon: KeyRound,
      stayOpen: Boolean(usableClientKey),
    },
  ]
  const completed = steps.filter((step) => step.done).length

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          size="icon-sm"
          variant="ghost"
          className="shrink-0"
          aria-label="API 转发接入指南"
          title="API 转发接入指南"
        >
          <HelpCircle className="size-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="max-h-[min(42rem,calc(100vh-2rem))] w-[min(30rem,calc(100vw-2rem))] overflow-y-auto p-0"
      >
        <div className="border-b border-border p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-foreground">API 转发接入指南</p>
              <p className="mt-1 text-xs text-muted-foreground">
                上游连接 → 网关组 → 路由 → 客户端 Key
              </p>
            </div>
            <Badge variant="outline" className="shrink-0 border-primary/25 bg-primary/[0.06] text-primary">
              {completed}/4
            </Badge>
          </div>

          <div className="mt-3 rounded-md border border-border bg-muted/40 p-3 text-xs">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-muted-foreground">Base URL</p>
                <code className="mt-1 block truncate font-medium text-foreground">{apiBaseURL}</code>
              </div>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label="复制 Base URL"
                onClick={() => void copyValue(apiBaseURL, "Base URL")}
              >
                <Copy className="size-3.5" />
              </Button>
            </div>
            <p className={cn(
              "mt-2",
              usableClientKey
                ? "text-emerald-700 dark:text-emerald-300"
                : "text-amber-700 dark:text-amber-300",
            )}>
              客户端 Key：{usableClientKey ? "已生成" : "未生成"}
            </p>
          </div>
        </div>

        <div className="space-y-2 p-4">
          {steps.map((step, index) => {
            const Icon = step.icon
            return (
              <div key={step.title} className="flex items-center gap-3 rounded-md border border-border p-3">
                <span className={cn(
                  "flex size-8 shrink-0 items-center justify-center rounded-md",
                  step.done
                    ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                    : "bg-muted text-muted-foreground",
                )}>
                  <Icon className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 text-xs font-medium text-foreground">
                    {step.done ? (
                      <CheckCircle2 className="size-3.5 text-emerald-600" />
                    ) : (
                      <Circle className="size-3.5 text-muted-foreground" />
                    )}
                    {index + 1}. {step.title}
                  </div>
                  <p className="mt-1 text-[11px] leading-4 text-muted-foreground">{step.description}</p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 shrink-0 px-2.5 text-xs"
                  onClick={() => {
                    if (step.stayOpen) {
                      step.onClick()
                      return
                    }
                    openWorkspace(step.onClick)
                  }}
                >
                  {step.action}
                </Button>
              </div>
            )
          })}

          <div className="grid grid-cols-2 gap-2 pt-1">
            <Button size="sm" variant="outline" onClick={() => void copyValue(modelsCurl, "/models 测试命令")}>
              <Copy className="size-3.5" /> /models 命令
            </Button>
            <Button size="sm" variant="outline" onClick={() => void copyValue(chatCurl, "聊天测试命令")}>
              <Copy className="size-3.5" /> 聊天命令
            </Button>
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-border p-3">
          <Button size="sm" variant="ghost" onClick={() => openWorkspace(onOpenUsage)}>
            <ListChecks className="size-3.5" /> 使用记录
          </Button>
          <Button size="sm" variant="outline" disabled={refreshing} onClick={onRefresh}>
            <RefreshCw className={cn("size-3.5", refreshing && "animate-spin")} />
            刷新
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
