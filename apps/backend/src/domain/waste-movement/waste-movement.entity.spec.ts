import {
  WasteMovement,
  CAUSALI_CARICO,
  CAUSALI_SCARICO,
  TERMINE_REGISTRAZIONE_PRODUTTORE_GG,
} from './waste-movement.entity'

describe('WasteMovement — entità di dominio (art. 190 D.Lgs 152/2006)', () => {
  const TENANT = 'tenant-uuid-001'
  const TODAY  = new Date('2026-06-29T10:00:00.000Z')

  function buildProps(overrides: Partial<Parameters<typeof WasteMovement.create>[0]> = {}) {
    return {
      tenantId: TENANT,
      progressiveNumber: 1,
      progressiveYear: 2026,
      type: 'CARICO' as const,
      movementDate: TODAY,
      registrationDate: TODAY,
      causale: 'PRODUZIONE_INTERNA' as const,
      cerCode: '20 03 01',
      quantity: 100,
      unit: 'KG',
      ...overrides,
    }
  }

  // ─── Creazione ───────────────────────────────────────────────────────────────

  it('crea un movimento CARICO con tutti i campi obbligatori', () => {
    const m = WasteMovement.create(buildProps())
    expect(m.type).toBe('CARICO')
    expect(m.progressiveNumber).toBe(1)
    expect(m.progressiveYear).toBe(2026)
    expect(m.cerCode).toBe('20 03 01')
    expect(m.quantity).toBe(100)
    expect(m.entryHash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('crea un movimento SCARICO con causale valida', () => {
    const m = WasteMovement.create(
      buildProps({ type: 'SCARICO', causale: 'CONFERIMENTO_TRASPORTATORE' }),
    )
    expect(m.type).toBe('SCARICO')
    expect(m.causale).toBe('CONFERIMENTO_TRASPORTATORE')
  })

  // ─── Invarianti di dominio ───────────────────────────────────────────────────

  it('lancia errore se quantità <= 0', () => {
    expect(() => WasteMovement.create(buildProps({ quantity: 0 }))).toThrow(
      'La quantità deve essere maggiore di zero',
    )
    expect(() => WasteMovement.create(buildProps({ quantity: -5 }))).toThrow(
      'La quantità deve essere maggiore di zero',
    )
  })

  it('lancia errore se data registrazione precede data operazione', () => {
    const earlier = new Date(TODAY.getTime() - 60 * 60 * 1000) // 1 ora prima
    expect(() =>
      WasteMovement.create(buildProps({ registrationDate: earlier })),
    ).toThrow('La data di registrazione non può precedere la data di operazione')
  })

  it('lancia errore per causale CARICO usata su SCARICO', () => {
    expect(() =>
      WasteMovement.create(
        buildProps({ type: 'SCARICO', causale: 'PRODUZIONE_INTERNA' as any }),
      ),
    ).toThrow('Causale non valida per SCARICO')
  })

  it('lancia errore per causale SCARICO usata su CARICO', () => {
    expect(() =>
      WasteMovement.create(
        buildProps({ type: 'CARICO', causale: 'AVVIO_RECUPERO' as any }),
      ),
    ).toThrow('Causale non valida per CARICO')
  })

  // ─── Causali valide ──────────────────────────────────────────────────────────

  it.each(CAUSALI_CARICO)('accetta causale CARICO: %s', (causale) => {
    expect(() =>
      WasteMovement.create(buildProps({ type: 'CARICO', causale })),
    ).not.toThrow()
  })

  it.each(CAUSALI_SCARICO)('accetta causale SCARICO: %s', (causale) => {
    expect(() =>
      WasteMovement.create(buildProps({ type: 'SCARICO', causale })),
    ).not.toThrow()
  })

  // ─── Hash di vidimazione ─────────────────────────────────────────────────────

  it('l\'hash è determinista: stessi input → stesso hash', () => {
    const m1 = WasteMovement.create(buildProps())
    const m2 = WasteMovement.create(buildProps())
    expect(m1.entryHash).toBe(m2.entryHash)
  })

  it('l\'hash cambia al variare di un campo chiave (quantità)', () => {
    const m1 = WasteMovement.create(buildProps({ quantity: 100 }))
    const m2 = WasteMovement.create(buildProps({ quantity: 200 }))
    expect(m1.entryHash).not.toBe(m2.entryHash)
  })

  it('l\'hash cambia al variare del tipo', () => {
    const m1 = WasteMovement.create(buildProps({ type: 'CARICO', causale: 'PRODUZIONE_INTERNA' }))
    const m2 = WasteMovement.create(
      buildProps({ type: 'SCARICO', causale: 'AVVIO_RECUPERO' }),
    )
    expect(m1.entryHash).not.toBe(m2.entryHash)
  })

  // ─── Ritardo registrazione ───────────────────────────────────────────────────

  it('ritardoRegistrazioneGg = 0 quando registrato nei termini', () => {
    // Operazione: 2026-06-01; registrazione: 2026-06-10 (9 gg → nei 14 gg di calendario)
    const mov = new Date('2026-06-01T00:00:00.000Z')
    const reg = new Date('2026-06-10T00:00:00.000Z')
    const m = WasteMovement.create(buildProps({ movementDate: mov, registrationDate: reg }))
    expect(m.ritardoRegistrazioneGg).toBe(0)
  })

  it('ritardoRegistrazioneGg > 0 quando registrato fuori dai termini di legge', () => {
    const mov = new Date('2026-06-01T00:00:00.000Z')
    // 20 gg di calendario > 14 gg di calendario (proxy dei 10 gg lavorativi)
    const reg = new Date('2026-06-21T00:00:00.000Z')
    const m = WasteMovement.create(buildProps({ movementDate: mov, registrationDate: reg }))
    expect(m.ritardoRegistrazioneGg).toBe(20 - TERMINE_REGISTRAZIONE_PRODUTTORE_GG)
  })

  // ─── Ricostituzione ──────────────────────────────────────────────────────────

  it('ricostituzione bypass le validazioni (dati già verificati dal DB)', () => {
    const m = WasteMovement.reconstitute({
      id: 'some-id',
      tenantId: TENANT,
      progressiveNumber: 99,
      progressiveYear: 2025,
      type: 'CARICO',
      movementDate: TODAY,
      registrationDate: TODAY,
      causale: 'PRODUZIONE_INTERNA',
      cerCode: '20 03 01',
      quantity: 0, // Invalido, ma la ricostituzione non valida
      unit: 'KG',
      entryHash: 'a'.repeat(64),
    })
    expect(m.quantity).toBe(0)
    expect(m.progressiveNumber).toBe(99)
  })
})
