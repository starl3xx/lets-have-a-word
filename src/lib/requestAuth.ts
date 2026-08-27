/**
 * Who is making this request?
 *
 * Three endpoints answer that question today and they do not agree.
 * `pages/api/guess.ts` runs a six-branch chain; `pages/api/superguess/purchase.ts`
 * runs a shorter four-branch one; `pages/api/purchase-guess-pack.ts` runs none at
 * all and reads `fid` straight out of the request body. Base App adds a fourth
 * answer — a wallet with no FID — and adding it to three divergent chains
 * separately is how they become four divergent chains.
 *
 * ORDER IS THE WHOLE DESIGN. It mirrors `guess.ts` exactly:
 *
 *   1. dev mode          — unchanged, still gated on NEXT_PUBLIC_LHAW_DEV_MODE
 *   2. Quick Auth JWT    — the Farcaster credential, checked FIRST so that a
 *                          player holding both a JWT and a session cookie is
 *                          resolved by the fresher, stronger proof, exactly as
 *                          today
 *   3. unverified miniAppFid — still REJECTED, see below
 *   4. player session    — the new wallet-native path (SIWE, /api/auth/siwe)
 *
 * The miniAppFid rejection at step 3 is deliberately kept AHEAD of the new
 * session check rather than behind it. It exists because the Farcaster SDK
 * context is client-side and anyone can put any FID in it, and a real Base App
 * client never sends that field at all — it has no Farcaster context to read.
 * So placing the session check after it costs wallet players nothing and leaves
 * a security-sensitive branch byte-for-byte as it was. Moving it later would
 * mean a spoofed miniAppFid plus a valid session no longer 401s, which may well
 * be defensible, but it is not a change worth smuggling into a refactor.
 *
 * Frame/signer verification (steps 5-6 in guess.ts) is NOT handled here. It
 * calls Neynar, only two endpoints use it, and folding it in would drag the
 * Neynar client into every importer's module graph. Callers that support it
 * check `reason === 'no_credential'` and fall through to their own handling.
 */

import type { NextApiRequest } from 'next';
import { isDevModeEnabled } from './devGameState';
import {
  verifyPlayerSession,
  PLAYER_SESSION_COOKIE,
  PLAYER_SESSION_HEADER,
  type PlayerOrigin,
} from './playerSession';

/** Which credential answered. */
export type AuthOrigin = 'dev' | 'quick_auth' | 'player_session';

export interface AuthSuccess {
  ok: true;
  fid: number;
  origin: AuthOrigin;
  /**
   * A wallet this credential PROVES control of. Only ever set for a wallet
   * session, where SIWE established it. Never populated from a request field —
   * that is the mistake `users.signerWalletAddress` had to be walked back from.
   */
  provenWallet?: string;
  /** How the player identity itself was established, for session minting. */
  playerOrigin?: PlayerOrigin;
}

export type AuthFailureReason =
  /** No credential of any kind was presented — callers may fall through. */
  | 'no_credential'
  /** A client-supplied FID with nothing backing it. Never falls through. */
  | 'unverified_miniapp_fid'
  /** A credential was presented and was bad. Never falls through. */
  | 'invalid_credential';

export interface AuthFailure {
  ok: false;
  reason: AuthFailureReason;
  status: number;
  error: string;
  message?: string;
}

export type RequestAuthResult = AuthSuccess | AuthFailure;

export interface ResolveOptions {
  /**
   * Honour the `guess.ts` rule that a bare miniAppFid is a hard 401. Endpoints
   * that never receive that field can leave it off; it changes nothing for them.
   */
  rejectUnverifiedMiniAppFid?: boolean;
  /** Injected in tests so the JWT verifier is not reached over the network. */
  verifyQuickAuthToken?: (token: string) => Promise<number | null>;
}

/**
 * The session token, from the cookie if it arrived and the header if it did not.
 *
 * The cookie is tried first and remains the preferred carrier: it is HttpOnly,
 * so a script cannot read it, and it works in every ordinary browser. The
 * header exists because Base App's webview accepts the Set-Cookie on sign-in
 * and then never sends it back — a player signs in, sees their balance, and
 * every guess arrives unauthenticated. HttpOnly protects nothing when the
 * cookie is never transmitted, so a token the client holds and presents
 * explicitly is strictly better than no session at all.
 */
function readPlayerSessionToken(req: NextApiRequest): string | undefined {
  const fromParsed = req.cookies?.[PLAYER_SESSION_COOKIE];
  if (fromParsed) return fromParsed;

  const cookieHeader = req.headers?.cookie;
  if (cookieHeader) {
    for (const part of cookieHeader.split(';')) {
      const [name, ...rest] = part.trim().split('=');
      if (name === PLAYER_SESSION_COOKIE) return rest.join('=');
    }
  }

  const presented = req.headers?.[PLAYER_SESSION_HEADER];
  if (typeof presented === 'string' && presented.length > 0) return presented;
  if (Array.isArray(presented) && presented[0]) return presented[0];

  return undefined;
}

/** The default JWT verifier, imported lazily so tests never touch the network. */
async function defaultVerifyQuickAuthToken(token: string): Promise<number | null> {
  const { createClient } = await import('@farcaster/quick-auth');
  // `verifyJwt`'s published types are wrong in this version of the package —
  // it declares the parameter as `RequestQueryParameters`, so the documented
  // `{ token }` call fails to typecheck. The same error is already live at
  // pages/api/guess.ts:277 and pages/api/superguess/purchase.ts:76. Narrowing
  // to the shape actually called keeps this file clean without pretending the
  // upstream types are right; drop the cast when the package fixes them.
  const client = createClient() as unknown as {
    verifyJwt(args: { token: string }): Promise<{ sub?: string | number } | null>;
  };
  const result = await client.verifyJwt({ token });
  if (!result || !result.sub) return null;
  const fid = typeof result.sub === 'number' ? result.sub : parseInt(String(result.sub), 10);
  return Number.isInteger(fid) && fid > 0 ? fid : null;
}

export async function resolveRequestFid(
  req: NextApiRequest,
  opts: ResolveOptions = {}
): Promise<RequestAuthResult> {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const devFid = body.devFid ?? req.query?.devFid;
  const authToken =
    (body.authToken as string | undefined) ??
    (req.headers?.authorization?.startsWith('Bearer ')
      ? req.headers.authorization.slice(7)
      : undefined);
  const miniAppFid = body.miniAppFid;

  // 1. Dev mode, the only path that trusts a bare number, and it is gated on
  //    NEXT_PUBLIC_LHAW_DEV_MODE alone.
  //
  //    guess.ts used to widen this with `|| !process.env.NEYNAR_API_KEY`, so a
  //    single unset environment variable made any request carrying `devFid`
  //    authenticate as that FID — a complete authentication bypass in
  //    production, unreachable only because the key happens to be set. That
  //    predicate is gone and there is deliberately no option to reinstate it:
  //    an unset API key says nothing about whether the caller is a developer.
  const parsedDevFid = devFid == null ? NaN : parseInt(String(devFid), 10);
  const haveDevFid = Number.isInteger(parsedDevFid) && parsedDevFid > 0;

  if (isDevModeEnabled() && haveDevFid) {
    return { ok: true, fid: parsedDevFid, origin: 'dev', playerOrigin: 'farcaster' };
  }
  if (isDevModeEnabled()) {
    return { ok: true, fid: 6500, origin: 'dev', playerOrigin: 'farcaster' };
  }

  // 2. Quick Auth, first among real credentials.
  if (authToken) {
    const verify = opts.verifyQuickAuthToken ?? defaultVerifyQuickAuthToken;
    try {
      const fid = await verify(authToken);
      if (!fid) {
        return {
          ok: false,
          reason: 'invalid_credential',
          status: 401,
          error: 'Invalid auth token',
          message: 'Authentication failed. Please refresh and try again.',
        };
      }
      return { ok: true, fid, origin: 'quick_auth', playerOrigin: 'farcaster' };
    } catch {
      return {
        ok: false,
        reason: 'invalid_credential',
        status: 401,
        error: 'Auth token verification failed',
        message: 'Authentication error. Please refresh and try again.',
      };
    }
  }

  // 3. A client-asserted FID with nothing behind it. Kept ahead of the session
  //    check on purpose — see the note at the top of this file.
  if (opts.rejectUnverifiedMiniAppFid && miniAppFid) {
    console.error(`🚨 SECURITY: Rejected unverified miniAppFid=${miniAppFid}. Require auth token.`);
    return {
      ok: false,
      reason: 'unverified_miniapp_fid',
      status: 401,
      error: 'Authentication required',
      message: 'Please refresh the app to sign in securely.',
    };
  }

  // 4. Wallet-native player (Base App).
  const secret = process.env.ADMIN_SECRET;
  const token = readPlayerSessionToken(req);
  if (token && secret) {
    const session = await verifyPlayerSession(token, secret);
    if (session) {
      return {
        ok: true,
        fid: session.fid,
        origin: 'player_session',
        provenWallet: session.wallet,
        playerOrigin: session.origin,
      };
    }
    // A cookie that is present but bad is an expired session, not an attack.
    // Callers that can fall through should still be allowed to.
  }

  return {
    ok: false,
    reason: 'no_credential',
    status: 401,
    error: 'Authentication required',
    message: 'Please refresh the app to sign in.',
  };
}
