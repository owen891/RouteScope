import { describe, expect, it } from "vitest"
import { appRedirects, appRoutes, findAppRoute, findSectionLabel, navigationSections, visibleNavigation } from "@/lib/app-navigation"

describe("app navigation registry", () => {
  it("keeps route metadata unique and exposes every visible section", () => {
    expect(new Set(appRoutes.map((route) => route.id)).size).toBe(appRoutes.length)
    expect(new Set(appRoutes.map((route) => route.href)).size).toBe(appRoutes.length)
    expect(new Set(visibleNavigation.map((route) => route.section))).toEqual(new Set(navigationSections.map((section) => section.id)))
  })

  it("resolves canonical routes and nested paths from the same registry", () => {
    expect(findAppRoute("/")?.id).toBe("overview")
    expect(findAppRoute("/ops/channels")?.id).toBe("channels")
    expect(findAppRoute("/activity")?.id).toBe("activity")
    expect(findAppRoute("/observations")?.id).toBe("observations")
    expect(findAppRoute("/gateway/details")?.id).toBe("gateway")
    expect(findAppRoute("/unknown")).toBeNull()
    expect(findSectionLabel("control")).toBe("控制")
  })

  it("keeps compatibility redirects explicit and non-duplicating", () => {
    expect(appRedirects).toEqual(expect.arrayContaining([
      expect.objectContaining({ from: "/upstream-sync", to: "/relay" }),
      expect.objectContaining({ from: "/route-advice", to: "/comparisons" }),
      expect.objectContaining({ from: "/favorites", to: "/ops/channels?scope=favorites" }),
      expect.objectContaining({ from: "/context", to: "/ops/channels" }),
      expect.objectContaining({ from: "/adjustments", to: "/relay?view=adjustments" }),
    ]))
    expect(findAppRoute("/model-prices")?.id).toBe("model-prices-legacy")
    expect(visibleNavigation.map((route) => route.id)).not.toContain("observations")
    expect(visibleNavigation.map((route) => route.id)).not.toContain("route-advice")
    expect(visibleNavigation.map((route) => route.id)).not.toContain("favorites")
    expect(visibleNavigation.map((route) => route.id)).not.toContain("decision-context")
    expect(visibleNavigation.map((route) => route.id)).not.toContain("adjustments")
    expect(visibleNavigation.map((route) => route.id)).not.toContain("captcha")
    expect(appRedirects.map((redirect) => redirect.from)).not.toContain("/ops/channels")
  })
})
