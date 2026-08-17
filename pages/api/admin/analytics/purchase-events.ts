/**
 * Purchase Events API
 * Queries GuessesPurchased events directly from the JackpotManager contract
 *
 * This endpoint captures ALL purchases including those made via smart wallets
 * (ERC-4337), which don't appear in Basescan's external transaction filters
 * because they happen as internal calls through the Entry Point contract.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { ethers, Contract } from 'ethers';
import { getBaseProvider } from '../../../../src/lib/word-token';
import { getContractConfig } from '../../../../src/lib/jackpot-contract';
import { db } from '../../../../src/db';
import { users } from '../../../../src/db/schema';
import { eq, inArray } from 'drizzle-orm';
import { isAdminFid } from '../me';

// ERC-4337 Entry Point contract (v0.6.0) - used by smart wallets
const ENTRY_POINT_ADDRESS = '0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789';

// Minimal ABI for querying GuessesPurchased events (ETH era, rounds 1–33)
const JACKPOT_MANAGER_ABI = [
  'event GuessesPurchased(uint256 indexed roundNumber, address indexed player, uint256 quantity, uint256 ethAmount, uint256 toJackpot, uint256 toCreator)',
];

// WordPackSales (round 34+): packs and Superguesses are separate events by
// design — one event per product, so a pack receipt can never claim a session.
const WORD_PACK_SALES_ABI = [
  'event PacksPurchased(address indexed payer, uint256 indexed roundId, uint32 packCount, uint256 amount)',
  'event SuperguessPurchased(address indexed payer, uint256 indexed roundId, uint256 amount)',
];

interface PurchaseEvent {
  txHash: string;
  blockNumber: number;
  timestamp: string;
  player: string;
  fid: number | null;
  username: string | null;
  quantity: number;
  ethAmount: string;
  roundNumber: number;
  isSmartWallet: boolean;
  /** Which product the event records. Legacy GuessesPurchased = 'guesses'. */
  product: 'guesses' | 'packs' | 'superguess';
  /** ETH-era only — WordPackSales does not split onchain. */
  toJackpot?: string;
  toCreator?: string;
}

export interface PurchaseEventsResponse {
  events: PurchaseEvent[];
  totalEvents: number;
  fromBlock: number;
  toBlock: number;
  contractAddress: string;
  /** Every contract queried — legacy JackpotManager plus WordPackSales when configured. */
  contracts: string[];
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<PurchaseEventsResponse | { error: string }>
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Admin auth check
    let fid: number | null = null;
    if (req.query.devFid) {
      fid = parseInt(req.query.devFid as string, 10);
    } else if (req.cookies.siwn_fid) {
      fid = parseInt(req.cookies.siwn_fid, 10);
    }

    if (!fid || !isAdminFid(fid)) {
      return res.status(403).json({ error: 'Forbidden: Admin access required' });
    }

    // Parse query params
    const roundNumber = req.query.roundNumber ? parseInt(req.query.roundNumber as string, 10) : undefined;
    const blockRange = req.query.blockRange ? parseInt(req.query.blockRange as string, 10) : 10000; // ~5.5 hours on Base

    const provider = getBaseProvider();
    const config = getContractConfig();
    const legacyContract = new Contract(config.jackpotManagerAddress, JACKPOT_MANAGER_ABI, provider);
    const packSalesAddress = process.env.WORD_PACK_SALES_ADDRESS || null;
    const packSalesContract = packSalesAddress
      ? new Contract(packSalesAddress, WORD_PACK_SALES_ABI, provider)
      : null;

    // Get current block
    const currentBlock = await provider.getBlockNumber();
    const fromBlock = Math.max(0, currentBlock - blockRange);

    console.log(`[purchase-events] Querying events from block ${fromBlock} to ${currentBlock}`);

    // Query BOTH contracts over the same range: the legacy JackpotManager
    // stopped emitting after round 33 and WordPackSales starts at round 34,
    // so at most one of them has events in any given range — the union is the
    // full purchase history either way.
    interface RawPurchase {
      txHash: string;
      blockNumber: number;
      player: string;
      quantity: number;
      ethAmount: bigint;
      roundNumber: number;
      product: PurchaseEvent['product'];
      toJackpot?: bigint;
      toCreator?: bigint;
    }
    const raw: RawPurchase[] = [];

    const legacyEvents = await legacyContract.queryFilter(
      legacyContract.filters.GuessesPurchased(roundNumber ?? null, null),
      fromBlock,
      currentBlock
    );
    for (const event of legacyEvents) {
      const parsed = legacyContract.interface.parseLog({ topics: event.topics as string[], data: event.data });
      if (!parsed) continue;
      raw.push({
        txHash: event.transactionHash,
        blockNumber: event.blockNumber,
        player: parsed.args.player,
        quantity: Number(parsed.args.quantity),
        ethAmount: parsed.args.ethAmount,
        roundNumber: Number(parsed.args.roundNumber),
        product: 'guesses',
        toJackpot: parsed.args.toJackpot,
        toCreator: parsed.args.toCreator,
      });
    }

    if (packSalesContract) {
      const [packEvents, superguessEvents] = await Promise.all([
        packSalesContract.queryFilter(
          packSalesContract.filters.PacksPurchased(null, roundNumber ?? null),
          fromBlock,
          currentBlock
        ),
        packSalesContract.queryFilter(
          packSalesContract.filters.SuperguessPurchased(null, roundNumber ?? null),
          fromBlock,
          currentBlock
        ),
      ]);
      for (const event of packEvents) {
        const parsed = packSalesContract.interface.parseLog({ topics: event.topics as string[], data: event.data });
        if (!parsed) continue;
        raw.push({
          txHash: event.transactionHash,
          blockNumber: event.blockNumber,
          player: parsed.args.payer,
          quantity: Number(parsed.args.packCount),
          ethAmount: parsed.args.amount,
          roundNumber: Number(parsed.args.roundId),
          product: 'packs',
        });
      }
      for (const event of superguessEvents) {
        const parsed = packSalesContract.interface.parseLog({ topics: event.topics as string[], data: event.data });
        if (!parsed) continue;
        raw.push({
          txHash: event.transactionHash,
          blockNumber: event.blockNumber,
          player: parsed.args.payer,
          quantity: 1,
          ethAmount: parsed.args.amount,
          roundNumber: Number(parsed.args.roundId),
          product: 'superguess',
        });
      }
    }

    console.log(`[purchase-events] Found ${raw.length} events (${legacyEvents.length} legacy)`);

    // Collect unique player addresses to look up FIDs
    const playerAddresses = [...new Set(raw.map(e => e.player?.toLowerCase()).filter(Boolean))];

    // Look up users by signer wallet address
    const userLookup = new Map<string, { fid: number; username: string | null }>();
    if (playerAddresses.length > 0) {
      const dbUsers = await db
        .select({
          fid: users.fid,
          username: users.username,
          signerWalletAddress: users.signerWalletAddress,
        })
        .from(users)
        .where(inArray(users.signerWalletAddress, playerAddresses));

      for (const user of dbUsers) {
        if (user.signerWalletAddress) {
          userLookup.set(user.signerWalletAddress.toLowerCase(), {
            fid: user.fid,
            username: user.username,
          });
        }
      }
    }

    // Process events
    const purchaseEvents: PurchaseEvent[] = [];
    for (const event of raw) {
      // Check if this was a smart wallet transaction by looking at the tx sender
      let isSmartWallet = false;
      try {
        const tx = await provider.getTransaction(event.txHash);
        if (tx) {
          // If the tx was sent to Entry Point, it's a smart wallet transaction
          isSmartWallet = tx.to?.toLowerCase() === ENTRY_POINT_ADDRESS.toLowerCase();
        }
      } catch (err) {
        // If we can't get tx details, assume direct
        console.warn(`[purchase-events] Could not get tx details for ${event.txHash}`);
      }

      // Get block timestamp
      let timestamp = '';
      try {
        const block = await provider.getBlock(event.blockNumber);
        if (block) {
          timestamp = new Date(block.timestamp * 1000).toISOString();
        }
      } catch (err) {
        console.warn(`[purchase-events] Could not get block timestamp for ${event.blockNumber}`);
      }

      // Look up user
      const userInfo = userLookup.get(event.player.toLowerCase());

      purchaseEvents.push({
        txHash: event.txHash,
        blockNumber: event.blockNumber,
        timestamp,
        player: event.player,
        fid: userInfo?.fid ?? null,
        username: userInfo?.username ?? null,
        quantity: event.quantity,
        ethAmount: ethers.formatEther(event.ethAmount),
        roundNumber: event.roundNumber,
        isSmartWallet,
        product: event.product,
        ...(event.toJackpot !== undefined && { toJackpot: ethers.formatEther(event.toJackpot) }),
        ...(event.toCreator !== undefined && { toCreator: ethers.formatEther(event.toCreator) }),
      });
    }

    // Sort by block number descending (most recent first)
    purchaseEvents.sort((a, b) => b.blockNumber - a.blockNumber);

    return res.status(200).json({
      events: purchaseEvents,
      totalEvents: purchaseEvents.length,
      fromBlock,
      toBlock: currentBlock,
      contractAddress: config.jackpotManagerAddress,
      contracts: [config.jackpotManagerAddress, ...(packSalesAddress ? [packSalesAddress] : [])],
    });
  } catch (error) {
    console.error('[purchase-events] Error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
