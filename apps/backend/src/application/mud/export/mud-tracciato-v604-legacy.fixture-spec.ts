/**
 * Fixture del file telematico prodotto dal generatore di a2bf11e (prima delle dichiarazioni per
 * unità locale, M8): le stringhe sono state ottenute dal generatore di allora, byte per byte, e
 * valgono come oracolo di identità. Escluso da tsc e jest come gli altri `*.fixture-spec.ts`.
 */
import { MudExportData } from './mud-export.types'

const GENERATO_IL = new Date('2026-03-15T09:30:00Z')

/** Dato completo: righe con DR, TE, stato fisico, AU con discariche, `sostituisce`. */
export function fixtureDatoCompleto(anno: number): MudExportData {
  return {
    year: anno,
    generatedAt: GENERATO_IL,
    azienda: {
      ragioneSociale: 'Società Rifiuti Città di Verità S.p.A.',
      partitaIva: '12345678901',
      codiceFiscale: 'RSSMRA80A01H501U',
      via: 'Via Corso Umberto I',
      civico: '12/A',
      comune: 'PADOVA',
      provincia: 'PD',
      cap: '35100',
      pec: 'info@example.it',
      telefono: '0498765432',
      atecoCode: '381100',
      comuneCode: '028060',
      reaNumber: '123456',
      numeroAddetti: 42,
      legaleRappresentanteNome: 'Mario',
      legaleRappresentanteCognome: 'Rossi',
    },
    sostituisce: { dataComunicazione: new Date('2025-04-20T10:00:00Z') },
    autorizzazioni: [
      {
        estremi: 'AUT-2024/0012',
        dataRilascio: new Date('2024-01-15T12:00:00Z'),
        dataScadenza: new Date('2034-01-14T12:00:00Z'),
        enteAutorizzante: 2,
        tipoAutorizzazione: 1,
        operazioniRecupero: ['R3', 'R4', 'R13'],
        operazioniSmaltimento: ['D4', 'D5', 'D12'],
        gestisceRAEE: true,
        autorizzazioneEoW: true,
        capacitaComplessivaTa: 50000,
        capacitaPericolosiTa: 10000,
        capacitaNonPericolosiTa: 40000,
        discariche: [
          { classificazione: 7, capacitaResiduaMc: 250000 },
          { classificazione: 8, capacitaResiduaMc: 1200 },
        ],
        emasPrimaRegistrazione: new Date('2020-04-01T12:00:00Z'),
        emasNumeroRegistrazione: 'IT-001234',
        iso14001Emissione: new Date('2023-09-30T12:00:00Z'),
      },
    ],
    rifiuti: [
      {
        cerCode: '170405',
        prodottoKg: 250000,
        recuperoKg: 200000,
        smaltimentoKg: 50000,
        statoFisico: 'LIQUIDO',
        trasportatoDalDichiaranteKg: 10000,
        giacenzaRecuperoKg: 3000,
        giacenzaSmaltimentoKg: 1500,
        dr: [
          {
            codiceFiscale: '98765432109',
            ragioneSociale: 'Recuperi Sud S.p.A.',
            istatProvincia: '063',
            istatComune: '049',
            indirizzo: 'Via Napoli',
            civico: '7',
            cap: '80100',
            quantitaKg: 200000,
          },
        ],
        te: [{ codiceFiscale: '11122233344', ragioneSociale: 'Trasporti Veloci S.r.l.' }],
      },
      {
        cerCode: '150106',
        prodottoKg: 1234,
        recuperoKg: 1000,
        smaltimentoKg: 234,
      },
    ],
  }
}

/** Dato minimo: un'azienda con una sola riga e niente allegati. */
export function fixtureDatoMinimo(anno: number): MudExportData {
  return {
    year: anno,
    generatedAt: GENERATO_IL,
    azienda: { ragioneSociale: 'Minima S.r.l.', partitaIva: '01234567897' },
    rifiuti: [{ cerCode: '200101', prodottoKg: 10, recuperoKg: 10, smaltimentoKg: 0 }],
  }
}

// Stringhe prodotte dal generatore di a2bf11e (JSON.stringify del contenuto del file).
export const FILE_COMPLETO_2024 =
  "XX;6.04/24;10;20260315;103000;00000007;00001;00001;00002;00002;00000;00000;00000;00000;00000;00000;00000;00000;00000;00000;00000;00000;00000;00000;00000;00000;00000;00000;00000;00000;00000;00000;00000;00000;00001;00000;RSSMRA80A01H501U;SOCIETA' RIFIUTI CITTA' DI VERITA' S.P.A.                   ;VIA CORSO UMBERTO I           ;12/A      ;35100;PADOVA                        ;PD;     ;0498765432;INFO@EXAMPLE.IT                                             ;WASTEFLOW                     ;\r\nAA;2024;RSSMRA80A01H501U;000000000000001;381100;000123456;00042;SOCIETA' RIFIUTI CITTA' DI VERITA' S.P.A.                   ;028;060;VIA CORSO UMBERTO I           ;12/A  ;35100;     ;0498765432;028;060;VIA CORSO UMBERTO I           ;12/A  ;35100;     ;0498765432;ROSSI                    ;MARIO                    ;20260315;12;1;20250420;\r\nAB;2024;RSSMRA80A01H501U;000000000000001;000002;000000;0;0;0;00;00;0;01;00;                                                                                                                                                                                     ;\r\nAU;2024;RSSMRA80A01H501U;000000000000001;0001;AUT-2024/0012       ;20240115;20340114;2;1;0;R3,R4,R13                                         ;D4,D5,D12                                         ;0;1;1;0;000050000;000010000;000040000;0;000000000;000000000;000000000;7;000250000;8;000001200;0;000000000;20200401;IT-001234;20230930;\r\nBA;2024;RSSMRA80A01H501U;000000000000001;0001;170405;0;0;0;1;0;0;0;0250000,000;1;0000000,000;1;00000;0000000,000;1;00000;0010000,000;1;00001;0200000,000;1;00001;0003000,000;1;0001500,000;1;0200000,000;1;0050000,000;1;\r\nBB;2024;RSSMRA80A01H501U;000000000000001;0001;170405;DR;00001;98765432109     ;RECUPERI SUD S.P.A.                                         ;063;049;VIA NAPOLI                    ;7     ;80100;0200000,000;1;                    ;      ;0;0000000,000;1;0000000,000;1;0000000,000;1;0000000,000;1;0000000,000;1;0;0;\r\nBB;2024;RSSMRA80A01H501U;000000000000001;0001;170405;TE;00001;11122233344     ;TRASPORTI VELOCI S.R.L.                                     ;000;000;                              ;      ;     ;0000000,000;1;                    ;      ;0;0000000,000;1;0000000,000;1;0000000,000;1;0000000,000;1;0000000,000;1;0;0;\r\nBA;2024;RSSMRA80A01H501U;000000000000001;0002;150106;0;1;0;0;0;0;0;0001234,000;1;0000000,000;1;00000;0000000,000;1;00000;0000000,000;1;00000;0000000,000;1;00000;0000000,000;1;0000000,000;1;0001000,000;1;0000234,000;1;\r\n"

export const FILE_MINIMO_2024 =
  'XX;6.04/24;10;20260315;103000;00000003;00001;00001;00001;00000;00000;00000;00000;00000;00000;00000;00000;00000;00000;00000;00000;00000;00000;00000;00000;00000;00000;00000;00000;00000;00000;00000;00000;00000;00000;00000;01234567897     ;MINIMA S.R.L.                                               ;                              ;          ;     ;                              ;  ;     ;          ;                                                            ;WASTEFLOW                     ;\r\nAA;2024;01234567897     ;000000000000001;      ;000000000;00000;MINIMA S.R.L.                                               ;000;000;                              ;      ;     ;     ;          ;000;000;                              ;      ;     ;     ;          ;                         ;                         ;20260315;12;0;00000000;\r\nAB;2024;01234567897     ;000000000000001;000001;000000;0;0;0;00;00;0;00;00;                                                                                                                                                                                     ;\r\nBA;2024;01234567897     ;000000000000001;0001;200101;0;1;0;0;0;0;0;0000010,000;1;0000000,000;1;00000;0000000,000;1;00000;0000000,000;1;00000;0000000,000;1;00000;0000000,000;1;0000000,000;1;0000010,000;1;0000000,000;1;\r\n'

export const FILE_COMPLETO_2025 =
  "XX;6.04/25;10;20260315;103000;00000007;00001;00001;00002;00002;00000;00000;00000;00000;00000;00000;00000;00000;00000;00000;00000;00000;00000;00000;00000;00000;00000;00000;00000;00000;00000;00000;00000;00000;00001;00000;RSSMRA80A01H501U;SOCIETA' RIFIUTI CITTA' DI VERITA' S.P.A.                   ;VIA CORSO UMBERTO I           ;12/A      ;35100;PADOVA                        ;PD;     ;0498765432;INFO@EXAMPLE.IT                                             ;WASTEFLOW                     ;\r\nAA;2025;RSSMRA80A01H501U;000000000000001;381100;000123456;00042;SOCIETA' RIFIUTI CITTA' DI VERITA' S.P.A.                   ;028;060;VIA CORSO UMBERTO I           ;12/A  ;35100;     ;0498765432;028;060;VIA CORSO UMBERTO I           ;12/A  ;35100;     ;0498765432;ROSSI                    ;MARIO                    ;20260315;12;1;20250420;\r\nAB;2025;RSSMRA80A01H501U;000000000000001;000002;000000;0;0;0;00;00;0;01;00;                                                                                                                                                                                     ;\r\nAU;2025;RSSMRA80A01H501U;000000000000001;0001;AUT-2024/0012       ;20240115;20340114;2;1;0;R3,R4,R13                                         ;D4,D5,D12                                         ;0;1;1;0;000050000;000010000;000040000;0;000000000;000000000;000000000;7;000250000;8;000001200;0;000000000;20200401;IT-001234;20230930;\r\nBA;2025;RSSMRA80A01H501U;000000000000001;0001;170405;0;0;0;1;0;0;0;0250000,000;1;0000000,000;1;00000;0000000,000;1;00000;0010000,000;1;00001;0200000,000;1;00001;0003000,000;1;0001500,000;1;0200000,000;1;0050000,000;1;\r\nBB;2025;RSSMRA80A01H501U;000000000000001;0001;170405;DR;00001;98765432109     ;RECUPERI SUD S.P.A.                                         ;063;049;VIA NAPOLI                    ;7     ;80100;0200000,000;1;                    ;      ;0;0000000,000;1;0000000,000;1;0000000,000;1;0000000,000;1;0000000,000;1;0;0;\r\nBB;2025;RSSMRA80A01H501U;000000000000001;0001;170405;TE;00001;11122233344     ;TRASPORTI VELOCI S.R.L.                                     ;000;000;                              ;      ;     ;0000000,000;1;                    ;      ;0;0000000,000;1;0000000,000;1;0000000,000;1;0000000,000;1;0000000,000;1;0;0;\r\nBA;2025;RSSMRA80A01H501U;000000000000001;0002;150106;0;1;0;0;0;0;0;0001234,000;1;0000000,000;1;00000;0000000,000;1;00000;0000000,000;1;00000;0000000,000;1;00000;0000000,000;1;0000000,000;1;0001000,000;1;0000234,000;1;\r\n"

export const FILE_MINIMO_2025 =
  'XX;6.04/25;10;20260315;103000;00000003;00001;00001;00001;00000;00000;00000;00000;00000;00000;00000;00000;00000;00000;00000;00000;00000;00000;00000;00000;00000;00000;00000;00000;00000;00000;00000;00000;00000;00000;00000;01234567897     ;MINIMA S.R.L.                                               ;                              ;          ;     ;                              ;  ;     ;          ;                                                            ;WASTEFLOW                     ;\r\nAA;2025;01234567897     ;000000000000001;      ;000000000;00000;MINIMA S.R.L.                                               ;000;000;                              ;      ;     ;     ;          ;000;000;                              ;      ;     ;     ;          ;                         ;                         ;20260315;12;0;00000000;\r\nAB;2025;01234567897     ;000000000000001;000001;000000;0;0;0;00;00;0;00;00;                                                                                                                                                                                     ;\r\nBA;2025;01234567897     ;000000000000001;0001;200101;0;1;0;0;0;0;0;0000010,000;1;0000000,000;1;00000;0000000,000;1;00000;0000000,000;1;00000;0000000,000;1;00000;0000000,000;1;0000000,000;1;0000010,000;1;0000000,000;1;\r\n'
