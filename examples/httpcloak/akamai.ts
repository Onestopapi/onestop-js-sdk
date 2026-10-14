// Akamai: load the homepage, send the SBSD payloads (mode f, then t), then
// POST sensor data until the sensor is accepted.
import { OneStop, type AkamaiSensorCall, type SbsdCall, type Session } from "onestop-antibot";
import * as httpclient from "./httpclient.ts";

const apiKey = "YOUR_API_KEY";
const identifier = ""; // your identifier or account name
const pageUrl = "https://www.example.com/";
const acceptLanguage = "en-US,en;q=0.9";

const proxy = ""; // your proxy, in the site's country

const sensorScript = /<script type="text\/javascript"[^>]*src="([A-Za-z0-9/_-]+)"><\/script>/;
const sbsdScript = /<script[^>]*src="([^"]*\?v=[^"]*)"/;

// SbsdBody is the JSON body of an SBSD POST.
interface SbsdBody {
  body: string;
}

// SensorBody is the JSON body of a sensor POST.
interface SensorBody {
  sensor_data: string;
}

const hc = new httpclient.Client(proxy);
const [client, ip] = await newClient();
const page = await getHomePage(hc);
const [sensorUrl, sbsdUrl] = findScripts(page);
const session = newSession(client, ip, page.url);
const [sensor, sbsd] = await getScripts(hc, page, sensorUrl, sbsdUrl);
await solveSbsdPassive(hc, session, page, sbsdUrl, sbsd);
await postSensors(hc, session, page, sensorUrl, sensor);
siteFirewall(hc, pageUrl);
console.log("PASS sensor accepted");

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

function getHomePage(hc: httpclient.Client): Promise<httpclient.Response> {
  return hc.get(pageUrl, httpclient.navigate(acceptLanguage, "").noCache());
}

function findScripts(page: httpclient.Response): [URL, URL] {
  const sensorMatch = page.body.match(sensorScript);
  const sbsdMatch = page.body.match(sbsdScript);
  if (page.status !== 200 || !sensorMatch || !sbsdMatch) httpclient.fatal(`FAIL homepage returned ${page.status} without the sensor and SBSD scripts`);
  return [page.resolve(sensorMatch[1]), page.resolve(sbsdMatch[1])];
}

async function getScripts(hc: httpclient.Client, page: httpclient.Response, sensorUrl: URL, sbsdUrl: URL): Promise<[string, string]> {
  const sensor = await hc.get(sensorUrl.href, httpclient.script(acceptLanguage, "same-origin", page.url).noCache());
  const sbsd = await hc.get(sbsdUrl.href, httpclient.script(acceptLanguage, "same-origin", page.url).noCache());
  return [sensor.body, sbsd.body];
}

async function solveSbsdPassive(hc: httpclient.Client, session: Session, page: httpclient.Response, sbsdUrl: URL, script: string): Promise<void> {
  const origin = new URL(page.url).origin;
  // uuid is the v= value of the SBSD script URL; mode t sends f's context.
  let call: SbsdCall = { uuid: sbsdUrl.searchParams.get("v") ?? "", script };
  for (const mode of ["f", "t"]) {
    call.mode = mode;
    call.sbsdCookie = hc.cookie(page.url, "bm_so", "sbsd_o"); // cookie set by the page
    const res = await session.sbsdPayload(call).catch(httpclient.fail(`SBSD ${mode}`));
    const body = JSON.stringify({ body: res.payload } satisfies SbsdBody);
    const post = await hc.post(origin + sbsdUrl.pathname, httpclient.post(acceptLanguage, "application/json", origin, page.url).noCache(), body);
    if (post.status !== 200) httpclient.fatal(`FAIL SBSD ${mode} POST returned ${post.status}`);
    call = { uuid: call.uuid, context: res.context };
  }
}

async function postSensors(hc: httpclient.Client, session: Session, page: httpclient.Response, sensorUrl: URL, script: string): Promise<void> {
  const origin = sensorUrl.origin;
  // The first sensor call sends the script, every later call the previous
  // context instead. _abck and bm_sz are cookies set by the site.
  let call: AkamaiSensorCall = { script, scriptUrl: sensorUrl.href };
  for (let n = 1; ; n++) {
    call.abck = hc.cookie(page.url, "_abck");
    call.bmsz = hc.cookie(page.url, "bm_sz");
    const res = await session.akamaiSensor(call).catch(httpclient.fail("sensor"));
    const body = JSON.stringify({ sensor_data: res.payload } satisfies SensorBody);
    const post = await hc.post(sensorUrl.href, httpclient.post(acceptLanguage, "text/plain;charset=UTF-8", origin, page.url).noCache(), body);
    if (post.status !== 200 && post.status !== 201) httpclient.fatal(`FAIL sensor POST returned ${post.status}`);
    // Accepted: _abck contains ~0~ or the reply is the 17-byte ack.
    if (hc.cookie(page.url, "_abck").includes("~0~") || post.bytes.length === 17) return;
    if (n === 8) httpclient.fatal("FAIL sensor not accepted after 8 POSTs");
    call = { scriptUrl: sensorUrl.href, context: res.context };
  }
}

function siteFirewall(hc: httpclient.Client, pageUrl: string): void {
  // Insert the relevant requests for your site's firewall. This is up to you and your agent to experiment with.
  // Some sites (DataDome, Akamai) are strict on flow: you might need additional requests here.
  // If a later request resets _abck, run one more sensor call with the last context plus one POST.
}
