import { CreaFIRDaFormularioRENTRINonImplementatoAdapter } from './crea-fir-da-formulario-rentri.non-implementato.adapter'
import { DomainException } from '../../domain/shared/domain-exception'

describe('CreaFIRDaFormularioRENTRINonImplementatoAdapter', () => {
  it('rifiuta sempre con un errore di dominio leggibile (Task 5 non ancora implementato)', async () => {
    const adapter = new CreaFIRDaFormularioRENTRINonImplementatoAdapter()

    await expect(adapter.creaDaDettaglio()).rejects.toThrow(DomainException)
    await expect(adapter.creaDaDettaglio()).rejects.toThrow(/collega al FIR locale/)
  })
})
