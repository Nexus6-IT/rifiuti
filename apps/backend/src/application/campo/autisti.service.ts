// Anagrafica degli autisti (app campo, P1). Mutabile, mai cancellata: si disattiva.
import { Injectable } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { PrismaService } from '../../infrastructure/persistence/prisma.service'
import { nelContestoTenant } from '../pese/nel-contesto-tenant'
import { normalizzaDatiAutista, type ValoriAutista } from './autisti.input'
import type { AutistaVista, DatiAutista } from './autisti.tipi'
import {
  AutistaDatiNonValidiError,
  AutistaDuplicatoError,
  AutistaNonTrovatoError,
} from './errori-campo'

type RigaAutista = {
  id: string
  nome: string
  cognome: string
  codiceFiscale: string | null
  trasportatoreId: string | null
  patenteNumero: string | null
  patenteCategoria: string | null
  patenteScadenza: Date | null
  cqcScadenza: Date | null
  adrScadenza: Date | null
  telefono: string | null
  userId: string | null
  attivo: boolean
}

const giorno = (d: Date | null): string | null => (d ? d.toISOString().slice(0, 10) : null)

export function comeAutistaVista(r: RigaAutista): AutistaVista {
  return {
    id: r.id,
    nome: r.nome,
    cognome: r.cognome,
    codiceFiscale: r.codiceFiscale,
    trasportatoreId: r.trasportatoreId,
    patenteNumero: r.patenteNumero,
    patenteCategoria: r.patenteCategoria,
    patenteScadenza: giorno(r.patenteScadenza),
    cqcScadenza: giorno(r.cqcScadenza),
    adrScadenza: giorno(r.adrScadenza),
    telefono: r.telefono,
    userId: r.userId,
    attivo: r.attivo,
  }
}

const eUnicita = (err: unknown) =>
  err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'

@Injectable()
export class AutistiService {
  constructor(private readonly prisma: PrismaService) {}

  async elenca(tenantId: string, opzioni: { soloAttivi?: boolean } = {}): Promise<AutistaVista[]> {
    return nelContestoTenant(tenantId, async () => {
      const righe = await this.prisma.autista.findMany({
        where: { tenantId, ...(opzioni.soloAttivi ? { attivo: true } : {}) },
        orderBy: [{ attivo: 'desc' }, { cognome: 'asc' }, { nome: 'asc' }, { id: 'asc' }],
        take: 500,
      })
      return righe.map(comeAutistaVista)
    })
  }

  async crea(tenantId: string, utenteId: string, dati: DatiAutista): Promise<AutistaVista> {
    const valori = this.valida(dati)
    return nelContestoTenant(tenantId, async () => {
      try {
        return await this.prisma.$transaction(async tx => {
          await this.verificaRiferimenti(tx, tenantId, valori, null)
          const riga = await tx.autista.create({
            data: { tenantId, creatoDa: utenteId, ...valori },
          })
          return comeAutistaVista(riga)
        })
      } catch (err) {
        throw this.traduci(err)
      }
    })
  }

  async aggiorna(tenantId: string, id: string, dati: DatiAutista): Promise<AutistaVista> {
    const valori = this.valida(dati)
    return nelContestoTenant(tenantId, async () => {
      try {
        return await this.prisma.$transaction(async tx => {
          const esistente = await tx.autista.findFirst({
            where: { id, tenantId },
            select: { id: true },
          })
          if (!esistente) throw new AutistaNonTrovatoError()
          await this.verificaRiferimenti(tx, tenantId, valori, id)
          const riga = await tx.autista.update({
            where: { id_tenantId: { id, tenantId } },
            data: { ...valori, ...(dati.attivo === undefined ? {} : { attivo: dati.attivo }) },
          })
          return comeAutistaVista(riga)
        })
      } catch (err) {
        throw this.traduci(err)
      }
    })
  }

  // --- interni -----------------------------------------------------------------------------

  private valida(dati: DatiAutista): ValoriAutista {
    const e = normalizzaDatiAutista(dati)
    if (!e.ok) throw new AutistaDatiNonValidiError(e.messaggi)
    return e.valori
  }

  /** Trasportatore e utente stanno nell'azienda; l'utente e' un `AUTISTA` non gia' legato ad altri. */
  private async verificaRiferimenti(
    tx: Prisma.TransactionClient,
    tenantId: string,
    v: ValoriAutista,
    id: string | null
  ): Promise<void> {
    const messaggi: string[] = []
    if (v.trasportatoreId) {
      const t = await tx.trasportatore.findFirst({
        where: { id: v.trasportatoreId, tenantId },
        select: { id: true },
      })
      if (!t) messaggi.push('Trasportatore non trovato.')
    }
    if (v.userId) {
      const u = await tx.user.findFirst({
        where: { id: v.userId, tenantId },
        select: { role: true },
      })
      if (!u) messaggi.push('Utente non trovato.')
      else if (u.role !== 'AUTISTA') {
        messaggi.push('L’utente collegato deve avere il ruolo autista.')
      } else {
        const altro = await tx.autista.findFirst({
          where: { userId: v.userId, ...(id ? { NOT: { id } } : {}) },
          select: { id: true },
        })
        if (altro)
          throw new AutistaDuplicatoError('Questo utente è già collegato a un altro autista.')
      }
    }
    if (messaggi.length > 0) throw new AutistaDatiNonValidiError(messaggi)
  }

  private traduci(err: unknown): unknown {
    if (!eUnicita(err)) return err
    const campi = String((err as Prisma.PrismaClientKnownRequestError).meta?.target ?? '')
    return new AutistaDuplicatoError(
      campi.includes('user')
        ? 'Questo utente è già collegato a un altro autista.'
        : 'Esiste già un autista con questo codice fiscale.'
    )
  }
}
