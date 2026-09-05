import { useCallback, useState } from "react";
import { toast } from "@metap/ui";

/** Wraps 1+ async actions in a page/component with a single shared `busy` flag + generic
 *  destructive-toast error handling — the `setBusy(true) -> try -> catch(toast) -> finally
 *  setBusy(false)` shell found repeated ~16 times across `metap-demo-waf`
 *  (`platform-ui/docs/audits/03-waf-demo-component-placement-audit.md` finding #6,
 *  `docs/features/27-use-async-action-hook.md`). Deliberately NOT a replacement for
 *  `useApiMutation` — most of those call sites go through imperative GraphQL functions, not a
 *  REST mutation hook, so this fills a gap `useApiMutation` doesn't reach rather than duplicating
 *  it.
 *
 *  `run` takes the *entire* action body — its own success toast / cache-invalidate calls stay
 *  with the caller, since the success-side behavior (which message, which variant, whether it
 *  branches on the result) varies too much per call site to generalize; this hook only owns the
 *  busy flag and the shared error path.
 *
 *  One `busy` flag is shared across every `run()` call from the same `useAsyncAction()` instance
 *  — call it **once per group of actions that should mutually exclude each other** (matching
 *  several call sites' original behavior of one `busy` disabling multiple different buttons on
 *  the same page), not once per action. Call it more than once in a component only when those
 *  actions genuinely have independent loading state. */
export function useAsyncAction() {
  const [busy, setBusy] = useState(false);

  const run = useCallback(async (action: () => Promise<void>) => {
    setBusy(true);
    try {
      await action();
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), { variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }, []);

  return { busy, run };
}
