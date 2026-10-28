import { NotFoundException } from '@nestjs/common'
import { FIR, FIRStato } from '../../domain/fir/aggregates/fir.aggregate'
import { ArriviPiazzaleService } from './arrivi-piazzale.service'

const firma = () => ({
  firmatario: 'Firmatario di prova',
  timestamp: new Date(),
  certificato: 'certificato-di-prova',
})

function firInTransito(numero: string, partitaIva: string, targa?: string): FIR {
  const fir = FIR.create({
    tenantId: 't1',
    produttoreId: 'produttore',
    trasportatoreId: 'trasportatore',
    destinatarioId: 'destinatario',
    produttore: { ragioneSociale: 'Produttore SRL', partitaIva: '11111111111' },
    trasportatore: { ragioneSociale: 'Trasporti SRL', partitaIva: '22222222222', targaVeicolo: targa },
    destinatario: { ragioneSociale: 'Impianto SRL', partitaIva },
    rifiuto: { cerCode: '150101', quantita: 100 },
  } as any)
  fir.emetti(numero, firma())
  fir.presaInCarico(new Date(), firma())
  return fir
}

describe('ArriviPiazzaleService', () => {
  const mio = firInTransito('FIR-1', '01234567897', 'AB123CD')
  const altroMio = firInTransito('FIR-2', 'IT01234567897', 'EF456GH')
  const altrui = firInTransito('FIR-3', '99999999999', 'AB123CD')
  const bozzaLegata = (() => {
    const f = FIR.create({
      tenantId: 't1',
      produttoreId: 'p',
      trasportatoreId: 't',
      destinatarioId: 'd',
      destinatario: { ragioneSociale: 'Impianto SRL', partitaIva: '01234567897' },
      rifiuto: { cerCode: '150101', quantita: 1 },
    } as any)
    f.agganciaFormularioAcquisito('BCDFG000009BC')
    return f
  })()

  function crea(codici: string[] = ['01234567897'], tenant: any = { id: 't1', ragioneSociale: 'Impianto SRL' }) {
    const findByTenant = jest.fn(async (_t: string, f: any) =>
      f.stato === FIRStato.IN_TRANSITO ? [mio, altroMio, altrui] : [bozzaLegata]
    )
    const firRepository = { findByTenant } as any
    const integrazioniMud = { codiciAzienda: jest.fn().mockResolvedValue(codici) } as any
    const prisma = { tenant: { findUnique: jest.fn().mockResolvedValue(tenant) } } as any
    return { service: new ArriviPiazzaleService(firRepository, integrazioniMud, prisma), findByTenant, integrazioniMud, prisma }
  }

  it('legge IN_TRANSITO e BOZZA del solo tenant richiesto e filtra con la regola', async () => {
    const { service, findByTenant } = crea()
    const r = await service.elenca('t1')
    expect(findByTenant).toHaveBeenCalledTimes(2)
    expect(findByTenant).toHaveBeenCalledWith('t1', { stato: FIRStato.IN_TRANSITO })
    expect(findByTenant).toHaveBeenCalledWith('t1', { stato: FIRStato.BOZZA })
    expect(r.arrivi).toEqual([mio, altroMio, bozzaLegata])
    expect(r.codiciAziendaConfigurati).toBe(true)
  })

  it('applica la ricerca', async () => {
    const { service } = crea()
    const r = await service.elenca('t1', ' ab123 ')
    expect(r.arrivi).toEqual([mio])
  })

  it('azienda senza codici: codiciAziendaConfigurati false e arrivi []', async () => {
    const { service } = crea([])
    const r = await service.elenca('t1')
    expect(r.codiciAziendaConfigurati).toBe(false)
    expect(r.arrivi).toEqual([])
  })

  it('restituisce id e ragione sociale dell azienda', async () => {
    const { service, prisma } = crea()
    const r = await service.elenca('t1')
    expect(r.azienda).toEqual({ id: 't1', ragioneSociale: 'Impianto SRL' })
    expect(prisma.tenant.findUnique).toHaveBeenCalledWith({
      where: { id: 't1' },
      select: { id: true, ragioneSociale: true },
    })
  })

  it('azienda inesistente: NotFoundException', async () => {
    const { service } = crea(['01234567897'], null)
    await expect(service.elenca('t1')).rejects.toBeInstanceOf(NotFoundException)
  })
})
