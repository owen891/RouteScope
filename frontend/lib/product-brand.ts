export const PRODUCT_NAME = "RouteScope"
export const PRODUCT_TAGLINE = "Local Control Plane"
export const PRODUCT_DESCRIPTION = "上游健康、成本与路由决策控制台"
export const PRODUCT_TITLE_CHANGED_EVENT = "routescope:product-title-changed"

export function publishProductTitle(title: string) {
  if (typeof window === "undefined") return
  window.dispatchEvent(new CustomEvent(PRODUCT_TITLE_CHANGED_EVENT, {
    detail: title.trim() || PRODUCT_NAME,
  }))
}

export function productDocumentTitle(pageTitle?: string, productName = PRODUCT_NAME) {
  const title = pageTitle?.trim()
  const name = productName.trim() || PRODUCT_NAME
  return title ? `${title} · ${name}` : name
}
