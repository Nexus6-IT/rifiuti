// Registri IVA sezionali delle vendite (4.1a, D24): anagrafica per azienda con lock ottimistico
// (D14), disattivazione al posto della cancellazione quando il registro e' in uso (D13) e audit
// (D16). Le regole sui dati stanno in `domain/clienti/registro-iva`.
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import {
  normalizzaRegistro,
  validaRegistro,
  type DatiRegistroIva,
} from '../../domain/clienti/registro-iva'
import { PrismaService } from '../../infrastructure/persistence/prisma.service'
import { nelContestoTenant } from '../pese/nel-contesto-tenant'
import {
  confrontaVersione,
  scriviCondizionato,
  traduciErrorePrisma,
  type DescrizioneEntita,
  type VincoliNoti,
} from './anagrafica-versionata'

const ENTITA: DescrizioneEntita = {
  prefisso: 'REGISTRO_IVA',
  soggetto: 'Il registro IVA',
  femminile: false,
}

/** Unica chiave unica di business della tabella: il codice. */
const VINCOLI: VincoliNoti = {
  registri_iva_tenant_id_codice_key: {
    codice: 'REGISTRO_IVA_CODICE_DUPLICATO',
    messaggio: 'Esiste già un registro IVA con questo codice.',
  },
}

export interface RegistroIvaVista extends DatiRegistroIva {
  id: string
  attivo: boolean
  versione: number
  /** Nessun cliente o contratto lo cita: si puo' cancellare invece di disattivare. */
  eliminabile: boolean
}

export type ModificaRegistroIva = Partial<DatiRegistroIva> & {
  attivo?: boolean
  versione: number
}

type RigaRegistro = {
  id: string
  codice: string
  descrizione: string
  ricevuteSplit: boolean
  attivo: boolean
  versione: number
}

/** Campi modificabili, nell'ordine in cui compaiono in scrittura e nell'audit. */
const CAMPI = ['codice', 'descrizione', 'ricevuteSplit', 'attivo'] as const
type Campo = (typeof CAMPI)[number]

/**
 * Quante righe (clienti e contratti) citano il registro.
 * In 4.1a le tabelle referenti non esistono ancora: nessuno lo cita, quindi 0. Il conteggio reale
 * arriva con la 4.1b, quando esistono `clienti` e `contratti_cliente`.
 */
async function contaUsi(_tenantId: string, _id: string): Promise<number> {
  return 0
}

const datiDi = (r: RigaRegistro): DatiRegistroIva & { attivo: boolean } => ({
  codice: r.codice,
  descrizione: r.descrizione,
  ricevuteSplit: r.ricevuteSplit,
  attivo: r.attivo,
})

async function comeVista(r: RigaRegistro, tenantId: string): Promise<RegistroIvaVista> {
  return {
    id: r.id,
    codice: r.codice,
    descrizione: r.descrizione,
    ricevuteSplit: r.ricevuteSplit,
    attivo: r.attivo,
    versione: r.versione,
    eliminabile: (await contaUsi(tenantId, r.id)) === 0,
  }
}

function validaOLancia(dati: DatiRegistroIva): void {
  const errori = validaRegistro(dati)
  if (errori.length > 0) {
    throw new BadRequestException({ message: errori, error: 'REGISTRO_IVA_NON_VALIDO' })
  }
}

const nonTrovato = () =>
  new NotFoundException({
    message: 'Registro IVA non trovato.',
    error: 'REGISTRO_IVA_NON_TROVATO',
  })

const uguali = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

@Injectable()
export class RegistriIvaService {
  constructor(private readonly prisma: PrismaService) {}

  async list(tenantId: string, incluseDisattivate: boolean): Promise<RegistroIvaVista[]> {
    return nelContestoTenant(tenantId, async () => {
      const righe = await this.prisma.registroIva.findMany({
        where: incluseDisattivate ? { tenantId } : { tenantId, attivo: true },
        orderBy: [{ attivo: 'desc' }, { codice: 'asc' }],
      })
      return Promise.all(righe.map(r => comeVista(r, tenantId)))
    })
  }

  async getById(tenantId: string, id: string): Promise<RegistroIvaVista> {
    return nelContestoTenant(tenantId, async () => {
      const riga = await this.prisma.registroIva.findFirst({ where: { id, tenantId } })
      if (!riga) throw nonTrovato()
      return comeVista(riga, tenantId)
    })
  }

  async crea(tenantId: string, utenteId: string, dati: DatiRegistroIva): Promise<RegistroIvaVista> {
    const valori = normalizzaRegistro(dati)
    validaOLancia(valori)
    return nelContestoTenant(tenantId, () =>
      this.prisma
        .$transaction(async tx => {
          const riga = await tx.registroIva.create({ data: { tenantId, ...valori } })
          await this.audit(tx, tenantId, utenteId, 'REGISTRO_IVA_CREATO', 'creato', {
            registroId: riga.id,
            codice: riga.codice,
          })
          return comeVista(riga, tenantId)
        })
        .catch(err => traduciErrorePrisma(err, ENTITA, VINCOLI))
    )
  }

  async modifica(
    tenantId: string,
    utenteId: string,
    id: string,
    m: ModificaRegistroIva
  ): Promise<RegistroIvaVista> {
    return nelContestoTenant(tenantId, () =>
      this.prisma
        .$transaction(async tx => {
          const prima = await tx.registroIva.findFirst({ where: { id, tenantId } })
          if (!prima) throw nonTrovato()
          confrontaVersione(prima.versione, m.versione, ENTITA)

          const attuali = datiDi(prima)
          const unione = normalizzaRegistro({
            ...attuali,
            ...Object.fromEntries(Object.entries(m).filter(([, v]) => v !== undefined)),
          })
          validaOLancia(unione)
          const nuovi: Record<Campo, unknown> = { ...unione, attivo: m.attivo ?? attuali.attivo }

          const campi = CAMPI.filter(c => !uguali(nuovi[c], attuali[c]))
          if (campi.length === 0) return comeVista(prima, tenantId)

          await scriviCondizionato(
            () =>
              tx.registroIva.updateMany({
                where: { id, tenantId, versione: m.versione },
                data: {
                  ...Object.fromEntries(campi.map(c => [c, nuovi[c]])),
                  versione: { increment: 1 },
                } as Prisma.RegistroIvaUpdateManyMutationInput,
              }),
            ENTITA
          )
          const dopo = await tx.registroIva.findFirst({ where: { id, tenantId } })
          if (!dopo) throw nonTrovato()
          await this.audit(tx, tenantId, utenteId, 'REGISTRO_IVA_MODIFICATO', 'modificato', {
            registroId: id,
            codice: dopo.codice,
            campi,
          })
          return comeVista(dopo, tenantId)
        })
        .catch(err => traduciErrorePrisma(err, ENTITA, VINCOLI))
    )
  }

  async elimina(tenantId: string, utenteId: string, id: string, versione: number): Promise<void> {
    return nelContestoTenant(tenantId, () =>
      this.prisma
        .$transaction(async tx => {
          const riga = await tx.registroIva.findFirst({ where: { id, tenantId } })
          if (!riga) throw nonTrovato()
          confrontaVersione(riga.versione, versione, ENTITA)
          await scriviCondizionato(
            () => tx.registroIva.deleteMany({ where: { id, tenantId, versione } }),
            ENTITA
          )
          await this.audit(tx, tenantId, utenteId, 'REGISTRO_IVA_ELIMINATO', 'eliminato', {
            registroId: id,
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
        description: `Registro IVA ${esito}`,
        metadata: metadata as Prisma.InputJsonValue,
      },
    })
  }
}
