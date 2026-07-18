/**
 * The CONSUMER side of the webhook contract — what your service should do
 * with what `--webhook` sends. Two things worth copying:
 *
 *   1. DEDUPE ON `id`. Delivery is at-least-once (a crash between deliver
 *      and cursor-save re-delivers; --replay re-delivers on purpose), so
 *      the same notification can arrive twice. `id` is stable per event —
 *      remember the ids you have processed and ack duplicates without
 *      reprocessing. (In-memory here; production uses a table with a
 *      unique index on id.)
 *   2. ACK FAST, THEN WORK. A non-2xx makes the watcher retry and finally
 *      dead-letter — so only fail the request when you genuinely could not
 *      record the notification.
 *
 * Demo loop (two terminals):
 *   node examples/webhook-receiver.ts                  # listens on :8787
 *   node dist/cli.js 0.0.1234 --once --webhook http://localhost:8787
 *
 * First: `npm run build` (imports nothing from dist — pure Node, but the
 * demo loop needs the built CLI).
 */
import { createServer } from "node:http";

interface WebhookBody {
  id: string;
  source: string;
  subject: string;
  at: string;
  payload: unknown;
}

const processed = new Set<string>(); // production: unique index on id

const server = createServer((req, res) => {
  let body = "";
  req.on("data", (chunk: Buffer) => (body += chunk.toString()));
  req.on("end", () => {
    let notification: WebhookBody;
    try {
      notification = JSON.parse(body) as WebhookBody;
    } catch {
      res.writeHead(400).end("not JSON");
      return;
    }
    if (processed.has(notification.id)) {
      // A re-delivery — already handled, ack it so the sender stops.
      console.log(`duplicate  ${notification.id} (acked, not reprocessed)`);
      res.writeHead(200).end("duplicate");
      return;
    }
    processed.add(notification.id);
    console.log(`processed  ${notification.id}  ${notification.source} · ${notification.subject}`);
    res.writeHead(200).end("ok");
  });
});

const port = Number(process.env.PORT ?? 8787);
server.listen(port, () => {
  console.log(`webhook receiver on http://localhost:${port} — deduping on notification id`);
});
