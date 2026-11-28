// Elaborazione degli invii allo SDI di UNA azienda (4.5b, piano §4.3-§4.4). La chiama il job
// `SdiInvioJob` azienda per azienda, nel suo contesto; i test la chiamano direttamente.
//
// Un giro fa, in quest'ordine:
//   1. stalli: `IN_INVIO` fermo da piu' di 15 minuti -> `INCERTA` (il processo e' caduto a meta' invio:
//      non si sa se il provider ha ricevuto il file);
//   2. riconciliazione delle `INCERTA` (solo `cerca`, nessun invio): trovata -> `INVIATA`, assente ->
//      `DA_INVIARE`. Vale anche con gli invii spenti: non invia nulla;
//   3. invii (solo se l'interruttore globale, `invio_attivo` e la verifica lo consentono): prenota una
//      trasmissione `DA_INVIARE` scaduta con `FOR UPDATE SKIP LOCKED` (la prenotazione e' una transazione
//      a se': il commit di `IN_INVIO` precede la chiamata al provider), controlla l'impronta dell'XML,
//      chiama `invia` e scrive l'esito.
//
// Ogni UPDATE di esito e' condizionato allo stato di partenza (`AND stato = 'IN_INVIO'`): se un altro
// processo ha gia' mosso la riga, questo non la sovrascrive. Nessun log riporta XML o credenziali: solo
// id e conteggi.
import { createHash } from 'node:crypto'
import { Injectable, Logger } from '@nestjs/common'
import {
  ProviderSdiNonDisponibileError,
  RegistroProviderSdi,
} from '../fatturazione/sdi/registro-provider-sdi'
import type { EsitoInvio, ProviderSdi } from '../fatturazione/sdi/provider-sdi.port'
import { PrismaService } from '../../infrastructure/persistence/prisma.service'
import { impostaTimeoutLock, OPZIONI_TRANSAZIONE_SCRITTURA } from '../listino/lock-listino'
import { nelContestoTenant } from '../pese/nel-contesto-tenant'
import { TITOLO_AVVISO_SDI_ERRORE_INVIO } from './titoli-avvisi-sdi'
import { ConfigurazioneSdiService, type ConfigurazionePerInvio } from './configurazione-sdi.service'

/** `IN_INVIO` fermo da piu' di cosi' e' considerato interrotto. */
export const SOGLIA_STALLO_INVIO_SDI_MS = 15 * 60_000
/** Un invio `INCERTA` si riconcilia solo dopo questo tempo: il provider puo' essere in ritardo. */
export const ATTESA_RICONCILIAZIONE_SDI_MS = 2 * 60_000
/** Tentativi massimi (compreso il primo) prima di `ERRORE_INVIO`. */
export const MAX_TENTATIVI_INVIO_SDI = 5
/** Attesa dopo il tentativo n (1-based): 1, 5, 15, 60, 240 minuti. */
export const BACKOFF_INVIO_SDI_MINUTI = [1, 5, 15, 60, 240] as const
/** Trasmissioni inviate al massimo per azienda e per giro: tiene corto il giro. */
export const LIMITE_INVII_PER_GIRO = 25
const LIMITE_RICONCILIAZIONI_PER_GIRO = 50

export interface EsitoGiroSdi {
  stalli: number
  riconciliate: number
  inviate: number
  rifiutate: number
  ritentate: number
  incerte: number
  errori: number
}

interface TrasmissionePrenotata {
  id: string
  documentoId: string
  provider: string
  ambiente: string
  nomeFile: string
  xmlSha256: string
  tentativi: number
  haPrecedente: boolean
}

const sha256 = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex')

/** Attesa prima del prossimo tentativo, dopo il tentativo `n` (1-based). */
export function attesaDopoTentativoMs(n: number, ritentaDopoMs?: number): number {
  const base = BACKOFF_INVIO_SDI_MINUTI[Math.min(Math.max(n, 1), 5) - 1] * 60_000
  return Math.max(base, ritentaDopoMs ?? 0)
}

@Injectable()
export class ElaboraInvioSdiService {
  private readonly logger = new Logger(ElaboraInvioSdiService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly configurazione: ConfigurazioneSdiService,
    private readonly registro: RegistroProviderSdi
  ) {}

  /**
   * Un giro per l'azienda. `invii = false` (interruttore globale spento) salta solo il punto 3.
   * Le eccezioni di una singola trasmissione non fermano le altre.
   */
  async giroAzienda(
    tenantId: string,
    ora: Date,
    opzioni: { invii: boolean }
  ): Promise<EsitoGiroSdi> {
    const esito: EsitoGiroSdi = {
      stalli: 0,
      riconciliate: 0,
      inviate: 0,
      rifiutate: 0,
      ritentate: 0,
      incerte: 0,
      errori: 0,
    }
    const config = await this.configurazione.leggiPerInvio(tenantId)
    if (!config) return esito
    let provider: ProviderSdi
    try {
      provider = this.registro.trova(config.provider)
    } catch (e) {
      if (e instanceof ProviderSdiNonDisponibileError) {
        this.logger.warn(`Provider SDI non disponibile per l'azienda ${tenantId}: giro saltato`)
        return esito
      }
      throw e
    }

    esito.stalli = await this.segnaStalli(tenantId, ora)
    esito.riconciliate = await this.riconcilia(tenantId, ora, provider, config, esito)

    if (!opzioni.invii || !config.invioAttivo || !config.verificata) return esito

    for (let i = 0; i < LIMITE_INVII_PER_GIRO; i++) {
      const t = await this.prenota(tenantId, ora)
      if (!t) break
      try {
        await this.inviaUna(tenantId, t, ora, provider, config, esito)
      } catch (e) {
        esito.errori++
        // L'invio puo' essere partito: la trasmissione resta `IN_INVIO` e diventera' `INCERTA` allo stallo.
        this.logger.error(
          `Invio SDI fallito per la trasmissione ${t.id} (azienda ${tenantId}): ${
            e instanceof Error ? e.message : 'errore'
          }`
        )
      }
    }
    return esito
  }

  // ---------------------------------------------------------------------------------------------

  private async segnaStalli(tenantId: string, ora: Date): Promise<number> {
    const soglia = new Date(ora.getTime() - SOGLIA_STALLO_INVIO_SDI_MS)
    return nelContestoTenant(
      tenantId,
      async () =>
        this.prisma.$executeRaw`
        UPDATE "trasmissioni_sdi"
        SET stato = 'INCERTA', versione = versione + 1, updated_at = ${ora}::timestamptz
        WHERE tenant_id = ${tenantId}::uuid AND stato = 'IN_INVIO'
          AND updated_at < ${soglia}::timestamptz`
    )
  }

  private async riconcilia(
    tenantId: string,
    ora: Date,
    provider: ProviderSdi,
    config: ConfigurazionePerInvio,
    esito: EsitoGiroSdi
  ): Promise<number> {
    const soglia = new Date(ora.getTime() - ATTESA_RICONCILIAZIONE_SDI_MS)
    const incerte = await nelContestoTenant(
      tenantId,
      async () =>
        this.prisma.$queryRaw<
          { id: string; nomeFile: string; documentoId: string; tentativi: number }[]
        >`
        SELECT id::text AS id, nome_file AS "nomeFile", documento_id::text AS "documentoId",
               tentativi::int AS tentativi FROM "trasmissioni_sdi"
        WHERE tenant_id = ${tenantId}::uuid AND stato = 'INCERTA'
          AND updated_at < ${soglia}::timestamptz
        ORDER BY updated_at, id LIMIT ${LIMITE_RICONCILIAZIONI_PER_GIRO}::int`
    )
    let n = 0
    for (const t of incerte) {
      try {
        const trovato = await provider.cerca(config.contesto, {
          chiaveIdempotenza: t.id,
          nomeFile: t.nomeFile,
        })
        if (!trovato && t.tentativi >= MAX_TENTATIVI_INVIO_SDI) {
          // Tetto dei tentativi raggiunto anche per il ramo INCERTO: niente altro invio.
          // INCERTA -> DA_INVIARE -> IN_INVIO -> ERRORE_INVIO (le sole transizioni ammesse).
          const chiusa = await this.chiudiIncertaEsaurita(tenantId, t, ora)
          n += chiusa
          continue
        }
        const spostate = await nelContestoTenant(tenantId, async () =>
          trovato
            ? this.prisma.$executeRaw`
                UPDATE "trasmissioni_sdi"
                SET stato = 'INVIATA', id_provider = ${trovato.idProvider}, id_sdi = ${trovato.idSdi}::text,
                    inviata_il = COALESCE(inviata_il, ${ora}::timestamptz),
                    prossimo_tentativo_il = NULL, versione = versione + 1,
                    updated_at = ${ora}::timestamptz
                WHERE id = ${t.id}::uuid AND tenant_id = ${tenantId}::uuid AND stato = 'INCERTA'`
            : this.prisma.$executeRaw`
                UPDATE "trasmissioni_sdi"
                SET stato = 'DA_INVIARE',
                    prossimo_tentativo_il = ${new Date(ora.getTime() + attesaDopoTentativoMs(t.tentativi))}::timestamptz,
                    versione = versione + 1, updated_at = ${ora}::timestamptz
                WHERE id = ${t.id}::uuid AND tenant_id = ${tenantId}::uuid AND stato = 'INCERTA'`
        )
        n += spostate
      } catch (e) {
        // Provider non raggiungibile: la trasmissione resta INCERTA e si riprova al giro dopo.
        esito.errori++
        this.logger.warn(
          `Riconciliazione SDI della trasmissione ${t.id} non riuscita: ${
            e instanceof Error ? e.message : 'errore'
          }`
        )
      }
    }
    return n
  }

  private async chiudiIncertaEsaurita(
    tenantId: string,
    t: { id: string; nomeFile: string; documentoId: string; tentativi: number },
    ora: Date
  ): Promise<number> {
    const passati = await nelContestoTenant(tenantId, async () =>
      this.prisma.$transaction(async tx => {
        const a = await tx.$executeRaw`
          UPDATE "trasmissioni_sdi" SET stato = 'DA_INVIARE', versione = versione + 1,
                 updated_at = ${ora}::timestamptz
          WHERE id = ${t.id}::uuid AND tenant_id = ${tenantId}::uuid AND stato = 'INCERTA'`
        if (a === 0) return 0
        return tx.$executeRaw`
          UPDATE "trasmissioni_sdi" SET stato = 'IN_INVIO', versione = versione + 1,
                 updated_at = ${ora}::timestamptz
          WHERE id = ${t.id}::uuid AND tenant_id = ${tenantId}::uuid AND stato = 'DA_INVIARE'`
      }, OPZIONI_TRANSAZIONE_SCRITTURA)
    )
    if (passati === 0) return 0
    await this.chiudiInErrore(
      tenantId,
      { ...t, provider: '', ambiente: '', xmlSha256: '', haPrecedente: false },
      ora,
      'TENTATIVI_ESAURITI',
      'Invio incerto ripetuto: il provider non conferma la ricezione'
    )
    return 1
  }

  /** Prenota la prossima `DA_INVIARE` scaduta: il commit di `IN_INVIO` precede la chiamata al provider. */
  private async prenota(tenantId: string, ora: Date): Promise<TrasmissionePrenotata | null> {
    const righe = await nelContestoTenant(tenantId, async () =>
      this.prisma.$transaction(async tx => {
        await impostaTimeoutLock(tx)
        return tx.$queryRaw<TrasmissionePrenotata[]>`
          UPDATE "trasmissioni_sdi" AS t
          SET stato = 'IN_INVIO', tentativi = t.tentativi + 1, prossimo_tentativo_il = NULL,
              versione = t.versione + 1, updated_at = ${ora}::timestamptz
          WHERE t.id = (
            SELECT id FROM "trasmissioni_sdi"
            WHERE tenant_id = ${tenantId}::uuid AND stato = 'DA_INVIARE'
              AND (prossimo_tentativo_il IS NULL OR prossimo_tentativo_il <= ${ora}::timestamptz)
            ORDER BY created_at, id
            FOR UPDATE SKIP LOCKED
            LIMIT 1)
          AND t.tenant_id = ${tenantId}::uuid AND t.stato = 'DA_INVIARE'
          RETURNING t.id::text AS id, t.documento_id::text AS "documentoId", t.provider, t.ambiente,
                    t.nome_file AS "nomeFile", t.xml_sha256 AS "xmlSha256", t.tentativi::int AS tentativi,
                    EXISTS (SELECT 1 FROM "trasmissioni_sdi" p
                            WHERE p.tenant_id = t.tenant_id AND p.documento_id = t.documento_id
                              AND p.id <> t.id AND p.stato = 'ERRORE_INVIO') AS "haPrecedente"`
      }, OPZIONI_TRANSAZIONE_SCRITTURA)
    )
    return righe[0] ?? null
  }

  private async inviaUna(
    tenantId: string,
    t: TrasmissionePrenotata,
    ora: Date,
    provider: ProviderSdi,
    config: ConfigurazionePerInvio,
    esito: EsitoGiroSdi
  ): Promise<void> {
    if (t.provider !== config.provider || t.ambiente !== config.ambiente) {
      // La configurazione e' cambiata dopo l'accodamento: l'XML non parte verso un altro provider.
      await this.chiudiInErrore(tenantId, t, ora, 'CONFIGURAZIONE_CAMBIATA')
      esito.rifiutate++
      return
    }
    const xml = await this.leggiXml(tenantId, t)
    if (xml === null) {
      await this.chiudiInErrore(tenantId, t, ora, 'XML_ALTERATO')
      esito.rifiutate++
      return
    }

    // Dopo un ERRORE_INVIO precedente dello stesso documento il provider potrebbe aver ricevuto il
    // file: prima di inviare di nuovo si cerca per nome file.
    if (t.haPrecedente) {
      const trovato = await provider.cerca(config.contesto, {
        chiaveIdempotenza: t.id,
        nomeFile: t.nomeFile,
      })
      if (trovato) {
        await this.scriviAccettato(tenantId, t, ora, trovato.idProvider, trovato.idSdi, null)
        esito.inviate++
        return
      }
    }

    let esitoInvio: EsitoInvio
    try {
      esitoInvio = await provider.invia(config.contesto, {
        nomeFile: t.nomeFile,
        xml,
        firma: config.firmaDalProvider,
        chiaveIdempotenza: t.id,
      })
    } catch {
      // Eccezione dell'adattatore: non si sa se il file e' partito. Mai assumere «non inviato».
      esitoInvio = { tipo: 'INCERTO' }
    }

    switch (esitoInvio.tipo) {
      case 'ACCETTATO':
        await this.scriviAccettato(
          tenantId,
          t,
          ora,
          esitoInvio.idProvider,
          esitoInvio.idSdi,
          esitoInvio.fileFirmato
        )
        esito.inviate++
        return
      case 'RIFIUTATO':
        await this.chiudiInErrore(tenantId, t, ora, esitoInvio.codice, esitoInvio.messaggio)
        esito.rifiutate++
        return
      case 'TRANSITORIO':
        if (t.tentativi >= MAX_TENTATIVI_INVIO_SDI) {
          await this.chiudiInErrore(
            tenantId,
            t,
            ora,
            'TENTATIVI_ESAURITI',
            `Ultimo errore del provider: ${esitoInvio.codice}`
          )
          esito.rifiutate++
          return
        }
        await nelContestoTenant(
          tenantId,
          async () =>
            this.prisma.$executeRaw`
            UPDATE "trasmissioni_sdi"
            SET stato = 'DA_INVIARE',
                prossimo_tentativo_il = ${new Date(
                  ora.getTime() + attesaDopoTentativoMs(t.tentativi, esitoInvio.ritentaDopoMs)
                )}::timestamptz,
                ultimo_errore_codice = ${esitoInvio.codice.slice(0, 50)},
                versione = versione + 1, updated_at = ${ora}::timestamptz
            WHERE id = ${t.id}::uuid AND tenant_id = ${tenantId}::uuid AND stato = 'IN_INVIO'`
        )
        esito.ritentate++
        return
      case 'INCERTO':
        await nelContestoTenant(
          tenantId,
          async () =>
            this.prisma.$executeRaw`
            UPDATE "trasmissioni_sdi"
            SET stato = 'INCERTA', versione = versione + 1, updated_at = ${ora}::timestamptz
            WHERE id = ${t.id}::uuid AND tenant_id = ${tenantId}::uuid AND stato = 'IN_INVIO'`
        )
        esito.incerte++
        return
    }
  }

  /** L'XML del documento, se esiste e ha ancora l'impronta copiata nella trasmissione. */
  private async leggiXml(tenantId: string, t: TrasmissionePrenotata): Promise<Buffer | null> {
    const righe = await nelContestoTenant(
      tenantId,
      async () =>
        this.prisma.$queryRaw<{ xml: Uint8Array | null }[]>`
        SELECT xml FROM "documenti_fattura"
        WHERE id = ${t.documentoId}::uuid AND tenant_id = ${tenantId}::uuid`
    )
    const xml = righe[0]?.xml
    if (!xml || sha256(xml) !== t.xmlSha256) return null
    return Buffer.from(xml)
  }

  private async scriviAccettato(
    tenantId: string,
    t: TrasmissionePrenotata,
    ora: Date,
    idProvider: string,
    idSdi: string | null,
    fileFirmato: Buffer | null
  ): Promise<void> {
    const firmatoSha = fileFirmato ? sha256(fileFirmato) : null
    // Da `IN_INVIO` (invio normale) o da `INCERTA`/`DA_INVIARE` non si passa di qui: solo IN_INVIO.
    await nelContestoTenant(
      tenantId,
      async () =>
        this.prisma.$executeRaw`
        UPDATE "trasmissioni_sdi"
        SET stato = 'INVIATA', id_provider = ${idProvider}, id_sdi = ${idSdi}::text,
            file_firmato = ${fileFirmato}::bytea, file_firmato_sha256 = ${firmatoSha}::text,
            inviata_il = ${ora}::timestamptz, prossimo_tentativo_il = NULL,
            ultimo_errore_codice = NULL, ultimo_errore_messaggio = NULL,
            versione = versione + 1, updated_at = ${ora}::timestamptz
        WHERE id = ${t.id}::uuid AND tenant_id = ${tenantId}::uuid AND stato = 'IN_INVIO'`
    )
  }

  private async chiudiInErrore(
    tenantId: string,
    t: TrasmissionePrenotata,
    ora: Date,
    codice: string,
    messaggio?: string
  ): Promise<void> {
    const spostate = await nelContestoTenant(
      tenantId,
      async () =>
        this.prisma.$executeRaw`
        UPDATE "trasmissioni_sdi"
        SET stato = 'ERRORE_INVIO', ultimo_errore_codice = ${codice.slice(0, 50)},
            ultimo_errore_messaggio = ${messaggio === undefined ? null : messaggio.slice(0, 500)}::text,
            prossimo_tentativo_il = NULL, chiusa_il = ${ora}::timestamptz,
            versione = versione + 1, updated_at = ${ora}::timestamptz
        WHERE id = ${t.id}::uuid AND tenant_id = ${tenantId}::uuid AND stato = 'IN_INVIO'`
    )
    if (spostate > 0) await this.avvisaAdmin(tenantId, t, codice)
  }

  /** Avviso in-app agli ADMIN dell'azienda: l'invio e' fallito per sempre e serve una persona. */
  private async avvisaAdmin(
    tenantId: string,
    t: TrasmissionePrenotata,
    codice: string
  ): Promise<void> {
    try {
      await nelContestoTenant(tenantId, async () => {
        const admin = await this.prisma.user.findMany({
          where: { tenantId, role: { in: ['ADMIN', 'SUPER_ADMIN'] } },
          select: { id: true },
        })
        if (admin.length === 0) return
        await this.prisma.notification.createMany({
          data: admin.map(u => ({
            tenantId,
            userId: u.id,
            type: 'SYSTEM_ERROR' as const,
            title: TITOLO_AVVISO_SDI_ERRORE_INVIO,
            message: `La fattura (file ${t.nomeFile}) non è stata inviata allo SDI (codice ${codice}). Controlla il documento e riprova l'invio.`,
            severity: 'ERROR' as const,
            relatedEntityId: t.documentoId,
            relatedEntityType: 'DocumentoFattura',
            actionUrl: '/fatturazione/documenti',
            isRead: false,
          })),
        })
      })
    } catch (e) {
      // Mai far fallire l'elaborazione per un avviso.
      this.logger.warn(
        `Avviso SDI non creato per la trasmissione ${t.id}: ${e instanceof Error ? e.message : 'errore'}`
      )
    }
  }
}
