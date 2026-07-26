import { Injectable, BadRequestException } from '@nestjs/common'
import { LoggerService } from '../../../core/logger/logger.service'
import { RentriCredentialService } from '../../../infrastructure/rentri/rentri-credential.service'
import { RentriAnagraficheClient } from '../../../infrastructure/rentri/rentri-anagrafiche.client'
import {
  RentriUnitaLocaleService,
  RentriUnitaLocale,
} from '../../../infrastructure/rentri/rentri-unita-locale.service'

/** Messaggio fail-closed quando manca il numero di iscrizione dell'operatore. */
export const MESSAGGIO_NUM_ISCR_OPERATORE_MANCANTE =
  'Configura il numero di iscrizione RENTRI della tua azienda prima di leggere le unità locali. ' +
  'Vai su Impostazioni RENTRI > Certificato e credenziali.'

/**
 * Legge le unità locali dell'operatore da RENTRI (`GET /operatore/{num_iscr}/siti`,
 * anagrafiche.yaml) e le allinea nella tabella `RentriUnitaLocale` — le stesse
 * righe che R2 popola manualmente (v. commento del model in schema.prisma:
 * "il client anagrafiche di R4 potrà popolare questa tabella automaticamente
 * senza cambiarne la forma").
 *
 * **On-demand, non a cron** (a differenza delle codifiche, Task 4/5): le
 * unità locali sono per-tenant e cambiano per iniziativa dell'azienda (nuova
 * sede, variazione), non per un ciclo dell'ente. Un cron globale che
 * interroghi RENTRI per ogni tenant ad ogni intervallo fisso spenderebbe
 * chiamate per aziende che non hanno cambiato nulla da mesi. L'allineamento
 * parte quindi quando qualcuno lo richiede:
 *
 * - **apertura della pagina** (`esegui(tenantId)`, `forza` assente/false):
 *   allinea SOLO se la cache è scaduta (`sitiSincronizzatiAl` più vecchio di
 *   {@link TTL_CACHE_MS}, un'ora — un valore ragionevole per un dato che
 *   cambia a settimane/mesi di distanza, non ad ogni apertura pagina) E
 *   l'operatore ha configurato `numIscrOperatore`. Se manca la
 *   configurazione, o se l'allineamento verso l'ente fallisce, l'apertura
 *   della pagina NON si blocca: restituisce silenziosamente quanto già in
 *   cache (mai bloccare la sola lettura per una configurazione mancante o un
 *   guasto transitorio dell'ente — l'azione "non parte", non "la pagina non
 *   si apre").
 * - **azione esplicita "Aggiorna dall'ente"** (`esegui(tenantId, { forza: true })`):
 *   forza la rilettura ignorando il TTL. Qui il fail-closed è ESPLICITO:
 *   senza `numIscrOperatore` l'azione non parte affatto (400, messaggio
 *   azionabile) e un eventuale errore verso RENTRI propaga (l'utente ha
 *   chiesto esplicitamente un aggiornamento, deve sapere se è fallito).
 */
@Injectable()
export class SincronizzaSitiUseCase {
  /**
   * TTL della cache: un'ora. Le unità locali di un'azienda cambiano per
   * variazione anagrafica (nuova sede, cessazione), un evento a settimane o
   * mesi di distanza — un'ora è già prudente rispetto alla cadenza reale del
   * dato, ed evita di richiamare l'ente ad ogni apertura della sezione
   * «Unità locali» nella stessa sessione di lavoro.
   */
  private static readonly TTL_CACHE_MS = 60 * 60 * 1000

  constructor(
    private readonly credentialService: RentriCredentialService,
    private readonly client: RentriAnagraficheClient,
    private readonly unitaLocaleService: RentriUnitaLocaleService,
    private readonly logger: LoggerService
  ) {
    this.logger.setContext('SincronizzaSitiUseCase')
  }

  async esegui(tenantId: string, opzioni?: { forza?: boolean }): Promise<RentriUnitaLocale[]> {
    const credenziale = await this.credentialService.getForTenant(tenantId)
    const numIscrOperatore = credenziale?.numIscrOperatore ?? null

    if (opzioni?.forza) {
      if (!numIscrOperatore) {
        throw new BadRequestException(MESSAGGIO_NUM_ISCR_OPERATORE_MANCANTE)
      }
      await this.allineaDaRentri(tenantId, numIscrOperatore)
      return this.unitaLocaleService.listForTenant(tenantId)
    }

    // Apertura pagina: allinea solo se configurato E la cache è scaduta.
    if (numIscrOperatore) {
      const ultimoSync = await this.credentialService.getSitiSincronizzatiAl(tenantId)
      const cacheScaduta =
        !ultimoSync || Date.now() - ultimoSync.getTime() >= SincronizzaSitiUseCase.TTL_CACHE_MS

      if (cacheScaduta) {
        try {
          await this.allineaDaRentri(tenantId, numIscrOperatore)
        } catch (errore) {
          // Refresh silenzioso in apertura pagina: un errore verso RENTRI
          // (rete, 403/429/423) non deve impedire di vedere le unità locali
          // già in cache. V. commento di testata della classe.
          this.logger.warn(
            'Allineamento automatico delle unità locali RENTRI fallito, restituisco la cache locale',
            { tenantId, errore: errore instanceof Error ? errore.message : String(errore) }
          )
        }
      }
    }

    return this.unitaLocaleService.listForTenant(tenantId)
  }

  /**
   * Scarica l'elenco siti dall'ente e li allinea (upsert additivo, mai
   * cancellazione — v. {@link RentriUnitaLocaleService.upsertFromRentri}),
   * poi marca la cache come fresca. Solo righe con `num_iscr_sito`
   * valorizzato vengono considerate: il contratto lo dichiara nullable, ma
   * senza quel valore la riga non è identificabile né utile.
   */
  private async allineaDaRentri(tenantId: string, numIscrOperatore: string): Promise<void> {
    const esito = await this.client.elencaSiti(numIscrOperatore, undefined, tenantId)

    const siti = esito.risultati
      .filter(
        (s): s is typeof s & { num_iscr_sito: string } =>
          typeof s.num_iscr_sito === 'string' && s.num_iscr_sito.trim() !== ''
      )
      .map(s => ({
        numIscrSito: s.num_iscr_sito,
        denominazione: (s.nome ?? '').trim() || s.num_iscr_sito,
        attiva: s.stato === 'Attivo',
      }))

    await this.unitaLocaleService.upsertFromRentri(tenantId, siti)
    await this.credentialService.markSitiSincronizzati(tenantId)

    this.logger.info('Unità locali RENTRI allineate', { tenantId, numeroSiti: siti.length })
  }
}
