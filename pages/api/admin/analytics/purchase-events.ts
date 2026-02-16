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

// Minimal ABI for querying GuessesPurchased events
const JACKPOT_MANAGER_ABI = [
  'event GuessesPurchased(uint256 indexed roundNumber, address indexed player, uint256 quantity, uint256 ethAmount, uint256 toJackpot, uint256 toCreator)',
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
  toJackpot: string;
  toCreator: string;
}

export interface PurchaseEventsResponse {
  events: PurchaseEvent[];
  totalEvents: number;
  fromBlock: number;
  toBlock: number;
  contractAddress: string;
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
    const contract = new Contract(config.jackpotManagerAddress, JACKPOT_MANAGER_ABI, provider);

    // Get current block
    const currentBlock = await provider.getBlockNumber();
    const fromBlock = Math.max(0, currentBlock - blockRange);

    // Build event filter
    const filter = contract.filters.GuessesPurchased(
      roundNumber ?? null, // roundNumber filter (indexed)
      null // player filter (indexed) - null means all
    );

    console.log(`[purchase-events] Querying events from block ${fromBlock} to ${currentBlock}`);

    // Query events
    const events = await contract.queryFilter(filter, fromBlock, currentBlock);

    console.log(`[purchase-events] Found ${events.length} events`);

    // Collect unique player addresses to look up FIDs
    const playerAddresses = [...new Set(events.map(e => {
      const parsed = contract.interface.parseLog({ topics: e.topics as string[], data: e.data });
      return parsed?.args.player?.toLowerCase();
    }).filter(Boolean))];

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
    for (const event of events) {
      const parsed = contract.interface.parseLog({ topics: event.topics as string[], data: event.data });
      if (!parsed) continue;

      const { roundNumber: rn, player, quantity, ethAmount, toJackpot, toCreator } = parsed.args;

      // Check if this was a smart wallet transaction by looking at the tx sender
      let isSmartWallet = false;
      try {
        const tx = await provider.getTransaction(event.transactionHash);
        if (tx) {
          // If the tx was sent to Entry Point, it's a smart wallet transaction
          isSmartWallet = tx.to?.toLowerCase() === ENTRY_POINT_ADDRESS.toLowerCase();
        }
      } catch (err) {
        // If we can't get tx details, assume direct
        console.warn(`[purchase-events] Could not get tx details for ${event.transactionHash}`);
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
      const userInfo = userLookup.get(player.toLowerCase());

      purchaseEvents.push({
        txHash: event.transactionHash,
        blockNumber: event.blockNumber,
        timestamp,
        player,
        fid: userInfo?.fid ?? null,
        username: userInfo?.username ?? null,
        quantity: Number(quantity),
        ethAmount: ethers.formatEther(ethAmount),
        roundNumber: Number(rn),
        isSmartWallet,
        toJackpot: ethers.formatEther(toJackpot),
        toCreator: ethers.formatEther(toCreator),
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
    });
  } catch (error) {
    console.error('[purchase-events] Error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
