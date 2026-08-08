/** An error with an HTTP status and a stable machine-readable code. */
export class AppError extends Error {
  /**
   * @param {number} status
   * @param {string} code
   * @param {string} message
   * @param {Record<string, unknown>} [details]
   */
  constructor(status, code, message, details) {
    super(message)
    this.name = 'AppError'
    this.status = status
    this.code = code
    this.details = details
  }
}

export const badRequest = (msg, details) => new AppError(400, 'bad_request', msg, details)
export const unauthorized = (msg = 'Nicht angemeldet.') => new AppError(401, 'unauthorized', msg)
export const forbidden = (msg = 'Nicht erlaubt.') => new AppError(403, 'forbidden', msg)
export const notFound = (msg = 'Nicht gefunden.') => new AppError(404, 'not_found', msg)
export const conflict = (msg, details) => new AppError(409, 'conflict', msg, details)
export const failedDependency = (msg, details) =>
  new AppError(424, 'failed_dependency', msg, details)
export const serverError = (msg, details) => new AppError(500, 'server_error', msg, details)

/**
 * Express error handler. Must keep four parameters or Express will treat it as
 * ordinary middleware.
 */
export function errorHandler(log, redact) {
  return (err, req, res, _next) => {
    const status = err instanceof AppError ? err.status : 500
    const code = err instanceof AppError ? err.code : 'server_error'
    const message =
      err instanceof AppError
        ? err.message
        : 'Unerwarteter Serverfehler. Details stehen im Log.'

    if (status >= 500) {
      log.error(`${req.method} ${req.path} -> ${status}`, err)
    } else {
      log.debug(`${req.method} ${req.path} -> ${status}: ${redact(err.message)}`)
    }

    if (res.headersSent) {
      res.end()
      return
    }
    res.status(status).json({
      error: { code, message: redact(message), details: err.details ?? undefined },
    })
  }
}
