import { FIR } from './fir.aggregate'
import { UnitaMisura } from '../value-objects/quantita'

/** Fase 3 (D4): il blocco all'invio a RENTRI sull'aggregate (sola lettura, valorizzato dal repository). */
describe("FIR: blocco all'invio a RENTRI (Fase 3)", () => {
  const emesso = (): FIR => {
    const fir = FIR.create({
      produttoreId: 'produttore-1',
      tenantId: 'tenant-1',
      rifiuto: { cerCode: '13 02 05*', quantita: 120, unitaMisura: UnitaMisura.KG },
      trasportatoreId: 'trasportatore-1',
      destinatarioId: 'destinatario-1',
    })
    fir.emetti('FIR-2026-000001', {
      firmatario: 'Mario Rossi',
      timestamp: new Date(),
      certificato: 'firma',
      userId: 'user-1',
      documentHash: 'h1',
      certificateHash: 'h2',
    } as any)
    return fir
  }
  const bloccato = (fir: FIR): FIR =>
    Object.assign(fir, { _bloccatoInvio: true, _motivoBloccoInvio: 'Importato da WinWaste' })

  it("un FIR nuovo non e' bloccato e puo' essere trasmesso", () => {
    const fir = emesso()
    expect(fir.bloccatoInvio).toBe(false)
    expect(fir.motivoBloccoInvio).toBeNull()
    expect(fir.canSyncToRENTRI()).toBe(true)
  })

  it("un FIR bloccato non puo' essere trasmesso: canSyncToRENTRI falso, anche se emesso e PENDING", () => {
    const fir = bloccato(emesso())
    expect(fir.bloccatoInvio).toBe(true)
    expect(fir.motivoBloccoInvio).toBe('Importato da WinWaste')
    expect(fir.canSyncToRENTRI()).toBe(false)
  })

  it("avviaTentativoRentri rifiuta un FIR bloccato (rete in piu' al di la' della guardia)", () => {
    expect(() => bloccato(emesso()).avviaTentativoRentri(new Date())).toThrow(
      'FIR non trasmissibile a RENTRI'
    )
  })
})
