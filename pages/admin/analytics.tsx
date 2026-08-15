/**
 * Legacy standalone /admin/analytics — now a redirect.
 *
 * Superseded by the tabbed dashboard at /admin, but left routable with no
 * redirect: the same tiles as AnalyticsSection, without any of the fixes it has
 * had since. See the note in ./archive.tsx.
 */
import type { GetServerSideProps } from 'next';

export const getServerSideProps: GetServerSideProps = async () => ({
  redirect: { destination: '/admin?tab=analytics', permanent: false },
});

export default function LegacyAnalyticsRedirect() {
  return null;
}
