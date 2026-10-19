// Imperva utmvc: the page loads the utmvc script from
// /_Incapsula_Resource?SWJIYLWA=<hash>. Load the script, store the generated
// value as the ___utmvc cookie, send the SWKMTFSR image request and load the
// page again.
import { OneStop, type Session } from "onestop-antibot";
import * as httpclient from "./httpclient.ts";

const apiKey = "YOUR_API_KEY";
const identifier = "YOUR_IDENTIFIER"; // your identifier or account name
const pageUrl = "https://www.example.com/";
const acceptLanguage = "en-GB,en;q=0.9";

const proxy = ""; // your proxy, in the site's country

const utmvcScript = /"([^"]*\/_Incapsula_Resource\?SWJIYLWA=[^"]*)"/;

const hc = new httpclient.Client(proxy);
const [client, ip] = await newClient();
const page = await getChallengePage(hc);
const scriptUrl = findScript(page);
const session = newSession(client, ip, page.url);
const script = await getScript(hc, page, scriptUrl);
await solveChallenge(hc, session, page, scriptUrl, script);
await sendBeacon(hc, page);
await reloadPage(hc, page);
siteFirewall(hc, pageUrl);
console.log("PASS ___utmvc cookie set, page re-GET 200");

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

// findScript returns the utmvc script the page loads from
// /_Incapsula_Resource?SWJIYLWA=<hash>.
function findScript(page: httpclient.Response): URL {
  const match = page.body.match(utmvcScript);
  if (!match) httpclient.fatal(`FAIL page returned ${page.status} without an Imperva utmvc script`);
  return page.resolve(match[1]);
}

async function getScript(hc: httpclient.Client, page: httpclient.Response, scriptUrl: URL): Promise<string> {
  const res = await hc.get(scriptUrl.href, httpclient.script(acceptLanguage, "same-origin", page.url));
  if (res.status !== 200) httpclient.fatal(`FAIL script returned ${res.status}`);
  return res.body;
}

async function solveChallenge(hc: httpclient.Client, session: Session, page: httpclient.Response, scriptUrl: URL, script: string): Promise<void> {
  const cookies = hc.cookies(page.url, "incap_ses_");
  const res = await session.impervaUtmvc(scriptUrl.href, script, cookies).catch(httpclient.fail("imperva utmvc"));
  // The script stores res.payload as the ___utmvc cookie on the page host, path /.
  hc.setCookie(page.resolve("/").hostname, "___utmvc", res.payload);
}

// sendBeacon is the image request the script makes after setting ___utmvc;
// e is Math.random().
async function sendBeacon(hc: httpclient.Client, page: httpclient.Response): Promise<void> {
  const beacon = page.resolve("/_Incapsula_Resource?SWKMTFSR=1&e=" + Math.random());
  await hc.get(beacon.href, httpclient.image(acceptLanguage, "", "same-origin", page.url));
}

async function reloadPage(hc: httpclient.Client, page: httpclient.Response): Promise<void> {
  const loaded = await hc.get(page.url, httpclient.navigate(acceptLanguage, ""));
  if (loaded.status !== 200) httpclient.fatal(`FAIL page re-GET returned ${loaded.status}`);
}

function siteFirewall(hc: httpclient.Client, pageUrl: string): void {
  // Insert the relevant requests for your site's firewall. This is up to you and your agent to experiment with.
  // Some sites (DataDome, Akamai) are strict on flow: you might need additional requests here.
}
