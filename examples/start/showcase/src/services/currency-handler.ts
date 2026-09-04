/** Fixed rates used by both the in-process and deployed currency proofs. */
export const currencyRates = { USD: 0.66, EUR: 0.61 } as const

/** Credential-requiring handler with deterministic exchange rates. */
export function currencyHandler(
  request: Request,
  expectedCredential: string,
): Response {
  if (request.headers.get('authorization') !== expectedCredential) {
    return Response.json({ error: 'credential required' }, { status: 401 })
  }
  const url = new URL(request.url)
  if (url.pathname !== '/rates') {
    return Response.json({ error: 'not found' }, { status: 404 })
  }
  return Response.json({ base: 'AUD', rates: currencyRates })
}
