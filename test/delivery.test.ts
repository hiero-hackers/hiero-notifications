import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  webhookDelivery,
  slackDelivery,
  discordDelivery,
  consoleDelivery,
} from "../src/delivery.js";
import { makeNotification, makeReceipt } from "./fixtures.js";

describe("webhookDelivery", () => {
  it("POSTs JSON with bigints serialized as strings (no precision lost)", async () => {
    const fetchMock = vi.fn(
      async (_url: string, _init: RequestInit) => new Response(null, { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await webhookDelivery("https://hook.example").deliver(makeNotification());

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://hook.example");
    expect((init.headers as Record<string, string>)["content-type"]).toBe("application/json");
    const body = JSON.parse(init.body as string);
    expect(body.payload.feeTinybar).toBe("0"); // bigint → string
    expect(body.subject).toBe("0.0.222");

    vi.unstubAllGlobals();
  });

  it("throws on a non-2xx response, so the watcher logs it rather than crashing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 500 })),
    );
    await expect(
      webhookDelivery("https://hook.example").deliver(makeNotification()),
    ).rejects.toThrow("500");
    vi.unstubAllGlobals();
  });
});

describe("chat deliveries (incoming webhooks)", () => {
  it("Slack posts the receipt text under `text`", async () => {
    const fetchMock = vi.fn(
      async (_url: string, _init: RequestInit) => new Response(null, { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await slackDelivery("https://hooks.slack.com/x").deliver(
      makeNotification({ text: "You received 1 ℏ" }),
    );
    const body = JSON.parse(String(fetchMock.mock.calls[0]![1].body));
    expect(body.text).toContain("You received 1 ℏ");
    vi.unstubAllGlobals();
  });

  it("Discord posts the receipt text under `content`", async () => {
    const fetchMock = vi.fn(
      async (_url: string, _init: RequestInit) => new Response(null, { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await discordDelivery("https://discord.com/api/webhooks/x").deliver(
      makeNotification({ text: "You received 1 ℏ" }),
    );
    const body = JSON.parse(String(fetchMock.mock.calls[0]![1].body));
    expect(body.content).toContain("You received 1 ℏ");
    vi.unstubAllGlobals();
  });
});

describe("code block hardening (audit #4)", () => {
  it("memo backticks cannot break out of the Slack/Discord code block", async () => {
    const { codeBlock } = await import("../src/delivery.js");
    const wrapped = codeBlock("innocent\n```\n<https://evil.example|click me>\n```");
    const inner = wrapped.slice(4, -4); // strip the wrapping ```\n … \n```
    expect(inner).not.toContain("`");
    expect(wrapped.startsWith("```\n")).toBe(true);
    expect(wrapped.endsWith("\n```")).toBe(true);
  });
});

describe("HTTP deliveries through a stubbed fetch (audit #5)", () => {
  interface Sent {
    url: string;
    body: string;
    headers: Record<string, string>;
  }
  const sent: Sent[] = [];
  let status = 200;

  beforeEach(() => {
    sent.length = 0;
    status = 200;
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      sent.push({
        url,
        body: String(init.body),
        headers: init.headers as Record<string, string>,
      });
      return { ok: status < 300, status } as Response;
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  const notification = () =>
    makeNotification({
      subject: "0.0.9",
      text: "You sent 1 ℏ",
      html: "<div>receipt</div>",
      payload: makeReceipt({ feeTinybar: 5000000n }),
    });

  it("webhook json: exact bigints as strings, custom headers carried", async () => {
    await webhookDelivery("https://h.example/hook", {
      headers: { authorization: "Bearer t" },
    }).deliver(notification());
    const [req] = sent;
    expect(req!.url).toBe("https://h.example/hook");
    expect(req!.headers["content-type"]).toBe("application/json");
    expect(req!.headers["authorization"]).toBe("Bearer t");
    expect(JSON.parse(req!.body).payload.feeTinybar).toBe("5000000");
  });

  it("webhook html: posts the rendered body, falling back to <pre> text", async () => {
    await webhookDelivery("https://h.example", { format: "html" }).deliver(notification());
    expect(sent[0]!.body).toBe("<div>receipt</div>");
    expect(sent[0]!.headers["content-type"]).toBe("text/html");
    const { html: _html, ...bare } = makeNotification({ subject: "0.0.9", text: "plain" });
    await webhookDelivery("https://h.example", { format: "html" }).deliver(bare);
    expect(sent[1]!.body).toBe("<pre>plain</pre>");
  });

  it("slack: text arrives inside a hardened code block", async () => {
    await slackDelivery("https://hooks.slack.example").deliver(notification());
    const payload = JSON.parse(sent[0]!.body);
    expect(payload.text.startsWith("```\n")).toBe(true);
    expect(payload.text).toContain("You sent 1 ℏ");
  });

  it("discord: content is capped under the 2000-char limit", async () => {
    const long = makeNotification({
      subject: "0.0.9",
      text: "x".repeat(5000),
      payload: makeReceipt({}),
    });
    await discordDelivery("https://discord.example").deliver(long);
    expect(JSON.parse(sent[0]!.body).content.length).toBeLessThanOrEqual(1990);
  });

  it("a non-2xx response throws with the status, so the watcher can retry", async () => {
    status = 503;
    await expect(webhookDelivery("https://h.example").deliver(notification())).rejects.toThrow(
      /503/,
    );
  });
});

describe("console delivery", () => {
  it("prints the framed notification", async () => {
    const logged: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((s: string) => void logged.push(s));
    try {
      await consoleDelivery.deliver(
        makeNotification({ subject: "0.0.9", text: "line1\nline2", payload: makeReceipt({}) }),
      );
    } finally {
      spy.mockRestore();
    }
    expect(logged[0]).toContain("│ line1");
    expect(logged[0]).toContain("│ line2");
    expect(logged[0]).toContain("0.0.9");
  });
});

describe("idempotency id (audit-2 #5)", () => {
  it("the webhook JSON carries the notification id for consumer dedupe", async () => {
    const bodies: string[] = [];
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      bodies.push(String(init.body));
      return { ok: true, status: 200 } as Response;
    });
    try {
      await webhookDelivery("https://h.example").deliver(makeNotification({ subject: "0.0.9" }));
    } finally {
      vi.unstubAllGlobals();
    }
    expect(JSON.parse(bodies[0]!).id).toMatch(/^account-activity:/);
  });
});
