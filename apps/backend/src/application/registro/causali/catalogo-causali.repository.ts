import { ConflictException } from '@nestjs/common'
import type { Prisma } from '@prisma/client'
import {
  CatalogoCausali,
  type RigaCausaleAzienda,
  type RigaCausaleSistema,
  type RuoloMudCausale,
  type VersoCausale,
} from '../../../domain/waste-movement/catalogo-causali'

/** Riga di `causali_registro` come la restituisce Prisma (solo i campi che servono). */
interface RigaSistemaDb {
  codice: string
  verso: string
  descrizione: string
  ruoloMud: string
  codiceRentri: string | null
  operazione: string | null
  ordine: number
  attiva: boolean
}

/** Riga di `causali_registro_azienda` come la restituisce Prisma (colonne DATE = mezzanotte UTC). */
interface RigaAziendaDb {
  id: string
  natura: string
  codice: string
  verso: string
  descrizione: string | null
  ruoloMud: string | null
  codiceRentri: string | null
  operazione: string | null
  ordine: number
  validaDal: Date | null
  validaAl: Date | null
}

/**
 * Lettore minimo del catalogo delle causali, sul modello di `LettoreCatalogoCer`: lo soddisfano
 * `PrismaService`, `Prisma.TransactionClient` e i mock degli spec senza `as any`.
 */
export interface LettoreCatalogoCausali {
  causaleRegistro: {
    findMany(args: {
      orderBy: Array<{ verso: 'asc' } | { ordine: 'asc' }>
    }): Promise<RigaSistemaDb[]>
  }
  causaleRegistroAzienda: {
    findMany(args: { where: { tenantId: string } }): Promise<RigaAziendaDb[]>
  }
}

/**
 * Colonna `DATE` letta da Prisma (mezzanotte UTC) -> `AAAA-MM-GG`. Si legge la data UTC e non si
 * usa `giornoItaliano`: una colonna `DATE` e' gia' un giorno di calendario senza ora, e un fuso
 * applicato a mezzanotte UTC e' proprio cio' che la sposterebbe.
 */
export function dataColonnaComeGiorno(data: Date): string
export function dataColonnaComeGiorno(data: Date | null): string | null
export function dataColonnaComeGiorno(data: Date | null): string | null {
  return data ? data.toISOString().slice(0, 10) : null
}

/** Carica il catalogo di sistema e le personalizzazioni dell'azienda: due query per operazione. */
export async function caricaCatalogoCausali(
  db: LettoreCatalogoCausali,
  tenantId: string
): Promise<CatalogoCausali> {
  const [sistema, azienda] = await Promise.all([
    db.causaleRegistro.findMany({ orderBy: [{ verso: 'asc' }, { ordine: 'asc' }] }),
    db.causaleRegistroAzienda.findMany({ where: { tenantId } }),
  ])
  const righeSistema: RigaCausaleSistema[] = sistema.map(r => ({
    codice: r.codice,
    verso: r.verso as VersoCausale,
    descrizione: r.descrizione,
    ruoloMud: r.ruoloMud as RuoloMudCausale,
    codiceRentri: r.codiceRentri,
    operazione: r.operazione,
    ordine: r.ordine,
    attiva: r.attiva,
  }))
  const righeAzienda: RigaCausaleAzienda[] = azienda.map(r => ({
    id: r.id,
    natura: r.natura as RigaCausaleAzienda['natura'],
    codice: r.codice,
    verso: r.verso as VersoCausale,
    descrizione: r.descrizione,
    ruoloMud: r.ruoloMud as RuoloMudCausale | null,
    codiceRentri: r.codiceRentri,
    operazione: r.operazione,
    ordine: r.ordine,
    validaDal: dataColonnaComeGiorno(r.validaDal),
    validaAl: dataColonnaComeGiorno(r.validaAl),
  }))
  return new CatalogoCausali(righeSistema, righeAzienda)
}

interface RigaValidita {
  valida_dal: Date | null
  valida_al: Date | null
}

/**
 * Rilegge la versione aziendale DENTRO la transazione di insert del movimento con `FOR KEY SHARE`
 * (la chiave esterna del movimento tiene lo stesso lock fino al commit: una modifica concorrente
 * attende, una gia' avvenuta si vede qui). Se la versione non esiste piu' o non e' piu' valida al
 * giorno -> 409 `CAUSALE_MODIFICATA`.
 */
export async function confermaVersioneAzienda(
  tx: Prisma.TransactionClient,
  tenantId: string,
  versioneId: string,
  giorno: string
): Promise<void> {
  const righe = await tx.$queryRaw<RigaValidita[]>`
    SELECT valida_dal, valida_al
    FROM causali_registro_azienda
    WHERE id = ${versioneId}::uuid AND tenant_id = ${tenantId}::uuid AND natura = 'PROPRIA'
    FOR KEY SHARE`
  const dal = dataColonnaComeGiorno(righe[0]?.valida_dal ?? null)
  const al = dataColonnaComeGiorno(righe[0]?.valida_al ?? null)
  const valida = dal !== null && giorno >= dal && (al === null || giorno <= al)
  if (!valida) {
    throw new ConflictException({
      message: 'La causale è stata modificata nel frattempo: ricarica e riprova.',
      error: 'CAUSALE_MODIFICATA',
    })
  }
}
