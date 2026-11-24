import { Injectable } from '@nestjs/common'
import { IDatiViaggioFirRepository, UltimoTrasportoAutomezzo } from './dati-viaggio-fir.port'

/**
 * Conducente e rimorchio dell'ultimo trasporto fatto con una targa (FIR in viaggio, P2, decisione D3):
 * precompila il form del FIR. Sola lettura sui FIR dell'azienda, nessuna chiamata all'ente. Una targa
 * vuota non cerca nulla (nessun «ultimo FIR» qualunque).
 */
@Injectable()
export class TrovaUltimoTrasportoAutomezzoUseCase {
  constructor(private readonly datiViaggio: IDatiViaggioFirRepository) {}

  async execute(tenantId: string, targa: string): Promise<UltimoTrasportoAutomezzo | null> {
    const pulita = (targa ?? '').trim().toUpperCase()
    if (pulita === '') return null
    return this.datiViaggio.ultimoTrasportoPerTarga(tenantId, pulita)
  }
}
