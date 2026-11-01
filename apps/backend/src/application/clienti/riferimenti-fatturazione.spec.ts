import { controllaRiferimenti } from './riferimenti-fatturazione'

const T = 'aaaaaaaa-0000-4000-8000-000000000001'
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

/** tx finto: `$queryRaw` risponde con le righe della tabella nominata nel testo SQL. */
function creaTx(righe: Record<string, Array<Record<string, unknown>>> = {}) {
  const chiamate: string[] = []
  const tx = {
    $queryRaw: jest.fn(async (strings: TemplateStringsArray) => {
      const sql = strings.join('?')
      const tabella = Object.keys(righe).find(t => sql.includes(`FROM "${t}"`))
      chiamate.push(sql)
      return tabella ? righe[tabella] : []
    }),
  }
  return { tx: tx as never, chiamate, raw: tx.$queryRaw }
}

const MSG = {
  condizione: 'La condizione di pagamento scelta non esiste o è disattivata.',
  conto: 'Il conto corrente scelto non esiste o è disattivato.',
  incasso: 'La spesa di incasso scelta non esiste, è disattivata o non è una spesa di incasso.',
  bollo: 'La spesa di bollo scelta non esiste, è disattivata o non è una spesa di bollo.',
  registro: 'Il registro IVA scelto non esiste o è disattivato.',
  split: 'Il registro delle ricevute split payment non si usa per le fatture del contratto.',
  agente: "L'agente scelto non esiste o è disattivato.",
  testo: 'Il testo di fatturazione scelto non esiste o è disattivato.',
  categoria: 'La categoria scelta non esiste o è disattivata.',
  tipo: 'Il tipo di contratto scelto non esiste o è disattivato.',
  motivo: 'Il motivo di annullo scelto non esiste o è disattivato.',
}

describe('controllaRiferimenti', () => {
  it('nessun riferimento: nessun messaggio e nessuna query', async () => {
    const { tx, raw } = creaTx()
    expect(await controllaRiferimenti(tx, T, {})).toEqual([])
    expect(
      await controllaRiferimenti(tx, T, {
        agenteId: null,
        bolloId: undefined,
        contoCorrenteId: null,
      })
    ).toEqual([])
    expect(raw).not.toHaveBeenCalled()
  })

  it('riferimenti validi: nessun messaggio, una query per tabella, FOR SHARE', async () => {
    const { tx, chiamate } = creaTx({
      condizioni_pagamento: [{ id: id(1), attivo: true }],
      conti_correnti: [{ id: id(2), attivo: true }],
      spese_accessorie: [
        { id: id(3), attivo: true, tipo: 'INCASSO' },
        { id: id(4), attivo: true, tipo: 'BOLLO' },
      ],
      registri_iva: [{ id: id(5), attivo: true, ricevuteSplit: false }],
      agenti: [{ id: id(6), attivo: true }],
      testi_fatturazione: [{ id: id(7), attivo: true }],
      codifiche_contratto: [
        { id: id(8), attivo: true, genere: 'CATEGORIA' },
        { id: id(9), attivo: true, genere: 'TIPO' },
        { id: id(10), attivo: true, genere: 'MOTIVO_ANNULLO' },
      ],
    })
    const m = await controllaRiferimenti(tx, T, {
      condizionePagamentoId: id(1),
      contoCorrenteId: id(2),
      speseIncassoId: id(3),
      bolloId: id(4),
      registroIvaId: id(5),
      agenteId: id(6),
      testoFatturazioneId: id(7),
      categoriaId: id(8),
      tipoId: id(9),
      motivoAnnulloId: id(10),
    })
    expect(m).toEqual([])
    expect(chiamate).toHaveLength(7)
    for (const sql of chiamate) expect(sql).toContain('FOR SHARE')
  })

  it('ogni riferimento inesistente: il suo messaggio, nell’ordine dei campi', async () => {
    const { tx } = creaTx()
    const m = await controllaRiferimenti(tx, T, {
      motivoAnnulloId: id(10),
      agenteId: id(6),
      condizionePagamentoId: id(1),
      contoCorrenteId: id(2),
      speseIncassoId: id(3),
      bolloId: id(4),
      registroIvaId: id(5),
      testoFatturazioneId: id(7),
      categoriaId: id(8),
      tipoId: id(9),
    })
    expect(m).toEqual([
      MSG.condizione,
      MSG.conto,
      MSG.incasso,
      MSG.bollo,
      MSG.registro,
      MSG.agente,
      MSG.testo,
      MSG.categoria,
      MSG.tipo,
      MSG.motivo,
    ])
  })

  it('riferimento disattivato: il suo messaggio', async () => {
    const { tx } = creaTx({
      conti_correnti: [{ id: id(2), attivo: false }],
      agenti: [{ id: id(6), attivo: false }],
    })
    expect(await controllaRiferimenti(tx, T, { contoCorrenteId: id(2), agenteId: id(6) })).toEqual([
      MSG.conto,
      MSG.agente,
    ])
  })

  it('spesa di incasso nel bollo: messaggio del bollo; bollo nelle spese di incasso: quello dell’incasso', async () => {
    const { tx } = creaTx({
      spese_accessorie: [
        { id: id(3), attivo: true, tipo: 'INCASSO' },
        { id: id(4), attivo: true, tipo: 'BOLLO' },
      ],
    })
    expect(await controllaRiferimenti(tx, T, { bolloId: id(3) })).toEqual([MSG.bollo])
    expect(await controllaRiferimenti(tx, T, { speseIncassoId: id(4) })).toEqual([MSG.incasso])
  })

  it('spesa disattivata: il messaggio del suo campo', async () => {
    const { tx } = creaTx({ spese_accessorie: [{ id: id(3), attivo: false, tipo: 'INCASSO' }] })
    expect(await controllaRiferimenti(tx, T, { speseIncassoId: id(3) })).toEqual([MSG.incasso])
  })

  it('stessa spesa per i due campi: una sola riga letta', async () => {
    const { tx, raw } = creaTx({ spese_accessorie: [{ id: id(3), attivo: true, tipo: 'INCASSO' }] })
    expect(await controllaRiferimenti(tx, T, { speseIncassoId: id(3), bolloId: id(3) })).toEqual([
      MSG.bollo,
    ])
    expect(raw).toHaveBeenCalledTimes(1)
  })

  it('registro delle ricevute split: messaggio di D24; disattivato: quello del registro', async () => {
    const { tx } = creaTx({
      registri_iva: [
        { id: id(5), attivo: true, ricevuteSplit: true },
        { id: id(55), attivo: false, ricevuteSplit: false },
      ],
    })
    expect(await controllaRiferimenti(tx, T, { registroIvaId: id(5) })).toEqual([MSG.split])
    expect(await controllaRiferimenti(tx, T, { registroIvaId: id(55) })).toEqual([MSG.registro])
  })

  it('codifica del genere sbagliato (TIPO come categoria): messaggio della categoria', async () => {
    const { tx } = creaTx({
      codifiche_contratto: [
        { id: id(8), attivo: true, genere: 'TIPO' },
        { id: id(9), attivo: true, genere: 'CATEGORIA' },
        { id: id(10), attivo: true, genere: 'CATEGORIA' },
      ],
    })
    expect(
      await controllaRiferimenti(tx, T, {
        categoriaId: id(8),
        tipoId: id(9),
        motivoAnnulloId: id(10),
      })
    ).toEqual([MSG.categoria, MSG.tipo, MSG.motivo])
  })

  it('più errori: ordine dei campi, qualunque sia l’ordine di scrittura', async () => {
    const { tx } = creaTx({ agenti: [{ id: id(6), attivo: true }] })
    expect(
      await controllaRiferimenti(tx, T, {
        agenteId: id(6),
        registroIvaId: id(5),
        contoCorrenteId: id(2),
      })
    ).toEqual([MSG.conto, MSG.registro])
  })

  it('i messaggi non riportano id', async () => {
    const { tx } = creaTx()
    const m = await controllaRiferimenti(tx, T, { agenteId: id(6) })
    expect(m.join(' ')).not.toContain(id(6))
  })
})
