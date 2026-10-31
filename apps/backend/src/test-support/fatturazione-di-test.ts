import { PrismaClient } from '@prisma/client'

/**
 * Fixture del database per i test del pezzo 4.1: una riga minima per ciascuna delle sei tabelle
 * di fatturazione, nell'azienda indicata. Si usa col client PROPRIETARIO (che aggira la RLS).
 * Nessuna pulizia qui: le tabelle hanno FK a cascata su `tenants`, quindi basta cancellare
 * l'azienda di test per id.
 */
export interface TabelleFatturazioneDiTest {
  condizioneId: string
  contoId: string
  speseId: string
  bolloId: string
  registroId: string
  registroSplitId: string
  testoId: string
  categoriaId: string
  tipoId: string
  motivoId: string
}

export async function creaTabelleFatturazione(
  owner: PrismaClient,
  tenantId: string
): Promise<TabelleFatturazioneDiTest> {
  const condizione = await owner.condizionePagamento.create({
    data: {
      tenantId,
      codice: 'BB30',
      descrizione: 'Bonifico 30 giorni',
      modalita: 'MP05',
      giorniRate: [30],
    },
  })
  const conto = await owner.contoCorrente.create({
    data: {
      tenantId,
      codice: 'C1',
      descrizione: 'Conto principale',
      banca: 'Banca di prova',
      iban: 'IT60X0542811101000000123456',
    },
  })
  const spese = await owner.spesaAccessoria.create({
    data: {
      tenantId,
      tipo: 'INCASSO',
      codice: 'INC',
      descrizione: 'Spese di incasso',
      importo: '2.50',
    },
  })
  const bollo = await owner.spesaAccessoria.create({
    data: { tenantId, tipo: 'BOLLO', codice: 'BOL', descrizione: 'Bollo', importo: '2.00' },
  })
  const registro = await owner.registroIva.create({
    data: { tenantId, codice: '01', descrizione: 'Vendite' },
  })
  const registroSplit = await owner.registroIva.create({
    data: { tenantId, codice: '02', descrizione: 'Ricevute split payment', ricevuteSplit: true },
  })
  const testo = await owner.testoFatturazione.create({
    data: { tenantId, codice: 'T1', titolo: 'Testo di prova', righe: ['Prima riga'] },
  })
  const categoria = await owner.codificaContratto.create({
    data: { tenantId, genere: 'CATEGORIA', codice: '001', descrizione: 'Categoria di prova' },
  })
  const tipo = await owner.codificaContratto.create({
    data: { tenantId, genere: 'TIPO', codice: '001', descrizione: 'Tipo di prova' },
  })
  const motivo = await owner.codificaContratto.create({
    data: { tenantId, genere: 'MOTIVO_ANNULLO', codice: '001', descrizione: 'Motivo di prova' },
  })
  return {
    condizioneId: condizione.id,
    contoId: conto.id,
    speseId: spese.id,
    bolloId: bollo.id,
    registroId: registro.id,
    registroSplitId: registroSplit.id,
    testoId: testo.id,
    categoriaId: categoria.id,
    tipoId: tipo.id,
    motivoId: motivo.id,
  }
}
