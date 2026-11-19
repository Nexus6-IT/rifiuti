import { Inject, Injectable } from '@nestjs/common'
import { PROVIDER_SDI, type ProviderSdi } from './provider-sdi.port'
import type { CodiceProviderSdi } from '../../../domain/fatturazione/sdi/codici'

/** Errore di configurazione: provider sconosciuto o non ammesso nell'ambiente. */
export class ProviderSdiNonDisponibileError extends Error {
  constructor(
    readonly codice: string,
    readonly motivo: 'SCONOSCIUTO' | 'FAKE_IN_PRODUZIONE'
  ) {
    super(
      motivo === 'FAKE_IN_PRODUZIONE'
        ? 'Il provider fake non è ammesso in produzione'
        : `Provider SDI «${codice}» non disponibile`
    )
  }
}

/**
 * Sceglie l'adattatore dal codice salvato nella configurazione dell'azienda. In produzione
 * (`NODE_ENV=production`) il `fake` e' rifiutato, come `SIGNATURE_PROVIDER=sandbox`: un invio
 * simulato non deve mai sembrare un invio fiscale reale.
 */
@Injectable()
export class RegistroProviderSdi {
  private readonly perCodice = new Map<CodiceProviderSdi, ProviderSdi>()

  constructor(@Inject(PROVIDER_SDI) adattatori: readonly ProviderSdi[]) {
    for (const a of adattatori) {
      if (this.perCodice.has(a.codice)) {
        throw new Error(`Provider SDI «${a.codice}» duplicato.`)
      }
      this.perCodice.set(a.codice, a)
    }
  }

  codiciDisponibili(nodeEnv: string | undefined = process.env.NODE_ENV): CodiceProviderSdi[] {
    return [...this.perCodice.keys()].filter(c => !(c === 'fake' && nodeEnv === 'production'))
  }

  trova(codice: string, nodeEnv: string | undefined = process.env.NODE_ENV): ProviderSdi {
    if (codice === 'fake' && nodeEnv === 'production') {
      throw new ProviderSdiNonDisponibileError(codice, 'FAKE_IN_PRODUZIONE')
    }
    const a = this.perCodice.get(codice as CodiceProviderSdi)
    if (a === undefined) throw new ProviderSdiNonDisponibileError(codice, 'SCONOSCIUTO')
    return a
  }
}
