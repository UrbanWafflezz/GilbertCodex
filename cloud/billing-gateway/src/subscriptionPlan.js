export const PLUS_TRIAL_DAYS = 30;

export function getTrialDaysForTier(tier) {
  return tier === "plus" ? PLUS_TRIAL_DAYS : 0;
}

export function createSubscriptionData(uid, tier) {
  const subscriptionData = {
    metadata: {
      firebaseUid: uid,
      tier,
    },
  };

  if (tier === "plus") {
    subscriptionData.trial_period_days = PLUS_TRIAL_DAYS;
    subscriptionData.trial_settings = {
      end_behavior: {
        missing_payment_method: "cancel",
      },
    };
  }

  return subscriptionData;
}
