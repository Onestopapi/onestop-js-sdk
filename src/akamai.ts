import { createHash } from "node:crypto";
import { OneStopError } from "./errors.js";
import type { AkamaiSecCptCall } from "./types.js";

/** Solves the sec-cpt crypto challenge locally; returns the body to POST to /_sec/verify?provider=<provider> (crypto or adaptive). No client or API key is needed. Throws {@link OneStopError} on invalid input. */
export function akamaiSecCptPayload(call: AkamaiSecCptCall): string {
  const { cookie, token, nonce, timestamp, difficulty, count } = call;
  const tilde = cookie.indexOf("~");
  if (tilde < 0) throw new OneStopError('akamai: sec_cpt cookie must contain "~"');
  if (!token || !nonce || !(timestamp > 0)) throw new OneStopError("akamai: token, nonce and a positive timestamp are required");
  if (!(difficulty > 0) || !(count > 0)) throw new OneStopError("akamai: difficulty and count must be positive");
  const seed = cookie.slice(0, tilde) + timestamp + nonce;
  const answers: string[] = [];
  for (let i = 0; i < count; i++) {
    const target = difficulty + i;
    const base = seed + target;
    for (;;) {
      const answer = Math.random().toString(16);
      let remainder = 0;
      for (const b of createHash("sha256").update(base + answer).digest()) remainder = (remainder * 256 + b) % target;
      if (remainder === 0) {
        answers.push(answer);
        break;
      }
    }
  }
  return `{"token": "${token}", "answers": ["${answers.join('","')}"]}`;
}
