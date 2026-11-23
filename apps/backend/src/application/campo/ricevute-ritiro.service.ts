/**
 * Ricevute di ritiro con firma su schermo (app campo, P6).
 *
 * Il telefono invia nome, ora e immagine della firma; il SERVER legge i dati del ritiro dal database,
 * genera il PDF, ne calcola le impronte SHA-256 e archivia tutto in una riga append-only. Il PDF non
 * si rigenera mai: l'ufficio scarica i byte archiviati (e il download ne riverifica l'impronta).
 *
 * Idempotenza: `(azienda, ricevuta_uuid)` e' unico e un lock sull'uuid serializza i reinvii: lo
 * stesso uuid risponde sempre con la stessa riga, senza rigenerare ne' rinviare l'email.
 *
 * Invio al cliente: FACOLTATIVO e SPENTO per default (variabile `CAMPO_RICEVUTE_INVIO_EMAIL=true` per
 * accenderlo; nessuna altra configurazione nuova, usa `EmailService` e le sue variabili SMTP gia'
 * esistenti). Parte DOPO il commit della ricevuta: un guasto della posta non fa perdere la firma.
 * L'indirizzo del cliente non si conserva (solo la forma mascherata) e non finisce nei log.
 */
import { createHash } from 'crypto'
import { Injectable, Logger } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { EmailService } from '../../infrastructure/email/email.service'
import { PrismaService } from '../../infrastructure/persistence/prisma.service'
import { RitiriRepository, type Tx } from '../../infrastructure/persistence/ritiri.repository'
import { nelContestoTenant } from '../pese/nel-contesto-tenant'
import { RitiroDatiNonValidiError, RitiroNonTrovatoError } from '../ritiri/errori-ritiri'
import {
  AutistaNonCollegatoError,
  RicevutaAlterataError,
  RicevutaDiAltroUtenteError,
  RicevutaLimiteRitiroError,
  RicevutaNonTrovataError,
  RicevutaTroppoGrandeError,
} from './errori-campo'
import {
  calcolaContenutoSha256,
  generaPdfRicevuta,
  type DatiRicevuta,
  type IngressoRicevuta,
} from './ricevuta-pdf'
import {
  mascheraEmail,
  normalizzaRicevutaCampo,
  type RicevutaCampoValori,
} from './ricevute-ritiro.input'

/** Nome della variabile che accende l'invio al cliente (assente = spento). */
export const VARIABILE_INVIO_EMAIL_RICEVUTE = 'CAMPO_RICEVUTE_INVIO_EMAIL'
export const RICEVUTE_MASSIME_PER_RITIRO = 5
/** Stesso tetto del CHECK `ricevute_ritiro_pdf_dimensione`: lo si controlla PRIMA dell'INSERT. */
export const LIMITE_PDF_BYTE = 1_048_576

export type EsitoRicevuta = 'REGISTRATA' | 'DA_RICONCILIARE'
export type MotivoConflittoRicevuta =
  | 'RITIRO_RIASSEGNATO'
  | 'RITIRO_ANNULLATO'
  | 'RITIRO_NON_ESEGUITO'
  | 'RITIRO_STATO_CAMBIATO'

export type StatoInvioRicevuta = 'NON_RICHIESTO' | 'NON_ABILITATO' | 'INVIATO' | 'FALLITO'

/** Risposta al telefono: sempre la stessa per lo stesso uuid (salvo l'esito dell'invio, vedi sotto). */
export interface RispostaRicevutaCampo {
  id: string
  ricevutoIl: string
  pdfSha256: string
  contenutoSha256: string
  invio: StatoInvioRicevuta
  /** `DA_RICONCILIARE`: archiviata, ma il ritiro non era piu' dell'autista o da fare. */
  esito: EsitoRicevuta
}

export interface RicevutaVista {
  id: string
  ritiroId: string
  dataRitiro: string
  cliente: string
  cerCode: string
  descrizione: string
  firmatarioNome: string
  firmatoIl: string
  ricevutoIl: string
  autista: string
  dimensionePdf: number
  pdfSha256: string
  contenutoSha256: string
  esito: EsitoRicevuta
  motivoConflitto: MotivoConflittoRicevuta | null
  invio: { esito: 'INVIATO' | 'FALLITO'; destinatario: string } | null
}

export interface ElencoRicevute {
  righe: RicevutaVista[]
  totale: number
}

export interface PdfRicevuta {
  nomeFile: string
  contenuto: Buffer
}

const logger = new Logger('RicevuteRitiro')

const DIMENSIONE_PREDEFINITA = 50
const DIMENSIONE_MASSIMA = 200

const sha256 = (b: Buffer): string => createHash('sha256').update(b).digest('hex')

const eViolazioneUnicita = (err: unknown) =>
  err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'

/** `true` solo se la variabile vale esattamente `true`: nessun valore = spento. */
export function invioEmailRicevuteAbilitato(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[VARIABILE_INVIO_EMAIL_RICEVUTE] === 'true'
}

interface RigaRicevuta {
  id: string
  ritiro_id: string
  data_ritiro: string
  cliente: string
  cer_code: string
  descrizione: string
  firmatario_nome: string
  firmato_il: Date
  ricevuto_il: Date
  autista: string
  dimensione_pdf: number
  pdf_sha256: string
  contenuto_sha256: string
  esito: EsitoRicevuta
  motivo_conflitto: MotivoConflittoRicevuta | null
  invio_esito: 'INVIATO' | 'FALLITO' | null
  invio_destinatario: string | null
  totale: number
}

@Injectable()
export class RicevuteRitiroService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repo: RitiriRepository,
    private readonly email: EmailService
  ) {}

  /** L'app mostra il campo email solo se l'invio e' acceso e il servizio posta spedisce davvero. */
  configurazione(): { invioEmail: boolean } {
    return { invioEmail: this.invioPossibile() }
  }

  private invioPossibile(): boolean {
    return invioEmailRicevuteAbilitato() && !this.email.modalitaSviluppo
  }

  async registra(
    tenantId: string,
    utenteId: string,
    grezzo: Parameters<typeof normalizzaRicevutaCampo>[0]
  ): Promise<RispostaRicevutaCampo> {
    const n = normalizzaRicevutaCampo(grezzo)
    if (!n.ok) throw new RitiroDatiNonValidiError(n.messaggi)
    const ric = n.valori
    const risultato = await nelContestoTenant(tenantId, async () => {
      try {
        return await this.prisma.$transaction(tx =>
          this.registraInTransazione(tx, tenantId, utenteId, ric)
        )
      } catch (err) {
        // Nessuna corsa dovrebbe arrivare qui (lock sull'uuid); se capita l'altra transazione ha
        // gia' scritto: si risponde con la sua riga.
        if (eViolazioneUnicita(err)) {
          const esistente = await this.prisma.$transaction(tx =>
            this.leggiEsistente(tx, tenantId, utenteId, ric.id)
          )
          if (esistente) return { risposta: esistente, nuova: null }
        }
        throw err
      }
    })
    if (risultato.nuova === null) return risultato.risposta
    // Nessuna email per una ricevuta da riconciliare: il ritiro non e' (piu') quello dell'autista.
    if (ric.emailCliente === null || risultato.risposta.esito === 'DA_RICONCILIARE') {
      return risultato.risposta
    }
    if (!this.invioPossibile()) return { ...risultato.risposta, invio: 'NON_ABILITATO' }
    const invio = await this.inviaAlCliente(tenantId, ric.emailCliente, risultato.nuova)
    return { ...risultato.risposta, invio }
  }

  private async registraInTransazione(
    tx: Tx,
    tenantId: string,
    utenteId: string,
    ric: RicevutaCampoValori
  ): Promise<{ risposta: RispostaRicevutaCampo; nuova: NuovaRicevuta | null }> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`ricevute_ritiro:${tenantId}:${ric.id}`}, 0))`
    const esistente = await this.leggiEsistente(tx, tenantId, utenteId, ric.id)
    if (esistente) return { risposta: esistente, nuova: null }

    const autista = await tx.autista.findFirst({
      where: { tenantId, userId: utenteId, attivo: true },
      select: { id: true, nome: true, cognome: true },
    })
    if (!autista) throw new AutistaNonCollegatoError()

    const bloccato = await this.repo.bloccaPerId(tx, tenantId, ric.ritiroId)
    if (!bloccato) throw new RitiroNonTrovatoError()
    const vista = await this.repo.leggi(tx, tenantId, ric.ritiroId, { dettaglio: false })
    if (!vista) throw new RitiroNonTrovatoError()
    // Il telefono era offline: il ritiro puo' essere stato riassegnato, annullato o chiuso nel
    // frattempo. La firma di un ritiro avvenuto davvero non si perde: si archivia «da riconciliare»
    // col motivo (stessa logica degli esiti P4). Un altro tenant non arriva qui (404 sopra).
    const motivoConflitto = motivoDaRiconciliare(
      vista.autista?.id ?? null,
      autista.id,
      bloccato.stato
    )
    const gia = await tx.ricevutaRitiro.count({ where: { tenantId, ritiroId: ric.ritiroId } })
    if (gia >= RICEVUTE_MASSIME_PER_RITIRO) {
      throw new RicevutaLimiteRitiroError(RICEVUTE_MASSIME_PER_RITIRO)
    }

    const tenant = await tx.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: { ragioneSociale: true },
    })
    const dati: DatiRicevuta = {
      versione: 1,
      azienda: tenant.ragioneSociale,
      trasportatore: vista.trasportatore.nome,
      // Chi ha firmato davvero (non chi e' oggi sul ritiro, se e' stato riassegnato).
      autista: `${autista.cognome} ${autista.nome}`,
      targa: vista.automezzo?.targa ?? null,
      dataRitiro: vista.dataPrevista,
      cliente: vista.produttore.nome,
      indirizzoCliente: vista.produttore.indirizzo,
      cerCode: vista.cerCode,
      descrizione: vista.descrizione,
      quantitaPresunta: vista.quantitaPresunta,
      unita: vista.unita,
    }
    const ricevutoIl = new Date()
    const firmaSha256 = sha256(ric.firmaPng)
    const ingresso: IngressoRicevuta = {
      ricevutaUuid: ric.id,
      ritiroId: ric.ritiroId,
      dati,
      firmatarioNome: ric.firmatarioNome,
      firmatoIl: ric.firmatoIl,
      ricevutoIl,
      firmaPng: ric.firmaPng,
      firmaSha256,
    }
    const contenutoSha256 = calcolaContenutoSha256(ingresso)
    const pdf = await generaPdfRicevuta(ingresso, contenutoSha256)
    // Il CHECK del database rifiuterebbe l'INSERT con un 500 che il telefono ritenterebbe all'infinito.
    if (pdf.length > LIMITE_PDF_BYTE) throw new RicevutaTroppoGrandeError()
    const pdfSha256 = sha256(pdf)

    const riga = await tx.ricevutaRitiro.create({
      data: {
        tenantId,
        ricevutaUuid: ric.id,
        ritiroId: ric.ritiroId,
        autistaId: autista.id,
        utenteId,
        firmatarioNome: ric.firmatarioNome,
        firmatoIl: ric.firmatoIl,
        ricevutoIl,
        dati: dati as unknown as Prisma.InputJsonObject,
        firmaPng: ric.firmaPng,
        firmaSha256,
        contenutoSha256,
        pdf,
        pdfSha256,
        esito: motivoConflitto ? 'DA_RICONCILIARE' : 'REGISTRATA',
        motivoConflitto,
      },
      select: { id: true },
    })
    return {
      risposta: {
        id: ric.id,
        ricevutoIl: ricevutoIl.toISOString(),
        pdfSha256,
        contenutoSha256,
        invio: 'NON_RICHIESTO',
        esito: motivoConflitto ? 'DA_RICONCILIARE' : 'REGISTRATA',
      },
      nuova: { ricevutaId: riga.id, dataRitiro: dati.dataRitiro, pdf },
    }
  }

  private async leggiEsistente(
    tx: Tx,
    tenantId: string,
    utenteId: string,
    ricevutaUuid: string
  ): Promise<RispostaRicevutaCampo | null> {
    const riga = await tx.ricevutaRitiro.findUnique({
      where: { tenantId_ricevutaUuid: { tenantId, ricevutaUuid } },
      select: {
        utenteId: true,
        ricevutoIl: true,
        pdfSha256: true,
        contenutoSha256: true,
        esito: true,
        invio: { select: { esito: true } },
      },
    })
    if (!riga) return null
    if (riga.utenteId !== utenteId) throw new RicevutaDiAltroUtenteError()
    return {
      id: ricevutaUuid,
      ricevutoIl: riga.ricevutoIl.toISOString(),
      pdfSha256: riga.pdfSha256,
      contenutoSha256: riga.contenutoSha256,
      invio: riga.invio ? (riga.invio.esito as 'INVIATO' | 'FALLITO') : 'NON_RICHIESTO',
      esito: riga.esito as EsitoRicevuta,
    }
  }

  /** Spedisce il PDF e ne registra l'esito. Non lancia mai: la ricevuta e' gia' archiviata. */
  private async inviaAlCliente(
    tenantId: string,
    destinatario: string,
    nuova: NuovaRicevuta
  ): Promise<StatoInvioRicevuta> {
    let esito: 'INVIATO' | 'FALLITO' = 'INVIATO'
    try {
      await this.email.sendEmail({
        to: destinatario,
        subject: 'Ricevuta di ritiro rifiuti',
        text: 'In allegato la ricevuta di ritiro. La ricevuta non sostituisce il FIR.',
        html: '<p>In allegato la ricevuta di ritiro.</p><p>La ricevuta <strong>non sostituisce il FIR</strong>.</p>',
        attachments: [
          {
            filename: `ricevuta-ritiro-${nuova.dataRitiro}.pdf`,
            content: nuova.pdf,
            contentType: 'application/pdf',
          },
        ],
        senzaDatiNeiLog: true,
      })
    } catch {
      esito = 'FALLITO'
    }
    try {
      await nelContestoTenant(tenantId, () =>
        this.prisma.$transaction(tx =>
          tx.invioRicevutaRitiro.create({
            data: {
              tenantId,
              ricevutaId: nuova.ricevutaId,
              esito,
              destinatarioMascherato: mascheraEmail(destinatario),
            },
          })
        )
      )
    } catch {
      /* l'esito non si e' potuto scrivere: la ricevuta resta valida, il telefono vede comunque l'esito */
    }
    return esito
  }

  /** Ricevute per l'ufficio: dalla piu' recente, senza byte (ne' PDF ne' firma). */
  async elenca(
    tenantId: string,
    filtri: { ritiroId?: string; pagina?: number; dimensione?: number }
  ): Promise<ElencoRicevute> {
    const dimensione = Math.min(
      Math.max(Math.trunc(filtri.dimensione ?? DIMENSIONE_PREDEFINITA), 1),
      DIMENSIONE_MASSIMA
    )
    const pagina = Math.max(Math.trunc(filtri.pagina ?? 1), 1)
    const perRitiro = filtri.ritiroId
      ? Prisma.sql`AND rr.ritiro_id = ${filtri.ritiroId}::uuid`
      : Prisma.empty
    return nelContestoTenant(tenantId, () =>
      this.prisma.$transaction(async tx => {
        const righe = await tx.$queryRaw<RigaRicevuta[]>(Prisma.sql`
          SELECT rr.id::text AS id, rr.ritiro_id::text AS ritiro_id,
                 rr.dati->>'dataRitiro' AS data_ritiro, rr.dati->>'cliente' AS cliente,
                 rr.dati->>'cerCode' AS cer_code, rr.dati->>'descrizione' AS descrizione,
                 rr.firmatario_nome, rr.firmato_il, rr.ricevuto_il,
                 (au.cognome || ' ' || au.nome) AS autista,
                 octet_length(rr.pdf)::int AS dimensione_pdf, rr.pdf_sha256, rr.contenuto_sha256,
                 rr.esito, rr.motivo_conflitto,
                 iv.esito AS invio_esito, iv.destinatario_mascherato AS invio_destinatario,
                 count(*) OVER ()::int AS totale
          FROM ricevute_ritiro rr
          JOIN autisti au ON au.id = rr.autista_id AND au.tenant_id = rr.tenant_id
          LEFT JOIN invii_ricevuta_ritiro iv
            ON iv.ricevuta_id = rr.id AND iv.tenant_id = rr.tenant_id
          WHERE rr.tenant_id = ${tenantId}::uuid ${perRitiro}
          ORDER BY rr.ricevuto_il DESC, rr.id DESC
          LIMIT ${dimensione} OFFSET ${(pagina - 1) * dimensione}`)
        return {
          totale: righe[0]?.totale ?? 0,
          righe: righe.map(r => ({
            id: r.id,
            ritiroId: r.ritiro_id,
            dataRitiro: r.data_ritiro,
            cliente: r.cliente,
            cerCode: r.cer_code,
            descrizione: r.descrizione,
            firmatarioNome: r.firmatario_nome,
            firmatoIl: r.firmato_il.toISOString(),
            ricevutoIl: r.ricevuto_il.toISOString(),
            autista: r.autista,
            dimensionePdf: r.dimensione_pdf,
            pdfSha256: r.pdf_sha256,
            contenutoSha256: r.contenuto_sha256,
            esito: r.esito,
            motivoConflitto: r.motivo_conflitto,
            invio:
              r.invio_esito && r.invio_destinatario
                ? { esito: r.invio_esito, destinatario: r.invio_destinatario }
                : null,
          })),
        }
      })
    )
  }

  /**
   * Byte del PDF archiviato. L'impronta si ricalcola a ogni lettura: se non coincide con quella
   * salvata alla firma il file e' stato alterato o danneggiato e NON si consegna.
   */
  async leggiPdf(tenantId: string, id: string): Promise<PdfRicevuta> {
    const riga = await nelContestoTenant(tenantId, () =>
      this.prisma.$transaction(tx =>
        tx.ricevutaRitiro.findFirst({
          where: { id, tenantId },
          select: { pdf: true, pdfSha256: true, dati: true },
        })
      )
    )
    if (!riga) throw new RicevutaNonTrovataError()
    const contenuto = Buffer.from(riga.pdf)
    if (sha256(contenuto) !== riga.pdfSha256) {
      // Evento di integrita' da indagare: allarme nel log (solo l'id, mai byte ne' dati personali).
      logger.error(
        `RICEVUTA_ALTERATA: impronta del PDF non corrispondente (ricevuta ${id}, azienda ${tenantId})`
      )
      throw new RicevutaAlterataError()
    }
    const data = (riga.dati as { dataRitiro?: string } | null)?.dataRitiro ?? 'senza-data'
    return { nomeFile: `ricevuta-ritiro-${data.replace(/[^0-9-]/g, '')}.pdf`, contenuto }
  }
}

/** `null` = ritiro dell'autista e da fare (ricevuta regolare); altrimenti il motivo del conflitto. */
function motivoDaRiconciliare(
  autistaDelRitiro: string | null,
  autistaFirmatario: string,
  stato: string
): MotivoConflittoRicevuta | null {
  if (autistaDelRitiro !== autistaFirmatario) return 'RITIRO_RIASSEGNATO'
  if (stato === 'PROGRAMMATO') return null
  if (stato === 'ANNULLATO') return 'RITIRO_ANNULLATO'
  if (stato === 'NON_ESEGUITO') return 'RITIRO_NON_ESEGUITO'
  return 'RITIRO_STATO_CAMBIATO'
}

interface NuovaRicevuta {
  ricevutaId: string
  dataRitiro: string
  pdf: Buffer
}
