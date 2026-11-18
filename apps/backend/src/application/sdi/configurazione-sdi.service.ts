// Configurazione SDI per azienda (4.5a, piano §4.2 e T5): provider, ambiente, credenziali cifrate,
// segreto e token del webhook, interruttore `invio_attivo` (spento di default, acceso solo dopo una
// verifica riuscita), onboarding. Le credenziali NON escono mai dall'API: si possono solo
// sostituire. Il token del webhook si mostra una volta sola (in chiaro solo nella risposta di
// creazione o di rigenerazione; nel database resta il suo SHA-256).
//
// Lock ottimistico con `versione` (0 = nessuna riga) e riga `FOR UPDATE`, come
// `ImpostazioniFatturazioneService`. Audit senza segreti: solo i NOMI dei campi cambiati.
import { createHash, randomBytes } from 'node:crypto'
import {
  BadRequestException,
  ConflictException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Prisma } from '@prisma/client'
import {
  PASSI_ONBOARDING_SDI,
  eAmbienteSdi,
  eProviderSdi,
  type AmbienteSdi,
  type CodiceProviderSdi,
  type PassoOnboardingSdi,
} from '../../domain/fatturazione/sdi/codici'
import { cifraSegreto, decifraSegreto } from '../../infrastructure/crypto/segreti'
import { PrismaService } from '../../infrastructure/persistence/prisma.service'
import { impostaTimeoutLock, OPZIONI_TRANSAZIONE_SCRITTURA } from '../listino/lock-listino'
import { nelContestoTenant } from '../pese/nel-contesto-tenant'
import type { CredenzialiSdi, EsitoVerifica } from '../fatturazione/sdi/provider-sdi.port'
import {
  ProviderSdiNonDisponibileError,
  RegistroProviderSdi,
} from '../fatturazione/sdi/registro-provider-sdi'

/** Nome della variabile con la chiave di cifratura (costante: la guardia statica non vuole literal nei `.get`). */
export const VARIABILE_CHIAVE_CIFRATURA_SDI = 'SDI_CREDENTIAL_ENC_KEY'

const MAX_CHIAVI_CREDENZIALI = 10
const MAX_LUNGHEZZA_VALORE = 500

export interface ConfigurazioneSdiVista {
  configurata: boolean
  provider: CodiceProviderSdi | null
  ambiente: AmbienteSdi | null
  /** true = credenziali proprie dell'azienda; false = account di piattaforma. Mai il contenuto. */
  haCredenziali: boolean
  idConfigurazioneProvider: string | null
  haSegretoWebhook: boolean
  firmaDalProvider: boolean
  invioAttivo: boolean
  /** Passo -> chi e quando lo ha spuntato. Solo i passi spuntati. */
  onboarding: Record<string, { il: string; da: string | null }>
  passiOnboarding: readonly PassoOnboardingSdi[]
  verificataIl: string | null
  ultimoEsitoVerifica: string | null
  versione: number
  modificatoIl: string | null
}

export interface DatiConfigurazioneSdi {
  provider: string
  ambiente: string
  /** `undefined` = non toccare; `null` = account di piattaforma; oggetto = sostituisce. */
  credenziali?: Record<string, string> | null
  idConfigurazioneProvider?: string | null
  /** `undefined` = non toccare; `null` = rimuove; stringa = sostituisce. */
  segretoWebhook?: string | null
  firmaDalProvider?: boolean
  versione: number
}

interface RigaConfigurazione {
  id: string
  provider: string
  ambiente: string
  credenziali_cifrate: string | null
  id_configurazione_provider: string | null
  webhook_segreto_cifrato: string | null
  firma_dal_provider: boolean
  invio_attivo: boolean
  onboarding: Record<string, { il: string; da: string | null }>
  verificata_il: Date | null
  ultimo_esito_verifica: string | null
  versione: number
  updated_at: Date
}

const MSG_VERSIONE_SUPERATA =
  'La configurazione è stata modificata nel frattempo: ricarica per vedere i dati aggiornati.'
const versioneSuperata = () =>
  new ConflictException({ error: 'VERSIONE_SUPERATA', message: MSG_VERSIONE_SUPERATA })
const nonConfigurato = () =>
  new ConflictException({
    error: 'SDI_NON_CONFIGURATO',
    message: 'L’azienda non ha ancora una configurazione SDI.',
  })

const eNonVuota = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0

export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

/** 32 byte casuali in base64url: il token nell'URL del webhook. */
export function generaTokenWebhook(): string {
  return randomBytes(32).toString('base64url')
}

function vista(r: RigaConfigurazione | null): ConfigurazioneSdiVista {
  if (!r) {
    return {
      configurata: false,
      provider: null,
      ambiente: null,
      haCredenziali: false,
      idConfigurazioneProvider: null,
      haSegretoWebhook: false,
      firmaDalProvider: false,
      invioAttivo: false,
      onboarding: {},
      passiOnboarding: PASSI_ONBOARDING_SDI,
      verificataIl: null,
      ultimoEsitoVerifica: null,
      versione: 0,
      modificatoIl: null,
    }
  }
  return {
    configurata: true,
    provider: r.provider as CodiceProviderSdi,
    ambiente: r.ambiente as AmbienteSdi,
    haCredenziali: r.credenziali_cifrate !== null,
    idConfigurazioneProvider: r.id_configurazione_provider,
    haSegretoWebhook: r.webhook_segreto_cifrato !== null,
    firmaDalProvider: r.firma_dal_provider,
    invioAttivo: r.invio_attivo,
    onboarding: r.onboarding ?? {},
    passiOnboarding: PASSI_ONBOARDING_SDI,
    verificataIl: r.verificata_il ? r.verificata_il.toISOString() : null,
    ultimoEsitoVerifica: r.ultimo_esito_verifica,
    versione: r.versione,
    modificatoIl: r.updated_at.toISOString(),
  }
}

const COLONNE = Prisma.sql`id::text AS id, provider, ambiente, credenziali_cifrate,
  id_configurazione_provider, webhook_segreto_cifrato, firma_dal_provider, invio_attivo, onboarding,
  verificata_il, ultimo_esito_verifica, versione, updated_at`

@Injectable()
export class ConfigurazioneSdiService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly registro: RegistroProviderSdi
  ) {}

  private chiave(): string {
    return this.config.get<string>(VARIABILE_CHIAVE_CIFRATURA_SDI) ?? ''
  }

  private chiaveObbligatoria(): string {
    const c = this.chiave()
    if (!c) {
      throw new ServiceUnavailableException({
        error: 'SDI_CHIAVE_CIFRATURA_ASSENTE',
        message: 'La cifratura delle credenziali SDI non è configurata sul server.',
      })
    }
    return c
  }

  async leggi(tenantId: string): Promise<ConfigurazioneSdiVista> {
    return nelContestoTenant(tenantId, async () => {
      const righe = await this.prisma.$queryRaw<RigaConfigurazione[]>`
        SELECT ${COLONNE} FROM "configurazioni_sdi" WHERE tenant_id = ${tenantId}::uuid`
      return vista(righe[0] ?? null)
    })
  }

  /**
   * Crea (versione 0) o aggiorna la configurazione. Cambiare provider, ambiente, credenziali o id
   * di configurazione invalida la verifica e spegne `invio_attivo`: bisogna verificare di nuovo.
   * Alla creazione restituisce `webhookToken` in chiaro (una sola volta).
   */
  async imposta(
    tenantId: string,
    utenteId: string,
    dati: DatiConfigurazioneSdi
  ): Promise<ConfigurazioneSdiVista & { webhookToken?: string }> {
    this.validaDati(dati)
    const credenzialiCifrate =
      dati.credenziali === undefined
        ? undefined
        : dati.credenziali === null
          ? null
          : cifraSegreto(
              JSON.stringify(dati.credenziali),
              this.chiaveObbligatoria(),
              VARIABILE_CHIAVE_CIFRATURA_SDI
            )
    const segretoCifrato =
      dati.segretoWebhook === undefined
        ? undefined
        : dati.segretoWebhook === null
          ? null
          : cifraSegreto(
              dati.segretoWebhook,
              this.chiaveObbligatoria(),
              VARIABILE_CHIAVE_CIFRATURA_SDI
            )

    return nelContestoTenant(tenantId, () =>
      this.prisma
        .$transaction(async tx => {
          await impostaTimeoutLock(tx)
          const righe = await tx.$queryRaw<RigaConfigurazione[]>`
            SELECT ${COLONNE} FROM "configurazioni_sdi"
            WHERE tenant_id = ${tenantId}::uuid FOR UPDATE`
          const attuale = righe[0]
          if ((attuale?.versione ?? 0) !== dati.versione) throw versioneSuperata()

          if (!attuale) {
            const token = generaTokenWebhook()
            const creata = await tx.configurazioneSdi.create({
              data: {
                tenantId,
                provider: dati.provider,
                ambiente: dati.ambiente,
                credenzialiCifrate: credenzialiCifrate ?? null,
                idConfigurazioneProvider: dati.idConfigurazioneProvider ?? null,
                webhookTokenSha256: hashToken(token),
                webhookSegretoCifrato: segretoCifrato ?? null,
                firmaDalProvider: dati.firmaDalProvider ?? false,
                modificatoDa: utenteId,
              },
            })
            await this.audit(tx, tenantId, utenteId, 'SDI_CONFIGURAZIONE_CREATA', {
              provider: dati.provider,
              ambiente: dati.ambiente,
              credenzialiImpostate: credenzialiCifrate != null,
            })
            const letta = await this.rileggi(tx, creata.id)
            return { ...vista(letta), webhookToken: token }
          }

          const cambiaConnessione =
            attuale.provider !== dati.provider ||
            attuale.ambiente !== dati.ambiente ||
            credenzialiCifrate !== undefined ||
            (dati.idConfigurazioneProvider !== undefined &&
              dati.idConfigurazioneProvider !== attuale.id_configurazione_provider)
          const campi: string[] = []
          if (attuale.provider !== dati.provider) campi.push('provider')
          if (attuale.ambiente !== dati.ambiente) campi.push('ambiente')
          if (credenzialiCifrate !== undefined) campi.push('credenziali')
          if (
            dati.idConfigurazioneProvider !== undefined &&
            dati.idConfigurazioneProvider !== attuale.id_configurazione_provider
          )
            campi.push('idConfigurazioneProvider')
          if (segretoCifrato !== undefined) campi.push('segretoWebhook')
          if (
            dati.firmaDalProvider !== undefined &&
            dati.firmaDalProvider !== attuale.firma_dal_provider
          )
            campi.push('firmaDalProvider')
          if (campi.length === 0) return vista(attuale)

          await tx.configurazioneSdi.update({
            where: { id: attuale.id },
            data: {
              provider: dati.provider,
              ambiente: dati.ambiente,
              ...(credenzialiCifrate !== undefined ? { credenzialiCifrate } : {}),
              ...(dati.idConfigurazioneProvider !== undefined
                ? { idConfigurazioneProvider: dati.idConfigurazioneProvider }
                : {}),
              ...(segretoCifrato !== undefined ? { webhookSegretoCifrato: segretoCifrato } : {}),
              ...(dati.firmaDalProvider !== undefined
                ? { firmaDalProvider: dati.firmaDalProvider }
                : {}),
              ...(cambiaConnessione
                ? { verificataIl: null, ultimoEsitoVerifica: null, invioAttivo: false }
                : {}),
              versione: { increment: 1 },
              modificatoDa: utenteId,
            },
          })
          await this.audit(tx, tenantId, utenteId, 'SDI_CONFIGURAZIONE_MODIFICATA', {
            campi,
            invioSpentoPerCambio: cambiaConnessione && attuale.invio_attivo,
          })
          return vista(await this.rileggi(tx, attuale.id))
        }, OPZIONI_TRANSAZIONE_SCRITTURA)
        .catch(err => this.traduci(err))
    )
  }

  /**
   * Prova la configurazione con il provider (nessun invio). Se riesce, `verificata_il` si imposta;
   * se fallisce si azzera e `invio_attivo` si spegne. La chiamata di rete sta FUORI dalla
   * transazione; la scrittura e' condizionata alla versione letta prima.
   */
  async verifica(
    tenantId: string,
    utenteId: string
  ): Promise<{ esito: EsitoVerifica; configurazione: ConfigurazioneSdiVista }> {
    const { riga, cedente } = await nelContestoTenant(tenantId, async () => {
      const righe = await this.prisma.$queryRaw<RigaConfigurazione[]>`
        SELECT ${COLONNE} FROM "configurazioni_sdi" WHERE tenant_id = ${tenantId}::uuid`
      const t = await this.prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { partitaIva: true, codiceFiscale: true },
      })
      return {
        riga: righe[0] ?? null,
        cedente: {
          partitaIva: t?.partitaIva ?? '',
          codiceFiscale: t?.codiceFiscale ?? t?.partitaIva ?? '',
        },
      }
    })
    if (!riga) throw nonConfigurato()

    let provider
    try {
      provider = this.registro.trova(riga.provider)
    } catch (e) {
      if (e instanceof ProviderSdiNonDisponibileError) {
        throw new BadRequestException({ error: 'PROVIDER_NON_DISPONIBILE', message: e.message })
      }
      throw e
    }
    const esito = await provider.verifica(
      {
        ambiente: riga.ambiente as AmbienteSdi,
        credenziali: this.decifraCredenziali(riga.credenziali_cifrate),
        idConfigurazioneProvider: riga.id_configurazione_provider,
      },
      cedente
    )
    const dettaglio = esito.dettaglio.slice(0, 300)

    return nelContestoTenant(tenantId, () =>
      this.prisma
        .$transaction(async tx => {
          await impostaTimeoutLock(tx)
          const aggiornate = await tx.configurazioneSdi.updateMany({
            where: { id: riga.id, versione: riga.versione },
            data: {
              verificataIl: esito.ok ? new Date() : null,
              ultimoEsitoVerifica: dettaglio,
              ...(esito.ok ? {} : { invioAttivo: false }),
              versione: { increment: 1 },
              modificatoDa: utenteId,
            },
          })
          if (aggiornate.count === 0) throw versioneSuperata()
          await this.audit(tx, tenantId, utenteId, 'SDI_CONFIGURAZIONE_VERIFICATA', {
            ok: esito.ok,
            provider: riga.provider,
            ambiente: riga.ambiente,
          })
          return { esito, configurazione: vista(await this.rileggi(tx, riga.id)) }
        }, OPZIONI_TRANSAZIONE_SCRITTURA)
        .catch(err => this.traduci(err))
    )
  }

  /** Rigenera il token del webhook (il vecchio smette di funzionare). Il nuovo e' in chiaro solo qui. */
  async rigeneraToken(
    tenantId: string,
    utenteId: string,
    versione: number
  ): Promise<ConfigurazioneSdiVista & { webhookToken: string }> {
    return nelContestoTenant(tenantId, () =>
      this.prisma
        .$transaction(async tx => {
          const attuale = await this.bloccaRiga(tx, tenantId, versione)
          const token = generaTokenWebhook()
          await tx.configurazioneSdi.update({
            where: { id: attuale.id },
            data: {
              webhookTokenSha256: hashToken(token),
              versione: { increment: 1 },
              modificatoDa: utenteId,
            },
          })
          await this.audit(tx, tenantId, utenteId, 'SDI_TOKEN_WEBHOOK_RIGENERATO', {})
          return { ...vista(await this.rileggi(tx, attuale.id)), webhookToken: token }
        }, OPZIONI_TRANSAZIONE_SCRITTURA)
        .catch(err => this.traduci(err))
    )
  }

  /** Accende o spegne `invio_attivo`. Accendere esige una verifica riuscita (409 `SDI_NON_VERIFICATO`). */
  async impostaInvioAttivo(
    tenantId: string,
    utenteId: string,
    dati: { attivo: boolean; versione: number }
  ): Promise<ConfigurazioneSdiVista> {
    return nelContestoTenant(tenantId, () =>
      this.prisma
        .$transaction(async tx => {
          const attuale = await this.bloccaRiga(tx, tenantId, dati.versione)
          if (dati.attivo && attuale.verificata_il === null) {
            throw new ConflictException({
              error: 'SDI_NON_VERIFICATO',
              message: 'Verifica la connessione con il provider prima di attivare l’invio.',
            })
          }
          if (attuale.invio_attivo === dati.attivo) return vista(attuale)
          await tx.configurazioneSdi.update({
            where: { id: attuale.id },
            data: { invioAttivo: dati.attivo, versione: { increment: 1 }, modificatoDa: utenteId },
          })
          await this.audit(tx, tenantId, utenteId, 'SDI_INVIO_ATTIVO_MODIFICATO', {
            precedente: attuale.invio_attivo,
            nuovo: dati.attivo,
          })
          return vista(await this.rileggi(tx, attuale.id))
        }, OPZIONI_TRANSAZIONE_SCRITTURA)
        .catch(err => this.traduci(err))
    )
  }

  /** Spunta o toglie un passo di onboarding, con data e utente. */
  async impostaPassoOnboarding(
    tenantId: string,
    utenteId: string,
    dati: { passo: string; fatto: boolean; versione: number }
  ): Promise<ConfigurazioneSdiVista> {
    if (!(PASSI_ONBOARDING_SDI as readonly string[]).includes(dati.passo)) {
      throw new BadRequestException({
        error: 'PASSO_ONBOARDING_NON_VALIDO',
        message: `Passo non valido. Ammessi: ${PASSI_ONBOARDING_SDI.join(', ')}.`,
      })
    }
    return nelContestoTenant(tenantId, () =>
      this.prisma
        .$transaction(async tx => {
          const attuale = await this.bloccaRiga(tx, tenantId, dati.versione)
          const nuovo = { ...(attuale.onboarding ?? {}) }
          if (dati.fatto) nuovo[dati.passo] = { il: new Date().toISOString(), da: utenteId }
          else delete nuovo[dati.passo]
          await tx.configurazioneSdi.update({
            where: { id: attuale.id },
            data: {
              onboarding: nuovo as Prisma.InputJsonValue,
              versione: { increment: 1 },
              modificatoDa: utenteId,
            },
          })
          await this.audit(tx, tenantId, utenteId, 'SDI_ONBOARDING_MODIFICATO', {
            passo: dati.passo,
            fatto: dati.fatto,
          })
          return vista(await this.rileggi(tx, attuale.id))
        }, OPZIONI_TRANSAZIONE_SCRITTURA)
        .catch(err => this.traduci(err))
    )
  }

  /**
   * Credenziali in chiaro per l'uso interno (verifica, invio). Mai esposte dall'API e mai
   * loggate. Null = account di piattaforma.
   */
  private decifraCredenziali(cifrate: string | null): CredenzialiSdi | null {
    if (cifrate === null) return null
    return JSON.parse(
      decifraSegreto(cifrate, this.chiaveObbligatoria(), VARIABILE_CHIAVE_CIFRATURA_SDI)
    )
  }

  private validaDati(d: DatiConfigurazioneSdi): void {
    const errori: { campo: string; messaggio: string }[] = []
    if (!eProviderSdi(d.provider))
      errori.push({ campo: 'provider', messaggio: 'Provider non valido.' })
    if (!eAmbienteSdi(d.ambiente))
      errori.push({ campo: 'ambiente', messaggio: 'Ambiente non valido.' })
    if (d.credenziali) {
      const voci = Object.entries(d.credenziali)
      if (
        voci.length === 0 ||
        voci.length > MAX_CHIAVI_CREDENZIALI ||
        voci.some(([k, v]) => !eNonVuota(k) || !eNonVuota(v) || v.length > MAX_LUNGHEZZA_VALORE)
      ) {
        errori.push({ campo: 'credenziali', messaggio: 'Credenziali non valide.' })
      }
    }
    if (errori.length > 0) {
      throw new BadRequestException({
        error: 'CONFIGURAZIONE_SDI_NON_VALIDA',
        message: errori.map(e => e.messaggio),
        details: { errori },
      })
    }
    if (!this.registro.codiciDisponibili().includes(d.provider as CodiceProviderSdi)) {
      throw new BadRequestException({
        error: 'PROVIDER_NON_DISPONIBILE',
        message: 'Il provider scelto non è disponibile in questo ambiente.',
      })
    }
  }

  private async bloccaRiga(
    tx: Prisma.TransactionClient,
    tenantId: string,
    versione: number
  ): Promise<RigaConfigurazione> {
    await impostaTimeoutLock(tx)
    const righe = await tx.$queryRaw<RigaConfigurazione[]>`
      SELECT ${COLONNE} FROM "configurazioni_sdi"
      WHERE tenant_id = ${tenantId}::uuid FOR UPDATE`
    const attuale = righe[0]
    if (!attuale) throw nonConfigurato()
    if (attuale.versione !== versione) throw versioneSuperata()
    return attuale
  }

  private async rileggi(tx: Prisma.TransactionClient, id: string): Promise<RigaConfigurazione> {
    const righe = await tx.$queryRaw<RigaConfigurazione[]>`
      SELECT ${COLONNE} FROM "configurazioni_sdi" WHERE id = ${id}::uuid`
    return righe[0]
  }

  private audit(
    tx: Prisma.TransactionClient,
    tenantId: string,
    userId: string,
    action: string,
    metadata: Record<string, unknown>
  ) {
    return tx.activityLog.create({
      data: {
        tenantId,
        userId,
        action,
        description: 'Configurazione SDI',
        metadata: metadata as Prisma.InputJsonValue,
      },
    })
  }

  private traduci(err: unknown): never {
    // Due prime configurazioni insieme (versione 0): l'unico del tenant fa perdere la seconda.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw versioneSuperata()
    }
    throw err
  }
}
