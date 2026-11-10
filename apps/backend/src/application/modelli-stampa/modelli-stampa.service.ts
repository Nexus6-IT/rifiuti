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
import { PrismaService } from '../../infrastructure/persistence/prisma.service'
import {
  confrontaVersione,
  scriviCondizionato,
  traduciErrorePrisma,
  type DescrizioneEntita,
  type VincoliNoti,
} from '../clienti/anagrafica-versionata'
import { nelContestoTenant } from '../pese/nel-contesto-tenant'

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
  constructor(private readonly prisma: PrismaService) {}

  async list(tenantId: string): Promise<ModelloStampaVista[]> {
    return nelContestoTenant(tenantId, async () => {
      const righe = await this.prisma.companyTemplate.findMany({
        where: { tenantId },
        orderBy: [{ ambito: 'asc' }, { isDefault: 'desc' }, { name: 'asc' }],
      })
      return righe.map(vista)
    })
  }

  async getById(tenantId: string, id: string): Promise<ModelloStampaVista> {
    return nelContestoTenant(tenantId, async () => {
      const riga = await this.prisma.companyTemplate.findFirst({ where: { id, tenantId } })
      if (!riga) throw nonTrovato()
      return vista(riga)
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
