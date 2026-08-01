export default class HttpError extends Error {
  readonly statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);

    this.name = "HttpError";
    this.statusCode = statusCode;

    Error.captureStackTrace(this, this.constructor);
  }
}
