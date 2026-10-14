// Cloudflare precursor: the page loads a /scripts/precursor/ script that
// makes up to five small POSTs. Each reply is {"i": seconds, "n": done}:
// n true stops; the API turns a long i into its sleep.
import { OneStop, type CloudflareCall, type Session } from "onestop-antibot";
import * as httpclient from "./httpclient.ts";

const apiKey = "YOUR_API_KEY";
const identifier = ""; // your identifier or account name
const pageUrl = "https://www.example.com/";
const acceptLanguage = "en-US,en;q=0.9";

const proxy = ""; // your proxy, in the site's country

// The precursor script's path wherever the page writes it: a script tag or an
// inline loader that adds one, quoted either way.
const precursorScript = /(?:https:\/\/[A-Za-z0-9.-]+)?\/cdn-cgi\/challenge-platform\/scripts\/precursor\/[A-Za-z0-9._\/-]+/;

// PrecursorReply is a precursor POST's JSON reply: n is true when done.
interface PrecursorReply {
  n: boolean;
}

const hc = new httpclient.Client(proxy);
const [client, ip] = await newClient();
const [page, first] = await getChallengePage(hc);
const session = newSession(client, ip, page.url);
const result = await runChallengeLoop(hc, session, page, first);
siteFirewall(hc, pageUrl);
console.log("PASS " + result);

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

// getChallengePage returns the page and the first call: the page and the
// precursor script.
async function getChallengePage(hc: httpclient.Client): Promise<[httpclient.Response, CloudflareCall]> {
  const page = await hc.get(pageUrl, httpclient.navigate(acceptLanguage, ""));
  const match = page.body.match(precursorScript);
  if (page.status !== 200 || !match) httpclient.fatal(`FAIL page returned ${page.status} without a precursor script`);
  const script = await hc.get(page.resolve(match[0]).href, httpclient.script(acceptLanguage, "same-origin", page.url));
  if (script.status !== 200) httpclient.fatal(`FAIL precursor script returned ${script.status}`);
  return [page, { html: page.body, script: script.body, scriptUrl: script.url }];
}

// runChallengeLoop sends each step's POSTs; every later call sends the
// previous context and the target's reply.
async function runChallengeLoop(hc: httpclient.Client, session: Session, page: httpclient.Response, call: CloudflareCall): Promise<string> {
  const origin = new URL(page.url).origin;
  for (let posts = 1; posts <= 5; posts++) {
    const step = await session.cloudflarePrecursor(call).catch(httpclient.fail("precursor"));
    call = { context: step.context };
    for (const r of step.requests) {
      const res = await hc.do(r.method, r.url, httpclient.post(acceptLanguage, "text/plain;charset=UTF-8", origin, page.url).with(r.headers), r.body);
      const reply = res.json<PrecursorReply>();
      if (res.status < 200 || res.status > 299 || !reply) httpclient.fatal(`FAIL precursor POST ${posts} returned ${res.status}: ${res.body}`);
      if (reply.n) return "precursor POSTs 2xx until n:true";
      call.response = reply;
    }
  }
  return "5 precursor POSTs 2xx";
}

function siteFirewall(hc: httpclient.Client, pageUrl: string): void {
  // Insert the relevant requests for your site's firewall. This is up to you and your agent to experiment with.
  // Some sites (DataDome, Akamai) are strict on flow: you might need additional requests here.
}
