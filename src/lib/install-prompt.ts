/**
 * Install-prompt seen tracking.
 *
 * Lives OUTSIDE components/InstallPromptModal.tsx on purpose: index.tsx
 * needs hasSeenInstallPrompt() in its guess flow, and importing anything
 * statically from the modal file would pull the whole modal (and its share
 * machinery) back into the main chunk, defeating its next/dynamic split.
 */

const INSTALL_PROMPT_SEEN_KEY = 'lhaw_seen_install_prompt';

/**
 * Check if user has already seen the install prompt
 */
export function hasSeenInstallPrompt(): boolean {
  if (typeof window === 'undefined') return false;
  return localStorage.getItem(INSTALL_PROMPT_SEEN_KEY) === 'true';
}

/**
 * Mark install prompt as seen
 */
export function markInstallPromptSeen(): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(INSTALL_PROMPT_SEEN_KEY, 'true');
}
