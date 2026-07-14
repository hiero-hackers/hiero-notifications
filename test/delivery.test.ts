import { describe, it, expect, vi } from "vitest";
import { webhookDelivery, slackDelivery, discordDelivery } from "../src/delivery.js";
import { makeEvent } from "./fixtures.js";

describe("webhookDelivery", () => {
  it("POSTs JSON with bigints serialized as strings (no precision lost)", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await webhookDelivery("https://hook.example").deliver(makeEvent());

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://hook.example");
    expect((init.headers as Record<string, string>)["content-type"]).toBe("application/json");
    const body = JSON.parse(init.body as string);
    expect(body.receipt.feeTinybar).toBe("0"); // bigint → string
    expect(body.account).toBe("0.0.222");

    vi.unstubAllGlobals();
  });

  it("throws on a non-2xx response, so the watcher logs it rather than crashing", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 500 })));
    await expect(webhookDelivery("https://hook.example").deliver(makeEvent())).rejects.toThrow("500");
    vi.unstubAllGlobals();
  });
});

describe("chat deliveries (incoming webhooks)", () => {
  it("Slack posts the receipt text under `text`", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await slackDelivery("https://hooks.slack.com/x").deliver(makeEvent({ text: "You received 1 ℏ" }));
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.text).toContain("You received 1 ℏ");
    vi.unstubAllGlobals();
  });

  it("Discord posts the receipt text under `content`", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await discordDelivery("https://discord.com/api/webhooks/x").deliver(makeEvent({ text: "You received 1 ℏ" }));
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.content).toContain("You received 1 ℏ");
    vi.unstubAllGlobals();
  });
});
