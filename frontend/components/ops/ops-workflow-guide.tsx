"use client"

import {
  Activity,
  ChevronLeft,
  ChevronRight,
  GitCompareArrows,
  Scale,
} from "lucide-react"
import { Link } from "react-router-dom"
import { cn } from "@/lib/utils"

type WorkflowStepID =
  | "observations"
  | "comparisons"
  | "adjustments"

const steps = [
  { id: "observations", label: "异常观察", path: "/activity?view=observations", icon: Activity },
  { id: "comparisons", label: "渠道对比", path: "/comparisons", icon: GitCompareArrows },
  { id: "adjustments", label: "倍率调整", path: "/adjustments", icon: Scale },
] satisfies Array<{
  id: WorkflowStepID
  label: string
  path: string
  icon: typeof Activity
}>

export function OpsWorkflowGuide({ current }: { current: WorkflowStepID }) {
  const currentIndex = steps.findIndex((step) => step.id === current)
  const activeStep = steps[currentIndex]
  const ActiveIcon = activeStep.icon
  const previous = steps[currentIndex - 1]
  const next = steps[currentIndex + 1]
  const progress = ((currentIndex + 1) / steps.length) * 100

  return (
    <div className="rounded-xl border border-border bg-card/80 p-3 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm">
            <ActiveIcon className="size-4" />
          </span>
          <div className="min-w-0">
            <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground">上游优化流程</p>
            <p className="truncate text-sm font-semibold text-foreground">{activeStep.label}</p>
          </div>
        </div>
        <span className="shrink-0 rounded-full bg-muted px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
          {currentIndex + 1} / {steps.length}
        </span>
      </div>

      <p className="mt-2 text-xs leading-5 text-muted-foreground">
        基于已采集的上游余额、倍率、账单与稳定性做决策；这里只分析和给建议，不会接管客户端请求。
      </p>

      <div className="mt-3 h-1 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-primary transition-[width] duration-300"
          style={{ width: `${progress}%` }}
        />
      </div>

      <nav aria-label="上游优化流程" className="mt-3 hidden grid-cols-3 gap-1.5 sm:grid">
        {steps.map((step, index) => {
          const Icon = step.icon
          const active = step.id === current
          const completed = index < currentIndex
          return (
            <Link
              key={step.id}
              to={step.path}
              aria-current={active ? "step" : undefined}
              className={cn(
                "group flex min-w-0 items-center gap-2 rounded-lg border px-2.5 py-2 text-xs transition-colors",
                active
                  ? "border-primary/40 bg-primary/10 font-medium text-primary"
                  : "border-transparent text-muted-foreground hover:border-border hover:bg-muted/60 hover:text-foreground",
              )}
            >
              <span
                className={cn(
                  "flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold",
                  active
                    ? "bg-primary text-primary-foreground"
                    : completed
                      ? "bg-primary/15 text-primary"
                      : "bg-muted text-muted-foreground",
                )}
              >
                {index + 1}
              </span>
              <Icon className="size-3.5 shrink-0 opacity-70" />
              <span className="truncate">{step.label}</span>
            </Link>
          )
        })}
      </nav>

      <nav aria-label="上游优化流程移动导航" className="mt-3 grid grid-cols-2 gap-2 sm:hidden">
        {previous ? (
          <Link
            to={previous.path}
            className="flex min-w-0 items-center gap-1.5 rounded-lg border border-border px-2.5 py-2 text-xs text-muted-foreground hover:bg-muted/60 hover:text-foreground"
          >
            <ChevronLeft className="size-3.5 shrink-0" />
            <span className="truncate">{previous.label}</span>
          </Link>
        ) : <span />}
        {next ? (
          <Link
            to={next.path}
            className="flex min-w-0 items-center justify-end gap-1.5 rounded-lg border border-primary/30 bg-primary/5 px-2.5 py-2 text-xs font-medium text-primary hover:bg-primary/10"
          >
            <span className="truncate">{next.label}</span>
            <ChevronRight className="size-3.5 shrink-0" />
          </Link>
        ) : <span />}
      </nav>
    </div>
  )
}
