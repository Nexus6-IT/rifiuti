import { eDatabaseDiTestLocale } from './database-di-test'

describe('eDatabaseDiTestLocale', () => {
  it.each([
    'postgresql://wasteflow:wasteflow_ci@127.0.0.1:55432/wasteflow_ci?schema=public',
    'postgresql://wasteflow:wasteflow_ci@127.0.0.1:55434/wasteflow_ci?schema=public',
    'postgresql://wasteflow_app:wasteflow_app_dev@localhost:5433/wasteflow_ci',
    'postgres://wasteflow:x@127.0.0.1:55434/wasteflow_ci?schema=public&connection_limit=5',
  ])('accetta il database di test locale %s', (url) => {
    expect(eDatabaseDiTestLocale(url)).toBe(true)
  })

  it.each([
    'postgresql://wasteflow:x@db.example.com:5432/wasteflow_ci?schema=public',
    'postgresql://wasteflow:x@38.242.246.95:5432/wasteflow_ci',
    'postgresql://wasteflow:x@127.0.0.1:55434/wasteflow_prod?schema=public',
    'postgresql://wasteflow:x@127.0.0.1/wasteflow_ci',
    'postgresql://127.0.0.1.evil.com:5432/wasteflow_ci@altrove:5432/x',
    '',
    'non un url',
  ])('rifiuta %s', (url) => {
    expect(eDatabaseDiTestLocale(url)).toBe(false)
  })

  it('rifiuta undefined e null', () => {
    expect(eDatabaseDiTestLocale(undefined)).toBe(false)
    expect(eDatabaseDiTestLocale(null)).toBe(false)
  })
})
