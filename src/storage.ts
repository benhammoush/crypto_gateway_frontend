/**
 * Best-effort tab storage for checkout recovery without permitting duplicate payment.
 * @packageDocumentation
 */

/** Browser storage may be disabled. A submitted transfer must never trigger a second payment.
 * @param key - Tab-scoped recovery key.
 * @returns The stored value, or null when absent or storage is unavailable.
 */
export function readSession(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

/** Attempt to retain recovery state and report whether browser storage accepted it.
 * @param key - Tab-scoped recovery key.
 * @param value - Recovery value to retain before allowing further submission.
 * @returns Whether storage accepted the value.
 */
export function saveSession(key: string, value: string): boolean {
  try {
    sessionStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

/** Remove recovery state without throwing when tab storage is disabled.
 * @param key - Recovery key whose value is no longer needed.
 */
export function removeSession(key: string): void {
  try {
    sessionStorage.removeItem(key);
  } catch {
    /* In-memory state still remains authoritative for this tab. */
  }
}
