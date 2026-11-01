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
