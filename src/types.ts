import type { Agent } from "node:http";

/** Client configuration. Browser identity belongs in {@link SessionOptions}. */
export interface OneStopOptions {
  apiKey: string;
  /** Sent as the User-Agent on API requests. */
  identifier: string;
  /** Optional, sent as x-sub-key. */
  subKey?: string;
  /** Defaults to `https://onestopantibot.com/generate`. */
  endpoint?: string;
  /** Request compression; defaults to zstd. */
  compression?: "zstd" | "gzip" | "identity";
  /** Whole-request deadline in ms for every call. Zero, negative or unset means 60000. */
  timeoutMs?: number;
  /** API transport. The default ignores proxy environment variables. */
  agent?: Agent;
  /** Transport for getIp(), usually your target proxy. Defaults to `agent`. */
  ipAgent?: Agent;
  /** Session defaults; non-empty session fields win. */
  defaults?: SessionOptions;
  /** Debug proxy URL such as `http://127.0.0.1:8888`: every /generate call goes through it on the SDK's own connection (`agent` is not used) and its TLS certificate is accepted. getIp() is not affected. */
  debugProxy?: string;
}

/** Browser identity sent with every challenge call. */
export interface SessionOptions {
  site?: string;
  referer?: string;
  userAgent?: string;
  acceptLanguage?: string;
  ip?: string;
}

/** Inputs for akamaiSensor. Send `script` on the first call and `context`, without `script`, on every later call. */
export interface AkamaiSensorCall {
  abck?: string;
  bmsz?: string;
  script?: string;
  scriptUrl?: string;
  context?: string;
}

/** Inputs for sbsdPayload. `mode` is "f" (fingerprint, with `script`) or "t" (event, with `context`). */
export interface SbsdCall {
  uuid?: string;
  sbsdCookie?: string;
  script?: string;
  mode?: string;
  context?: string;
}

/** Raw page HTML and Pixel script. */
export interface PixelCall {
  html?: string;
  script?: string;
  context?: string;
}

/** Android/iOS SDK inputs; no browser identity is sent. */
export interface BmpCall {
  bundleId?: string;
  version?: string;
  device?: string;
  nonce?: string;
  checksum?: string;
  serverSideSignal?: string;
  token?: string;
  difficulty?: number;
  iosVersion?: string;
  uuid?: string;
  realValues?: Record<string, string>;
  script?: string;
}

/** Inputs for datadomeTags. `event` is "ch" or "le". */
export interface DatadomeTagsCall {
  event?: string;
  siteKey?: string;
  version?: string;
  cookie?: string;
  context?: string;
}

export interface DatadomeInterstitialCall {
  script?: string;
  html?: string;
  pageResponse?: string;
  context?: string;
}

/** Inputs for datadomeSlider. `backgroundImage` and `puzzlePiece` are base64. */
export interface DatadomeSliderCall extends DatadomeInterstitialCall {
  backgroundImage?: string;
  puzzlePiece?: string;
}

/** Inputs for the Cloudflare methods. `response` accepts a string or a JSON value. */
export interface CloudflareCall {
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

/** Inputs for {@link akamaiSecCptPayload}: the sec_cpt cookie value and the challenge JSON's fields. */
export interface AkamaiSecCptCall {
  cookie: string;
  token: string;
  nonce: string;
  timestamp: number;
  difficulty: number;
  count: number;
}

/** Inputs for {@link kasadaCdHeader}; the crypto fields come from kasadaPScript. */
export interface KasadaCdCall {
  st: number;
  rst: number;
  mobile?: boolean;
  ct?: string;
  cryptoCustomerKey?: string;
  seedSuffix?: string;
  difficulty: number;
  subchallengeCount: number;
}

/** Returned by akamaiSensor, pixel and bmp. */
export interface AkamaiResponse {
  payload: string;
  context: string;
  /** Wait in ms the API asked for; the SDK has already waited it before returning. */
  sleep: number;
  requestId: string;
}

/** `payload` is the complete form body for the Pixel POST. */
export type PixelResponse = AkamaiResponse;
export type BmpResponse = AkamaiResponse;

export interface SbsdResponse {
  payload: string;
  context: string;
  sleep: number;
  requestId: string;
}

/** Returned by the DataDome methods. `payload` is already encoded. */
export interface DatadomeResponse {
  payload: string;
  context: string;
  sleep: number;
  requestId: string;
}

export type DatadomeTagsResponse = DatadomeResponse;
export type DatadomeInterstitialResponse = DatadomeResponse;
export type DatadomeSliderResponse = DatadomeResponse;

/** Target requests for one Cloudflare challenge step. */
export interface CloudflareResponse {
  requests: CloudflareHttpRequest[];
  token: string;
  context: string;
  sleep: number;
  requestId: string;
}

/** One target request; `purpose` is challenge, iframe, image, pat or form. */
export interface CloudflareHttpRequest {
  purpose: string;
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string;
}

/** Values extracted from p.js; the crypto fields feed {@link kasadaCdHeader}. */
export interface KasadaPScriptResponse {
  version: string;
  headers: Record<string, string>;
  difficulty: number;
  subchallengeCount: number;
  seedSuffix: string;
  cryptoCustomerKey: string;
  cacheLifetimeSeconds: number;
  sleep: number;
  requestId: string;
  /** Desktop x-kpsdk-cd header from the /tl response's `x-kpsdk-ct` value and `x-kpsdk-st` header (ms). Use {@link kasadaCdHeader} for mobile. Not enumerable, so not serialized. */
  cdHeader(ct: string, st: number): string;
}

/** Base64 TL body and the headers to send with it. */
export interface KasadaResponse {
  payload: string;
  headers: Record<string, string>;
  sleep: number;
  requestId: string;
}
