// pages/admin/analytics.tsx
import type { NextPage } from "next"
import dynamic from "next/dynamic"

// Always resolve to the React component, not the raw module object
const AnalyticsDashboardClient = dynamic(
  () =>
    import("../../components/AnalyticsDashboardClient").then((m: any) => {
      return m.default || m.AnalyticsDashboardClient
    }),
  {
    ssr: false,
    loading: () => <div>Loading analytics…</div>,
  }
)

const AdminAnalyticsPage: NextPage = () => {
  return <AnalyticsDashboardClient />
}

export default AdminAnalyticsPage
