// Condizioni di pagamento (4.1a, D6): anagrafica per azienda con lock ottimistico (D14),
// disattivazione al posto della cancellazione quando la riga e' in uso (D13) e audit (D16).
// Le regole sui dati stanno in `domain/clienti/condizione-pagamento`: qui nessuna logica duplicata.
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import {
  descriviRate,
  normalizzaCondizione,
  validaCondizione,
  type DatiCondizionePagamento,
} from '../../domain/clienti/condizione-pagamento'
import { PrismaService } from '../../infrastructure/persistence/prisma.service'
import { nelContestoTenant } from '../pese/nel-contesto-tenant'
import {
  confrontaVersione,
  scriviCondizionato,
  traduciErrorePrisma,
  type DescrizioneEntita,
  type VincoliNoti,
} from './anagrafica-versionata'
import { COLONNE_CONDIZIONE, contaUsi, type ClientUsi } from './uso-tabelle-fatturazione'

const ENTITA: DescrizioneEntita = {
  prefisso: 'CONDIZIONE_PAGAMENTO',
  soggetto: 'La condizione di pagamento',
  femminile: true,
}

const VINCOLI: VincoliNoti = {
  condizioni_pagamento_tenant_id_codice_key: {
    codice: 'CONDIZIONE_PAGAMENTO_CODICE_DUPLICATO',
    messaggio: 'Esiste già una condizione di pagamento con questo codice.',
  },
}

export interface CondizioneVista extends DatiCondizionePagamento {
  id: string
  attiva: boolean
  versione: number
  /** Es. "30-60 gg fine mese", "a vista". */
  descrizioneRate: string
  /** Nessun cliente o contratto la cita: si puo' cancellare invece di disattivare. */
  eliminabile: boolean
}

export type ModificaCondizione = Partial<DatiCondizionePagamento> & {
  attiva?: boolean
  versione: number
}

type RigaCondizione = {
  id: string
  codice: string
  descrizione: string
  modalita: string
  giorniRate: number[]
  fineMese: boolean
  attiva: boolean
  versione: number
}

/** Campi modificabili, nell'ordine in cui compaiono in scrittura e nell'audit. */
const CAMPI = ['codice', 'descrizione', 'modalita', 'giorniRate', 'fineMese', 'attiva'] as const
type Campo = (typeof CAMPI)[number]

const datiDi = (r: RigaCondizione): DatiCondizionePagamento & { attiva: boolean } => ({
  codice: r.codice,
  descrizione: r.descrizione,
  modalita: r.modalita as DatiCondizionePagamento['modalita'],
  giorniRate: [...r.giorniRate],
  fineMese: r.fineMese,
  attiva: r.attiva,
})

async function comeVista(
  r: RigaCondizione,
  tenantId: string,
  client: ClientUsi,
  usiNoti?: number
): Promise<CondizioneVista> {
  const usi =
    usiNoti ?? (await contaUsi(client, tenantId, [r.id], COLONNE_CONDIZIONE)).get(r.id) ?? 0
  const dati = datiDi(r)
  return {
    id: r.id,
    codice: dati.codice,
    descrizione: dati.descrizione,
    modalita: dati.modalita,
    giorniRate: dati.giorniRate,
    fineMese: dati.fineMese,
    attiva: dati.attiva,
    versione: r.versione,
    descrizioneRate: descriviRate(dati),
    eliminabile: usi === 0,
  }
}

function validaOLancia(dati: DatiCondizionePagamento): void {
  const errori = validaCondizione(dati)
  if (errori.length > 0) {
    throw new BadRequestException({ message: errori, error: 'CONDIZIONE_PAGAMENTO_NON_VALIDA' })
  }
}

const nonTrovata = () =>
  new NotFoundException({
    message: 'Condizione di pagamento non trovata.',
    error: 'CONDIZIONE_PAGAMENTO_NON_TROVATA',
  })

const uguali = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

@Injectable()
export class CondizioniPagamentoService {
  constructor(private readonly prisma: PrismaService) {}

  async list(tenantId: string, incluseDisattivate: boolean): Promise<CondizioneVista[]> {
    return nelContestoTenant(tenantId, async () => {
      const righe = await this.prisma.condizionePagamento.findMany({
        where: incluseDisattivate ? { tenantId } : { tenantId, attiva: true },
        orderBy: [{ attiva: 'desc' }, { codice: 'asc' }],
      })
      const usi = await contaUsi(
        this.prisma,
        tenantId,
        righe.map(r => r.id),
        COLONNE_CONDIZIONE
      )
      return Promise.all(righe.map(r => comeVista(r, tenantId, this.prisma, usi.get(r.id) ?? 0)))
    })
  }

  async getById(tenantId: string, id: string): Promise<CondizioneVista> {
    return nelContestoTenant(tenantId, async () => {
      const riga = await this.prisma.condizionePagamento.findFirst({ where: { id, tenantId } })
      if (!riga) throw nonTrovata()
      return comeVista(riga, tenantId, this.prisma)
    })
  }

  async crea(
    tenantId: string,
    utenteId: string,
    dati: DatiCondizionePagamento
  ): Promise<CondizioneVista> {
    const valori = normalizzaCondizione(dati)
    validaOLancia(valori)
    return nelContestoTenant(tenantId, () =>
      this.prisma
        .$transaction(async tx => {
          const riga = await tx.condizionePagamento.create({ data: { tenantId, ...valori } })
          await this.audit(tx, tenantId, utenteId, 'CONDIZIONE_PAGAMENTO_CREATA', 'creata', {
            condizioneId: riga.id,
            codice: riga.codice,
          })
          return comeVista(riga, tenantId, tx)
        })
        .catch(err => traduciErrorePrisma(err, ENTITA, VINCOLI))
    )
  }

  async modifica(
    tenantId: string,
    utenteId: string,
    id: string,
    m: ModificaCondizione
  ): Promise<CondizioneVista> {
    return nelContestoTenant(tenantId, () =>
      this.prisma
        .$transaction(async tx => {
          const prima = await tx.condizionePagamento.findFirst({ where: { id, tenantId } })
          if (!prima) throw nonTrovata()
          confrontaVersione(prima.versione, m.versione, ENTITA)

          const attuali = datiDi(prima)
          const unione = normalizzaCondizione({
            ...attuali,
            ...Object.fromEntries(Object.entries(m).filter(([, v]) => v !== undefined)),
          })
          validaOLancia(unione)
          const nuovi: Record<Campo, unknown> = { ...unione, attiva: m.attiva ?? attuali.attiva }

          const campi = CAMPI.filter(c => !uguali(nuovi[c], attuali[c]))
          if (campi.length === 0) return comeVista(prima, tenantId, tx)

          await scriviCondizionato(
            () =>
              tx.condizionePagamento.updateMany({
                where: { id, tenantId, versione: m.versione },
                data: {
                  ...Object.fromEntries(campi.map(c => [c, nuovi[c]])),
                  versione: { increment: 1 },
                } as Prisma.CondizionePagamentoUpdateManyMutationInput,
              }),
            ENTITA
          )
          const dopo = await tx.condizionePagamento.findFirst({ where: { id, tenantId } })
          if (!dopo) throw nonTrovata()
          await this.audit(
            tx,
            tenantId,
            utenteId,
            'CONDIZIONE_PAGAMENTO_MODIFICATA',
            'modificata',
            {
              condizioneId: id,
              codice: dopo.codice,
              campi,
            }
          )
          return comeVista(dopo, tenantId, tx)
        })
        .catch(err => traduciErrorePrisma(err, ENTITA, VINCOLI))
    )
  }

  async elimina(tenantId: string, utenteId: string, id: string, versione: number): Promise<void> {
    return nelContestoTenant(tenantId, () =>
      this.prisma
        .$transaction(async tx => {
          const riga = await tx.condizionePagamento.findFirst({ where: { id, tenantId } })
          if (!riga) throw nonTrovata()
          confrontaVersione(riga.versione, versione, ENTITA)
          await scriviCondizionato(
            () => tx.condizionePagamento.deleteMany({ where: { id, tenantId, versione } }),
            ENTITA
          )
          await this.audit(tx, tenantId, utenteId, 'CONDIZIONE_PAGAMENTO_ELIMINATA', 'eliminata', {
            condizioneId: id,
            codice: riga.codice,
          })
        })
        .catch(err => traduciErrorePrisma(err, ENTITA, VINCOLI))
    )
  }

  /** Audit nella stessa transazione: solo id, codice e nomi dei campi, mai testo libero (D16). */
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
        description: `Condizione di pagamento ${esito}`,
        metadata: metadata as Prisma.InputJsonValue,
      },
    })
  }
}
