// SBSD block: POST one mode f payload to the block script with ?t=<token>
// (bm_sc 2~ clears the block), load the page again, then send the passive
// SBSD payloads (mode f, then t) for the real page's script.
import { OneStop, type SbsdCall, type Session } from "onestop-antibot";
import * as httpclient from "./httpclient.ts";

const apiKey = "YOUR_API_KEY";
const identifier = ""; // your identifier or account name
const pageUrl = "https://www.example.com/";
const acceptLanguage = "de-DE,de;q=0.9";

const proxy = ""; // your proxy, in the site's country

const sbsdScript = /<script[^>]*src="([^"]*\?v=[^"]*)"/;
const blockToken = /\{"cpr_chlge":"true","t":"([^"]*)"/;

// SbsdBody is the JSON body of an SBSD POST.
interface SbsdBody {
  body: string;
}

const hc = new httpclient.Client(proxy);
const [client, ip] = await newClient();
const page = await getBlockPage(hc);
const [blockUrl, token] = findBlockScript(page);
const session = newSession(client, ip, page.url);
await solveBlock(hc, session, page, blockUrl, token);
const [loaded, sbsdUrl] = await reloadPage(hc, page);
await solvePassive(hc, session, loaded, sbsdUrl);
siteFirewall(hc, pageUrl);
console.log("PASS SBSD block cleared (bm_sc 2~), real page loaded, passive f+t 200");

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

function getBlockPage(hc: httpclient.Client): Promise<httpclient.Response> {
  return hc.get(pageUrl, httpclient.navigate(acceptLanguage, ""));
}

function findBlockScript(page: httpclient.Response): [URL, string] {
  const match = page.body.match(sbsdScript);
  if (!match) httpclient.fatal("FAIL not a block page");
  const blockUrl = page.resolve(match[1]);
  // The block token is the script URL's t= value, else the page's
  // {"cpr_chlge":"true","t":"<token>"}.
  let token = blockUrl.searchParams.get("t") ?? "";
  const m = page.body.match(blockToken);
  if (!token && m) token = m[1];
  if (!token) httpclient.fatal("FAIL not a block page");
  return [blockUrl, token];
}

async function solveBlock(hc: httpclient.Client, session: Session, page: httpclient.Response, blockUrl: URL, token: string): Promise<void> {
  const origin = blockUrl.origin;
  const block = await hc.get(blockUrl.href, httpclient.script(acceptLanguage, "same-origin", page.url));
  const res = await session.sbsdPayload({
    uuid: blockUrl.searchParams.get("v") ?? "", // v= value of the script URL
    sbsdCookie: hc.cookie(page.url, "bm_so", "sbsd_o"), // cookie set by the page
    script: block.body,
    mode: "f",
  }).catch(httpclient.fail("SBSD block"));
  const body = JSON.stringify({ body: res.payload } satisfies SbsdBody);
  const post = await hc.post(origin + blockUrl.pathname + "?t=" + token, httpclient.post(acceptLanguage, "application/json", origin, page.url), body);
  if (post.status !== 200) httpclient.fatal(`FAIL SBSD block POST returned ${post.status}`);
  // bm_sc 2~ passed, 3~ failed.
  const verdict = hc.cookie(page.url, "bm_sc");
  if (!verdict.startsWith("2~")) httpclient.fatal(`FAIL SBSD block verdict bm_sc=${verdict}`);
}

async function reloadPage(hc: httpclient.Client, page: httpclient.Response): Promise<[httpclient.Response, URL]> {
  const loaded = await hc.get(page.url, httpclient.navigate(acceptLanguage, ""));
  if (loaded.status !== 200) httpclient.fatal(`FAIL page re-GET returned ${loaded.status}`);
  const match = loaded.body.match(sbsdScript);
  if (!match) httpclient.fatal("FAIL real page has no SBSD script");
  const sbsdUrl = loaded.resolve(match[1]);
  if (sbsdUrl.searchParams.get("t")) httpclient.fatal("FAIL page re-GET is still a block page");
  return [loaded, sbsdUrl];
}

async function solvePassive(hc: httpclient.Client, session: Session, page: httpclient.Response, sbsdUrl: URL): Promise<void> {
  const origin = sbsdUrl.origin;
  const sbsd = await hc.get(sbsdUrl.href, httpclient.script(acceptLanguage, "same-origin", page.url).noCache());
  // uuid is the v= value of the new script URL; mode t sends f's context.
  let call: SbsdCall = { uuid: sbsdUrl.searchParams.get("v") ?? "", script: sbsd.body };
  for (const mode of ["f", "t"]) {
    call.mode = mode;
    call.sbsdCookie = hc.cookie(page.url, "bm_so", "sbsd_o");
    const res = await session.sbsdPayload(call).catch(httpclient.fail(`SBSD ${mode}`));
    const body = JSON.stringify({ body: res.payload } satisfies SbsdBody);
    const post = await hc.post(origin + sbsdUrl.pathname, httpclient.post(acceptLanguage, "application/json", origin, page.url).noCache(), body);
    if (post.status !== 200) httpclient.fatal(`FAIL SBSD ${mode} POST returned ${post.status}`);
    call = { uuid: call.uuid, context: res.context };
  }
}

function siteFirewall(hc: httpclient.Client, pageUrl: string): void {
  // Insert the relevant requests for your site's firewall. This is up to you and your agent to experiment with.
  // Some sites (DataDome, Akamai) are strict on flow: you might need additional requests here.
}
