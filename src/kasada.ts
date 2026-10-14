import { createHash, randomBytes, randomInt } from "node:crypto";
import { OneStopError } from "./errors.js";
import type { KasadaCdCall } from "./types.js";

// The x-kpsdk-cd header JSON; property order is the wire order.
interface CdMobile {
  workTime: number;
  rst: number;
  duration: number;
  id: string;
  st: number;
  answers: number[];
  d: number;
}

interface CdDesktop {
  workTime: number;
  id: string;
  answers: number[];
  duration: number;
  d: number;
  st: number;
  rst: number;
}

const sha256Hex = (...parts: (string | Buffer)[]) => {
  const h = createHash("sha256");
  for (const p of parts) h.update(p);
  return h.digest("hex");
};

/** Computes the x-kpsdk-cd header locally. No client or API key is needed. Throws {@link OneStopError} on invalid input. */
export function kasadaCdHeader(call: KasadaCdCall): string {
  const { st, rst, mobile = false, ct = "", cryptoCustomerKey = "", seedSuffix = "", difficulty, subchallengeCount: count } = call;
  if (!(st > 0) || !(rst >= st)) throw new OneStopError("kasada: require positive ST and RST >= ST");
  if (!(difficulty > 0) || !(count > 0)) throw new OneStopError("kasada: difficulty and subchallenge count must be positive");
  const parts: (string | Buffer)[] = ["tp-v2-input"];
  if (!mobile) {
    const bytes = Buffer.from(ct);
    if (bytes.length < 16) throw new OneStopError("kasada: desktop CT must contain at least 16 bytes");
    parts.push(bytes.subarray(0, 16));
  }
  const id = randomBytes(16).toString("hex");
  const workTime = Date.now() - randomInt(10, 51);
  parts.push(`, ${workTime}, ${id}`);
  if (cryptoCustomerKey) parts.push(", " + cryptoCustomerKey);
  if (seedSuffix) parts.push(", " + seedSuffix);
  let hash = sha256Hex(...parts);
  const target = difficulty / count;
  const answers: number[] = [];
  for (let i = 0; i < count; i++) {
    for (let nonce = 1; ; nonce++) {
      const next = sha256Hex(`${nonce}, ${hash}`);
      if (0x10000000000000 / (parseInt(next.slice(0, 13), 16) + 1) >= target) {
        answers.push(nonce);
        hash = next;
        break;
      }
    }
  }
  const duration = Math.round((0.5 + Math.random() * 1.5) * 10) / 10;
  const d = rst - st;
  const header: CdMobile | CdDesktop = mobile
    ? { workTime, rst, duration, id, st, answers, d }
    : { workTime, id, answers, duration, d, st, rst };
  return JSON.stringify(header);
}
