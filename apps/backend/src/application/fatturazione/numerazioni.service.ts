// Numerazioni delle fatture (4.4a, spec §4.6): elenco per anno e numero di partenza (S9).
// Il PUT del numero di partenza prende lo stesso lock `FOR UPDATE` della riserva dei numeri
// (`numerazione.ts`): un PUT concorrente a una definitiva si serializza sulla coppia, e il
// controllo «esiste un DEFINITIVO o un ANNULLATO?» avviene SOTTO lock, quindi vede anche il
// documento scritto dalla transazione che ha appena rilasciato il lock. L'audit contiene solo id,
// numeri e date.
import { BadRequestException, ConflictException, Injectable } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { PrismaService } from '../../infrastructure/persistence/prisma.service'
import { nonTrovato } from '../clienti/registri-iva.service'
import { traduciErrorePrisma, type DescrizioneEntita } from '../clienti/anagrafica-versionata'
import { impostaTimeoutLock, OPZIONI_TRANSAZIONE_SCRITTURA } from '../listino/lock-listino'
import { nelContestoTenant } from '../pese/nel-contesto-tenant'
import { eDataIso, validaAnno } from './numerazione'

export interface NumerazioneVista {
  registroIvaId: string
  codiceRegistro: string
  anno: number
  ultimoNumero: number
  ultimaData: string | null
  numeroPartenza: number
  dataPartenza: string | null
  /** Falso se la coppia ha gia' un documento DEFINITIVO o ANNULLATO di WasteFlow. */
  partenzaModificabile: boolean
  /** 0 se la riga non esiste ancora. */
  versione: number
}

export interface DatiPartenza {
  numeroPartenza: number
  dataPartenza: string | null
  versione: number
}

const NUMERO_PARTENZA_MAX = 99_999_999

const ENTITA: DescrizioneEntita = {
  prefisso: 'NUMERAZIONE_FATTURA',
  soggetto: 'La numerazione',
  femminile: true,
}

interface RigaVista extends NumerazioneVista {}

@Injectable()
export class NumerazioniService {
  constructor(private readonly prisma: PrismaService) {}

  /** Un elemento per registro IVA attivo, anche senza riga di numerazione (ultimo numero 0). */
  elenco(tenantId: string, anno: number): Promise<NumerazioneVista[]> {
    validaAnno(anno)
    return nelContestoTenant(tenantId, () => this.leggi(this.prisma, tenantId, anno, null))
  }

  async impostaPartenza(
    tenantId: string,
    utenteId: string,
    registroIvaId: string,
    anno: number,
    dati: DatiPartenza
  ): Promise<NumerazioneVista> {
    validaAnno(anno)
    if (
      !Number.isInteger(dati.numeroPartenza) ||
      dati.numeroPartenza < 0 ||
      dati.numeroPartenza > NUMERO_PARTENZA_MAX
    ) {
      throw new BadRequestException({
        error: 'NUMERO_PARTENZA_NON_VALIDO',
        message: 'Il numero di partenza deve essere un intero da 0 a 99999999.',
      })
    }
    if (
      dati.dataPartenza !== null &&
      (!eDataIso(dati.dataPartenza) || Number(dati.dataPartenza.slice(0, 4)) !== anno)
    ) {
      throw new BadRequestException({
        error: 'DATA_PARTENZA_NON_VALIDA',
        message: "La data di partenza non è valida o non appartiene all'anno della numerazione.",
      })
    }
    return nelContestoTenant(tenantId, () =>
      this.prisma
        .$transaction(async tx => {
          await impostaTimeoutLock(tx)
          // Con la RLS un registro di un'altra azienda non si vede: 404 come se non esistesse.
          const registro = await tx.registroIva.findFirst({
            where: { id: registroIvaId, tenantId },
            select: { id: true },
          })
          if (!registro) throw nonTrovato()

          // Stesso lock della riserva: INSERT della coppia (se manca) e poi FOR UPDATE. Una riserva
          // aperta sulla coppia fa aspettare qui il PUT fino al suo commit o rollback.
          const creata = await tx.$executeRaw`
            INSERT INTO "numerazioni_fattura" (tenant_id, registro_iva_id, anno, updated_at)
            VALUES (${tenantId}::uuid, ${registroIvaId}::uuid, ${anno}::int, now())
            ON CONFLICT DO NOTHING`
          const [riga] = await tx.$queryRaw<
            {
              ultimoNumero: number
              numeroPartenza: number
              dataPartenza: string | null
              ultimaData: string | null
              versione: number
            }[]
          >`
            SELECT ultimo_numero AS "ultimoNumero", numero_partenza AS "numeroPartenza",
                   data_partenza::text AS "dataPartenza", ultima_data::text AS "ultimaData",
                   versione
            FROM "numerazioni_fattura"
            WHERE tenant_id = ${tenantId}::uuid AND registro_iva_id = ${registroIvaId}::uuid
              AND anno = ${anno}::int
            FOR UPDATE`

          // Solo ORA, sotto lock: un definitivo (o un annullato) scritto da una riserva appena
          // conclusa e' gia' visibile. Questo controllo viene PRIMA di quello sulla versione: la
          // riserva ha incrementato la versione, ma la risposta giusta e' PARTENZA_NON_MODIFICABILE.
          const [uso] = await tx.$queryRaw<{ usata: boolean }[]>`
            SELECT EXISTS (
              SELECT 1 FROM "documenti_fattura"
              WHERE tenant_id = ${tenantId}::uuid AND registro_iva_id = ${registroIvaId}::uuid
                AND anno = ${anno}::int AND stato IN ('DEFINITIVO', 'ANNULLATO')
            ) AS usata`
          if (uso.usata) {
            throw new ConflictException({
              error: 'PARTENZA_NON_MODIFICABILE',
              message:
                'Il numero di partenza non si modifica: per questo registro e anno esistono già documenti numerati.',
            })
          }

          // Una riga appena creata (la prima scrittura porta la versione a 1, come per il cedente)
          //  da questa transazione equivale a «non esiste»: versione 0.
          const versioneAttuale = creata === 1 ? 0 : riga.versione
          if (versioneAttuale !== dati.versione) {
            throw new ConflictException({
              error: 'VERSIONE_SUPERATA',
              message:
                'La numerazione è stata modificata nel frattempo: ricarica per vedere i dati aggiornati.',
            })
          }

          const invariata =
            riga.numeroPartenza === dati.numeroPartenza &&
            riga.ultimoNumero === dati.numeroPartenza &&
            riga.dataPartenza === dati.dataPartenza &&
            riga.ultimaData === dati.dataPartenza
          if (!invariata) {
            await tx.$executeRaw`
              UPDATE "numerazioni_fattura"
              SET numero_partenza = ${dati.numeroPartenza}::int,
                  ultimo_numero = ${dati.numeroPartenza}::int,
                  data_partenza = ${dati.dataPartenza}::date,
                  ultima_data = ${dati.dataPartenza}::date,
                  versione = versione + ${creata === 1 ? 0 : 1}::int, updated_at = now()
              WHERE tenant_id = ${tenantId}::uuid AND registro_iva_id = ${registroIvaId}::uuid
                AND anno = ${anno}::int`
            await tx.activityLog.create({
              data: {
                tenantId,
                userId: utenteId,
                action: 'NUMERAZIONE_FATTURA_PARTENZA_IMPOSTATA',
                description: 'Numero di partenza della numerazione delle fatture impostato',
                metadata: {
                  registroIvaId,
                  anno,
                  numeroPartenza: {
                    prima: riga.numeroPartenza,
                    dopo: dati.numeroPartenza,
                  },
                  dataPartenza: { prima: riga.dataPartenza, dopo: dati.dataPartenza },
                } as Prisma.InputJsonValue,
              },
            })
          }
          const [vista] = await this.leggi(tx, tenantId, anno, registroIvaId)
          return vista
        }, OPZIONI_TRANSAZIONE_SCRITTURA)
        .catch(err => traduciErrorePrisma(err, ENTITA, {}))
    )
  }

  private leggi(
    db: PrismaService | Prisma.TransactionClient,
    tenantId: string,
    anno: number,
    registroIvaId: string | null
  ): Promise<RigaVista[]> {
    return db.$queryRaw<RigaVista[]>`
      SELECT r.id::text AS "registroIvaId", r.codice AS "codiceRegistro", ${anno}::int AS anno,
             COALESCE(n.ultimo_numero, 0)::int AS "ultimoNumero", n.ultima_data::text AS "ultimaData",
             COALESCE(n.numero_partenza, 0)::int AS "numeroPartenza",
             n.data_partenza::text AS "dataPartenza",
             NOT EXISTS (
               SELECT 1 FROM "documenti_fattura" d
               WHERE d.tenant_id = r.tenant_id AND d.registro_iva_id = r.id AND d.anno = ${anno}::int
                 AND d.stato IN ('DEFINITIVO', 'ANNULLATO')
             ) AS "partenzaModificabile",
             COALESCE(n.versione, 0)::int AS versione
      FROM "registri_iva" r
      LEFT JOIN "numerazioni_fattura" n
        ON n.tenant_id = r.tenant_id AND n.registro_iva_id = r.id AND n.anno = ${anno}::int
      WHERE r.tenant_id = ${tenantId}::uuid
        AND (${registroIvaId}::uuid IS NULL AND r.attivo OR r.id = ${registroIvaId}::uuid)
      ORDER BY r.codice, r.id`
  }
}
