/**
 * Deliveries — where a notification goes. Console + generic webhook + Slack +
 * Discord ship here, all dependency-free (Slack/Discord "incoming webhooks"
 * are just an HTTP POST of a specific JSON shape — no SDK, no OAuth, just the
 * webhook URL). Anything richer (email via SMTP, a bot with a token) is the
 * same `Delivery` interface with its own dependency.
 */
import type { Delivery, NotificationEvent } from "./types.js";

/** Print the receipt to the console. */
export const consoleDelivery: Delivery = {
  name: "console",
  async deliver(event) {
    const lines = event.text.split("\n").map((l) => `│ ${l}`).join("\n");
    console.log(`\n┌─ ${event.at} · account ${event.account}\n${lines}\n└─`);
  },
};

export interface WebhookOptions {
  /** Payload format: structured JSON (default) or the rendered HTML receipt. */
  readonly format?: "json" | "html";
  /** Extra headers, e.g. an auth token. */
  readonly headers?: Readonly<Record<string, string>>;
}

/**
 * POST the receipt to a URL. JSON payloads serialize `bigint`s as strings
 * (exact). A non-2xx response throws, so the watcher logs it without stopping.
 */
export function webhookDelivery(url: string, opts: WebhookOptions = {}): Delivery {
  const format = opts.format ?? "json";
  return {
    name: `webhook(${format})`,
    async deliver(event) {
      const [body, type] =
        format === "html"
          ? [event.html, "text/html"]
          : [JSON.stringify({ account: event.account, at: event.at, receipt: event.receipt }, bigintReplacer), "application/json"];
      await post(url, body, type, opts.headers);
    },
  };
}

/** Post the receipt to a Slack channel via an incoming webhook URL. */
export function slackDelivery(webhookUrl: string): Delivery {
  return {
    name: "slack",
    async deliver(event) {
      await post(webhookUrl, JSON.stringify({ text: codeBlock(event.text) }), "application/json");
    },
  };
}

/** Post the receipt to a Discord channel via an incoming webhook URL. */
export function discordDelivery(webhookUrl: string): Delivery {
  return {
    name: "discord",
    async deliver(event) {
      // Discord caps message content at 2000 chars; receipts are far shorter.
      await post(webhookUrl, JSON.stringify({ content: codeBlock(event.text).slice(0, 1990) }), "application/json");
    },
  };
}

async function post(url: string, body: string, contentType: string, headers: Readonly<Record<string, string>> = {}): Promise<void> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": contentType, ...headers }, body });
  if (!res.ok) throw new Error(`${url} responded ${res.status}`);
}

const bigintReplacer = (_key: string, value: unknown): unknown => (typeof value === "bigint" ? value.toString() : value);
const codeBlock = (text: string): string => "```\n" + text + "\n```";
