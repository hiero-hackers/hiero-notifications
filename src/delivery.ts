/**
 * Deliveries — where a notification goes. Console + generic webhook + Slack +
 * Discord ship here, all dependency-free (Slack/Discord "incoming webhooks"
 * are just an HTTP POST of a specific JSON shape — no SDK, no OAuth, just the
 * webhook URL). Anything richer (email via SMTP, a bot with a token) is the
 * same `Delivery` interface with its own dependency.
 *
 * All of these read only the generic `Notification` fields (source, subject,
 * text/html, payload), so they serve every watcher — not just account activity.
 */
import type { Delivery } from "./types.js";

/** Print the notification to the console. */
export const consoleDelivery: Delivery = {
  name: "console",
  async deliver(n) {
    const lines = n.text
      .split("\n")
      .map((l) => `│ ${l}`)
      .join("\n");
    console.log(`\n┌─ ${n.at} · ${n.source} · ${n.subject}\n${lines}\n└─`);
  },
};

export interface WebhookOptions {
  /** Payload format: structured JSON (default) or the rendered HTML body. */
  readonly format?: "json" | "html";
  /** Extra headers, e.g. an auth token. */
  readonly headers?: Readonly<Record<string, string>>;
}

/**
 * POST the notification to a URL. JSON payloads serialize `bigint`s as strings
 * (exact). A non-2xx response throws, so the watcher logs it without stopping.
 */
export function webhookDelivery(url: string, opts: WebhookOptions = {}): Delivery {
  const format = opts.format ?? "json";
  return {
    name: `webhook(${format})`,
    async deliver(n) {
      const [body, type] =
        format === "html"
          ? [n.html ?? `<pre>${n.text}</pre>`, "text/html"]
          : [
              JSON.stringify(
                { id: n.id, source: n.source, subject: n.subject, at: n.at, payload: n.payload },
                bigintReplacer,
              ),
              "application/json",
            ];
      await post(url, body, type, opts.headers);
    },
  };
}

/** Post the notification text to a Slack channel via an incoming webhook URL. */
export function slackDelivery(webhookUrl: string): Delivery {
  return {
    name: "slack",
    async deliver(n) {
      await post(webhookUrl, JSON.stringify({ text: codeBlock(n.text) }), "application/json");
    },
  };
}

/** Post the notification text to a Discord channel via an incoming webhook URL. */
export function discordDelivery(webhookUrl: string): Delivery {
  return {
    name: "discord",
    async deliver(n) {
      // Discord caps message content at 2000 chars; bodies are far shorter.
      await post(
        webhookUrl,
        JSON.stringify({ content: codeBlock(n.text).slice(0, 1990) }),
        "application/json",
      );
    },
  };
}

async function post(
  url: string,
  body: string,
  contentType: string,
  headers: Readonly<Record<string, string>> = {},
): Promise<void> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": contentType, ...headers },
    body,
  });
  if (!res.ok) throw new Error(`${url} responded ${res.status}`);
}

const bigintReplacer = (_key: string, value: unknown): unknown =>
  typeof value === "bigint" ? value.toString() : value;
/**
 * Wrap text in a Slack/Discord code block, neutering backticks first — the
 * text embeds attacker-writable memo content, and an embedded ``` would
 * break out of the block into live markdown (re-linkifying exactly what the
 * receipt's defanging neutered). A straight quote is the closest harmless
 * glyph.
 */
export const codeBlock = (text: string): string => "```\n" + text.replaceAll("`", "'") + "\n```";
