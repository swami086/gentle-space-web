import posthog from "posthog-js";

export const isPostHogConfigured = Boolean(
  process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN && process.env.NEXT_PUBLIC_POSTHOG_HOST,
);

export function capturePostHogEvent(
  event: string,
  properties?: Record<string, string | number | boolean | null>,
) {
  if (!isPostHogConfigured) return;
  posthog.capture(event, properties);
}

export function identifyPostHogPerson(properties: Record<string, string>) {
  if (!isPostHogConfigured) return;

  const distinctId = posthog.get_distinct_id();
  if (distinctId) posthog.identify(distinctId, properties);
}

export function postHogCorrelationHeaders(): Record<string, string> {
  if (!isPostHogConfigured) return {};

  const distinctId = posthog.get_distinct_id();
  const sessionId = posthog.get_session_id();

  return {
    ...(distinctId ? { "X-PostHog-Distinct-ID": distinctId } : {}),
    ...(sessionId ? { "X-PostHog-Session-ID": sessionId } : {}),
  };
}
