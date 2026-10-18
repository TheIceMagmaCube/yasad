// Fake OpenID Connect provider for tests: a stateless `Request -> Response` handler. API tests plug it
// into `fetch`; the E2E setup can serve the same handler over HTTP. A code carries everything the
// token endpoint needs (claims, nonce, PKCE challenge, redirect URI), so nothing is kept between calls.
// It is strict where YASAD must be: PKCE S256 is required at the authorization request and checked at
// the exchange.

/** Claims of the person signing in; `sub` is required, the rest goes into the ID token as given. */
export type FakeClaims = { sub: string; [claim: string]: unknown };

/** Ways to make the provider misbehave, changed by a test between requests. */
export type FakeFaults = {
  /**
   * `unavailable` answers 503; `hang` never answers until the request is aborted; `hang-after-first`
   * answers the next read, then becomes `hang` (YASAD reads first, Better Auth second).
   */
  discovery?: "ok" | "unavailable" | "hang" | "hang-after-first";
  /** Never answer the token request until it is aborted. */
  token?: "hang";
  /** Spoil the ID token returned by the token endpoint, or leave it out. */
  idToken?: "ok" | "missing" | "bad-signature" | "wrong-audience" | "wrong-issuer" | "wrong-nonce" | "expired";
  /** Leave `end_session_endpoint` out of the discovery document. */
  noEndSession?: boolean;
  /**
   * Leave `id_token_signing_alg_values_supported` out of the discovery document; `after-first` keeps
   * it in the next read and leaves it out of the later ones.
   */
  noSigningAlgs?: boolean | "after-first";
  /** Publish the token endpoint in http. */
  insecureTokenEndpoint?: boolean;
  /** Answer the authorization request with this OAuth error instead of a code. */
  authorizeError?: string;
};

export type FakeOidcOptions = {
  issuer?: string;
  clientId?: string;
  clientSecret?: string;
  /** Person signed in at the provider when the authorization request names none. */
  user?: FakeClaims;
};

export type FakeOidc = {
  issuer: string;
  discoveryUrl: string;
  clientId: string;
  clientSecret: string;
  /** Environment variables pointing YASAD at this provider. */
  env: Record<string, string>;
  faults: FakeFaults;
  /** Person signed in at the provider when the authorization request names none. */
  user: FakeClaims | undefined;
  /** Method and address of every request received, oldest first. */
  requests: { method: string; url: string }[];
  handle(request: Request): Promise<Response>;
  /** Return the authorization address with `claims` as the person signing in. */
  as(authorizeUrl: string, claims: FakeClaims): string;
};

type CodePayload = { claims: FakeClaims; nonce: string | null; challenge: string; redirectUri: string; clientId: string };

const KID = "fake-oidc-key";
const encoder = new TextEncoder();

function base64url(bytes: Uint8Array | string): string {
  const data = typeof bytes === "string" ? encoder.encode(bytes) : bytes;
  return btoa(String.fromCharCode(...data))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function fromBase64url(value: string): string {
  const b64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const bytes = Uint8Array.from(atob(b64.padEnd(Math.ceil(b64.length / 4) * 4, "=")), (ch) => ch.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/** Return the PKCE S256 challenge of a verifier. */
export async function s256(verifier: string): Promise<string> {
  return base64url(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(verifier))));
}

let keyPair: Promise<CryptoKeyPair> | undefined;
let otherKeyPair: Promise<CryptoKeyPair> | undefined;

const newKeyPair = () =>
  crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  ) as Promise<CryptoKeyPair>;

async function signJwt(payload: Record<string, unknown>, key: CryptoKey): Promise<string> {
  const input = `${base64url(JSON.stringify({ alg: "RS256", typ: "JWT", kid: KID }))}.${base64url(JSON.stringify(payload))}`;
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, encoder.encode(input));
  return `${input}.${base64url(new Uint8Array(signature))}`;
}

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });
const oauthError = (error: string, status = 400) => json({ error }, status);

/** Return a fake provider; `issuer` defaults to https://idp.test. */
export function fakeOidc(options: FakeOidcOptions = {}): FakeOidc {
  const issuer = options.issuer ?? "https://idp.test";
  const clientId = options.clientId ?? "yasad-test";
  const clientSecret = options.clientSecret ?? "fake-client-secret";
  const discoveryUrl = `${issuer}/.well-known/openid-configuration`;
  keyPair ??= newKeyPair();
  otherKeyPair ??= newKeyPair();

  const provider: FakeOidc = {
    issuer,
    discoveryUrl,
    clientId,
    clientSecret,
    env: { OIDC_DISCOVERY_URL: discoveryUrl, OIDC_CLIENT_ID: clientId, OIDC_CLIENT_SECRET: clientSecret },
    faults: {},
    user: options.user,
    requests: [],
    as(authorizeUrl, claims) {
      const url = new URL(authorizeUrl);
      url.searchParams.set("login", base64url(JSON.stringify(claims)));
      return url.toString();
    },
    async handle(request) {
      provider.requests.push({ method: request.method, url: request.url });
      const url = new URL(request.url);
      if (url.origin !== new URL(issuer).origin) return new Response("unknown host", { status: 502 });
      switch (url.pathname) {
        case "/.well-known/openid-configuration":
          return discovery(request);
        case "/jwks":
          return json({ keys: [{ ...(await crypto.subtle.exportKey("jwk", (await keyPair!).publicKey)), kid: KID, alg: "RS256", use: "sig" }] });
        case "/authorize":
          return authorize(url);
        case "/token":
          return provider.faults.token === "hang" ? hang(request) : token(request);
        case "/userinfo":
          return userinfo(request);
        case "/end-session":
          return new Response("signed out", { status: 200 });
        default:
          return new Response("not found", { status: 404 });
      }
    },
  };

  /** Answer nothing until the request is aborted, if ever. */
  function hang(request: Request): Promise<Response> {
    return new Promise((_, reject) => {
      const signal = request.signal;
      if (signal.aborted) reject(signal.reason);
      signal.addEventListener("abort", () => reject(signal.reason));
    });
  }

  async function discovery(request: Request): Promise<Response> {
    const faults = provider.faults;
    if (faults.discovery === "unavailable") return new Response("unavailable", { status: 503 });
    if (faults.discovery === "hang") return hang(request);
    if (faults.discovery === "hang-after-first") faults.discovery = "hang";
    const noSigningAlgs = faults.noSigningAlgs === true;
    if (faults.noSigningAlgs === "after-first") faults.noSigningAlgs = true;
    return json({
      issuer,
      authorization_endpoint: `${issuer}/authorize`,
      token_endpoint: faults.insecureTokenEndpoint ? `${issuer.replace(/^https:/, "http:")}/token` : `${issuer}/token`,
      jwks_uri: `${issuer}/jwks`,
      // Published, and answering with another identity, so a test can tell whether it was read.
      userinfo_endpoint: `${issuer}/userinfo`,
      ...(faults.noEndSession ? {} : { end_session_endpoint: `${issuer}/end-session` }),
      response_types_supported: ["code"],
      subject_types_supported: ["public"],
      ...(noSigningAlgs ? {} : { id_token_signing_alg_values_supported: ["RS256"] }),
      code_challenge_methods_supported: ["S256"],
    });
  }

  /** Answer with groups, name and e-mail that differ from the ID token's. */
  function userinfo(request: Request): Response {
    const sub = request.headers.get("authorization")?.replace(/^Bearer access-/, "");
    if (!sub) return oauthError("invalid_token", 401);
    return json({ sub, email: "userinfo@example.invalid", email_verified: true, name: "From userinfo", groups: ["from-userinfo"] });
  }

  function authorize(url: URL): Response {
    const p = url.searchParams;
    const redirectUri = p.get("redirect_uri");
    const state = p.get("state");
    if (p.get("client_id") !== clientId || !redirectUri || p.get("response_type") !== "code") return oauthError("invalid_request");
    const target = new URL(redirectUri);
    if (state) target.searchParams.set("state", state);
    if (provider.faults.authorizeError) {
      target.searchParams.set("error", provider.faults.authorizeError);
      return Response.redirect(target.toString(), 302);
    }
    const login = p.get("login");
    const claims = login ? (JSON.parse(fromBase64url(login)) as FakeClaims) : provider.user;
    if (!claims) return oauthError("login_required");
    const challenge = p.get("code_challenge");
    if (!challenge || p.get("code_challenge_method") !== "S256") return oauthError("invalid_request");
    const payload: CodePayload = { claims, nonce: p.get("nonce"), challenge, redirectUri, clientId };
    target.searchParams.set("code", base64url(JSON.stringify(payload)));
    return Response.redirect(target.toString(), 302);
  }

  async function token(request: Request): Promise<Response> {
    const form = new URLSearchParams(await request.text());
    let id = form.get("client_id");
    let secret = form.get("client_secret");
    const basic = request.headers.get("authorization");
    if (basic?.startsWith("Basic ")) [id, secret] = atob(basic.slice(6)).split(":").map(decodeURIComponent) as [string, string];
    if (id !== clientId || secret !== clientSecret) return oauthError("invalid_client", 401);
    if (form.get("grant_type") !== "authorization_code") return oauthError("unsupported_grant_type");

    let code: CodePayload;
    try {
      code = JSON.parse(fromBase64url(form.get("code") ?? "")) as CodePayload;
    } catch {
      return oauthError("invalid_grant");
    }
    if (code.clientId !== clientId || code.redirectUri !== form.get("redirect_uri")) return oauthError("invalid_grant");
    const verifier = form.get("code_verifier");
    if (!verifier || !code.challenge || (await s256(verifier)) !== code.challenge) return oauthError("invalid_grant");

    const fault = provider.faults.idToken ?? "ok";
    const now = Math.floor(Date.now() / 1000);
    const claims: Record<string, unknown> = {
      iss: fault === "wrong-issuer" ? "https://evil.test" : issuer,
      aud: fault === "wrong-audience" ? "another-client" : clientId,
      iat: fault === "expired" ? now - 7200 : now,
      exp: fault === "expired" ? now - 3600 : now + 300,
      ...(code.nonce ? { nonce: fault === "wrong-nonce" ? "not-the-nonce" : code.nonce } : {}),
      ...code.claims,
    };
    const signingKey = (await (fault === "bad-signature" ? otherKeyPair! : keyPair!)).privateKey;
    return json({
      access_token: `access-${code.claims.sub}`,
      token_type: "Bearer",
      expires_in: 300,
      scope: "openid email profile",
      ...(fault === "missing" ? {} : { id_token: await signJwt(claims, signingKey) }),
    });
  }

  return provider;
}
