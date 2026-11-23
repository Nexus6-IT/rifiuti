/**
 * Abbandona un'apertura rimasta incerta (eREGI E3, residuo R1 della review di E2).
 *
 * Dopo un esito incerto la prenotazione dell'apertura resta finche' non si collega qualcosa. Se il
 * registro "sospetto" non e' nostro (aperto a mano sul portale da altri, o la POST non e' mai
 * partita) l'utente non aveva una via d'uscita. Qui la prenotazione si azzera, ma solo se:
 * - l'apertura e' davvero in sospeso (c'e' una prenotazione e il registro non e' collegato);
 * - e' trascorsa la soglia di stallo `SOGLIA_STALLO_RENTRI_MS`: prima la POST puo' essere ancora
 *   in volo e abbandonare permetterebbe una seconda apertura.
 * Se la POST era invece andata a buon fine resta un registro sul portale, non collegato: si
 * collega a mano dall'elenco o si chiude dal portale. Solo ADMIN, con audit.
 */
import { Injectable } from '@nestjs/common'
import { TenantContext } from '../../../core/context/tenant-context'
import { LoggerService } from '../../../core/logger/logger.service'
import { PrismaService } from '../../../infrastructure/persistence/prisma.service'
import { SOGLIA_STALLO_RENTRI_MS } from '../sync-fir-to-rentri.use-case'
import { leggiContestoRegistroRentri } from './contesto-registro-rentri'
import {
  AperturaRegistroInCorsoError,
  NessunaAperturaDaAbbandonareError,
  RegistroGiaCollegatoError,
  richiediAmministratore,
} from './errori-azioni-rentri-registro'
import {
  ImpostazioniRentriRegistroService,
  type ImpostazioniRegistro,
} from './impostazioni-rentri-registro.service'

@Injectable()
export class AbbandonaAperturaRegistroRentriUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly impostazioni: ImpostazioniRentriRegistroService,
    private readonly logger: LoggerService
  ) {
    this.logger.setContext('AbbandonaAperturaRegistroRentriUseCase')
  }

  /**
   * @throws RuoloNonAutorizzatoRentriError 403
   * @throws RegistroGiaCollegatoError 409 il registro e' gia' collegato
   * @throws NessunaAperturaDaAbbandonareError 409 nessuna prenotazione
   * @throws AperturaRegistroInCorsoError 409 prenotazione troppo recente: la POST puo' essere in volo
   */
  async esegui(
    tenantId: string,
    utenteId: string,
    ruolo: string,
    registroId: string
  ): Promise<ImpostazioniRegistro> {
    richiediAmministratore(ruolo)
    await TenantContext.run(
      { tenantId },
      async () =>
        await this.prisma.$transaction(async tx => {
          // Stessa chiave di `apri`, di `collega` e della risoluzione: si serializzano.
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'rentri-registro-apertura|' + registroId}))`
          const contesto = await leggiContestoRegistroRentri(tx, tenantId, registroId)
          if (contesto.identificativoRentri !== null) throw new RegistroGiaCollegatoError()
          if (contesto.rentriAperturaRichiestaIl === null) {
            throw new NessunaAperturaDaAbbandonareError()
          }
          const eta = Date.now() - contesto.rentriAperturaRichiestaIl.getTime()
          if (eta < SOGLIA_STALLO_RENTRI_MS) {
            throw new AperturaRegistroInCorsoError(
              "L'apertura è stata richiesta da pochi minuti: potrebbe essere ancora in corso. Riprova più tardi."
            )
          }
          await tx.registroRifiuti.updateMany({
            where: { id: registroId, tenantId, identificativoRentri: null },
            data: {
              rentriAperturaRichiestaIl: null,
              rentriAperturaDescrizione: null,
              rentriAttivita: [],
              rentriAttivitaRecSmalt: [],
            },
          })
          await tx.activityLog.create({
            data: {
              tenantId,
              userId: utenteId,
              action: 'RENTRI_REGISTRO_APERTURA_ABBANDONATA',
              description: 'Apertura del registro su RENTRI abbandonata dopo un esito incerto',
              metadata: { registroId, richiestaIl: contesto.rentriAperturaRichiestaIl },
            },
          })
        })
    )
    this.logger.info('Apertura del registro RENTRI abbandonata', { tenantId, registroId })
    const lista = await this.impostazioni.leggi(tenantId)
    const r = lista.find(x => x.registroId === registroId)
    if (!r) throw new Error("Registro non trovato dopo l'abbandono dell'apertura")
    return r
  }
}
