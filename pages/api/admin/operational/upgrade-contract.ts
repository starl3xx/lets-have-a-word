/**
 * Upgrade Contract to V3 API Endpoint
 * Deploys new JackpotManagerV3 implementation and upgrades the UUPS proxy.
 *
 * POST /api/admin/operational/upgrade-contract
 *
 * Requires admin authentication (FID in LHAW_ADMIN_USER_IDS)
 * Requires DEPLOYER_PRIVATE_KEY (contract owner) environment variable
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { ethers } from 'ethers';
import { isAdminFid } from '../me';
import { getContractConfig, getJackpotManagerReadOnly } from '../../../../src/lib/jackpot-contract';
import { getBaseProvider } from '../../../../src/lib/word-token';
import JackpotManagerV3Artifact from '../../../../src/lib/contracts/JackpotManagerV3.json';

interface UpgradeResponse {
  success: boolean;
  message: string;
  oldImplementation?: string;
  newImplementation?: string;
  txHash?: string;
  error?: string;
}

// Minimal UUPS proxy ABI for reading implementation and calling upgrade
const PROXY_ABI = [
  'function upgradeToAndCall(address newImplementation, bytes data)',
];

// ERC-1967 implementation slot
const IMPLEMENTATION_SLOT = '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc';

async function getImplementationAddress(provider: ethers.Provider, proxyAddress: string): Promise<string> {
  const raw = await provider.getStorage(proxyAddress, IMPLEMENTATION_SLOT);
  return ethers.getAddress('0x' + raw.slice(26));
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<UpgradeResponse>
) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Allow', 'POST, OPTIONS');
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({
      success: false,
      message: `Method ${req.method} not allowed. Use POST.`,
    });
  }

  try {
    // Auth
    let fid: number | null = null;
    if (req.query.devFid) {
      fid = parseInt(req.query.devFid as string, 10);
    } else if (req.cookies.siwn_fid) {
      fid = parseInt(req.cookies.siwn_fid, 10);
    } else if (req.body?.fid) {
      fid = parseInt(req.body.fid, 10);
    }

    if (!fid || isNaN(fid)) {
      return res.status(401).json({
        success: false,
        message: 'Not authenticated - FID required',
      });
    }

    if (!isAdminFid(fid)) {
      return res.status(403).json({
        success: false,
        message: `FID ${fid} is not authorized as admin`,
      });
    }

    // V3 detection (read-only — no private key needed)
    // Check if already upgraded: try calling seedFromTreasury.staticCall(0)
    // If it reverts with InsufficientPayment, V3 is already live.
    // If it reverts with a different error (function not found), V2 is still live.
    const contract = getJackpotManagerReadOnly();
    try {
      await contract.seedFromTreasury.staticCall(0);
      // If it doesn't revert, something unexpected — but V3 is live
      return res.status(409).json({
        success: false,
        message: 'Contract is already upgraded to V3 (seedFromTreasury is available).',
      });
    } catch (err: any) {
      const errorData = err?.data || err?.message || '';
      // InsufficientPayment selector = 0x0c7b0346 means V3 IS deployed
      if (typeof errorData === 'string' && errorData.includes('0c7b0346')) {
        return res.status(409).json({
          success: false,
          message: 'Contract is already upgraded to V3 (seedFromTreasury reverts with InsufficientPayment).',
        });
      }
      // Any other revert means V3 is NOT deployed — proceed with upgrade
      console.log(`[upgrade-contract] V3 not detected`);
    }

    // If checkOnly flag is set, just return the detection result without upgrading
    if (req.body?.checkOnly) {
      return res.status(200).json({
        success: true,
        message: 'Contract is V2 — upgrade available.',
      });
    }

    // From here on we need DEPLOYER_PRIVATE_KEY to actually deploy + upgrade
    const ownerPrivateKey = process.env.DEPLOYER_PRIVATE_KEY;
    if (!ownerPrivateKey) {
      return res.status(500).json({
        success: false,
        message: 'DEPLOYER_PRIVATE_KEY not configured. Required for contract upgrades.',
      });
    }

    const provider = getBaseProvider();
    const ownerWallet = new ethers.Wallet(ownerPrivateKey, provider);
    const config = getContractConfig();
    const proxyAddress = config.jackpotManagerAddress;

    console.log(`[upgrade-contract] Admin FID ${fid} initiating V3 upgrade for proxy ${proxyAddress}`);
    console.log(`[upgrade-contract] Owner wallet: ${ownerWallet.address}`);

    // Read current implementation address
    const oldImplementation = await getImplementationAddress(provider, proxyAddress);
    console.log(`[upgrade-contract] Current implementation: ${oldImplementation}`);

    // Deploy new V3 implementation
    console.log(`[upgrade-contract] Deploying new V3 implementation...`);
    const factory = new ethers.ContractFactory(
      JackpotManagerV3Artifact.abi,
      JackpotManagerV3Artifact.bytecode,
      ownerWallet
    );
    const newImpl = await factory.deploy();
    await newImpl.waitForDeployment();
    const newImplAddress = await newImpl.getAddress();
    console.log(`[upgrade-contract] New V3 implementation deployed at: ${newImplAddress}`);

    // Call upgradeToAndCall on the proxy (owner-only UUPS function)
    console.log(`[upgrade-contract] Upgrading proxy to new implementation...`);
    const proxy = new ethers.Contract(proxyAddress, PROXY_ABI, ownerWallet);
    const upgradeTx = await proxy.upgradeToAndCall(newImplAddress, '0x');
    console.log(`[upgrade-contract] Upgrade tx submitted: ${upgradeTx.hash}`);

    const receipt = await upgradeTx.wait();
    console.log(`[upgrade-contract] Upgrade confirmed - Block: ${receipt!.blockNumber}, Gas: ${receipt!.gasUsed}`);

    // Verify upgrade succeeded
    const verifiedImpl = await getImplementationAddress(provider, proxyAddress);
    if (verifiedImpl.toLowerCase() !== newImplAddress.toLowerCase()) {
      return res.status(500).json({
        success: false,
        message: `Upgrade verification failed. Expected ${newImplAddress} but got ${verifiedImpl}`,
        oldImplementation,
        newImplementation: verifiedImpl,
        txHash: upgradeTx.hash,
      });
    }

    console.log(`[upgrade-contract] Upgrade verified! ${oldImplementation} → ${newImplAddress}`);

    return res.status(200).json({
      success: true,
      message: `Contract upgraded to V3 successfully!`,
      oldImplementation,
      newImplementation: newImplAddress,
      txHash: upgradeTx.hash,
    });
  } catch (error) {
    console.error('[upgrade-contract] Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to upgrade contract',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}
