// pages/admin/analytics.tsx
import type { NextPage } from "next"
import dynamic from "next/dynamic"

const AnalyticsDashboardClient = dynamic(
  () => import("../../components/AnalyticsDashboardClient"),
  {
    ssr: false,
    loading: () => <div>Loading analytics…</div>,
  }
)

const AdminAnalyticsPage: NextPage = () => {
  return <AnalyticsDashboardClient />
}

export default AdminAnalyticsPage
