import type { TFunction } from "i18next";
import { ApiError } from "../api/client";

/** Why a transition is blocked, in the person's language. The server sends the English `reason`
 *  and, when the guard declares one, a stable `reasonKey` (`details.messageKey` on a rejected
 *  transition); a translation under that key wins, the English text is the fallback. */
export function guardReason(
  t: TFunction,
  info: { reason?: string; reasonKey?: string },
): string | undefined {
  if (info.reasonKey) {
    return t(info.reasonKey, { defaultValue: info.reason ?? "" }) || info.reason;
  }
  return info.reason;
}

/** The text for a failed workflow call: the guard's translated message when the error carries a
 *  key, else the error's own message. */
export function guardErrorMessage(t: TFunction, error: ApiError): string {
  const key = error.details?.messageKey;
  return guardReason(t, {
    reason: error.message,
    reasonKey: typeof key === "string" ? key : undefined,
  }) as string;
}
