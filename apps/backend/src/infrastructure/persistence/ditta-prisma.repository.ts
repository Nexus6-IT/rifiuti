/**
 * Implementazione Prisma del repository delle ditte e delle sedi (F2-10).
 *
 * Tutti i metodi ricevono il client (`tx` o quello normale) e mettono il `tenantId` del
 * TenantContext nel `where`: i client `PrismaService`/`tx` non applicano il filtro per tenant da
 * soli, e una `findUnique` per sola chiave primaria restituirebbe anche le righe di altre aziende.
 */
import { Injectable } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { TenantContext } from '../../core/context/tenant-context'
import { Ditta } from '../../domain/registry/entities/ditta'
import { RuoloControparte, SedeDitta } from '../../domain/registry/entities/sede-ditta'
import { Indirizzo } from '../../domain/registry/value-objects/indirizzo'
import { DittaRepository, RuoloDitta } from '../../domain/registry/repositories/ditta.repository'

export type ClientDitte = Prisma.TransactionClient

type RecordDitta = Prisma.DittaGetPayload<object>
type RecordSede = Prisma.SedeDittaGetPayload<object>

@Injectable()
export class DittaPrismaRepository implements DittaRepository<ClientDitte> {
  async bloccaIdentificativi(client: ClientDitte, valori: string[]): Promise<void> {
    const tenantId = TenantContext.requireTenantId()
    for (const valore of [...new Set(valori)].sort()) {
      const chiave = `ditta|${tenantId}|${valore}`
      await client.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${chiave}))`
    }
  }

  async bloccaSedi(client: ClientDitte, dittaId: string): Promise<void> {
    const tenantId = TenantContext.requireTenantId()
    const chiave = `ditta-sedi|${tenantId}|${dittaId}`
    await client.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${chiave}))`
  }

  async cercaPerIdentificativi(client: ClientDitte, valori: string[]): Promise<Ditta[]> {
    if (valori.length === 0) return []
    const tenantId = TenantContext.requireTenantId()
    const record = await client.ditta.findMany({
      where: {
        tenantId,
        OR: [{ partitaIva: { in: valori } }, { codiceFiscale: { in: valori } }],
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    })
    return record.map(r => this.dittaDaRecord(r))
  }

  async trovaPerId(client: ClientDitte, id: string): Promise<Ditta | null> {
    const tenantId = TenantContext.requireTenantId()
    const record = await client.ditta.findFirst({ where: { id, tenantId } })
    return record ? this.dittaDaRecord(record) : null
  }

  async trovaSede(client: ClientDitte, dittaId: string, sedeId: string): Promise<SedeDitta | null> {
    const tenantId = TenantContext.requireTenantId()
    const record = await client.sedeDitta.findFirst({ where: { id: sedeId, dittaId, tenantId } })
    return record ? this.sedeDaRecord(record) : null
  }

  async sedi(client: ClientDitte, dittaId: string): Promise<SedeDitta[]> {
    const tenantId = TenantContext.requireTenantId()
    const record = await client.sedeDitta.findMany({
      where: { dittaId, tenantId },
      orderBy: [{ principale: 'desc' }, { comune: 'asc' }, { via: 'asc' }, { id: 'asc' }],
    })
    return record.map(r => this.sedeDaRecord(r))
  }

  async crea(client: ClientDitte, ditta: Ditta): Promise<void> {
    const tenantId = TenantContext.requireTenantId()
    await client.ditta.create({
      data: {
        id: ditta.id,
        tenantId,
        ragioneSociale: ditta.ragioneSociale,
        partitaIva: ditta.partitaIva,
        codiceFiscale: ditta.codiceFiscale,
        createdAt: ditta.createdAt,
      },
    })
  }

  async aggiorna(client: ClientDitte, ditta: Ditta): Promise<void> {
    const tenantId = TenantContext.requireTenantId()
    await client.ditta.updateMany({
      where: { id: ditta.id, tenantId },
      data: {
        ragioneSociale: ditta.ragioneSociale,
        partitaIva: ditta.partitaIva,
        codiceFiscale: ditta.codiceFiscale,
      },
    })
  }

  async creaSede(client: ClientDitte, sede: SedeDitta): Promise<void> {
    const tenantId = TenantContext.requireTenantId()
    await client.sedeDitta.create({
      data: {
        id: sede.id,
        tenantId,
        dittaId: sede.dittaId,
        ...this.datiSede(sede),
        createdAt: sede.createdAt,
      },
    })
  }

  async aggiornaSede(client: ClientDitte, sede: SedeDitta): Promise<void> {
    const tenantId = TenantContext.requireTenantId()
    await client.sedeDitta.updateMany({
      where: { id: sede.id, dittaId: sede.dittaId, tenantId },
      data: this.datiSede(sede),
    })
  }

  async impostaPrincipale(client: ClientDitte, dittaId: string, sedeId: string): Promise<void> {
    const tenantId = TenantContext.requireTenantId()
    // prima si toglie, poi si mette: l'indice parziale ammette al massimo una principale
    await client.sedeDitta.updateMany({
      where: { dittaId, tenantId, principale: true },
      data: { principale: false },
    })
    await client.sedeDitta.updateMany({
      where: { id: sedeId, dittaId, tenantId },
      data: { principale: true },
    })
  }

  async ruoliDellaDitta(client: ClientDitte, dittaId: string): Promise<RuoloDitta[]> {
    const tenantId = TenantContext.requireTenantId()
    const where = { dittaId, tenantId }
    const select = { id: true, sedeId: true }
    const [produttori, trasportatori, destinatari, clienti, agenti] = await Promise.all([
      client.produttore.findMany({ where, select }),
      client.trasportatore.findMany({ where, select }),
      client.destinatario.findMany({ where, select }),
      client.cliente.findMany({ where, select }),
      client.agente.findMany({ where, select }),
    ])
    const dei = (ruolo: RuoloControparte, righe: Array<{ id: string; sedeId: string | null }>) =>
      righe.map(r => ({ ruolo, id: r.id, sedeId: r.sedeId }))
    return [
      ...dei('PRODUTTORE', produttori),
      ...dei('TRASPORTATORE', trasportatori),
      ...dei('DESTINATARIO', destinatari),
      ...dei('CLIENTE', clienti),
      ...dei('AGENTE', agenti),
    ]
  }

  private datiSede(sede: SedeDitta) {
    return {
      denominazione: sede.denominazione,
      via: sede.indirizzo.getVia(),
      civico: sede.indirizzo.getCivico(),
      cap: sede.indirizzo.getCAP(),
      comune: sede.indirizzo.getCitta(), // il dominio dice "citta", il database "comune"
      provincia: sede.indirizzo.getProvincia(),
      referente: sede.referente,
      email: sede.email,
      telefono: sede.telefono,
      pec: sede.pec,
      principale: sede.principale,
      attiva: sede.attiva,
    }
  }

  private dittaDaRecord(r: RecordDitta): Ditta {
    return Ditta.ripristina({
      id: r.id,
      ragioneSociale: r.ragioneSociale,
      partitaIva: r.partitaIva,
      codiceFiscale: r.codiceFiscale,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    })
  }

  private sedeDaRecord(r: RecordSede): SedeDitta {
    return SedeDitta.ripristina({
      id: r.id,
      dittaId: r.dittaId,
      indirizzo: Indirizzo.create({
        via: r.via,
        civico: r.civico,
        cap: r.cap,
        citta: r.comune,
        provincia: r.provincia,
      }),
      denominazione: r.denominazione,
      referente: r.referente,
      email: r.email,
      telefono: r.telefono,
      pec: r.pec,
      principale: r.principale,
      attiva: r.attiva,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    })
  }
}
