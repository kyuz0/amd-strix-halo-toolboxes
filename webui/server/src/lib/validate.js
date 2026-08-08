import { badRequest } from './errors.js'

/**
 * Validate request parts against zod schemas and replace them with the parsed
 * result, so unknown keys are stripped and downstream code sees typed values
 * rather than strings.
 *
 * @param {{body?: import('zod').ZodTypeAny, query?: import('zod').ZodTypeAny,
 *          params?: import('zod').ZodTypeAny}} schemas
 */
export function validate(schemas) {
  return (req, res, next) => {
    try {
      for (const part of ['body', 'query', 'params']) {
        const schema = schemas[part]
        if (!schema) continue
        const result = schema.safeParse(req[part])
        if (!result.success) {
          const issue = result.error.issues[0]
          const where = issue.path.length ? `${part}.${issue.path.join('.')}` : part
          throw badRequest(`Ungültige Eingabe bei ${where}: ${issue.message}`, {
            issues: result.error.issues,
          })
        }
        // Express 5 makes req.query a getter-only property, so assigning to it
        // throws. Stash the parsed value alongside instead.
        if (part === 'query') req.validatedQuery = result.data
        else req[part] = result.data
      }
      next()
    } catch (err) {
      next(err)
    }
  }
}

/** The parsed query if `validate` ran, otherwise the raw one. */
export function q(req) {
  return req.validatedQuery ?? req.query
}
