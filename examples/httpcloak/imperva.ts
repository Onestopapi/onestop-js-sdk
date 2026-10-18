// Imperva: the page answers with the reese84 challenge page, which adds the
// challenge script. Load the script, POST the generated body to the script's
// path with ?d=<host>, store the returned token as the reese84 cookie and
// load the page again.
import { OneStop, type Session } from "onestop-antibot";
import * as httpclient from "./httpclient.ts";

const apiKey = "YOUR_API_KEY";
const identifier = "YOUR_IDENTIFIER"; // your identifier or account name
const pageUrl = "https://www.example.com/";
const acceptLanguage = "en-GB,en;q=0.9";

const proxy = ""; // your proxy, in the site's country

const challengeScript = /scriptElement\.src\s*=\s*"([^"]+)"/;

// TokenReply is the reese84 POST's JSON reply.
interface TokenReply {
  token: string;
  cookieDomain: string;
}

const hc = new httpclient.Client(proxy);
const [client, ip] = await newClient();
const page = await getChallengePage(hc);
const scriptUrl = findScript(page);
const session = newSession(client, ip, page.url);
const script = await getScript(hc, page, scriptUrl);
await solveChallenge(hc, session, page, scriptUrl, script);
await reloadPage(hc, page);
siteFirewall(hc, pageUrl);
console.log("PASS reese84 cookie set, page re-GET 200");

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

function getChallengePage(hc: httpclient.Client): Promise<httpclient.Response> {
  return hc.get(pageUrl, httpclient.navigate(acceptLanguage, ""));
}

// findScript returns the script the challenge page adds with
// scriptElement.src = "...".
function findScript(page: httpclient.Response): URL {
  const match = page.body.match(challengeScript);
  if (!match) httpclient.fatal(`FAIL page returned ${page.status} without an Imperva challenge`);
  return page.resolve(match[1]);
}

async function getScript(hc: httpclient.Client, page: httpclient.Response, scriptUrl: URL): Promise<string> {
  const res = await hc.get(scriptUrl.href, httpclient.impervaScript(acceptLanguage, page.url));
  if (res.status !== 200) httpclient.fatal(`FAIL script returned ${res.status}`);
  return res.body;
}

async function solveChallenge(hc: httpclient.Client, session: Session, page: httpclient.Response, scriptUrl: URL, script: string): Promise<void> {
  const res = await session.imperva(scriptUrl.href, script).catch(httpclient.fail("imperva"));
  // res.payload is the POST body; it goes to the script's path with ?d=<host>.
  const origin = scriptUrl.origin;
  const post = await hc.post(origin + scriptUrl.pathname + "?d=" + scriptUrl.hostname, httpclient.impervaPost(acceptLanguage, origin, page.url), res.payload);
  const reply = post.json<TokenReply>();
  if (!reply?.token) httpclient.fatal(`FAIL reese84 POST returned ${post.status}: ${post.body}`);
  // The script stores the token as the reese84 cookie on cookieDomain.
  hc.setCookie(reply.cookieDomain, "reese84", reply.token);
}

async function reloadPage(hc: httpclient.Client, page: httpclient.Response): Promise<void> {
  const loaded = await hc.get(page.url, httpclient.navigate(acceptLanguage, ""));
  if (loaded.status !== 200) httpclient.fatal(`FAIL page re-GET returned ${loaded.status}`);
  if (challengeScript.test(loaded.body)) httpclient.fatal("FAIL page re-GET is still the challenge page");
}

function siteFirewall(hc: httpclient.Client, pageUrl: string): void {
  // Insert the relevant requests for your site's firewall. This is up to you and your agent to experiment with.
  // Some sites (DataDome, Akamai) are strict on flow: you might need additional requests here.
}
