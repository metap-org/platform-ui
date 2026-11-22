import { useCallback, useState, type ReactNode } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@metap/ui";
import { useTranslation } from "react-i18next";

/**
 * Asks in the app's own dialog, never the browser's `window.confirm`.
 *
 *   const { confirm, confirmDialog } = useConfirm();
 *   if (!(await confirm(t("common.deleteConfirm")))) return;
 *   …
 *   return <>{…}{confirmDialog}</>;
 *
 * `confirm` resolves true when the person confirms and false when they cancel or dismiss the
 * dialog, so it drops in where `window.confirm` was.
 */
export function useConfirm(): {
  confirm: (
    message: string,
    options?: { title?: string; confirmLabel?: string },
  ) => Promise<boolean>;
  confirmDialog: ReactNode;
} {
  const { t } = useTranslation();
  const [pending, setPending] = useState<{
    message: string;
    title?: string;
    confirmLabel?: string;
    resolve: (answer: boolean) => void;
  } | null>(null);

  const confirm = useCallback(
    (message: string, options?: { title?: string; confirmLabel?: string }) =>
      new Promise<boolean>((resolve) => setPending({ message, ...options, resolve })),
    [],
  );

  function answer(value: boolean) {
    pending?.resolve(value);
    setPending(null);
  }

  const confirmDialog = (
    <AlertDialog open={pending !== null} onOpenChange={(open) => !open && answer(false)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{pending?.title ?? t("common.confirmTitle")}</AlertDialogTitle>
          <AlertDialogDescription>{pending?.message}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
          <AlertDialogAction onClick={() => answer(true)}>
            {pending?.confirmLabel ?? t("common.confirm")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  return { confirm, confirmDialog };
}
