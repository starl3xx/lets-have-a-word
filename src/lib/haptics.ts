// lib/haptics.ts
// Centralized haptics helper for Let's Have A Word
// Uses Farcaster mini-app SDK under the hood, but no-ops gracefully
// when unavailable or unsupported.

import { sdk } from "@farcaster/miniapp-sdk";

let capabilities: string[] | null = null;
let capabilitiesLoaded = false;
let capabilitiesPromise: Promise<void> | null = null;

async function ensureCapabilitiesLoaded() {
  if (capabilitiesLoaded) return;
  if (!capabilitiesPromise) {
    capabilitiesPromise = (async () => {
      try {
        const caps = await sdk.getCapabilities();
        capabilities = caps ?? [];
      } catch (err) {
        // In non-Farcaster or unsupported environments, just treat as no haptics.
        capabilities = [];
        if (process.env.NODE_ENV === "development") {
          console.warn("[haptics] Failed to load capabilities:", err);
        }
      } finally {
        capabilitiesLoaded = true;
      }
    })();
  }
  await capabilitiesPromise;
}

function hasCapability(cap: string): boolean {
  if (!capabilitiesLoaded || !capabilities) return false;
  return capabilities.includes(cap);
}

// Low-level wrapper helpers
async function safeImpact(type: "light" | "medium" | "heavy" | "soft" | "rigid") {
  await ensureCapabilitiesLoaded();
  if (!hasCapability("haptics.impactOccurred")) return;

  try {
    await sdk.haptics.impactOccurred(type);
  } catch (err) {
    if (process.env.NODE_ENV === "development") {
      console.warn("[haptics] impactOccurred error:", err);
    }
  }
}

async function safeNotification(type: "success" | "warning" | "error") {
  await ensureCapabilitiesLoaded();
  if (!hasCapability("haptics.notificationOccurred")) return;

  try {
    await sdk.haptics.notificationOccurred(type);
  } catch (err) {
    if (process.env.NODE_ENV === "development") {
      console.warn("[haptics] notificationOccurred error:", err);
    }
  }
}

async function safeSelection() {
  await ensureCapabilitiesLoaded();
  if (!hasCapability("haptics.selectionChanged")) return;

  try {
    await sdk.haptics.selectionChanged();
  } catch (err) {
    if (process.env.NODE_ENV === "development") {
      console.warn("[haptics] selectionChanged error:", err);
    }
  }
}

// Semantic helpers used throughout the app
export const haptics = {
  // Keyboard-level interactions
  keyTap: () => safeImpact("light"),           // letter key
  keyBackspace: () => safeImpact("soft"),      // backspace
  keyEnterValid: () => safeImpact("medium"),   // enter/guess when valid

  // Input transitions
  inputBecameValid: () => safeSelection(),     // transitioning to full valid word
  inputBecameInvalid: () => safeNotification("error"), // full invalid/duplicate word

  // Guess lifecycle
  guessSubmitting: () => safeImpact("medium"), // on valid guess tap
  guessSuccess: () => safeNotification("success"),
  guessWrong: () => safeImpact("rigid"),       // wrong but valid
  outOfGuesses: () => safeNotification("warning"),

  // Misc UI
  shareBonusUnlocked: () => safeNotification("success"),
  buttonTapMinor: () => safeImpact("light"),   // Stats/Refer/FAQ, etc.
  selectionChanged: () => safeSelection(),     // toggles, tabs, etc.

  // Milestone 6.3: Additional haptics
  packPurchased: () => safeNotification("success"),  // Guess pack purchased
  linkCopied: () => safeImpact("medium"),            // Referral link copied
  shareCompleted: () => safeNotification("success"), // Share completed
  cardSaved: () => safeImpact("medium"),             // Share card saved/downloaded
  losing: () => safeNotification("warning"),         // Round lost / out of guesses
  winning: () => safeNotification("success"),        // Alias for guessSuccess
};

// Legacy compatibility - keep old triggerHaptic for backward compatibility
export type HapticType = 'light' | 'medium' | 'heavy' | 'error' | 'success';

/**
 * Trigger haptic feedback if supported (legacy API - prefer haptics.* methods)
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
  // Map legacy types to new semantic helpers
  switch (type) {
    case 'light':
      void haptics.keyTap();
      break;
    case 'medium':
      void haptics.guessSubmitting();
      break;
    case 'heavy':
      void safeImpact('heavy');
      break;
    case 'error':
      void haptics.inputBecameInvalid();
      break;
    case 'success':
      void haptics.guessSuccess();
      break;
  }
}

/**
 * Trigger a sequence of haptics (legacy API)
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
