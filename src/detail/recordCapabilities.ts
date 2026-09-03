export type TransitionAvailability = {
  action: string;
  available: boolean;
  reason?: string;
};

export type RecordCapabilities = {
  writableFields: string[];
  canUpdate: boolean;
  /** Optional purely for backend compatibility — added to `RecordCapabilities` server-side on
   * 2026-09-03, so an older backend omits it. Treat `undefined` as "unknown, don't gate" rather
   * than as `false`: hiding delete from someone actually allowed to use it is the worse failure,
   * and the server enforces the real check either way. */
  canDelete?: boolean;
  transitions: TransitionAvailability[];
};
