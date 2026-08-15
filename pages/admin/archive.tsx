/**
 * Legacy standalone /admin/archive — now a redirect.
 *
 * The tabbed dashboard at /admin superseded this page, but it was left routable
 * with no redirect, so /admin/archive still resolved to a copy that never
 * received any of the dashboard's fixes. Two admin views of the same rounds,
 * free to disagree.
 *
 * This one was actively wrong rather than merely stale. It defined its own
 * `formatEth` and called it on `finalJackpotEth`, which is NULL for a $WORD
 * round — `parseFloat(null).toFixed(4)` renders the literal string "NaN ETH".
 * Same parseFloat-on-a-null bug the changelog records fixing in three other
 * places, surviving here only because nothing pointed at this page any more.
 *
 * Redirecting rather than deleting keeps bookmarks and old links working.
 */
import type { GetServerSideProps } from 'next';

export const getServerSideProps: GetServerSideProps = async () => ({
  redirect: { destination: '/admin?tab=archive', permanent: false },
});

export default function LegacyArchiveRedirect() {
  return null;
}
