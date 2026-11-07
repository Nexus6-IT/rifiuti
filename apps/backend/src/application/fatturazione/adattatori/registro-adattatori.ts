// Registro degli adattatori dell'export contabile (4.4c, Task 29). L'elenco arriva dal provider
// `ADATTATORI_EXPORT` del modulo: aggiungere un adattatore e' aggiungerlo a quell'elenco.
import { BadRequestException, Inject, Injectable } from '@nestjs/common'
import { ADATTATORI_EXPORT, type AdattatoreExportContabile } from './adattatore-export-contabile'

/** Larghezza della colonna `mappature_export_contabile.adattatore`. */
const LUNGHEZZA_MASSIMA_CODICE = 30

@Injectable()
export class RegistroAdattatori {
  private readonly perCodice = new Map<string, AdattatoreExportContabile>()

  constructor(
    @Inject(ADATTATORI_EXPORT) private readonly adattatori: readonly AdattatoreExportContabile[]
  ) {
    for (const a of adattatori) {
      if (a.codice.length === 0 || a.codice.length > LUNGHEZZA_MASSIMA_CODICE) {
        throw new Error(
          `Adattatore «${a.codice}»: il codice deve avere da 1 a ${LUNGHEZZA_MASSIMA_CODICE} caratteri.`
        )
      }
      if (this.perCodice.has(a.codice)) {
        throw new Error(`Adattatore «${a.codice}» duplicato.`)
      }
      this.perCodice.set(a.codice, a)
    }
  }

  tutti(): AdattatoreExportContabile[] {
    return [...this.adattatori]
  }

  /** 400 `ADATTATORE_SCONOSCIUTO` se il codice non e' registrato. */
  trova(codice: string): AdattatoreExportContabile {
    const a = this.perCodice.get(codice)
    if (a === undefined) {
      throw new BadRequestException({
        error: 'ADATTATORE_SCONOSCIUTO',
        message: 'Il formato di esportazione non è disponibile.',
      })
    }
    return a
  }

  /** Per l'export: l'adattatore se il codice e' registrato, altrimenti `undefined`. */
  cerca(codice: string): AdattatoreExportContabile | undefined {
    return this.perCodice.get(codice)
  }
}
