/**
 * Every SDK failure. `statusCode` is 0 for transport and local errors, whose `message` is the full reason. For API
 * failures `message` is the API's message and `toString()` reads `onestop: HTTP <status> (<requestId>): <message>`.
 */
export class OneStopError extends Error {
  override name = "OneStopError";
  readonly statusCode: number;
  readonly requestId: string;

  constructor(message: string, statusCode = 0, requestId = "", options?: ErrorOptions) {
    super(message, options);
    this.statusCode = statusCode;
    this.requestId = requestId;
  }

  override toString(): string {
    if (!this.statusCode) return this.message;
    return this.requestId
      ? `onestop: HTTP ${this.statusCode} (${this.requestId}): ${this.message}`
      : `onestop: HTTP ${this.statusCode}: ${this.message}`;
  }
}
