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
 * Milestone X.X: Volume-based tiered pricing
 */
interface PackOption {
  packCount: number;
  guessCount: number;
  totalPriceWei: string;
  totalPriceEth: string;
  spansTiers?: boolean;
}

/** Pricing phase from API */
type PricingPhase = 'EARLY' | 'MID' | 'LATE';

/** Volume tier from API */
type VolumeTier = 'BASE' | 'MID' | 'HIGH';

interface GuessPurchaseModalProps {
  fid: number | null;
  onClose: () => void;
  onPurchaseSuccess: (packCount: number) => void;
}

/**
 * Format time until reset as human-readable string
 */
function formatTimeUntilReset(hours: number, minutes: number): string {
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

/**
 * Get volume tier display info
 */
function getVolumeTierDisplay(tier: VolumeTier, multiplier: number): { label: string; color: string } {
  switch (tier) {
    case 'BASE':
      return { label: '1×', color: 'text-gray-600' };
    case 'MID':
      return { label: '1.5×', color: 'text-amber-600' };
    case 'HIGH':
      return { label: '2×', color: 'text-orange-600' };
  }
}

/**
 * GuessPurchaseModal
 * Milestone 6.3, Updated Milestone 7.0, 7.1, 7.5, X.X (Uncapped + Volume Tiers)
 *
 * Modal for purchasing guess packs (3 guesses per pack).
 *
 * Milestone X.X: Uncapped purchases with volume tiers
 * - Pack purchases are now UNLIMITED
 * - Volume tiers: 1× for packs 1-3, 1.5× for packs 4-6, 2× for packs 7+
 * - Clear warning that paid guesses expire at 11:00 UTC
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
  const [isLoading, setIsLoading] = useState(true);
  const [isPurchasing, setIsPurchasing] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [verifyAttempt, setVerifyAttempt] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Milestone 7.1/7.5: Pricing state
  const [pricingPhase, setPricingPhase] = useState<PricingPhase>('BASE');
  const [isLateRoundPricing, setIsLateRoundPricing] = useState(false);

  // Volume tier state
  const [volumeTier, setVolumeTier] = useState<VolumeTier>('BASE');
  const [volumeMultiplier, setVolumeMultiplier] = useState<number>(1);
  const [packsRemainingAtTier, setPacksRemainingAtTier] = useState<number>(3);
  const [nextTierMultiplier, setNextTierMultiplier] = useState<number | null>(1.5);

  // Reset time state
  const [hoursUntilReset, setHoursUntilReset] = useState<number>(0);
  const [minutesUntilReset, setMinutesUntilReset] = useState<number>(0);

  // Milestone 7.5: Track if early-round reinforcement was shown (for analytics)
  const [showEarlyRoundReinforcement, setShowEarlyRoundReinforcement] = useState(false);
  const reinforcementLoggedRef = useRef(false);

  // Milestone 6.4: Handle transaction success - verify on backend
  // With retry logic for transactions that aren't indexed yet
  useEffect(() => {
    if (isTxSuccess && txHash && fid) {
      // Transaction confirmed onchain, now verify and record on backend
      const MAX_VERIFY_ATTEMPTS = 5;
      const VERIFY_TIMEOUT_MS = 15000; // 15 second timeout per attempt
      const RETRY_DELAY_MS = 3000; // 3 second delay between retries

      const verifyPurchase = async (attempt: number = 1) => {
        setIsVerifying(true);
        setVerifyAttempt(attempt);

        try {
          // Create an AbortController for timeout
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), VERIFY_TIMEOUT_MS);

          const response = await fetch('/api/purchase-guess-pack', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              fid,
              packCount: selectedPackCount,
              txHash, // Send txHash for onchain verification
            }),
            signal: controller.signal,
          });

          clearTimeout(timeoutId);

          // Handle non-JSON responses
          const text = await response.text();
          let data;
          try {
            data = JSON.parse(text);
          } catch {
            throw new Error('Invalid server response');
          }

          if (!response.ok) {
            // Check if the error is a transient "transaction not found" error
            const errorMsg = data.error || 'Failed to verify purchase';
            if (
              (errorMsg.includes('not found') || errorMsg.includes('not yet mined')) &&
              attempt < MAX_VERIFY_ATTEMPTS
            ) {
              // Retry after delay
              console.log(`[GuessPurchaseModal] Tx not indexed yet, retry ${attempt}/${MAX_VERIFY_ATTEMPTS}`);
              await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
              return verifyPurchase(attempt + 1);
            }
            throw new Error(errorMsg);
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

          // Update volume tier info from response
          if (data.volumeTier) setVolumeTier(data.volumeTier);
          if (data.volumeMultiplier) setVolumeMultiplier(data.volumeMultiplier);
          if (data.packsRemainingAtCurrentTier !== undefined) {
            setPacksRemainingAtTier(data.packsRemainingAtCurrentTier);
          }
          if (data.nextTierMultiplier !== undefined) {
            setNextTierMultiplier(data.nextTierMultiplier);
          }

          setTimeout(() => {
            onPurchaseSuccess(selectedPackCount);
            onClose();
          }, 1500);
        } catch (err) {
          console.error('[GuessPurchaseModal] Verify error:', err);

          // Check if it's a timeout/abort error and we can retry
          if (err instanceof Error && err.name === 'AbortError' && attempt < MAX_VERIFY_ATTEMPTS) {
            console.log(`[GuessPurchaseModal] Request timeout, retry ${attempt}/${MAX_VERIFY_ATTEMPTS}`);
            await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
            return verifyPurchase(attempt + 1);
          }

          // Show user-friendly error with tx link for manual verification
          const baseErrorMsg = err instanceof Error ? err.message : 'Failed to verify purchase';
          setError(`${baseErrorMsg}. Your transaction was confirmed onchain (tx: ${txHash.slice(0, 10)}...). If packs don't appear, please contact support.`);
        } finally {
          setIsPurchasing(false);
          setIsVerifying(false);
          setVerifyAttempt(0);
        }
      };

      verifyPurchase(1);
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
        // Fetch pricing with user-specific volume tier
        const pricingResponse = await fetch(`/api/guess-pack-pricing?fid=${fid}`);

        if (pricingResponse.ok) {
          const pricingData = await pricingResponse.json();

          if (pricingData.packOptions) {
            setPackOptions(pricingData.packOptions);
          }

          // Stage-based pricing
          if (pricingData.pricingPhase) {
            setPricingPhase(pricingData.pricingPhase);
          }
          if (typeof pricingData.isLateRoundPricing === 'boolean') {
            setIsLateRoundPricing(pricingData.isLateRoundPricing);
          }

          // Volume tier info
          if (typeof pricingData.packsPurchasedToday === 'number') {
            setPacksPurchasedToday(pricingData.packsPurchasedToday);
          }
          if (pricingData.volumeTier) {
            setVolumeTier(pricingData.volumeTier);
          }
          if (typeof pricingData.volumeMultiplier === 'number') {
            setVolumeMultiplier(pricingData.volumeMultiplier);
          }
          if (typeof pricingData.packsRemainingAtCurrentTier === 'number') {
            setPacksRemainingAtTier(pricingData.packsRemainingAtCurrentTier);
          }
          if (pricingData.nextTierMultiplier !== undefined) {
            setNextTierMultiplier(pricingData.nextTierMultiplier);
          }

          // Reset time
          if (typeof pricingData.hoursUntilReset === 'number') {
            setHoursUntilReset(pricingData.hoursUntilReset);
          }
          if (typeof pricingData.minutesUntilReset === 'number') {
            setMinutesUntilReset(pricingData.minutesUntilReset);
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

  // Get selected pack info
  const selectedOption = packOptions.find(
    (option) => option.packCount === selectedPackCount
  );

  // Volume tier display
  const tierDisplay = getVolumeTierDisplay(volumeTier, volumeMultiplier);

  /**
   * Handle pack selection
   */
  const handleSelectPack = (packCount: number) => {
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
      volumeTier,
      volumeMultiplier,
      packsPurchasedToday,
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

  // Check if user should see the expiration warning (less than 2 hours)
  const showExpirationWarning = hoursUntilReset < 2;

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
            {/* Pricing info bar */}
            <div className="bg-gray-50 rounded-btn px-3 py-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-gray-500">
                  {pricingPhase === 'EARLY'
                    ? 'Early round pricing'
                    : pricingPhase === 'LATE'
                    ? 'Late round pricing'
                    : 'Mid round pricing'}
                </span>
                <span className={`font-medium ${tierDisplay.color}`}>
                  Volume tier: {tierDisplay.label}
                </span>
              </div>
              {/* Show packs until next tier if applicable */}
              {nextTierMultiplier && packsRemainingAtTier !== Infinity && (
                <p className="text-xs text-gray-400 mt-1 text-center">
                  {packsRemainingAtTier} more pack{packsRemainingAtTier !== 1 ? 's' : ''} at {tierDisplay.label} price
                </p>
              )}
            </div>

            {/* Expiration warning */}
            <div className={`rounded-btn px-3 py-2 text-center ${
              showExpirationWarning
                ? 'bg-amber-50 border border-amber-200'
                : 'bg-gray-50'
            }`}>
              <p className={`text-xs ${showExpirationWarning ? 'text-amber-700 font-medium' : 'text-gray-500'}`}>
                ⏰ Paid guesses expire at 11:00 UTC ({formatTimeUntilReset(hoursUntilReset, minutesUntilReset)})
              </p>
            </div>

            {/* Pack Options */}
            <div className="space-y-3">
              {packOptions.map((option) => {
                const isSelected = selectedPackCount === option.packCount;

                return (
                  <button
                    key={option.packCount}
                    onClick={() => handleSelectPack(option.packCount)}
                    disabled={isPurchasing}
                    className={`w-full p-4 rounded-btn border-2 transition-all duration-fast flex items-center justify-between ${
                      isSelected
                        ? 'border-brand bg-brand-50'
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
                      {option.spansTiers && (
                        <p
                          className="text-xs text-gray-400 cursor-help"
                          title="Part of this purchase is priced at a higher tier"
                        >
                          spans tiers
                        </p>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Packs purchased today indicator */}
            <p className="text-xs text-gray-400 text-center">
              {packsPurchasedToday} pack{packsPurchasedToday !== 1 ? 's' : ''} purchased today
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
                  isVerifying ||
                  !selectedOption ||
                  !!successMessage ||
                  showEarlyRoundReinforcement
                }
                className={`btn-primary-lg w-full ${
                  isPurchasing ||
                  isTxPending ||
                  isTxConfirming ||
                  isVerifying ||
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
                  'Confirming onchain...'
                ) : isVerifying ? (
                  verifyAttempt > 1
                    ? `Verifying (attempt ${verifyAttempt}/5)...`
                    : 'Verifying purchase...'
                ) : isPurchasing ? (
                  t('guessPack.buyButtonLoading')
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
