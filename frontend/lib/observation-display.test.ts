import { describe, expect, it } from "vitest"
import {
  observationKindLabel,
  observationResultLabel,
  observationSourceLabel,
  observationSummaryLabel,
} from "@/lib/observation-display"

describe("observation display", () => {
  it("translates backend enums", () => {
    expect(observationKindLabel("rate")).toBe("模型倍率采集")
    expect(observationSourceLabel("manual")).toBe("手动刷新")
    expect(observationResultLabel({ success: true })).toBe("成功")
    expect(observationResultLabel({ success: false, error_class: "timeout" })).toBe("请求超时")
  })

  it("turns raw summaries into operator-facing Chinese", () => {
    expect(observationSummaryLabel({ kind: "rate", success: true, summary: "groups=6" })).toBe("获取到 6 个倍率分组")
    expect(observationSummaryLabel({ kind: "cost", success: true, summary: "today=0.0464 total=1.7641" })).toBe("今日消费 $0.0464 · 累计消费 $1.7641")
    expect(observationSummaryLabel({ kind: "balance", success: true, summary: "balance=-0.0116" })).toBe("当前余额 $-0.0116")
  })
})
