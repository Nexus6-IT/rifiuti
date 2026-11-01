// Spese accessorie: spese di incasso e bollo (4.1a, D23). Anagrafica per azienda con lock
// ottimistico (D14), disattivazione al posto della cancellazione quando la spesa e' in uso (D13)
// e audit (D16). Le regole sui dati stanno in `domain/clienti/spesa-accessoria`.
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { Prisma } from '@prisma/client'
import {
  normalizzaSpesa,
  validaSpesa,
  type DatiSpesaAccessoria,
  type TipoSpesa,
} from '../../domain/clienti/spesa-accessoria'
import { PrismaService } from '../../infrastructure/persistence/prisma.service'
import { nelContestoTenant } from '../pese/nel-contesto-tenant'
import {
  confrontaVersione,
  scriviCondizionato,
  traduciErrorePrisma,
  type DescrizioneEntita,
  type VincoliNoti,
} from './anagrafica-versionata'
import { COLONNE_SPESA, contaUsi, type ClientUsi } from './uso-tabelle-fatturazione'

const ENTITA: DescrizioneEntita = {
  prefisso: 'SPESA_ACCESSORIA',
  soggetto: 'La spesa accessoria',
  femminile: true,
}

/** Unica chiave unica di business: (azienda, tipo, codice). */
const VINCOLI: VincoliNoti = {
  spese_accessorie_tenant_id_tipo_codice_key: {
    codice: 'SPESA_ACCESSORIA_CODICE_DUPLICATO',
    messaggio: 'Esiste già una spesa dello stesso tipo con questo codice.',
  },
}

export interface SpesaVista extends DatiSpesaAccessoria {
  id: string
  attiva: boolean
  versione: number
  /** Nessun cliente o contratto la cita: si puo' cancellare invece di disattivare. */
  eliminabile: boolean
}

export type ModificaSpesa = Partial<DatiSpesaAccessoria> & {
  attiva?: boolean
  versione: number
}

type RigaSpesa = {
  id: string
  tipo: string
  codice: string
  descrizione: string
  importo: Prisma.Decimal
  attiva: boolean
  versione: number
}

/** Campi modificabili, nell'ordine in cui compaiono in scrittura e nell'audit. */
const CAMPI = ['tipo', 'codice', 'descrizione', 'importo', 'attiva'] as const
type Campo = (typeof CAMPI)[number]

const datiDi = (r: RigaSpesa): DatiSpesaAccessoria & { attiva: boolean } => ({
  tipo: r.tipo as TipoSpesa,
  codice: r.codice,
  descrizione: r.descrizione,
  importo: r.importo.toFixed(2),
  attiva: r.attiva,
})

async function comeVista(
  r: RigaSpesa,
  tenantId: string,
  client: ClientUsi,
  usiNoti?: number
): Promise<SpesaVista> {
  const usi = usiNoti ?? (await contaUsi(client, tenantId, [r.id], COLONNE_SPESA)).get(r.id) ?? 0
  return {
    id: r.id,
    ...datiDi(r),
    versione: r.versione,
    eliminabile: usi === 0,
  }
}

function validaOLancia(dati: DatiSpesaAccessoria): void {
  const errori = validaSpesa(dati)
  if (errori.length > 0) {
    throw new BadRequestException({ message: errori, error: 'SPESA_ACCESSORIA_NON_VALIDA' })
  }
}

const nonTrovata = () =>
  new NotFoundException({
    message: 'Spesa accessoria non trovata.',
    error: 'SPESA_ACCESSORIA_NON_TROVATA',
  })

const uguali = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

@Injectable()
export class SpeseAccessorieService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    tenantId: string,
    filtri: { tipo?: TipoSpesa; incluseDisattivate: boolean }
  ): Promise<SpesaVista[]> {
    return nelContestoTenant(tenantId, async () => {
      const righe = await this.prisma.spesaAccessoria.findMany({
        where: {
          tenantId,
          ...(filtri.tipo ? { tipo: filtri.tipo } : {}),
          ...(filtri.incluseDisattivate ? {} : { attiva: true }),
        },
        orderBy: [{ attiva: 'desc' }, { tipo: 'asc' }, { codice: 'asc' }],
      })
      const usi = await contaUsi(
        this.prisma,
        tenantId,
        righe.map(r => r.id),
        COLONNE_SPESA
      )
      return Promise.all(righe.map(r => comeVista(r, tenantId, this.prisma, usi.get(r.id) ?? 0)))
    })
  }

  async getById(tenantId: string, id: string): Promise<SpesaVista> {
    return nelContestoTenant(tenantId, async () => {
      const riga = await this.prisma.spesaAccessoria.findFirst({ where: { id, tenantId } })
      if (!riga) throw nonTrovata()
      return comeVista(riga, tenantId, this.prisma)
    })
  }

  async crea(tenantId: string, utenteId: string, dati: DatiSpesaAccessoria): Promise<SpesaVista> {
    const valori = normalizzaSpesa(dati)
    validaOLancia(valori)
    return nelContestoTenant(tenantId, () =>
      this.prisma
        .$transaction(async tx => {
          const riga = await tx.spesaAccessoria.create({ data: { tenantId, ...valori } })
          await this.audit(tx, tenantId, utenteId, 'SPESA_ACCESSORIA_CREATA', 'creata', {
            spesaId: riga.id,
            tipo: riga.tipo,
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
    m: ModificaSpesa
  ): Promise<SpesaVista> {
    return nelContestoTenant(tenantId, () =>
      this.prisma
        .$transaction(async tx => {
          // R24: se si tocca il tipo, la riga si blocca FOR UPDATE prima di leggerla e contare gli
          // usi: un cliente che la sceglie in parallelo (FOR SHARE) aspetta o fa fallire il cambio.
          if (m.tipo !== undefined) {
            await tx.$queryRaw`SELECT id FROM "spese_accessorie"
              WHERE id = ${id}::uuid AND tenant_id = ${tenantId}::uuid FOR UPDATE`
          }
          const prima = await tx.spesaAccessoria.findFirst({ where: { id, tenantId } })
          if (!prima) throw nonTrovata()
          confrontaVersione(prima.versione, m.versione, ENTITA)

          const attuali = datiDi(prima)
          const unione = normalizzaSpesa({
            ...attuali,
            ...Object.fromEntries(Object.entries(m).filter(([, v]) => v !== undefined)),
          })
          validaOLancia(unione)
          const nuovi: Record<Campo, unknown> = { ...unione, attiva: m.attiva ?? attuali.attiva }

          const campi = CAMPI.filter(c => !uguali(nuovi[c], attuali[c]))
          if (campi.length === 0) return comeVista(prima, tenantId, tx)
          if (campi.includes('tipo')) {
            const usi = (await contaUsi(tx, tenantId, [id], COLONNE_SPESA)).get(id) ?? 0
            if (usi > 0) {
              throw new ConflictException({
                error: 'SPESA_ACCESSORIA_IN_USO',
                message: 'La spesa è usata da clienti o contratti: non se ne cambia il tipo.',
              })
            }
          }

          await scriviCondizionato(
            () =>
              tx.spesaAccessoria.updateMany({
                where: { id, tenantId, versione: m.versione },
                data: {
                  ...Object.fromEntries(campi.map(c => [c, nuovi[c]])),
                  versione: { increment: 1 },
                } as Prisma.SpesaAccessoriaUpdateManyMutationInput,
              }),
            ENTITA
          )
          const dopo = await tx.spesaAccessoria.findFirst({ where: { id, tenantId } })
          if (!dopo) throw nonTrovata()
          await this.audit(tx, tenantId, utenteId, 'SPESA_ACCESSORIA_MODIFICATA', 'modificata', {
            spesaId: id,
            tipo: dopo.tipo,
            codice: dopo.codice,
            campi,
          })
          return comeVista(dopo, tenantId, tx)
        })
        .catch(err => traduciErrorePrisma(err, ENTITA, VINCOLI))
    )
  }

  async elimina(tenantId: string, utenteId: string, id: string, versione: number): Promise<void> {
    return nelContestoTenant(tenantId, () =>
      this.prisma
        .$transaction(async tx => {
          const riga = await tx.spesaAccessoria.findFirst({ where: { id, tenantId } })
          if (!riga) throw nonTrovata()
          confrontaVersione(riga.versione, versione, ENTITA)
          await scriviCondizionato(
            () => tx.spesaAccessoria.deleteMany({ where: { id, tenantId, versione } }),
            ENTITA
          )
          await this.audit(tx, tenantId, utenteId, 'SPESA_ACCESSORIA_ELIMINATA', 'eliminata', {
            spesaId: id,
            tipo: riga.tipo,
            codice: riga.codice,
          })
        })
        .catch(err => traduciErrorePrisma(err, ENTITA, VINCOLI))
    )
  }

  /** Audit nella stessa transazione: solo id, tipo, codice e nomi dei campi (D16). */
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
        description: `Spesa accessoria ${esito}`,
        metadata: metadata as Prisma.InputJsonValue,
      },
    })
  }
}
