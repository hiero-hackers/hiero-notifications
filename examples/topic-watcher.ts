/**
 * A SECOND watcher — proof the framework isn't account-specific — and it is
 * LIVE: it reads real HCS messages from a real mainnet topic.
 *
 * Its payload is a `TopicMessage`, *not* a receipt — yet the exact same
 * watch loop, conditions, and deliveries handle it, because a `Delivery`
 * only reads the generic `Notification` fields. That is the whole point of
 * the shape: write a `Watcher<YourPayload>`, and every delivery you already
 * have works for it.
 *
 *   node examples/topic-watcher.ts                    # a busy mainnet topic
 *   node examples/topic-watcher.ts 0.0.XXXX           # your topic
 *   node examples/topic-watcher.ts 0.0.XXXX oracle    # only messages containing "oracle"
 *
 * Does one poll (the topic's latest messages) and exits. The cursor logic
 * is the real thing though — call the watcher again and it emits only what
 * arrived since, exactly like the built-in watchers.
 *
 * First: `npm run build && npm run examples:setup`.
 */
import { createMirrorNodeClient } from "@hiero-hackers/enterprise-mirror";
import { pollOnce, consoleDelivery, anyActivity } from "@hiero-hackers/hiero-notifications";
import type { Watcher, Notification, Condition } from "@hiero-hackers/hiero-notifications";

interface TopicMessage {
  readonly sequenceNumber: number;
  readonly message: string;
  readonly consensusTimestamp: string;
}

// ── The watcher: HCS topic messages → notifications. Renders its own text. ──
function topicWatcher(topicId: string): Watcher<TopicMessage> {
  const mirror = createMirrorNodeClient({ network: "mainnet" });
  let lastSeq = 0;

  return async () => {
    // First poll: baseline on the latest few. After that: only new ones —
    // the same cursor discipline as the built-in watchers.
    const page =
      lastSeq === 0
        ? await mirror.queryTopicMessages(topicId, { limit: 3, order: "desc" })
        : await mirror.queryTopicMessages(topicId, {
            sequenceNumber: { gt: lastSeq },
            limit: 25,
            order: "asc",
          });
    const incoming = (lastSeq === 0 ? [...page.data].reverse() : [...page.data]).map((m) => ({
      sequenceNumber: Number(m.sequenceNumber),
      // Mirror returns the message base64-encoded; topic content is
      // author-controlled, so collapse control characters before rendering
      // (an embedded newline would forge extra lines in the console frame).
      // eslint-disable-next-line no-control-regex -- matching control characters is the point
      message: Buffer.from(m.message, "base64")
        .toString("utf8")
        .replace(/[\u0000-\u001f\u007f-\u009f]+/gu, " ")
        .trim(),
      consensusTimestamp: m.consensusTimestamp,
    }));

    if (lastSeq === 0 && incoming.length === 0) {
      console.error(
        `topic ${topicId} has no messages — it may have gone quiet since this ` +
          `example's default was chosen; pass an active topic id as the first argument`,
      );
    }
    const at = new Date().toISOString();
    const out: Notification<TopicMessage>[] = [];
    for (const m of incoming) {
      lastSeq = Math.max(lastSeq, m.sequenceNumber);
      out.push({
        // The dedupe key — delivery is at-least-once, consumers dedupe on id.
        id: `topic-messages:${topicId}:${m.sequenceNumber}`,
        source: "topic-messages",
        subject: topicId,
        text: `Topic ${topicId} · message #${m.sequenceNumber}: ${m.message}`,
        at,
        payload: m,
      });
    }
    return out;
  };
}

// ── A custom CONDITION over the topic payload: keyword match (optional). ──
function containing(keyword: string): Condition<TopicMessage> {
  return {
    name: `message~"${keyword}"`,
    matches: (m) => m.message.toLowerCase().includes(keyword.toLowerCase()),
  };
}

// Default: the mirror-monitor heartbeat topic — real messages land on it
// around the clock, so the demo always has something to show.
const topicId = process.argv[2] ?? "0.0.10650556";
const keyword = process.argv[3];

const delivered = await pollOnce({
  watcher: topicWatcher(topicId),
  condition: keyword ? containing(keyword) : anyActivity,
  deliveries: [consoleDelivery], // ← the SAME delivery the account watcher uses
});

console.error(
  `\n${delivered} notification(s) delivered — same loop, same deliveries, different watcher.`,
);
