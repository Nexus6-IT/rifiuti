import { createHmac, timingSafeEqual } from 'node:crypto'
import type {
  CedenteDaVerificare,
  ContestoProvider,
  EsitoInvio,
  EsitoVerifica,
  EsitoWebhook,
  FileDaInviare,
  InvioTrovato,
  NotificaSdiGrezza,
  ProviderSdi,
} from '../../../application/fatturazione/sdi/provider-sdi.port'
import {
  ESITI_COMMITTENTE,
  TIPI_NOTIFICA_SDI,
  type EsitoCommittente,
  type TipoNotificaSdi,
} from '../../../domain/fatturazione/sdi/codici'

/** Intestazione del webhook del fake: `t=<secondi unix>,v1=<hmac sha256 esadecimale>`. */
export const INTESTAZIONE_FIRMA_FAKE = 'x-sdi-signature'
/** Scarto massimo fra l'ora della firma e l'ora di ricezione. */
const TOLLERANZA_SECONDI = 300

/** Firma un corpo come fa il fake (HMAC-SHA256 di `<t>.<corpo>`); serve ai test e a `tools/sdi-fake`. */
export function firmaWebhookFake(corpo: Buffer, segreto: string, t: number): string {
  const hmac = createHmac('sha256', segreto).update(`${t}.`).update(corpo).digest('hex')
  return `t=${t},v1=${hmac}`
}

type Scenario =
  | 'RC'
  | 'NS'
  | 'MC'
  | 'INCERTO_ARRIVATO'
  | 'INCERTO_PERSO'
  | 'TRANSITORIO'
  | 'RIFIUTATO'
  | 'RC_EC01'
  | 'RC_EC02'

/** Ultima cifra dell'identificativo del cessionario -> scenario (tabella documentata nel piano §4.1). */
const SCENARI: Record<string, Scenario> = {
  '1': 'NS',
  '2': 'MC',
  '3': 'INCERTO_ARRIVATO',
  '4': 'TRANSITORIO',
  '5': 'RIFIUTATO',
  '6': 'INCERTO_PERSO',
  '7': 'RC_EC01',
  '8': 'RC_EC02',
}

interface InvioRegistrato {
  idProvider: string
  idSdi: string
  nomeFile: string
  scenario: Scenario
  /** Esito mostrato alla chiamata di `invia` (ripetuto identico alle chiamate successive). */
  esito: EsitoInvio
}

/** Identificativo (P.IVA o codice fiscale) del cessionario/committente nell'XML. */
function identificativoCessionario(xml: Buffer): string | null {
  const testo = xml.toString('utf8')
  const blocco = /<CessionarioCommittente>([\s\S]*?)<\/CessionarioCommittente>/.exec(testo)?.[1]
  if (!blocco) return null
  const id =
    /<IdCodice>([^<]+)<\/IdCodice>/.exec(blocco)?.[1] ??
    /<CodiceFiscale>([^<]+)<\/CodiceFiscale>/.exec(blocco)?.[1]
  return id?.trim() || null
}

function scenarioDa(xml: Buffer): Scenario | null {
  const id = identificativoCessionario(xml)
  if (!id) return null
  return SCENARI[id.slice(-1)] ?? 'RC'
}

const eTipoNotifica = (v: unknown): v is TipoNotificaSdi =>
  typeof v === 'string' && (TIPI_NOTIFICA_SDI as readonly string[]).includes(v)

/**
 * Provider SDI in memoria e deterministico (CI, test unitari e Postgres). L'esito dipende
 * dall'ultima cifra della P.IVA del cessionario: 1 NS, 2 MC, 3 INCERTO (invio arrivato), 4 TRANSITORIO,
 * 5 RIFIUTATO, 6 INCERTO (invio perso), 7 RC + NE EC01, 8 RC + NE EC02, altre RC. Mai usato in
 * produzione: `RegistroProviderSdi` lo rifiuta.
 */
export class ProviderSdiFake implements ProviderSdi {
  readonly codice = 'fake' as const
  private readonly perChiave = new Map<string, InvioRegistrato>()
  private readonly perId = new Map<string, InvioRegistrato>()
  private contatore = 0

  constructor(private readonly adesso: () => Date = () => new Date()) {}

  /** Numero di invii distinti ricevuti (le chiamate ripetute con la stessa chiave non contano). */
  get invii(): number {
    return this.perChiave.size
  }

  async verifica(ctx: ContestoProvider, cedente: CedenteDaVerificare): Promise<EsitoVerifica> {
    if (ctx.credenziali?.apiKey === 'KO')
      return { ok: false, dettaglio: 'Credenziali rifiutate dal provider' }
    if (!/^\d{11}$/.test(cedente.partitaIva)) {
      return { ok: false, dettaglio: 'Partita IVA non configurata presso il provider' }
    }
    return { ok: true, dettaglio: 'Configurazione di prova valida' }
  }

  async invia(_ctx: ContestoProvider, f: FileDaInviare): Promise<EsitoInvio> {
    const gia = this.perChiave.get(f.chiaveIdempotenza)
    if (gia) return gia.esito

    const scenario = scenarioDa(f.xml)
    if (scenario === null) {
      return {
        tipo: 'RIFIUTATO',
        codice: 'XML_NON_VALIDO',
        messaggio: 'Cessionario non identificabile',
      }
    }
    // Transitorio e rifiutato non registrano nulla: il provider non ha accettato il file.
    if (scenario === 'TRANSITORIO')
      return { tipo: 'TRANSITORIO', codice: 'HTTP_503', ritentaDopoMs: 1000 }
    if (scenario === 'RIFIUTATO') {
      return {
        tipo: 'RIFIUTATO',
        codice: 'PIVA_NON_CONFIGURATA',
        messaggio: 'Partita IVA non configurata',
      }
    }
    if (scenario === 'INCERTO_PERSO') return { tipo: 'INCERTO' }

    this.contatore++
    const idProvider = `fake-${this.contatore}`
    const registrato: InvioRegistrato = {
      idProvider,
      idSdi: `sdi-${this.contatore}`,
      nomeFile: f.nomeFile,
      scenario,
      esito:
        scenario === 'INCERTO_ARRIVATO'
          ? { tipo: 'INCERTO' }
          : { tipo: 'ACCETTATO', idProvider, idSdi: `sdi-${this.contatore}`, fileFirmato: null },
    }
    this.perChiave.set(f.chiaveIdempotenza, registrato)
    this.perId.set(idProvider, registrato)
    return registrato.esito
  }

  async cerca(
    _ctx: ContestoProvider,
    q: { chiaveIdempotenza: string; nomeFile: string }
  ): Promise<InvioTrovato | null> {
    const r =
      this.perChiave.get(q.chiaveIdempotenza) ??
      [...this.perId.values()].find(x => x.nomeFile === q.nomeFile)
    return r ? { idProvider: r.idProvider, idSdi: r.idSdi } : null
  }

  async notifiche(_ctx: ContestoProvider, idProvider: string): Promise<NotificaSdiGrezza[]> {
    const r = this.perId.get(idProvider)
    if (!r) return []
    const quando = this.adesso()
    const n = (
      tipo: TipoNotificaSdi,
      esito: EsitoCommittente | null = null,
      codici: string[] = []
    ): NotificaSdiGrezza => ({
      tipo,
      esitoCommittente: esito,
      codiciErrore: codici,
      dataRicezioneSdi: quando,
      idNotifica: `${idProvider}-${tipo}${esito ? `-${esito}` : ''}`,
      file: null,
    })
    switch (r.scenario) {
      case 'NS':
        return [n('NS', null, ['00305'])]
      case 'MC':
        return [n('MC')]
      case 'RC_EC01':
        return [n('RC'), n('NE', 'EC01')]
      case 'RC_EC02':
        return [n('RC'), n('NE', 'EC02')]
      default:
        return [n('RC')]
    }
  }

  interpretaWebhook(
    intestazioni: Record<string, string>,
    corpoGrezzo: Buffer,
    segreto: string,
    ora: Date
  ): EsitoWebhook {
    const m = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(intestazioni[INTESTAZIONE_FIRMA_FAKE] ?? '')
    if (!m) return { tipo: 'NON_AUTENTICO', motivo: 'FORMATO' }
    const t = Number(m[1])
    const attesa = Buffer.from(firmaWebhookFake(corpoGrezzo, segreto, t).split('v1=')[1], 'hex')
    const ricevuta = Buffer.from(m[2], 'hex')
    if (attesa.length !== ricevuta.length || !timingSafeEqual(attesa, ricevuta)) {
      return { tipo: 'NON_AUTENTICO', motivo: 'FIRMA' }
    }
    if (Math.abs(Math.floor(ora.getTime() / 1000) - t) > TOLLERANZA_SECONDI) {
      return { tipo: 'NON_AUTENTICO', motivo: 'TIMESTAMP' }
    }
    let corpo: unknown
    try {
      corpo = JSON.parse(corpoGrezzo.toString('utf8'))
    } catch {
      return { tipo: 'NON_AUTENTICO', motivo: 'FORMATO' }
    }
    const c = corpo as {
      id?: unknown
      idProvider?: unknown
      notifica?: {
        tipo?: unknown
        esitoCommittente?: unknown
        codiciErrore?: unknown
        dataRicezioneSdi?: unknown
        idNotifica?: unknown
      }
    }
    if (typeof c.id !== 'string' || typeof c.idProvider !== 'string' || !c.notifica) {
      return { tipo: 'IGNORATO' }
    }
    const nt = c.notifica
    if (!eTipoNotifica(nt.tipo)) return { tipo: 'IGNORATO' }
    const esito = (ESITI_COMMITTENTE as readonly unknown[]).includes(nt.esitoCommittente)
      ? (nt.esitoCommittente as EsitoCommittente)
      : null
    return {
      tipo: 'VALIDO',
      idEvento: c.id,
      idProvider: c.idProvider,
      notifica: {
        tipo: nt.tipo,
        esitoCommittente: esito,
        codiciErrore: Array.isArray(nt.codiciErrore)
          ? nt.codiciErrore.filter((x): x is string => typeof x === 'string')
          : [],
        dataRicezioneSdi:
          typeof nt.dataRicezioneSdi === 'string' ? new Date(nt.dataRicezioneSdi) : null,
        idNotifica: typeof nt.idNotifica === 'string' ? nt.idNotifica : null,
        file: null,
      },
    }
  }
}
