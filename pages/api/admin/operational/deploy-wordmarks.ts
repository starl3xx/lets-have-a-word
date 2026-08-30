/**
 * POST /api/admin/operational/deploy-wordmarks
 *
 * Deploys the Wordmarks ERC-1155 from the admin panel, because the house rule
 * here is that nothing operational happens at a command line.
 *
 * THIS IS THE MOST IRREVERSIBLE BUTTON IN THE APP. A deployed contract cannot
 * be edited, the tokens are soulbound so a bad one cannot be recalled, and once
 * players hold tokens the ids mean whatever they meant at mint time forever.
 * Every guard below exists because of that, and none of them are ceremony:
 *
 *   - Base Sepolia is the DEFAULT. Mainnet has to be asked for by name.
 *   - Mainnet additionally requires a typed confirmation phrase, so a stray
 *     click cannot spend real money.
 *   - It refuses to redeploy over a configured address unless explicitly
 *     replacing, since a second contract silently orphans everything minted
 *     from the first.
 *   - The attestor may not be the deployer. That key signs badge vouchers; the
 *     operator key moves prize money. Keeping them apart is what bounds the
 *     damage when one leaks, and the whole point is lost if they are the same
 *     address.
 *   - It only ever REPORTS the address. Wiring it up is a deliberate second
 *     step by a human editing an environment variable, so a deploy that went
 *     wrong is not also instantly live.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { ethers } from 'ethers';
import { isAdminFid } from '../me';
import artifact from '../../../../src/contracts/wordmarks-artifact.json';

const CHAINS = {
  'base-sepolia': {
    chainId: 84532,
    label: 'Base Sepolia',
    rpc: process.env.BASE_SEPOLIA_RPC_URL || 'https://sepolia.base.org',
    explorer: 'https://sepolia.basescan.org',
    isMainnet: false,
  },
  base: {
    chainId: 8453,
    label: 'Base Mainnet',
    rpc: process.env.BASE_RPC_URL || 'https://mainnet.base.org',
    explorer: 'https://basescan.org',
    isMainnet: true,
  },
} as const;

type ChainKey = keyof typeof CHAINS;

/** Typed by a human before real money moves. */
const MAINNET_PHRASE = 'DEPLOY TO MAINNET';

export interface DeployResult {
  ok: true;
  chain: string;
  chainId: number;
  address: string;
  txHash: string;
  deployer: string;
  owner: string;
  attestor: string;
  baseUri: string;
  gasUsed: string;
  explorerUrl: string;
  /** What the human has to do next, deliberately not done for them. */
  nextSteps: string[];
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<DeployResult | { error: string }>
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const devFid = req.body?.devFid ? parseInt(String(req.body.devFid), 10) : null;
  const cookieFid = req.cookies.siwn_fid ? parseInt(req.cookies.siwn_fid, 10) : null;
  const fid = devFid || cookieFid;
  if (!fid || !isAdminFid(fid)) {
    return res.status(403).json({ error: 'Admin access required' });
  }

  const {
    chain = 'base-sepolia',
    owner,
    attestor,
    baseUri,
    confirmPhrase,
    replaceExisting,
  } = (req.body ?? {}) as {
    chain?: string;
    owner?: string;
    attestor?: string;
    baseUri?: string;
    confirmPhrase?: string;
    replaceExisting?: boolean;
  };

  const net = CHAINS[chain as ChainKey];
  if (!net) {
    return res.status(400).json({ error: `Unknown chain "${chain}"` });
  }

  const deployerKey = process.env.OPERATOR_PRIVATE_KEY;
  if (!deployerKey) {
    return res.status(503).json({ error: 'OPERATOR_PRIVATE_KEY is not configured' });
  }

  // --- guards ---------------------------------------------------------

  if (net.isMainnet && confirmPhrase !== MAINNET_PHRASE) {
    return res.status(400).json({
      error: `Mainnet deploys require the exact phrase "${MAINNET_PHRASE}"`,
    });
  }

  const existing = process.env.NEXT_PUBLIC_WORDMARKS_ADDRESS;
  if (net.isMainnet && existing && ethers.isAddress(existing) && !replaceExisting) {
    return res.status(409).json({
      error:
        `A Wordmarks contract is already configured at ${existing}. Deploying another ` +
        `orphans everything minted from it, and those tokens are soulbound so nobody ` +
        `can move them across. Tick "replace existing" only if you are certain.`,
    });
  }

  if (!owner || !ethers.isAddress(owner)) {
    return res.status(400).json({ error: 'A valid owner address is required' });
  }
  if (!attestor || !ethers.isAddress(attestor)) {
    return res.status(400).json({ error: 'A valid attestor address is required' });
  }
  if (!baseUri || typeof baseUri !== 'string' || !/^https?:\/\/|^ipfs:\/\//.test(baseUri)) {
    return res.status(400).json({ error: 'baseUri must be an http(s) or ipfs URL' });
  }
  if (!baseUri.endsWith('/')) {
    // uri() concatenates `<id>.json` straight onto this, so a missing slash
    // silently produces .../wordmarks10.json and every token loses its metadata.
    return res.status(400).json({ error: 'baseUri must end with "/"' });
  }

  let provider: ethers.JsonRpcProvider;
  let wallet: ethers.Wallet;
  try {
    provider = new ethers.JsonRpcProvider(net.rpc, net.chainId);
    wallet = new ethers.Wallet(deployerKey, provider);
  } catch {
    return res.status(500).json({ error: 'Could not connect to the network' });
  }

  if (attestor.toLowerCase() === wallet.address.toLowerCase()) {
    return res.status(400).json({
      error:
        'The attestor must not be the deployer. That key only signs badge vouchers, ' +
        'while this one moves prize money, and separating them is what limits the ' +
        'damage if the attestor key leaks.',
    });
  }

  try {
    // Confirm the RPC really is the chain we think, before spending anything.
    const network = await provider.getNetwork();
    if (Number(network.chainId) !== net.chainId) {
      return res.status(500).json({
        error: `RPC reports chain ${network.chainId}, expected ${net.chainId} for ${net.label}`,
      });
    }

    const balance = await provider.getBalance(wallet.address);
    if (balance === 0n) {
      return res.status(400).json({
        error: `Deployer ${wallet.address} has no ETH on ${net.label}`,
      });
    }

    const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, wallet);
    const contract = await factory.deploy(owner, attestor, baseUri);
    const tx = contract.deploymentTransaction();
    const receipt = await tx?.wait();
    const address = await contract.getAddress();

    console.log(
      `[deploy-wordmarks] FID ${fid} deployed Wordmarks to ${address} on ${net.label} ` +
        `(owner ${owner}, attestor ${attestor})`
    );

    return res.status(200).json({
      ok: true,
      chain: net.label,
      chainId: net.chainId,
      address,
      txHash: tx?.hash ?? '',
      deployer: wallet.address,
      owner,
      attestor,
      baseUri,
      gasUsed: receipt?.gasUsed?.toString() ?? 'unknown',
      explorerUrl: `${net.explorer}/address/${address}`,
      nextSteps: [
        `Set NEXT_PUBLIC_WORDMARKS_ADDRESS=${address} in the environment, then redeploy the app.`,
        'Set WORDMARK_ATTESTOR_PRIVATE_KEY to the key for the attestor address above.',
        net.isMainnet
          ? 'Mint one Wordmark yourself and confirm it appears in a wallet before telling anybody.'
          : 'This is TESTNET. Nothing here is real; run the same deploy on mainnet when satisfied.',
        'Leave NEXT_PUBLIC_PAYMASTER_ENABLED=false for launch unless the sponsorship path has been watched against a real Redis.',
      ],
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[deploy-wordmarks] Deploy failed:', message);
    return res.status(500).json({ error: `Deploy failed: ${message}` });
  }
}
