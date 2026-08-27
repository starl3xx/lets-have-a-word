/**
 * The wallet-history gate must never judge a smart wallet.
 *
 * It counts outgoing transactions via eth_getTransactionCount. For a Base
 * Account — a contract — that is the CREATE nonce, essentially always 0 however
 * heavily the wallet is used, because its activity flows through the ERC-4337
 * EntryPoint rather than originating EVM transactions. So every wallet-native
 * player reads as "too fresh" on a SUCCESSFUL measurement, and only an RPC
 * ERROR fails open.
 *
 * That matters because this gate runs on the guess path AND at win time
 * (winner-eligibility, with forceRefresh). Arming WALLET_HISTORY_GATING_ENABLED
 * without this exemption would void a Base App jackpot winner and tell them
 * their account was flagged for review.
 */

import { describe, it, expect } from 'vitest';
import { checkWalletHistory } from '../lib/wallet-history';
import { WALLET_FID_MIN } from '../lib/users';

describe('wallet-native players are exempt from the EOA-nonce gate', () => {
  it('passes a wallet fid without touching the database or the chain', async () => {
    // Deliberately an fid with no users row: the exemption must short-circuit
    // BEFORE the wallet lookup, so a smart-wallet player can never be judged
    // by a measurement that cannot describe them.
    const result = await checkWalletHistory(WALLET_FID_MIN + 12_345);

    expect(result.eligible).toBe(true);
    expect(result.txCount).toBeNull();
    expect(result.errorCode).toBeUndefined();
  });

  it('does not exempt a Farcaster fid', async () => {
    // The exemption is keyed on the synthetic range, not on "no row found".
    // A real FID with no wallet on file must still be refused, which is the
    // pre-existing behaviour this change must not loosen.
    const result = await checkWalletHistory(424_242);

    expect(result.eligible).toBe(false);
    expect(result.reason).toBe('No wallet on file');
  });
});
