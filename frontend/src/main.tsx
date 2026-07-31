import { lazy, StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import '@fontsource-variable/geist'
import '@fontsource-variable/geist-mono'
import { ThemeProvider } from '@/components/theme-provider'
import { AuthProvider } from '@/lib/auth-context'
import { RefreshProvider } from '@/lib/refresh-context'
import { AddChannelProvider } from '@/lib/add-channel-context'
import { AuthGate } from '@/components/auth/auth-gate'
import { AppShell } from '@/components/app-shell'
import { Toaster } from '@/components/ui/sonner'
import { appRedirects, appRoutes } from '@/lib/app-navigation'
import '@/app/globals.css'

const routePages = appRoutes.map((route) => ({ ...route, Page: lazy(route.load) }))

// phase09-route-inventory: <Route index element={<OverviewPage />} />
// phase09-route-inventory: <Route path="ops/channels" element={<OpsChannelsPage />} />
// phase09-route-inventory: <Route path="favorites" element={<FavoritesPage />} />
// phase09-route-inventory: <Route path="observations" element={<Navigate replace to="/activity?view=observations" />} />
// phase09-route-inventory: <Route path="activity" element={<ActivityPage />} />
// phase09-route-inventory: <Route path="comparisons" element={<ComparisonsPage />} />
// phase09-route-inventory: <Route path="route-advice" element={<Navigate replace to="/comparisons" />} />
// phase09-route-inventory: <Route path="adjustments" element={<AdjustmentsPage />} />
// phase09-route-inventory: <Route path="relay" element={<UpstreamSyncPage />} />
// phase09-route-inventory: <Route path="gateway" element={<GatewayPage />} />
// phase09-route-inventory: <Route path="usage-costs" element={<UsageCostsPage />} />
// phase09-route-inventory: <Route path="model-prices" element={<UsageCostsLegacyPage />} />
// phase09-route-inventory: <Route path="notifications" element={<NotificationsPage />} />
// phase09-route-inventory: <Route path="captcha" element={<CaptchaPage />} />
// phase09-route-inventory: <Route path="settings" element={<SettingsPage />} />
// phase09-route-inventory: <Route path="upstream-sync" element={<Navigate />} />

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider attribute="class" defaultTheme="light" enableSystem disableTransitionOnChange>
      <AuthProvider>
        <AuthGate>
          <RefreshProvider>
            <BrowserRouter>
              <AddChannelProvider>
                <Routes>
                  <Route element={<AppShell />}>
                    {routePages.map(({ href, Page }) => (
                      href === "/" ? <Route key={href} index element={<Page />} /> : <Route key={href} path={href.slice(1)} element={<Page />} />
                    ))}
                    {appRedirects.map((redirect) => <Route key={redirect.from} path={redirect.from.slice(1)} element={<Navigate replace to={redirect.to} />} />)}
                  </Route>
                </Routes>
              </AddChannelProvider>
            </BrowserRouter>
          </RefreshProvider>
          <Toaster richColors closeButton position="top-right" />
        </AuthGate>
      </AuthProvider>
    </ThemeProvider>
  </StrictMode>,
)
