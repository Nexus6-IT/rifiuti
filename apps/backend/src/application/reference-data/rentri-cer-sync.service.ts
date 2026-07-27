import { Injectable, Inject } from '@nestjs/common'
import { LoggerService } from '../../core/logger/logger.service'
import { ICERRepository } from '../../domain/cer/repositories/cer-repository.interface'
import { RentriCodificheClient } from '../../infrastructure/rentri/codifiche/rentri-codifiche.client'
import { CodificaItem } from '../../infrastructure/rentri/codifiche/rentri-codifiche.model'

export interface EsitoAllineamentoCer {
  nuovi: number
  aggiornati: number
  rimossi: number
}

/**
 * Allineamento del catalogo CER con il catalogo ufficiale RENTRI
 * (`GET /codifiche/v1.0/lookup/codici-eer`) — R4 Task 4.
 *
 * **Perché un file/servizio DISTINTO da `ReferenceDataSeederService`.**
 * Sono due sottosistemi paralleli sullo stesso model Prisma (`CERCode`) con
 * fonte e politica diverse, e mescolarli complicherebbe ulteriormente un'area
 * già duplicata:
 * - `ReferenceDataSeederService.seedCer`/`reseedAll('cer')`: fonte CSV
 *   bundled/URL, upsert INCONDIZIONATO di descrizione/pericolosità/categoria
 *   (sovrascrive sempre), esposto anche su `POST /reference-data/reseed`
 *   (endpoint admin, classificato distruttivo — reseed completo su richiesta).
 * - `RentriCerSyncService` (qui): fonte l'ente RENTRI, upsert dei soli campi
 *   che l'ente dichiara (descrizione, pericolosità) SENZA MAI cancellare una
 *   riga. Nessun endpoint admin: solo cron mensile. Non è, e non deve
 *   diventare, distruttivo quanto il reseed CSV.
 *
 * **La protezione centrale del piano R4.** Un FIR è un documento a valore
 * legale: se un codice CER che referenzia sparisse dal catalogo, il FIR
 * risulterebbe incoerente a posteriori. Quindi un codice che RENTRI smette di
 * restituire in un ciclo NON viene mai cancellato: viene marcato
 * (`presenteInRentri=false`, `rimossoDaRentriAl` valorizzato). Resta
 * leggibile/stampabile per i FIR già emessi (`ICERRepository.exists`, usato
 * dalle letture), smette solo di essere selezionabile per un FIR NUOVO
 * (`ICERRepository.isUtilizzabilePerNuovoFormulario`, usato da
 * `CreateFIRUseCase`). Se il codice torna a comparire in un ciclo
 * successivo, la marcatura si ritira automaticamente (v. `upsertFromRentri`).
 *
 * **Cadenza mensile, non giornaliera** (piano R4 Task 4 Step 5, stessa
 * cadenza prudente di `reference-data`): i codici CER cambiano per norma
 * (aggiornamento del catalogo europeo dei rifiuti), non per uso quotidiano.
 * Una cadenza più frequente non comprerebbe alcuna freschezza reale, solo
 * chiamate in più verso l'ente per un dato che si muove a mesi di distanza.
 *
 * **R4 Task 5**: il cron mensile che scatenava `allinea()` è stato tolto da
 * qui e spostato nell'orchestratore unico `RentriCodificheSyncService`, che
 * lo chiama in sequenza insieme alle altre tabelle "allinea ora" (v. il
 * commento di testata di quella classe). Tenere un `@Cron` anche qui
 * avrebbe fatto scattare due allineamenti CER indipendenti nello stesso
 * mese — lo stesso servizio resta comunque chiamabile manualmente tramite
 * `allinea()`, invariato.
 */
@Injectable()
export class RentriCerSyncService {
  constructor(
    private readonly client: RentriCodificheClient,
    @Inject('ICERRepository') private readonly cerRepository: ICERRepository,
    private readonly logger: LoggerService
  ) {
    this.logger.setContext(RentriCerSyncService.name)
  }

  /**
   * Esegue un ciclo di allineamento completo. Scarica l'intero catalogo
   * ufficiale in un colpo solo (`escludi00=false` esplicito: i codici di
   * capitolo non vanno esclusi silenziosamente, v.
   * `RentriCodificheClient.codiciEer`), poi:
   *  1. upsert di ogni codice restituito (nuovo o già noto);
   *  2. marcatura (mai cancellazione) di ogni codice in catalogo che
   *     l'ente non ha restituito in questo ciclo.
   */
  async allinea(tenantId?: string): Promise<EsitoAllineamentoCer> {
    const voci = await this.client.codiciEer({ escludi00: false }, tenantId)

    const confermati = new Map<string, { description: string; isPericoloso: boolean }>()
    for (const voce of voci) {
      const code = this.normalizzaCodice(voce)
      if (!code) continue
      confermati.set(code, {
        description: voce.name ?? '',
        isPericoloso: this.derivaPericoloso(voce, code),
      })
    }

    let nuovi = 0
    let aggiornati = 0
    for (const [code, dati] of confermati) {
      const esistente = await this.cerRepository.findByCode(code)
      await this.cerRepository.upsertFromRentri({ code, ...dati })
      if (esistente) {
        aggiornati++
      } else {
        nuovi++
      }
    }

    let rimossi = 0
    const ora = new Date()
    const tuttiICodici = await this.cerRepository.listTuttiICodici()
    for (const code of tuttiICodici) {
      if (confermati.has(code)) continue
      const marcatoOra = await this.cerRepository.marcaRimossoDaRentriSeAttivo(code, ora)
      if (marcatoOra) rimossi++
    }

    return { nuovi, aggiornati, rimossi }
  }

  /**
   * RENTRI restituisce i codici senza spazi (es. `"130208*"`); il catalogo
   * locale usa il formato canonico con spazi (`"13 02 08*"`, stessa
   * normalizzazione di `CreateFIRUseCase.normalizeCerCode`). Scarta voci non
   * a 6 cifre (difensivo: non dovrebbe accadere su questa tabella).
   */
  private normalizzaCodice(voce: CodificaItem): string | null {
    const raw = voce.code
    if (!raw) return null
    const trimmed = raw.trim().toUpperCase()
    const hazardous = trimmed.endsWith('*')
    const digits = trimmed.replace(/[^0-9]/g, '')
    if (digits.length !== 6) return null
    const spaced = `${digits.slice(0, 2)} ${digits.slice(2, 4)} ${digits.slice(4, 6)}`
    return hazardous ? `${spaced}*` : spaced
  }

  /**
   * Preferisce `properties.pericoloso` (dichiarato dal contratto per questa
   * tabella); ricade sull'asterisco nel codice normalizzato se assente o non
   * booleano.
   */
  private derivaPericoloso(voce: CodificaItem, codiceNormalizzato: string): boolean {
    const daProperties = voce.properties?.['pericoloso']
    if (typeof daProperties === 'boolean') return daProperties
    return codiceNormalizzato.endsWith('*')
  }
}
