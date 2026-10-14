import { setTimeout as sleep } from "node:timers/promises";
import { promisify } from "node:util";
import zlib from "node:zlib";
import { OneStopError } from "./errors.js";
import { Session } from "./session.js";
import type * as T from "./types.js";
import { decodeResponse, describe, encode, send, type Request } from "./wire.js";

/** Default API endpoint. */
export const DEFAULT_ENDPOINT = "https://onestopantibot.com/generate";
const IP_ENDPOINT = "https://ip.onestopantibot.com/";

const zstdCompress = promisify(zlib.zstdCompress);
const zstdDecompress = promisify(zlib.zstdDecompress);
const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);
const { ZSTD_c_compressionLevel, ZSTD_c_checksumFlag } = zlib.constants;

interface Config {
  apiKey: string;
  identifier: string;
  subKey: string;
  endpoint: string;
  compression: "zstd" | "gzip" | "identity";
  timeoutMs: number;
  agent?: Request["agent"];
  ipAgent?: Request["agent"];
  debugProxy: string;
  defaults: T.SessionOptions;
  signal?: AbortSignal;
}

/** OneStop Antibot API client. Reuse one client across concurrent calls. */
export class OneStop {
  readonly #options: T.OneStopOptions;
  readonly #config: Config;

  /** Throws {@link OneStopError} when apiKey or identifier is missing or compression is unknown. */
  constructor(options: T.OneStopOptions) {
    if (!options.apiKey?.trim() || !options.identifier?.trim()) {
      throw new OneStopError("onestop: APIKey and Identifier are required");
    }
    const compression = options.compression || "zstd";
    if (!["zstd", "gzip", "identity"].includes(compression)) {
      throw new OneStopError("onestop: compression must be zstd, gzip or identity");
    }
    const timeoutMs = options.timeoutMs ?? 0;
    this.#options = options;
    this.#config = {
      apiKey: utf8(options.apiKey),
      identifier: utf8(options.identifier),
      subKey: utf8(options.subKey ?? ""),
      endpoint: options.endpoint || DEFAULT_ENDPOINT,
      compression,
      timeoutMs: timeoutMs > 0 ? timeoutMs : 60_000,
      agent: options.agent,
      ipAgent: options.ipAgent ?? options.agent,
      debugProxy: options.debugProxy ?? "",
      defaults: { ...options.defaults },
    };
  }

  /** Returns a copy of the client whose requests are canceled by `signal`. Create sessions from the copy. */
  withSignal(signal: AbortSignal): OneStop {
    const copy = new OneStop(this.#options);
    copy.#config.signal = signal;
    return copy;
  }

  /** Public IP seen by ip.onestopantibot.com, using `ipAgent`. */
  async getIp(): Promise<string> {
    const c = this.#config;
    let res;
    try {
      res = await send(IP_ENDPOINT, {
        method: "GET",
        headers: this.#auth(),
        agent: c.ipAgent,
        timeoutMs: c.timeoutMs,
        signal: c.signal,
      });
    } catch (err) {
      throw new OneStopError(`onestop: request: ${describe(err)}`, 0, "", { cause: err });
    }
    if (res.status !== 200) {
      res.body.catch(() => {});
      throw new OneStopError("IP lookup failed", res.status);
    }
    try {
      return (await res.body).toString("utf8").trim();
    } catch (err) {
      throw new OneStopError(`onestop: read response: ${describe(err)}`, 0, "", { cause: err });
    }
  }

  /** Browser identity for challenge calls; non-empty fields win over `defaults`. */
  session(options: T.SessionOptions = {}): Session {
    const d = this.#config.defaults;
    const pick = (k: keyof T.SessionOptions) => options[k] || d[k] || "";
    return new Session(
      {
        site: pick("site"),
        referer: pick("referer"),
        userAgent: pick("userAgent"),
        acceptLanguage: pick("acceptLanguage"),
        ip: pick("ip"),
      },
      (mode, provider, request) => this.#generate(mode, provider, request),
    );
  }

  #auth(): Record<string, string> {
    const c = this.#config;
    const headers: Record<string, string> = { "x-key": c.apiKey };
    if (c.subKey) headers["x-sub-key"] = c.subKey;
    headers["User-Agent"] = c.identifier;
    return headers;
  }

  async #generate(mode: string, provider: string, request: object): Promise<object> {
    const c = this.#config;
    let body;
    try {
      body = Buffer.from(encode({ [provider + "Request"]: request }));
    } catch (err) {
      throw new OneStopError(`onestop: encode request: ${describe(err)}`, 0, "", { cause: err });
    }
    if (c.compression === "zstd") {
      body = await zstdCompress(body, { params: { [ZSTD_c_compressionLevel]: 7, [ZSTD_c_checksumFlag]: 1 } });
    } else if (c.compression === "gzip") {
      body = await gzip(body);
    }
    const headers: Record<string, string> = { "Content-Type": "application/json; charset=utf-8" };
    if (c.compression !== "identity") headers["Content-Encoding"] = c.compression;
    headers["Accept-Encoding"] = "zstd, gzip";
    headers["x-mode"] = mode;
    let res;
    try {
      res = await send(c.endpoint, {
        method: "POST",
        headers: { ...headers, ...this.#auth() },
        body,
        agent: c.agent,
        proxy: c.debugProxy,
        timeoutMs: c.timeoutMs,
        signal: c.signal,
      });
    } catch (err) {
      throw new OneStopError(`onestop: request: ${describe(err)}`, 0, "", { cause: err });
    }
    const requestId = res.header("requestid");
    let raw: Buffer;
    try {
      raw = await res.body;
    } catch (err) {
      throw new OneStopError(`onestop: read response: ${describe(err)}`, 0, "", { cause: err });
    }
    const data = await decompress(res.header("content-encoding"), raw);
    const decoded = decodeResponse(data.toString("utf8"), provider);
    if (!decoded) throw new OneStopError("invalid JSON response", res.status, requestId);
    if (res.status !== 200 || !decoded.success || decoded.error) {
      throw new OneStopError(decoded.error || "request failed", res.status, requestId);
    }
    const ms = decoded.response.sleep as number;
    if (ms > 0) {
      try {
        await sleep(ms, undefined, { signal: c.signal });
      } catch (err) {
        throw new OneStopError("onestop: request: request canceled", 0, "", { cause: err });
      }
    }
    return { ...decoded.response, requestId };
  }
}

// Node writes header strings as latin1; this puts the UTF-8 bytes on the wire.
const utf8 = (v: string) => Buffer.from(v, "utf8").toString("latin1");

async function decompress(encoding: string, body: Buffer): Promise<Buffer> {
  const kind = encoding.trim().toLowerCase();
  if (kind === "" || kind === "identity") return body;
  if (kind !== "gzip" && kind !== "zstd") {
    throw new OneStopError(`onestop: unsupported response compression ${JSON.stringify(encoding)}`);
  }
  try {
    return await (kind === "gzip" ? gunzip(body) : zstdDecompress(body));
  } catch (err) {
    throw new OneStopError(`onestop: decompress response: ${describe(err)}`, 0, "", { cause: err });
  }
}
