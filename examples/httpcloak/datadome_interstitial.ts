// DataDome interstitial: the page answers 403 with `var dd={...rt:'i'}`. Load
// the interstitial page and its script, POST the generated form body, store
// the returned datadome cookie and load the page again.
import { setTimeout as sleep } from "node:timers/promises";
import { OneStop, type Session } from "onestop-antibot";
import * as httpclient from "./httpclient.ts";

const apiKey = "YOUR_API_KEY";
const identifier = ""; // your identifier or account name
const pageUrl = "https://www.example.com/";
const acceptLanguage = "en-US,en;q=0.9";

const proxy = ""; // your proxy, in the site's country

const geoOrigin = "https://geo.captcha-delivery.com";

const ddObject = /var\s+dd\s*=\s*(\{[^}]*\})/;
const ddScript = /src="([^"]*interstitial\.[^"]*)"/;

interface Challenge {
  rt: string;
  cid: string;
  hsh: string;
  t: string;
  s: number;
  e: string;
  b: number;
  cookie: string;
}

// InterstitialReply is the interstitial POST's JSON reply.
interface InterstitialReply {
  view: string;
  cookie: string;
}

const hc = new httpclient.Client(proxy);
const [client, ip] = await newClient();
const session = newSession(client, ip, pageUrl);
const [page, dd] = await getBlockedPage(hc);
const [geoUrl, geo] = await getChallengePage(hc, dd);
await solveInterstitial(hc, session, page, geoUrl, geo);
const status = await reloadPage(hc);
siteFirewall(hc, pageUrl);
console.log("PASS interstitial view redirect, page re-GET", status);

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
  if (dd.rt !== "i") httpclient.fatal(`FAIL challenge type ${JSON.stringify(dd.rt)} is not the interstitial (t=${JSON.stringify(dd.t)})`);
  return [page, dd];
}

async function getChallengePage(hc: httpclient.Client, dd: Challenge): Promise<[string, httpclient.Response]> {
  let geoUrl = `${geoOrigin}/interstitial/?initialCid=${httpclient.queryEscape(dd.cid)}&hash=${httpclient.queryEscape(dd.hsh)}&cid=${httpclient.queryEscape(dd.cookie)}&referer=${httpclient.queryEscape(pageUrl)}&s=${dd.s}`;
  if (dd.e) geoUrl += "&e=" + httpclient.queryEscape(dd.e);
  geoUrl += `&b=${dd.b}&dm=cd`;

  // These pauses are browser pacing between the challenge requests, not the API's sleep.
  await sleep(400);
  const geo = await hc.get(geoUrl, httpclient.frame(acceptLanguage, "cross-site", pageUrl).storageAccess());
  if (geo.status !== 200) httpclient.fatal(`FAIL interstitial page returned ${geo.status}`);
  return [geoUrl, geo];
}

async function solveInterstitial(hc: httpclient.Client, session: Session, page: httpclient.Response, geoUrl: string, geo: httpclient.Response): Promise<void> {
  // Without a script tag the bundle is inline and the API reads it from html.
  let script = "";
  const match = geo.body.match(ddScript);
  if (match) {
    await sleep(200);
    script = (await hc.get(match[1], httpclient.script(acceptLanguage, "same-site", geoOrigin + "/").storageAccess())).body;
  }

  await sleep(400);
  // script and html are the interstitial's; pageResponse is the blocked page.
  const res = await session.datadomeInterstitial({
    script,
    html: geo.body,
    pageResponse: page.body,
  }).catch(httpclient.fail("interstitial"));

  await sleep(1000);
  // res.payload is the generated form body.
  const post = await hc.post(geoOrigin + "/interstitial/", httpclient.post(acceptLanguage, "application/x-www-form-urlencoded; charset=UTF-8", geoOrigin, geoUrl).storageAccess(), res.payload);
  const reply = post.json<InterstitialReply>();
  if (reply?.view !== "redirect") httpclient.fatal(`FAIL interstitial POST returned ${post.status}, view ${JSON.stringify(reply?.view ?? "")}: ${post.body}`);
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
