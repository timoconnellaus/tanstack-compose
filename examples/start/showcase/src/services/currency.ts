import { WorkerEntrypoint } from 'cloudflare:workers'
import { currencyHandler } from './currency-handler'

export { currencyHandler, currencyRates } from './currency-handler'

/** Service-binding entrypoint for the showcase's in-repo currency service. */
export class CurrencyService extends WorkerEntrypoint<{
  CURRENCY_CREDENTIAL: string
}> {
  override fetch(request: Request): Response {
    return currencyHandler(request, this.env.CURRENCY_CREDENTIAL)
  }
}
