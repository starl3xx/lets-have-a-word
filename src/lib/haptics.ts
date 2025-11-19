/**
 * Haptic Feedback Utility
 * Milestone 4.3
 *
 * Integrates with Farcaster SDK's haptic feedback API
 * Provides tactile feedback on key interactions
 */

import sdk from '@farcaster/miniapp-sdk';

export type HapticType = 'light' | 'medium' | 'heavy' | 'error' | 'success';

/**
 * Trigger haptic feedback if supported
 *
 * @param type - Type of haptic feedback to trigger
 *
 * Usage:
 * - light: Soft tap (e.g., button press, typing)
 * - medium: Standard feedback (e.g., guess submission)
 * - heavy: Strong feedback (e.g., important action)
 * - error: Error vibration (e.g., invalid guess, no guesses left)
 * - success: Success vibration (e.g., jackpot win)
 */
export function triggerHaptic(type: HapticType): void {
  try {
    // Check if haptics are available
    if (!sdk || !sdk.actions || typeof sdk.actions.haptic !== 'function') {
      // Haptics not supported, fail silently
      return;
    }

    // Map our types to Farcaster SDK haptic patterns
    switch (type) {
      case 'light':
        sdk.actions.haptic({ type: 'impact', style: 'light' });
        break;

      case 'medium':
        sdk.actions.haptic({ type: 'impact', style: 'medium' });
        break;

      case 'heavy':
        sdk.actions.haptic({ type: 'impact', style: 'heavy' });
        break;

      case 'error':
        sdk.actions.haptic({ type: 'notification', style: 'error' });
        break;

      case 'success':
        sdk.actions.haptic({ type: 'notification', style: 'success' });
        break;

      default:
        // Unknown type, use default light impact
        sdk.actions.haptic({ type: 'impact', style: 'light' });
    }
  } catch (error) {
    // Fail silently on unsupported devices or errors
    console.log('[Haptics] Haptic feedback not available:', error);
  }
}

/**
 * Trigger a sequence of haptics
 *
 * @param pattern - Array of haptic types to trigger in sequence
 * @param delay - Delay between each haptic (ms)
 */
export function triggerHapticPattern(
  pattern: HapticType[],
  delay: number = 100
): void {
  pattern.forEach((type, index) => {
    setTimeout(() => {
      triggerHaptic(type);
    }, index * delay);
  });
}
