export const EXIT_OK = 0;
export const EXIT_STARTUP_FAILED = 1;
export const EXIT_RUN_FAILED = 2;
export const EXIT_RUN_CANCELLED = 3;

/** Map an SDK run status ("finished" | "error" | "cancelled") to a CLI exit code. */
export function exitCodeForStatus(status: string): number {
  if (status === "error") {
    return EXIT_RUN_FAILED;
  }
  if (status === "cancelled") {
    return EXIT_RUN_CANCELLED;
  }
  return EXIT_OK;
}

export function isCursorAgentError(error: unknown): error is {
  message: string;
  isRetryable?: boolean;
  name?: string;
  helpUrl?: string;
  requestId?: string;
} {
  if (!error || typeof error !== "object") {
    return false;
  }
  const candidate = error as { name?: string; isRetryable?: unknown };
  return (
    candidate.name === "CursorAgentError" ||
    candidate.name === "CursorSdkError" ||
    typeof candidate.isRetryable === "boolean"
  );
}

export function formatStartupError(error: unknown): string {
  if (isCursorAgentError(error)) {
    const parts = [
      `startup failed: ${error.message}`,
      `retryable=${Boolean(error.isRetryable)}`,
    ];
    if (error.requestId) {
      parts.push(`requestId=${error.requestId}`);
    }
    if (error.helpUrl) {
      parts.push(`help=${error.helpUrl}`);
    }
    return parts.join(" ");
  }
  return error instanceof Error ? error.message : String(error);
}
