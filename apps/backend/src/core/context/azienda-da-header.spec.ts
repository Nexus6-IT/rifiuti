import { aziendaCandidataDaHeader } from './azienda-da-header'

const CASA = '5a5a5a5a-0000-4000-8000-000000000001'
const CLIENTE = 'c1c1c1c1-0000-4000-8000-000000000002'

const richiesta = (header: unknown, user: any = { role: 'ADMIN', tenantId: CASA }) =>
  ({ headers: header === undefined ? {} : { 'x-tenant-id': header }, user }) as any

describe('aziendaCandidataDaHeader', () => {
  it("header UUID diverso dall'azienda di casa → quell'UUID", () => {
    expect(aziendaCandidataDaHeader(richiesta(CLIENTE))).toBe(CLIENTE)
  })

  it('header ripetuto (array) → primo valore', () => {
    expect(aziendaCandidataDaHeader(richiesta([CLIENTE, CASA]))).toBe(CLIENTE)
  })

  it("spazi attorno all'UUID → trim", () => {
    expect(aziendaCandidataDaHeader(richiesta(`  ${CLIENTE} `))).toBe(CLIENTE)
  })

  it('header assente → null', () => {
    expect(aziendaCandidataDaHeader(richiesta(undefined))).toBeNull()
  })

  it('header vuoto o di soli spazi → null', () => {
    expect(aziendaCandidataDaHeader(richiesta('   '))).toBeNull()
  })

  it('header non UUID → null', () => {
    expect(aziendaCandidataDaHeader(richiesta('non-un-uuid'))).toBeNull()
  })

  it("header uguale all'azienda di casa → null", () => {
    expect(aziendaCandidataDaHeader(richiesta(CASA))).toBeNull()
  })

  it('SUPER_ADMIN → null anche con header valido', () => {
    expect(
      aziendaCandidataDaHeader(richiesta(CLIENTE, { role: 'SUPER_ADMIN', tenantId: CASA }))
    ).toBeNull()
  })

  it('nessun utente → null', () => {
    expect(aziendaCandidataDaHeader(richiesta(CLIENTE, null))).toBeNull()
  })

  it("utente senza tenantId → l'header e' candidato", () => {
    expect(aziendaCandidataDaHeader(richiesta(CLIENTE, { role: 'ADMIN' }))).toBe(CLIENTE)
  })
})
