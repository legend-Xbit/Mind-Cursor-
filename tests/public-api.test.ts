import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { EXIT_RUN_CANCELLED, exitCodeForStatus } from "../src/index.ts";
import type { LayerInfo } from "../src/index.ts";

describe("public API compatibility", () => {
  it("keeps LayerInfo and the cancellation exit code on the package entry", () => {
    const info: LayerInfo = {
      name: "mind-cursor",
      version: "0.1.0",
      model: "composer-2.5",
      runtime: "local",
    };
    assert.equal(info.name, "mind-cursor");
    assert.equal(EXIT_RUN_CANCELLED, 3);
    assert.equal(exitCodeForStatus("cancelled"), EXIT_RUN_CANCELLED);
    assert.equal(exitCodeForStatus("finished"), 0);
  });
});
