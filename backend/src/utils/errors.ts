export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const Errors = {
  badRequest: (message = "Invalid request") => new AppError(400, "BAD_REQUEST", message),
  unauthorized: (message = "Login required") => new AppError(401, "UNAUTHORIZED", message),
  invalidCredentials: () => new AppError(401, "INVALID_CREDENTIALS", "Invalid email/user id or password"),
  paymentRequired: (message: string, code = "CREDIT_EXHAUSTED") => new AppError(402, code, message),
  forbidden: (message = "Not allowed", code = "FORBIDDEN") => new AppError(403, code, message),
  notFound: (message = "Not found") => new AppError(404, "NOT_FOUND", message),
  conflict: (code: string, message: string) => new AppError(409, code, message),
};
