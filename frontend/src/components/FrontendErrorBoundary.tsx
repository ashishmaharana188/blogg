import { Component, type ErrorInfo, type ReactNode } from "react";
import AssetStateBox from "./AssetStateBox";
import { reportUiFailure } from "../utils/uiDiagnostics";

type Props = { children: ReactNode };
type State = { failed: boolean; alertVisible: boolean };

/** App-wide fallback: show the site's image state instead of raw browser or React errors. */
export default class FrontendErrorBoundary extends Component<Props, State> {
  state: State = { failed: false, alertVisible: false };
  private originalAlert: typeof window.alert | null = null;

  static getDerivedStateFromError(): State {
    return { failed: true, alertVisible: false };
  }

  private readonly handleWindowError = (event: ErrorEvent): void => {
    // Resource failures such as missing images should be handled by their own fallback.
    if (event.target && event.target !== window) return;
    reportUiFailure("window.error", event.error || event.message || "Unknown browser error");
    this.setState({ failed: true });
  };

  private readonly handleUnhandledRejection = (event: PromiseRejectionEvent): void => {
    reportUiFailure("window.unhandledrejection", event.reason);
    this.setState({ failed: true });
  };

  private readonly dismissAlert = (): void => this.setState({ alertVisible: false });

  componentDidMount(): void {
    window.addEventListener("error", this.handleWindowError);
    window.addEventListener("unhandledrejection", this.handleUnhandledRejection);

    // A few legacy screens still call window.alert. Replace its text popup with the
    // same image fallback and send the original detail only to backend diagnostics.
    this.originalAlert = window.alert.bind(window);
    window.alert = (message?: unknown): void => {
      reportUiFailure("window.alert", {
        name: "UIAlert",
        message: typeof message === "string" ? message : "UI alert requested",
      });
      this.setState({ alertVisible: true });
    };
  }

  componentWillUnmount(): void {
    window.removeEventListener("error", this.handleWindowError);
    window.removeEventListener("unhandledrejection", this.handleUnhandledRejection);
    if (this.originalAlert) window.alert = this.originalAlert;
  }

  componentDidCatch(error: Error, _info: ErrorInfo): void {
    reportUiFailure("react.render", error);
  }

  render() {
    if (this.state.failed) {
      return (
        <main style={{ minHeight: "100vh", display: "grid", placeItems: "center" }}>
          <AssetStateBox status="error" onRetry={() => window.location.reload()} />
        </main>
      );
    }

    return (
      <>
        {this.props.children}
        {this.state.alertVisible && (
          <div
            role="alertdialog"
            aria-label="An action could not be completed"
            style={{
              position: "fixed",
              inset: 0,
              zIndex: 99999,
              display: "grid",
              placeItems: "center",
              padding: 16,
              background: "rgba(255,255,255,0.96)",
            }}
          >
            <div style={{ display: "grid", justifyItems: "center", gap: 12 }}>
              <AssetStateBox status="error" compact />
              <button type="button" onClick={this.dismissAlert}>Dismiss</button>
            </div>
          </div>
        )}
      </>
    );
  }
}
