import http from "node:http";
import https from "node:https";
import net from "node:net";
import tls from "node:tls";

/** Session identity fields; each request lists them in its own fixed field order. */
export interface Identity {
  site?: string;
  userAgent?: string;
  referer?: string;
  acceptLanguage?: string;
  ip?: string;
}

export interface AkamaiWire {
  referer?: string;
  site?: string;
  abck: string;
  bmsz: string;
  userAgent?: string;
  acceptLanguage?: string;
  ip?: string;
  script?: string;
  scriptUrl: string;
  context?: string;
}

export interface SbsdWire extends Identity {
  uuid: string;
  sbsdCookie: string;
  script?: string;
  mode: string;
  context?: string;
}

export interface PixelWire extends Identity {
  html: string;
  script: string;
  context?: string;
}

export interface BmpWire {
  bundleId: string;
  version: string;
  device: string;
  nonce?: string;
  checksum?: string;
  serverSideSignal?: string;
  token?: string;
  difficulty?: number;
  iosVersion?: string;
  uuid?: string;
  realValues?: unknown;
  script?: string;
}

export interface DatadomeTagsWire extends Identity {
  event: string;
  siteKey: string;
  version: string;
  cookie: string;
  context?: string;
}

export interface DatadomeInterstitialWire extends Identity {
  script: string;
  html: string;
  pageResponse: string;
  context?: string;
}

export interface DatadomeSliderWire extends DatadomeInterstitialWire {
  backgroundImage: string;
  puzzlePiece: string;
}

export interface CloudflareWire extends Identity {
  html?: string;
  script?: string;
  scriptUrl?: string;
  response?: unknown;
  context?: string;
  rayId?: string;
  bytecodeRayId?: string;
  iframeUrl?: string;
  imageHeight?: number;
  imageWidth?: number;
  patStatus?: number;
  action?: string;
  cData?: string;
}

export interface KasadaPScriptWire {
  referer: string;
  site: string;
  userAgent: string;
  acceptLanguage: string;
  ip: string;
  script: string;
}

export interface KasadaTlWire extends Identity {
  ipsUrl: string;
  script: string;
}

// Fields left out when empty: an empty string or map, or a null value, is dropped
// (JSON.stringify drops undefined).
export const omit = <V>(v: V): V | undefined => v || undefined;
export const omitNull = <V>(v: V | null | undefined): V | undefined => v ?? undefined;
export const omitEmptyMap = (v: object | undefined): unknown => (v && Object.keys(v).length ? sorted(v) : undefined);
export const omitNullValue = (v: unknown): unknown => (v == null ? undefined : sorted(v));

// Maps are encoded with sorted keys; plain objects are the maps.
function sorted(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sorted);
  if (typeof v !== "object" || v === null || ![Object.prototype, null].includes(Object.getPrototypeOf(v))) return v;
  const entries = Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return Object.fromEntries(entries.map(([k, e]) => [k, sorted(e)]));
}

/** Compact JSON with <, > and & unescaped, U+2028 and U+2029 escaped, and a trailing newline. */
export function encode(body: unknown): string {
  const json = JSON.stringify(body, (_, v) => (typeof v === "string" ? v.toWellFormed() : v));
  return json.replace(/[\u2028\u2029]/g, (c) => "\\u" + c.charCodeAt(0).toString(16)) + "\n";
}

// Response decoding into the fixed response shapes: case-insensitive
// keys, null keeps the zero value, any type mismatch fails the whole response.
type Schema = "string" | "int" | "bool" | "map" | { [field: string]: Schema } | [Schema];

const payload: Schema = { payload: "string", context: "string", sleep: "int" };
const request: Schema = { purpose: "string", method: "string", url: "string", headers: "map", body: "string" };
const envelope: Schema = { success: "bool", error: "string" };

const schemas: Record<string, Schema> = {
  akamai: payload,
  pixel: payload,
  bmp: payload,
  sbsd: payload,
  datadomeTags: payload,
  datadomeInterstitial: payload,
  datadomeSlider: payload,
  cloudflare: { requests: [request], token: "string", context: "string", sleep: "int" },
  kasadaPscript: {
    version: "string",
    headers: "map",
    difficulty: "int",
    subchallengeCount: "int",
    seedSuffix: "string",
    cryptoCustomerKey: "string",
    cacheLifetimeSeconds: "int",
    sleep: "int",
  },
  kasada: { payload: "string", headers: "map", sleep: "int" },
};

const INT64 = 2n ** 63n;
const NOT_INT = Symbol();

// The reviver's third argument (JSON.parse source text access).
interface ReviverContext {
  source?: string;
}

function parse(text: string): unknown {
  return JSON.parse(text, (_, v, ctx?: ReviverContext) => {
    if (typeof v !== "number" || ctx?.source === undefined) return v;
    if (!/^-?\d+$/.test(ctx.source)) return NOT_INT;
    const n = BigInt(ctx.source);
    return n < -INT64 || n >= INT64 ? NOT_INT : v;
  });
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function zero(schema: Schema): unknown {
  if (schema === "string") return "";
  if (schema === "int") return 0;
  if (schema === "bool") return false;
  if (schema === "map") return {};
  if (Array.isArray(schema)) return [];
  return Object.fromEntries(Object.entries(schema).map(([k, s]) => [k, zero(s)]));
}

function decode(v: unknown, schema: Schema, current: unknown): unknown {
  if (v === null) return current;
  const ok =
    schema === "string" ? typeof v === "string"
    : schema === "int" ? typeof v === "number"
    : schema === "bool" ? typeof v === "boolean"
    : Array.isArray(schema) ? Array.isArray(v)
    : isObject(v);
  if (!ok) throw new TypeError();
  if (typeof schema === "string" && schema !== "map") return v;
  if (Array.isArray(schema)) return (v as unknown[]).map((e) => decode(e, schema[0], zero(schema[0])));
  const out = (current ?? {}) as Record<string, unknown>;
  const names = schema === "map" ? undefined : Object.keys(schema);
  for (const [k, e] of Object.entries(v as object)) {
    if (!names) {
      out[k] = decode(e, "string", "");
      continue;
    }
    const name = names.includes(k) ? k : names.find((n) => n.toLowerCase() === k.toLowerCase());
    if (name) out[name] = decode(e, (schema as Record<string, Schema>)[name], out[name]);
  }
  return out;
}

interface Envelope {
  success: boolean;
  error: string;
}

export interface Decoded extends Envelope {
  response: Record<string, unknown>;
}

/** Decodes a /generate response body; undefined when it is not JSON or a field has the wrong type. */
export function decodeResponse(text: string, provider: string): Decoded | undefined {
  try {
    const doc = parse(text);
    const env = decode(doc, envelope, zero(envelope)) as Envelope;
    const schema = schemas[provider];
    const key = provider + "Response";
    const response = zero(schema) as Record<string, unknown>;
    if (isObject(doc) && Object.hasOwn(doc, key)) decode(doc[key], schema, response);
    return { ...env, response };
  } catch {
    return undefined;
  }
}

const directHttp = new http.Agent({ keepAlive: true });
const directHttps = new https.Agent({ keepAlive: true });

export interface Request {
  method: "GET" | "POST";
  headers: Record<string, string>;
  body?: Buffer;
  agent?: http.Agent;
  /** Debug proxy URL; its TLS certificate is not verified and `agent` is ignored. */
  proxy?: string;
  timeoutMs: number;
  signal?: AbortSignal;
}

export interface Response {
  status: number;
  /** First value of a response header (lowercase name), or "". */
  header(name: string): string;
  body: Promise<Buffer>;
}

export const describe = (err: unknown): string =>
  err instanceof AggregateError && !err.message ? err.errors.map(describe).join("; ") : (err as Error).message;

const bare = (hostname: string) => hostname.replace(/^\[(.*)\]$/, "$1");

export function send(url: string, r: Request): Promise<Response> {
  const u = new URL(url);
  const p = r.proxy ? new URL(r.proxy) : undefined;
  const secure = u.protocol === "https:";
  const timeout = AbortSignal.timeout(r.timeoutMs);
  const signal = r.signal ? AbortSignal.any([r.signal, timeout]) : timeout;

  return new Promise<Response>((resolve, reject) => {
    let req: http.ClientRequest | undefined;
    let fail = reject;
    const abort = () => {
      const err = new Error(timeout.aborted ? `timeout after ${r.timeoutMs}ms` : "request canceled");
      req?.destroy(err);
      fail(err);
    };
    if (signal.aborted) return abort();
    signal.addEventListener("abort", abort, { once: true });
    const finish = (err: Error) => {
      signal.removeEventListener("abort", abort);
      fail(err);
    };

    const start = (request: () => http.ClientRequest) => {
      try {
        req = request();
      } catch (err) {
        return finish(err as Error);
      }
      req.on("response", (res: http.IncomingMessage) => {
        const raw = res.rawHeaders;
        const body = new Promise<Buffer>((ok, bad) => {
          const chunks: Buffer[] = [];
          fail = bad;
          res.on("data", (c: Buffer) => chunks.push(c));
          res.on("end", () => {
            signal.removeEventListener("abort", abort);
            ok(Buffer.concat(chunks));
          });
          res.on("error", finish);
        });
        resolve({
          status: res.statusCode ?? 0,
          header(name) {
            for (let i = 0; i < raw.length; i += 2) if (raw[i].toLowerCase() === name) return raw[i + 1];
            return "";
          },
          body,
        });
      });
      req.on("error", finish);
      req.end(r.body);
    };

    const options = { method: r.method, headers: r.headers };
    if (!p) {
      const agent = r.agent ?? (secure ? directHttps : directHttp);
      return start(() => (secure ? https : http).request(u, { ...options, agent }));
    }
    const viaTls = p.protocol === "https:";
    const proxy = {
      host: bare(p.hostname),
      port: Number(p.port) || (viaTls ? 443 : 80),
      agent: false as const,
      rejectUnauthorized: false,
    };
    const toProxy = viaTls ? https : http;
    const proxied = { ...options, headers: { ...r.headers, Host: u.host } };
    if (!secure) return start(() => toProxy.request({ ...proxied, ...proxy, path: u.href }));

    const host = bare(u.hostname);
    const port = Number(u.port) || 443;
    req = toProxy.request({ ...proxy, method: "CONNECT", path: `${u.hostname}:${port}` });
    req.on("connect", (res: http.IncomingMessage, socket: net.Socket) => {
      if (res.statusCode !== 200) {
        socket.destroy();
        return finish(new Error(`proxy CONNECT ${res.statusCode}`));
      }
      const servername = net.isIP(host) ? undefined : host;
      start(() =>
        http.request({
          ...proxied,
          path: u.pathname + u.search,
          createConnection: () => tls.connect({ socket, servername, rejectUnauthorized: false }),
        }),
      );
    });
    req.on("error", finish);
    req.end();
  });
}
