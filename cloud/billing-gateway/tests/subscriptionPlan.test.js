import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createSubscriptionData, getTrialDaysForTier, PLUS_TRIAL_DAYS } from "../src/subscriptionPlan.js";

describe("subscription plan trial setup", () => {
  it("starts Plus with a 30-day Stripe subscription trial", () => {
    assert.equal(PLUS_TRIAL_DAYS, 30);
    assert.equal(getTrialDaysForTier("plus"), 30);
    assert.deepEqual(createSubscriptionData("firebase-user-1", "plus"), {
      metadata: {
        firebaseUid: "firebase-user-1",
        tier: "plus",
      },
      trial_period_days: 30,
      trial_settings: {
        end_behavior: {
          missing_payment_method: "cancel",
        },
      },
    });
  });

  it("keeps Pro on normal billing without a free trial", () => {
    assert.equal(getTrialDaysForTier("pro"), 0);
    assert.deepEqual(createSubscriptionData("firebase-user-1", "pro"), {
      metadata: {
        firebaseUid: "firebase-user-1",
        tier: "pro",
      },
    });
  });
});
