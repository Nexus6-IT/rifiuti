// Accodamento dell'invio allo SDI (4.5b, piano §4.4). Non invia nulla: scrive una `trasmissioni_sdi`
// in `DA_INVIARE` per ogni documento ammesso; l'invio vero lo fa il job (`SdiInvioJob`).
//
// Per ogni documento ammesso: `XmlDocumentoService.xml(confermaEmissione = true)` (scrive `emesso_il`
// una volta sola e valida contro l'XSD; se l'XML c'e' gia' restituisce gli stessi byte), poi INSERT
// della trasmissione con `nome_file` e `xml_sha256`. L'indice unico parziale `trasmissioni_sdi_una_viva`
// e' il presidio contro il doppio invio: due richieste parallele sullo stesso documento producono UNA
// trasmissione, l'altra torna fra le saltate `TRASMISSIONE_IN_CORSO`.
//
// Condizioni che valgono per tutta la richiesta (409, nulla scritto): configurazione assente o non
// verificata, `invio_attivo` spento, provider non disponibile, interruttore globale `SDI_INVII_ATTIVI`
// spento. Condizioni per documento (saltati col motivo, nel 202): vedi `MotivoSaltoSdi`.
import { randomUUID } from 'node:crypto'
import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnprocessableEntityException,
} from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { avvisiInvio } from '../../domain/fatturazione/sdi/avvisi'
import type { AvvisoTrasmissioneSdi } from '../../domain/fatturazione/sdi/codici'
import { giornoItaliano } from '../../core/time/anno-italiano'
import { PrismaService } from '../../infrastructure/persistence/prisma.service'
import { XmlDocumentoService } from '../fatturazione/xml-documento.service'
import { TETTO_DOCUMENTI_XML_ZIP } from '../fatturazione/xml-documento.service'
import {
  ProviderSdiNonDisponibileError,
  RegistroProviderSdi,
} from '../fatturazione/sdi/registro-provider-sdi'
import { impostaTimeoutLock, OPZIONI_TRANSAZIONE_SCRITTURA } from '../listino/lock-listino'
import { nelContestoTenant } from '../pese/nel-contesto-tenant'
import { ConfigurazioneSdiService, type ConfigurazionePerInvio } from './configurazione-sdi.service'
import { inviiSdiAttivi } from './invii-sdi-attivi'

/** Tetto di documenti per richiesta (stesso dello zip XML). */
export const TETTO_DOCUMENTI_INVIO_SDI = TETTO_DOCUMENTI_XML_ZIP

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Perche' un documento non e' stato accodato. */
export const MOTIVI_SALTO_SDI = [
  'NON_TROVATO',
  'NON_DEFINITIVO',
  'TRASMISSIONE_IN_CORSO',
  'FIRMA_NON_DISPONIBILE',
  'DATA_FUTURA',
  'GIA_EMESSO',
  'XML_NON_VALIDO',
] as const
export type MotivoSaltoSdi = (typeof MOTIVI_SALTO_SDI)[number]

export interface EsitoAccodamento {
  accodate: { documentoId: string; trasmissioneId: string; avvisi: AvvisoTrasmissioneSdi[] }[]
  saltate: { documentoId: string; motivo: MotivoSaltoSdi }[]
}

interface DocumentoPerInvio {
  id: string
  stato: 'BOZZA' | 'DEFINITIVO' | 'ANNULLATO'
  tipoDocumento: string
  formato: string
  dataDocumento: string
  emessoIl: Date | null
  viva: boolean
}

const MSG_NON_PRONTO: Record<string, string> = {
  SDI_NON_CONFIGURATO: 'L’azienda non ha una configurazione SDI verificata.',
  INVIO_SDI_NON_ATTIVO: 'L’invio allo SDI non è attivo per questa azienda.',
  INVII_SDI_SOSPESI: 'Gli invii allo SDI sono sospesi dal server.',
}
const conflitto = (codice: string) =>
  new ConflictException({ error: codice, message: MSG_NON_PRONTO[codice] ?? codice })

@Injectable()
export class InvioSdiService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configurazione: ConfigurazioneSdiService,
    private readonly registro: RegistroProviderSdi,
    private readonly xml: XmlDocumentoService
  ) {}

  /** Orologio sostituibile nei test. */
  orologio: () => Date = () => new Date()

  /**
   * Accoda i documenti indicati. `confermaGiaEmesso`: l'utente sa che il documento e' gia' stato
   * emesso (XML scaricato o «segna come emesso») e accetta che lo SDI lo scarti come duplicato se
   * l'ha gia' ricevuto da un altro canale.
   */
  async accoda(
    tenantId: string,
    utenteId: string,
    dati: { ids: readonly string[]; confermaGiaEmesso?: boolean }
  ): Promise<EsitoAccodamento> {
    const ids = [...new Set(dati.ids)]
    if (ids.length === 0) {
      throw new BadRequestException({
        error: 'NESSUN_DOCUMENTO',
        message: 'Seleziona almeno un documento.',
      })
    }
    if (ids.length > TETTO_DOCUMENTI_INVIO_SDI) {
      throw new BadRequestException({
        error: 'TROPPI_DOCUMENTI',
        message: `Al massimo ${TETTO_DOCUMENTI_INVIO_SDI} documenti per volta.`,
      })
    }
    if (ids.some(id => !UUID.test(id))) {
      throw new BadRequestException({
        error: 'IDENTIFICATIVO_NON_VALIDO',
        message: 'Un identificativo non è valido.',
      })
    }
    const config = await this.configurazionePronta(tenantId)
    const oggi = giornoItaliano(this.orologio())
    const gia = dati.confermaGiaEmesso === true

    const risultato: EsitoAccodamento = { accodate: [], saltate: [] }
    const letti = await this.leggiDocumenti(tenantId, ids)
    for (const id of ids) {
      const d = letti.get(id)
      const motivo = d ? this.motivoSalto(d, config, oggi, gia) : 'NON_TROVATO'
      if (motivo !== null) {
        risultato.saltate.push({ documentoId: id, motivo })
        continue
      }
      const esito = await this.accodaUno(
        tenantId,
        utenteId,
        id,
        config,
        d as DocumentoPerInvio,
        oggi
      )
      if ('motivo' in esito) risultato.saltate.push({ documentoId: id, motivo: esito.motivo })
      else risultato.accodate.push({ documentoId: id, ...esito })
    }
    return risultato
  }

  /**
   * Nuova trasmissione per un documento la cui ultima e' finita in `ERRORE_INVIO`. L'XML e' quello
   * gia' salvato (stessi byte, stesso nome file). 409 `RIPROVA_NON_AMMESSA` se non c'e' una
   * trasmissione in errore o ne esiste una viva.
   */
  async riprova(
    tenantId: string,
    utenteId: string,
    documentoId: string
  ): Promise<EsitoAccodamento['accodate'][number]> {
    if (!UUID.test(documentoId)) {
      throw new BadRequestException({
        error: 'IDENTIFICATIVO_NON_VALIDO',
        message: 'Un identificativo non è valido.',
      })
    }
    const config = await this.configurazionePronta(tenantId)
    const oggi = giornoItaliano(this.orologio())
    const letti = await this.leggiDocumenti(tenantId, [documentoId])
    const d = letti.get(documentoId)
    if (!d) {
      throw new BadRequestException({ error: 'NON_TROVATO', message: 'Documento non trovato.' })
    }
    const inErrore = await nelContestoTenant(
      tenantId,
      async () =>
        this.prisma.$queryRaw<{ n: number }[]>`
        SELECT count(*)::int AS n FROM "trasmissioni_sdi"
        WHERE tenant_id = ${tenantId}::uuid AND documento_id = ${documentoId}::uuid
          AND stato = 'ERRORE_INVIO'`
    )
    if (d.viva || inErrore[0].n === 0) {
      throw new ConflictException({
        error: 'RIPROVA_NON_AMMESSA',
        message: 'Si può riprovare solo un invio finito in errore e senza altre trasmissioni.',
      })
    }
    // Il documento e' gia' emesso (la trasmissione precedente lo ha emesso): niente conferma.
    const motivo = this.motivoSalto(d, config, oggi, true)
    if (motivo !== null) {
      throw new ConflictException({
        error: motivo,
        message: 'Il documento non può essere inviato allo SDI.',
      })
    }
    const esito = await this.accodaUno(tenantId, utenteId, documentoId, config, d, oggi)
    if ('motivo' in esito) {
      throw new ConflictException({
        error: esito.motivo,
        message: 'Il documento non può essere inviato allo SDI.',
      })
    }
    return { documentoId, ...esito }
  }

  // ---------------------------------------------------------------------------------------------

  private async configurazionePronta(tenantId: string): Promise<ConfigurazionePerInvio> {
    const config = await this.configurazione.leggiPerInvio(tenantId)
    if (!config || !config.verificata) throw conflitto('SDI_NON_CONFIGURATO')
    if (!config.invioAttivo) throw conflitto('INVIO_SDI_NON_ATTIVO')
    if (!inviiSdiAttivi()) throw conflitto('INVII_SDI_SOSPESI')
    try {
      this.registro.trova(config.provider)
    } catch (e) {
      if (e instanceof ProviderSdiNonDisponibileError) {
        throw new BadRequestException({ error: 'PROVIDER_NON_DISPONIBILE', message: e.message })
      }
      throw e
    }
    return config
  }

  private motivoSalto(
    d: DocumentoPerInvio,
    config: ConfigurazionePerInvio,
    oggi: string,
    confermaGiaEmesso: boolean
  ): MotivoSaltoSdi | null {
    if (d.stato !== 'DEFINITIVO') return 'NON_DEFINITIVO'
    if (d.viva) return 'TRASMISSIONE_IN_CORSO'
    // FPA12 (PA) esclusa al primo rilascio: senza firma del provider lo SDI scarterebbe il file.
    if (d.formato === 'FPA12' && !config.firmaDalProvider) return 'FIRMA_NON_DISPONIBILE'
    if (d.dataDocumento > oggi) return 'DATA_FUTURA'
    if (d.emessoIl !== null && !confermaGiaEmesso) return 'GIA_EMESSO'
    return null
  }

  private async leggiDocumenti(
    tenantId: string,
    ids: readonly string[]
  ): Promise<Map<string, DocumentoPerInvio>> {
    const righe = await nelContestoTenant(
      tenantId,
      async () =>
        this.prisma.$queryRaw<
          {
            id: string
            stato: DocumentoPerInvio['stato']
            tipoDocumento: string
            formato: string
            dataDocumento: string
            emessoIl: Date | null
            viva: boolean
          }[]
        >`
        SELECT d.id::text AS id, d.stato::text AS stato, d.tipo_documento AS "tipoDocumento",
               d.formato_trasmissione AS formato, d.data_documento::text AS "dataDocumento",
               d.emesso_il AS "emessoIl",
               EXISTS (SELECT 1 FROM "trasmissioni_sdi" t
                       WHERE t.tenant_id = d.tenant_id AND t.documento_id = d.id
                         AND t.stato NOT IN ('ERRORE_INVIO', 'SCARTATA')) AS viva
        FROM "documenti_fattura" d
        WHERE d.tenant_id = ${tenantId}::uuid AND d.id = ANY(${[...ids]}::uuid[])`
    )
    return new Map(righe.map(r => [r.id, r]))
  }

  private async accodaUno(
    tenantId: string,
    utenteId: string,
    documentoId: string,
    config: ConfigurazionePerInvio,
    d: DocumentoPerInvio,
    oggi: string
  ): Promise<
    { trasmissioneId: string; avvisi: AvvisoTrasmissioneSdi[] } | { motivo: MotivoSaltoSdi }
  > {
    let file
    try {
      file = await this.xml.xml(tenantId, utenteId, documentoId, { confermaEmissione: true })
    } catch (e) {
      if (e instanceof UnprocessableEntityException) return { motivo: 'XML_NON_VALIDO' }
      // Il documento e' cambiato stato nel frattempo (annullato): non e' piu' inviabile.
      if (e instanceof ConflictException) return { motivo: 'NON_DEFINITIVO' }
      throw e
    }
    const trasmissioneId = randomUUID()
    const avvisi = avvisiInvio({
      tipoDocumento: d.tipoDocumento,
      dataDocumento: d.dataDocumento,
      dataInvio: oggi,
    })
    try {
      await nelContestoTenant(tenantId, async () =>
        this.prisma.$transaction(async tx => {
          await impostaTimeoutLock(tx)
          await tx.trasmissioneSdi.create({
            data: {
              id: trasmissioneId,
              tenantId,
              documentoId,
              direzione: 'EMESSA',
              provider: config.provider,
              ambiente: config.ambiente,
              nomeFile: file.nomeFile,
              xmlSha256: file.sha256,
              stato: 'DA_INVIARE',
              richiestaDa: utenteId,
            },
          })
          await tx.activityLog.create({
            data: {
              tenantId,
              userId: utenteId,
              action: 'SDI_TRASMISSIONE_ACCODATA',
              description: 'Documento accodato per l’invio allo SDI',
              metadata: {
                documentoId,
                trasmissioneId,
                nomeFile: file.nomeFile,
                provider: config.provider,
                ambiente: config.ambiente,
                avvisi,
              } as Prisma.InputJsonValue,
            },
          })
        }, OPZIONI_TRANSAZIONE_SCRITTURA)
      )
    } catch (e) {
      // Un'altra richiesta ha accodato lo stesso documento un attimo prima (unico parziale).
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        return { motivo: 'TRASMISSIONE_IN_CORSO' }
      }
      throw e
    }
    return { trasmissioneId, avvisi }
  }
}
