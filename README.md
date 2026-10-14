# OneStop JavaScript SDK

Node.js client for the [OneStop Antibot](https://onestopantibot.com) API, written in TypeScript. The SDK calls `/generate` and returns typed results; your application fetches the target pages and scripts and sends the generated payloads.

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
  identifier: "", // your identifier or account name
  ipAgent, // an http.Agent through your proxy
});
const ip = await client.getIp(); // the proxy's IP
const session = client.session({
  site: pageUrl, referer: pageUrl, userAgent, acceptLanguage: "en-US,en;q=0.9", ip,
});
const res = await session.akamaiSensor({ abck, bmsz, script, scriptUrl });
// POST res.payload as sensor_data; send res.context on the next call.
```

See [examples/](examples) for full flows per product and TLS client.

Documentation: [onestopantibot.com/dashboard/docs](https://onestopantibot.com/dashboard/docs)
