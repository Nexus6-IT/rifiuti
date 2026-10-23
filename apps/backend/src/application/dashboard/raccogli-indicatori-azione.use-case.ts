import { Injectable } from '@nestjs/common'
import { FIRStatus, RENTRISyncStatus } from '@prisma/client'
import { PrismaService } from '../../infrastructure/persistence/prisma.service'
import { RentriScortaRepository } from '../../infrastructure/persistence/rentri-scorta.repository'
import { VoceAttenzione, AttenzioneResult } from './raccogli-attenzione.use-case'

/**
 * Stati FIR (colonna `status`, Prisma) da escludere dal conteggio "da
 * trasmettere": BOZZA (`DRAFT`/`AWAITING_PRODUCER`, v. `fir-prisma.repository.ts`,
 * DB_TO_STATO — un formulario ancora in bozza non è "emesso", non ha nulla
 * da trasmettere) e ANNULLATO (`CANCELLED` — un documento chiuso non va
 * trasmesso, anche se non ha mai raggiunto `rentriNumeroFir`/`SYNCED`).
 *
 * NOTA (corretta in revisione finale, 2026-09-11): questa lista NON è "lo
 * stesso filtro" di `get-aggregated-dashboard.handler.ts` — quella query
 * (righe 69-70) usa una lista di INCLUSIONE (`status: { in: [...] }`) per
 * rispondere a una domanda diversa, "dove devo intervenire adesso" per una
 * vista aggregata multi-tenant, e non menziona affatto `CANCELLED`. La
 * citazione precedente era sbagliata; il filtro qui sotto resta corretto per
 * la domanda che questo file pone ("cosa è ancora da trasmettere"), solo non
 * supportato da quel riferimento.
 *
 * Corretto in revisione (giro 1): la prima versione ometteva `CANCELLED`,
 * facendo contare — e in caso di un tentativo di sync fallito prima
 * dell'annullamento, anche marcare "critico" — formulari già chiusi che
 * l'operatore non deve inseguire. Rinominata da `STATI_BOZZA` perché quel
 * nome dichiarava un contenuto diverso da quello reale.
 */
const STATI_ESCLUSI_DA_TRASMETTERE: FIRStatus[] = [
  FIRStatus.DRAFT,
  FIRStatus.AWAITING_PRODUCER,
  FIRStatus.CANCELLED,
]

/**
 * Raccoglie indicatori orientati all'azione per il cruscotto (Task 3 del
 * piano cruscotto), separati da {@link RaccogliAttenzioneUseCase} — quel
 * file supera già le 150 righe che il piano indica come soglia per separare,
 * e le due voci qui sotto non hanno nulla in comune con certificato RENTRI e
 * autorizzazioni impianto se non la forma (`VoceAttenzione`) e la
 * destinazione (la stessa fascia "Richiede attenzione" del cruscotto,
 * unificate a valle dal controller — v. `AttenzioneController`).
 *
 * Isolamento: ogni query è filtrata per `tenantId`, preso dal contesto
 * autenticato dal chiamante (mai da un parametro scelto dal chiamante).
 *
 * DIFESA IN PROFONDITÀ (rilievo revisione finale, 2026-09-11): le query
 * passano da `this.prisma.db.<model>` (client esteso con `rlsExtension`),
 * non dal client nudo — stessa scelta di `RaccogliAttenzioneUseCase`. `FIR` e
 * `RentriUnitaLocale` sono entrambi in `TENANT_SCOPED_MODELS`, quindi
 * l'iniezione automatica del `tenantId` copre anche queste query se il
 * filtro esplicito venisse mai dimenticato. NON copre invece i conteggi
 * della scorta, che passano da `RentriScortaRepository` sul client nudo:
 * li' vale solo il filtro esplicito, ed e' una scelta di quel repository,
 * non una dimenticanza di questo use case.
 */
@Injectable()
export class RaccogliIndicatoriAzioneUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scortaRepo: RentriScortaRepository
  ) {}

  async raccogli(tenantId: string): Promise<AttenzioneResult> {
    const [daTrasmettere, scorta] = await Promise.all([
      this.voceFormulariDaTrasmettere(tenantId),
      this.vociScortaVidimata(tenantId),
    ])

    return { voci: [...daTrasmettere, ...scorta] }
  }

  /**
   * «Quanti formulari devo ancora trasmettere all'ente» — la domanda che
   * porta una sanzione se resta senza risposta (RENTRI, D.Lgs 152/2006).
   *
   * Un formulario è "da trasmettere" quando: è emesso o oltre (non BOZZA,
   * non ANNULLATO — stesso filtro di stato di
   * `get-aggregated-dashboard.handler.ts`), NON è già legato a un numero_fir
   * (`rentriNumeroFir` nullo) e il suo stato di sincronizzazione non è
   * SYNCED. Le due condizioni (numero nullo + stato non SYNCED) sono
   * ridondanti nei dati sani (`markRENTRISynced` valorizza sempre entrambi
   * insieme), ma tenerle entrambe esplicite è difesa in profondità, non
   * un'illusione di precisione.
   *
   * Query aggregata (`groupBy` su `rentriSyncStatus`), non un `findMany` di
   * tutti i formulari da contare in memoria: un tenant con centinaia di FIR
   * pendenti non deve pesare quanto le sue righe.
   *
   * Gravità: 'critico' se almeno un formulario ha già un tentativo fallito
   * (FAILED/PERMANENTLY_FAILED — un problema reale, non solo l'attesa
   * normale del job periodico), altrimenti 'avviso'.
   */
  private async voceFormulariDaTrasmettere(tenantId: string): Promise<VoceAttenzione[]> {
    const gruppi = await this.prisma.db.fIR.groupBy({
      by: ['rentriSyncStatus'],
      where: {
        tenantId,
        status: { notIn: STATI_ESCLUSI_DA_TRASMETTERE },
        rentriNumeroFir: null,
        rentriSyncStatus: { not: RENTRISyncStatus.SYNCED },
      },
      _count: { _all: true },
    })

    const totale = gruppi.reduce((somma, gruppo) => somma + gruppo._count._all, 0)

    if (totale === 0) {
      return []
    }

    const falliti = gruppi
      .filter(
        gruppo =>
          gruppo.rentriSyncStatus === RENTRISyncStatus.FAILED ||
          gruppo.rentriSyncStatus === RENTRISyncStatus.PERMANENTLY_FAILED
      )
      .reduce((somma, gruppo) => somma + gruppo._count._all, 0)

    return [
      {
        chiave: 'formulari-da-trasmettere',
        gravita: falliti > 0 ? 'critico' : 'avviso',
        titolo: 'Formulari da trasmettere a RENTRI',
        dettaglio:
          falliti > 0
            ? `${totale} in attesa di trasmissione all'ente, di cui ${falliti} con un tentativo già fallito`
            : `${totale} in attesa di trasmissione all'ente`,
        azione: { etichetta: 'Vedi formulari', rotta: '/fir' },
      },
    ]
  }

  /**
   * «Numeri vidimati pronti», con la soglia configurata per sede (R6,
   * `RentriUnitaLocale.dimensioneScortaDesiderata`). Nessuna soglia
   * inventata: le sedi senza soglia configurata non generano alcuna voce,
   * stesso principio già in uso in `RentriRifornimentoScortaJob`.
   *
   * Una voce per sede con soglia configurata: 'avviso' se i numeri
   * DISPONIBILI sono sotto soglia, 'informativo' altrimenti — è
   * un'informazione utile anche quando va tutto bene, non solo un allarme.
   */
  private async vociScortaVidimata(tenantId: string): Promise<VoceAttenzione[]> {
    const unita = await this.prisma.db.rentriUnitaLocale.findMany({
      where: { tenantId, dimensioneScortaDesiderata: { not: null } },
      select: { numIscrSito: true, denominazione: true, dimensioneScortaDesiderata: true },
    })

    if (unita.length === 0) {
      return []
    }

    return Promise.all(
      unita.map(async sede => {
        const disponibili = await this.scortaRepo.contaTotaleDisponibili(tenantId, sede.numIscrSito)
        // Garantito non nullo dal filtro Prisma sopra (`{ not: null }`).
        const soglia = sede.dimensioneScortaDesiderata as number
        const sottoSoglia = disponibili < soglia

        return {
          chiave: `scorta-vidimata-${sede.numIscrSito}`,
          gravita: sottoSoglia ? 'avviso' : 'informativo',
          titolo: sottoSoglia
            ? `Numeri vidimati in esaurimento — ${sede.denominazione}`
            : `Numeri vidimati pronti — ${sede.denominazione}`,
          dettaglio: `${disponibili} pronti su una soglia di ${soglia}`,
          azione: { etichetta: 'Vedi scorta', rotta: '/rentri/blocchi' },
        } satisfies VoceAttenzione
      })
    )
  }
}
