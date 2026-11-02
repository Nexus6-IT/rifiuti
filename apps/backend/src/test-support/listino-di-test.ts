import { Prisma, PrismaClient, type GenereCodificaAddebito } from '@prisma/client'
import { creaDittaConRuolo } from './anagrafiche-di-test'

/**
 * Fixture del database per i test del listino 4.2a: due codici IVA e una codifica per ciascun
 * genere delle codifiche di addebito, nell'azienda indicata. Si usa col client PROPRIETARIO (che
 * aggira la RLS). Nessuna pulizia qui: le tabelle hanno FK a cascata su `tenants`, quindi basta
 * cancellare l'azienda di test per id (in caso di FK `NoAction` fra addebiti e codifiche, prima
 * gli addebiti, poi le codifiche, poi i codici IVA). Gli elenchi dei contratti (4.2b) vanno a
 * cascata col contratto.
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
  const codifica = (genere: GenereCodificaAddebito, descrizione: string) =>
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

export interface OpzioniContrattoConElenco {
  /** Stato del contratto; omesso = `ATTIVO`. */
  stato?: 'BOZZA' | 'ATTIVO' | 'SOSPESO' | 'SOSPESO_MOVIMENTI' | 'ANNULLATO'
  /** Cliente esistente; omesso = ne crea uno nuovo (P.IVA da `partitaIvaUnica`, R55). */
  clienteId?: string
  /** Codice dell'elenco; omesso = `001`. */
  codiceElenco?: string
  descrizioneElenco?: string
  predefinito?: boolean
  /** Contratto principale (contratto allegato, D17). */
  contrattoPrincipaleId?: string
}

/**
 * Crea (col client PROPRIETARIO) un cliente, un contratto in stato `ATTIVO` e un elenco degli
 * addebiti con il suo `001`. Tutto sparisce con la cancellazione dell'azienda di test.
 */
export async function creaContrattoConElenco(
  owner: PrismaClient,
  tenantId: string,
  opzioni: OpzioniContrattoConElenco = {}
): Promise<{ clienteId: string; contrattoId: string; elencoId: string }> {
  const clienteId =
    opzioni.clienteId ?? (await creaDittaConRuolo(owner, tenantId, 'CLIENTE')).ruoloId
  progressivo++
  const contratto = await owner.contrattoCliente.create({
    data: {
      tenantId,
      clienteId,
      numero: `LST-2026-${String(progressivo).padStart(4, '0')}`,
      descrizione: 'Contratto di prova per il listino',
      stato: opzioni.stato ?? 'ATTIVO',
      dataInizio: new Date('2026-01-01T00:00:00.000Z'),
      contrattoPrincipaleId: opzioni.contrattoPrincipaleId ?? null,
      // CHECK `annullo_coerente`: un contratto annullato porta motivo e data.
      ...(opzioni.stato === 'ANNULLATO'
        ? { motivoAnnullo: 'Annullato per il test', annullatoIl: new Date() }
        : {}),
    },
  })
  const elenco = await owner.elencoAddebiti.create({
    data: {
      tenantId,
      contrattoId: contratto.id,
      codice: opzioni.codiceElenco ?? '001',
      descrizione: opzioni.descrizioneElenco ?? 'Elenco di prova',
      predefinito: opzioni.predefinito ?? false,
    },
  })
  return { clienteId, contrattoId: contratto.id, elencoId: elenco.id }
}

export interface DatiRigaDiTest {
  /** Omesso: `V`. */
  tipo?: string
  /** Solo `CER`; omesso: `20 03 01`. */
  cerCode?: string
  /** Omesso e tipo non `CER`: ne crea uno nuovo (dello stesso tipo, se ammesso in archivio). */
  addebitoId?: string
  riferimento?: string | null
  codiceIvaId: string
  unitaMisura?: string
  prezzo?: string | null
  /** Altre colonne della riga (condizione, tipoQuantita, ...). */
  altro?: Partial<Prisma.RigaAddebitoUncheckedCreateInput>
}

/**
 * Crea (col client PROPRIETARIO) una riga di addebito in un elenco: `V` a peso netto in KG, a un
 * euro, se non si dice altro. Per un tipo non `CER` senza `addebitoId` crea un addebito
 * dell'archivio. Va a cascata con l'elenco.
 */
export async function creaRiga(
  owner: PrismaClient,
  tenantId: string,
  elencoId: string,
  dati: DatiRigaDiTest
): Promise<{ id: string; addebitoId: string | null }> {
  const tipo = dati.tipo ?? 'V'
  const eCer = tipo === 'CER'
  const addebitoId = eCer
    ? null
    : (dati.addebitoId ??
      (await creaAddebito(owner, tenantId, { tipo: tipo === 'V' || tipo === 'F' ? tipo : 'V' })).id)
  const riga = await owner.rigaAddebito.create({
    data: {
      tenantId,
      elencoId,
      tipo,
      cerCode: eCer ? (dati.cerCode ?? '20 03 01') : null,
      addebitoId,
      riferimento: dati.riferimento ?? null,
      tipoQuantita: eCer || tipo === 'V' ? 'PESO_NETTO' : null,
      unitaMisura: dati.unitaMisura ?? 'KG',
      prezzo: dati.prezzo === undefined ? '1' : dati.prezzo,
      codiceIvaId: dati.codiceIvaId,
      ...dati.altro,
    },
  })
  return { id: riga.id, addebitoId }
}

/**
 * Due voci per tabella RENTRI (`stati-fisici`, `attivita-rs`) con `externalId` noti: le crea
 * (col client PROPRIETARIO) solo se la tabella e' vuota, e restituisce gli id creati da cancellare
 * a fine test. Le voci sono le stesse del catalogo reale, se c'e'.
 */
export async function assicuraCodificheRentri(owner: PrismaClient): Promise<{
  statoFisico: string
  operazione: string
  creati: string[]
}> {
  const creati: string[] = []
  const voce = async (tabella: string, externalId: string) => {
    const esistente = await owner.rentriCodificaSemplice.findFirst({
      where: { tabella, presenteInRentri: true },
      select: { externalId: true },
    })
    if (esistente) return esistente.externalId
    const c = await owner.rentriCodificaSemplice.create({
      data: {
        tabella,
        externalId,
        code: `T${externalId}`,
        name: `Voce di prova ${tabella}`,
        fonte: 'test',
      },
    })
    creati.push(c.id)
    return c.externalId
  }
  return {
    statoFisico: await voce('stati-fisici', '9901'),
    operazione: await voce('attivita-rs', '9902'),
    creati,
  }
}
