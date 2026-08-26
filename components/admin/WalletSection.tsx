/**
 * Wallet Section Component
 * Admin-only wallet management with guardrails and clear visibility
 */

import React, { useState, useEffect, useCallback } from 'react';
import { ethers } from 'ethers';
import { useOperationalStatus, type OperationalStatus } from "./operational-status";
import PurchaseEventsCard from "./PurchaseEventsCard";
import FundingDirectoryCard from "./FundingDirectoryCard";
import { adminFont as fontFamily } from "./ui"
import { formatCentral, formatCentralDate, formatCentralTime, shortenAddress } from "./format";

// =============================================================================
// Types
// =============================================================================

interface WalletSectionProps {
  user?: {
    fid: number;
    username: string;
  };
}

interface WalletBalances {
  operatorWallet: {
    address: string;
    balanceEth: string;
  };
  prizePool: {
    address: string;
    balanceEth: string;
    currentJackpotEth: string;
  };
  nextRoundSeed?: {
    fivePercentEth?: string; // 5% of current jackpot
    fromTreasuryEth?: string; // Amount Treasury contributes
    totalEth?: string; // min(0.02, 5% + treasury)
    targetEth?: string; // 0.02 ETH target
    shortfallEth?: string; // How much below target
    // Legacy fields
    projectedEth?: string;
  };
  treasury?: {
    address: string;
    balanceEth: string;
    contributingToSeedEth?: string;
    withdrawableEth: string;
    isWithdrawable: boolean;
  };
  // Legacy field - use treasury instead
  creatorPool?: {
    address: string;
    accumulatedEth: string;
    withdrawThresholdEth?: string;
    isWithdrawable?: boolean;
  };
  wordTokenRewards?: {
    tokenAddress: string;
    balance: string; // Human readable whole number
    balanceRaw: string;
  };
  feeRecipients?: {
    recipients: {
      id: string;
      name: string;
      address: string;
      bps: number;
      percent: number;
      wethBalance: string;
      ethBalance: string;
      usdcBalance: string;
      wordBalance: string;
    }[];
    totals: {
      weth: string;
      eth: string;
      usdc: string;
      word: string;
    };
  };
  wordManager?: {
    address: string;
    totalBalance: string;
    stakedByUsers: string;
    reservedForStaking: string;
    availableForGames: string;
    roundsAvailable: number;
    stakingPeriodActive: boolean;
    stakingPeriodEnds: string | null;
    // Sent by /api/admin/wallet/balances but missing from this copy of its
    // shape, so the "Staking at risk" alert below — which reads
    // stakingHealthy — did not typecheck. It renders correctly at runtime;
    // this is drift between two hand-maintained copies of one response type.
    stakingHeadroom: string;
    stakingHealthy: boolean;
  };
  wordJackpot?: {
    address: string;
    balance: string;
    pool: string;
    carry: string;
    claimable: string;
    unallocated: string;
  };
  packSales?: {
    address: string;
    balanceEth: string;
  };
  treasuryWord?: string;
  wordPriceUsd?: number;
  pendingRefunds: {
    count: number;
    totalEth: string;
  };
  contractAddress: string;
  contractError?: string; // Present if contract calls failed (e.g., not deployed)
  lastUpdated: string;
}

interface WalletAction {
  id: number;
  actionType: string;
  amountEth: string;
  fromAddress: string;
  toAddress: string;
  txHash: string | null;
  status: 'pending' | 'confirmed' | 'failed';
  initiatedByFid: number;
  initiatedByAddress: string;
  note: string | null;
  createdAt: string;
}









interface ConnectedWallet {
  address: string;
  chainId: number;
  chainName: string;
}

// Base chain ID
const BASE_CHAIN_ID = 8453;
const BASE_CHAIN_ID_HEX = '0x2105';

// Creator profit wallet (configured in the JackpotManager contract)
const CREATOR_PROFIT_WALLET = '0x3Cee630075DC586D5BFdFA81F3a2d77980F0d223';

// =============================================================================
// Health Badge Helper
// =============================================================================

type WalletHealthStatus = 'healthy' | 'warning' | 'critical';

interface WalletHealthInfo {
  status: WalletHealthStatus;
  emoji: string;
  label: string;
  issues: string[];
}

function computeWalletHealth(
  balances: WalletBalances | null,
  opStatus: OperationalStatus | null
): WalletHealthInfo {
  const issues: string[] = [];

  // Critical issues
  if (opStatus?.killSwitch?.enabled) {
    issues.push('Kill switch is active');
  }

  if (balances?.pendingRefunds && balances.pendingRefunds.count > 0) {
    issues.push(`${balances.pendingRefunds.count} pending refunds (${balances.pendingRefunds.totalEth} ETH)`);
  }

  if (balances?.contractError) {
    issues.push('Contract connection error');
  }

  // Warning issues. Gas-only threshold — must match the Fund Operator card's
  // amber line, or the badge and the card contradict each other on the same
  // tab. The old ETH seed-shortfall issue is gone with the seed model: $WORD
  // rounds seed themselves from WordJackpot, nothing auto-tops-up anymore.
  const operatorBalance = parseFloat(balances?.operatorWallet?.balanceEth || '0');
  if (operatorBalance < 0.005 && balances) {
    issues.push('Low operator gas balance');
  }

  if (opStatus?.deadDay?.enabled) {
    issues.push('Dead day is active');
  }

  // Determine status
  const hasCritical = opStatus?.killSwitch?.enabled ||
    (balances?.pendingRefunds && balances.pendingRefunds.count > 0) ||
    balances?.contractError;

  const hasWarning = issues.length > 0;

  if (hasCritical) {
    return {
      status: 'critical',
      emoji: '🔴',
      label: 'Critical Issues',
      issues,
    };
  }

  if (hasWarning) {
    return {
      status: 'warning',
      emoji: '🟡',
      label: 'Attention Needed',
      issues,
    };
  }

  return {
    status: 'healthy',
    emoji: '🟢',
    label: 'All Systems Normal',
    issues: [],
  };
}

// =============================================================================
// Styles
// =============================================================================


const styles = {
  section: {
    marginBottom: '24px',
  },
  card: {
    background: 'white',
    borderRadius: '12px',
    border: '1px solid #e5e7eb',
    padding: '24px',
    marginBottom: '16px',
  },
  cardTitle: {
    fontSize: '16px',
    fontWeight: 600,
    color: '#111827',
    margin: '0 0 16px 0',
    fontFamily,
  },
  cardSubtitle: {
    fontSize: '13px',
    color: '#6b7280',
    margin: '0 0 16px 0',
    fontFamily,
  },
  grid2: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, 1fr)',
    gap: '16px',
  },
  grid4: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, 1fr)',
    gap: '16px',
  },
  grid5: {
    display: 'grid',
    gridTemplateColumns: 'repeat(5, 1fr)',
    gap: '16px',
  },
  statCard: {
    background: '#f9fafb',
    borderRadius: '8px',
    padding: '16px',
    textAlign: 'center' as const,
  },
  statLabel: {
    fontSize: '12px',
    color: '#6b7280',
    marginBottom: '4px',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.03em',
    fontFamily,
  },
  statValue: {
    fontSize: '24px',
    fontWeight: 700,
    color: '#111827',
    fontFamily,
  },
  statValueSmall: {
    fontSize: '18px',
    fontWeight: 600,
    color: '#111827',
    fontFamily,
  },
  statSubtext: {
    fontSize: '11px',
    color: '#9ca3af',
    marginTop: '4px',
    fontFamily,
  },
  address: {
    fontSize: '11px',
    color: '#6b7280',
    fontFamily: 'monospace',
    wordBreak: 'break-all' as const,
  },
  label: {
    display: 'block',
    fontSize: '13px',
    fontWeight: 500,
    color: '#374151',
    marginBottom: '6px',
    fontFamily,
  },
  input: {
    width: '100%',
    padding: '10px 12px',
    border: '1px solid #d1d5db',
    borderRadius: '8px',
    fontSize: '14px',
    outline: 'none',
    fontFamily,
    boxSizing: 'border-box' as const,
  },
  inputError: {
    borderColor: '#dc2626',
  },
  btnPrimary: {
    padding: '10px 20px',
    background: '#2563eb',
    color: 'white',
    border: 'none',
    borderRadius: '8px',
    fontSize: '14px',
    fontWeight: 500,
    cursor: 'pointer',
    fontFamily,
  },
  btnDanger: {
    padding: '10px 20px',
    background: '#dc2626',
    color: 'white',
    border: 'none',
    borderRadius: '8px',
    fontSize: '14px',
    fontWeight: 500,
    cursor: 'pointer',
    fontFamily,
  },
  btnSuccess: {
    padding: '10px 20px',
    background: '#16a34a',
    color: 'white',
    border: 'none',
    borderRadius: '8px',
    fontSize: '14px',
    fontWeight: 500,
    cursor: 'pointer',
    fontFamily,
  },
  btnSecondary: {
    padding: '10px 20px',
    background: '#f3f4f6',
    color: '#374151',
    border: '1px solid #d1d5db',
    borderRadius: '8px',
    fontSize: '14px',
    fontWeight: 500,
    cursor: 'pointer',
    fontFamily,
  },
  btnSmall: {
    padding: '6px 12px',
    fontSize: '12px',
    borderRadius: '6px',
  },
  btnDisabled: {
    opacity: 0.5,
    cursor: 'not-allowed',
  },
  quickBtn: {
    padding: '8px 16px',
    background: '#f3f4f6',
    color: '#374151',
    border: '1px solid #e5e7eb',
    borderRadius: '6px',
    fontSize: '13px',
    fontWeight: 500,
    cursor: 'pointer',
    fontFamily,
  },
  alert: (type: 'warning' | 'error' | 'info' | 'success') => ({
    padding: '12px 16px',
    borderRadius: '8px',
    marginBottom: '12px',
    display: 'flex',
    alignItems: 'flex-start',
    gap: '12px',
    background: type === 'error' ? '#fef2f2' :
                type === 'warning' ? '#fffbeb' :
                type === 'success' ? '#f0fdf4' :
                '#eff6ff',
    border: `1px solid ${
      type === 'error' ? '#fecaca' :
      type === 'warning' ? '#fde68a' :
      type === 'success' ? '#bbf7d0' :
      '#bfdbfe'
    }`,
    color: type === 'error' ? '#991b1b' :
           type === 'warning' ? '#92400e' :
           type === 'success' ? '#166534' :
           '#1e40af',
    fontSize: '13px',
    fontFamily,
  }),
  badge: (color: string) => ({
    display: 'inline-block',
    padding: '2px 8px',
    borderRadius: '9999px',
    fontSize: '11px',
    fontWeight: 500,
    background: color === 'green' ? '#dcfce7' :
                color === 'yellow' ? '#fef3c7' :
                color === 'red' ? '#fee2e2' :
                '#f3f4f6',
    color: color === 'green' ? '#166534' :
           color === 'yellow' ? '#92400e' :
           color === 'red' ? '#991b1b' :
           '#374151',
    fontFamily,
  }),
  table: {
    width: '100%',
    borderCollapse: 'collapse' as const,
    fontSize: '13px',
    fontFamily,
  },
  th: {
    textAlign: 'left' as const,
    padding: '10px 12px',
    borderBottom: '1px solid #e5e7eb',
    color: '#6b7280',
    fontWeight: 500,
    fontSize: '11px',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.03em',
  },
  td: {
    padding: '10px 12px',
    borderBottom: '1px solid #f3f4f6',
    color: '#374151',
  },
  link: {
    color: '#2563eb',
    textDecoration: 'none',
  },
  modal: {
    position: 'fixed' as const,
    inset: 0,
    background: 'rgba(0,0,0,0.5)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
  },
  modalContent: {
    background: 'white',
    borderRadius: '12px',
    padding: '24px',
    maxWidth: '480px',
    width: '100%',
    margin: '16px',
  },
  connectedWallet: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '12px 16px',
    background: '#f0fdf4',
    border: '1px solid #bbf7d0',
    borderRadius: '8px',
  },
  disconnectedWallet: {
    padding: '16px',
    background: '#fef3c7',
    border: '1px solid #fde68a',
    borderRadius: '8px',
    textAlign: 'center' as const,
  },
};

// =============================================================================
// Component
// =============================================================================

export default function WalletSection({ user }: WalletSectionProps) {
  // Wallet connection state
  const [connectedWallet, setConnectedWallet] = useState<ConnectedWallet | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [walletError, setWalletError] = useState<string | null>(null);
  const [connectedBalance, setConnectedBalance] = useState<string | null>(null);

  // Balances state
  const [balances, setBalances] = useState<WalletBalances | null>(null);
  const [balancesLoading, setBalancesLoading] = useState(true);
  const [balancesError, setBalancesError] = useState<string | null>(null);

  // Operational status
  const { status: opStatus } = useOperationalStatus();

  // Actions state
  const [actions, setActions] = useState<WalletAction[]>([]);
  const [actionsLoading, setActionsLoading] = useState(true);

  // Withdrawal form state
  const [withdrawConfirmText, setWithdrawConfirmText] = useState('');
  const [isWithdrawing, setIsWithdrawing] = useState(false);
  const [showWithdrawConfirm, setShowWithdrawConfirm] = useState(false);

  // Fund operator wallet state
  const [fundOperatorAmount, setFundOperatorAmount] = useState('');
  const [fundOperatorConfirmText, setFundOperatorConfirmText] = useState('');
  const [isFundingOperator, setIsFundingOperator] = useState(false);
  const [showFundOperatorConfirm, setShowFundOperatorConfirm] = useState(false);

  // Streaming rewards activation state
  // Two modes:
  //   'existing' — tokens are already in the contract; just call notifyRewardAmount
  //   'send'     — transfer from connected wallet to the contract, then activate
  const [activateAmount, setActivateAmount] = useState('');
  const [activateMode, setActivateMode] = useState<'existing' | 'send' | null>(null);
  const [activateConfirmText, setActivateConfirmText] = useState('');
  const [isActivating, setIsActivating] = useState(false);
  const [activateProgress, setActivateProgress] = useState<string | null>(null);
  const [activateError, setActivateError] = useState<string | null>(null);
  const [activateResult, setActivateResult] = useState<{
    transferTxHash?: string;
    notifyTxHash?: string;
  } | null>(null);
  // Preserves a successful transfer across a partial-failure retry. If the
  // transfer tx confirmed but the subsequent notifyRewardAmount call failed,
  // a retry must NOT re-send tokens — it reuses this hash and skips straight
  // to the notify step. Cleared on full success or modal cancel.
  const [committedTransferTxHash, setCommittedTransferTxHash] = useState<string | null>(null);

  // Bonus distribution state

  // Round data repair state

  // $WORD withdrawal state
  interface WordTokenStatus {
    contractAddress: string;
    wordTokenAddress: string;
    balanceWei: string;
    balanceFormatted: string;
    balanceInMillions: string;
    roundsAvailable: number;
    bonusWordsEnabled: boolean;
    contractOwner: string;
    canWithdraw: boolean;
    withdrawalNote: string;
  }
  const [wordTokenStatus, setWordTokenStatus] = useState<WordTokenStatus | null>(null);
  const [wordTokenLoading, setWordTokenLoading] = useState(false);
  const [wordTokenError, setWordTokenError] = useState<string | null>(null);
  const [bonusWordsToggleLoading, setBonusWordsToggleLoading] = useState(false);

  // =============================================================================
  // Wallet Connection
  // =============================================================================

  const checkWalletConnection = useCallback(async () => {
    if (typeof window === 'undefined' || !window.ethereum) return;

    try {
      const accounts = await window.ethereum.request({ method: 'eth_accounts' });
      if (accounts && accounts.length > 0) {
        const chainId = await window.ethereum.request({ method: 'eth_chainId' });
        const chainIdNum = parseInt(chainId, 16);

        setConnectedWallet({
          address: accounts[0],
          chainId: chainIdNum,
          chainName: getChainName(chainIdNum),
        });

        // Get balance
        const provider = new ethers.BrowserProvider(window.ethereum);
        const balance = await provider.getBalance(accounts[0]);
        setConnectedBalance(ethers.formatEther(balance));
      }
    } catch (err) {
      console.error('Error checking wallet:', err);
    }
  }, []);

  const connectWallet = async () => {
    if (typeof window === 'undefined' || !window.ethereum) {
      setWalletError('No wallet detected. Please install Rabby or Rainbow.');
      return;
    }

    setIsConnecting(true);
    setWalletError(null);

    try {
      const accounts = await window.ethereum.request({
        method: 'eth_requestAccounts',
      });

      if (accounts && accounts.length > 0) {
        const chainId = await window.ethereum.request({ method: 'eth_chainId' });
        const chainIdNum = parseInt(chainId, 16);

        setConnectedWallet({
          address: accounts[0],
          chainId: chainIdNum,
          chainName: getChainName(chainIdNum),
        });

        // Get balance
        const provider = new ethers.BrowserProvider(window.ethereum);
        const balance = await provider.getBalance(accounts[0]);
        setConnectedBalance(ethers.formatEther(balance));
      }
    } catch (err: any) {
      console.error('Error connecting wallet:', err);
      setWalletError(err.message || 'Failed to connect wallet');
    } finally {
      setIsConnecting(false);
    }
  };

  const disconnectWallet = () => {
    setConnectedWallet(null);
    setConnectedBalance(null);
  };

  const switchToBase = async () => {
    if (!window.ethereum) return;

    try {
      await window.ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: BASE_CHAIN_ID_HEX }],
      });

      // Refresh connection
      await checkWalletConnection();
    } catch (err: any) {
      // Chain not added, try to add it
      if (err.code === 4902) {
        try {
          await window.ethereum.request({
            method: 'wallet_addEthereumChain',
            params: [{
              chainId: BASE_CHAIN_ID_HEX,
              chainName: 'Base',
              nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
              rpcUrls: ['https://mainnet.base.org'],
              blockExplorerUrls: ['https://basescan.org'],
            }],
          });
          await checkWalletConnection();
        } catch (addErr) {
          console.error('Error adding Base chain:', addErr);
        }
      } else {
        console.error('Error switching chain:', err);
      }
    }
  };

  // =============================================================================
  // Data Fetching
  // =============================================================================

  const fetchBalances = useCallback(async () => {
    if (!user?.fid) return;

    try {
      const res = await fetch(`/api/admin/wallet/balances?devFid=${user.fid}`);
      if (res.ok) {
        const data = await res.json();
        setBalances(data);
        setBalancesError(null);
      } else {
        const err = await res.json();
        setBalancesError(err.error || 'Failed to fetch balances');
      }
    } catch (err) {
      setBalancesError('Failed to fetch balances');
    } finally {
      setBalancesLoading(false);
    }
  }, [user?.fid]);


  const fetchActions = useCallback(async () => {
    if (!user?.fid) return;

    try {
      const res = await fetch(`/api/admin/wallet/actions?devFid=${user.fid}&limit=20`);
      if (res.ok) {
        const data = await res.json();
        setActions(data.actions || []);
      }
    } catch (err) {
      // Silent fail
    } finally {
      setActionsLoading(false);
    }
  }, [user?.fid]);


  const fetchWordTokenStatus = useCallback(async () => {
    if (!user?.fid) return;

    setWordTokenLoading(true);
    setWordTokenError(null);
    try {
      const res = await fetch(`/api/admin/operational/withdraw-word-token?devFid=${user.fid}`);
      if (res.ok) {
        const data = await res.json();
        setWordTokenStatus(data);
      } else {
        const err = await res.json();
        setWordTokenError(err.error || 'Failed to fetch $WORD status');
      }
    } catch (err) {
      setWordTokenError('Failed to fetch $WORD status');
    } finally {
      setWordTokenLoading(false);
    }
  }, [user?.fid]);

  const handleBonusWordsToggle = async (enable: boolean) => {
    if (!user?.fid) return;

    setBonusWordsToggleLoading(true);
    setWordTokenError(null);

    try {
      const res = await fetch('/api/admin/operational/withdraw-word-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          devFid: user.fid,
          action: enable ? 'enable-bonus-words' : 'disable-bonus-words',
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Toggle failed');
      }

      fetchWordTokenStatus();
    } catch (err: any) {
      setWordTokenError(err.message);
    } finally {
      setBonusWordsToggleLoading(false);
    }
  };






  useEffect(() => {
    checkWalletConnection();
    fetchBalances();
    fetchActions();
    fetchWordTokenStatus();

    // Listen for account/chain changes
    if (window.ethereum) {
      window.ethereum.on('accountsChanged', checkWalletConnection);
      window.ethereum.on('chainChanged', checkWalletConnection);
    }

    return () => {
      if (window.ethereum) {
        window.ethereum.removeListener('accountsChanged', checkWalletConnection);
        window.ethereum.removeListener('chainChanged', checkWalletConnection);
      }
    };
  }, [checkWalletConnection, fetchBalances, fetchActions, fetchWordTokenStatus]);

  // =============================================================================
  // Withdrawal Handler
  // =============================================================================

  const handleWithdraw = async () => {
    if (!connectedWallet || !balances || !user) return;
    if (connectedWallet.chainId !== BASE_CHAIN_ID) {
      setWalletError('Please switch to Base network');
      return;
    }
    if (withdrawConfirmText !== 'WITHDRAW') {
      setWalletError('Please type WITHDRAW to confirm');
      return;
    }

    // Treasury is always served by wallet/balances
    const treasury = balances.treasury ?? null;

    if (!treasury || !treasury.isWithdrawable) {
      setWalletError('No withdrawable balance available');
      return;
    }

    setIsWithdrawing(true);
    setWalletError(null);

    try {
      // The amount being withdrawn (for logging purposes)
      const withdrawAmountEth = treasury.withdrawableEth;

      // Call withdrawCreatorProfit() on the contract
      const provider = new ethers.BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();

      // Create contract instance with withdrawCreatorProfit ABI
      const withdrawAbi = ['function withdrawCreatorProfit()'];
      const contract = new ethers.Contract(balances.contractAddress, withdrawAbi, signer);

      // Call withdrawCreatorProfit - sends ALL accumulated profit to configured creatorProfitWallet
      const tx = await contract.withdrawCreatorProfit();

      // Log the action
      await fetch('/api/admin/wallet/actions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          devFid: user.fid,
          actionType: 'treasury_withdrawal',
          amountEth: withdrawAmountEth,
          fromAddress: balances.contractAddress,
          toAddress: treasury.address || CREATOR_PROFIT_WALLET,
          txHash: tx.hash,
          initiatedByFid: user.fid,
          initiatedByAddress: connectedWallet.address,
          note: 'Withdrawal initiated from admin panel',
          metadata: { chainId: connectedWallet.chainId, method: 'withdrawCreatorProfit' },
        }),
      });

      // Reset form
      setWithdrawConfirmText('');
      setShowWithdrawConfirm(false);

      // Refresh data
      await Promise.all([fetchBalances(), fetchActions()]);

      alert(`Transaction submitted: ${tx.hash}\n\nView on BaseScan: https://basescan.org/tx/${tx.hash}`);
    } catch (err: any) {
      console.error('Withdrawal error:', err);
      setWalletError(err.message || 'Withdrawal failed');
    } finally {
      setIsWithdrawing(false);
    }
  };

  // =============================================================================
  // Fund Operator Wallet Handler
  // =============================================================================

  const handleFundOperator = async () => {
    if (!connectedWallet || !balances || !user) return;
    if (connectedWallet.chainId !== BASE_CHAIN_ID) {
      setWalletError('Please switch to Base network');
      return;
    }
    if (fundOperatorConfirmText !== 'FUND') {
      setWalletError('Please type FUND to confirm');
      return;
    }

    const amount = parseFloat(fundOperatorAmount);
    if (isNaN(amount) || amount <= 0) {
      setWalletError('Please enter a valid amount');
      return;
    }
    if (amount > 0.1) {
      setWalletError('Safety cap: maximum 0.1 ETH per transaction');
      return;
    }

    setIsFundingOperator(true);
    setWalletError(null);

    try {
      const provider = new ethers.BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();
      const valueWei = ethers.parseEther(fundOperatorAmount);

      // No builder-code suffix: this is the admin moving treasury ETH to the
      // operator wallet. Attributing our own internal transfers would inflate
      // the Base.dev numbers with activity no player drove.
      const tx = await signer.sendTransaction({
        to: balances.operatorWallet.address,
        value: valueWei,
      });

      // Log the action
      await fetch('/api/admin/wallet/actions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          devFid: user.fid,
          actionType: 'operator_funding',
          amountEth: fundOperatorAmount,
          amountWei: valueWei.toString(),
          fromAddress: connectedWallet.address,
          toAddress: balances.operatorWallet.address,
          txHash: tx.hash,
          initiatedByFid: user.fid,
          initiatedByAddress: connectedWallet.address,
          note: 'Operator wallet funded from admin panel',
          metadata: { chainId: connectedWallet.chainId },
        }),
      });

      // Reset form
      setFundOperatorAmount('');
      setFundOperatorConfirmText('');
      setShowFundOperatorConfirm(false);

      // Refresh data
      await Promise.all([fetchBalances(), fetchActions()]);

      alert(`Transaction submitted: ${tx.hash}\n\nView on BaseScan: https://basescan.org/tx/${tx.hash}`);
    } catch (err: any) {
      console.error('Fund operator error:', err);
      setWalletError(err.message || 'Funding failed');
    } finally {
      setIsFundingOperator(false);
    }
  };

  // =============================================================================
  // Activate Streaming Rewards Handler
  // =============================================================================

  const handleActivateStreaming = async () => {
    if (!connectedWallet || !balances?.wordManager || !user) return;
    if (connectedWallet.chainId !== BASE_CHAIN_ID) {
      setActivateError('Please switch to Base network');
      return;
    }
    if (activateConfirmText !== 'STREAM') {
      setActivateError('Please type STREAM to confirm');
      return;
    }
    if (!activateMode) {
      setActivateError('Missing activation mode');
      return;
    }

    const amount = parseFloat(activateAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setActivateError('Please enter a valid amount');
      return;
    }

    const wordManagerAddress = balances.wordManager.address;
    // Shared ERC-20 token address — already hardcoded across the client
    // (WordBonusModal, BuyButton, etc.). Kept identical to avoid drift.
    const WORD_TOKEN_ADDRESS = '0x304e649e69979298BD1AEE63e175ADf07885fb4b';

    setIsActivating(true);
    setActivateError(null);
    setActivateResult(null);
    setActivateProgress(null);

    // Hoisted above the try/catch so the catch branch can see the hash and
    // so the audit log derives the flow shape from actual bytes moved —
    // not from `activateMode`, which we flip to 'existing' after a
    // successful transfer to keep the button copy honest on retry.
    // React state updates are async; reading `committedTransferTxHash`
    // in catch would see a stale null on the first partial-failure.
    let transferTxHash: string | undefined = committedTransferTxHash ?? undefined;

    try {
      // Step 1 (send mode only, and only if no prior transfer succeeded):
      //   transfer $WORD from connected wallet → WordManager
      if (activateMode === 'send' && !transferTxHash) {
        setActivateProgress('Awaiting wallet signature for transfer…');
        const provider = new ethers.BrowserProvider(window.ethereum);
        const signer = await provider.getSigner();
        const erc20 = new ethers.Contract(
          WORD_TOKEN_ADDRESS,
          ['function transfer(address to, uint256 amount) returns (bool)'],
          signer
        );
        const amountWei = ethers.parseUnits(activateAmount, 18);
        const tx = await erc20.transfer(wordManagerAddress, amountWei);
        transferTxHash = tx.hash;
        setActivateProgress(`Transfer submitted (${tx.hash.slice(0, 10)}…). Waiting for confirmation…`);
        await tx.wait();
        // Persist the confirmed hash. From this point on, any failure in the
        // notify step is a partial-success state; retries must skip Step 1.
        // We also flip mode to 'existing' so the button label/copy makes sense
        // on the next render.
        setCommittedTransferTxHash(tx.hash);
        setActivateMode('existing');
      }

      // Step 2: call notifyRewardAmount via the existing admin endpoint
      setActivateProgress('Starting reward period on WordManager…');
      const response = await fetch('/api/admin/operational/fund-staking-pool', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amountTokens: amount, fid: user.fid }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error || `Activation failed (HTTP ${response.status})`);
      }

      const notifyTxHash: string | undefined = data?.txHash ?? undefined;

      // Audit log. The action table's amountEth/amountWei columns are varchar
      // and the $WORD token is 18-decimal (same representation as ETH), so
      // we reuse those fields and tag the unit in metadata.tokenSymbol.
      //
      // Derive the flow from whether a transfer actually happened, not from
      // activateMode. On a retry after partial success, activateMode has been
      // flipped to 'existing' for the UI — but the audit trail needs to show
      // the connected wallet as the real source of the tokens.
      const movedTokens = !!transferTxHash;
      try {
        const amountWei = ethers.parseUnits(activateAmount, 18).toString();
        const logResponse = await fetch('/api/admin/wallet/actions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            devFid: user.fid,
            actionType: 'streaming_activation',
            amountEth: String(amount), // whole-token amount
            amountWei, // 18-decimal smallest-unit amount
            fromAddress: movedTokens ? connectedWallet.address : wordManagerAddress,
            toAddress: wordManagerAddress,
            txHash: notifyTxHash ?? transferTxHash ?? null,
            initiatedByFid: user.fid,
            initiatedByAddress: connectedWallet.address,
            note: `Streaming rewards activated (${movedTokens ? 'transfer + notify' : 'notify only'})`,
            metadata: {
              tokenSymbol: '$WORD',
              mode: movedTokens ? 'send' : 'existing',
              chainId: connectedWallet.chainId,
              transferTxHash: transferTxHash ?? null,
              notifyTxHash: notifyTxHash ?? null,
              amountTokens: amount,
            },
          }),
        });
        // fetch doesn't throw on 4xx/5xx — check explicitly so a broken
        // audit contract surfaces instead of failing silently.
        if (!logResponse.ok) {
          const text = await logResponse.text().catch(() => '');
          console.warn(
            `[ActivateStreaming] Action log returned HTTP ${logResponse.status}: ${text}`
          );
        }
      } catch (logErr) {
        // Non-fatal — don't break the UI if audit logging fails
        console.warn('[ActivateStreaming] Action log failed:', logErr);
      }

      setActivateResult({ transferTxHash, notifyTxHash });
      setActivateProgress(null);

      // Reset form — full success, so the partial-failure guard is no longer needed.
      setActivateAmount('');
      setActivateConfirmText('');
      setActivateMode(null);
      setCommittedTransferTxHash(null);

      // Refresh balances so the dashboard flips to Active
      await Promise.all([fetchBalances(), fetchActions()]);
    } catch (err: any) {
      console.error('[ActivateStreaming] Error:', err);
      // If the transfer already committed, surface that loudly so the admin
      // knows the $WORD is in the contract even though streaming didn't start.
      // Must read from the local `transferTxHash`, not the state — state
      // updates from this handler haven't flushed yet in this closure.
      const baseMessage = err?.message || 'Activation failed';
      setActivateError(
        transferTxHash
          ? `${baseMessage} — your ${activateAmount} $WORD transfer already confirmed (${transferTxHash.slice(0, 10)}…). Retry will call notifyRewardAmount without a second transfer, or cancel to activate later via "Activate with existing balance".`
          : baseMessage
      );
      setActivateProgress(null);
    } finally {
      setIsActivating(false);
    }
  };

  // =============================================================================
  // Safety Alerts
  // =============================================================================

  const getSafetyAlerts = (): Array<{ type: 'warning' | 'error' | 'info'; message: string }> => {
    const alerts: Array<{ type: 'warning' | 'error' | 'info'; message: string }> = [];

    // Network check
    if (connectedWallet && connectedWallet.chainId !== BASE_CHAIN_ID) {
      alerts.push({
        type: 'error',
        message: `Connected to ${connectedWallet.chainName} (${connectedWallet.chainId}). Please switch to Base.`,
      });
    }

    // Operational status checks
    if (opStatus?.status === 'KILL_SWITCH_ACTIVE') {
      alerts.push({
        type: 'warning',
        message: 'Kill switch is active. Refunds may be running.',
      });
    }

    if (opStatus?.status === 'DEAD_DAY_ACTIVE' || opStatus?.status === 'PAUSED_BETWEEN_ROUNDS') {
      alerts.push({
        type: 'info',
        message: 'Game is paused between rounds.',
      });
    }

    // Balance checks
    if (balances && connectedBalance) {
      const opBalance = parseFloat(connectedBalance);
      const pendingRefunds = parseFloat(balances.pendingRefunds.totalEth);

      if (pendingRefunds > 0 && opBalance < pendingRefunds) {
        alerts.push({
          type: 'error',
          message: `Pending refunds (${pendingRefunds.toFixed(4)} ETH) exceed connected wallet balance (${opBalance.toFixed(4)} ETH).`,
        });
      } else if (pendingRefunds > 0 && opBalance < pendingRefunds * 1.5) {
        alerts.push({
          type: 'warning',
          message: `Connected wallet balance is low relative to pending refunds. Consider adding funds.`,
        });
      }
    }

    return alerts;
  };

  // =============================================================================
  // Render
  // =============================================================================

  const isOnBase = connectedWallet?.chainId === BASE_CHAIN_ID;
  const safetyAlerts = getSafetyAlerts();

  // Compute wallet health
  const walletHealth = computeWalletHealth(balances, opStatus);

  return (
    <div>
      {/* Wallet Health Badge - At a glance status */}
      <div style={{
        ...styles.card,
        display: 'flex',
        alignItems: 'center',
        gap: '16px',
        background: walletHealth.status === 'critical' ? '#fef2f2' :
                    walletHealth.status === 'warning' ? '#fffbeb' :
                    '#f0fdf4',
        borderColor: walletHealth.status === 'critical' ? '#fecaca' :
                     walletHealth.status === 'warning' ? '#fde68a' :
                     '#bbf7d0',
      }}>
        <div style={{ fontSize: '48px', lineHeight: 1 }}>
          {walletHealth.emoji}
        </div>
        <div style={{ flex: 1 }}>
          <div style={{
            fontSize: '18px',
            fontWeight: 600,
            color: walletHealth.status === 'critical' ? '#991b1b' :
                   walletHealth.status === 'warning' ? '#92400e' :
                   '#166534',
            marginBottom: '4px',
            fontFamily,
          }}>
            {walletHealth.label}
          </div>
          {walletHealth.issues.length > 0 ? (
            <ul style={{
              margin: 0,
              padding: '0 0 0 18px',
              fontSize: '13px',
              color: walletHealth.status === 'critical' ? '#dc2626' :
                     walletHealth.status === 'warning' ? '#b45309' :
                     '#16a34a',
              fontFamily,
            }}>
              {walletHealth.issues.map((issue, i) => (
                <li key={i}>{issue}</li>
              ))}
            </ul>
          ) : (
            <p style={{
              margin: 0,
              fontSize: '13px',
              color: '#16a34a',
              fontFamily,
            }}>
              Prize pool, operator wallet, and treasury are functioning normally.
            </p>
          )}
        </div>
        {balances && (
          <div style={{
            textAlign: 'right',
            fontSize: '11px',
            color: '#9ca3af',
            fontFamily,
          }}>
            Updated<br />
            {formatCentralTime(balances.lastUpdated)}
          </div>
        )}
      </div>

      {/* Wallet Connection Section */}
      <div style={styles.card}>
        <h3 style={styles.cardTitle}>Wallet Connection</h3>

        {!connectedWallet ? (
          <div style={styles.disconnectedWallet}>
            {typeof window !== 'undefined' && window.ethereum ? (
              <>
                <p style={{ margin: '0 0 12px 0', color: '#92400e' }}>
                  Connect your wallet to manage funds
                </p>
                <button
                  onClick={connectWallet}
                  disabled={isConnecting}
                  style={{
                    ...styles.btnPrimary,
                    ...(isConnecting ? styles.btnDisabled : {}),
                  }}
                >
                  {isConnecting ? 'Connecting...' : 'Connect Wallet'}
                </button>
              </>
            ) : (
              <p style={{ margin: 0, color: '#92400e' }}>
                No wallet detected. Please install <strong>Rabby</strong> or <strong>Rainbow</strong> browser extension.
              </p>
            )}
          </div>
        ) : (
          <div>
            <div style={styles.connectedWallet}>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                  <span style={{ fontSize: '14px', fontWeight: 600, color: '#166534' }}>
                    {shortenAddress(connectedWallet.address)}
                  </span>
                  <button
                    onClick={() => navigator.clipboard.writeText(connectedWallet.address)}
                    style={{ ...styles.btnSecondary, ...styles.btnSmall }}
                  >
                    Copy
                  </button>
                </div>
                <div style={{ fontSize: '12px', color: '#6b7280' }}>
                  {connectedWallet.chainName} (Chain ID: {connectedWallet.chainId})
                  {connectedBalance && ` • ${parseFloat(connectedBalance).toFixed(4)} ETH`}
                </div>
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                {!isOnBase && (
                  <button onClick={switchToBase} style={{ ...styles.btnPrimary, ...styles.btnSmall }}>
                    Switch to Base
                  </button>
                )}
                <button onClick={disconnectWallet} style={{ ...styles.btnSecondary, ...styles.btnSmall }}>
                  Disconnect
                </button>
              </div>
            </div>

            {!isOnBase && (
              <div style={{ ...styles.alert('error'), marginTop: '12px' }}>
                ⚠️ You must be on Base network to perform wallet operations.
              </div>
            )}
          </div>
        )}

        {walletError && (
          <div style={{ ...styles.alert('error'), marginTop: '12px' }}>
            {walletError}
          </div>
        )}
      </div>

      {/* Safety Alerts */}
      {safetyAlerts.length > 0 && (
        <div style={styles.card}>
          <h3 style={styles.cardTitle}>⚠️ Safety Alerts</h3>
          {safetyAlerts.map((alert, i) => (
            <div key={i} style={styles.alert(alert.type)}>
              {alert.message}
            </div>
          ))}
        </div>
      )}

      {/* Balances Overview */}
      <div style={styles.card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <h3 style={{ ...styles.cardTitle, margin: 0 }}>Balances Overview</h3>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            {balances && (
              <span style={{ fontSize: '11px', color: '#9ca3af' }}>
                Last updated: {formatCentralTime(balances.lastUpdated)}
              </span>
            )}
            <button
              onClick={() => { setBalancesLoading(true); fetchBalances(); }}
              disabled={balancesLoading}
              style={{ ...styles.btnSecondary, ...styles.btnSmall }}
            >
              {balancesLoading ? 'Loading...' : 'Refresh'}
            </button>
          </div>
        </div>
        <p style={styles.cardSubtitle}>
          Round 34+ pays $WORD from the WordJackpot contract — rounds seed themselves from its
          unallocated balance. Packs and Superguesses still pay ETH.
        </p>

        {balancesError ? (
          <div style={styles.alert('error')}>{balancesError}</div>
        ) : balancesLoading ? (
          <div style={{ padding: '24px', textAlign: 'center', color: '#6b7280' }}>Loading balances...</div>
        ) : balances ? (
          <>
          {(() => {
            const legacyJackpotEth = parseFloat(balances.prizePool.currentJackpotEth);
            const legacyCreatorEth = parseFloat(balances.treasury?.balanceEth ?? '0');
            const legacyLeftoverEth = legacyJackpotEth + legacyCreatorEth;
            const packSalesEth = balances.packSales ? parseFloat(balances.packSales.balanceEth) : null;
            // "2,500,000,000" → "≈$640" from the oracle price; null when the
            // price or the figure is unavailable, so subtexts degrade cleanly.
            const usdApprox = (tokens: string | undefined): string | null => {
              if (!balances.wordPriceUsd || !tokens) return null;
              const n = parseFloat(tokens.replace(/,/g, ''));
              if (!Number.isFinite(n)) return null;
              const usd = n * balances.wordPriceUsd;
              // en-US pinned: in dot-grouping locales "≈$3.800" reads as $3.80.
              return `≈$${usd >= 100 ? Math.round(usd).toLocaleString('en-US') : usd.toFixed(2)}`;
            };
            const jackpotUsd = usdApprox(balances.wordJackpot?.unallocated);
            const bonusBurnUsd = usdApprox(balances.wordManager?.availableForGames);
            const poolUsd = usdApprox(balances.wordJackpot?.pool);
            const treasuryUsd = usdApprox(balances.treasuryWord);

            return (
              <>
                {/* Balances in compact grid. Five tiles: the two $WORD fuel
                    gauges lead — jackpot (WordJackpot unallocated) and
                    bonus/burn (WordManager availableForGames). */}
                <div style={{ ...styles.grid4, gridTemplateColumns: 'repeat(5, 1fr)' }}>
                  <div style={styles.statCard}>
                    <div style={styles.statLabel}>Jackpot Fuel</div>
                    <div style={styles.statValueSmall}>{balances.wordJackpot?.unallocated ?? '--'}</div>
                    <div style={styles.statSubtext}>$WORD unallocated — seeds rounds{jackpotUsd ? ` · ${jackpotUsd}` : ''}</div>
                  </div>
                  <div style={styles.statCard}>
                    <div style={styles.statLabel}>Bonus/Burn Fuel</div>
                    <div style={styles.statValueSmall}>{balances.wordManager?.availableForGames ?? '--'}</div>
                    <div style={styles.statSubtext}>$WORD for bonus + burn + top-10 rewards{bonusBurnUsd ? ` · ${bonusBurnUsd}` : ''}</div>
                  </div>
                  <div style={styles.statCard}>
                    <div style={styles.statLabel}>Live Pool</div>
                    <div style={styles.statValueSmall}>{balances.wordJackpot?.pool ?? '--'}</div>
                    <div style={styles.statSubtext}>
                      {balances.wordJackpot ? `$WORD + ${balances.wordJackpot.carry} carry` : '$WORD'}{poolUsd ? ` · ${poolUsd}` : ''}
                    </div>
                  </div>
                  <div style={styles.statCard}>
                    <div style={styles.statLabel}>Pack Sales</div>
                    <div style={styles.statValueSmall}>{packSalesEth !== null ? packSalesEth.toFixed(4) : '--'}</div>
                    <div style={styles.statSubtext}>ETH awaiting withdraw → treasury</div>
                  </div>
                  <div style={styles.statCard}>
                    <div style={styles.statLabel}>Pending Refunds</div>
                    <div style={styles.statValueSmall}>{parseFloat(balances.pendingRefunds.totalEth).toFixed(4)}</div>
                    <div style={styles.statSubtext}>{balances.pendingRefunds.count} pending (ETH)</div>
                  </div>
                </div>

                {/* Treasury wallet line */}
                <div style={{ marginTop: '12px', fontSize: '12px', color: '#6b7280', display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '4px' }}>
                  <span>
                    Treasury wallet: {parseFloat(balances.prizePool.balanceEth).toFixed(4)} ETH
                    {balances.treasuryWord !== undefined ? ` · ${balances.treasuryWord} $WORD (tranche source${treasuryUsd ? `, ${treasuryUsd}` : ''})` : ''}
                  </span>
                </div>

                {/* ETH-era leftovers — show only while anything remains. Only
                    the creator pool is reachable from this tab, and the
                    contract keeps a 0.02 ETH floor on it, so use the server's
                    floor-aware withdrawable figure rather than the raw pool. */}
                {legacyLeftoverEth > 0.0001 && (() => {
                  const legacyWithdrawableEth = parseFloat(balances.treasury?.withdrawableEth ?? '0');
                  return (
                  <div style={{ marginTop: '8px', fontSize: '12px', color: '#9ca3af', fontStyle: 'italic' }}>
                    ETH era: JackpotManager still holds
                    {legacyCreatorEth > 0.0001
                      ? ` ${legacyCreatorEth.toFixed(4)} ETH creator pool (${
                          legacyWithdrawableEth > 0
                            ? `${legacyWithdrawableEth.toFixed(4)} ETH withdrawable below`
                            : 'at the contract’s 0.02 ETH floor, none withdrawable'
                        })`
                      : ''}
                    {legacyCreatorEth > 0.0001 && legacyJackpotEth > 0.0001 ? ' and' : ''}
                    {legacyJackpotEth > 0.0001 ? ` ${legacyJackpotEth.toFixed(4)} ETH in the old prize pool (contract-side only, not withdrawable from here)` : ''}.
                  </div>
                  );
                })()}
              </>
            );
          })()}
          </>
        ) : null}
      </div>

      {/* Funding directory — every important address, no hunting */}
      {user?.fid && <FundingDirectoryCard fid={user.fid} />}

      {/* Fund Operator Wallet */}
      {balances && (() => {
        const opBal = parseFloat(balances.operatorWallet.balanceEth);
        // Gas-only thresholds: $WORD rounds seed themselves from the
        // WordJackpot tranche, so the operator never fronts a seed anymore.
        // It signs round starts, resolutions, oracle pushes, and bonus/burn
        // payouts — each costs a fraction of a cent on Base.
        const GAS_TARGET_ETH = 0.01;
        const suggestedAmount = opBal < GAS_TARGET_ETH ? GAS_TARGET_ETH - opBal : 0;
        const balColor = opBal < 0.002 ? '#dc2626' : opBal < 0.005 ? '#d97706' : '#16a34a';
        const statusType: 'error' | 'warning' | 'success' =
          opBal < 0.002 ? 'error' : opBal < 0.005 ? 'warning' : 'success';
        const statusMsg =
          opBal < 0.002 ? 'Critically low — round starts and payouts may fail on gas' :
          opBal < 0.005 ? 'Getting low — top up before the next few rounds' :
          'Enough gas for normal operations';

        return (
          <div style={styles.card}>
            <h3 style={{ ...styles.cardTitle, margin: 0 }}>Fund Operator Wallet</h3>
            <p style={{ ...styles.cardSubtitle, margin: '4px 0 16px 0' }}>
              The operator signs every server transaction — round starts, resolutions, oracle
              pushes, bonus and burn payouts. It needs ETH for gas only; $WORD rounds seed
              themselves from the WordJackpot tranche.
            </p>

            {/* Operator balance and info */}
            <div style={styles.grid4}>
              <div style={styles.statCard}>
                <div style={styles.statLabel}>Operator Balance</div>
                <div style={{ ...styles.statValueSmall, color: balColor }}>{opBal.toFixed(4)}</div>
                <div style={styles.statSubtext}>ETH (gas)</div>
              </div>
              <div style={styles.statCard}>
                <div style={styles.statLabel}>Suggested Top-Up</div>
                <div style={styles.statValueSmall}>{suggestedAmount > 0 ? suggestedAmount.toFixed(4) : '--'}</div>
                <div style={styles.statSubtext}>{suggestedAmount > 0 ? `to ${GAS_TARGET_ETH} ETH` : 'Fully funded'}</div>
              </div>
              <div style={styles.statCard}>
                <div style={styles.statLabel}>Operator Address</div>
                <div style={{ fontSize: '12px', fontFamily: 'monospace', wordBreak: 'break-all' as const, marginTop: '4px' }}>
                  <a
                    href={`https://basescan.org/address/${balances.operatorWallet.address}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={styles.link}
                  >
                    {shortenAddress(balances.operatorWallet.address)}
                  </a>
                </div>
              </div>
            </div>

            {/* Status alert */}
            <div style={{ ...styles.alert(statusType), marginTop: '16px', marginBottom: '16px' }}>
              {statusType === 'error' ? '🔴' : statusType === 'warning' ? '🟡' : '🟢'} {statusMsg}
            </div>

            {/* Fund form */}
            <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-end' }}>
              <div style={{ flex: 1 }}>
                <label style={styles.label}>Amount (ETH)</label>
                <input
                  type="text"
                  value={fundOperatorAmount}
                  onChange={(e) => setFundOperatorAmount(e.target.value)}
                  placeholder="0.0000"
                  style={styles.input}
                />
              </div>
              {suggestedAmount > 0 && (
                <button
                  onClick={() => setFundOperatorAmount(suggestedAmount.toFixed(4))}
                  style={{ ...styles.quickBtn, marginBottom: '1px' }}
                >
                  Suggested: {suggestedAmount.toFixed(4)}
                </button>
              )}
              <button
                onClick={() => setShowFundOperatorConfirm(true)}
                disabled={!connectedWallet || !isOnBase || !fundOperatorAmount || parseFloat(fundOperatorAmount) <= 0}
                style={{
                  ...styles.btnPrimary,
                  marginBottom: '1px',
                  ...(!connectedWallet || !isOnBase || !fundOperatorAmount || parseFloat(fundOperatorAmount) <= 0 ? styles.btnDisabled : {}),
                }}
              >
                Fund Operator Wallet
              </button>
            </div>
            {parseFloat(fundOperatorAmount) > 0.1 && (
              <div style={{ ...styles.alert('error'), marginTop: '8px' }}>
                Safety cap: maximum 0.1 ETH per transaction
              </div>
            )}
          </div>
        );
      })()}

      {/* Fee Recipients */}
      {balances && balances.feeRecipients && (
        <div style={styles.card}>
          <h3 style={{ ...styles.cardTitle, margin: 0 }}>Fee Recipients</h3>
          <p style={{ ...styles.cardSubtitle, margin: '4px 0 16px 0' }}>
            Token balances across Uniswap V3 fee recipient wallets
          </p>

          {/* Summary row */}
          <div style={styles.grid4}>
            <div style={styles.statCard}>
              <div style={styles.statLabel}>Total WETH</div>
              <div style={styles.statValueSmall}>{parseFloat(balances.feeRecipients.totals.weth).toFixed(4)}</div>
            </div>
            <div style={styles.statCard}>
              <div style={styles.statLabel}>Total ETH</div>
              <div style={styles.statValueSmall}>{parseFloat(balances.feeRecipients.totals.eth).toFixed(4)}</div>
            </div>
            <div style={styles.statCard}>
              <div style={styles.statLabel}>Total USDC</div>
              <div style={styles.statValueSmall}>{parseFloat(balances.feeRecipients.totals.usdc).toFixed(2)}</div>
            </div>
            <div style={styles.statCard}>
              <div style={styles.statLabel}>Total $WORD</div>
              <div style={styles.statValueSmall}>{Number(balances.feeRecipients.totals.word).toLocaleString()}</div>
            </div>
          </div>

          {/* Recipient cards */}
          <div style={{ ...styles.grid4, marginTop: '16px' }}>
            {balances.feeRecipients.recipients.map((r) => (
              <div key={r.id} style={styles.statCard}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                  <div style={{ fontSize: '13px', fontWeight: 600, color: '#111827' }}>{r.name}</div>
                  <div style={{
                    fontSize: '11px',
                    fontWeight: 600,
                    color: '#2563eb',
                    background: '#eff6ff',
                    padding: '2px 6px',
                    borderRadius: '4px',
                  }}>{r.percent}%</div>
                </div>
                <a
                  href={`https://basescan.org/address/${r.address}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ fontSize: '11px', color: '#6b7280', fontFamily: 'monospace', textDecoration: 'none' }}
                >
                  {r.address.slice(0, 6)}...{r.address.slice(-4)}
                </a>
                <div style={{ marginTop: '10px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: '#374151', marginBottom: '2px' }}>
                    <span>WETH</span>
                    <span style={{ fontWeight: 600 }}>{parseFloat(r.wethBalance).toFixed(4)}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: '#374151', marginBottom: '2px' }}>
                    <span>ETH</span>
                    <span style={{ fontWeight: 600 }}>{parseFloat(r.ethBalance).toFixed(4)}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: '#374151', marginBottom: '2px' }}>
                    <span>USDC</span>
                    <span style={{ fontWeight: 600 }}>{parseFloat(r.usdcBalance).toFixed(2)}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: '#374151', marginBottom: '2px' }}>
                    <span>$WORD</span>
                    <span style={{ fontWeight: 600 }}>{Number(r.wordBalance).toLocaleString()}</span>
                  </div>
                </div>
                <div style={{ fontSize: '10px', color: '#9ca3af', marginTop: '6px' }}>{r.bps} BPS</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* WordManager Funding */}
      {/* Each contract section guards itself: the balances API fails soft per
          block, so a WordManager RPC hiccup must not hide the WordJackpot
          numbers or the live bonus-words switch. */}
      {balances && (
        <div style={styles.card}>
          <h3 style={styles.cardTitle}>📊 $WORD across contracts</h3>
          <p style={styles.cardSubtitle}>
            Where $WORD sits and what each balance funds. WordManager pays the per-round rewards
            (top-10 rewards, bonus and burn words) and holds staking; WordJackpot pays the jackpot
            itself; the treasury wallet is the tranche source for both.
          </p>

          <div style={{ fontSize: '12px', fontWeight: 600, color: '#6b7280', textTransform: 'uppercase' as const, letterSpacing: '0.5px', marginBottom: '8px' }}>
            WordManager — staking + per-round rewards
          </div>
          {!balances.wordManager && (
            <div style={{ fontSize: '12px', color: '#9ca3af', marginBottom: '8px' }}>
              WordManager data unavailable right now (RPC or config) — the sections below are independent.
            </div>
          )}
          {balances.wordManager && (
          <div style={styles.grid4}>
            <div style={styles.statCard}>
              <div style={styles.statLabel}>Total $WORD</div>
              <div style={styles.statValueSmall}>{balances.wordManager.totalBalance}</div>
              <div style={styles.statSubtext}>In contract</div>
            </div>
            <div style={styles.statCard}>
              <div style={styles.statLabel}>Staked by Users</div>
              <div style={styles.statValueSmall}>{balances.wordManager.stakedByUsers}</div>
              <div style={styles.statSubtext}>Locked by stakers</div>
            </div>
            <div style={styles.statCard}>
              <div style={styles.statLabel}>Streaming Rewards</div>
              <div style={styles.statValueSmall}>{balances.wordManager.reservedForStaking}</div>
              <div style={styles.statSubtext}>Reserved for staking period</div>
            </div>
            <div style={styles.statCard}>
              <div style={styles.statLabel}>Available for Games</div>
              <div style={styles.statValueSmall}>{balances.wordManager.availableForGames}</div>
              <div style={styles.statSubtext}>Top-10 / bonus / burn</div>
            </div>
          </div>
          )}

          {/* Rounds available alert */}
          {balances.wordManager && (
          <div style={{
            ...styles.alert(
              balances.wordManager.roundsAvailable >= 5 ? 'success' :
              balances.wordManager.roundsAvailable >= 1 ? 'warning' : 'error'
            ),
            marginTop: '16px',
          }}>
            <span>{balances.wordManager.roundsAvailable >= 5 ? '✅' : balances.wordManager.roundsAvailable >= 1 ? '⚠️' : '🚨'}</span>
            <div>
              <strong>{balances.wordManager.roundsAvailable} rounds</strong> of per-round rewards (top-10 rewards + bonus + burn) available at current economy settings
              {balances.wordManager.roundsAvailable < 5 && (
                <div style={{ marginTop: '4px', fontSize: '12px', opacity: 0.8 }}>
                  Consider transferring more $WORD to the WordManager contract — see the Funding directory above
                </div>
              )}
            </div>
          </div>
          )}

          {/* WordJackpot — jackpot prizes */}
          <div style={{ fontSize: '12px', fontWeight: 600, color: '#6b7280', textTransform: 'uppercase' as const, letterSpacing: '0.5px', margin: '20px 0 8px 0' }}>
            WordJackpot — jackpot prizes
          </div>
          {balances.wordJackpot ? (
            <div style={styles.grid4}>
              <div style={styles.statCard}>
                <div style={styles.statLabel}>Unallocated</div>
                <div style={styles.statValueSmall}>{balances.wordJackpot.unallocated}</div>
                <div style={styles.statSubtext}>Seeds future rounds</div>
              </div>
              <div style={styles.statCard}>
                <div style={styles.statLabel}>Live Pool</div>
                <div style={styles.statValueSmall}>{balances.wordJackpot.pool}</div>
                <div style={styles.statSubtext}>Current round&apos;s prize</div>
              </div>
              <div style={styles.statCard}>
                <div style={styles.statLabel}>Carry</div>
                <div style={styles.statValueSmall}>{balances.wordJackpot.carry}</div>
                <div style={styles.statSubtext}>Rolls into next round</div>
              </div>
              <div style={styles.statCard}>
                <div style={styles.statLabel}>Pending Claims</div>
                <div style={styles.statValueSmall}>{balances.wordJackpot.claimable}</div>
                <div style={styles.statSubtext}>Deferred payouts</div>
              </div>
            </div>
          ) : (
            <div style={{ fontSize: '12px', color: '#9ca3af' }}>
              Not configured — set <code>WORD_JACKPOT_ADDRESS</code> to see jackpot balances here.
            </div>
          )}

          {/* Treasury wallet $WORD */}
          {balances.treasuryWord !== undefined && (
            <div style={{ marginTop: '12px', fontSize: '12px', color: '#6b7280' }}>
              Treasury wallet holds <strong>{balances.treasuryWord} $WORD</strong> — the tranche
              source for both contracts (hand-signed transfers).
            </div>
          )}

          {/* Bonus words master switch. The flag lives on the legacy
              JackpotManager contract, but createRound still reads it at every
              round start to decide whether the round gets bonus + burn words —
              it is a live control, not a legacy one. */}
          <div style={{ marginTop: '16px', paddingTop: '12px', borderTop: '1px solid #e5e7eb', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap' as const, gap: '8px' }}>
            <div>
              <span style={{ fontSize: '13px', fontWeight: 600, fontFamily }}>Bonus words</span>
              <span style={{ fontSize: '12px', color: '#6b7280', marginLeft: '8px' }}>
                Round-start switch for bonus + burn words
              </span>
            </div>
            {wordTokenStatus ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '12px', fontWeight: 600, color: wordTokenStatus.bonusWordsEnabled ? '#16a34a' : '#9ca3af' }}>
                  {wordTokenStatus.bonusWordsEnabled ? 'ENABLED' : 'DISABLED'}
                </span>
                <button
                  onClick={() => handleBonusWordsToggle(!wordTokenStatus.bonusWordsEnabled)}
                  disabled={bonusWordsToggleLoading}
                  style={{ ...styles.btnSecondary, ...styles.btnSmall }}
                >
                  {bonusWordsToggleLoading ? 'Toggling…' : wordTokenStatus.bonusWordsEnabled ? 'Disable' : 'Enable'}
                </button>
              </div>
            ) : (
              <span style={{ fontSize: '12px', color: '#9ca3af' }}>{wordTokenLoading ? 'Loading…' : '--'}</span>
            )}
          </div>
          {wordTokenError && (
            <div style={{ ...styles.alert('error'), marginTop: '8px' }}>{wordTokenError}</div>
          )}

          {/* Staking depletion warning */}
          {balances.wordManager && balances.wordManager.stakingHealthy === false && (
            <div style={{
              ...styles.alert('error'),
              marginTop: '12px',
            }}>
              <span>🚨</span>
              <div>
                <strong>Staking at risk</strong>: token balance is close to total staked (headroom: {balances.wordManager.stakingHeadroom} $WORD).
                Game distributions may make staker withdrawals fail. Transfer more $WORD to the WordManager contract.
              </div>
            </div>
          )}

          {/* Contract address, staking period, and activation — all
              WordManager-backed */}
          {balances.wordManager && (<>
          <div style={{ marginTop: '16px', display: 'flex', flexDirection: 'column' as const, gap: '8px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '12px', color: '#6b7280', fontFamily }}>Contract</span>
              <a
                href={`https://basescan.org/address/${balances.wordManager.address}`}
                target="_blank"
                rel="noopener noreferrer"
                style={{ ...styles.link, fontSize: '12px', fontFamily: 'monospace' }}
              >
                {balances.wordManager.address.slice(0, 6)}...{balances.wordManager.address.slice(-4)}
              </a>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '12px', color: '#6b7280', fontFamily }}>Staking period</span>
              <span style={{ fontSize: '12px', fontFamily }}>
                {balances.wordManager.stakingPeriodActive ? (
                  <span style={{ color: '#16a34a' }}>
                    Active until {formatCentralDate(balances.wordManager.stakingPeriodEnds)}
                  </span>
                ) : (
                  <span style={{ color: '#dc2626' }}>Inactive</span>
                )}
              </span>
            </div>
          </div>

          {/* Streaming rewards activation */}
          <div style={{ marginTop: '20px', paddingTop: '16px', borderTop: '1px solid #e5e7eb' }}>
            <div style={{ fontSize: '13px', fontWeight: 600, marginBottom: '4px', fontFamily }}>
              Activate streaming rewards
            </div>
            <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '12px', fontFamily }}>
              Call <code>notifyRewardAmount()</code> to start a 30-day streaming period. Choose one:
              <br />
              <strong>Activate with existing balance</strong> — use tokens already in the contract
              (from the <em>Available for Games</em> bucket).
              <br />
              <strong>Send & Activate</strong> — transfer $WORD from your connected wallet to the
              contract, then activate.
            </div>

            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
              <input
                type="number"
                placeholder="Amount in $WORD (e.g. 50000)"
                value={activateAmount}
                onChange={(e) => setActivateAmount(e.target.value)}
                style={{ ...styles.input, flex: '1 1 220px', minWidth: '200px' }}
                disabled={isActivating}
              />
              <button
                onClick={() => {
                  setActivateError(null);
                  setActivateResult(null);
                  setActivateMode('existing');
                }}
                disabled={
                  !connectedWallet ||
                  !isOnBase ||
                  !activateAmount ||
                  parseFloat(activateAmount) <= 0 ||
                  isActivating
                }
                style={{
                  ...styles.btnPrimary,
                  ...((!connectedWallet ||
                    !isOnBase ||
                    !activateAmount ||
                    parseFloat(activateAmount) <= 0 ||
                    isActivating)
                    ? styles.btnDisabled
                    : {}),
                }}
                title="Tokens must already be in the WordManager contract"
              >
                Activate with existing balance
              </button>
              <button
                onClick={() => {
                  setActivateError(null);
                  setActivateResult(null);
                  setActivateMode('send');
                }}
                disabled={
                  !connectedWallet ||
                  !isOnBase ||
                  !activateAmount ||
                  parseFloat(activateAmount) <= 0 ||
                  isActivating
                }
                style={{
                  ...styles.btnSecondary,
                  ...((!connectedWallet ||
                    !isOnBase ||
                    !activateAmount ||
                    parseFloat(activateAmount) <= 0 ||
                    isActivating)
                    ? styles.btnDisabled
                    : {}),
                }}
                title="Sign a transfer from your connected wallet, then activate"
              >
                Send & Activate
              </button>
            </div>

            {/* Warn when amount exceeds non-staked (formatted strings, so strip commas) */}
            {(() => {
              const available = parseFloat(
                (balances.wordManager.availableForGames || '0').replace(/,/g, '')
              );
              const entered = parseFloat(activateAmount || '0');
              if (
                activateMode === null &&
                entered > 0 &&
                Number.isFinite(available) &&
                entered > available
              ) {
                return (
                  <div style={{ ...styles.alert('warning'), marginTop: '8px', fontSize: '12px' }}>
                    <span>⚠️</span>
                    <div>
                      Amount exceeds non-staked balance ({balances.wordManager.availableForGames}{' '}
                      $WORD). Use <strong>Send & Activate</strong> to transfer the shortfall first,
                      or the contract will revert with <code>RewardTooHigh</code>.
                    </div>
                  </div>
                );
              }
              return null;
            })()}

            {activateError && (
              <div style={{ ...styles.alert('error'), marginTop: '8px', fontSize: '12px' }}>
                <span>🚨</span>
                <div>{activateError}</div>
              </div>
            )}

            {activateResult && (
              <div style={{ ...styles.alert('success'), marginTop: '8px', fontSize: '12px' }}>
                <span>✅</span>
                <div>
                  Streaming rewards activated.
                  {activateResult.transferTxHash && (
                    <>
                      {' '}
                      <a
                        href={`https://basescan.org/tx/${activateResult.transferTxHash}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={styles.link}
                      >
                        Transfer tx
                      </a>
                    </>
                  )}
                  {activateResult.notifyTxHash && (
                    <>
                      {activateResult.transferTxHash ? ' · ' : ' '}
                      <a
                        href={`https://basescan.org/tx/${activateResult.notifyTxHash}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={styles.link}
                      >
                        notifyRewardAmount tx
                      </a>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
          </>)}
        </div>
      )}

      {user?.fid && (
        <PurchaseEventsCard fid={user.fid} currentRoundId={opStatus?.activeRoundId} />
      )}


      {/* Prize Pool Injection Instructions */}

      {/* Treasury Withdrawal */}
      <div style={styles.card}>
        <h3 style={styles.cardTitle}>Withdraw from Treasury</h3>
        <p style={styles.cardSubtitle}>
          Withdraw the legacy contract&apos;s accumulated creator profit (ETH era). The contract
          itself retains 0.02 ETH on withdrawal — a V3 contract rule, not a seed reservation.
        </p>

        {balances && (() => {
          const treasury = balances.treasury ?? null;

          if (!treasury) return null;

          return (
            <div style={{ ...styles.statCard, marginBottom: '16px', textAlign: 'left' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                <span style={{ color: '#6b7280' }}>Total treasury balance:</span>
                <span style={{ fontWeight: 600 }}>{parseFloat(treasury.balanceEth).toFixed(6)} ETH</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                <span style={{ color: '#6b7280' }}>Reserved for seed:</span>
                <span style={{ color: '#f59e0b' }}>−{parseFloat(treasury.contributingToSeedEth || '0').toFixed(6)} ETH</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', borderTop: '1px solid #e5e7eb', paddingTop: '8px' }}>
                <span style={{ color: '#6b7280', fontWeight: 500 }}>Withdrawable:</span>
                <span style={{ fontWeight: 600, color: treasury.isWithdrawable ? '#16a34a' : '#9ca3af' }}>
                  {parseFloat(treasury.withdrawableEth).toFixed(6)} ETH
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <span style={{ color: '#6b7280' }}>Destination:</span>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontFamily: 'monospace', fontSize: '12px', fontWeight: 500 }}>
                    {CREATOR_PROFIT_WALLET}
                  </div>
                  <div style={{ fontSize: '11px', color: '#9ca3af' }}>
                    Creator Profit Wallet
                  </div>
                </div>
              </div>
            </div>
          );
        })()}

        <div style={styles.alert('info')}>
          <span>ℹ️</span>
          <span>
            The legacy V3 contract keeps a 0.02 ETH floor on withdrawal (onchain rule).
            Everything above that floor is withdrawable.
          </span>
        </div>

        {(() => {
          const treasury = balances?.treasury ?? null;

          if (!treasury) return null;

          if (!treasury.isWithdrawable) {
            return (
              <div style={{ ...styles.alert('warning'), marginTop: '16px' }}>
                ⚠️ No withdrawable balance. The remaining {parseFloat(treasury.balanceEth).toFixed(4)} ETH sits at or under the contract&apos;s 0.02 ETH withdrawal floor.
              </div>
            );
          }

          return (
            <button
              onClick={() => setShowWithdrawConfirm(true)}
              disabled={!connectedWallet || !isOnBase || parseFloat(treasury.withdrawableEth) === 0}
              style={{
                ...styles.btnDanger,
                marginTop: '16px',
                ...(!connectedWallet || !isOnBase || parseFloat(treasury.withdrawableEth) === 0 ? styles.btnDisabled : {}),
              }}
            >
              Withdraw {parseFloat(treasury.withdrawableEth).toFixed(4)} ETH to Creator Wallet
            </button>
          );
        })()}
      </div>

      {/* Transaction History */}
      <div style={styles.card}>
        <h3 style={styles.cardTitle}>Recent Wallet Actions</h3>

        {actionsLoading ? (
          <div style={{ padding: '24px', textAlign: 'center', color: '#6b7280' }}>Loading...</div>
        ) : actions.length === 0 ? (
          <div style={{ padding: '24px', textAlign: 'center', color: '#6b7280' }}>No wallet actions recorded yet.</div>
        ) : (
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Time</th>
                <th style={styles.th}>Action</th>
                <th style={styles.th}>Amount</th>
                <th style={styles.th}>Status</th>
                <th style={styles.th}>Tx Hash</th>
                <th style={styles.th}>Initiated By</th>
              </tr>
            </thead>
            <tbody>
              {actions.map((action) => (
                <tr key={action.id}>
                  <td style={styles.td}>
                    {formatCentral(action.createdAt)}
                  </td>
                  <td style={styles.td}>
                    <span style={styles.badge(
                      action.actionType === 'prize_pool_injection' ? 'green' :
                      action.actionType === 'operator_funding' ? 'green' :
                      action.actionType === 'creator_pool_withdrawal' ? 'yellow' :
                      'gray'
                    )}>
                      {action.actionType.replace(/_/g, ' ')}
                    </span>
                  </td>
                  <td style={styles.td}>{parseFloat(action.amountEth).toFixed(4)} ETH</td>
                  <td style={styles.td}>
                    <span style={styles.badge(
                      action.status === 'confirmed' ? 'green' :
                      action.status === 'failed' ? 'red' :
                      'yellow'
                    )}>
                      {action.status}
                    </span>
                  </td>
                  <td style={styles.td}>
                    {action.txHash ? (
                      <a
                        href={`https://basescan.org/tx/${action.txHash}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={styles.link}
                      >
                        {shortenAddress(action.txHash)}
                      </a>
                    ) : (
                      <span style={{ color: '#9ca3af' }}>--</span>
                    )}
                  </td>
                  <td style={styles.td}>
                    FID {action.initiatedByFid}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Bonus Word Distributions */}

      {/* Withdraw Confirmation Modal */}
      {showWithdrawConfirm && balances && connectedWallet && (() => {
        const treasury = balances.treasury ?? null;
        if (!treasury) return null;
        return (
        <div style={styles.modal} onClick={() => setShowWithdrawConfirm(false)}>
          <div style={styles.modalContent} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ ...styles.cardTitle, marginBottom: '16px' }}>⚠️ Confirm Withdrawal</h3>

            <div style={{ ...styles.alert('warning'), marginBottom: '16px' }}>
              This action is <strong>irreversible</strong>. The contract will withdraw ALL accumulated profits.
            </div>

            <div style={{ ...styles.statCard, marginBottom: '16px', textAlign: 'left' }}>
              <div style={{ marginBottom: '8px' }}>
                <span style={{ color: '#6b7280' }}>From (Contract):</span>
                <div style={{ fontFamily: 'monospace', fontSize: '13px' }}>{balances.contractAddress}</div>
              </div>
              <div style={{ marginBottom: '8px' }}>
                <span style={{ color: '#6b7280' }}>To (Creator Profit Wallet):</span>
                <div style={{ fontFamily: 'monospace', fontSize: '13px' }}>{treasury.address || CREATOR_PROFIT_WALLET}</div>
              </div>
              <div>
                <span style={{ color: '#6b7280' }}>Amount:</span>
                <div style={{ fontWeight: 600, fontSize: '18px' }}>{parseFloat(treasury.withdrawableEth).toFixed(6)} ETH</div>
              </div>
            </div>

            <div style={{ marginBottom: '16px' }}>
              <label style={styles.label}>Type "WITHDRAW" to confirm:</label>
              <input
                type="text"
                value={withdrawConfirmText}
                onChange={(e) => setWithdrawConfirmText(e.target.value.toUpperCase())}
                placeholder="WITHDRAW"
                style={{
                  ...styles.input,
                  ...(withdrawConfirmText && withdrawConfirmText !== 'WITHDRAW' ? styles.inputError : {}),
                }}
              />
            </div>

            <div style={{ display: 'flex', gap: '12px' }}>
              <button
                onClick={() => {
                  setShowWithdrawConfirm(false);
                  setWithdrawConfirmText('');
                }}
                style={styles.btnSecondary}
              >
                Cancel
              </button>
              <button
                onClick={handleWithdraw}
                disabled={isWithdrawing || withdrawConfirmText !== 'WITHDRAW'}
                style={{
                  ...styles.btnDanger,
                  flex: 1,
                  ...(isWithdrawing || withdrawConfirmText !== 'WITHDRAW' ? styles.btnDisabled : {}),
                }}
              >
                {isWithdrawing ? 'Processing...' : 'Confirm Withdrawal'}
              </button>
            </div>
          </div>
        </div>
        );
      })()}

      {/* Fund Operator Confirmation Modal */}
      {showFundOperatorConfirm && balances && connectedWallet && (
        <div style={styles.modal} onClick={() => setShowFundOperatorConfirm(false)}>
          <div style={styles.modalContent} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ ...styles.cardTitle, marginBottom: '16px' }}>Fund Operator Wallet</h3>

            <div style={{ ...styles.alert('info'), marginBottom: '16px' }}>
              You are sending ETH directly to the operator wallet (EOA). This is a plain ETH transfer.
            </div>

            <div style={{ ...styles.statCard, marginBottom: '16px', textAlign: 'left' }}>
              <div style={{ marginBottom: '8px' }}>
                <span style={{ color: '#6b7280' }}>From (Your Wallet):</span>
                <div style={{ fontFamily: 'monospace', fontSize: '13px' }}>{connectedWallet.address}</div>
              </div>
              <div style={{ marginBottom: '8px' }}>
                <span style={{ color: '#6b7280' }}>To (Operator):</span>
                <div style={{ fontFamily: 'monospace', fontSize: '13px' }}>{balances.operatorWallet.address}</div>
              </div>
              <div>
                <span style={{ color: '#6b7280' }}>Amount:</span>
                <div style={{ fontWeight: 600, fontSize: '18px' }}>{fundOperatorAmount} ETH</div>
              </div>
            </div>

            {parseFloat(fundOperatorAmount) > 0.1 && (
              <div style={{ ...styles.alert('error'), marginBottom: '16px' }}>
                Exceeds 0.1 ETH safety cap. Transaction will be rejected.
              </div>
            )}

            <div style={{ marginBottom: '16px' }}>
              <label style={styles.label}>Type &quot;FUND&quot; to confirm:</label>
              <input
                type="text"
                value={fundOperatorConfirmText}
                onChange={(e) => setFundOperatorConfirmText(e.target.value.toUpperCase())}
                placeholder="FUND"
                style={{
                  ...styles.input,
                  ...(fundOperatorConfirmText && fundOperatorConfirmText !== 'FUND' ? styles.inputError : {}),
                }}
              />
            </div>

            <div style={{ display: 'flex', gap: '12px' }}>
              <button
                onClick={() => {
                  setShowFundOperatorConfirm(false);
                  setFundOperatorConfirmText('');
                }}
                style={styles.btnSecondary}
              >
                Cancel
              </button>
              <button
                onClick={handleFundOperator}
                disabled={isFundingOperator || fundOperatorConfirmText !== 'FUND' || parseFloat(fundOperatorAmount) > 0.1}
                style={{
                  ...styles.btnPrimary,
                  flex: 1,
                  ...(isFundingOperator || fundOperatorConfirmText !== 'FUND' || parseFloat(fundOperatorAmount) > 0.1 ? styles.btnDisabled : {}),
                }}
              >
                {isFundingOperator ? 'Processing...' : 'Confirm & Send ETH'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Activate Streaming Rewards Confirmation Modal */}
      {activateMode && balances?.wordManager && connectedWallet && (
        <div
          style={styles.modal}
          onClick={() => {
            if (isActivating) return;
            // Backdrop close — warn loudly if a transfer is already committed.
            if (
              committedTransferTxHash &&
              !window.confirm(
                `Your $WORD transfer already confirmed but streaming is not yet active. Close anyway? You can activate later via "Activate with existing balance".`
              )
            ) {
              return;
            }
            setActivateMode(null);
            setActivateConfirmText('');
            setActivateError(null);
            setCommittedTransferTxHash(null);
          }}
        >
          <div style={styles.modalContent} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ ...styles.cardTitle, marginBottom: '16px' }}>
              {activateMode === 'send' ? '⚡ Send & Activate Streaming' : '⚡ Activate Streaming Rewards'}
            </h3>

            <div style={{ ...styles.alert('warning'), marginBottom: '16px' }}>
              {activateMode === 'send' ? (
                <>
                  This will <strong>sign a $WORD transfer</strong> from your connected wallet and
                  then call <code>notifyRewardAmount()</code>. Rolls into the current period if one
                  is already active.
                </>
              ) : (
                <>
                  This will call <code>notifyRewardAmount()</code> with the specified amount. Tokens
                  must already be in the WordManager contract (they are, if they show up in{' '}
                  <em>Available for Games</em>). Rolls into the current period if one is already
                  active.
                </>
              )}
            </div>

            <div style={{ ...styles.statCard, marginBottom: '16px', textAlign: 'left' }}>
              <div style={{ marginBottom: '8px' }}>
                <span style={{ color: '#6b7280' }}>Amount:</span>
                <div style={{ fontWeight: 600, fontSize: '18px' }}>
                  {parseFloat(activateAmount || '0').toLocaleString()} $WORD
                </div>
              </div>
              <div style={{ marginBottom: '8px' }}>
                <span style={{ color: '#6b7280' }}>
                  {activateMode === 'send' ? 'From (connected wallet):' : 'Source:'}
                </span>
                <div style={{ fontFamily: 'monospace', fontSize: '13px', wordBreak: 'break-all' }}>
                  {activateMode === 'send'
                    ? connectedWallet.address
                    : 'Existing WordManager balance'}
                </div>
              </div>
              <div>
                <span style={{ color: '#6b7280' }}>WordManager contract:</span>
                <div style={{ fontFamily: 'monospace', fontSize: '13px', wordBreak: 'break-all' }}>
                  {balances.wordManager.address}
                </div>
              </div>
            </div>

            <div style={{ marginBottom: '16px' }}>
              <label style={styles.label}>Type &quot;STREAM&quot; to confirm:</label>
              <input
                type="text"
                value={activateConfirmText}
                onChange={(e) => setActivateConfirmText(e.target.value.toUpperCase())}
                placeholder="STREAM"
                disabled={isActivating}
                style={{
                  ...styles.input,
                  ...(activateConfirmText && activateConfirmText !== 'STREAM'
                    ? styles.inputError
                    : {}),
                }}
              />
            </div>

            {activateProgress && (
              <div style={{ ...styles.alert('info'), marginBottom: '12px', fontSize: '12px' }}>
                <span>⏳</span>
                <div>{activateProgress}</div>
              </div>
            )}

            {activateError && (
              <div style={{ ...styles.alert('error'), marginBottom: '12px', fontSize: '12px' }}>
                <span>🚨</span>
                <div>{activateError}</div>
              </div>
            )}

            <div style={{ display: 'flex', gap: '12px' }}>
              <button
                onClick={() => {
                  if (
                    committedTransferTxHash &&
                    !window.confirm(
                      `Your $WORD transfer already confirmed but streaming is not yet active. Cancel anyway? You can activate later via "Activate with existing balance".`
                    )
                  ) {
                    return;
                  }
                  setActivateMode(null);
                  setActivateConfirmText('');
                  setActivateError(null);
                  setCommittedTransferTxHash(null);
                }}
                disabled={isActivating}
                style={{
                  ...styles.btnSecondary,
                  flex: 1,
                  ...(isActivating ? styles.btnDisabled : {}),
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleActivateStreaming}
                disabled={isActivating || activateConfirmText !== 'STREAM'}
                style={{
                  ...styles.btnPrimary,
                  flex: 1,
                  ...(isActivating || activateConfirmText !== 'STREAM' ? styles.btnDisabled : {}),
                }}
              >
                {isActivating
                  ? 'Processing…'
                  : activateMode === 'send'
                    ? 'Confirm, Send & Activate'
                    : 'Confirm & Activate'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// =============================================================================
// Helpers
// =============================================================================


function getChainName(chainId: number): string {
  switch (chainId) {
    case 1: return 'Ethereum';
    case 8453: return 'Base';
    case 84531: return 'Base Goerli';
    case 84532: return 'Base Sepolia';
    case 10: return 'Optimism';
    case 42161: return 'Arbitrum';
    case 137: return 'Polygon';
    default: return `Chain ${chainId}`;
  }
}


// TypeScript declaration for window.ethereum
declare global {
  interface Window {
    ethereum?: {
      request: (args: { method: string; params?: unknown[] }) => Promise<any>;
      on: (event: string, callback: (...args: any[]) => void) => void;
      removeListener: (event: string, callback: (...args: any[]) => void) => void;
    };
  }
}
