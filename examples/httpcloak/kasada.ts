// Kasada: load the page and its p.js, then mfc, fp (200 or 429) and ips.js, and
// POST the generated /tl body. A page that is already the 429 block page
// links ips.js itself. /tl answers 200 with reload:true. Then build the
// x-kpsdk-cd header locally and make one protected POST.
import { OneStop, type KasadaPScriptResponse, type Session } from "onestop-antibot";
import * as httpclient from "./httpclient.ts";

const apiKey = "YOUR_API_KEY";
const identifier = "YOUR_IDENTIFIER"; // your identifier or account name
const pageUrl = "https://www.example.com/";
const protectedUrl = "https://www.example.com/api/protected"; // a request Kasada protects
const protectedBody = "{}"; // its JSON body
const acceptLanguage = "en-US,en;q=0.9";

const proxy = ""; // your proxy, in the site's country

const pjsPath = /\/[0-9a-f-]{36}\/[0-9a-f-]{36}\/p\.js/;
const ipsScript = /src="([^"]*\/ips\.js[^"]*)"/;

// Ips is the loaded ips.js: its URL, its source and the page that loaded it.
interface Ips {
  url: string;
  source: string;
  referer: string;
}

const hc = new httpclient.Client(proxy);
const [client, ip] = await newClient();
const page = await getPage(hc);
const session = newSession(client, ip, page.url);
const base = findBase(page);
const ps = await getPScript(hc, session, page, base);
const [script, h] = await getIps(hc, page, base, ps);
const tl = await postTl(hc, session, page, script);
const cd = buildCDHeader(ps, tl);
await postProtected(hc, page, ps, tl, h, cd);
siteFirewall(hc, pageUrl);
console.log("PASS /tl 200 reload:true, protected request 200");

async function newClient(): Promise<[OneStop, string]> {
  const client = new OneStop({
    apiKey,
    identifier,
    ipAgent: httpclient.ipAgent(proxy),
  });
  const ip = await client.getIp(); // through the proxy: the IP the site sees
  return [client, ip];
}

function newSession(client: OneStop, ip: string, site: string): Session {
  return client.session({
    site,
    referer: site,
    userAgent: httpclient.userAgent,
    acceptLanguage,
    ip,
  });
}

function getPage(hc: httpclient.Client): Promise<httpclient.Response> {
  return hc.get(pageUrl, httpclient.navigate(acceptLanguage, ""));
}

function isBlockPage(page: httpclient.Response): boolean {
  return page.status === 429 && ipsScript.test(page.body);
}

// findBase returns the script directory: p.js, mfc, fp, ips.js and tl sit in
// it. A block page links ips.js there; any other page links p.js.
function findBase(page: httpclient.Response): string {
  if (isBlockPage(page)) return ipsUrlFrom(page).split("ips.js")[0];
  // p.js lives at /<uuid>/<uuid>/p.js.
  // Some pages write the path JSON-escaped (`\/` or `\u002f` for `/`).
  const match = page.body.replaceAll("\\/", "/").replaceAll("\\u002f", "/").match(pjsPath);
  if (!match) httpclient.fatal(`FAIL page returned ${page.status} without a Kasada p.js`);
  return new URL(page.url).origin + match[0].slice(0, -"p.js".length);
}

// getPScript loads p.js. Keep the result: x-kpsdk-v goes on the Kasada
// requests and the CD header is built from it.
async function getPScript(hc: httpclient.Client, session: Session, page: httpclient.Response, base: string): Promise<KasadaPScriptResponse> {
  const pjs = await hc.get(base + "p.js", httpclient.script(acceptLanguage, "same-origin", page.url));
  return session.kasadaPScript(pjs.body).catch(httpclient.fail("p.js"));
}

// getIps loads ips.js and returns it with the x-kpsdk-h from mfc. A block
// page links it directly (no mfc); otherwise mfc and fp lead to it.
async function getIps(hc: httpclient.Client, page: httpclient.Response, base: string, ps: KasadaPScriptResponse): Promise<[Ips, string]> {
  let [from, h] = [page, ""];
  if (!isBlockPage(page)) [from, h] = await getFp(hc, page, base, ps.headers["x-kpsdk-v"]);
  const ipsUrl = ipsUrlFrom(from);
  const res = await hc.get(ipsUrl, httpclient.script(acceptLanguage, "same-origin", from.url));
  if (res.status !== 200) httpclient.fatal(`FAIL ips.js returned ${res.status}`);
  return [{ url: ipsUrl, source: res.body, referer: from.url }, h];
}

// getFp loads mfc and fp and returns fp with mfc's x-kpsdk-h, which the
// protected requests carry. fp can answer 200 or 429; require ips.js in its body, not a status.
async function getFp(hc: httpclient.Client, page: httpclient.Response, base: string, version: string): Promise<[httpclient.Response, string]> {
  const mfc = await hc.get(base + "mfc", httpclient.kasadaMfc(acceptLanguage, version, page.url));
  if (mfc.status !== 200) httpclient.fatal(`FAIL mfc returned ${mfc.status}`);
  const fp = await hc.get(base + "fp?x-kpsdk-v=" + version, httpclient.frame(acceptLanguage, "same-origin", page.url));
  if (!ipsScript.test(fp.body)) httpclient.fatal("FAIL fp returned no ips.js");
  return [fp, mfc.header("x-kpsdk-h")];
}

// ipsUrlFrom returns the ips.js src a Kasada response body links, HTML-unescaped
// and resolved against the response URL.
function ipsUrlFrom(res: httpclient.Response): string {
  return res.resolve(res.body.match(ipsScript)![1]).href;
}

async function postTl(hc: httpclient.Client, session: Session, page: httpclient.Response, script: Ips): Promise<httpclient.Response> {
  const tl = await session.kasadaTl(script.url, script.source).catch(httpclient.fail("tl"));
  const origin = new URL(page.url).origin;
  const base = script.url.slice(0, script.url.indexOf("ips.js"));
  const body = Buffer.from(tl.payload, "base64"); // payload is the /tl body in base64
  const res = await hc.post(base + "tl", httpclient.kasadaTl(acceptLanguage, tl.headers, origin, script.referer), body);
  if (res.status !== 200 || !res.body.includes(`"reload":true`)) httpclient.fatal(`FAIL /tl returned ${res.status}: ${res.body}`);
  return res;
}

// buildCDHeader builds x-kpsdk-cd locally (no API call) from the p.js result
// and the /tl response's x-kpsdk-ct and x-kpsdk-st.
function buildCDHeader(ps: KasadaPScriptResponse, tl: httpclient.Response): string {
  const st = Number(tl.header("x-kpsdk-st")); // ms
  return ps.cdHeader(tl.header("x-kpsdk-ct"), st);
}

// postProtected is the request Kasada protects, a POST as most are:
// x-kpsdk-ct (the newest one seen, here from /tl), x-kpsdk-v from p.js,
// x-kpsdk-h from mfc and the CD header just built. Each protected POST gets
// a fresh CD header.
async function postProtected(hc: httpclient.Client, page: httpclient.Response, ps: KasadaPScriptResponse, tl: httpclient.Response, h: string, cd: string): Promise<void> {
  const headers = httpclient.post(acceptLanguage, "application/json", new URL(page.url).origin, page.url).with({
    "x-kpsdk-ct": tl.header("x-kpsdk-ct"),
    "x-kpsdk-cd": cd,
    "x-kpsdk-h": h,
    "x-kpsdk-v": ps.headers["x-kpsdk-v"],
  });
  const res = await hc.post(protectedUrl, headers, protectedBody);
  if (res.status !== 200) httpclient.fatal(`FAIL protected request returned ${res.status}`);
}

function siteFirewall(hc: httpclient.Client, pageUrl: string): void {
  // Insert the relevant requests for your site's firewall. This is up to you and your agent to experiment with.
  // Some sites (DataDome, Akamai) are strict on flow: you might need additional requests here.
}
