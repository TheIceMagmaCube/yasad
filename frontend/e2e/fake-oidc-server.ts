// Serve the fake OpenID Connect provider of the API tests over HTTP, for the browser tests. The tests choose who
// signs in and read what the provider received through the `/__control/` routes; nothing else is added to it,
// except that its end-session address sends the browser back to `post_logout_redirect_uri` as a real provider does.
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import { type FakeClaims, type FakeFaults, fakeOidc } from "../../backend/test/harness/fake-oidc";

const issuer = process.env.FAKE_OIDC_ISSUER ?? "http://127.0.0.1:3197";
const provider = fakeOidc({ issuer, clientId: process.env.FAKE_OIDC_CLIENT_ID, clientSecret: process.env.FAKE_OIDC_CLIENT_SECRET });

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

/** Build the Fetch request the provider handles, aborted when the client goes away (for the `hang` fault). */
function toRequest(req: IncomingMessage, body: Buffer, signal: AbortSignal): Request {
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    for (const v of Array.isArray(value) ? value : [value]) headers.append(name, v);
  }
  const hasBody = req.method !== "GET" && req.method !== "HEAD";
  return new Request(new URL(req.url ?? "/", issuer), { method: req.method, headers, body: hasBody ? new Uint8Array(body) : undefined, signal });
}

async function send(res: ServerResponse, response: Response): Promise<void> {
  const headers: Record<string, string | string[]> = {};
  response.headers.forEach((value, name) => {
    if (name !== "set-cookie") headers[name] = value;
  });
  const cookies = response.headers.getSetCookie();
  if (cookies.length > 0) headers["set-cookie"] = cookies;
  res.writeHead(response.status, headers);
  res.end(Buffer.from(await response.arrayBuffer()));
}

/** Answer the routes the tests use to drive the provider, or return null for any other path. */
function control(req: IncomingMessage, url: URL, body: Buffer): Response | null {
  if (!url.pathname.startsWith("/__control/")) return null;
  const input = body.length > 0 ? (JSON.parse(body.toString("utf8")) as unknown) : null;
  switch (`${req.method} ${url.pathname}`) {
    case "PUT /__control/user":
      provider.user = (input as FakeClaims | null) ?? undefined;
      return new Response(null, { status: 204 });
    case "PUT /__control/faults":
      provider.faults = (input as FakeFaults | null) ?? {};
      return new Response(null, { status: 204 });
    case "GET /__control/requests":
      return Response.json(provider.requests);
    case "POST /__control/reset":
      provider.user = undefined;
      provider.faults = {};
      provider.requests.length = 0;
      return new Response(null, { status: 204 });
    default:
      return new Response("not found", { status: 404 });
  }
}

const server = createServer((req, res) => {
  const aborted = new AbortController();
  res.on("close", () => {
    if (!res.writableFinished) aborted.abort();
  });
  void (async () => {
    try {
      const body = await readBody(req);
      const url = new URL(req.url ?? "/", issuer);
      const controlled = control(req, url, body);
      if (controlled) return await send(res, controlled);
      const response = await provider.handle(toRequest(req, body, aborted.signal));
      const back = url.searchParams.get("post_logout_redirect_uri");
      if (url.pathname === "/end-session" && back) return await send(res, Response.redirect(back, 302));
      await send(res, response);
    } catch (err) {
      if (aborted.signal.aborted) return;
      console.error(err);
      if (!res.headersSent) res.writeHead(500);
      res.end();
    }
  })();
});

const { port, hostname } = new URL(issuer);
server.listen(Number(port), hostname, () => console.log(`Fake OIDC provider on ${issuer}`));
