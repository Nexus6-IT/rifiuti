import { test, expect, type Page } from '@playwright/test'
import {
  accediUiComeAzienda,
  clientDbLocale,
  creaAziendaDiTest,
  tokenAzienda,
  type AziendaDiTest,
} from '../../utils/azienda-di-test'
import { apiDelete, apiGet, apiPost } from '../../utils/api-client'
import { eseguiAzioneRiga } from '../../utils/azioni-riga'
import { registra } from '../../fixtures/risorse'
import { ATTESA_SERVER } from '../../utils/attese'
import { partitaIvaCasualeValida } from '../../utils/partita-iva'
import { conPrefissoUnico } from '../../utils/run-id'

/**
 * E2E minimo della lista `/contratti` del produttore (Task 12 del restyle giro 2): Cambia stato ed
 * Elimina dal menu ⋯ su contratti creati dal test (azienda di prova dedicata, pulizia per id
 * esatto) e VIEWER senza azioni.
 */
const db = clientDbLocale()
const SEDE = { via: 'Via Roma', civico: '1', cap: '20100', comune: 'Milano', provincia: 'MI' }

let azienda: AziendaDiTest
let produttoreId = ''
let trasportatoreId = ''
const contratti: { id: string; numero: string }[] = []

const contenuto = (page: Page) => page.locator('#main-content')
const riga = (page: Page, id: string) =>
  contenuto(page).locator(`tr[data-testid="contratti-riga-${id}"]`)

/** L'elenco e arrivato: almeno una riga o il messaggio di lista vuota (il DB di CI parte vuoto). */
async function attendiElenco(page: Page): Promise<void> {
  await expect(
    contenuto(page)
      .locator('tbody tr[data-testid^="contratti-riga-"]')
      .first()
      .or(contenuto(page).getByText('Nessun contratto', { exact: true }))
  ).toBeVisible({ timeout: ATTESA_SERVER })
}

async function creaContratto(token: string, sigla: string) {
  const numero = conPrefissoUnico(`CTR-${sigla}`).slice(0, 40)
  const c = await apiPost<{ id: string }>(
    '/contracts',
    {
      contractNumber: numero,
      producerId: produttoreId,
      counterpartyId: trasportatoreId,
      counterpartyType: 'TRANSPORTER',
      contractType: 'WASTE_TRANSPORT',
      cerCodes: ['150101'],
      pricingModel: 'FLAT_RATE',
      basePrice: 100,
      unitOfMeasure: 'kg',
      startDate: '2026-01-15',
    },
    token
  )
  contratti.push({ id: c.id, numero })
  return { id: c.id, numero }
}

test.describe('Lista contratti del produttore', () => {
  test.describe.configure({ mode: 'serial' })
  test.skip(db === null, 'Serve un database locale per creare l’azienda di test dedicata')

  test.beforeAll(async () => {
    if (!db) return
    azienda = await creaAziendaDiTest(db, 'lista contratti')
    const token = await tokenAzienda(azienda, 'operator')
    produttoreId = (
      await apiPost<{ id: string }>(
        '/registry/produttori',
        {
          ragioneSociale: conPrefissoUnico('Produttore contratti'),
          partitaIVA: partitaIvaCasualeValida(),
          pec: 'pec@esempio.it',
          sedeLegale: SEDE,
        },
        token
      )
    ).id
    trasportatoreId = (
      await apiPost<{ id: string }>(
        '/registry/trasportatori',
        {
          ragioneSociale: conPrefissoUnico('Trasportatore contratti'),
          partitaIVA: partitaIvaCasualeValida(),
          pec: 'pec@esempio.it',
          sedeLegale: SEDE,
          numeroIscrizione: `MI/${100000 + Math.floor(Math.random() * 800000)}`,
        },
        token
      )
    ).id
  })

  test.afterAll(async () => {
    // registrate per l'esenzione dal guardrail sul DELETE delle anagrafiche (cancellate qui, per id)
    if (produttoreId) registra('produttore', produttoreId)
    if (trasportatoreId) registra('trasportatore', trasportatoreId)
    await db?.$disconnect()
    if (!azienda) return
    const token = await tokenAzienda(azienda, 'operator')
    const errori: string[] = []
    for (const { id } of contratti) {
      try {
        const c = await apiGet<{ versione: number } | null>(`/contracts/${id}`, token).catch(
          () => null
        )
        if (c) await apiDelete(`/contracts/${id}?versione=${c.versione}`, token)
      } catch (e) {
        errori.push(`contratto ${id}: ${(e as Error).message}`)
      }
    }
    for (const [tipo, id] of [
      ['trasportatori', trasportatoreId],
      ['produttori', produttoreId],
    ] as const) {
      if (!id) continue
      try {
        await apiDelete(`/registry/${tipo}/${id}`, token)
      } catch (e) {
        errori.push(`${tipo} ${id}: ${(e as Error).message}`)
      }
    }
    expect(errori, 'pulizia dei dati creati dallo spec').toEqual([])
  })

  test('Cambia stato dal menu ⋯: da Bozza a In approvazione', async ({ page }) => {
    const token = await tokenAzienda(azienda, 'operator')
    const { id } = await creaContratto(token, 'STATO')
    await accediUiComeAzienda(page, azienda, 'operator')
    await page.goto('/contratti')
    await attendiElenco(page)
    await expect(riga(page, id)).toBeVisible()
    await eseguiAzioneRiga(page, riga(page, id), 'Cambia stato')
    const dlg = page.getByRole('dialog', { name: 'Cambia stato contratto' })
    await dlg.locator('#c-target-status').click()
    await page.getByRole('option', { name: 'In approvazione' }).click()
    await dlg.getByRole('button', { name: 'Conferma' }).click()
    await expect(dlg).toBeHidden({ timeout: ATTESA_SERVER })
    await expect(
      riga(page, id).locator('p-tag:visible', { hasText: 'In approvazione' })
    ).toBeVisible()
  })

  test('Elimina dal menu ⋯ con conferma: la riga sparisce', async ({ page }) => {
    const token = await tokenAzienda(azienda, 'operator')
    const { id } = await creaContratto(token, 'ELIM')
    await accediUiComeAzienda(page, azienda, 'operator')
    await page.goto('/contratti')
    await attendiElenco(page)
    await expect(riga(page, id)).toBeVisible()
    await eseguiAzioneRiga(page, riga(page, id), 'Elimina')
    const conferma = page.getByRole('alertdialog').or(page.locator('.p-confirm-dialog'))
    await conferma.getByRole('button', { name: 'Elimina' }).click()
    await expect(riga(page, id)).toHaveCount(0, { timeout: ATTESA_SERVER })
  })

  test('VIEWER: legge l’elenco senza Nuovo contratto, colonna Azioni e ⋯', async ({ page }) => {
    const token = await tokenAzienda(azienda, 'operator')
    const { id } = await creaContratto(token, 'VIEW')
    await accediUiComeAzienda(page, azienda, 'viewer')
    await page.goto('/contratti')
    await attendiElenco(page)
    await expect(riga(page, id)).toBeVisible()
    await expect(contenuto(page).getByRole('button', { name: 'Nuovo contratto' })).toHaveCount(0)
    await expect(contenuto(page).getByRole('columnheader', { name: 'Azioni' })).toHaveCount(0)
    await expect(contenuto(page).getByTestId('azioni-altre')).toHaveCount(0)
    await expect(contenuto(page).getByTestId('azione-principale')).toHaveCount(0)
  })
})
