/**
 * Wallet Section Component
 * Admin-only wallet management with guardrails and clear visibility
 */

import React, { useState, useEffect, useCallback } from 'react';
import { ethers } from 'ethers';

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
  creatorPool: {
    address: string;
    accumulatedEth: string;
  };
  clanktonRewards?: {
    tokenAddress: string;
    balance: string; // Human readable whole number
    balanceRaw: string;
  };
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

interface FailedBonusClaim {
  claimId: number;
  bonusWordId: number;
  fid: number;
  username: string | null;
  walletAddress: string;
  txStatus: string;
  txHash: string | null;
  errorMessage: string | null;
  claimedAt: string;
  retryCount: number;
  wordIndex: number;
  roundId: number;
}

interface BonusWordWithoutTx {
  bonusWordId: number;
  roundId: number;
  wordIndex: number;
  claimedByFid: number;
  username: string | null;
  claimedAt: string;
  txHash: string | null;
}

interface RetrySuccess {
  id: number | string;
  txHash: string;
  walletAddress?: string;
}

interface BonusDistributionStatus {
  failedClaims: FailedBonusClaim[];
  claimedWithoutTx: BonusWordWithoutTx[];
  contractClanktonBalance: string;
  totalFailedOrPending: number;
}

interface OperationalStatus {
  status: 'NORMAL' | 'KILL_SWITCH_ACTIVE' | 'DEAD_DAY_ACTIVE' | 'PAUSED_BETWEEN_ROUNDS';
  killSwitch: { enabled: boolean };
  deadDay: { enabled: boolean };
}

interface RoundFieldAnalysis {
  type: string;
  isDate: boolean;
  constructorName: string;
  value: any;
  length: number | null;
}

interface RoundDebugResult {
  roundId: number;
  status: string;
  fieldAnalysis: Record<string, RoundFieldAnalysis>;
  problemFields: Array<{ field: string } & RoundFieldAnalysis>;
}

interface FixFieldResult {
  success: boolean;
  field: string;
  oldValue: any;
  newValue: any;
  error?: string;
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
// Styles
// =============================================================================

const fontFamily = "'Söhne', 'SF Pro Display', system-ui, -apple-system, sans-serif";

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
  const [opStatus, setOpStatus] = useState<OperationalStatus | null>(null);

  // Actions state
  const [actions, setActions] = useState<WalletAction[]>([]);
  const [actionsLoading, setActionsLoading] = useState(true);

  // Withdrawal form state
  const [withdrawConfirmText, setWithdrawConfirmText] = useState('');
  const [isWithdrawing, setIsWithdrawing] = useState(false);
  const [showWithdrawConfirm, setShowWithdrawConfirm] = useState(false);

  // Bonus distribution state
  const [bonusDistStatus, setBonusDistStatus] = useState<BonusDistributionStatus | null>(null);
  const [bonusDistLoading, setBonusDistLoading] = useState(false);
  const [bonusDistError, setBonusDistError] = useState<string | null>(null);
  const [retryingClaimId, setRetryingClaimId] = useState<number | null>(null);
  const [retryingBonusWordId, setRetryingBonusWordId] = useState<number | null>(null);
  const [retryingAll, setRetryingAll] = useState(false);
  const [retrySuccesses, setRetrySuccesses] = useState<RetrySuccess[]>([]);
  const [retryAllResult, setRetryAllResult] = useState<{ successful: number; failed: number } | null>(null);

  // Round data repair state
  const [roundDebugId, setRoundDebugId] = useState<string>('');
  const [roundDebugResult, setRoundDebugResult] = useState<RoundDebugResult | null>(null);
  const [roundDebugLoading, setRoundDebugLoading] = useState(false);
  const [roundDebugError, setRoundDebugError] = useState<string | null>(null);
  const [fixingField, setFixingField] = useState<string | null>(null);
  const [fixFieldValue, setFixFieldValue] = useState<string>('');
  const [fixFieldResult, setFixFieldResult] = useState<FixFieldResult | null>(null);

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

  const fetchOperationalStatus = useCallback(async () => {
    if (!user?.fid) return;

    try {
      const res = await fetch(`/api/admin/operational/status?devFid=${user.fid}`);
      if (res.ok) {
        const data = await res.json();
        setOpStatus(data);
      }
    } catch (err) {
      // Silent fail
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

  const fetchBonusDistStatus = useCallback(async () => {
    if (!user?.fid) return;

    setBonusDistLoading(true);
    setBonusDistError(null);
    try {
      const res = await fetch(`/api/admin/operational/retry-bonus-distribution?devFid=${user.fid}`);
      if (res.ok) {
        const data = await res.json();
        setBonusDistStatus(data);
      } else {
        const err = await res.json();
        setBonusDistError(err.error || 'Failed to fetch bonus distribution status');
      }
    } catch (err) {
      setBonusDistError('Failed to fetch bonus distribution status');
    } finally {
      setBonusDistLoading(false);
    }
  }, [user?.fid]);

  const debugRound = async (roundId: string) => {
    if (!user?.fid || !roundId) return;

    setRoundDebugLoading(true);
    setRoundDebugError(null);
    setRoundDebugResult(null);
    setFixFieldResult(null);

    try {
      const res = await fetch(`/api/admin/debug-round2?devFid=${user.fid}&roundId=${roundId}`);
      if (res.ok) {
        const data = await res.json();
        setRoundDebugResult(data);
      } else {
        const err = await res.json();
        setRoundDebugError(err.error || 'Failed to debug round');
      }
    } catch (err) {
      setRoundDebugError('Failed to debug round');
    } finally {
      setRoundDebugLoading(false);
    }
  };

  const fixRoundField = async (roundId: number, field: string, value: string) => {
    if (!user?.fid) return;

    setFixingField(field);
    setFixFieldResult(null);

    try {
      const res = await fetch('/api/admin/fix-round-field', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fid: user.fid,
          roundId,
          field,
          value,
        }),
      });

      const data = await res.json();
      if (res.ok && data.success) {
        setFixFieldResult({
          success: true,
          field,
          oldValue: data.oldValue,
          newValue: data.newValue,
        });
        // Refresh the debug info
        await debugRound(String(roundId));
      } else {
        setFixFieldResult({
          success: false,
          field,
          oldValue: null,
          newValue: null,
          error: data.error || 'Unknown error',
        });
      }
    } catch (err: any) {
      setFixFieldResult({
        success: false,
        field,
        oldValue: null,
        newValue: null,
        error: err.message || 'Request failed',
      });
    } finally {
      setFixingField(null);
      setFixFieldValue('');
    }
  };

  const retryBonusClaim = async (claimId: number) => {
    if (!user?.fid) return;

    setRetryingClaimId(claimId);
    try {
      const res = await fetch('/api/admin/operational/retry-bonus-distribution', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fid: user.fid, claimId }),
      });

      const data = await res.json();
      if (res.ok && data.success) {
        setRetrySuccesses((prev) => [...prev, { id: `claim-${claimId}`, txHash: data.txHash }]);
        await fetchBonusDistStatus();
      } else {
        alert(`Failed: ${data.error || 'Unknown error'}`);
      }
    } catch (err: any) {
      alert(`Error: ${err.message}`);
    } finally {
      setRetryingClaimId(null);
    }
  };

  const retryBonusWordWithoutTx = async (bonusWordId: number) => {
    if (!user?.fid) return;

    setRetryingBonusWordId(bonusWordId);
    try {
      const res = await fetch('/api/admin/operational/retry-bonus-distribution', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fid: user.fid, bonusWordId }),
      });

      const data = await res.json();
      if (res.ok && data.success) {
        setRetrySuccesses((prev) => [...prev, { id: `bw-${bonusWordId}`, txHash: data.txHash, walletAddress: data.walletAddress }]);
        await fetchBonusDistStatus();
      } else {
        alert(`Failed: ${data.error || 'Unknown error'}`);
      }
    } catch (err: any) {
      alert(`Error: ${err.message}`);
    } finally {
      setRetryingBonusWordId(null);
    }
  };

  const retryAllFailed = async () => {
    if (!user?.fid) return;
    if (!confirm('Retry all failed bonus word distributions?')) return;

    setRetryingAll(true);
    setRetryAllResult(null);
    try {
      const res = await fetch('/api/admin/operational/retry-bonus-distribution', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fid: user.fid, all: true }),
      });

      const data = await res.json();
      if (res.ok && data.results) {
        const successful = data.results.filter((r: any) => r.success).length;
        const failed = data.results.filter((r: any) => r.error).length;
        setRetryAllResult({ successful, failed });
        // Add successful transactions to the list
        const successfulTxs = data.results
          .filter((r: any) => r.success)
          .map((r: any) => ({ id: `claim-${r.claimId}`, txHash: r.txHash }));
        setRetrySuccesses((prev) => [...prev, ...successfulTxs]);
        await fetchBonusDistStatus();
      } else {
        alert(`Failed: ${data.error || 'Unknown error'}`);
      }
    } catch (err: any) {
      alert(`Error: ${err.message}`);
    } finally {
      setRetryingAll(false);
    }
  };

  useEffect(() => {
    checkWalletConnection();
    fetchBalances();
    fetchOperationalStatus();
    fetchActions();
    fetchBonusDistStatus();

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
  }, [checkWalletConnection, fetchBalances, fetchOperationalStatus, fetchActions, fetchBonusDistStatus]);

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

    setIsWithdrawing(true);
    setWalletError(null);

    try {
      // The amount being withdrawn (for logging purposes)
      const withdrawAmountEth = balances.creatorPool.accumulatedEth;

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
          actionType: 'creator_pool_withdrawal',
          amountEth: withdrawAmountEth,
          fromAddress: balances.contractAddress,
          toAddress: CREATOR_PROFIT_WALLET,
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

  return (
    <div>
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
                Last updated: {new Date(balances.lastUpdated).toLocaleTimeString()}
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

        {balancesError ? (
          <div style={styles.alert('error')}>{balancesError}</div>
        ) : balancesLoading ? (
          <div style={{ padding: '24px', textAlign: 'center', color: '#6b7280' }}>Loading balances...</div>
        ) : balances ? (
          <>
          {balances.contractError && (
            <div style={{ ...styles.alert('warning'), marginBottom: '16px' }}>
              ⚠️ <strong>Contract unavailable:</strong> {balances.contractError}. Jackpot and creator pool values may not be accurate.
            </div>
          )}
          <div style={styles.grid5}>
            <div style={styles.statCard}>
              <div style={styles.statLabel}>Connected Wallet</div>
              <div style={styles.statValue}>{connectedBalance ? parseFloat(connectedBalance).toFixed(4) : '--'}</div>
              <div style={styles.statSubtext}>ETH</div>
              {connectedWallet && <div style={styles.address}>{shortenAddress(connectedWallet.address)}</div>}
            </div>
            <div style={styles.statCard}>
              <div style={styles.statLabel}>Prize Pool / Jackpot</div>
              <div style={styles.statValue}>{parseFloat(balances.prizePool.currentJackpotEth).toFixed(4)}</div>
              <div style={styles.statSubtext}>ETH</div>
              <div style={styles.address}>{shortenAddress(balances.prizePool.address)}</div>
            </div>
            <div style={styles.statCard}>
              <div style={styles.statLabel}>Creator Pool</div>
              <div style={styles.statValue}>{parseFloat(balances.creatorPool.accumulatedEth).toFixed(4)}</div>
              <div style={styles.statSubtext}>ETH (withdrawable)</div>
              <div style={styles.address}>{shortenAddress(balances.creatorPool.address)}</div>
            </div>
            <div style={styles.statCard}>
              <div style={styles.statLabel}>CLANKTON Balance</div>
              <div style={styles.statValue}>{formatClanktonBalance(balances.clanktonRewards?.balance || '0')}</div>
              <div style={styles.statSubtext}>Bonus word rewards</div>
              <div style={styles.address}>{shortenAddress(balances.contractAddress)}</div>
            </div>
            <div style={styles.statCard}>
              <div style={styles.statLabel}>Pending Refunds</div>
              <div style={styles.statValue}>{parseFloat(balances.pendingRefunds.totalEth).toFixed(4)}</div>
              <div style={styles.statSubtext}>{balances.pendingRefunds.count} pending</div>
            </div>
          </div>
          </>
        ) : null}
      </div>

      {/* Bonus Word Distributions */}
      <div style={styles.card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <div>
            <h3 style={{ ...styles.cardTitle, margin: 0 }}>🎣 Bonus Word Distributions</h3>
            <p style={{ ...styles.cardSubtitle, margin: '4px 0 0 0' }}>
              Retry failed CLANKTON distributions for bonus word winners
            </p>
          </div>
          <button
            onClick={() => fetchBonusDistStatus()}
            disabled={bonusDistLoading}
            style={{ ...styles.btnSecondary, ...styles.btnSmall }}
          >
            {bonusDistLoading ? 'Loading...' : 'Refresh'}
          </button>
        </div>

        {bonusDistError ? (
          <div style={styles.alert('error')}>{bonusDistError}</div>
        ) : bonusDistLoading && !bonusDistStatus ? (
          <div style={{ padding: '24px', textAlign: 'center', color: '#6b7280' }}>Loading...</div>
        ) : bonusDistStatus ? (
          <>
            {/* Summary Stats */}
            <div style={{ ...styles.grid2, marginBottom: '16px' }}>
              <div style={styles.statCard}>
                <div style={styles.statLabel}>Contract CLANKTON</div>
                <div style={styles.statValueSmall}>{formatClanktonBalance(bonusDistStatus.contractClanktonBalance)}</div>
                <div style={styles.statSubtext}>Available for rewards</div>
              </div>
              <div style={styles.statCard}>
                <div style={styles.statLabel}>Failed/Pending</div>
                <div style={styles.statValueSmall}>
                  {bonusDistStatus.failedClaims.length + bonusDistStatus.claimedWithoutTx.length}
                </div>
                <div style={styles.statSubtext}>Need attention</div>
              </div>
            </div>

            {/* Retry All Result */}
            {retryAllResult && (
              <div style={{ ...styles.alert('success'), marginBottom: '16px' }}>
                <span>✅</span>
                <span>Retry complete: {retryAllResult.successful} successful, {retryAllResult.failed} failed</span>
                <button
                  onClick={() => setRetryAllResult(null)}
                  style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', fontSize: '14px' }}
                >
                  ×
                </button>
              </div>
            )}

            {/* Recent Success Messages */}
            {retrySuccesses.length > 0 && (
              <div style={{ marginBottom: '16px' }}>
                {retrySuccesses.slice(-5).map((success) => (
                  <div key={success.id} style={{ ...styles.alert('success'), marginBottom: '8px' }}>
                    <span>✅</span>
                    <span>
                      Sent!{' '}
                      <a
                        href={`https://basescan.org/tx/${success.txHash}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={styles.link}
                      >
                        View on BaseScan →
                      </a>
                    </span>
                    <button
                      onClick={() => setRetrySuccesses((prev) => prev.filter((s) => s.id !== success.id))}
                      style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', fontSize: '14px' }}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Failed Claims Table */}
            {bonusDistStatus.failedClaims.length > 0 && (
              <div style={{ marginBottom: '16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                  <h4 style={{ margin: 0, fontSize: '14px', fontWeight: 600, color: '#374151' }}>
                    Failed Claims ({bonusDistStatus.failedClaims.length})
                  </h4>
                  <button
                    onClick={retryAllFailed}
                    disabled={retryingAll}
                    style={{
                      ...styles.btnSuccess,
                      ...styles.btnSmall,
                      ...(retryingAll ? styles.btnDisabled : {}),
                    }}
                  >
                    {retryingAll ? 'Retrying...' : 'Retry All Failed'}
                  </button>
                </div>
                <table style={styles.table}>
                  <thead>
                    <tr>
                      <th style={styles.th}>Round</th>
                      <th style={styles.th}>User</th>
                      <th style={styles.th}>Wallet</th>
                      <th style={styles.th}>Status</th>
                      <th style={styles.th}>Retries</th>
                      <th style={styles.th}>Error</th>
                      <th style={styles.th}>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bonusDistStatus.failedClaims.map((claim) => (
                      <tr key={claim.claimId}>
                        <td style={styles.td}>R{claim.roundId} #{claim.wordIndex + 1}</td>
                        <td style={styles.td}>
                          {claim.username ? `@${claim.username}` : `FID ${claim.fid}`}
                        </td>
                        <td style={styles.td}>
                          <span style={{ fontFamily: 'monospace', fontSize: '11px' }}>
                            {shortenAddress(claim.walletAddress)}
                          </span>
                        </td>
                        <td style={styles.td}>
                          <span style={styles.badge(claim.txStatus === 'failed' ? 'red' : 'yellow')}>
                            {claim.txStatus}
                          </span>
                        </td>
                        <td style={styles.td}>{claim.retryCount}</td>
                        <td style={{ ...styles.td, maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          <span title={claim.errorMessage || undefined} style={{ fontSize: '11px', color: '#6b7280' }}>
                            {claim.errorMessage || '-'}
                          </span>
                        </td>
                        <td style={styles.td}>
                          <button
                            onClick={() => retryBonusClaim(claim.claimId)}
                            disabled={retryingClaimId === claim.claimId}
                            style={{
                              ...styles.btnPrimary,
                              ...styles.btnSmall,
                              ...(retryingClaimId === claim.claimId ? styles.btnDisabled : {}),
                            }}
                          >
                            {retryingClaimId === claim.claimId ? 'Retrying...' : 'Retry'}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Claimed Without TX Table */}
            {bonusDistStatus.claimedWithoutTx.length > 0 && (
              <div>
                <h4 style={{ margin: '0 0 8px 0', fontSize: '14px', fontWeight: 600, color: '#374151' }}>
                  Claimed Without TX ({bonusDistStatus.claimedWithoutTx.length})
                </h4>
                <p style={{ fontSize: '12px', color: '#6b7280', margin: '0 0 8px 0' }}>
                  Bonus words marked as claimed but no on-chain transaction recorded
                </p>
                <table style={styles.table}>
                  <thead>
                    <tr>
                      <th style={styles.th}>Round</th>
                      <th style={styles.th}>Word #</th>
                      <th style={styles.th}>User</th>
                      <th style={styles.th}>Claimed At</th>
                      <th style={styles.th}>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bonusDistStatus.claimedWithoutTx.map((bw) => (
                      <tr key={bw.bonusWordId}>
                        <td style={styles.td}>R{bw.roundId}</td>
                        <td style={styles.td}>#{bw.wordIndex + 1}</td>
                        <td style={styles.td}>
                          {bw.username ? `@${bw.username}` : `FID ${bw.claimedByFid}`}
                        </td>
                        <td style={styles.td}>{new Date(bw.claimedAt).toLocaleString()}</td>
                        <td style={styles.td}>
                          <button
                            onClick={() => retryBonusWordWithoutTx(bw.bonusWordId)}
                            disabled={retryingBonusWordId === bw.bonusWordId}
                            style={{
                              ...styles.btnPrimary,
                              ...styles.btnSmall,
                              ...(retryingBonusWordId === bw.bonusWordId ? styles.btnDisabled : {}),
                            }}
                          >
                            {retryingBonusWordId === bw.bonusWordId ? 'Sending...' : 'Send CLANKTON'}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* All Clear Message */}
            {bonusDistStatus.failedClaims.length === 0 && bonusDistStatus.claimedWithoutTx.length === 0 && (
              <div style={styles.alert('success')}>
                <span>✅</span>
                <span>All bonus word distributions are confirmed on-chain!</span>
              </div>
            )}
          </>
        ) : null}
      </div>

      {/* Round Data Repair */}
      <div style={styles.card}>
        <h3 style={styles.cardTitle}>🔧 Round Data Repair</h3>
        <p style={styles.cardSubtitle}>
          Debug and fix corrupted round fields (e.g., string fields stored as Date objects)
        </p>

        {/* Debug Round Form */}
        <div style={{ display: 'flex', gap: '12px', marginBottom: '16px' }}>
          <input
            type="number"
            placeholder="Round ID (e.g., 2)"
            value={roundDebugId}
            onChange={(e) => setRoundDebugId(e.target.value)}
            style={{ ...styles.input, width: '200px' }}
          />
          <button
            onClick={() => debugRound(roundDebugId)}
            disabled={roundDebugLoading || !roundDebugId}
            style={{
              ...styles.btnPrimary,
              ...(roundDebugLoading || !roundDebugId ? styles.btnDisabled : {}),
            }}
          >
            {roundDebugLoading ? 'Loading...' : 'Debug Round'}
          </button>
        </div>

        {/* Error */}
        {roundDebugError && (
          <div style={styles.alert('error')}>{roundDebugError}</div>
        )}

        {/* Fix Result */}
        {fixFieldResult && (
          <div style={styles.alert(fixFieldResult.success ? 'success' : 'error')}>
            {fixFieldResult.success ? (
              <>
                <span>✅</span>
                <span>
                  Field "{fixFieldResult.field}" fixed! Changed from "{String(fixFieldResult.oldValue)}" to "{fixFieldResult.newValue}"
                </span>
              </>
            ) : (
              <>
                <span>❌</span>
                <span>Failed to fix field "{fixFieldResult.field}": {fixFieldResult.error}</span>
              </>
            )}
            <button
              onClick={() => setFixFieldResult(null)}
              style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', fontSize: '14px' }}
            >
              ×
            </button>
          </div>
        )}

        {/* Debug Results */}
        {roundDebugResult && (
          <div>
            <div style={{ display: 'flex', gap: '16px', marginBottom: '16px' }}>
              <div style={{ ...styles.statCard, flex: 1 }}>
                <div style={styles.statLabel}>Round</div>
                <div style={styles.statValueSmall}>#{roundDebugResult.roundId}</div>
              </div>
              <div style={{ ...styles.statCard, flex: 1 }}>
                <div style={styles.statLabel}>Status</div>
                <div style={styles.statValueSmall}>{roundDebugResult.status}</div>
              </div>
              <div style={{ ...styles.statCard, flex: 1 }}>
                <div style={styles.statLabel}>Problem Fields</div>
                <div style={styles.statValueSmall}>
                  <span style={{ color: roundDebugResult.problemFields.length > 0 ? '#dc2626' : '#16a34a' }}>
                    {roundDebugResult.problemFields.length}
                  </span>
                </div>
              </div>
            </div>

            {/* Problem Fields Alert */}
            {roundDebugResult.problemFields.length > 0 && (
              <div style={{ ...styles.alert('error'), marginBottom: '16px' }}>
                <span>⚠️</span>
                <span>
                  <strong>Corrupted fields found:</strong>{' '}
                  {roundDebugResult.problemFields.map(pf => pf.field).join(', ')}
                </span>
              </div>
            )}

            {/* Problem Fields Fix UI */}
            {roundDebugResult.problemFields.length > 0 && (
              <div style={{ marginBottom: '16px' }}>
                <h4 style={{ margin: '0 0 8px 0', fontSize: '14px', fontWeight: 600, color: '#374151' }}>
                  Fix Corrupted Fields
                </h4>
                <table style={styles.table}>
                  <thead>
                    <tr>
                      <th style={styles.th}>Field</th>
                      <th style={styles.th}>Current Type</th>
                      <th style={styles.th}>Current Value</th>
                      <th style={styles.th}>New Value</th>
                      <th style={styles.th}>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {roundDebugResult.problemFields.map((pf) => (
                      <tr key={pf.field}>
                        <td style={styles.td}>
                          <code style={{ background: '#f3f4f6', padding: '2px 6px', borderRadius: '4px' }}>
                            {pf.field}
                          </code>
                        </td>
                        <td style={styles.td}>
                          <span style={styles.badge('red')}>
                            {pf.isDate ? 'Date' : pf.constructorName || pf.type}
                          </span>
                        </td>
                        <td style={{ ...styles.td, maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          <span style={{ fontFamily: 'monospace', fontSize: '11px' }} title={String(pf.value)}>
                            {String(pf.value)}
                          </span>
                        </td>
                        <td style={styles.td}>
                          <input
                            type="text"
                            placeholder="Enter correct value"
                            onChange={(e) => setFixFieldValue(e.target.value)}
                            style={{ ...styles.input, width: '150px', padding: '6px 8px', fontSize: '12px' }}
                          />
                        </td>
                        <td style={styles.td}>
                          <button
                            onClick={() => fixRoundField(roundDebugResult.roundId, pf.field, fixFieldValue)}
                            disabled={fixingField === pf.field || !fixFieldValue}
                            style={{
                              ...styles.btnDanger,
                              ...styles.btnSmall,
                              ...(fixingField === pf.field || !fixFieldValue ? styles.btnDisabled : {}),
                            }}
                          >
                            {fixingField === pf.field ? 'Fixing...' : 'Fix Field'}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* All Fields Table */}
            <details style={{ marginTop: '16px' }}>
              <summary style={{ cursor: 'pointer', fontSize: '14px', fontWeight: 500, color: '#374151', marginBottom: '8px' }}>
                View All Fields ({Object.keys(roundDebugResult.fieldAnalysis).length})
              </summary>
              <table style={styles.table}>
                <thead>
                  <tr>
                    <th style={styles.th}>Field</th>
                    <th style={styles.th}>Type</th>
                    <th style={styles.th}>Is Date?</th>
                    <th style={styles.th}>Value</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(roundDebugResult.fieldAnalysis).map(([field, info]) => (
                    <tr key={field} style={{ background: info.isDate ? '#fef2f2' : undefined }}>
                      <td style={styles.td}>
                        <code style={{ background: '#f3f4f6', padding: '2px 6px', borderRadius: '4px' }}>
                          {field}
                        </code>
                      </td>
                      <td style={styles.td}>{info.constructorName || info.type}</td>
                      <td style={styles.td}>
                        {info.isDate ? (
                          <span style={styles.badge('red')}>Yes ⚠️</span>
                        ) : (
                          <span style={styles.badge('green')}>No</span>
                        )}
                      </td>
                      <td style={{ ...styles.td, maxWidth: '300px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        <span style={{ fontFamily: 'monospace', fontSize: '11px' }} title={String(info.value)}>
                          {String(info.value)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>

            {/* No Problems */}
            {roundDebugResult.problemFields.length === 0 && (
              <div style={styles.alert('success')}>
                <span>✅</span>
                <span>No corrupted fields found! All string fields have correct types.</span>
              </div>
            )}
          </div>
        )}

        {/* Instructions */}
        {!roundDebugResult && !roundDebugLoading && (
          <div style={styles.alert('info')}>
            <span>ℹ️</span>
            <span>
              Enter a round ID to debug its database fields. This will check for any fields that have been corrupted
              (e.g., string fields accidentally stored as Date objects), which can cause archive sync failures.
            </span>
          </div>
        )}
      </div>

      {/* Prize Pool Injection Instructions */}
      <div style={styles.card}>
        <h3 style={styles.cardTitle}>Add ETH to Prize Pool</h3>
        <p style={styles.cardSubtitle}>
          To add ETH to the prize pool, send a transfer on Base from one of the authorized wallets.
        </p>

        <div style={{
          background: '#f0f9ff',
          border: '1px solid #bae6fd',
          borderRadius: '8px',
          padding: '16px',
          marginBottom: '16px',
        }}>
          <div style={{ marginBottom: '12px' }}>
            <div style={{ fontSize: '12px', color: '#0369a1', fontWeight: 500, marginBottom: '4px' }}>
              Step 1: Send ETH from
            </div>
            <div style={{ fontFamily: 'monospace', fontSize: '13px', color: '#0c4a6e', wordBreak: 'break-all' }}>
              {balances?.prizePool.address || '0xFd9716B26f3070Bc60AC409Aba13Dca2798771fB'}
            </div>
            <div style={{ fontSize: '11px', color: '#6b7280', marginTop: '2px' }}>
              (letshaveaword.eth — Prize Pool Wallet)
            </div>
          </div>

          <div style={{ marginBottom: '12px' }}>
            <div style={{ fontSize: '12px', color: '#0369a1', fontWeight: 500, marginBottom: '4px' }}>
              Step 2: To the contract
            </div>
            <div style={{ fontFamily: 'monospace', fontSize: '13px', color: '#0c4a6e', wordBreak: 'break-all' }}>
              {balances?.contractAddress || '0xfcb0D07a5BB5B004A1580D5Ae903E33c4A79EdB5'}
            </div>
            <div style={{ fontSize: '11px', color: '#6b7280', marginTop: '2px' }}>
              (JackpotManager Contract on Base)
            </div>
          </div>

          <div>
            <div style={{ fontSize: '12px', color: '#0369a1', fontWeight: 500, marginBottom: '4px' }}>
              Step 3: Any amount
            </div>
            <div style={{ fontSize: '13px', color: '#0c4a6e' }}>
              The ETH will be added to the jackpot automatically.
            </div>
          </div>
        </div>

        <div style={styles.alert('info')}>
          <span>ℹ️</span>
          <span>
            Only transfers from the Prize Pool Wallet or Operator Wallet are added to the jackpot.
            Transfers from other addresses are accepted but won't increase the prize pool.
          </span>
        </div>

        {balances && (
          <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
            <button
              onClick={() => navigator.clipboard.writeText(balances.prizePool.address)}
              style={{ ...styles.btnSecondary, ...styles.btnSmall }}
            >
              Copy Prize Pool Wallet
            </button>
            <button
              onClick={() => navigator.clipboard.writeText(balances.contractAddress)}
              style={{ ...styles.btnSecondary, ...styles.btnSmall }}
            >
              Copy Contract Address
            </button>
          </div>
        )}
      </div>

      {/* Creator Pool Withdrawal */}
      <div style={styles.card}>
        <h3 style={styles.cardTitle}>Withdraw from Creator Pool</h3>
        <p style={styles.cardSubtitle}>
          Withdraw accumulated creator profits. This action is irreversible.
        </p>

        {balances && (
          <div style={{ ...styles.statCard, marginBottom: '16px', textAlign: 'left' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
              <span style={{ color: '#6b7280' }}>Amount to withdraw:</span>
              <span style={{ fontWeight: 600 }}>{parseFloat(balances.creatorPool.accumulatedEth).toFixed(6)} ETH</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <span style={{ color: '#6b7280' }}>Destination (fixed in contract):</span>
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
        )}

        <div style={styles.alert('info')}>
          <span>ℹ️</span>
          <span>
            The contract's <code style={{ background: '#e5e7eb', padding: '2px 4px', borderRadius: '4px' }}>withdrawCreatorProfit()</code> function
            withdraws <strong>all</strong> accumulated profits to the fixed creator wallet address configured in the smart contract.
          </span>
        </div>

        <button
          onClick={() => setShowWithdrawConfirm(true)}
          disabled={!connectedWallet || !isOnBase || parseFloat(balances?.creatorPool.accumulatedEth || '0') === 0}
          style={{
            ...styles.btnDanger,
            marginTop: '16px',
            ...(!connectedWallet || !isOnBase || parseFloat(balances?.creatorPool.accumulatedEth || '0') === 0 ? styles.btnDisabled : {}),
          }}
        >
          Withdraw All to Creator Wallet
        </button>
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
                    {new Date(action.createdAt).toLocaleString()}
                  </td>
                  <td style={styles.td}>
                    <span style={styles.badge(
                      action.actionType === 'prize_pool_injection' ? 'green' :
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

      {/* Withdraw Confirmation Modal */}
      {showWithdrawConfirm && balances && connectedWallet && (
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
                <div style={{ fontFamily: 'monospace', fontSize: '13px' }}>{CREATOR_PROFIT_WALLET}</div>
              </div>
              <div>
                <span style={{ color: '#6b7280' }}>Amount:</span>
                <div style={{ fontWeight: 600, fontSize: '18px' }}>{parseFloat(balances.creatorPool.accumulatedEth).toFixed(6)} ETH</div>
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
      )}
    </div>
  );
}

// =============================================================================
// Helpers
// =============================================================================

function shortenAddress(address: string): string {
  if (!address) return '';
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

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

function formatClanktonBalance(balance: string): string {
  const num = parseFloat(balance);
  if (isNaN(num) || num === 0) return '0';

  if (num >= 1_000_000_000) {
    return `${(num / 1_000_000_000).toFixed(1)}B`;
  } else if (num >= 1_000_000) {
    return `${(num / 1_000_000).toFixed(1)}M`;
  } else if (num >= 1_000) {
    return `${(num / 1_000).toFixed(1)}K`;
  }
  return num.toLocaleString();
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
