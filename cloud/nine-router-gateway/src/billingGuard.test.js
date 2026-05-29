import assert from "node:assert/strict";
import test from "node:test";

import {
  estimateImageGenerations,
  isBillableImageRequest,
} from "./billingUsage.js";

test("recognizes image generation as a billable subscription request", () => {
  assert.equal(isBillableImageRequest("POST", "/v1/images/generations"), true);
  assert.equal(isBillableImageRequest("GET", "/v1/images/generations"), false);
  assert.equal(isBillableImageRequest("POST", "/v1/chat/completions"), false);
});

test("estimates image generation usage from request count aliases", () => {
  assert.equal(estimateImageGenerations(JSON.stringify({ n: 4 })), 4);
  assert.equal(estimateImageGenerations(JSON.stringify({ count: "3" })), 3);
  assert.equal(estimateImageGenerations(JSON.stringify({ imageCount: 2 })), 2);
  assert.equal(estimateImageGenerations(JSON.stringify({ n: 0 })), 1);
  assert.equal(estimateImageGenerations("not-json"), 1);
});
