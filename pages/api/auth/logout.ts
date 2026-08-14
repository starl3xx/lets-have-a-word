import type { NextApiRequest, NextApiResponse } from 'next';
import { ADMIN_SESSION_COOKIE } from '../../../src/lib/adminSession';

/**
 * POST /api/auth/logout
 *
 * Clears the admin session cookie.
 *
 * Has to be a server endpoint rather than a line of client JavaScript: the
 * session cookie is HttpOnly precisely so page scripts cannot touch it, which
 * means they cannot delete it either.
 *
 * Best-effort by nature. The cookie is a signed bearer token, so a copy taken
 * before logout stays valid until it expires — there is no server-side session
 * list to revoke against. To invalidate every session at once, rotate
 * ADMIN_SECRET, which is the signing key.
 */
export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  res.setHeader(
    'Set-Cookie',
    `${ADMIN_SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${
      process.env.NODE_ENV === 'production' ? '; Secure' : ''
    }`
  );

  return res.status(200).json({ ok: true });
}
