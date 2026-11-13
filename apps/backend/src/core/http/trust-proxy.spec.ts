import express from 'express'
import request from 'supertest'
import { valoreTrustProxy } from './trust-proxy'

describe('valoreTrustProxy', () => {
  it('predefinito: un solo hop su loopback', () => {
    expect(valoreTrustProxy(undefined)).toBe('loopback')
    expect(valoreTrustProxy('')).toBe('loopback')
  })
  it('accetta false, un numero o subnet; rifiuta true', () => {
    expect(valoreTrustProxy('false')).toBe(false)
    expect(valoreTrustProxy('1')).toBe(1)
    expect(valoreTrustProxy('172.16.0.0/12')).toBe('172.16.0.0/12')
    expect(() => valoreTrustProxy('true')).toThrow()
  })

  const ipVisto = async (trust: ReturnType<typeof valoreTrustProxy>, xff: string) => {
    const app = express()
    app.set('trust proxy', trust)
    app.get('/', (req, res) => res.send(req.ip))
    const r = await request(app).get('/').set('X-Forwarded-For', xff)
    return r.text
  }

  it('dietro nginx su loopback req.ip e` l’ultimo valore aggiunto da nginx, non quello inventato dal client', async () => {
    // il client invia "6.6.6.6", nginx aggiunge l'IP reale 203.0.113.9
    expect(await ipVisto(valoreTrustProxy(undefined), '6.6.6.6, 203.0.113.9')).toBe('203.0.113.9')
  })
  it('senza trust proxy si vedrebbe l’indirizzo del proxy', async () => {
    expect(await ipVisto(false, '203.0.113.9')).not.toBe('203.0.113.9')
  })
})
