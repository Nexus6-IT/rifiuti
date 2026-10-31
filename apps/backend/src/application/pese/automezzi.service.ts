// Anagrafica degli automezzi (targa + rimorchio) con la tara. Mutabile, mai cancellata.
import { Injectable } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { ordineTara, pesoEffettivo } from '../../domain/pese/netto-accesso'
import { PESO_MASSIMO_KG } from '../../domain/pese/regole-pesata'
import { normalizzaTarga } from '../../domain/pese/targa'
import { PrismaService } from '../../infrastructure/persistence/prisma.service'
import {
  AutomezzoDuplicatoError,
  AutomezzoNonTrovatoError,
  DatiPesaNonValidiError,
  PesataNonTrovataError,
  RegolaPesataError,
  TrasportatoreNonTrovatoError,
} from './errori-pese'
import { nelContestoTenant } from './nel-contesto-tenant'

export interface DatiAutomezzo {
  targa: string
  targaRimorchio?: string | null
  trasportatoreId?: string | null
  note?: string | null
  /** Solo in aggiornamento: se assente resta invariato. */
  attivo?: boolean
}

export type RichiestaTara = { taraKg: number } | { pesataId: string }

export interface AutomezzoVista {
  id: string
  targa: string
  targaRimorchio: string | null
  trasportatoreId: string | null
  taraKg: number | null
  taraOrigine: 'DICHIARATA' | 'PESATA' | null
  taraPesataId: string | null
  taraAggiornataIl: string | null
  ultimaPesataVuotoIl: string | null
  note: string | null
  attivo: boolean
}

type RigaAutomezzo = {
  id: string
  targa: string
  targaRimorchio: string | null
  trasportatoreId: string | null
  taraKg: Prisma.Decimal | number | null
  taraOrigine: 'DICHIARATA' | 'PESATA' | null
  taraPesataId: string | null
  taraAggiornataIl: Date | null
  ultimaPesataVuotoIl: Date | null
  note: string | null
  attivo: boolean
}

export function comeAutomezzoVista(r: RigaAutomezzo): AutomezzoVista {
  return {
    id: r.id,
    targa: r.targa,
    targaRimorchio: r.targaRimorchio,
    trasportatoreId: r.trasportatoreId,
    taraKg: r.taraKg === null ? null : Number(r.taraKg),
    taraOrigine: r.taraOrigine,
    taraPesataId: r.taraPesataId,
    taraAggiornataIl: r.taraAggiornataIl ? r.taraAggiornataIl.toISOString() : null,
    ultimaPesataVuotoIl: r.ultimaPesataVuotoIl ? r.ultimaPesataVuotoIl.toISOString() : null,
    note: r.note,
    attivo: r.attivo,
  }
}

/** Il testo libero delle note non entra nell'audit: ci va solo il flag `noteModificate`. */
function senzaNote(v: AutomezzoVista): Omit<AutomezzoVista, 'note'> {
  const { note: _note, ...resto } = v
  return resto
}

const eIndiceUnico = (err: unknown) =>
  (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') ||
  // l'indice a espressione `automezzi_targhe_uniche` e' solo SQL: il driver puo' non mapparlo
  (typeof (err as { message?: unknown })?.message === 'string' &&
    (err as { message: string }).message.includes('automezzi_targhe_uniche'))

function validaDati(dati: DatiAutomezzo) {
  const messaggi: string[] = []
  const targa = normalizzaTarga(dati.targa ?? '')
  if (!targa) messaggi.push('Targa non valida.')
  let targaRimorchio: string | null = null
  if (dati.targaRimorchio?.trim()) {
    targaRimorchio = normalizzaTarga(dati.targaRimorchio)
    if (!targaRimorchio) messaggi.push('Targa del rimorchio non valida.')
  }
  const note = dati.note?.trim() ? dati.note.trim() : null
  if ((note?.length ?? 0) > 500) messaggi.push('Le note possono avere al massimo 500 caratteri.')
  if (messaggi.length > 0 || !targa) throw new DatiPesaNonValidiError(messaggi)
  return { targa, targaRimorchio, note }
}

function validaTara(taraKg: number): void {
  const ok =
    Number.isFinite(taraKg) &&
    taraKg > 0 &&
    taraKg <= PESO_MASSIMO_KG &&
    Math.abs(taraKg * 100 - Math.round(taraKg * 100)) < 1e-6
  if (!ok) {
    throw new DatiPesaNonValidiError([
      'La tara deve essere maggiore di zero, con al massimo due decimali.',
    ])
  }
}

@Injectable()
export class AutomezziService {
  constructor(private readonly prisma: PrismaService) {}

  async elenca(tenantId: string, targa?: string): Promise<AutomezzoVista[]> {
    const ricerca = targa?.toUpperCase().replace(/[^A-Z0-9]/g, '')
    return nelContestoTenant(tenantId, async () => {
      const righe = await this.prisma.automezzo.findMany({
        where: { tenantId, ...(ricerca ? { targa: { contains: ricerca } } : {}) },
        orderBy: [{ attivo: 'desc' }, { targa: 'asc' }, { targaRimorchio: 'asc' }],
        take: 500,
      })
      return righe.map(comeAutomezzoVista)
    })
  }

  async crea(tenantId: string, utenteId: string, dati: DatiAutomezzo): Promise<AutomezzoVista> {
    const { targa, targaRimorchio, note } = validaDati(dati)
    return nelContestoTenant(tenantId, () =>
      this.prisma
        .$transaction(async tx => {
          await this.bloccaTarghe(tx, tenantId, targa, targaRimorchio)
          if (dati.trasportatoreId) {
            await this.verificaTrasportatore(tx, tenantId, dati.trasportatoreId)
          }
          if (await this.esisteConTarghe(tx, tenantId, targa, targaRimorchio, null)) {
            throw new AutomezzoDuplicatoError()
          }
          const riga = await tx.automezzo.create({
            data: {
              tenantId,
              targa,
              targaRimorchio,
              trasportatoreId: dati.trasportatoreId ?? null,
              note,
              creatoDa: utenteId,
            },
          })
          await tx.activityLog.create({
            data: {
              tenantId,
              userId: utenteId,
              action: 'PESA_AUTOMEZZO_SALVATO',
              description: 'Automezzo creato',
              metadata: { automezzoId: riga.id } as Prisma.InputJsonValue,
            },
          })
          return comeAutomezzoVista(riga)
        })
        .catch(err => {
          throw eIndiceUnico(err) ? new AutomezzoDuplicatoError() : err
        })
    )
  }

  async aggiorna(
    tenantId: string,
    utenteId: string,
    id: string,
    dati: DatiAutomezzo
  ): Promise<AutomezzoVista> {
    const { targa, targaRimorchio, note } = validaDati(dati)
    return nelContestoTenant(tenantId, () =>
      this.prisma
        .$transaction(async tx => {
          await this.bloccaTarghe(tx, tenantId, targa, targaRimorchio)
          const prima = await tx.automezzo.findFirst({ where: { id, tenantId } })
          if (!prima) throw new AutomezzoNonTrovatoError()
          if (dati.trasportatoreId) {
            await this.verificaTrasportatore(tx, tenantId, dati.trasportatoreId)
          }
          if (await this.esisteConTarghe(tx, tenantId, targa, targaRimorchio, id)) {
            throw new AutomezzoDuplicatoError()
          }
          const riga = await tx.automezzo.update({
            where: { id },
            data: {
              targa,
              targaRimorchio,
              trasportatoreId: dati.trasportatoreId ?? null,
              note,
              attivo: dati.attivo ?? prima.attivo,
            },
          })
          await tx.activityLog.create({
            data: {
              tenantId,
              userId: utenteId,
              action: 'PESA_AUTOMEZZO_SALVATO',
              description: 'Automezzo aggiornato',
              metadata: {
                automezzoId: id,
                prima: senzaNote(comeAutomezzoVista(prima)),
                dopo: senzaNote(comeAutomezzoVista(riga)),
                noteModificate: (prima.note ?? null) !== (riga.note ?? null),
              } as unknown as Prisma.InputJsonValue,
            },
          })
          return comeAutomezzoVista(riga)
        })
        .catch(err => {
          throw eIndiceUnico(err) ? new AutomezzoDuplicatoError() : err
        })
    )
  }

  /**
   * Imposta la tara: `{ taraKg }` = DICHIARATA; `{ pesataId }` = PESATA, col peso effettivo
   * (dopo le rettifiche) e la data della pesata. Il controllo del ruolo e' del controller.
   */
  async impostaTara(
    tenantId: string,
    utenteId: string,
    id: string,
    richiesta: RichiestaTara
  ): Promise<AutomezzoVista> {
    if ('taraKg' in richiesta) validaTara(richiesta.taraKg)
    return nelContestoTenant(tenantId, () =>
      this.prisma.$transaction(async tx => {
        const prima = await tx.automezzo.findFirst({ where: { id, tenantId } })
        if (!prima) throw new AutomezzoNonTrovatoError()
        let dati: Prisma.AutomezzoUncheckedUpdateInput
        if ('taraKg' in richiesta) {
          dati = {
            taraKg: richiesta.taraKg,
            taraOrigine: 'DICHIARATA',
            taraPesataId: null,
            taraAggiornataIl: new Date(),
            ultimaPesataVuotoIl: null,
          }
        } else {
          const pesata = await tx.pesata.findFirst({
            where: { id: richiesta.pesataId, tenantId },
            include: {
              rettifiche: true,
              accesso: {
                select: { stato: true, automezzoId: true, targa: true, modo: true, verso: true },
              },
            },
          })
          if (!pesata) throw new PesataNonTrovataError()
          if (pesata.fonte === 'TARA_ANAGRAFICA') {
            throw new RegolaPesataError([
              'Una tara dichiarata non può diventare la tara dell’automezzo: serve una pesata vera.',
            ])
          }
          if (!pesata.stabile) {
            throw new RegolaPesataError(['Una pesata instabile non è un peso.'])
          }
          if (pesata.accesso.stato === 'ANNULLATO') {
            throw new RegolaPesataError(['La pesata appartiene a un accesso annullato.'])
          }
          // `pesate.automezzo_id` e' valorizzato solo per TARA_ANAGRAFICA: il legame col mezzo
          // sta nell'accesso (automezzo scelto, oppure solo la targa digitata).
          const accesso = pesata.accesso
          if (accesso.automezzoId !== null) {
            if (accesso.automezzoId !== id) {
              throw new RegolaPesataError(['La pesata appartiene a un altro automezzo.'])
            }
          } else if (normalizzaTarga(accesso.targa ?? '') !== prima.targa) {
            throw new RegolaPesataError([
              'La targa della pesata non corrisponde a quella dell’automezzo.',
            ])
          }
          if (accesso.modo === 'SINGOLA') {
            throw new RegolaPesataError([
              'Una pesata singola è un netto letto dallo strumento: non è la tara del mezzo.',
            ])
          }
          if (pesata.ordine !== ordineTara(accesso.verso, accesso.modo)) {
            throw new RegolaPesataError([
              'La pesata indica il mezzo carico, non la tara: serve la pesata a vuoto.',
            ])
          }
          const peso = pesoEffettivo({
            ordine: pesata.ordine === 1 ? 1 : 2,
            fonte: pesata.fonte,
            pesoKg: Number(pesata.pesoKg),
            rettifiche: pesata.rettifiche.map(r => ({
              numero: r.numero,
              pesoNuovoKg: Number(r.pesoNuovoKg),
            })),
            stabile: pesata.stabile,
          })
          dati = {
            taraKg: peso,
            taraOrigine: 'PESATA',
            taraPesataId: pesata.id,
            taraAggiornataIl: pesata.oraRicezione,
            ultimaPesataVuotoIl: pesata.oraRicezione,
          }
        }
        const riga = await tx.automezzo.update({ where: { id }, data: dati })
        await tx.activityLog.create({
          data: {
            tenantId,
            userId: utenteId,
            action: 'PESA_TARA_IMPOSTATA',
            description: 'Tara dell’automezzo impostata',
            metadata: {
              automezzoId: id,
              precedente: prima.taraKg === null ? null : Number(prima.taraKg),
              nuova: Number(riga.taraKg),
              origine: riga.taraOrigine,
              pesataId: riga.taraPesataId,
            } as Prisma.InputJsonValue,
          },
        })
        return comeAutomezzoVista(riga)
      })
    )
  }

  /** Per gli accessi: legge l'automezzo dell'azienda dentro la transazione del chiamante. */
  async leggiPerAccesso(
    tx: Prisma.TransactionClient,
    tenantId: string,
    id: string
  ): Promise<AutomezzoVista> {
    const riga = await tx.automezzo.findFirst({ where: { id, tenantId } })
    if (!riga) throw new AutomezzoNonTrovatoError()
    return comeAutomezzoVista(riga)
  }

  private async bloccaTarghe(
    tx: Prisma.TransactionClient,
    tenantId: string,
    targa: string,
    targaRimorchio: string | null
  ): Promise<void> {
    const chiave = `automezzo|${tenantId}|${targa}|${targaRimorchio ?? ''}`
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${chiave}))`
  }

  private async esisteConTarghe(
    tx: Prisma.TransactionClient,
    tenantId: string,
    targa: string,
    targaRimorchio: string | null,
    escludiId: string | null
  ): Promise<boolean> {
    const altro = await tx.automezzo.findFirst({
      where: {
        tenantId,
        targa,
        targaRimorchio,
        ...(escludiId ? { NOT: { id: escludiId } } : {}),
      },
      select: { id: true },
    })
    return altro !== null
  }

  /**
   * `automezzi.trasportatore_id` e' una FK semplice (trasportatori non ha unique (id, tenant_id)):
   * il database accetterebbe il trasportatore di un'altra azienda. Lo si legge qui col client
   * della transazione, soggetto alla RLS dell'azienda corrente.
   */
  private async verificaTrasportatore(
    tx: Prisma.TransactionClient,
    tenantId: string,
    trasportatoreId: string
  ): Promise<void> {
    const t = await tx.trasportatore.findFirst({
      where: { id: trasportatoreId, tenantId },
      select: { id: true },
    })
    if (!t) throw new TrasportatoreNonTrovatoError()
  }
}
