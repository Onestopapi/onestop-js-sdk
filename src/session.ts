import { kasadaCdHeader } from "./kasada.js";
import type * as T from "./types.js";
import { omit, omitEmptyMap, omitNull, omitNullValue, type Identity } from "./wire.js";
import type * as W from "./wire.js";

type Generate = (mode: string, provider: string, request: object) => Promise<object>;

/** Browser identity bound to a client; create it with {@link OneStop.session}. */
export class Session {
  readonly site: string;
  readonly referer: string;
  readonly userAgent: string;
  readonly acceptLanguage: string;
  readonly ip: string;
  readonly #generate: Generate;

  constructor(identity: Required<T.SessionOptions>, generate: Generate) {
    this.site = identity.site;
    this.referer = identity.referer;
    this.userAgent = identity.userAgent;
    this.acceptLanguage = identity.acceptLanguage;
    this.ip = identity.ip;
    this.#generate = generate;
  }

  #call<R>(mode: string, provider: string, body: object): Promise<R> {
    return this.#generate(mode, provider, body) as Promise<R>;
  }

  // Each identity lists the fields in the wire order of the requests that use it.
  #identity(): Identity {
    const { site, userAgent, referer, acceptLanguage, ip } = this;
    return { site: omit(site), userAgent: omit(userAgent), referer: omit(referer), acceptLanguage: omit(acceptLanguage), ip: omit(ip) };
  }

  #datadomeIdentity(): Identity {
    const { site, userAgent, acceptLanguage, ip, referer } = this;
    return { site: omit(site), userAgent: omit(userAgent), acceptLanguage: omit(acceptLanguage), ip: omit(ip), referer: omit(referer) };
  }

  #refererIdentity(): Identity {
    const { referer, site, userAgent, acceptLanguage, ip } = this;
    return { referer: omit(referer), site: omit(site), userAgent: omit(userAgent), acceptLanguage: omit(acceptLanguage), ip: omit(ip) };
  }

  akamaiSensor(call: T.AkamaiSensorCall): Promise<T.AkamaiResponse> {
    const body: W.AkamaiWire = {
      referer: omit(this.referer),
      site: omit(this.site),
      abck: call.abck ?? "",
      bmsz: call.bmsz ?? "",
      userAgent: omit(this.userAgent),
      acceptLanguage: omit(this.acceptLanguage),
      ip: omit(this.ip),
      script: omit(call.script),
      scriptUrl: call.scriptUrl ?? "",
      context: omit(call.context),
    };
    return this.#call("Akamai", "akamai", body);
  }

  sbsdPayload(call: T.SbsdCall): Promise<T.SbsdResponse> {
    const body: W.SbsdWire = {
      ...this.#refererIdentity(),
      uuid: call.uuid ?? "",
      sbsdCookie: call.sbsdCookie ?? "",
      script: omit(call.script),
      mode: call.mode ?? "",
      context: omit(call.context),
    };
    return this.#call("Sbsd", "sbsd", body);
  }

  pixel(call: T.PixelCall): Promise<T.PixelResponse> {
    const body: W.PixelWire = {
      ...this.#identity(),
      html: call.html ?? "",
      script: call.script ?? "",
      context: omit(call.context),
    };
    return this.#call("Akamai", "pixel", body);
  }

  /** Akamai BMP (mobile SDK) payload; no browser identity is sent. */
  bmp(call: T.BmpCall): Promise<T.BmpResponse> {
    const body: W.BmpWire = {
      bundleId: call.bundleId ?? "",
      version: call.version ?? "",
      device: call.device ?? "",
      nonce: omit(call.nonce),
      checksum: omit(call.checksum),
      serverSideSignal: omit(call.serverSideSignal),
      token: omit(call.token),
      difficulty: omitNull(call.difficulty),
      iosVersion: omit(call.iosVersion),
      uuid: omit(call.uuid),
      realValues: omitEmptyMap(call.realValues),
      script: omit(call.script),
    };
    return this.#call("Akamai", "bmp", body);
  }

  datadomeTags(call: T.DatadomeTagsCall): Promise<T.DatadomeTagsResponse> {
    const body: W.DatadomeTagsWire = {
      ...this.#datadomeIdentity(),
      event: call.event ?? "",
      siteKey: call.siteKey ?? "",
      version: call.version ?? "",
      cookie: call.cookie ?? "",
      context: omit(call.context),
    };
    return this.#call("DatadomeTags", "datadomeTags", body);
  }

  datadomeInterstitial(call: T.DatadomeInterstitialCall): Promise<T.DatadomeInterstitialResponse> {
    const body: W.DatadomeInterstitialWire = {
      ...this.#datadomeIdentity(),
      script: call.script ?? "",
      html: call.html ?? "",
      pageResponse: call.pageResponse ?? "",
      context: omit(call.context),
    };
    return this.#call("DatadomeInterstitial", "datadomeInterstitial", body);
  }

  /** Returns the check request's query string as `body`. */
  datadomeSlider(call: T.DatadomeSliderCall): Promise<T.DatadomeSliderResponse> {
    const body: W.DatadomeSliderWire = {
      ...this.#datadomeIdentity(),
      script: call.script ?? "",
      html: call.html ?? "",
      pageResponse: call.pageResponse ?? "",
      backgroundImage: call.backgroundImage ?? "",
      puzzlePiece: call.puzzlePiece ?? "",
      context: omit(call.context),
    };
    return this.#call("DatadomeSlider", "datadomeSlider", body);
  }

  /** One Cloudflare step; the API detects the challenge type. */
  cloudflareStep(call: T.CloudflareCall): Promise<T.CloudflareResponse> {
    return this.#cloudflare("Cloudflare", call);
  }

  cloudflareTurnstile(call: T.CloudflareCall): Promise<T.CloudflareResponse> {
    return this.#cloudflare("CloudflareTurnstile", call);
  }

  cloudflareWaf(call: T.CloudflareCall): Promise<T.CloudflareResponse> {
    return this.#cloudflare("CloudflareWaf", call);
  }

  cloudflareJsd(call: T.CloudflareCall): Promise<T.CloudflareResponse> {
    return this.#cloudflare("CloudflareJsd", call);
  }

  cloudflarePrecursor(call: T.CloudflareCall): Promise<T.CloudflareResponse> {
    return this.#cloudflare("CloudflarePrecursor", call);
  }

  /** Version and CD inputs from raw p.js source. */
  async kasadaPScript(script: string): Promise<T.KasadaPScriptResponse> {
    const { referer, site, userAgent, acceptLanguage, ip } = this;
    const body: W.KasadaPScriptWire = { referer, site, userAgent, acceptLanguage, ip, script };
    const p = await this.#call<T.KasadaPScriptResponse>("Kasada", "kasadaPscript", body);
    return Object.defineProperty(p, "cdHeader", {
      value: (ct: string, st: number) =>
        kasadaCdHeader({
          st,
          rst: Math.max(Date.now(), st),
          mobile: false,
          ct,
          cryptoCustomerKey: p.cryptoCustomerKey,
          seedSuffix: p.seedSuffix,
          difficulty: p.difficulty,
          subchallengeCount: p.subchallengeCount,
        }),
    });
  }

  /** TL body from the ips.js URL and raw source. */
  kasadaTl(scriptUrl: string, script: string): Promise<T.KasadaResponse> {
    const body: W.KasadaTlWire = { ...this.#refererIdentity(), ipsUrl: scriptUrl, script };
    return this.#call("Kasada", "kasada", body);
  }

  #cloudflare(mode: string, call: T.CloudflareCall): Promise<T.CloudflareResponse> {
    const body: W.CloudflareWire = {
      ...this.#identity(),
      html: omit(call.html),
      script: omit(call.script),
      scriptUrl: omit(call.scriptUrl),
      response: omitNullValue(call.response),
      context: omit(call.context),
      rayId: omit(call.rayId),
      bytecodeRayId: omit(call.bytecodeRayId),
      iframeUrl: omit(call.iframeUrl),
      imageHeight: omitNull(call.imageHeight),
      imageWidth: omitNull(call.imageWidth),
      patStatus: omitNull(call.patStatus),
      action: omit(call.action),
      cData: omit(call.cData),
    };
    return this.#call(mode, "cloudflare", body);
  }
}
