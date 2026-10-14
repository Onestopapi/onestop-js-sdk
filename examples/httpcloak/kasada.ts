// Kasada: load the page and its p.js, then mfc, fp (429) and ips.js, and
// POST the generated /tl body. A page that is already the 429 block page
// links ips.js itself. /tl answers 200 with reload:true.
import { OneStop, type Session } from "onestop-antibot";
import * as httpclient from "./httpclient.ts";

const apiKey = "YOUR_API_KEY";
const identifier = ""; // your identifier or account name
const pageUrl = "https://www.example.com/";
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
const session = newSession(client, ip, pageUrl);
const page = await getPage(hc);
const script = await getIps(hc, session, page);
await postTl(hc, session, page, script);
siteFirewall(hc, pageUrl);
console.log("PASS /tl 200 reload:true");

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

// getIps loads ips.js. When the page itself is the 429 block page it links
// ips.js directly; otherwise p.js, mfc and fp lead to it.
async function getIps(hc: httpclient.Client, session: Session, page: httpclient.Response): Promise<Ips> {
  let from = page;
  if (page.status !== 429 || !ipsScript.test(page.body)) {
    const [base, version] = await getPScript(hc, session, page);
    from = await getFp(hc, page, base, version);
  }
  const ipsUrl = ipsUrlFrom(from);
  const res = await hc.get(ipsUrl, httpclient.script(acceptLanguage, "same-origin", from.url));
  if (res.status !== 200) httpclient.fatal(`FAIL ips.js returned ${res.status}`);
  return { url: ipsUrl, source: res.body, referer: from.url };
}

// getPScript returns the script directory and x-kpsdk-v from the p.js result.
async function getPScript(hc: httpclient.Client, session: Session, page: httpclient.Response): Promise<[string, string]> {
  // p.js lives at /<uuid>/<uuid>/p.js; mfc, fp, ips.js and tl sit next to it.
  // Some pages write the path JSON-escaped (\/ or \u002f for /).
  const match = page.body.replaceAll("\\/", "/").replaceAll("\\u002f", "/").match(pjsPath);
  if (!match) httpclient.fatal(`FAIL page returned ${page.status} without a Kasada p.js`);
  const base = new URL(page.url).origin + match[0].slice(0, -"p.js".length);
  const pjs = await hc.get(base + "p.js", httpclient.script(acceptLanguage, "same-origin", page.url));
  const ps = await session.kasadaPScript(pjs.body).catch(httpclient.fail("p.js"));
  return [base, ps.headers["x-kpsdk-v"]];
}

// getFp loads mfc and fp. fp answers 429 with a body that links ips.js.
async function getFp(hc: httpclient.Client, page: httpclient.Response, base: string, version: string): Promise<httpclient.Response> {
  const mfc = await hc.get(base + "mfc", httpclient.kasadaMfc(acceptLanguage, version, page.url));
  if (mfc.status !== 200) httpclient.fatal(`FAIL mfc returned ${mfc.status}`);
  const fp = await hc.get(base + "fp?x-kpsdk-v=" + version, httpclient.frame(acceptLanguage, "same-origin", page.url));
  if (!ipsScript.test(fp.body)) httpclient.fatal("FAIL fp returned no ips.js");
  return fp;
}

// ipsUrlFrom returns the ips.js src a Kasada 429 body links, HTML-unescaped
// and resolved against the response URL.
function ipsUrlFrom(res: httpclient.Response): string {
  return res.resolve(res.body.match(ipsScript)![1]).href;
}

async function postTl(hc: httpclient.Client, session: Session, page: httpclient.Response, script: Ips): Promise<void> {
  const tl = await session.kasadaTl(script.url, script.source).catch(httpclient.fail("tl"));
  const origin = new URL(page.url).origin;
  const base = script.url.slice(0, script.url.indexOf("ips.js"));
  const body = Buffer.from(tl.payload, "base64"); // payload is the /tl body in base64
  const res = await hc.post(base + "tl", httpclient.kasadaTl(acceptLanguage, tl.headers, origin, script.referer), body);
  if (res.status !== 200 || !res.body.includes(`"reload":true`)) httpclient.fatal(`FAIL /tl returned ${res.status}: ${res.body}`);
}

function siteFirewall(hc: httpclient.Client, pageUrl: string): void {
  // Insert the relevant requests for your site's firewall. This is up to you and your agent to experiment with.
  // Some sites (DataDome, Akamai) are strict on flow: you might need additional requests here.
}
