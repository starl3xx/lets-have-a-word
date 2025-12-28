import { useState, useEffect, useRef } from 'react';
import { useAccount } from 'wagmi';
import { haptics } from '../src/lib/haptics';
import { useTranslation } from '../src/hooks/useTranslation';
import { parseOperationalError } from './GamePausedBanner';
import { usePurchaseGuesses } from '../src/hooks/usePurchaseGuesses';

/**
 * Log analytics event (fire-and-forget)
 */
function logAnalytics(
  eventType: string,
  fid?: number | null,
  data?: Record<string, any>
) {
  fetch('/api/analytics/log', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      eventType,
      userId: fid?.toString(),
      data,
    }),
  }).catch(() => {
    // Silently ignore - analytics should never block UI
  });
}

/**
 * Pack pricing info (fetched from API)
 * Milestone 7.1: Dynamic late-round pricing
 */
interface PackOption {
  packCount: number;
  guessCount: number;
  totalPriceWei: string;
  totalPriceEth: string;
}

/** Pricing phase from API */
type PricingPhase = 'BASE' | 'LATE_1' | 'LATE_2';

interface GuessPurchaseModalProps {
  fid: number | null;
  onClose: () => void;
  onPurchaseSuccess: (packCount: number) => void;
}

/**
 * GuessPurchaseModal
 * Milestone 6.3, Updated Milestone 7.0, 7.1, 7.5
 *
 * Modal for purchasing guess packs (3 guesses per pack).
 *
 * Milestone 7.0: Visual polish
 * - Uses unified design token classes
 * - Consistent color palette
 *
 * Milestone 7.1: Dynamic late-round pricing
 * - Price increases after 750 guesses (Top-10 lock)
 *
 * Milestone 7.5: Progressive pricing with minimal UI cues
 * - Shows neutral state label ("Early round pricing" / "Late round pricing")
 * - Early-round purchases show positive reinforcement message
 * - Analytics events for pricing state tracking
 */
export default function GuessPurchaseModal({
  fid,
  onClose,
  onPurchaseSuccess,
}: GuessPurchaseModalProps) {
  const { t } = useTranslation();

  // Wagmi hooks for onchain purchase
  const { address: walletAddress, isConnected } = useAccount();
  const {
    purchaseGuesses,
    isPending: isTxPending,
    isConfirming: isTxConfirming,
    isSuccess: isTxSuccess,
    isError: isTxError,
    error: txError,
    txHash,
    reset: resetTx,
  } = usePurchaseGuesses();

  // Pack pricing options (default values, updated from API)
  const [packOptions, setPackOptions] = useState<PackOption[]>([
    { packCount: 1, guessCount: 3, totalPriceWei: '300000000000000', totalPriceEth: '0.0003' },
    { packCount: 2, guessCount: 6, totalPriceWei: '600000000000000', totalPriceEth: '0.0006' },
    { packCount: 3, guessCount: 9, totalPriceWei: '900000000000000', totalPriceEth: '0.0009' },
  ]);

  // State
  const [selectedPackCount, setSelectedPackCount] = useState<number>(1);
  const [packsPurchasedToday, setPacksPurchasedToday] = useState<number>(0);
  const [maxPacksPerDay, setMaxPacksPerDay] = useState<number>(3);
  const [isLoading, setIsLoading] = useState(true);
  const [isPurchasing, setIsPurchasing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Milestone 7.1/7.5: Pricing state
  const [pricingPhase, setPricingPhase] = useState<PricingPhase>('BASE');
  const [isLateRoundPricing, setIsLateRoundPricing] = useState(false);

  // Milestone 7.5: Track if early-round reinforcement was shown (for analytics)
  const [showEarlyRoundReinforcement, setShowEarlyRoundReinforcement] = useState(false);
  const reinforcementLoggedRef = useRef(false);

  // Milestone 6.4: Handle transaction success - verify on backend
  useEffect(() => {
    if (isTxSuccess && txHash && fid) {
      // Transaction confirmed onchain, now verify and record on backend
      const verifyPurchase = async () => {
        try {
          const response = await fetch('/api/purchase-guess-pack', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              fid,
              packCount: selectedPackCount,
              txHash, // Send txHash for onchain verification
            }),
          });

          const data = await response.json();

          if (!response.ok) {
            throw new Error(data.error || 'Failed to verify purchase');
          }

          void haptics.packPurchased();

          // Show success
          const purchasePricingPhase = data.pricingPhase || pricingPhase;
          if (purchasePricingPhase === 'BASE') {
            setShowEarlyRoundReinforcement(true);
          } else {
            setSuccessMessage(t('guessPack.purchaseSuccess'));
          }

          setPacksPurchasedToday((prev) => prev + selectedPackCount);

          setTimeout(() => {
            onPurchaseSuccess(selectedPackCount);
            onClose();
          }, 1500);
        } catch (err) {
          console.error('[GuessPurchaseModal] Verify error:', err);
          setError(err instanceof Error ? err.message : 'Failed to verify purchase');
        } finally {
          setIsPurchasing(false);
        }
      };

      verifyPurchase();
    }
  }, [isTxSuccess, txHash, fid, selectedPackCount, pricingPhase, t, onPurchaseSuccess, onClose]);

  // Handle transaction error
  useEffect(() => {
    if (isTxError && txError) {
      setError(txError.message || 'Transaction failed');
      setIsPurchasing(false);
      void haptics.inputBecameInvalid();
    }
  }, [isTxError, txError]);

  // Fetch current purchase state and pricing
  useEffect(() => {
    const fetchPurchaseState = async () => {
      if (!fid) {
        setIsLoading(false);
        setError(t('errors.notAuthenticated'));
        return;
      }

      try {
        const [stateResponse, pricingResponse] = await Promise.all([
          fetch(`/api/user-state?devFid=${fid}`),
          fetch('/api/guess-pack-pricing'),
        ]);

        if (stateResponse.ok) {
          const stateData = await stateResponse.json();
          setPacksPurchasedToday(stateData.paidPacksPurchased || 0);
        }

        if (pricingResponse.ok) {
          const pricingData = await pricingResponse.json();
          if (pricingData.packOptions) {
            setPackOptions(pricingData.packOptions);
          }
          if (pricingData.maxPacksPerDay) {
            setMaxPacksPerDay(pricingData.maxPacksPerDay);
          }
          // Milestone 7.1: Update late-round pricing state
          if (pricingData.pricingPhase) {
            setPricingPhase(pricingData.pricingPhase);
          }
          if (typeof pricingData.isLateRoundPricing === 'boolean') {
            setIsLateRoundPricing(pricingData.isLateRoundPricing);
          }
        }
      } catch (err) {
        console.error('[GuessPurchaseModal] Error fetching state:', err);
      } finally {
        setIsLoading(false);
      }
    };

    fetchPurchaseState();
  }, [fid, t]);

  // Calculate remaining packs allowed
  const remainingPacks = Math.max(0, maxPacksPerDay - packsPurchasedToday);
  const maxSelectablePacks = Math.min(3, remainingPacks);

  // Get selected pack info
  const selectedOption = packOptions.find(
    (option) => option.packCount === selectedPackCount
  );

  /**
   * Handle pack selection
   */
  const handleSelectPack = (packCount: number) => {
    if (packCount > maxSelectablePacks) return;
    void haptics.selectionChanged();
    setSelectedPackCount(packCount);
    setError(null);
  };

  /**
   * Handle purchase - Milestone 6.4: Onchain pack purchase
   *
   * Flow:
   * 1. User clicks Buy -> initiate wallet transaction
   * 2. User signs tx in wallet
   * 3. Wait for tx confirmation (handled by useEffect above)
   * 4. Verify on backend and award packs
   */
  const handlePurchase = async () => {
    if (!fid) {
      setError(t('guessPack.connectWallet'));
      return;
    }

    if (!isConnected || !walletAddress) {
      setError('Wallet not connected. Please connect your wallet.');
      return;
    }

    if (selectedPackCount > remainingPacks) {
      setError(t('guessPack.maxPacksReached'));
      return;
    }

    if (!selectedOption) {
      setError('Please select a pack option');
      return;
    }

    void haptics.buttonTapMinor();
    setIsPurchasing(true);
    setError(null);
    resetTx(); // Reset any previous transaction state

    // Log analytics - purchase initiated
    logAnalytics('guess_pack_purchase_initiated', fid, {
      packCount: selectedPackCount,
      totalPriceEth: selectedOption.totalPriceEth,
      pricingPhase,
      walletAddress,
    });

    // Initiate onchain transaction
    // Total guesses = packCount * 3 (3 guesses per pack)
    const totalGuesses = selectedPackCount * 3;

    try {
      purchaseGuesses({
        playerAddress: walletAddress as `0x${string}`,
        quantity: totalGuesses,
        totalPriceEth: selectedOption.totalPriceEth,
      });
      // Transaction handling continues in useEffect hooks above
    } catch (err) {
      console.error('[GuessPurchaseModal] Purchase initiation error:', err);
      setError(err instanceof Error ? err.message : t('guessPack.purchaseFailed'));
      setIsPurchasing(false);
      void haptics.inputBecameInvalid();
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-card shadow-modal max-w-md w-full p-6 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="text-center">
          <h2 className="text-2xl font-bold text-gray-900">{t('guessPack.title')}</h2>
          <p className="text-gray-600 mt-1">{t('guessPack.subtitle')}</p>
        </div>

        {/* Loading State */}
        {isLoading && (
          <div className="text-center py-8">
            <p className="text-gray-500 animate-pulse">{t('common.loading')}</p>
          </div>
        )}

        {/* Main Content */}
        {!isLoading && (
          <>
            {/* Pricing state label - shown before pack options for context */}
            <div className={`rounded-btn px-3 py-1.5 text-center ${
              isLateRoundPricing
                ? 'bg-gray-100'
                : 'bg-gray-50'
            }`}>
              <p className={`text-xs ${
                isLateRoundPricing
                  ? 'text-gray-600'
                  : 'text-gray-500'
              }`}>
                {pricingPhase === 'BASE'
                  ? 'Early round pricing'
                  : pricingPhase === 'LATE_2'
                  ? 'Late round pricing (max)'
                  : 'Late round pricing'}
              </p>
            </div>

            {/* Pack Options */}
            <div className="space-y-3">
              {packOptions.map((option) => {
                const isSelected = selectedPackCount === option.packCount;
                const isDisabled = option.packCount > maxSelectablePacks;

                return (
                  <button
                    key={option.packCount}
                    onClick={() => handleSelectPack(option.packCount)}
                    disabled={isDisabled || isPurchasing}
                    className={`w-full p-4 rounded-btn border-2 transition-all duration-fast flex items-center justify-between ${
                      isSelected
                        ? 'border-brand bg-brand-50'
                        : isDisabled
                        ? 'border-gray-200 bg-gray-100 opacity-50 cursor-not-allowed'
                        : 'border-gray-200 bg-white hover:border-brand-300 hover:bg-brand-50'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      {/* Radio indicator */}
                      <div
                        className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors duration-fast ${
                          isSelected ? 'border-brand' : 'border-gray-300'
                        }`}
                      >
                        {isSelected && (
                          <div className="w-3 h-3 rounded-full bg-brand" />
                        )}
                      </div>

                      {/* Pack info */}
                      <div className="text-left">
                        <p className="font-semibold text-gray-900">
                          {option.packCount} pack{option.packCount > 1 ? 's' : ''}
                        </p>
                        <p className="text-sm text-gray-600">
                          {option.guessCount} guesses
                        </p>
                      </div>
                    </div>

                    {/* Price */}
                    <div className="text-right">
                      <p className="font-bold text-gray-900">
                        {option.totalPriceEth} ETH
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Limit Indicator - de-emphasized */}
            <p className="text-xs text-gray-400 text-center">
              {t('guessPack.limitIndicator', { count: packsPurchasedToday })}
              {remainingPacks === 0 && (
                <span className="block text-warning-600 font-medium mt-0.5">
                  {t('guessPack.maxPacksReached')}
                </span>
              )}
            </p>

            {/* Error Message */}
            {error && (
              <div className="bg-error-50 border border-error-200 rounded-btn p-3">
                <p className="text-sm text-error-700 text-center">{error}</p>
              </div>
            )}

            {/* Success Message */}
            {successMessage && (
              <div className="bg-success-50 border border-success-200 rounded-btn p-3">
                <p className="text-sm text-success-700 text-center">{successMessage}</p>
              </div>
            )}

            {/* Milestone 7.5: Early-round reinforcement message */}
            {showEarlyRoundReinforcement && (
              <div className="bg-success-50 border border-success-200 rounded-btn p-3">
                <p className="text-sm text-success-700 text-center font-medium">
                  Early-round pricing applied ✓
                </p>
              </div>
            )}

            {/* Buttons */}
            <div className="flex flex-col gap-2">
              <button
                onClick={handlePurchase}
                disabled={
                  isPurchasing ||
                  isTxPending ||
                  isTxConfirming ||
                  remainingPacks === 0 ||
                  !selectedOption ||
                  !!successMessage ||
                  showEarlyRoundReinforcement
                }
                className={`btn-primary-lg w-full ${
                  isPurchasing ||
                  isTxPending ||
                  isTxConfirming ||
                  remainingPacks === 0 ||
                  !selectedOption ||
                  !!successMessage ||
                  showEarlyRoundReinforcement
                    ? 'opacity-50 cursor-not-allowed'
                    : ''
                }`}
              >
                {isTxPending ? (
                  'Confirm in wallet...'
                ) : isTxConfirming ? (
                  'Confirming...'
                ) : isPurchasing ? (
                  t('guessPack.buyButtonLoading')
                ) : remainingPacks === 0 ? (
                  t('guessPack.maxPacksReached')
                ) : (
                  <>
                    {t('guessPack.buyButton')} · {selectedOption?.totalPriceEth} ETH
                  </>
                )}
              </button>

              {/* Reassurance microcopy */}
              <p className="text-xs text-gray-400 text-center">
                {t('guessPack.jackpotNote')}
              </p>

              <button
                onClick={onClose}
                disabled={isPurchasing}
                className="btn-secondary w-full"
              >
                {t('common.cancel')}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
