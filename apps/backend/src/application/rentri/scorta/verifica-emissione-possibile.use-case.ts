import { Injectable } from '@nestjs/common'
import { PrismaService } from '../../../infrastructure/persistence/prisma.service'
import { RentriUnitaLocaleService } from '../../../infrastructure/rentri/rentri-unita-locale.service'
import { RentriScortaRepository } from '../../../infrastructure/persistence/rentri-scorta.repository'
import { RentriVidimazioneClient } from '../../../infrastructure/rentri/rentri-vidimazione.client'
import { risolviCfTenant } from './risolvi-cf-tenant'

export interface EsitoEmissionePossibile {
  possibile: boolean
  motivo?: string
  numeriDisponibili: number
}

/**
 * `GET /rentri/emissione-possibile` (R6) — il differenziatore del punto 4
 * dell'audit (v. `docs/audits/rentri-blocchi-come-fanno-gli-altri-2026-09-11.md`):
 * tutti i gestionali esaminati scoprono l'assenza di un numero disponibile
 * SOLO al salvataggio del FIR già compilato. Qui si può interrogare PRIMA,
 * es. all'apertura della schermata "nuovo FIR".
 *
 * Tre esiti possibili, in ordine di diagnosi (dal più al meno grave):
 * 1. Nessuna unità locale RENTRI configurata per il tenant → non c'è
 *    nemmeno una sede da cui emettere.
 * 2. Scorta vuota E nessun blocco attivo presso l'ente per quella sede →
 *    il problema è a monte, sul portale RENTRI (il messaggio lo dice
 *    esplicitamente, non lascia indovinare dove andare).
 * 3. Scorta vuota ma un blocco esiste (predefinito già configurato) →
 *    basta vidimare un lotto, non serve andare sul portale.
 *
 * Il caso 2 richiede una lettura remota (`elencaBlocchi`) SOLO quando la
 * scorta locale è già vuota: nel caso comune (scorta disponibile) questo
 * use case non contatta mai l'ente, restando veloce per una chiamata pensata
 * per essere fatta ad ogni apertura della schermata di emissione.
 */
@Injectable()
export class VerificaEmissionePossibileRentriUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly unitaLocaleService: RentriUnitaLocaleService,
    private readonly scortaRepo: RentriScortaRepository,
    private readonly vidimazioneClient: RentriVidimazioneClient
  ) {}

  async execute(tenantId: string, numIscrSito?: string): Promise<EsitoEmissionePossibile> {
    const unitaLocale = numIscrSito
      ? ((await this.unitaLocaleService.listForTenant(tenantId)).find(
          u => u.numIscrSito === numIscrSito
        ) ?? null)
      : await this.unitaLocaleService.getPrincipale(tenantId)

    if (!unitaLocale) {
      return {
        possibile: false,
        numeriDisponibili: 0,
        motivo:
          'Nessuna unità locale RENTRI configurata per questo tenant: configurala prima di poter emettere un formulario.',
      }
    }

    const numeriDisponibili = await this.scortaRepo.contaTotaleDisponibili(
      tenantId,
      unitaLocale.numIscrSito
    )

    if (numeriDisponibili > 0) {
      return { possibile: true, numeriDisponibili }
    }

    if (!unitaLocale.codiceBloccoPredefinito) {
      const cf = await risolviCfTenant(this.prisma, tenantId)
      const { risultati } = await this.vidimazioneClient.elencaBlocchi(
        cf,
        { numIscrSito: unitaLocale.numIscrSito, ancheDisattivi: false },
        tenantId
      )

      if (risultati.length === 0) {
        return {
          possibile: false,
          numeriDisponibili: 0,
          motivo:
            `Nessun blocco virtuale attivo per la sede "${unitaLocale.denominazione}": va creato sul ` +
            'portale RENTRI (Interoperabilità → Gestione blocchi virtuali dei FIR).',
        }
      }

      return {
        possibile: false,
        numeriDisponibili: 0,
        motivo:
          `Ci sono blocchi attivi per la sede "${unitaLocale.denominazione}" ma nessun numero è ancora ` +
          'stato vidimato: imposta un blocco predefinito e vidima un lotto dalla sezione Blocchi RENTRI.',
      }
    }

    return {
      possibile: false,
      numeriDisponibili: 0,
      motivo:
        `Nessun numero FIR vidimato disponibile per la sede "${unitaLocale.denominazione}": vidima un ` +
        'lotto dalla sezione Blocchi RENTRI, oppure attendi il rifornimento automatico.',
    }
  }
}
