// Adattatore contabile finto per i test del Task 29: modalita' FILE, una chiave `CODICE_IVA` per
// aliquota e una `REGISTRO` per registro dei documenti. Non e' un adattatore di produzione.
import type {
  AdattatoreExportContabile,
  FileGenerato,
} from '../application/fatturazione/adattatori/adattatore-export-contabile'
import type { DocumentoPerExport } from '../application/fatturazione/export-csv'

export function creaAdattatoreFinto(
  opz: { codice?: string; modalita?: 'FILE' | 'API'; verificato?: boolean } = {}
): AdattatoreExportContabile & { genera: jest.Mock } {
  const modalita = opz.modalita ?? 'FILE'
  return {
    codice: opz.codice ?? 'FINTO',
    nome: 'Adattatore finto',
    modalita,
    verificato: opz.verificato ?? false,
    mappatureRichieste: (documenti: readonly DocumentoPerExport[]) => {
      const voci = new Map<
        string,
        { tipo: 'CODICE_IVA' | 'REGISTRO'; chiaveWasteflow: string; etichetta: string }
      >()
      for (const d of documenti) {
        voci.set(`REGISTRO:${d.registroCodice}`, {
          tipo: 'REGISTRO',
          chiaveWasteflow: d.registroCodice,
          etichetta: `Registro ${d.registroCodice}`,
        })
        for (const r of d.documento.righe) {
          voci.set(`CODICE_IVA:${r.aliquotaIva}`, {
            tipo: 'CODICE_IVA',
            chiaveWasteflow: r.aliquotaIva,
            etichetta: `IVA ${r.aliquotaIva}%`,
          })
        }
      }
      return [...voci.values()]
    },
    genera: jest.fn(
      (
        documenti: readonly DocumentoPerExport[],
        mappature: ReadonlyMap<string, string>
      ): FileGenerato[] => [
        {
          nome: 'prova.txt',
          contentType: 'text/plain',
          contenuto: Buffer.from(
            documenti
              .map(d => `${d.numero}|${mappature.get(`REGISTRO:${d.registroCodice}`) ?? '?'}`)
              .join('\n'),
            'utf8'
          ),
        },
      ]
    ),
  }
}
