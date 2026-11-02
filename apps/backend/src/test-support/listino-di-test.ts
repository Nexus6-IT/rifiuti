import { PrismaClient } from '@prisma/client'

/**
 * Fixture del database per i test del listino 4.2a: due codici IVA e una codifica per ciascun
 * genere delle codifiche di addebito, nell'azienda indicata. Si usa col client PROPRIETARIO (che
 * aggira la RLS). Nessuna pulizia qui: le tabelle hanno FK a cascata su `tenants`, quindi basta
 * cancellare l'azienda di test per id (in caso di FK `NoAction` fra addebiti e codifiche, prima
 * gli addebiti, poi le codifiche, poi i codici IVA).
 */
export interface ListinoDiTest {
  /** Codice "22", aliquota 22.00, senza natura. */
  iva22Id: string
  /** Codice "N61", aliquota 0.00, natura N6.1. */
  ivaN61Id: string
  gruppoId: string
  categoriaId: string
  centroId: string
  stat1Id: string
  stat2Id: string
}

export async function creaCodiciIvaEcodifiche(
  owner: PrismaClient,
  tenantId: string
): Promise<ListinoDiTest> {
  const iva22 = await owner.codiceIva.create({
    data: { tenantId, codice: '22', descrizione: 'IVA ordinaria 22%', aliquota: '22.00' },
  })
  const ivaN61 = await owner.codiceIva.create({
    data: {
      tenantId,
      codice: 'N61',
      descrizione: 'Inversione contabile',
      aliquota: '0.00',
      natura: 'N6.1',
    },
  })
  const codifica = (genere: any, descrizione: string) =>
    owner.codificaAddebito.create({ data: { tenantId, genere, codice: '001', descrizione } })
  const gruppo = await codifica('GRUPPO', 'Gruppo di prova')
  const categoria = await codifica('CATEGORIA', 'Categoria di prova')
  const centro = await codifica('CENTRO_RICAVO', 'Centro di prova')
  const stat1 = await codifica('CATEGORIA_STATISTICA_1', 'Statistica 1 di prova')
  const stat2 = await codifica('CATEGORIA_STATISTICA_2', 'Statistica 2 di prova')
  return {
    iva22Id: iva22.id,
    ivaN61Id: ivaN61.id,
    gruppoId: gruppo.id,
    categoriaId: categoria.id,
    centroId: centro.id,
    stat1Id: stat1.id,
    stat2Id: stat2.id,
  }
}

export interface DatiAddebitoDiTest {
  /** Omesso: ne crea uno nuovo (genere GRUPPO) nell'azienda. */
  gruppoId?: string
  codice?: string
  descrizione?: string
  unitaMisura?: string
  tipo?: string
  attivo?: boolean
  codiceIvaId?: string | null
  categoriaId?: string | null
  centroRicavoId?: string | null
  categoriaStatistica1Id?: string | null
  categoriaStatistica2Id?: string | null
  /** Prezzo del listino 1 (stringa decimale); gli altri cinque restano vuoti. */
  prezzo1?: string | null
}

let progressivo = 0

/**
 * Crea un addebito (col client PROPRIETARIO) con i sei listini. Senza `codice` ne assegna uno
 * univoco a cinque cifre (a partire da 90000, lontano da quelli che i test chiedono
 * esplicitamente); senza `gruppoId` crea un gruppo nuovo (codice a tre cifre progressivo).
 */
export async function creaAddebito(
  owner: PrismaClient,
  tenantId: string,
  dati: DatiAddebitoDiTest = {}
): Promise<{ id: string; codice: string; gruppoId: string }> {
  const gruppoId =
    dati.gruppoId ??
    (
      await owner.codificaAddebito.create({
        data: {
          tenantId,
          genere: 'GRUPPO',
          codice: String(100 + (++progressivo % 899)),
          descrizione: 'Gruppo di prova',
        },
      })
    ).id
  const codice = (dati.codice ?? String(90000 + ++progressivo)).padStart(5, '0')
  const { prezzo1, ...resto } = dati
  const riga = await owner.addebito.create({
    data: {
      tenantId,
      codice,
      descrizione: dati.descrizione ?? 'Addebito di prova',
      gruppoId,
      unitaMisura: dati.unitaMisura ?? 'KG',
      tipo: dati.tipo ?? 'V',
      attivo: dati.attivo ?? true,
      codiceIvaId: resto.codiceIvaId ?? null,
      categoriaId: resto.categoriaId ?? null,
      centroRicavoId: resto.centroRicavoId ?? null,
      categoriaStatistica1Id: resto.categoriaStatistica1Id ?? null,
      categoriaStatistica2Id: resto.categoriaStatistica2Id ?? null,
    },
  })
  await owner.prezzoListinoAddebito.createMany({
    data: [1, 2, 3, 4, 5, 6].map(numero => ({
      tenantId,
      addebitoId: riga.id,
      numero,
      prezzo: numero === 1 ? (prezzo1 ?? null) : null,
    })),
  })
  return { id: riga.id, codice: riga.codice, gruppoId }
}
