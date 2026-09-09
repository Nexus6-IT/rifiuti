import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'

import { HealthItem, HealthState } from '../health-item'

/**
 * Probe dei flag di modalita' attivi in questo ambiente.
 *
 * Un flag NON e' un guasto: lo stato naturale di un flag spento e' `off`, e
 * quello di un valore descrittivo (l'ambiente, il fornitore di firma) e'
 * `info`. `warn` compare in un solo caso: una scelta che va bene in sviluppo
 * ma non in produzione, trovata accesa in produzione — Swagger esposto, un
 * provider di firma finto, un endpoint RENTRI che punta al simulatore.
 * Quella e' l'unica domanda utile che questa sezione puo' rispondere.
 */
@Injectable()
export class FlagProbe {
  constructor(private readonly config: ConfigService) {}

  raccogli(): HealthItem[] {
    const produzione = this.config.get<string>('NODE_ENV') === 'production'

    return [
      this.informativo(
        'ambiente',
        'Ambiente',
        this.config.get<string>('NODE_ENV') ?? 'non impostato'
      ),
      this.informativo(
        'versione',
        'Versione applicativa',
        this.config.get<string>('APP_VERSION') ?? 'non impostata'
      ),
      this.interruttore({
        key: 'swagger',
        label: 'Documentazione API (Swagger)',
        acceso: this.config.get<string>('SWAGGER_ENABLED') === 'true',
        pericolosoInProduzione: produzione,
        motivoPericolo: 'Superficie API esposta pubblicamente in produzione.',
      }),
      this.interruttore({
        key: 'spid-strict',
        label: 'Controllo stretto del livello SPID',
        acceso: this.config.get<string>('SPID_STRICT_LEVEL_CHECK') === 'true',
      }),
      this.interruttore({
        key: 'sentry',
        label: 'Tracciamento errori (Sentry/Bugsink)',
        acceso: Boolean(this.config.get<string>('SENTRY_DSN')),
      }),
      this.interruttore({
        key: 'stripe',
        label: 'Pagamenti Stripe',
        acceso: Boolean(this.config.get<string>('STRIPE_SECRET_KEY')),
      }),
      this.fornitoreFirma(produzione),
      this.endpointRentri(produzione),
    ]
  }

  private informativo(key: string, label: string, valore: string): HealthItem {
    return { key: `flag.${key}`, label, state: 'info', since: null, detail: valore }
  }

  private interruttore(params: {
    key: string
    label: string
    acceso: boolean
    pericolosoInProduzione?: boolean
    motivoPericolo?: string
  }): HealthItem {
    const acceso = params.acceso
    const allarme = acceso && params.pericolosoInProduzione === true
    const state: HealthState = allarme ? 'warn' : acceso ? 'ok' : 'off'

    return {
      key: `flag.${params.key}`,
      label: params.label,
      state,
      since: null,
      detail: allarme
        ? `Attivo in produzione. ${params.motivoPericolo ?? ''}`.trim()
        : acceso
          ? 'Attivo.'
          : 'Non attivo in questo ambiente.',
    }
  }

  private fornitoreFirma(produzione: boolean): HealthItem {
    const provider = this.config.get<string>('SIGNATURE_PROVIDER') ?? 'non impostato'
    const finto = /mock|sandbox|fake/i.test(provider)

    return {
      key: 'flag.firma',
      label: 'Fornitore di firma digitale',
      state: finto && produzione ? 'warn' : 'info',
      since: null,
      detail:
        finto && produzione
          ? `"${provider}": fornitore non reale attivo in produzione.`
          : `"${provider}".`,
    }
  }

  private endpointRentri(produzione: boolean): HealthItem {
    const url = this.config.get<string>('RENTRI_API_URL')

    if (!url) {
      return {
        key: 'flag.rentri-endpoint',
        label: 'Endpoint RENTRI',
        state: 'off',
        since: null,
        detail: 'RENTRI_API_URL non impostata: nessuna trasmissione telematica configurata.',
      }
    }

    const simulatore = /localhost|127\.0\.0\.1|fake|mock/i.test(url)

    return {
      key: 'flag.rentri-endpoint',
      label: 'Endpoint RENTRI',
      state: simulatore && produzione ? 'warn' : 'info',
      since: null,
      detail:
        simulatore && produzione ? `${url} — il simulatore risulta attivo in produzione.` : url,
    }
  }
}
