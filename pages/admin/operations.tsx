/**
 * Legacy standalone /admin/operations — now a redirect.
 *
 * Superseded by the tabbed dashboard at /admin, but left routable with no
 * redirect. Unlike OperationsSection it has no currency branch anywhere, so its
 * emergency-resolve confirmation reads "triggering the onchain payout of 0 ETH"
 * on a $WORD round — a dialog that asks you to confirm a number that is not the
 * prize. See the note in ./archive.tsx.
 */
import type { GetServerSideProps } from 'next';

export const getServerSideProps: GetServerSideProps = async () => ({
  redirect: { destination: '/admin?tab=operations', permanent: false },
});

export default function LegacyOperationsRedirect() {
  return null;
}
