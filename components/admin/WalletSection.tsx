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

interface OperationalStatus {
  status: 'NORMAL' | 'KILL_SWITCH_ACTIVE' | 'DEAD_DAY_ACTIVE' | 'PAUSED_BETWEEN_ROUNDS';
  killSwitch: { enabled: boolean };
  deadDay: { enabled: boolean };
}

interface ConnectedWallet {
  address: string;
  chainId: number;
  chainName: string;
}

// Base chain ID
const BASE_CHAIN_ID = 8453;
const BASE_CHAIN_ID_HEX = '0x2105';

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
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [withdrawDestination, setWithdrawDestination] = useState('');
  const [withdrawConfirmText, setWithdrawConfirmText] = useState('');
  const [isWithdrawing, setIsWithdrawing] = useState(false);
  const [showWithdrawConfirm, setShowWithdrawConfirm] = useState(false);

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

  useEffect(() => {
    checkWalletConnection();
    fetchBalances();
    fetchOperationalStatus();
    fetchActions();

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
  }, [checkWalletConnection, fetchBalances, fetchOperationalStatus, fetchActions]);

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

    // Note: withdrawCreatorProfit() sends to the configured creatorProfitWallet,
    // not an arbitrary destination. The destination field is informational.
    if (!ethers.isAddress(withdrawDestination)) {
      setWalletError('Invalid destination address');
      return;
    }

    setIsWithdrawing(true);
    setWalletError(null);

    try {
      const amountWei = ethers.parseEther(withdrawAmount);

      // Call withdrawCreatorProfit() on the contract
      const provider = new ethers.BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();

      // Create contract instance with withdrawCreatorProfit ABI
      const withdrawAbi = ['function withdrawCreatorProfit()'];
      const contract = new ethers.Contract(balances.contractAddress, withdrawAbi, signer);

      // Call withdrawCreatorProfit - sends accumulated profit to creatorProfitWallet
      const tx = await contract.withdrawCreatorProfit();

      // Log the action
      await fetch('/api/admin/wallet/actions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          devFid: user.fid,
          actionType: 'creator_pool_withdrawal',
          amountEth: withdrawAmount,
          amountWei: amountWei.toString(),
          fromAddress: balances.contractAddress,
          toAddress: balances.creatorPool.address,
          txHash: tx.hash,
          initiatedByFid: user.fid,
          initiatedByAddress: connectedWallet.address,
          note: 'Withdrawal initiated from admin panel',
          metadata: { chainId: connectedWallet.chainId, method: 'withdrawCreatorProfit' },
        }),
      });

      // Reset form
      setWithdrawAmount('');
      setWithdrawDestination('');
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
          <div style={styles.grid4}>
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
              <div style={styles.statLabel}>Pending Refunds</div>
              <div style={styles.statValue}>{parseFloat(balances.pendingRefunds.totalEth).toFixed(4)}</div>
              <div style={styles.statSubtext}>{balances.pendingRefunds.count} pending</div>
            </div>
          </div>
          </>
        ) : null}
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
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: '#6b7280' }}>Available to withdraw:</span>
              <span style={{ fontWeight: 600 }}>{parseFloat(balances.creatorPool.accumulatedEth).toFixed(6)} ETH</span>
            </div>
          </div>
        )}

        <div style={{ marginBottom: '16px' }}>
          <label style={styles.label}>Amount (ETH)</label>
          <input
            type="text"
            value={withdrawAmount}
            onChange={(e) => setWithdrawAmount(e.target.value)}
            placeholder="0.00"
            style={styles.input}
          />
        </div>

        <div style={{ marginBottom: '16px' }}>
          <label style={styles.label}>Destination Address</label>
          <input
            type="text"
            value={withdrawDestination}
            onChange={(e) => setWithdrawDestination(e.target.value)}
            placeholder={connectedWallet?.address || '0x...'}
            style={styles.input}
          />
          {connectedWallet && !withdrawDestination && (
            <button
              onClick={() => setWithdrawDestination(connectedWallet.address)}
              style={{ ...styles.btnSecondary, ...styles.btnSmall, marginTop: '8px' }}
            >
              Use connected wallet
            </button>
          )}
        </div>

        <button
          onClick={() => setShowWithdrawConfirm(true)}
          disabled={!connectedWallet || !isOnBase || !withdrawAmount || !withdrawDestination}
          style={{
            ...styles.btnDanger,
            ...(!connectedWallet || !isOnBase || !withdrawAmount || !withdrawDestination ? styles.btnDisabled : {}),
          }}
        >
          Withdraw from Creator Pool
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
              This action is <strong>irreversible</strong>. Please verify all details carefully.
            </div>

            <div style={{ ...styles.statCard, marginBottom: '16px', textAlign: 'left' }}>
              <div style={{ marginBottom: '8px' }}>
                <span style={{ color: '#6b7280' }}>From (Creator Pool):</span>
                <div style={{ fontFamily: 'monospace', fontSize: '13px' }}>{balances.creatorPool.address}</div>
              </div>
              <div style={{ marginBottom: '8px' }}>
                <span style={{ color: '#6b7280' }}>To:</span>
                <div style={{ fontFamily: 'monospace', fontSize: '13px' }}>{withdrawDestination}</div>
              </div>
              <div>
                <span style={{ color: '#6b7280' }}>Amount:</span>
                <div style={{ fontWeight: 600, fontSize: '18px' }}>{withdrawAmount} ETH</div>
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
