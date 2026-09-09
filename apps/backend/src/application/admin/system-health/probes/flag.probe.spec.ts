import { ConfigService } from '@nestjs/config'

import { FlagProbe } from './flag.probe'

function probeCon(valori: Record<string, string | undefined>): FlagProbe {
  const config = { get: (chiave: string) => valori[chiave] } as unknown as ConfigService
  return new FlagProbe(config)
}

describe('FlagProbe', () => {
  it('mostra ambiente e versione come valori descrittivi, senza giudizio', () => {
    const voci = probeCon({ NODE_ENV: 'production', APP_VERSION: '1.4.2' }).raccogli()

    expect(voci.find(v => v.key === 'flag.ambiente')).toMatchObject({
      state: 'info',
      detail: 'production',
    })
    expect(voci.find(v => v.key === 'flag.versione')?.detail).toBe('1.4.2')
  })

  it('dichiara off — non error — un flag semplicemente spento', () => {
    const voci = probeCon({ NODE_ENV: 'production' }).raccogli()

    expect(voci.find(v => v.key === 'flag.sentry')).toMatchObject({
      state: 'off',
      detail: 'Non attivo in questo ambiente.',
    })
  })

  it('non allarma su Swagger acceso fuori produzione', () => {
    const voci = probeCon({ NODE_ENV: 'development', SWAGGER_ENABLED: 'true' }).raccogli()

    expect(voci.find(v => v.key === 'flag.swagger')?.state).toBe('ok')
  })

  it('allarma su Swagger acceso in produzione, dicendo perche', () => {
    const voci = probeCon({ NODE_ENV: 'production', SWAGGER_ENABLED: 'true' }).raccogli()
    const voce = voci.find(v => v.key === 'flag.swagger')

    expect(voce?.state).toBe('warn')
    expect(voce?.detail).toContain('esposta pubblicamente in produzione')
  })

  it('allarma su un fornitore di firma finto in produzione', () => {
    const voci = probeCon({ NODE_ENV: 'production', SIGNATURE_PROVIDER: 'mock-tsa' }).raccogli()
    const voce = voci.find(v => v.key === 'flag.firma')

    expect(voce?.state).toBe('warn')
    expect(voce?.detail).toContain('non reale attivo in produzione')
  })

  it('allarma quando in produzione RENTRI punta al simulatore', () => {
    const voci = probeCon({
      NODE_ENV: 'production',
      RENTRI_API_URL: 'http://localhost:4010',
    }).raccogli()
    const voce = voci.find(v => v.key === 'flag.rentri-endpoint')

    expect(voce?.state).toBe('warn')
    expect(voce?.detail).toContain('simulatore risulta attivo in produzione')
  })

  it('mostra come semplice informazione lo stesso endpoint fuori produzione', () => {
    const voci = probeCon({
      NODE_ENV: 'development',
      RENTRI_API_URL: 'http://localhost:4010',
    }).raccogli()

    expect(voci.find(v => v.key === 'flag.rentri-endpoint')?.state).toBe('info')
  })

  it('dichiara off l endpoint RENTRI non configurato', () => {
    const voci = probeCon({ NODE_ENV: 'production' }).raccogli()
    const voce = voci.find(v => v.key === 'flag.rentri-endpoint')

    expect(voce?.state).toBe('off')
    expect(voce?.detail).toContain('RENTRI_API_URL non impostata')
  })
})
