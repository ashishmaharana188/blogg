import { API_BASE_URL } from "../services/apiBase";

type ErrorLike = { name?: unknown; message?: unknown; stack?: unknown };
let consoleForwardingInstalled = false;

function asError(value: unknown): ErrorLike {
  if (value instanceof Error) return value;
  if (value && typeof value === "object") return value as ErrorLike;
  return {
    name: "Error",
    message: typeof value === "string" ? value : "Unknown UI failure",
  };
}

/** Send bounded diagnostics to the backend; never render technical details in the UI. */
export function reportUiFailure(context: string, failure: unknown): void {
  try {
    const error = asError(failure);
    const payload = {
      context: context.slice(0, 100),
      name: typeof error.name === "string" ? error.name.slice(0, 100) : "Error",
      message: typeof error.message === "string" ? error.message.slice(0, 500) : "Client-side UI failure",
      stack: typeof error.stack === "string" ? error.stack.slice(0, 6000) : undefined,
      pathname: typeof window !== "undefined" ? window.location.pathname.slice(0, 300) : undefined,
    };

    void fetch(`${API_BASE_URL}/api/ui-logs`, {
      method: "POST",
      credentials: "omit",
      keepalive: true,
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(payload),
    }).catch(() => undefined);
  } catch {
    // Diagnostic reporting must never create a second visible error.
  }
}

function safeConsoleValue(value: unknown): string {
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, (key, nested) =>
      /password|token|authorization|cookie|secret|api[_-]?key/i.test(key)
        ? "[redacted]"
        : nested,
    ) ?? String(value);
  } catch {
    return Object.prototype.toString.call(value);
  }
}

/** Forward browser error/warning logs to the backend while preserving the browser console. */
export function installUiConsoleDiagnostics(): void {
  if (consoleForwardingInstalled || typeof window === "undefined") return;
  consoleForwardingInstalled = true;

  const originalError = console.error.bind(console);
  const originalWarn = console.warn.bind(console);

  console.error = (...args: unknown[]) => {
    originalError(...args);
    const original = args.find((value) => value instanceof Error) as Error | undefined;
    reportUiFailure("console.error", {
      name: original?.name || "ConsoleError",
      message: args.map(safeConsoleValue).join(" ").slice(0, 500) || "Browser console error",
      stack: original?.stack,
    });
  };

  console.warn = (...args: unknown[]) => {
    originalWarn(...args);
    const original = args.find((value) => value instanceof Error) as Error | undefined;
    reportUiFailure("console.warn", {
      name: original?.name || "ConsoleWarning",
      message: args.map(safeConsoleValue).join(" ").slice(0, 500) || "Browser console warning",
      stack: original?.stack,
    });
  };
}
