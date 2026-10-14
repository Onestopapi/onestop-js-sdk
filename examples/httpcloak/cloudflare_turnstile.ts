// Cloudflare Turnstile: load the widget's api.js and its iframe, then send
// the requests each step returns until the API returns the token.
import { randomInt } from "node:crypto";
import { OneStop, type CloudflareCall, type Session } from "onestop-antibot";
import * as httpclient from "./httpclient.ts";

const apiKey = "YOUR_API_KEY";
const identifier = ""; // your identifier or account name
const pageUrl = "https://www.example.com/event";
const siteKey = "YOUR_TURNSTILE_SITE_KEY"; // from the page's turnstile.render options
const action = "YOUR_TURNSTILE_ACTION";
const cData = "YOUR_TURNSTILE_CDATA";
const acceptLanguage = "en-US,en;q=0.9";

const proxy = ""; // your proxy, in the site's country

const hc = new httpclient.Client(proxy);
const [client, ip] = await newClient();
const session = newSession(client, ip, pageUrl);
const first = await getChallengePage(hc);
const token = await runChallengeLoop(hc, session, first);
siteFirewall(hc, pageUrl, token);
console.log("PASS Turnstile token returned");

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

// getChallengePage returns the first call: the widget iframe, its final URL
// and its cf-ray header.
async function getChallengePage(hc: httpclient.Client): Promise<CloudflareCall> {
  const page = new URL(pageUrl);
  const api = await hc.get("https://challenges.cloudflare.com/turnstile/v0/api.js", httpclient.script(acceptLanguage, "cross-site", page.origin + "/").storageAccess());
  // api.js redirects to /turnstile/v0/<mode>/<version>/api.js.
  const segments = new URL(api.url).pathname.split("/");
  if (segments.length !== 6) httpclient.fatal(`FAIL api.js resolved to ${api.url}`);
  const mode = segments[3];
  // rch is a random 5-character render id.
  let rch = "";
  for (let i = 0; i < 5; i++) rch += "abcdefghijklmnopqrstuvwxyz0123456789"[randomInt(36)];
  const frame = await hc.get("https://challenges.cloudflare.com/cdn-cgi/challenge-platform/h/" + mode + "/turnstile/f/av0/rch/" + rch + "/" + siteKey + "/light/fbE/new/normal?lang=auto",
    httpclient.frame(acceptLanguage, "cross-site", "").storageAccess());
  if (frame.status !== 200) httpclient.fatal(`FAIL widget iframe returned ${frame.status}`);
  return {
    html: frame.body,
    scriptUrl: api.url,
    iframeUrl: frame.url,
    bytecodeRayId: frame.header("cf-ray"),
    action,
    cData,
  };
}

// runChallengeLoop sends each step's requests; each reply goes back on the
// next call, by its purpose, until the API returns the token.
async function runChallengeLoop(hc: httpclient.Client, session: Session, call: CloudflareCall): Promise<string> {
  let frameUrl = call.iframeUrl ?? "";
  let step = await session.cloudflareTurnstile(call).catch(httpclient.fail("Turnstile"));
  while (!step.token) {
    const next: CloudflareCall = { context: step.context, action, cData };
    for (const r of step.requests) {
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
      }
    }
    step = await session.cloudflareTurnstile(next).catch(httpclient.fail("Turnstile"));
  }
  return step.token;
}

function siteFirewall(hc: httpclient.Client, pageUrl: string, token: string): void {
  // Insert the relevant requests for your site's firewall. This is up to you and your agent to experiment with.
  // Some sites (DataDome, Akamai) are strict on flow: you might need additional requests here.
}
