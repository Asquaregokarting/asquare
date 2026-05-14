export class ApplicationError extends Error {
  constructor(
    message: string,
    public code: string,
    public statusCode: number = 500,
    public details?: Record<string, unknown>,
  ) {
    super(message)
    this.name = this.constructor.name
    Object.setPrototypeOf(this, ApplicationError.prototype)
  }
}

export class ValidationError extends ApplicationError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'VALIDATION_ERROR', 400, details)
  }
}

export class NetworkError extends ApplicationError {
  constructor(message: string = 'Network connection failed', details?: Record<string, unknown>) {
    super(message, 'NETWORK_ERROR', 503, details)
  }
}

export class PaymentError extends ApplicationError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'PAYMENT_ERROR', 402, details)
  }
}

export class APIError extends ApplicationError {
  constructor(message: string, code: string, details?: Record<string, unknown>) {
    super(message, code, 500, details)
  }
}
