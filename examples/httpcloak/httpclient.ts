// Sends the examples' target requests with httpcloak (Chrome TLS and HTTP/2
// fingerprint, one cookie jar) and holds Chrome's headers for each kind of
// request.
import { Session } from "httpcloak";
import { HttpsProxyAgent } from "https-proxy-agent";
import { OneStopError, type CloudflareHttpRequest } from "onestop-antibot";

export interface Response {
  status: number;
  header(name: string): string;
  url: string; // final URL, after redirects
  body: string;
  bytes: Buffer;
  // resolve returns a URL found in the body (HTML-escaped, maybe relative) as
  // an absolute URL.
  resolve(ref: string): URL;
  // json returns the body parsed as JSON, or undefined.
  json<T>(): T | undefined;
}

// fatal prints message and ends the program.
export function fatal(message: string): never {
  console.error(message);
  process.exit(1);
}

// fail is a promise rejection handler that ends the program with
// "FAIL <what>: <error>".
export function fail(what: string): (err: Error) => never {
  return (err) => fatal(`FAIL ${what}: ${err instanceof OneStopError ? err : err.message}`);
}

process.setUncaughtExceptionCaptureCallback((err) =>
  fatal(`FAIL ${err instanceof OneStopError || !(err instanceof Error) ? String(err) : err.message}`),
);

export class Client {
  readonly #session: Session;

  // A client that follows redirects. proxy is "" or a proxy URL. httpcloak
  // adds no headers of its own (tlsOnly); HTTP/3 is off so every request
  // goes through the proxy.
  constructor(proxy: string) {
    this.#session = new Session({
      preset: "chrome-154-windows",
      proxy: proxy || undefined,
      tlsOnly: true,
      disableHttp3: true,
      retry: 0,
      withoutConditionalCache: true,
      timeout: 30,
    });
  }

  get(url: string, headers: Headers): Promise<Response> {
    return this.do("GET", url, headers);
  }

  post(url: string, headers: Headers, body: string | Buffer): Promise<Response> {
    return this.do("POST", url, headers, body);
  }

  // do sends one request with the headers in the given order, content-length
  // first and cookie right after accept-language. Headers with an empty value
  // are left out. A transport error ends the program.
  async do(method: string, url: string, headers: Headers, body?: string | Buffer): Promise<Response> {
    const sent: Record<string, string> = {};
    const order = ["content-length"];
    for (const [name, value] of headers.list) {
      if (!value) continue;
      sent[name] = value;
      order.push(name);
      if (name === "accept-language") order.push("cookie");
    }
    let res;
    try {
      res = await this.#session.request(method, url, {
        headers: sent,
        headerOrder: order,
        body: method === "GET" ? undefined : body,
      });
    } catch (err) {
      fatal(`FAIL ${method} ${url}: ${(err as Error).message}`);
    }
    // The native library returns every header as a list of values.
    const values = new Map<string, string[]>();
    for (const [name, value] of Object.entries(res.headers as unknown as Record<string, string[]>)) {
      values.set(name.toLowerCase(), [...(values.get(name.toLowerCase()) ?? []), ...value]);
    }
    console.log(method, url, res.statusCode);
    const finalUrl = res.finalUrl;
    const text = res.text;
    return {
      status: res.statusCode,
      header: (name) => values.get(name.toLowerCase())?.[0] ?? "",
      url: finalUrl,
      body: text,
      bytes: res.body,
      resolve: (ref) => new URL(unescapeHtml(ref), finalUrl),
      json: () => {
        try {
          return JSON.parse(text);
        } catch {
          return undefined;
        }
      },
    };
  }

  // followRedirects turns redirect following on or off for later requests.
  followRedirects(follow: boolean): void {
    this.#session.setFollowRedirects(follow);
  }

  // cookie returns the first of the named cookies stored for url's host, or "".
  cookie(url: string, ...names: string[]): string {
    const host = new URL(url).hostname;
    const cookies = this.#session.getCookies();
    for (const name of names) {
      for (const c of cookies) {
        const domain = c.domain.replace(/^\./, "");
        if (c.name === name && (host === domain || host.endsWith("." + domain))) return c.value;
      }
    }
    return "";
  }

  // setCookie stores a cookie for domain and its subdomains.
  setCookie(domain: string, name: string, value: string): void {
    this.#session.setCookie(name, value, { domain, path: "/" });
  }
}

// ipAgent is the transport for getIp(), through the same proxy, so the API
// sees the IP the target sees.
export function ipAgent(proxy: string): HttpsProxyAgent<string> | undefined {
  return proxy ? new HttpsProxyAgent(proxy) : undefined;
}

// queryEscape escapes s for a URL query (space as +, like a form).
export function queryEscape(s: string): string {
  return encodeURIComponent(s)
    .replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase())
    .replace(/%20/g, "+");
}

// pngSize returns a PNG's width and height from its IHDR chunk.
export function pngSize(png: Buffer): [number, number] {
  if (png.length < 24 || png.readUInt32BE(0) !== 0x89504e47) throw new Error("png: not a PNG file");
  return [png.readUInt32BE(16), png.readUInt32BE(20)];
}

function unescapeHtml(s: string): string {
  const named: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
  return s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|amp|lt|gt|quot|apos);/g, (_, e: string) =>
    e[0] !== "#" ? named[e] : String.fromCodePoint(e[1] === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)),
  );
}

// Chrome 154 on Windows. Every header set below is in Chrome's order; check them against your browser on your site.
export const userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36";
const secChUa = `"Chromium";v="154", "Google Chrome";v="154", "Not A(Brand";v="99"`;
const secChUaFull = `"Chromium";v="154.0.8037.58", "Google Chrome";v="154.0.8037.58", "Not A(Brand";v="99.0.0.0"`;
const secChUaVersion = `"154.0.8037.58"`;
const platform = `"Windows"`;
const acceptDocument = "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7";
const acceptImage = "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8";
const acceptEncoding = "gzip, deflate, br, zstd";

// Headers are sent in this order.
export class Headers {
  readonly list: [string, string][];

  constructor(list: [string, string][]) {
    this.list = list;
  }

  // noCache puts pragma and cache-control (no-cache) first.
  noCache(): Headers {
    return new Headers([["pragma", "no-cache"], ["cache-control", "no-cache"], ...this.list]);
  }

  // storageAccess adds sec-fetch-storage-access after sec-fetch-dest, as
  // Chrome sends it for requests to a cross-site frame's host.
  storageAccess(): Headers {
    const i = this.list.findIndex(([name]) => name === "sec-fetch-dest") + 1;
    return new Headers([...this.list.slice(0, i), ["sec-fetch-storage-access", "active"], ...this.list.slice(i)]);
  }

  // with sets each extra header: a name already in the list keeps its place,
  // new names follow in name order.
  with(extra: Record<string, string>): Headers {
    const out: [string, string][] = this.list.map(([name, value]) => [name, value]);
    for (const name of Object.keys(extra).sort()) {
      const i = out.findIndex(([n]) => n === name.toLowerCase());
      if (i < 0) out.push([name.toLowerCase(), extra[name]]);
      else out[i][1] = extra[name];
    }
    return new Headers(out);
  }
}

// navigate is a top-level page load: referer "" for a typed URL, else a
// same-origin link.
export function navigate(acceptLanguage: string, referer: string): Headers {
  return new Headers([
    ["sec-ch-ua", secChUa],
    ["sec-ch-ua-mobile", "?0"],
    ["sec-ch-ua-platform", platform],
    ["upgrade-insecure-requests", "1"],
    ["user-agent", userAgent],
    ["accept", acceptDocument],
    ["sec-fetch-site", referer ? "same-origin" : "none"],
    ["sec-fetch-mode", "navigate"],
    ["sec-fetch-user", "?1"],
    ["sec-fetch-dest", "document"],
    ["referer", referer],
    ["accept-encoding", acceptEncoding],
    ["accept-language", acceptLanguage],
    ["priority", "u=0, i"],
  ]);
}

// frame is an iframe document load.
export function frame(acceptLanguage: string, site: string, referer: string): Headers {
  return new Headers([
    ["sec-ch-ua", secChUa],
    ["sec-ch-ua-mobile", "?0"],
    ["sec-ch-ua-platform", platform],
    ["upgrade-insecure-requests", "1"],
    ["user-agent", userAgent],
    ["accept", acceptDocument],
    ["sec-fetch-site", site],
    ["sec-fetch-mode", "navigate"],
    ["sec-fetch-dest", "iframe"],
    ["referer", referer],
    ["accept-encoding", acceptEncoding],
    ["accept-language", acceptLanguage],
    ["priority", "u=0, i"],
  ]);
}

// script is a <script src> load.
export function script(acceptLanguage: string, site: string, referer: string): Headers {
  return new Headers([
    ["sec-ch-ua-platform", platform],
    ["user-agent", userAgent],
    ["sec-ch-ua", secChUa],
    ["sec-ch-ua-mobile", "?0"],
    ["accept", "*/*"],
    ["sec-fetch-site", site],
    ["sec-fetch-mode", "no-cors"],
    ["sec-fetch-dest", "script"],
    ["referer", referer],
    ["accept-encoding", acceptEncoding],
    ["accept-language", acceptLanguage],
    ["priority", "u=1"],
  ]);
}

// post is a same-origin fetch from the page; a GET fetch has no origin.
export function post(acceptLanguage: string, contentType: string, origin: string, referer: string): Headers {
  return new Headers([
    ["sec-ch-ua-platform", platform],
    ["user-agent", userAgent],
    ["sec-ch-ua", secChUa],
    ["content-type", contentType],
    ["sec-ch-ua-mobile", "?0"],
    ["accept", "*/*"],
    ["origin", origin],
    ["sec-fetch-site", "same-origin"],
    ["sec-fetch-mode", "cors"],
    ["sec-fetch-dest", "empty"],
    ["referer", referer],
    ["accept-encoding", acceptEncoding],
    ["accept-language", acceptLanguage],
    ["priority", "u=1, i"],
  ]);
}

// image is an <img> load; with an origin it is a CORS image.
export function image(acceptLanguage: string, origin: string, site: string, referer: string): Headers {
  return new Headers([
    ["origin", origin],
    ["sec-ch-ua-platform", platform],
    ["user-agent", userAgent],
    ["sec-ch-ua", secChUa],
    ["sec-ch-ua-mobile", "?0"],
    ["accept", acceptImage],
    ["sec-fetch-site", site],
    ["sec-fetch-mode", origin ? "cors" : "no-cors"],
    ["sec-fetch-dest", "image"],
    ["referer", referer],
    ["accept-encoding", acceptEncoding],
    ["accept-language", acceptLanguage],
    ["priority", "i"],
  ]);
}

// kasadaMfc is the mfc fetch; version is x-kpsdk-v from the p.js result.
export function kasadaMfc(acceptLanguage: string, version: string, referer: string): Headers {
  return new Headers([
    ["x-kpsdk-v", version],
    ["sec-ch-ua-platform", platform],
    ["user-agent", userAgent],
    ["x-kpsdk-h", "01"],
    ["sec-ch-ua", secChUa],
    ["sec-ch-ua-mobile", "?0"],
    ["accept", "*/*"],
    ["sec-fetch-site", "same-origin"],
    ["sec-fetch-mode", "cors"],
    ["sec-fetch-dest", "empty"],
    ["referer", referer],
    ["accept-encoding", acceptEncoding],
    ["accept-language", acceptLanguage],
    ["priority", "u=1, i"],
  ]);
}

// kasadaTl is the /tl POST with the x-kpsdk-* headers from the API.
export function kasadaTl(acceptLanguage: string, kasada: Record<string, string>, origin: string, referer: string): Headers {
  return new Headers([
    ["x-kpsdk-ct", kasada["x-kpsdk-ct"]],
    ["sec-ch-ua-platform", platform],
    ["x-kpsdk-dt", kasada["x-kpsdk-dt"]],
    ["sec-ch-ua", secChUa],
    ["x-kpsdk-im", kasada["x-kpsdk-im"]],
    ["sec-ch-ua-mobile", "?0"],
    ["x-kpsdk-v", kasada["x-kpsdk-v"]],
    ["user-agent", userAgent],
    ["content-type", "application/octet-stream"],
    ["accept", "*/*"],
    ["origin", origin],
    ["sec-fetch-site", "same-origin"],
    ["sec-fetch-mode", "cors"],
    ["sec-fetch-dest", "empty"],
    ["referer", referer],
    ["accept-encoding", acceptEncoding],
    ["accept-language", acceptLanguage],
    ["priority", "u=1, i"],
  ]).with(kasada);
}

// challengeScript is the Cloudflare challenge script. The challenge page
// asks for every client hint (Accept-CH), so the full set is sent.
export function challengeScript(acceptLanguage: string, referer: string): Headers {
  return new Headers([
    ["sec-ch-ua-full-version-list", secChUaFull],
    ["sec-ch-ua-platform", platform],
    ["sec-ch-ua", secChUa],
    ["sec-ch-ua-bitness", `"64"`],
    ["sec-ch-ua-model", `""`],
    ["sec-ch-ua-mobile", "?0"],
    ["sec-ch-ua-arch", `"x86"`],
    ["sec-ch-ua-full-version", secChUaVersion],
    ["user-agent", userAgent],
    ["sec-ch-ua-platform-version", `"19.0.0"`],
    ["accept", "*/*"],
    ["sec-fetch-site", "same-origin"],
    ["sec-fetch-mode", "no-cors"],
    ["sec-fetch-dest", "script"],
    ["referer", referer],
    ["accept-encoding", acceptEncoding],
    ["accept-language", acceptLanguage],
  ]);
}

// cloudflare is one request of a Cloudflare step, by its purpose, with the
// request's own headers (cf-chl, the form's origin and referer, and the like)
// set on top. frameUrl is the challenge iframe's URL.
export function cloudflare(r: CloudflareHttpRequest, acceptLanguage: string, pageUrl: string, frameUrl: string): Headers {
  const page = new URL(pageUrl);
  const target = new URL(r.url);
  let h: Headers;
  if (r.purpose === "form") {
    h = new Headers([
      ["sec-ch-ua", secChUa],
      ["sec-ch-ua-mobile", "?0"],
      ["sec-ch-ua-full-version", secChUaVersion],
      ["sec-ch-ua-arch", `"x86"`],
      ["sec-ch-ua-full-version-list", secChUaFull],
      ["sec-ch-ua-platform", platform],
      ["sec-ch-ua-platform-version", `"19.0.0"`],
      ["sec-ch-ua-bitness", `"64"`],
      ["sec-ch-ua-model", `""`],
      ["origin", ""],
      ["content-type", "application/x-www-form-urlencoded"],
      ["upgrade-insecure-requests", "1"],
      ["user-agent", userAgent],
      ["referer", ""],
    ]);
  } else if (r.purpose === "iframe") {
    h = frame(acceptLanguage, "cross-site", "").storageAccess();
  } else if (r.purpose === "image") {
    h = image(acceptLanguage, "", "same-origin", frameUrl).storageAccess();
  } else if (r.purpose === "pat") {
    h = new Headers([
      ["cache-control", "max-age=0"],
      ["sec-ch-ua-platform", platform],
      ["user-agent", userAgent],
      ["sec-ch-ua", secChUa],
      ["sec-ch-ua-mobile", "?0"],
      ["accept", "*/*"],
      ["sec-fetch-site", "same-origin"],
      ["sec-fetch-mode", "cors"],
      ["sec-fetch-dest", "empty"],
      ["sec-fetch-storage-access", "active"],
      ["referer", frameUrl],
      ["accept-encoding", acceptEncoding],
      ["accept-language", acceptLanguage],
      ["priority", "u=1, i"],
    ]);
  } else if (target.host === page.host) { // challenge POST from the page
    h = new Headers([
      ["sec-ch-ua-full-version-list", secChUaFull],
      ["sec-ch-ua-platform", platform],
      ["sec-ch-ua", secChUa],
      ["sec-ch-ua-bitness", `"64"`],
      ["cf-chl-ra", "0"],
      ["sec-ch-ua-mobile", "?0"],
      ["sec-ch-ua-model", `""`],
      ["sec-ch-ua-arch", `"x86"`],
      ["sec-ch-ua-full-version", secChUaVersion],
      ["user-agent", userAgent],
      ["content-type", "text/plain;charset=UTF-8"],
      ["cf-chl", r.headers["cf-chl"]],
      ["sec-ch-ua-platform-version", `"19.0.0"`],
      ["accept", "*/*"],
      ["origin", page.origin],
      ["sec-fetch-site", "same-origin"],
      ["sec-fetch-mode", "cors"],
      ["sec-fetch-dest", "empty"],
      ["referer", pageUrl],
      ["accept-encoding", acceptEncoding],
      ["accept-language", acceptLanguage],
      ["priority", "u=1, i"],
    ]);
  } else { // challenge POST from the challenge iframe
    h = new Headers([
      ["sec-ch-ua-platform", platform],
      ["user-agent", userAgent],
      ["sec-ch-ua", secChUa],
      ["content-type", "text/plain;charset=UTF-8"],
      ["cf-chl", r.headers["cf-chl"]],
      ["cf-chl-ra", "0"],
      ["sec-ch-ua-mobile", "?0"],
      ["accept", "*/*"],
      ["origin", target.origin],
      ["sec-fetch-site", "same-origin"],
      ["sec-fetch-mode", "cors"],
      ["sec-fetch-dest", "empty"],
      ["sec-fetch-storage-access", "active"],
      ["referer", frameUrl],
      ["accept-encoding", acceptEncoding],
      ["accept-language", acceptLanguage],
      ["priority", "u=1, i"],
    ]);
  }
  return h.with(r.headers);
}
