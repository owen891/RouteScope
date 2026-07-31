import { AlertCircle, CheckCircle2, CircleDashed, Clock3, Info, RefreshCw } from "lucide-react"
import type { ReactNode } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string
  title: string
  description?: string
  actions?: ReactNode
}) {
  return (
    <header className="flex flex-col gap-3 border-b border-border pb-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        {eyebrow ? <p className="mb-1 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">{eyebrow}</p> : null}
        <h1 className="text-xl font-semibold tracking-tight text-foreground">{title}</h1>
        {description ? <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  )
}

export function StatusBadge({ status }: { status: string }) {
  const normalized = status.trim().toLowerCase()
  const isGood = ["ok", "healthy", "active", "enabled", "succeeded", "success", "ready"].includes(normalized)
  const isBad = ["error", "failed", "failure", "disabled", "inactive", "blocked"].includes(normalized)
  const Icon = isGood ? CheckCircle2 : isBad ? AlertCircle : CircleDashed

  return (
    <Badge variant="outline" className={cn(isGood && "border-success/40 text-success", isBad && "border-destructive/40 text-destructive")}>
      <Icon />
      {status || "unknown"}
    </Badge>
  )
}

export function FreshnessBadge({ at, staleAfterMs = 15 * 60 * 1000 }: { at?: string | null; staleAfterMs?: number }) {
  if (!at) {
    return <Badge variant="outline"><Info />暂无时间</Badge>
  }
  const timestamp = new Date(at).getTime()
  const stale = !Number.isFinite(timestamp) || Date.now() - timestamp > staleAfterMs
  return (
    <Badge variant="outline" className={stale ? "border-warning/50 text-warning-foreground" : "border-success/40 text-success"}>
      <Clock3 />
      {stale ? "数据可能过期" : "数据新鲜"}
    </Badge>
  )
}

export function EmptyState({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="flex min-h-40 flex-col items-center justify-center gap-2 rounded-md border border-dashed border-border px-6 py-10 text-center">
      <CircleDashed className="size-5 text-muted-foreground" />
      <h2 className="text-sm font-medium">{title}</h2>
      {description ? <p className="max-w-md text-xs text-muted-foreground">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  )
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex min-h-32 flex-col items-center justify-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-6 py-8 text-center" role="alert">
      <AlertCircle className="size-5 text-destructive" />
      <p className="text-sm text-destructive">{message}</p>
      {onRetry ? <Button variant="outline" size="sm" onClick={onRetry}><RefreshCw />重试</Button> : null}
    </div>
  )
}
