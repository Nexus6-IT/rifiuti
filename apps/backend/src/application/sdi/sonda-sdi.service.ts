// Sonda delle trasmissioni SDI di UNA azienda (4.5f T1, piano §4.5f): avvisa in-app gli ADMIN quando una
// fattura ha bisogno di una persona. La chiama `SdiSondaJob` ogni 10 minuti.
//
// Cosa segnala (una sola volta per trasmissione, mai per documenti annullati o gia' rifatturati):
//   - `INCERTA` da oltre un'ora: non si sa se il provider ha ricevuto l'invio, non rinviare alla cieca;
//   - `SCARTATA`: lo SDI ha rifiutato il file, va annullata e rifatturata (con i codici dello scarto);
//   - `ERRORE_INVIO`: rete di sicurezza dell'avviso immediato di `ElaboraInvioSdiService`, che puo'
//     fallire in silenzio; non si ripete se quell'avviso esiste gia'.
// Idempotenza: l'avviso porta `related_entity_type = 'TrasmissioneSdi'` e l'id della trasmissione; una
// trasmissione con un avviso del genere non viene segnalata di nuovo. Le notifiche scadono dopo 30 giorni
// (cleanup generale): una trasmissione ancora irrisolta dopo tanto riceve un secondo avviso, e va bene
// cosi' (promemoria). Solo SYSTEM_ERROR: nessun nuovo valore dell'enum, nessuna migration.
import { Injectable, Logger } from '@nestjs/common'
import { PrismaService } from '../../infrastructure/persistence/prisma.service'
import { nelContestoTenant } from '../pese/nel-contesto-tenant'

/** `INCERTA` da cosi' tanto senza esito: serve una persona. */
export const SOGLIA_INCERTA_SDI_MS = 3_600_000
const LIMITE_PER_GIRO = 100

export interface EsitoGiroSondaSdi {
  /** Trasmissioni che richiedono attenzione e non erano ancora state segnalate. */
  problemi: number
  /** Notifiche create (problemi x ADMIN dell'azienda). */
  avvisiCreati: number
}

interface Problema {
  id: string
  documentoId: string
  stato: 'INCERTA' | 'SCARTATA' | 'ERRORE_INVIO'
  nomeFile: string
  codici: string[] | null
  errore: string | null
}

@Injectable()
export class SondaSdiService {
  private readonly logger = new Logger(SondaSdiService.name)

  constructor(private readonly prisma: PrismaService) {}

  async giroAzienda(tenantId: string, ora: Date): Promise<EsitoGiroSondaSdi> {
    const soglia = new Date(ora.getTime() - SOGLIA_INCERTA_SDI_MS)
    return nelContestoTenant(tenantId, async () => {
      const problemi = await this.prisma.$queryRaw<Problema[]>`
        SELECT t.id::text AS id, t.documento_id::text AS "documentoId", t.stato::text AS stato,
               t.nome_file AS "nomeFile", t.ultimo_errore_codice AS errore,
               (SELECT n.codici_errore FROM "notifiche_sdi" n
                 WHERE n.trasmissione_id = t.id AND n.tipo = 'NS'
                 ORDER BY n.created_at DESC LIMIT 1) AS codici
        FROM "trasmissioni_sdi" t
        JOIN "documenti_fattura" d ON d.id = t.documento_id AND d.tenant_id = t.tenant_id
        WHERE t.tenant_id = ${tenantId}::uuid
          AND t.direzione = 'EMESSA'
          AND d.stato <> 'ANNULLATO'
          AND ((t.stato = 'INCERTA' AND t.updated_at < ${soglia}::timestamptz)
            OR t.stato IN ('SCARTATA', 'ERRORE_INVIO'))
          -- Una trasmissione piu' recente sullo stesso documento chiude il capitolo.
          AND NOT EXISTS (SELECT 1 FROM "trasmissioni_sdi" nuova
                          WHERE nuova.tenant_id = t.tenant_id AND nuova.documento_id = t.documento_id
                            AND nuova.created_at > t.created_at)
          AND NOT EXISTS (SELECT 1 FROM "notifications" nt
                          WHERE nt.tenant_id = t.tenant_id
                            AND nt.related_entity_type = 'TrasmissioneSdi'
                            AND nt.related_entity_id = t.id)
          -- Avviso immediato dell'invio fallito gia' consegnato.
          AND NOT (t.stato = 'ERRORE_INVIO' AND EXISTS (
                          SELECT 1 FROM "notifications" im
                          WHERE im.tenant_id = t.tenant_id
                            AND im.related_entity_id = t.documento_id
                            AND im.title = 'Invio allo SDI non riuscito'
                            AND im.created_at >= COALESCE(t.chiusa_il, t.updated_at)))
        ORDER BY t.updated_at, t.id
        LIMIT ${LIMITE_PER_GIRO}::int`
      if (problemi.length === 0) return { problemi: 0, avvisiCreati: 0 }

      const admin = await this.prisma.user.findMany({
        where: { tenantId, role: { in: ['ADMIN', 'SUPER_ADMIN'] } },
        select: { id: true },
      })
      if (admin.length === 0) {
        this.logger.warn(`Sonda SDI azienda ${tenantId}: ${problemi.length} problemi, nessun ADMIN`)
        return { problemi: problemi.length, avvisiCreati: 0 }
      }

      let avvisiCreati = 0
      for (const p of problemi) {
        const testo = descrivi(p)
        const r = await this.prisma.notification.createMany({
          data: admin.map(u => ({
            tenantId,
            userId: u.id,
            type: 'SYSTEM_ERROR' as const,
            title: testo.titolo,
            message: testo.messaggio,
            severity: testo.gravita,
            relatedEntityId: p.id,
            relatedEntityType: 'TrasmissioneSdi',
            actionUrl: '/fatturazione/documenti',
            isRead: false,
          })),
        })
        avvisiCreati += r.count
      }
      return { problemi: problemi.length, avvisiCreati }
    })
  }
}

function descrivi(p: Problema): {
  titolo: string
  messaggio: string
  gravita: 'WARNING' | 'ERROR'
} {
  switch (p.stato) {
    case 'INCERTA':
      return {
        titolo: 'Invio allo SDI incerto',
        gravita: 'WARNING',
        messaggio: `Non è certo che la fattura (file ${p.nomeFile}) sia arrivata al provider: l'esito non è noto da oltre un'ora. Apri la cronologia del documento e verifica prima di rinviarla, per non emettere due volte la stessa fattura.`,
      }
    case 'SCARTATA': {
      const codici = p.codici && p.codici.length > 0 ? ` (codici ${p.codici.join(', ')})` : ''
      return {
        titolo: 'Fattura scartata dallo SDI',
        gravita: 'ERROR',
        messaggio: `Lo SDI ha scartato la fattura (file ${p.nomeFile})${codici}. Apri il documento: puoi annullarla e rifatturarla.`,
      }
    }
    case 'ERRORE_INVIO':
      return {
        titolo: 'Invio allo SDI non riuscito',
        gravita: 'ERROR',
        messaggio: `La fattura (file ${p.nomeFile}) non è stata inviata allo SDI${p.errore ? ` (codice ${p.errore})` : ''}. Controlla il documento e riprova l'invio.`,
      }
  }
}
