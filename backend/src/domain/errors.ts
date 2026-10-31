/** An error the caller may see: carries an HTTP-ish status and a stable machine code. */
export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) { super(message); this.status = status; this.code = code; }
}
