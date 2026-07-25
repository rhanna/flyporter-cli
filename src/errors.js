export class FlyPorterError extends Error {
  constructor(message, { code = "FLYPORTER_ERROR", exitCode = 1, cause } = {}) {
    super(message, { cause });
    this.name = this.constructor.name;
    this.code = code;
    this.exitCode = exitCode;
  }
}

export class AuthenticationError extends FlyPorterError {
  constructor(message, options = {}) {
    super(message, { code: "AUTHENTICATION_FAILED", exitCode: 2, ...options });
  }
}

export class SessionExpiredError extends FlyPorterError {
  constructor(
    message = "Authentication has expired. Complete sign-in again in the running FlyPorter Chrome window.",
    options = {},
  ) {
    super(message, { code: "SESSION_EXPIRED", exitCode: 3, ...options });
  }
}

export class CloudflareChallengeError extends FlyPorterError {
  constructor(options = {}) {
    super(
      "Cloudflare human verification blocked the fetch-only session. Authenticate again later or import a valid persisted session; this CLI does not bypass Cloudflare challenges.",
      { code: "CLOUDFLARE_CHALLENGE", exitCode: 4, ...options },
    );
  }
}

export class ValidationError extends FlyPorterError {
  constructor(message, options = {}) {
    super(message, { code: "INVALID_ARGUMENT", exitCode: 5, ...options });
  }
}

export class RemoteResponseError extends FlyPorterError {
  constructor(message, options = {}) {
    super(message, { code: "REMOTE_RESPONSE_ERROR", exitCode: 6, ...options });
  }
}

export class UnsupportedCommandError extends FlyPorterError {
  constructor(message, options = {}) {
    super(message, { code: "UNSUPPORTED_COMMAND", exitCode: 7, ...options });
  }
}
