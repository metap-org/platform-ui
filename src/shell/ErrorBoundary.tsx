import { Component } from "react";
import type { ReactNode } from "react";
import { withTranslation, type WithTranslation } from "react-i18next";
import { Alert, AlertDescription, AlertTitle, Button } from "@metap/ui";

type Props = WithTranslation & { children: ReactNode };
type State = { error: Error | null };

/** Catches a runtime error anywhere under `AppShellLayout`'s content and shows a retry fallback
 *  instead of leaving the whole shell blank (`docs/features/23-ux-infrastructure-core.md`) — no
 *  new atom needed, `Alert`/`AlertTitle`/`AlertDescription`/`Button` in `@metap/ui` already cover
 *  this shape. Must be a class component: React has no hook equivalent for
 *  `componentDidCatch`/`getDerivedStateFromError` as of React 18, hence `withTranslation()` here
 *  instead of `useTranslation()`. */
class ErrorBoundaryImpl extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack: string }) {
    // No error-tracking SDK wired yet (checklist gap, "Error monitoring") — logging here at
    // least keeps the failure visible somewhere instead of disappearing silently.
    // eslint-disable-next-line no-console
    console.error("Unhandled error in app shell content:", error, info.componentStack);
  }

  reset = () => {
    this.setState({ error: null });
  };

  render() {
    const { error } = this.state;
    const { t, children } = this.props;

    if (!error) {
      return children;
    }

    return (
      <Alert variant="destructive" className="m-4">
        <AlertTitle>{t("shell.errorBoundaryTitle")}</AlertTitle>
        <AlertDescription className="flex flex-col gap-3">
          <span>{t("shell.errorBoundaryDescription")}</span>
          <Button variant="outline" size="sm" className="self-start" onClick={this.reset}>
            {t("shell.errorBoundaryRetry")}
          </Button>
        </AlertDescription>
      </Alert>
    );
  }
}

export const ErrorBoundary = withTranslation()(ErrorBoundaryImpl);
