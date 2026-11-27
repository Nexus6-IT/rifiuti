import * as fs from 'fs'
import * as path from 'path'
import { PrismaClient } from '@prisma/client'
import { partitaIvaUnica } from './anagrafiche-di-test'

/**
 * Fixture per i test delle esportazioni XML del registro (eREGI E6): eREGI di prova, materiale di
 * firma EC (le fixture della fake RENTRI) e uno scenario con azienda, sede, registro collegato e
 * annotazioni DT (carico per produzione interna, traducibili senza FIR).
 */
export const NS_REG = 'urn:it:rentri:registri:1.0'
export const NS_DS = 'http://www.w3.org/2000/09/xmldsig#'
export const IDENTIFICATIVO_REGISTRO = 'R1234ABCDE0'
export const DIGEST_EREGI = 'q1w2e3r4t5y6u7i8o9p0a1s2d3f4g5h6j7k8l9z0x1c='
export const DATA_RICHIESTA_EREGI = '2026-01-02T08:00:00Z'

/** eREGI con una firma «dell'ente» fittizia ma completa per l'XSD (come nelle fixture del serializzatore). */
export function eregiDiProva(identificativo = IDENTIFICATIVO_REGISTRO): string {
  return (
    `<reg:eREGI xmlns:reg="${NS_REG}" xmlns:ds="${NS_DS}" Id="eREGI-CS-0">` +
    `<reg:Identificativo>${identificativo}</reg:Identificativo>` +
    '<reg:Operatore><reg:NumIscr>OP1234567890123</reg:NumIscr><reg:CodiceFiscale>01234567890</reg:CodiceFiscale><reg:Denominazione>Rossi &amp; Figli</reg:Denominazione></reg:Operatore>' +
    '<reg:NumIscrSito>OP1234567890123-MI0001</reg:NumIscrSito><reg:IndirizzoSito>Via Roma 1</reg:IndirizzoSito>' +
    `<reg:DataRichiesta>${DATA_RICHIESTA_EREGI}</reg:DataRichiesta><reg:IdentificativoRichiesta>x</reg:IdentificativoRichiesta>` +
    '<reg:AutoreRichiesta>y</reg:AutoreRichiesta><reg:CCIAANome>z</reg:CCIAANome>' +
    '<ds:Signature><ds:SignedInfo><ds:CanonicalizationMethod Algorithm="http://www.w3.org/2001/10/xml-exc-c14n#"/>' +
    '<ds:SignatureMethod Algorithm="http://www.w3.org/2001/04/xmldsig-more#rsa-sha256"/>' +
    '<ds:Reference URI="#eREGI-CS-0"><ds:DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"/>' +
    `<ds:DigestValue>${DIGEST_EREGI}</ds:DigestValue></ds:Reference></ds:SignedInfo>` +
    '<ds:SignatureValue>AAAA</ds:SignatureValue></ds:Signature></reg:eREGI>'
  )
}

const DIR_FIXTURE_EC = path.resolve(__dirname, '../../../../tools/rentri-fake/test/fixture/ec')

/** Certificato e chiave EC P-256 di prova (la fake RENTRI li usa per i suoi test). */
export function materialeFirmaDiProva(): { certificatePem: string; privateKeyPem: string } {
  return {
    certificatePem: fs.readFileSync(path.join(DIR_FIXTURE_EC, 'operatore-test-ec.crt'), 'utf8'),
    privateKeyPem: fs.readFileSync(path.join(DIR_FIXTURE_EC, 'operatore-test-ec.key'), 'utf8'),
  }
}

export interface ScenarioEsportazioni {
  tenantId: string
  registroId: string
  userId: string
}

let contatore = 0

/** Azienda con sede, utente e registro collegato a RENTRI (`identificativoRentri` impostato). */
export async function scenarioEsportazioni(
  owner: PrismaClient,
  opzioni: { collegato?: boolean } = {}
): Promise<ScenarioEsportazioni> {
  const n = ++contatore
  const t = await owner.tenant.create({
    data: {
      partitaIva: partitaIvaUnica(),
      ragioneSociale: 'Esportazioni RENTRI SRL',
      country: 'IT',
    },
  })
  const sede = await owner.rentriUnitaLocale.create({
    data: {
      tenantId: t.id,
      numIscrSito: `OP0001EX${String(n).padStart(6, '0')}-MI0001`,
      denominazione: 'Sede',
      principale: true,
    },
  })
  const registro = await owner.registroRifiuti.create({
    data: {
      tenantId: t.id,
      unitaLocaleId: sede.id,
      descrizione: 'Registro di prova',
      identificativoRentri: opzioni.collegato === false ? null : IDENTIFICATIVO_REGISTRO,
    },
  })
  const user = await owner.user.create({
    data: {
      tenantId: t.id,
      keycloakId: `keycloak-ex-${Date.now()}-${n}`,
      fiscalCode: 'RSSMRA80A01H501U',
      firstName: 'Mario',
      lastName: 'Rossi',
      email: `ex-${Date.now()}-${n}@example.com`,
      role: 'OPERATOR',
    },
  })
  return { tenantId: t.id, registroId: registro.id, userId: user.id }
}

/** Annotazioni DT numerate da `da` a `a` dell'`anno` (una per progressivo, scritte dal proprietario). */
export async function aggiungiAnnotazioni(
  owner: PrismaClient,
  s: ScenarioEsportazioni,
  anno: number,
  da: number,
  a: number,
  opzioni: { senzaUtente?: boolean } = {}
): Promise<string[]> {
  const ids: string[] = []
  for (let p = da; p <= a; p++) {
    const m = await owner.wasteMovement.create({
      data: {
        tenantId: s.tenantId,
        registroId: s.registroId,
        progressiveYear: anno,
        progressiveNumber: p,
        type: 'CARICO',
        movementDate: new Date(Date.UTC(anno, 2, 1, 10, 0, 0)),
        registrationDate: new Date(Date.UTC(anno, 2, 1, 10, 0, p)),
        causale: 'PRODUZIONE_INTERNA',
        cerCode: '15 01 01',
        quantity: 100 + p,
        unit: 'KG',
        wastePhysicalState: 'Solido',
        recordedByUserId: opzioni.senzaUtente ? null : s.userId,
      },
    })
    ids.push(m.id)
  }
  return ids
}
