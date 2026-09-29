import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CursorSdkError } from "@cursor/sdk";
import {
  EXIT_OK,
  EXIT_RUN_CANCELLED,
  EXIT_RUN_FAILED,
  exitCodeForStatus,
  formatStartupError,
  isCursorAgentError,
} from "../src/sdk/errors.ts";

describe("exitCodeForStatus", () => {
  it("maps finished/error/cancelled to 0/2/3", () => {
    assert.equal(exitCodeForStatus("finished"), EXIT_OK);
    assert.equal(exitCodeForStatus("error"), EXIT_RUN_FAILED);
    assert.equal(exitCodeForStatus("cancelled"), EXIT_RUN_CANCELLED);
  });

  it("treats an unrecognized status as ok rather than throwing", () => {
    assert.equal(exitCodeForStatus("running"), EXIT_OK);
  });
});

describe("isCursorAgentError", () => {
  it("matches a real SDK error subclass by its stable isRetryable/name shape", () => {
    const error = new CursorSdkError("boom", { isRetryable: true });
    assert.equal(isCursorAgentError(error), true);
  });

  it("rejects a plain Error", () => {
    assert.equal(isCursorAgentError(new Error("plain")), false);
  });

  it("rejects non-object values", () => {
    assert.equal(isCursorAgentError("nope"), false);
    assert.equal(isCursorAgentError(null), false);
    assert.equal(isCursorAgentError(undefined), false);
  });
});

describe("formatStartupError", () => {
  it("includes retryable, requestId, and helpUrl for a CursorSdkError-shaped error", () => {
    const error = new CursorSdkError("boom", { isRetryable: true, requestId: "req-1" });
    const formatted = formatStartupError(error);
    assert.match(formatted, /^startup failed: boom/);
    assert.match(formatted, /retryable=true/);
    assert.match(formatted, /requestId=req-1/);
  });

  it("falls back to the plain message for a non-SDK Error", () => {
    assert.equal(formatStartupError(new Error("plain failure")), "plain failure");
  });

  it("stringifies a non-Error value", () => {
    assert.equal(formatStartupError("just a string"), "just a string");
  });
});
