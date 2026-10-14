// Cloudflare WAF: the page answers 403 with the managed challenge. Load the
// challenge script, then send the requests each step returns until the form
// POST that sets cf_clearance.
import { OneStop, type CloudflareCall, type Session } from "onestop-antibot";
import * as httpclient from "./httpclient.ts";

const apiKey = "YOUR_API_KEY";
const identifier = ""; // your identifier or account name
const pageUrl = "https://www.example.com/login";
const acceptLanguage = "en-US,en;q=0.9";

const proxy = ""; // your proxy, in the site's country

const challengeScript = /src = '(\/cdn-cgi\/challenge-platform\/[^']+)'/;
const challengeToken = /__cf_chl_rt_tk=([^"&]+)/;

const hc = new httpclient.Client(proxy);
const [client, ip] = await newClient();
const session = newSession(client, ip, pageUrl);
const first = await getChallengePage(hc);
await runChallengeLoop(hc, session, first);
siteFirewall(hc, pageUrl);
console.log("PASS cf_clearance set");

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

// getChallengePage returns the first call: the challenge page and its script.
async function getChallengePage(hc: httpclient.Client): Promise<CloudflareCall> {
  const page = await hc.get(pageUrl, httpclient.navigate(acceptLanguage, ""));
  // The challenge page has the script path (src = '...') and the
  // __cf_chl_rt_tk token.
  const scriptMatch = page.body.match(challengeScript);
  const tokenMatch = page.body.match(challengeToken);
  if (!scriptMatch || !tokenMatch) httpclient.fatal(`FAIL page returned ${page.status} without a Cloudflare challenge`);
  const scriptUrl = page.resolve(scriptMatch[1]).href;
  const script = await hc.get(scriptUrl, httpclient.challengeScript(acceptLanguage, pageUrl + "?__cf_chl_rt_tk=" + tokenMatch[1]));
  return { html: page.body, script: script.body, scriptUrl };
}

// runChallengeLoop sends each step's requests; each reply goes back on the
// next call, by its purpose. The form POST sets cf_clearance.
async function runChallengeLoop(hc: httpclient.Client, session: Session, call: CloudflareCall): Promise<void> {
  let step = await session.cloudflareWaf(call).catch(httpclient.fail("WAF"));
  let frameUrl = "";
  while (!step.token) {
    const next: CloudflareCall = { context: step.context };
    for (const r of step.requests) {
      if (r.purpose === "form") hc.followRedirects(false);
      const res = await hc.do(r.method, r.url, httpclient.cloudflare(r, acceptLanguage, pageUrl, frameUrl), r.body);
      switch (r.purpose) {
        case "challenge":
          if (res.status !== 200) httpclient.fatal(`FAIL challenge request returned ${res.status}`);
          next.response = res.body;
          break;
        case "iframe":
          frameUrl = res.url;
          next.html = res.body;
          next.iframeUrl = res.url;
          next.bytecodeRayId = res.header("cf-ray");
          break;
        case "image":
          [next.imageWidth, next.imageHeight] = httpclient.pngSize(res.bytes);
          break;
        case "pat":
          next.patStatus = res.status; // a 4xx is normal
          break;
        case "form":
          if (!hc.cookie(pageUrl, "cf_clearance")) httpclient.fatal(`FAIL form POST returned ${res.status} without cf_clearance`);
          return;
      }
    }
    step = await session.cloudflareWaf(next).catch(httpclient.fail("WAF"));
  }
  httpclient.fatal("FAIL the challenge ended without a form POST");
}

function siteFirewall(hc: httpclient.Client, pageUrl: string): void {
  // Insert the relevant requests for your site's firewall. This is up to you and your agent to experiment with.
  // Some sites (DataDome, Akamai) are strict on flow: you might need additional requests here.
}
