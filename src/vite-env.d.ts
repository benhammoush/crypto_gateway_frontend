/**
 * Public build-time configuration exposed to browser modules.
 * @packageDocumentation
 */

/** Explicit public inputs; merchant credentials never belong in this interface. */
interface ImportMetaEnv {
  readonly VITE_API_ORIGIN?: string;
  readonly VITE_APP_ENV?: string;
}
