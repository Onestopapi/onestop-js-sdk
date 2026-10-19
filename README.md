# OneStop JavaScript SDK

Node.js client for the [OneStop Antibot](https://onestopantibot.com) API, written in TypeScript. The SDK calls `/generate` and returns typed results; your application fetches the target pages and scripts and sends the generated payloads.

Products: Akamai (sensor, SBSD, Pixel, sec-cpt), DataDome (tags, interstitial, slider), Cloudflare (WAF, Turnstile, JSD, precursor), Kasada (p.js, /tl, CD header), Imperva (reese84, utmvc).

## Install

```sh
npm install onestop-antibot
```

Requires Node.js 22.15+. Package: [npm](https://www.npmjs.com/package/onestop-antibot).

## Quick start

```ts
import { OneStop } from "onestop-antibot";

const client = new OneStop({
  apiKey: "YOUR_API_KEY",
  identifier: "YOUR_IDENTIFIER", // your identifier or account name
  ipAgent, // an http.Agent through your proxy
});
const ip = await client.getIp(); // the proxy's IP
const session = client.session({
  site: pageUrl, referer: pageUrl, userAgent, acceptLanguage: "en-US,en;q=0.9", ip,
});
const res = await session.akamaiSensor({ abck, bmsz, script, scriptUrl });
// POST res.payload as sensor_data; send res.context on the next call.
```

## Header order

Copy each request's header names, values and order from a browser recording (DevTools, powhttp, Charles) of that request, and set the order explicitly in your TLS client; the examples' headers only show how:

```ts
// httpcloak
await session.request("GET", url, {
  headers: { "user-agent": userAgent, accept: "*/*" },
  headerOrder: ["user-agent", "accept"],
});
```

See [examples/](examples) for full flows per product with httpcloak.

Documentation: [onestopantibot.com/dashboard/docs](https://onestopantibot.com/dashboard/docs)
