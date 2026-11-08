import { Type } from '@angular/core'
import { AuditTimelineComponent } from '../../features/permissions/components/audit-timeline/audit-timeline.component'
import { TenantSelectorComponent } from '../../features/permissions/components/tenant-selector/tenant-selector.component'
import { MyAssignmentsComponent } from '../../features/permissions/pages/my-assignments/my-assignments.component'
import { LegalPageComponent } from '../../features/legal/legal-page.component'
import { CerSelectComponent } from '../../features/cer/cer-select.component'
import { ConsegnaDaAccessoComponent } from '../../features/fir/consegna-da-accesso.component'
import { FirListComponent } from '../../features/fir/fir-list.component'
import { FirDetailComponent } from '../../features/fir/fir-detail.component'
import { GiacenzeComponent } from '../../features/giacenze/giacenze.component'
import { AbbinamentiComponent } from '../../features/giacenze/abbinamenti.component'
import { RegistroComponent } from '../../features/registro/registro.component'
import { CorreggiMovimentoDialogComponent } from '../../features/registro/correggi-movimento-dialog.component'
import { RiquadroLegameComponent } from '../../features/legami/riquadro-legame.component'
import { BloccoFatturazioneComponent } from '../../features/legami/blocco-fatturazione.component'
import { AggiornaPrezziDialogComponent } from '../../features/legami/aggiorna-prezzi-dialog.component'
import { AnagraficaFormDialogComponent } from '../../features/registry/anagrafica-form-dialog.component'
import { SediDittaDialogComponent } from '../../features/registry/sedi-ditta-dialog.component'
import { DittaIdentificativiComponent } from '../../features/registry/ditta-identificativi.component'

/**
 * Ripasso delle pagine del giro 1 sui token del giro 2: gli stili dei componenti non hanno colori
 * letterali (nemmeno come ripiego di un token), alias di token spariti, barre laterali da 3-4 px
 * né maiuscolo spaziato. Si leggono gli stili inline dal decoratore del componente.
 */
function stili(componente: Type<unknown>): string {
  const def = (componente as unknown as { ɵcmp: { styles?: string[] } }).ɵcmp
  return (def.styles ?? []).join('\n')
}

const RIPASSATI: [string, Type<unknown>][] = [
  ['AuditTimeline', AuditTimelineComponent],
  ['TenantSelector', TenantSelectorComponent],
  ['MyAssignments', MyAssignmentsComponent],
  ['LegalPage', LegalPageComponent],
  ['CerSelect', CerSelectComponent],
  ['ConsegnaDaAccesso', ConsegnaDaAccessoComponent],
  ['FirList', FirListComponent],
  ['FirDetail', FirDetailComponent],
  ['Giacenze', GiacenzeComponent],
  ['Abbinamenti', AbbinamentiComponent],
  ['Registro', RegistroComponent],
  ['CorreggiMovimentoDialog', CorreggiMovimentoDialogComponent],
  ['RiquadroLegame', RiquadroLegameComponent],
  ['BloccoFatturazione', BloccoFatturazioneComponent],
  ['AggiornaPrezziDialog', AggiornaPrezziDialogComponent],
  ['AnagraficaFormDialog', AnagraficaFormDialogComponent],
  ['SediDittaDialog', SediDittaDialogComponent],
  ['DittaIdentificativi', DittaIdentificativiComponent],
]

describe('Ripasso delle pagine del giro 1 sui token del giro 2', () => {
  it('legge davvero gli stili dei componenti (la prova non e vuota)', () => {
    for (const [nome, c] of RIPASSATI) {
      expect(stili(c).length).withContext(nome).toBeGreaterThan(200)
    }
  })

  for (const [nome, c] of RIPASSATI) {
    describe(nome, () => {
      const css = (): string => stili(c)

      it('nessun colore letterale: neanche come ripiego di un token', () => {
        const trovati = css().match(/#[0-9a-fA-F]{3,8}\b|rgba?\(/g) ?? []
        expect(trovati).withContext('colori letterali').toEqual([])
      })

      it('nessun token sparito (--color-border, --color-surface-alt, --color-text-secondary)', () => {
        expect(css()).not.toMatch(/--color-(border|surface-alt|text-secondary)\b/)
      })

      it('nessuna barra laterale da 3-4 px', () => {
        expect(css()).not.toMatch(/border-left:\s*[34]px solid/)
      })

      it('maiuscolo solo sui campi in cui si digita una sigla (provincia, codice fiscale)', () => {
        const regole = css().match(/[^{}]+\{[^{}]*text-transform:\s*uppercase[^{}]*\}/g) ?? []
        const selettori = regole.map(r => r.split('{')[0].replace(/\[_ng\w+-%COMP%\]/g, '').trim())
        for (const s of selettori) {
          expect(s)
            .withContext(`«${s}» e maiuscolo ma non e un campo di sigla`)
            .toMatch(/^\.(prov|prov-input|cf-input)$/)
        }
        expect(css()).not.toMatch(/letter-spacing:\s*0?\.\d+(em|px)/)
      })
    })
  }
})
