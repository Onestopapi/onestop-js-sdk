// DataDome slider: the page answers 403 with `var dd={...rt:'c'}`. Load the
// captcha page, its script and both images, GET the captcha check with the
// generated query string, store the datadome cookie and load the page again.
import { OneStop, type Session } from "onestop-antibot";
import * as httpclient from "./httpclient.ts";

const apiKey = "YOUR_API_KEY";
const identifier = ""; // your identifier or account name
const pageUrl = "https://www.example.com/events/example";
const acceptLanguage = "en-GB,en;q=0.9";

const proxy = ""; // your proxy, in the site's country

const geoOrigin = "https://geo.captcha-delivery.com";

const ddObject = /var\s+dd\s*=\s*(\{[^}]*\})/;
const challengePath = /captchaChallengePath: '([^']+)'/;
const captchaScript = /<script[^>]*\ssrc="([^"]*captcha[^"]*\.js)"/;

interface Challenge {
  rt: string;
  cid: string;
  hsh: string;
  t: string;
  s: number;
  e: string;
  cookie: string;
}

// CheckReply is the captcha check's JSON reply.
interface CheckReply {
  cookie: string;
}

const hc = new httpclient.Client(proxy);
const [client, ip] = await newClient();
const session = newSession(client, ip, pageUrl);
const [page, dd] = await getBlockedPage(hc);
const [geoUrl, geo] = await getChallengePage(hc, dd);
await solveSlider(hc, session, page, geoUrl, geo);
const status = await reloadPage(hc);
siteFirewall(hc, pageUrl);
console.log("PASS captcha check cookie, page re-GET", status);

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

async function getBlockedPage(hc: httpclient.Client): Promise<[httpclient.Response, Challenge]> {
  const page = await hc.get(pageUrl, httpclient.navigate(acceptLanguage, ""));
  const match = page.body.match(ddObject);
  if (page.status !== 403 || !match) httpclient.fatal(`FAIL page returned ${page.status} without a DataDome challenge`);
  const dd: Challenge = JSON.parse(match[1].replaceAll("'", `"`));
  if (dd.rt !== "c" || dd.t === "bv") httpclient.fatal(`FAIL challenge type ${JSON.stringify(dd.rt)} t=${JSON.stringify(dd.t)} is not the slider`);
  return [page, dd];
}

async function getChallengePage(hc: httpclient.Client, dd: Challenge): Promise<[string, httpclient.Response]> {
  let geoUrl = `${geoOrigin}/captcha/?initialCid=${httpclient.queryEscape(dd.cid)}&hash=${httpclient.queryEscape(dd.hsh)}&cid=${httpclient.queryEscape(dd.cookie)}&t=${dd.t}&referer=${httpclient.queryEscape(pageUrl)}&s=${dd.s}`;
  if (dd.e) geoUrl += "&e=" + httpclient.queryEscape(dd.e);
  geoUrl += "&dm=cd";

  const geo = await hc.get(geoUrl, httpclient.frame(acceptLanguage, "cross-site", new URL(pageUrl).origin + "/").storageAccess());
  if (geo.status !== 200 || !challengePath.test(geo.body)) httpclient.fatal(`FAIL captcha page returned ${geo.status} without the slider challenge`);
  return [geoUrl, geo];
}

async function solveSlider(hc: httpclient.Client, session: Session, page: httpclient.Response, geoUrl: string, geo: httpclient.Response): Promise<void> {
  // Without a script tag the bundle is inline and the API reads it from html.
  let script = "";
  const match = geo.body.match(captchaScript);
  if (match) script = (await hc.get(match[1], httpclient.script(acceptLanguage, "same-site", geoOrigin + "/").storageAccess())).body;

  // The background is captchaChallengePath (.jpg); the puzzle piece is the
  // same path as .frag.png. Both go to the API as base64.
  const path = geo.body.match(challengePath)![1];
  const images: string[] = [];
  for (const p of [path, path.replace(".jpg", ".frag.png")]) {
    const image = await hc.get(geo.resolve(p).href, httpclient.image(acceptLanguage, geoOrigin, "same-site", geoOrigin + "/"));
    if (image.status !== 200) httpclient.fatal(`FAIL captcha image returned ${image.status}`);
    images.push(image.bytes.toString("base64"));
  }

  // script and html are the captcha page's; pageResponse is the blocked page.
  const res = await session.datadomeSlider({
    script,
    html: geo.body,
    pageResponse: page.body,
    backgroundImage: images[0],
    puzzlePiece: images[1],
  }).catch(httpclient.fail("slider"));

  // res.payload is the generated check query string.
  const answer = await hc.get(geoOrigin + "/captcha/check" + res.payload, httpclient.post(acceptLanguage, "application/x-www-form-urlencoded; charset=UTF-8", "", geoUrl).storageAccess());
  const reply = answer.json<CheckReply>();
  if (!reply?.cookie || answer.status !== 200) httpclient.fatal(`FAIL captcha check returned ${answer.status}: ${answer.body}`);
  // reply.cookie is the datadome Set-Cookie line.
  const [pair, ...attributes] = reply.cookie.split(";").map((part) => part.trim());
  const domain = attributes.find((a) => a.toLowerCase().startsWith("domain="))!.slice("domain=".length);
  hc.setCookie(domain, pair.slice(0, pair.indexOf("=")), pair.slice(pair.indexOf("=") + 1));
}

async function reloadPage(hc: httpclient.Client): Promise<number> {
  const again = await hc.get(pageUrl, httpclient.navigate(acceptLanguage, pageUrl));
  if (again.status !== 200 && again.status !== 302) httpclient.fatal(`FAIL page re-GET returned ${again.status}`);
  return again.status;
}

function siteFirewall(hc: httpclient.Client, pageUrl: string): void {
  // Insert the relevant requests for your site's firewall. This is up to you and your agent to experiment with.
  // Some sites (DataDome, Akamai) are strict on flow: you might need additional requests here.
}
