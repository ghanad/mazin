/** Thrown when user-supplied input fails validation (maps to HTTP 400). */
export class ValidationError extends Error {
  status = 400;
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

/** Thrown for conflicts such as an existing target key (HTTP 409). */
export class ConflictError extends Error {
  status = 409;
  details?: Record<string, unknown>;
  constructor(message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "ConflictError";
    this.details = details;
  }
}

/** Thrown when an object does not exist (HTTP 404). */
export class NotFoundError extends Error {
  status = 404;
  constructor(message = "Not found") {
    super(message);
    this.name = "NotFoundError";
  }
}

/** Requested range not satisfiable (HTTP 416). */
export class RangeNotSatisfiableError extends Error {
  status = 416;
  constructor(message = "Requested range not satisfiable") {
    super(message);
    this.name = "RangeNotSatisfiableError";
  }
}

/** Storage backend failure. Message is safe for clients. */
export class StorageError extends Error {
  status = 500;
  code: string;
  constructor(message: string, code = "storage_error") {
    super(message);
    this.name = "StorageError";
    this.code = code;
  }
}
