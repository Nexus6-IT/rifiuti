// Web push dell'app campo (P7): sottoscrizioni per utente (RLS), preferenze, invio senza payload.
//
// Privacy: l'invio NON porta dati. Il browser riceve un evento `push` vuoto, mostra un testo
// generico e l'app rilegge il giro online. Nessun nome, ritiro, cliente, CER o quantita'.
// Funzione spenta se le chiavi VAPID mancano: nessun errore all'avvio, le rotte rispondono
// «non disponibile» e `notificaGiroModificato` non fa nulla.
import { Inject, Injectable, Logger, Optional } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { PrismaService } from '../../infrastructure/persistence/prisma.service'
import { nelContestoTenant } from '../pese/nel-contesto-tenant'
import { PushEndpointNonAmmessoError, PushNonDisponibileError } from './errori-campo'
import {
  caricaChiaviVapid,
  creaIntestazioneVapid,
  endpointPushAmmesso,
  type ChiaviVapidCaricate,
} from './vapid'

// Nomi delle variabili d'ambiente, tenuti in costanti (la guardia infrastruttura-prod controlla le letture con nome scritto per esteso).
export const ENV_VAPID_PUBLIC_KEY = 'VAPID_PUBLIC_KEY'
export const ENV_VAPID_PRIVATE_KEY = 'VAPID_PRIVATE_KEY'
export const ENV_VAPID_SUBJECT = 'VAPID_SUBJECT'

/** Massimo di dispositivi per utente: oltre, i piu' vecchi vengono tolti. */
export const MAX_SOTTOSCRIZIONI_PER_UTENTE = 5
const TIMEOUT_INVIO_MS = 5000
const TTL_SECONDI = 4 * 3600

export interface RichiestaPush {
  endpoint: string
  authorization: string
  ttl: number
}

/** Porta di uscita verso il servizio push del browser (sostituibile nei test). */
export interface InvioPush {
  invia(richiesta: RichiestaPush): Promise<{ status: number }>
}
export const INVIO_PUSH = Symbol('INVIO_PUSH')

/** Invio reale: POST senza corpo, senza redirect, con timeout. */
export const invioPushHttp: InvioPush = {
  async invia({ endpoint, authorization, ttl }) {
    const r = await fetch(endpoint, {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(TIMEOUT_INVIO_MS),
      headers: {
        Authorization: authorization,
        TTL: String(ttl),
        Urgency: 'normal',
        // Un avviso sostituisce quello non ancora consegnato dello stesso tipo.
        Topic: 'giro',
        'Content-Length': '0',
      },
    })
    return { status: r.status }
  },
}

export interface PreferenzePush {
  giroModificato: boolean
}

export interface EsitoInvioPush {
  inviate: number
  rimosse: number
  fallite: number
}

@Injectable()
export class PushCampoService {
  private readonly logger = new Logger(PushCampoService.name)
  private chiavi: ChiaviVapidCaricate | null | undefined

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    @Optional() @Inject(INVIO_PUSH) private readonly invio: InvioPush = invioPushHttp
  ) {}

  private chiaviVapid(): ChiaviVapidCaricate | null {
    if (this.chiavi === undefined) {
      this.chiavi = caricaChiaviVapid({
        pubblica: this.config.get<string>(ENV_VAPID_PUBLIC_KEY),
        privata: this.config.get<string>(ENV_VAPID_PRIVATE_KEY),
        soggetto: this.config.get<string>(ENV_VAPID_SUBJECT),
      })
      if (this.chiavi === null) {
        this.logger.log('Web push spento: chiavi VAPID assenti o non valide.')
      }
    }
    return this.chiavi
  }

  disponibile(): boolean {
    return this.chiaviVapid() !== null
  }

  /** Chiave pubblica da dare al browser (`applicationServerKey`), o null se la funzione e' spenta. */
  chiavePubblica(): string | null {
    return this.chiaviVapid()?.pubblica ?? null
  }

  // --- sottoscrizioni -----------------------------------------------------------------------

  /**
   * Registra (o sposta sull'utente) il dispositivo. Lo stesso endpoint e' un solo dispositivo: se
   * il telefono passa a un collega la riga cambia utente, non si duplica.
   */
  async sottoscrivi(tenantId: string, utenteId: string, endpoint: string): Promise<void> {
    if (!this.disponibile()) throw new PushNonDisponibileError()
    if (!endpointPushAmmesso(endpoint) || endpoint.length > 2000) {
      throw new PushEndpointNonAmmessoError()
    }
    await nelContestoTenant(tenantId, () =>
      this.prisma.$transaction(async tx => {
        await tx.sottoscrizionePush.upsert({
          where: { tenantId_endpoint: { tenantId, endpoint } },
          create: { tenantId, utenteId, endpoint },
          update: { utenteId },
        })
        // Tetto per utente: restano le piu' recenti.
        const sue = await tx.sottoscrizionePush.findMany({
          where: { tenantId, utenteId },
          orderBy: [{ creataIl: 'desc' }, { id: 'desc' }],
          select: { id: true },
        })
        const daTogliere = sue.slice(MAX_SOTTOSCRIZIONI_PER_UTENTE).map(s => s.id)
        if (daTogliere.length > 0) {
          await tx.sottoscrizionePush.deleteMany({ where: { tenantId, id: { in: daTogliere } } })
        }
      })
    )
  }

  /**
   * Toglie il dispositivo dell'utente (logout). Solo se e' suo: l'endpoint di un altro utente non si
   * tocca. Funziona anche a funzione spenta (si puo' sempre ripulire). Idempotente.
   */
  async annulla(tenantId: string, utenteId: string, endpoint: string): Promise<void> {
    await nelContestoTenant(tenantId, () =>
      this.prisma.$transaction(tx =>
        tx.sottoscrizionePush.deleteMany({ where: { tenantId, utenteId, endpoint } })
      )
    )
  }

  // --- preferenze ---------------------------------------------------------------------------

  async preferenze(tenantId: string, utenteId: string): Promise<PreferenzePush> {
    const riga = await nelContestoTenant(tenantId, () =>
      this.prisma.$transaction(tx =>
        tx.preferenzaPush.findUnique({ where: { tenantId_utenteId: { tenantId, utenteId } } })
      )
    )
    return { giroModificato: riga?.giroModificato ?? true }
  }

  async impostaPreferenze(
    tenantId: string,
    utenteId: string,
    valori: PreferenzePush
  ): Promise<PreferenzePush> {
    const riga = await nelContestoTenant(tenantId, () =>
      this.prisma.$transaction(tx =>
        tx.preferenzaPush.upsert({
          where: { tenantId_utenteId: { tenantId, utenteId } },
          create: { tenantId, utenteId, giroModificato: valori.giroModificato },
          update: { giroModificato: valori.giroModificato, aggiornataIl: new Date() },
        })
      )
    )
    return { giroModificato: riga.giroModificato }
  }

  // --- invio --------------------------------------------------------------------------------

  /**
   * Avvisa gli autisti indicati (id autista) che il loro giro e' cambiato. Mai un errore verso
   * il chiamante: la notifica e' un ripiego comodo, il giro resta quello del server.
   * Tre fasi: lettura dei destinatari (transazione breve), invio in rete (fuori da ogni
   * transazione), aggiornamento dell'esito (transazione breve).
   */
  async notificaGiroModificato(tenantId: string, autistaIds: string[]): Promise<EsitoInvioPush> {
    const esito: EsitoInvioPush = { inviate: 0, rimosse: 0, fallite: 0 }
    const chiavi = this.chiaviVapid()
    const unici = [...new Set(autistaIds)]
    if (!chiavi || unici.length === 0) return esito
    try {
      await nelContestoTenant(tenantId, async () => {
        const sottoscrizioni = await this.destinatari(tenantId, unici)
        if (sottoscrizioni.length === 0) return
        const esiti = await Promise.all(sottoscrizioni.map(s => this.inviaUna(chiavi, s)))
        const daTogliere: string[] = []
        const inviati: string[] = []
        esiti.forEach((e, i) => {
          if (e === 'RIMOSSA') daTogliere.push(sottoscrizioni[i].id)
          if (e === 'INVIATA') inviati.push(sottoscrizioni[i].id)
          esito[e === 'RIMOSSA' ? 'rimosse' : e === 'INVIATA' ? 'inviate' : 'fallite']++
        })
        if (daTogliere.length === 0 && inviati.length === 0) return
        await this.prisma.$transaction(async tx => {
          if (daTogliere.length > 0) {
            await tx.sottoscrizionePush.deleteMany({ where: { tenantId, id: { in: daTogliere } } })
          }
          if (inviati.length > 0) {
            await tx.sottoscrizionePush.updateMany({
              where: { tenantId, id: { in: inviati } },
              data: { ultimoInvioIl: new Date() },
            })
          }
        })
      })
    } catch (err) {
      // Nessun dato nel log: solo la classe dell'errore.
      this.logger.warn(`Invio push non riuscito (${err instanceof Error ? err.name : 'errore'})`)
    }
    return esito
  }

  /** Dispositivi degli autisti attivi e collegati a un utente, esclusi chi ha spento l'avviso. */
  private destinatari(
    tenantId: string,
    autistaIds: string[]
  ): Promise<Array<{ id: string; endpoint: string }>> {
    return this.prisma.$transaction(async tx => {
      const autisti = await tx.autista.findMany({
        where: { tenantId, id: { in: autistaIds }, attivo: true, userId: { not: null } },
        select: { userId: true },
      })
      const utenti = autisti.map(a => a.userId as string)
      if (utenti.length === 0) return []
      const spenti = await tx.preferenzaPush.findMany({
        where: { tenantId, utenteId: { in: utenti }, giroModificato: false },
        select: { utenteId: true },
      })
      const esclusi = new Set(spenti.map(p => p.utenteId))
      return tx.sottoscrizionePush.findMany({
        where: { tenantId, utenteId: { in: utenti.filter(u => !esclusi.has(u)) } },
        select: { id: true, endpoint: true },
      })
    })
  }

  private async inviaUna(
    chiavi: ChiaviVapidCaricate,
    s: { endpoint: string }
  ): Promise<'INVIATA' | 'RIMOSSA' | 'FALLITA'> {
    // Un endpoint gia' in tabella ma non (piu') ammesso non si chiama mai.
    if (!endpointPushAmmesso(s.endpoint)) return 'FALLITA'
    try {
      const { status } = await this.invio.invia({
        endpoint: s.endpoint,
        authorization: creaIntestazioneVapid(chiavi, s.endpoint),
        ttl: TTL_SECONDI,
      })
      if (status === 404 || status === 410) return 'RIMOSSA'
      return status >= 200 && status < 300 ? 'INVIATA' : 'FALLITA'
    } catch {
      return 'FALLITA'
    }
  }
}
