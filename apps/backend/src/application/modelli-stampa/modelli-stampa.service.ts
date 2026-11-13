// Modelli di stampa (4.7, T6): CRUD di `company_templates` con lock ottimistico sulla `versione`,
// un solo modello predefinito per (azienda, ambito) e audit nella stessa transazione.
// Le regole sui dati stanno in `domain/modelli-stampa` (logo compreso: unico controllo dei magic
// bytes, condiviso con il PDF del FIR e la distinta). Il predefinito si imposta sotto un advisory
// lock per (azienda, ambito): due richieste insieme si serializzano e restano sempre un solo
// predefinito, senza che l'indice unico parziale lanci un 23505 all'utente.
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import {
  COLORE_PRIMARIO_PREDEFINITO,
  COLORE_SECONDARIO_PREDEFINITO,
  normalizzaModello,
  validaModello,
  type AmbitoModelloStampa,
  type DatiModelloStampa,
} from '../../domain/modelli-stampa/modello'
import { esaminaLogo } from '../../domain/modelli-stampa/logo'
import { logoLeggibile } from '../../infrastructure/pdf/logo-leggibile'
import { PrismaService } from '../../infrastructure/persistence/prisma.service'
import {
  confrontaVersione,
  scriviCondizionato,
  traduciErrorePrisma,
  type DescrizioneEntita,
  type VincoliNoti,
} from '../clienti/anagrafica-versionata'
import { nelContestoTenant } from '../pese/nel-contesto-tenant'
import { CacheLogo } from './cache-logo'

export type { AmbitoModelloStampa, DatiModelloStampa }

export interface ModelloStampaVista extends DatiModelloStampa {
  id: string
  predefinito: boolean
  versione: number
}

/** Alla creazione bastano il nome; il resto ha i valori predefiniti della colonna. */
export type NuovoModelloStampa = Partial<DatiModelloStampa> & Pick<DatiModelloStampa, 'nome'>
/** La modifica sostituisce tutti i campi (PUT) e porta la versione letta. */
export type ModificaModelloStampa = DatiModelloStampa & { versione: number }

const ENTITA: DescrizioneEntita = {
  prefisso: 'MODELLO_STAMPA',
  soggetto: 'Il modello di stampa',
  femminile: false,
}

/** Indice unico parziale `(tenant_id, ambito) WHERE is_default`: l'advisory lock lo previene. */
const VINCOLI: VincoliNoti = {
  company_templates_default_ambito_key: {
    codice: 'MODELLO_STAMPA_PREDEFINITO_CONCORRENTE',
    messaggio: 'Un altro modello è appena diventato il predefinito di questo ambito: riprova.',
  },
}

type Riga = Prisma.CompanyTemplateGetPayload<object>

/** Tutte le colonne tranne il logo, che e' pesante e si legge dalla cache (vedi `conLogo`). */
const SENZA_LOGO = {
  id: true,
  tenantId: true,
  createdAt: true,
  updatedAt: true,
  name: true,
  logoUrl: true,
  headerText: true,
  footerText: true,
  primaryColor: true,
  secondaryColor: true,
  fontFamily: true,
  isDefault: true,
  ambito: true,
  copie: true,
  versione: true,
} satisfies Prisma.CompanyTemplateSelect
type RigaSenzaLogo = Prisma.CompanyTemplateGetPayload<{ select: typeof SENZA_LOGO }>

/** Tetti della cache dei loghi: 200 modelli, ~32 MB di base64, 10 minuti. */
const CACHE_LOGHI = { maxVoci: 200, maxCaratteri: 32 * 1024 * 1024, ttlMs: 10 * 60_000 }

const vista = (r: Riga): ModelloStampaVista => ({
  id: r.id,
  nome: r.name,
  ambito: r.ambito,
  copie: r.copie,
  testoIntestazione: r.headerText,
  testoPiePagina: r.footerText,
  colorePrimario: r.primaryColor,
  coloreSecondario: r.secondaryColor,
  logoBase64: r.logoBase64,
  predefinito: r.isDefault,
  versione: r.versione,
})

const nonTrovato = () =>
  new NotFoundException({
    message: 'Modello di stampa non trovato.',
    error: 'MODELLO_STAMPA_NON_TROVATO',
  })

function validaOLancia(dati: DatiModelloStampa): void {
  const errori = validaModello(dati)
  if (errori.length > 0) {
    throw new BadRequestException({ message: errori, error: 'MODELLO_STAMPA_NON_VALIDO' })
  }
}

/**
 * Il logo deve potersi incorporare davvero in un PDF (revisione I1): firma e dimensione giuste non
 * bastano, un PNG corrotto romperebbe la stampa. Si prova prima di toccare il database.
 */
async function verificaLogoLeggibile(dati: DatiModelloStampa): Promise<void> {
  if (!dati.logoBase64) return
  const esito = esaminaLogo(dati.logoBase64)
  if (esito.ok && (await logoLeggibile(esito.dataUrl))) return
  throw new BadRequestException({
    message: ['Logo non leggibile: carica un PNG o JPEG valido.'],
    error: 'MODELLO_STAMPA_NON_VALIDO',
  })
}

/** Colonne scritte da creazione e modifica (il `logo_url` non si usa: non c'e' storage). */
const colonne = (d: DatiModelloStampa) => ({
  name: d.nome,
  ambito: d.ambito,
  copie: d.copie,
  headerText: d.testoIntestazione,
  footerText: d.testoPiePagina,
  primaryColor: d.colorePrimario,
  secondaryColor: d.coloreSecondario,
  logoBase64: d.logoBase64,
})

@Injectable()
export class ModelliStampaService {
  private readonly cacheLogo = new CacheLogo(CACHE_LOGHI)

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Completa le righe lette senza logo: quelli gia' in cache (chiave azienda + modello + versione)
   * non si rileggono, gli altri si caricano in una query sola, scoped all'azienda, e si mettono in
   * cache con la versione della riga da cui arrivano (mai con quella di un'altra lettura).
   */
  private async conLogo(tenantId: string, righe: RigaSenzaLogo[]): Promise<Riga[]> {
    const loghi = new Map<string, string | null>()
    const mancanti: string[] = []
    for (const r of righe) {
      const dalla = this.cacheLogo.get(tenantId, r.id, r.versione)
      if (dalla === undefined) mancanti.push(r.id)
      else loghi.set(r.id, dalla)
    }
    // Righe lette per intero (logo compreso) nella stessa query: logo e versione arrivano insieme,
    // quindi la chiave di cache descrive sempre il logo che contiene. Se fra le due letture una
    // modifica concorrente ha alzato la versione, si usa l'intera riga piu' recente: mai metadati
    // di V con il logo di V+1.
    const complete = new Map<string, Riga>()
    if (mancanti.length > 0) {
      const lette = await this.prisma.companyTemplate.findMany({
        where: { tenantId, id: { in: mancanti } },
      })
      for (const l of lette) {
        this.cacheLogo.set(tenantId, l.id, l.versione, l.logoBase64)
        loghi.set(l.id, l.logoBase64)
        complete.set(l.id, l)
      }
    }
    return righe.map(r => {
      const piuRecente = complete.get(r.id)
      if (piuRecente && piuRecente.versione !== r.versione) return piuRecente
      return { ...r, logoBase64: loghi.get(r.id) ?? null }
    })
  }

  async list(tenantId: string): Promise<ModelloStampaVista[]> {
    return nelContestoTenant(tenantId, async () => {
      const righe = await this.prisma.companyTemplate.findMany({
        where: { tenantId },
        select: SENZA_LOGO,
        orderBy: [{ ambito: 'asc' }, { isDefault: 'desc' }, { name: 'asc' }],
      })
      return (await this.conLogo(tenantId, righe)).map(vista)
    })
  }

  async getById(tenantId: string, id: string): Promise<ModelloStampaVista> {
    return nelContestoTenant(tenantId, async () => {
      const riga = await this.prisma.companyTemplate.findFirst({
        where: { id, tenantId },
        select: SENZA_LOGO,
      })
      if (!riga) throw nonTrovato()
      const [completa] = await this.conLogo(tenantId, [riga])
      return vista(completa)
    })
  }

  async crea(
    tenantId: string,
    utenteId: string,
    nuovo: NuovoModelloStampa
  ): Promise<ModelloStampaVista> {
    const dati = normalizzaModello({
      ambito: 'GENERALE',
      copie: 1,
      testoIntestazione: null,
      testoPiePagina: null,
      colorePrimario: COLORE_PRIMARIO_PREDEFINITO,
      coloreSecondario: COLORE_SECONDARIO_PREDEFINITO,
      logoBase64: null,
      ...nuovo,
    })
    validaOLancia(dati)
    await verificaLogoLeggibile(dati)
    return nelContestoTenant(tenantId, () =>
      this.prisma
        .$transaction(async tx => {
          const riga = await tx.companyTemplate.create({
            data: { tenantId, ...colonne(dati), isDefault: false },
          })
          await this.audit(tx, tenantId, utenteId, 'MODELLO_STAMPA_CREATO', 'creato', {
            modelloId: riga.id,
            ambito: riga.ambito,
          })
          return vista(riga)
        })
        .catch(err => traduciErrorePrisma(err, ENTITA, VINCOLI))
    )
  }

  /**
   * Sostituisce i dati del modello. Se l'ambito cambia, il modello perde il flag di predefinito
   * (il predefinito dell'ambito nuovo e' un altro): altrimenti ci sarebbero due predefiniti.
   */
  async modifica(
    tenantId: string,
    utenteId: string,
    id: string,
    m: ModificaModelloStampa
  ): Promise<ModelloStampaVista> {
    const { versione, ...resto } = m
    const dati = normalizzaModello(resto)
    validaOLancia(dati)
    await verificaLogoLeggibile(dati)
    return nelContestoTenant(tenantId, () =>
      this.prisma
        .$transaction(async tx => {
          const prima = await this.leggiBloccando(tx, tenantId, id)
          confrontaVersione(prima.versione, versione, ENTITA)
          const cambiaAmbito = prima.ambito !== dati.ambito
          if (cambiaAmbito) await this.bloccaAmbito(tx, tenantId, dati.ambito)
          await scriviCondizionato(
            () =>
              tx.companyTemplate.updateMany({
                where: { id, tenantId, versione },
                data: {
                  ...colonne(dati),
                  ...(cambiaAmbito ? { isDefault: false } : {}),
                  versione: { increment: 1 },
                },
              }),
            ENTITA
          )
          const dopo = await tx.companyTemplate.findFirst({ where: { id, tenantId } })
          if (!dopo) throw nonTrovato()
          await this.audit(tx, tenantId, utenteId, 'MODELLO_STAMPA_MODIFICATO', 'modificato', {
            modelloId: id,
            ambito: dopo.ambito,
          })
          return vista(dopo)
        })
        .then(v => {
          this.cacheLogo.invalida(tenantId, id) // la versione e' salita: la voce vecchia non serve piu'
          return v
        })
        .catch(err => traduciErrorePrisma(err, ENTITA, VINCOLI))
    )
  }

  /** Rende il modello il predefinito del suo ambito; il precedente perde il flag (e la versione sale). */
  async rendiPredefinito(
    tenantId: string,
    utenteId: string,
    id: string,
    versione: number
  ): Promise<ModelloStampaVista> {
    return nelContestoTenant(tenantId, () =>
      this.prisma
        .$transaction(async tx => {
          const prima = await this.leggiBloccando(tx, tenantId, id)
          confrontaVersione(prima.versione, versione, ENTITA)
          await this.bloccaAmbito(tx, tenantId, prima.ambito)
          if (prima.isDefault) return vista(prima)
          await tx.companyTemplate.updateMany({
            where: { tenantId, ambito: prima.ambito, isDefault: true, NOT: { id } },
            data: { isDefault: false, versione: { increment: 1 } },
          })
          await scriviCondizionato(
            () =>
              tx.companyTemplate.updateMany({
                where: { id, tenantId, versione },
                data: { isDefault: true, versione: { increment: 1 } },
              }),
            ENTITA
          )
          const dopo = await tx.companyTemplate.findFirst({ where: { id, tenantId } })
          if (!dopo) throw nonTrovato()
          await this.audit(
            tx,
            tenantId,
            utenteId,
            'MODELLO_STAMPA_PREDEFINITO',
            'reso predefinito',
            {
              modelloId: id,
              ambito: dopo.ambito,
            }
          )
          return vista(dopo)
        })
        .catch(err => traduciErrorePrisma(err, ENTITA, VINCOLI))
    )
  }

  async elimina(tenantId: string, utenteId: string, id: string, versione: number): Promise<void> {
    return nelContestoTenant(tenantId, () =>
      this.prisma
        .$transaction(async tx => {
          const riga = await this.leggiBloccando(tx, tenantId, id)
          confrontaVersione(riga.versione, versione, ENTITA)
          await scriviCondizionato(
            () => tx.companyTemplate.deleteMany({ where: { id, tenantId, versione } }),
            ENTITA
          )
          await this.audit(tx, tenantId, utenteId, 'MODELLO_STAMPA_ELIMINATO', 'eliminato', {
            modelloId: id,
            ambito: riga.ambito,
          })
        })
        .then(() => this.cacheLogo.invalida(tenantId, id))
        .catch(err => traduciErrorePrisma(err, ENTITA, VINCOLI))
    )
  }

  /** Legge la riga con FOR UPDATE: modifiche, predefinito ed eliminazione dello stesso modello si serializzano. */
  private async leggiBloccando(
    tx: Prisma.TransactionClient,
    tenantId: string,
    id: string
  ): Promise<Riga> {
    const ids = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM company_templates WHERE id = ${id}::uuid AND tenant_id = ${tenantId}::uuid FOR UPDATE`
    if (ids.length === 0) throw nonTrovato()
    const riga = await tx.companyTemplate.findFirst({ where: { id, tenantId } })
    if (!riga) throw nonTrovato()
    return riga
  }

  /** Serializza chi tocca il predefinito dello stesso (azienda, ambito). */
  private async bloccaAmbito(
    tx: Prisma.TransactionClient,
    tenantId: string,
    ambito: AmbitoModelloStampa
  ): Promise<void> {
    const chiave = `modello-stampa-predefinito:${tenantId}:${ambito}`
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${chiave}))`
  }

  /** Audit nella stessa transazione: solo id e ambito, mai testi o logo. */
  private async audit(
    tx: Prisma.TransactionClient,
    tenantId: string,
    utenteId: string,
    action: string,
    esito: string,
    metadata: Record<string, unknown>
  ): Promise<void> {
    await tx.activityLog.create({
      data: {
        tenantId,
        userId: utenteId,
        action,
        description: `Modello di stampa ${esito}`,
        metadata: metadata as Prisma.InputJsonValue,
      },
    })
  }
}
