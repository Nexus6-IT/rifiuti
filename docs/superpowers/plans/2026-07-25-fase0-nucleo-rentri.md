# Fase 0 — Nucleo di verifica RENTRI: piano di implementazione

> **Per agenti esecutori:** SUB-SKILL RICHIESTA: usare `superpowers:subagent-driven-development` (consigliato) o `superpowers:executing-plans` per eseguire questo piano task per task. I passi usano checkbox (`- [ ]`) per il tracciamento.

**Obiettivo:** costruire l'oracolo di conformità — contratti RENTRI ufficiali versionati e una fake API che **rifiuta ciò che RENTRI rifiuterebbe** — così che le pipeline di dominio successive abbiano un giudice esterno invece di autovalutarsi.

**Architettura:** servizio HTTP autonomo in `tools/rentri-fake/`, containerizzato, che sostituisce il segnaposto `rentri-mock` di `docker-compose.yml`. Implementa gli endpoint dagli OpenAPI ufficiali scaricati (non parafrasati), verifica davvero il JWT self-issued ID_AUTH_REST_02, valida l'xFIR come ASiC-E con XAdES-B, e simula l'asincronia NONBLOCK_PULL. Il servizio è indipendente dall'applicazione: non importa nulla da `apps/`.

**Stack:** TypeScript 5.4, Fastify 4, `jose` (JWT/JWS), `node-forge` (certificati X.509), `jszip` (container ASiC-E), `@xmldom/xmldom` + `xpath` (XAdES), Jest 29, Docker (`node:20-alpine`).

## Vincoli globali

- **Immagini lean**: `node:20-alpine`, multistage, `npm ci --omit=dev` nel runtime, `npm cache clean --force`. Mai `node:20` completo.
- **Italiano** nei messaggi, nei commenti e nella documentazione. Identificatori di codice in inglese, salvo termini di dominio RENTRI (`numero_fir`, `transazione_id`, `xfir`) che restano **identici alla specifica ufficiale**.
- **Nessuna dipendenza da `apps/`**: `tools/rentri-fake/` ha il proprio `package.json` e il proprio lockfile.
- **Prettier + ESLint** sui file toccati prima di ogni commit (gate CI del repo).
- **Nessun segreto reale** nel repo: chiavi e certificati di test sono generati dai test o committati solo se auto-generati e dichiarati come materiale di prova.
- **Ogni regola di validazione deve avere due test**: un caso che passa e un caso che viene **respinto**. Una fake che accetta tutto fallisce i propri test.
- **Base URL ufficiale di riferimento**: `https://demoapi.rentri.gov.it/formulari/v1.0` (dal campo `servers` dell'OpenAPI ufficiale).

## Verità di riferimento già accertata

Verificato il 2026-07-25 direttamente contro l'ente:

- `GET https://demoapi.rentri.gov.it/docs/{api}/v1.0/openapi.json` → **200**, documento **YAML** (nonostante l'estensione `.json`). API disponibili: `formulari`, `anagrafiche`, `codifiche`. `registri` non risponde su quel path e va cercato.
- `formulari` v`1.0.20260723-1089`, `x-api-id: rentrigov.formulari`, **29 path**, server `https://demoapi.rentri.gov.it/formulari/v1.0`.
- `securitySchemes` dichiara **unicamente** `Bearer` (`type: http`, `bearerFormat: JWT`). **Non esiste alcun endpoint `/token`** in tutta la specifica: conferma diretta del difetto centrale dell'integrazione attuale.
- `GET /formulari/v1.0/` senza token → **401** (il path esiste ed è protetto).
- Endpoint asincroni presenti: `/{transazione_id}/status` e `/{transazione_id}/result` → il pattern NONBLOCK_PULL è reale.
- Endpoint chiave del dominio: `/{numero_fir}/xfir`, `/{numero_fir}/hash`, `/{numero_fir}/acquisizione-firma`, `/{numero_fir}/rollback-firma`, `/{numero_fir}/stato`, `/{numero_fir}/annulla-fir`.
- **Da verificare in Task 1**, non assumere: l'audit indica l'uso di INTEGRITY_REST_01, ma nell'OpenAPI di `formulari` non compaiono header `Digest`/`Agid-JWT-Signature`. Va accertato se l'integrità sia richiesta su un'altra API o gestita altrove.

## Struttura dei file

| Percorso | Responsabilità |
|---|---|
| `docs/contracts/rentri/*.yaml` | OpenAPI ufficiali scaricati, immutabili |
| `docs/contracts/rentri/MANIFEST.md` | Provenienza: URL, data, versione, digest SHA-256 di ogni file |
| `tools/rentri-fake/scripts/scarica-contratti.sh` | Riscaricamento riproducibile dei contratti |
| `tools/rentri-fake/src/server.ts` | Composizione Fastify e avvio |
| `tools/rentri-fake/src/auth/jwt-verifier.ts` | Verifica JWT ID_AUTH_REST_02 |
| `tools/rentri-fake/src/routes/token.ts` | Rifiuto esplicito di `/token` con 404 |
| `tools/rentri-fake/src/routes/formulari.ts` | Endpoint del dominio formulari |
| `tools/rentri-fake/src/routes/transazioni.ts` | Asincronia NONBLOCK_PULL |
| `tools/rentri-fake/src/routes/controllo.ts` | Iniezione deterministica di guasti |
| `tools/rentri-fake/src/xfir/validatore-asice.ts` | Validazione container ASiC-E |
| `tools/rentri-fake/src/xfir/validatore-xades.ts` | Firme XAdES-B e regola di copertura |
| `tools/rentri-fake/src/stato/archivio.ts` | Stato in memoria (formulari, transazioni, guasti) |
| `tools/rentri-fake/test/**` | Test, ognuno con caso accettato e caso respinto |
| `tools/rentri-fake/Dockerfile` | Immagine lean multistage |

---

### Task 1: Scaricare e versionare i contratti ufficiali

**Files:**
- Create: `tools/rentri-fake/scripts/scarica-contratti.sh`
- Create: `docs/contracts/rentri/MANIFEST.md`
- Create: `docs/contracts/rentri/{formulari,anagrafiche,codifiche}.yaml`

**Interfaces:**
- Produce: i file YAML in `docs/contracts/rentri/` sono la **fonte di verità** per tutti i task successivi e per le pipeline P2/P3. Nessun altro task può parafrasarli.

- [ ] **Step 1: Scrivere lo script di scaricamento**

```bash
#!/usr/bin/env bash
# Scarica gli OpenAPI ufficiali RENTRI e ne registra la provenienza.
# I documenti sono YAML anche se serviti con estensione .json.
set -euo pipefail

BASE="https://demoapi.rentri.gov.it/docs"
DEST="$(cd "$(dirname "$0")/../../../docs/contracts/rentri" && pwd)"
API_DISPONIBILI=("formulari" "anagrafiche" "codifiche")

mkdir -p "$DEST"
: > "$DEST/MANIFEST.md"
{
  echo "# Contratti ufficiali RENTRI"
  echo
  echo "Scaricati da \`$BASE\`. NON modificare a mano: rieseguire lo script."
  echo
  echo "| API | URL | Versione | SHA-256 | Scaricato il |"
  echo "|-----|-----|----------|---------|--------------|"
} >> "$DEST/MANIFEST.md"

for api in "${API_DISPONIBILI[@]}"; do
  url="$BASE/$api/v1.0/openapi.json"
  echo "Scarico $api da $url"
  curl -sfS --max-time 60 "$url" -o "$DEST/$api.yaml"
  versione="$(grep -m1 '^  version:' "$DEST/$api.yaml" | sed 's/^  version: *//')"
  digest="$(sha256sum "$DEST/$api.yaml" | cut -d' ' -f1)"
  echo "| $api | $url | $versione | \`$digest\` | $(date -u +%Y-%m-%d) |" >> "$DEST/MANIFEST.md"
done

echo
echo "Contratti scaricati in $DEST"
```

- [ ] **Step 2: Eseguire lo script e verificare l'esito**

Esegui: `bash tools/rentri-fake/scripts/scarica-contratti.sh`
Atteso: tre file YAML in `docs/contracts/rentri/` e un `MANIFEST.md` con tre righe popolate.

Verifica che il contenuto sia una specifica reale e non una pagina di errore:

```bash
head -3 docs/contracts/rentri/formulari.yaml
grep -c '^  /' docs/contracts/rentri/formulari.yaml
```

Atteso: la prima riga è `openapi: 3.0.4`; il conteggio dei path è **29**.

- [ ] **Step 3: Accertare la questione aperta sull'integrità**

Esegui:

```bash
grep -niE "digest|agid-jwt|signature|integrity" docs/contracts/rentri/*.yaml | head -20
```

Registra l'esito in coda a `MANIFEST.md` sotto un titolo `## Integrità dei messaggi`, con una di queste due frasi, secondo ciò che trovi:

- se ci sono occorrenze: elenca API, path e nome esatto degli header richiesti;
- se non ce ne sono: scrivi «Nessun header di integrità (`Digest`, `Agid-JWT-Signature`) è dichiarato negli OpenAPI scaricati. INTEGRITY_REST_01 non è quindi verificabile da questi contratti: la fake API non lo impone. Da riverificare quando saranno disponibili le credenziali demo.»

Questa è una decisione di contratto: non inventare un requisito che la specifica non dichiara.

- [ ] **Step 4: Cercare l'API registri**

Esegui:

```bash
for a in registri registro registri-cronologici vidimazione; do
  printf "%-24s %s\n" "$a" "$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "https://demoapi.rentri.gov.it/docs/$a/v1.0/openapi.json")"
done
```

Se una variante risponde 200, aggiungila all'array `API_DISPONIBILI` dello script e riesegui. Se nessuna risponde, aggiungi a `MANIFEST.md`: «L'API dei registri non è esposta su `/docs/{api}/v1.0/openapi.json`. Copertura limitata a formulari, anagrafiche, codifiche.»

- [ ] **Step 5: Commit**

```bash
git add tools/rentri-fake/scripts/scarica-contratti.sh docs/contracts/rentri/
git commit -m "feat(contratti): scarica e versiona gli OpenAPI ufficiali RENTRI

Fonte di verita' per l'integrazione: documenti scaricati dall'ente, non
parafrasati. MANIFEST.md registra URL, versione e digest di ogni file."
```

---

### Task 2: Scaffold del servizio fake

**Files:**
- Create: `tools/rentri-fake/package.json`, `tsconfig.json`, `jest.config.js`, `.gitignore`
- Create: `tools/rentri-fake/src/server.ts`
- Create: `tools/rentri-fake/src/app.ts`
- Create: `tools/rentri-fake/test/salute.test.ts`

**Interfaces:**
- Produce: `creaApp(): FastifyInstance` — usata da tutti i test successivi via `app.inject()`, senza aprire porte.

- [ ] **Step 1: Creare il manifesto del pacchetto**

`tools/rentri-fake/package.json`:

```json
{
  "name": "rentri-fake",
  "version": "1.0.0",
  "private": true,
  "description": "Fake API RENTRI fedele: rifiuta cio' che RENTRI rifiuterebbe",
  "main": "dist/server.js",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "start": "node dist/server.js",
    "dev": "ts-node src/server.ts",
    "test": "jest --runInBand"
  },
  "dependencies": {
    "fastify": "^4.28.1",
    "jose": "^5.9.6",
    "jszip": "^3.10.1",
    "node-forge": "^1.3.1",
    "@xmldom/xmldom": "^0.9.5",
    "xpath": "^0.0.34"
  },
  "devDependencies": {
    "@types/jest": "^29.5.12",
    "@types/node": "^20.14.0",
    "@types/node-forge": "^1.3.11",
    "jest": "^29.7.0",
    "ts-jest": "^29.2.5",
    "ts-node": "^10.9.2",
    "typescript": "5.4.5"
  }
}
```

- [ ] **Step 2: Configurare TypeScript e Jest**

`tools/rentri-fake/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "lib": ["ES2022"],
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "declaration": false
  },
  "include": ["src/**/*.ts"]
}
```

`tools/rentri-fake/jest.config.js`:

```js
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/test'],
  testMatch: ['**/*.test.ts'],
  clearMocks: true,
}
```

`tools/rentri-fake/.gitignore`:

```
node_modules/
dist/
```

- [ ] **Step 3: Scrivere il test che fallisce**

`tools/rentri-fake/test/salute.test.ts`:

```ts
import { creaApp } from '../src/app'

describe('Salute del servizio', () => {
  it('risponde 200 con il nome del servizio', async () => {
    const app = creaApp()
    const risposta = await app.inject({ method: 'GET', url: '/__salute' })

    expect(risposta.statusCode).toBe(200)
    expect(risposta.json()).toEqual({ servizio: 'rentri-fake', stato: 'ok' })

    await app.close()
  })
})
```

- [ ] **Step 4: Eseguire il test e verificare che fallisca**

Esegui: `cd tools/rentri-fake && npm install && npm test`
Atteso: FALLISCE con `Cannot find module '../src/app'`.

- [ ] **Step 5: Implementare il minimo necessario**

`tools/rentri-fake/src/app.ts`:

```ts
import Fastify, { FastifyInstance } from 'fastify'

/**
 * Compone l'applicazione senza avviarla, così i test possono usare
 * `app.inject()` senza occupare porte.
 */
export function creaApp(): FastifyInstance {
  const app = Fastify({ logger: false })

  app.get('/__salute', async () => ({ servizio: 'rentri-fake', stato: 'ok' }))

  return app
}
```

`tools/rentri-fake/src/server.ts`:

```ts
import { creaApp } from './app'

const PORTA = Number(process.env.PORT ?? 4010)

async function avvia(): Promise<void> {
  const app = creaApp()
  await app.listen({ port: PORTA, host: '0.0.0.0' })
  // eslint-disable-next-line no-console
  console.log(`rentri-fake in ascolto sulla porta ${PORTA}`)
}

avvia().catch((errore) => {
  // eslint-disable-next-line no-console
  console.error('Avvio fallito:', errore)
  process.exit(1)
})
```

- [ ] **Step 6: Eseguire il test e verificare che passi**

Esegui: `cd tools/rentri-fake && npm test`
Atteso: PASSA, 1 test.

- [ ] **Step 7: Commit**

```bash
git add tools/rentri-fake/
git commit -m "feat(rentri-fake): scaffold del servizio con endpoint di salute"
```

---

### Task 3: Rifiutare `/token` con 404

Questo è il test che **dimostra il difetto centrale** dell'integrazione attuale: il codice dell'applicazione chiama `POST ${baseUrl}/token`, che in RENTRI non esiste.

**Files:**
- Create: `tools/rentri-fake/src/routes/token.ts`
- Create: `tools/rentri-fake/test/token-inesistente.test.ts`
- Modify: `tools/rentri-fake/src/app.ts`

**Interfaces:**
- Consuma: `creaApp()` da Task 2.
- Produce: `registraRotteToken(app: FastifyInstance): void`.

- [ ] **Step 1: Scrivere il test che fallisce**

`tools/rentri-fake/test/token-inesistente.test.ts`:

```ts
import { creaApp } from '../src/app'

describe('Endpoint /token — non esiste in RENTRI', () => {
  it('risponde 404 a POST /token, come farebbe RENTRI', async () => {
    const app = creaApp()
    const risposta = await app.inject({
      method: 'POST',
      url: '/token',
      payload: { grant_type: 'client_credentials', client_id: 'x', client_secret: 'y' },
    })

    expect(risposta.statusCode).toBe(404)
    expect(risposta.json()).toMatchObject({
      titolo: 'Risorsa non trovata',
    })

    await app.close()
  })

  it('risponde 404 anche a GET /token', async () => {
    const app = creaApp()
    const risposta = await app.inject({ method: 'GET', url: '/token' })

    expect(risposta.statusCode).toBe(404)

    await app.close()
  })
})
```

- [ ] **Step 2: Eseguire il test e verificare che fallisca**

Esegui: `cd tools/rentri-fake && npm test -- token-inesistente`
Atteso: FALLISCE — Fastify risponde 404 ma con il proprio corpo, privo del campo `titolo`.

- [ ] **Step 3: Implementare**

`tools/rentri-fake/src/routes/token.ts`:

```ts
import { FastifyInstance } from 'fastify'

/**
 * RENTRI non espone alcun endpoint /token: l'autenticazione e' ID_AUTH_REST_02
 * (JWT self-issued passato direttamente come Bearer). Registriamo la rotta
 * apposta per rispondere 404 con un corpo esplicito: serve a far fallire in
 * modo comprensibile qualunque client che tenti un OAuth2 client_credentials.
 */
export function registraRotteToken(app: FastifyInstance): void {
  const rispondi404 = async (_richiesta: unknown, risposta: import('fastify').FastifyReply) =>
    risposta.status(404).send({
      titolo: 'Risorsa non trovata',
      dettaglio:
        "RENTRI non espone un endpoint /token. L'autenticazione e' ID_AUTH_REST_02: " +
        'JWT self-issued firmato localmente e passato come Authorization: Bearer.',
    })

  app.post('/token', rispondi404)
  app.get('/token', rispondi404)
}
```

In `tools/rentri-fake/src/app.ts`, aggiungi l'import e la registrazione prima del `return app`:

```ts
import { registraRotteToken } from './routes/token'
```

```ts
  registraRotteToken(app)
```

- [ ] **Step 4: Eseguire il test e verificare che passi**

Esegui: `cd tools/rentri-fake && npm test -- token-inesistente`
Atteso: PASSA, 2 test.

- [ ] **Step 5: Commit**

```bash
git add tools/rentri-fake/
git commit -m "feat(rentri-fake): /token risponde 404 come RENTRI

Dimostra il difetto dell'integrazione attuale, che tenta un OAuth2
client_credentials verso un endpoint inesistente."
```

---

### Task 4: Verificare il JWT self-issued ID_AUTH_REST_02

**Files:**
- Create: `tools/rentri-fake/src/auth/jwt-verifier.ts`
- Create: `tools/rentri-fake/test/aiuti/certificati.ts`
- Create: `tools/rentri-fake/test/jwt-verifier.test.ts`

**Interfaces:**
- Produce: `verificaJwt(authorization: string | undefined, opzioni: OpzioniVerifica): Promise<EsitoVerifica>` dove
  `OpzioniVerifica = { audienceAttesa: string; adesso?: Date }` e
  `EsitoVerifica = { valido: true; soggetto: string } | { valido: false; motivo: string }`.
- Produce: `creaCertificatoDiTest()` in `test/aiuti/certificati.ts`, che restituisce
  `{ chiavePrivataPem: string; certificatoBase64Der: string }`.

- [ ] **Step 1: Scrivere l'aiuto per generare certificati di test**

`tools/rentri-fake/test/aiuti/certificati.ts`:

```ts
import forge from 'node-forge'

/**
 * Genera una coppia chiave/certificato autofirmata per i test.
 * Il certificato serve a popolare l'header x5c del JWT self-issued.
 */
export function creaCertificatoDiTest(commonName = 'operatore-test'): {
  chiavePrivataPem: string
  certificatoBase64Der: string
} {
  const coppia = forge.pki.rsa.generateKeyPair(2048)
  const certificato = forge.pki.createCertificate()

  certificato.publicKey = coppia.publicKey
  certificato.serialNumber = '01'
  certificato.validity.notBefore = new Date(Date.now() - 60_000)
  certificato.validity.notAfter = new Date(Date.now() + 86_400_000)

  const attributi = [{ name: 'commonName', value: commonName }]
  certificato.setSubject(attributi)
  certificato.setIssuer(attributi)
  certificato.sign(coppia.privateKey, forge.md.sha256.create())

  const der = forge.asn1.toDer(forge.pki.certificateToAsn1(certificato)).getBytes()

  return {
    chiavePrivataPem: forge.pki.privateKeyToPem(coppia.privateKey),
    certificatoBase64Der: forge.util.encode64(der),
  }
}
```

- [ ] **Step 2: Scrivere i test che falliscono**

`tools/rentri-fake/test/jwt-verifier.test.ts`:

```ts
import { importPKCS8, SignJWT } from 'jose'
import { creaCertificatoDiTest } from './aiuti/certificati'
import { verificaJwt } from '../src/auth/jwt-verifier'

const AUDIENCE = 'rentrigov.demo.api'

async function creaToken(opzioni: {
  audience?: string
  scadenzaSecondiDaOra?: number
  includiX5c?: boolean
}): Promise<string> {
  const { chiavePrivataPem, certificatoBase64Der } = creaCertificatoDiTest()
  const chiave = await importPKCS8(chiavePrivataPem, 'RS256')

  const intestazione: Record<string, unknown> = { alg: 'RS256' }
  if (opzioni.includiX5c !== false) {
    intestazione.x5c = [certificatoBase64Der]
  }

  return new SignJWT({})
    .setProtectedHeader(intestazione as never)
    .setIssuer('operatore-test')
    .setSubject('operatore-test')
    .setAudience(opzioni.audience ?? AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${opzioni.scadenzaSecondiDaOra ?? 300}s`)
    .sign(chiave)
}

describe('Verifica JWT ID_AUTH_REST_02', () => {
  it('accetta un JWT self-issued valido con x5c corretto', async () => {
    const token = await creaToken({})
    const esito = await verificaJwt(`Bearer ${token}`, { audienceAttesa: AUDIENCE })

    expect(esito).toEqual({ valido: true, soggetto: 'operatore-test' })
  })

  it('rifiuta un token con audience errata', async () => {
    const token = await creaToken({ audience: 'audience-sbagliata' })
    const esito = await verificaJwt(`Bearer ${token}`, { audienceAttesa: AUDIENCE })

    expect(esito.valido).toBe(false)
  })

  it('rifiuta un token privo di header x5c', async () => {
    const token = await creaToken({ includiX5c: false })
    const esito = await verificaJwt(`Bearer ${token}`, { audienceAttesa: AUDIENCE })

    expect(esito).toEqual({ valido: false, motivo: 'header x5c assente' })
  })

  it('rifiuta un token scaduto', async () => {
    const token = await creaToken({ scadenzaSecondiDaOra: -10 })
    const esito = await verificaJwt(`Bearer ${token}`, { audienceAttesa: AUDIENCE })

    expect(esito.valido).toBe(false)
  })

  it('rifiuta un header Authorization assente', async () => {
    const esito = await verificaJwt(undefined, { audienceAttesa: AUDIENCE })

    expect(esito).toEqual({ valido: false, motivo: 'header Authorization assente' })
  })

  it('rifiuta uno schema diverso da Bearer', async () => {
    const esito = await verificaJwt('Basic dXNlcjpwYXNz', { audienceAttesa: AUDIENCE })

    expect(esito).toEqual({ valido: false, motivo: 'schema di autorizzazione non Bearer' })
  })

  it('rifiuta un token la cui firma non corrisponde alla chiave in x5c', async () => {
    const token = await creaToken({})
    const altro = creaCertificatoDiTest('altro-operatore')
    const parti = token.split('.')
    const intestazioneManomessa = Buffer.from(
      JSON.stringify({ alg: 'RS256', x5c: [altro.certificatoBase64Der] })
    ).toString('base64url')
    const manomesso = `${intestazioneManomessa}.${parti[1]}.${parti[2]}`

    const esito = await verificaJwt(`Bearer ${manomesso}`, { audienceAttesa: AUDIENCE })

    expect(esito.valido).toBe(false)
  })
})
```

- [ ] **Step 3: Eseguire i test e verificare che falliscano**

Esegui: `cd tools/rentri-fake && npm test -- jwt-verifier`
Atteso: FALLISCE con `Cannot find module '../src/auth/jwt-verifier'`.

- [ ] **Step 4: Implementare**

`tools/rentri-fake/src/auth/jwt-verifier.ts`:

```ts
import { importX509, jwtVerify } from 'jose'

export interface OpzioniVerifica {
  audienceAttesa: string
  adesso?: Date
}

export type EsitoVerifica = { valido: true; soggetto: string } | { valido: false; motivo: string }

/**
 * Verifica un JWT self-issued secondo il pattern AgID ID_AUTH_REST_02 in
 * direct trust: la chiave pubblica NON viene da un registro, ma dal
 * certificato che il chiamante allega nell'header x5c. Verifichiamo quindi
 * che la firma corrisponda a quel certificato e che le claim siano coerenti.
 */
export async function verificaJwt(
  authorization: string | undefined,
  opzioni: OpzioniVerifica
): Promise<EsitoVerifica> {
  if (!authorization) {
    return { valido: false, motivo: 'header Authorization assente' }
  }

  const [schema, token] = authorization.split(' ')
  if (schema !== 'Bearer' || !token) {
    return { valido: false, motivo: 'schema di autorizzazione non Bearer' }
  }

  let intestazione: { x5c?: string[] }
  try {
    intestazione = JSON.parse(Buffer.from(token.split('.')[0] ?? '', 'base64url').toString('utf8'))
  } catch {
    return { valido: false, motivo: 'intestazione JWT illeggibile' }
  }

  const x5c = intestazione.x5c
  if (!x5c || x5c.length === 0) {
    return { valido: false, motivo: 'header x5c assente' }
  }

  const pem = `-----BEGIN CERTIFICATE-----\n${x5c[0]}\n-----END CERTIFICATE-----`

  try {
    const chiavePubblica = await importX509(pem, 'RS256')
    const { payload } = await jwtVerify(token, chiavePubblica, {
      audience: opzioni.audienceAttesa,
      currentDate: opzioni.adesso,
    })

    if (!payload.sub) {
      return { valido: false, motivo: 'claim sub assente' }
    }

    return { valido: true, soggetto: String(payload.sub) }
  } catch (errore) {
    return { valido: false, motivo: `verifica fallita: ${(errore as Error).message}` }
  }
}
```

- [ ] **Step 5: Eseguire i test e verificare che passino**

Esegui: `cd tools/rentri-fake && npm test -- jwt-verifier`
Atteso: PASSA, 7 test — di cui **6 sono casi di rifiuto**.

- [ ] **Step 6: Commit**

```bash
git add tools/rentri-fake/
git commit -m "feat(rentri-fake): verifica del JWT self-issued ID_AUTH_REST_02

Direct trust: la chiave pubblica proviene dal certificato in x5c. Sette test,
sei dei quali verificano che token non conformi vengano respinti."
```

---

### Task 5: Proteggere le rotte del dominio formulari

**Files:**
- Create: `tools/rentri-fake/src/stato/archivio.ts`
- Create: `tools/rentri-fake/src/routes/formulari.ts`
- Create: `tools/rentri-fake/test/formulari.test.ts`
- Modify: `tools/rentri-fake/src/app.ts`

**Interfaces:**
- Consuma: `verificaJwt` da Task 4.
- Produce: `class Archivio` con `azzera()`, `salvaFormulario(f: Formulario)`, `leggiFormulario(numeroFir: string)`.
- Produce: `registraRotteFormulari(app: FastifyInstance, archivio: Archivio): void`.
- Produce: tipo `Formulario = { numero_fir: string; stato: string; produttore: string }`.

- [ ] **Step 1: Scrivere i test che falliscono**

`tools/rentri-fake/test/formulari.test.ts`:

```ts
import { importPKCS8, SignJWT } from 'jose'
import { creaApp } from '../src/app'
import { creaCertificatoDiTest } from './aiuti/certificati'

async function tokenValido(): Promise<string> {
  const { chiavePrivataPem, certificatoBase64Der } = creaCertificatoDiTest()
  const chiave = await importPKCS8(chiavePrivataPem, 'RS256')

  return new SignJWT({})
    .setProtectedHeader({ alg: 'RS256', x5c: [certificatoBase64Der] } as never)
    .setIssuer('operatore-test')
    .setSubject('operatore-test')
    .setAudience('rentrigov.demo.api')
    .setIssuedAt()
    .setExpirationTime('300s')
    .sign(chiave)
}

describe('Rotte formulari', () => {
  it('rifiuta con 401 la lista senza token', async () => {
    const app = creaApp()
    const risposta = await app.inject({ method: 'GET', url: '/formulari/v1.0/' })

    expect(risposta.statusCode).toBe(401)

    await app.close()
  })

  it('restituisce la lista con un token valido', async () => {
    const app = creaApp()
    const risposta = await app.inject({
      method: 'GET',
      url: '/formulari/v1.0/',
      headers: { authorization: `Bearer ${await tokenValido()}` },
    })

    expect(risposta.statusCode).toBe(200)
    expect(Array.isArray(risposta.json())).toBe(true)

    await app.close()
  })

  it('risponde 404 per un formulario inesistente', async () => {
    const app = creaApp()
    const risposta = await app.inject({
      method: 'GET',
      url: '/formulari/v1.0/FIR-INESISTENTE',
      headers: { authorization: `Bearer ${await tokenValido()}` },
    })

    expect(risposta.statusCode).toBe(404)

    await app.close()
  })
})
```

- [ ] **Step 2: Eseguire i test e verificare che falliscano**

Esegui: `cd tools/rentri-fake && npm test -- formulari`
Atteso: FALLISCE — le rotte `/formulari/v1.0/*` non esistono, Fastify risponde 404 anche al primo test che ne attende 401.

- [ ] **Step 3: Implementare l'archivio**

`tools/rentri-fake/src/stato/archivio.ts`:

```ts
export interface Formulario {
  numero_fir: string
  stato: string
  produttore: string
}

/**
 * Stato in memoria della fake. Volutamente non persistente: ogni avvio
 * riparte pulito, così i test non dipendono dall'ordine di esecuzione.
 */
export class Archivio {
  private formulari = new Map<string, Formulario>()

  azzera(): void {
    this.formulari.clear()
  }

  salvaFormulario(formulario: Formulario): void {
    this.formulari.set(formulario.numero_fir, formulario)
  }

  leggiFormulario(numeroFir: string): Formulario | undefined {
    return this.formulari.get(numeroFir)
  }

  elencaFormulari(): Formulario[] {
    return [...this.formulari.values()]
  }
}
```

- [ ] **Step 4: Implementare le rotte**

`tools/rentri-fake/src/routes/formulari.ts`:

```ts
import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { verificaJwt } from '../auth/jwt-verifier'
import { Archivio } from '../stato/archivio'

const AUDIENCE = process.env.RENTRI_AUDIENCE ?? 'rentrigov.demo.api'
const PREFISSO = '/formulari/v1.0'

async function autentica(richiesta: FastifyRequest, risposta: FastifyReply): Promise<boolean> {
  const esito = await verificaJwt(richiesta.headers.authorization, { audienceAttesa: AUDIENCE })

  if (!esito.valido) {
    await risposta.status(401).send({ titolo: 'Non autorizzato', dettaglio: esito.motivo })
    return false
  }

  return true
}

export function registraRotteFormulari(app: FastifyInstance, archivio: Archivio): void {
  app.get(`${PREFISSO}/`, async (richiesta, risposta) => {
    if (!(await autentica(richiesta, risposta))) return
    return archivio.elencaFormulari()
  })

  app.get<{ Params: { numero_fir: string } }>(
    `${PREFISSO}/:numero_fir`,
    async (richiesta, risposta) => {
      if (!(await autentica(richiesta, risposta))) return

      const formulario = archivio.leggiFormulario(richiesta.params.numero_fir)
      if (!formulario) {
        return risposta.status(404).send({ titolo: 'Formulario non trovato' })
      }

      return formulario
    }
  )
}
```

In `tools/rentri-fake/src/app.ts` aggiungi:

```ts
import { registraRotteFormulari } from './routes/formulari'
import { Archivio } from './stato/archivio'
```

e, prima del `return app`:

```ts
  const archivio = new Archivio()
  app.decorate('archivio', archivio)
  registraRotteFormulari(app, archivio)
```

- [ ] **Step 5: Eseguire i test e verificare che passino**

Esegui: `cd tools/rentri-fake && npm test`
Atteso: PASSA, tutti i test delle suite precedenti inclusi.

- [ ] **Step 6: Commit**

```bash
git add tools/rentri-fake/
git commit -m "feat(rentri-fake): rotte formulari protette da JWT

401 senza token valido, 404 su formulario inesistente, prefisso /formulari/v1.0
come nel campo servers dell'OpenAPI ufficiale."
```

---

### Task 6: Asincronia NONBLOCK_PULL

RENTRI non risponde in modo sincrono su tutte le operazioni: restituisce un `transazione_id` e obbliga il client al polling su `/{transazione_id}/status` e `/{transazione_id}/result`. Se la fake rispondesse subito, il client verrebbe scritto con l'assunzione sbagliata.

**Files:**
- Create: `tools/rentri-fake/src/routes/transazioni.ts`
- Create: `tools/rentri-fake/test/transazioni.test.ts`
- Modify: `tools/rentri-fake/src/stato/archivio.ts`
- Modify: `tools/rentri-fake/src/app.ts`

**Interfaces:**
- Consuma: `Archivio` da Task 5, `verificaJwt` da Task 4.
- Produce: su `Archivio` i metodi `creaTransazione(): string`, `leggiTransazione(id: string)`, `completaTransazione(id: string, risultato: unknown): void`.
- Produce: `registraRotteTransazioni(app: FastifyInstance, archivio: Archivio): void`.
- Produce: stato transazione `'in_elaborazione' | 'completata' | 'fallita'`.

- [ ] **Step 1: Scrivere i test che falliscono**

`tools/rentri-fake/test/transazioni.test.ts`:

```ts
import { importPKCS8, SignJWT } from 'jose'
import { creaApp } from '../src/app'
import { creaCertificatoDiTest } from './aiuti/certificati'

async function tokenValido(): Promise<string> {
  const { chiavePrivataPem, certificatoBase64Der } = creaCertificatoDiTest()
  const chiave = await importPKCS8(chiavePrivataPem, 'RS256')

  return new SignJWT({})
    .setProtectedHeader({ alg: 'RS256', x5c: [certificatoBase64Der] } as never)
    .setIssuer('operatore-test')
    .setSubject('operatore-test')
    .setAudience('rentrigov.demo.api')
    .setIssuedAt()
    .setExpirationTime('300s')
    .sign(chiave)
}

describe('Asincronia NONBLOCK_PULL', () => {
  it('la trasmissione restituisce 202 con un transazione_id, non il risultato', async () => {
    const app = creaApp()
    const risposta = await app.inject({
      method: 'POST',
      url: '/formulari/v1.0/FIR-0001/trasmissione',
      headers: { authorization: `Bearer ${await tokenValido()}` },
      payload: { dati: 'qualsiasi' },
    })

    expect(risposta.statusCode).toBe(202)
    expect(risposta.json()).toHaveProperty('transazione_id')
    expect(risposta.json()).not.toHaveProperty('risultato')

    await app.close()
  })

  it('lo stato è in_elaborazione finché non si completa', async () => {
    const app = creaApp()
    const intestazioni = { authorization: `Bearer ${await tokenValido()}` }

    const creazione = await app.inject({
      method: 'POST',
      url: '/formulari/v1.0/FIR-0002/trasmissione',
      headers: intestazioni,
      payload: {},
    })
    const id = creazione.json().transazione_id

    const stato = await app.inject({
      method: 'GET',
      url: `/formulari/v1.0/${id}/status`,
      headers: intestazioni,
    })

    expect(stato.statusCode).toBe(200)
    expect(stato.json().stato).toBe('in_elaborazione')

    await app.close()
  })

  it('il risultato non è disponibile finché la transazione è in corso', async () => {
    const app = creaApp()
    const intestazioni = { authorization: `Bearer ${await tokenValido()}` }

    const creazione = await app.inject({
      method: 'POST',
      url: '/formulari/v1.0/FIR-0003/trasmissione',
      headers: intestazioni,
      payload: {},
    })
    const id = creazione.json().transazione_id

    const risultato = await app.inject({
      method: 'GET',
      url: `/formulari/v1.0/${id}/result`,
      headers: intestazioni,
    })

    expect(risultato.statusCode).toBe(409)

    await app.close()
  })

  it('status di una transazione inesistente risponde 404', async () => {
    const app = creaApp()
    const risposta = await app.inject({
      method: 'GET',
      url: '/formulari/v1.0/transazione-inesistente/status',
      headers: { authorization: `Bearer ${await tokenValido()}` },
    })

    expect(risposta.statusCode).toBe(404)

    await app.close()
  })
})
```

- [ ] **Step 2: Eseguire i test e verificare che falliscano**

Esegui: `cd tools/rentri-fake && npm test -- transazioni`
Atteso: FALLISCE — le rotte non esistono.

- [ ] **Step 3: Estendere l'archivio**

Aggiungi in `tools/rentri-fake/src/stato/archivio.ts`, dentro la classe `Archivio`:

```ts
export type StatoTransazione = 'in_elaborazione' | 'completata' | 'fallita'

export interface Transazione {
  id: string
  stato: StatoTransazione
  risultato?: unknown
}
```

```ts
  private transazioni = new Map<string, Transazione>()
  private contatore = 0

  creaTransazione(): string {
    this.contatore += 1
    const id = `TRX-${String(this.contatore).padStart(6, '0')}`
    this.transazioni.set(id, { id, stato: 'in_elaborazione' })
    return id
  }

  leggiTransazione(id: string): Transazione | undefined {
    return this.transazioni.get(id)
  }

  completaTransazione(id: string, risultato: unknown): void {
    const transazione = this.transazioni.get(id)
    if (!transazione) return
    transazione.stato = 'completata'
    transazione.risultato = risultato
  }
```

Aggiorna anche `azzera()` perché svuoti entrambe le mappe:

```ts
  azzera(): void {
    this.formulari.clear()
    this.transazioni.clear()
    this.contatore = 0
  }
```

- [ ] **Step 4: Implementare le rotte**

`tools/rentri-fake/src/routes/transazioni.ts`:

```ts
import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { verificaJwt } from '../auth/jwt-verifier'
import { Archivio } from '../stato/archivio'

const AUDIENCE = process.env.RENTRI_AUDIENCE ?? 'rentrigov.demo.api'
const PREFISSO = '/formulari/v1.0'

async function autentica(richiesta: FastifyRequest, risposta: FastifyReply): Promise<boolean> {
  const esito = await verificaJwt(richiesta.headers.authorization, { audienceAttesa: AUDIENCE })

  if (!esito.valido) {
    await risposta.status(401).send({ titolo: 'Non autorizzato', dettaglio: esito.motivo })
    return false
  }

  return true
}

/**
 * NONBLOCK_PULL: l'operazione non restituisce il risultato ma un
 * identificativo da interrogare. La fake NON completa automaticamente la
 * transazione: il completamento avviene solo tramite il canale di controllo
 * (Task 8), così i test decidono quando e come l'elaborazione termina.
 */
export function registraRotteTransazioni(app: FastifyInstance, archivio: Archivio): void {
  app.post<{ Params: { numero_fir: string } }>(
    `${PREFISSO}/:numero_fir/trasmissione`,
    async (richiesta, risposta) => {
      if (!(await autentica(richiesta, risposta))) return

      const id = archivio.creaTransazione()
      return risposta.status(202).send({ transazione_id: id })
    }
  )

  app.get<{ Params: { transazione_id: string } }>(
    `${PREFISSO}/:transazione_id/status`,
    async (richiesta, risposta) => {
      if (!(await autentica(richiesta, risposta))) return

      const transazione = archivio.leggiTransazione(richiesta.params.transazione_id)
      if (!transazione) {
        return risposta.status(404).send({ titolo: 'Transazione non trovata' })
      }

      return { transazione_id: transazione.id, stato: transazione.stato }
    }
  )

  app.get<{ Params: { transazione_id: string } }>(
    `${PREFISSO}/:transazione_id/result`,
    async (richiesta, risposta) => {
      if (!(await autentica(richiesta, risposta))) return

      const transazione = archivio.leggiTransazione(richiesta.params.transazione_id)
      if (!transazione) {
        return risposta.status(404).send({ titolo: 'Transazione non trovata' })
      }

      if (transazione.stato === 'in_elaborazione') {
        return risposta.status(409).send({
          titolo: 'Elaborazione in corso',
          dettaglio: "Interrogare /status finche' lo stato non e' completata.",
        })
      }

      return { transazione_id: transazione.id, risultato: transazione.risultato ?? null }
    }
  )
}
```

**Nota sull'ordine di registrazione:** `:numero_fir` e `:transazione_id` occupano la stessa posizione nel path. Registra `registraRotteTransazioni` **dopo** `registraRotteFormulari` in `app.ts` e verifica con i test che `/FIR-0001` risolva sul formulario e `/TRX-000001/status` sulla transazione — i suffissi `/status` e `/result` li distinguono.

In `tools/rentri-fake/src/app.ts` aggiungi l'import e, dopo `registraRotteFormulari(app, archivio)`:

```ts
  registraRotteTransazioni(app, archivio)
```

- [ ] **Step 5: Eseguire i test e verificare che passino**

Esegui: `cd tools/rentri-fake && npm test`
Atteso: PASSA, tutte le suite.

- [ ] **Step 6: Commit**

```bash
git add tools/rentri-fake/
git commit -m "feat(rentri-fake): asincronia NONBLOCK_PULL con transazione_id

202 + polling su /status e /result. Il risultato non e' disponibile finche'
l'elaborazione e' in corso: impedisce di scrivere il client come se
l'operazione fosse sincrona."
```

---

### Task 7: Validare l'xFIR (ASiC-E + XAdES-B con regola di copertura)

È la regola che nessun altro strumento a nostra disposizione può verificare: **ogni firma deve referenziare tutti gli XML già presenti nel container**.

**Files:**
- Create: `tools/rentri-fake/src/xfir/validatore-asice.ts`
- Create: `tools/rentri-fake/src/xfir/validatore-xades.ts`
- Create: `tools/rentri-fake/test/aiuti/xfir.ts`
- Create: `tools/rentri-fake/test/xfir.test.ts`

**Interfaces:**
- Produce: `validaAsicE(contenuto: Buffer): Promise<EsitoValidazione>` con
  `EsitoValidazione = { valido: true; xmlPresenti: string[]; firme: string[] } | { valido: false; motivo: string }`.
- Produce: `verificaCopertura(firme: FirmaXades[], xmlPresenti: string[]): EsitoValidazione` con
  `FirmaXades = { nomeFile: string; riferimenti: string[] }`.
- Produce, in `test/aiuti/xfir.ts`: `creaContainerXfir(opzioni: { xml: string[]; firme: { nomeFile: string; copre: string[] }[]; conMimetype?: boolean }): Promise<Buffer>`.

- [ ] **Step 1: Scrivere l'aiuto per costruire container di prova**

`tools/rentri-fake/test/aiuti/xfir.ts`:

```ts
import JSZip from 'jszip'

/**
 * Costruisce un container ASiC-E minimo ma strutturalmente corretto, con
 * firme XAdES detached i cui Reference puntano ai file indicati in `copre`.
 * Serve a produrre sia container validi sia container deliberatamente
 * scorretti (firme che non coprono tutto).
 */
export async function creaContainerXfir(opzioni: {
  xml: string[]
  firme: { nomeFile: string; copre: string[] }[]
  conMimetype?: boolean
}): Promise<Buffer> {
  const zip = new JSZip()

  if (opzioni.conMimetype !== false) {
    zip.file('mimetype', 'application/vnd.etsi.asic-e+zip')
  }

  for (const nome of opzioni.xml) {
    zip.file(nome, `<?xml version="1.0" encoding="UTF-8"?><documento nome="${nome}"/>`)
  }

  for (const firma of opzioni.firme) {
    const riferimenti = firma.copre
      .map((bersaglio) => `<ds:Reference URI="${bersaglio}"><ds:DigestValue>x</ds:DigestValue></ds:Reference>`)
      .join('')

    const xmlFirma =
      '<?xml version="1.0" encoding="UTF-8"?>' +
      '<asic:XAdESSignatures xmlns:asic="http://uri.etsi.org/02918/v1.2.1#" ' +
      'xmlns:ds="http://www.w3.org/2000/09/xmldsig#">' +
      `<ds:Signature><ds:SignedInfo>${riferimenti}</ds:SignedInfo></ds:Signature>` +
      '</asic:XAdESSignatures>'

    zip.file(`META-INF/${firma.nomeFile}`, xmlFirma)
  }

  return zip.generateAsync({ type: 'nodebuffer' })
}
```

- [ ] **Step 2: Scrivere i test che falliscono**

`tools/rentri-fake/test/xfir.test.ts`:

```ts
import { creaContainerXfir } from './aiuti/xfir'
import { validaAsicE } from '../src/xfir/validatore-asice'

describe('Validazione xFIR', () => {
  it('accetta un container in cui ogni firma copre tutti gli XML presenti', async () => {
    const contenuto = await creaContainerXfir({
      xml: ['fir.xml', 'allegato.xml'],
      firme: [
        { nomeFile: 'signatures001.xml', copre: ['fir.xml', 'allegato.xml'] },
        { nomeFile: 'signatures002.xml', copre: ['fir.xml', 'allegato.xml'] },
      ],
    })

    const esito = await validaAsicE(contenuto)

    expect(esito.valido).toBe(true)
  })

  it('RIFIUTA un container in cui una firma non copre tutti gli XML', async () => {
    const contenuto = await creaContainerXfir({
      xml: ['fir.xml', 'allegato.xml'],
      firme: [
        { nomeFile: 'signatures001.xml', copre: ['fir.xml', 'allegato.xml'] },
        { nomeFile: 'signatures002.xml', copre: ['fir.xml'] },
      ],
    })

    const esito = await validaAsicE(contenuto)

    expect(esito.valido).toBe(false)
    if (!esito.valido) {
      expect(esito.motivo).toContain('allegato.xml')
    }
  })

  it('rifiuta un container privo di mimetype ASiC-E', async () => {
    const contenuto = await creaContainerXfir({
      xml: ['fir.xml'],
      firme: [{ nomeFile: 'signatures001.xml', copre: ['fir.xml'] }],
      conMimetype: false,
    })

    const esito = await validaAsicE(contenuto)

    expect(esito.valido).toBe(false)
  })

  it('rifiuta un container senza alcuna firma', async () => {
    const contenuto = await creaContainerXfir({ xml: ['fir.xml'], firme: [] })

    const esito = await validaAsicE(contenuto)

    expect(esito.valido).toBe(false)
  })

  it('rifiuta un contenuto che non è nemmeno uno ZIP', async () => {
    const esito = await validaAsicE(Buffer.from('questo non e uno zip'))

    expect(esito.valido).toBe(false)
  })
})
```

- [ ] **Step 3: Eseguire i test e verificare che falliscano**

Esegui: `cd tools/rentri-fake && npm test -- xfir`
Atteso: FALLISCE con `Cannot find module '../src/xfir/validatore-asice'`.

- [ ] **Step 4: Implementare la verifica di copertura**

`tools/rentri-fake/src/xfir/validatore-xades.ts`:

```ts
import { DOMParser } from '@xmldom/xmldom'
import xpath from 'xpath'

export interface FirmaXades {
  nomeFile: string
  riferimenti: string[]
}

const NS = { ds: 'http://www.w3.org/2000/09/xmldsig#' }

/**
 * Estrae gli URI dei Reference di una firma XAdES detached.
 */
export function estraiRiferimenti(nomeFile: string, xml: string): FirmaXades {
  const documento = new DOMParser().parseFromString(xml, 'text/xml')
  const seleziona = xpath.useNamespaces(NS)
  const nodi = seleziona('//ds:Reference/@URI', documento) as Attr[]

  return { nomeFile, riferimenti: nodi.map((nodo) => nodo.value) }
}

/**
 * Regola di copertura RENTRI: ogni firma deve referenziare TUTTI gli XML gia'
 * presenti nel container. Una firma che ne salta uno rende l'xFIR invalido.
 */
export function verificaCopertura(
  firme: FirmaXades[],
  xmlPresenti: string[]
): { valido: true } | { valido: false; motivo: string } {
  for (const firma of firme) {
    const mancanti = xmlPresenti.filter((xml) => !firma.riferimenti.includes(xml))

    if (mancanti.length > 0) {
      return {
        valido: false,
        motivo: `la firma ${firma.nomeFile} non copre: ${mancanti.join(', ')}`,
      }
    }
  }

  return { valido: true }
}
```

- [ ] **Step 5: Implementare il validatore del container**

`tools/rentri-fake/src/xfir/validatore-asice.ts`:

```ts
import JSZip from 'jszip'
import { estraiRiferimenti, verificaCopertura } from './validatore-xades'

export type EsitoValidazione =
  | { valido: true; xmlPresenti: string[]; firme: string[] }
  | { valido: false; motivo: string }

const MIMETYPE_ATTESO = 'application/vnd.etsi.asic-e+zip'

/**
 * Valida un container xFIR: deve essere uno ZIP ASiC-E, contenere almeno una
 * firma XAdES in META-INF/, e rispettare la regola di copertura.
 */
export async function validaAsicE(contenuto: Buffer): Promise<EsitoValidazione> {
  let zip: JSZip
  try {
    zip = await JSZip.loadAsync(contenuto)
  } catch {
    return { valido: false, motivo: "il contenuto non e' un archivio ZIP valido" }
  }

  const fileMimetype = zip.file('mimetype')
  if (!fileMimetype) {
    return { valido: false, motivo: "file mimetype assente: non e' un container ASiC-E" }
  }

  const mimetype = (await fileMimetype.async('string')).trim()
  if (mimetype !== MIMETYPE_ATTESO) {
    return { valido: false, motivo: `mimetype inatteso: ${mimetype}` }
  }

  const nomi = Object.keys(zip.files)
  const xmlPresenti = nomi.filter((n) => n.endsWith('.xml') && !n.startsWith('META-INF/'))
  const nomiFirme = nomi.filter((n) => n.startsWith('META-INF/') && n.endsWith('.xml'))

  if (nomiFirme.length === 0) {
    return { valido: false, motivo: 'nessuna firma XAdES presente in META-INF/' }
  }

  const firme = []
  for (const nome of nomiFirme) {
    const xml = await zip.files[nome].async('string')
    firme.push(estraiRiferimenti(nome, xml))
  }

  const copertura = verificaCopertura(firme, xmlPresenti)
  if (!copertura.valido) {
    return { valido: false, motivo: copertura.motivo }
  }

  return { valido: true, xmlPresenti, firme: nomiFirme }
}
```

- [ ] **Step 6: Eseguire i test e verificare che passino**

Esegui: `cd tools/rentri-fake && npm test -- xfir`
Atteso: PASSA, 5 test — **4 sono casi di rifiuto**.

- [ ] **Step 7: Commit**

```bash
git add tools/rentri-fake/
git commit -m "feat(rentri-fake): validazione xFIR ASiC-E con regola di copertura

Ogni firma XAdES deve referenziare tutti gli XML gia' presenti nel container.
E' la regola che nessun altro strumento a disposizione puo' verificare."
```

---

### Task 8: Canale di controllo per l'iniezione di guasti

Il comportamento del client davanti agli errori dell'ente va provato, non sperato.

**Files:**
- Create: `tools/rentri-fake/src/routes/controllo.ts`
- Create: `tools/rentri-fake/test/controllo.test.ts`
- Modify: `tools/rentri-fake/src/stato/archivio.ts`
- Modify: `tools/rentri-fake/src/app.ts`

**Interfaces:**
- Produce: su `Archivio` i metodi `impostaGuasto(g: Guasto | null): void` e `guastoAttivo(): Guasto | null`, con
  `Guasto = { stato: number; volte: number }`.
- Produce: `registraRotteControllo(app: FastifyInstance, archivio: Archivio): void` che espone
  `POST /__controllo/guasto`, `POST /__controllo/completa-transazione`, `POST /__controllo/azzera`.

Il prefisso `__controllo` non esiste in RENTRI: è deliberatamente riconoscibile come apparato di prova e **non richiede autenticazione**, perché serve ai test.

- [ ] **Step 1: Scrivere i test che falliscono**

`tools/rentri-fake/test/controllo.test.ts`:

```ts
import { importPKCS8, SignJWT } from 'jose'
import { creaApp } from '../src/app'
import { creaCertificatoDiTest } from './aiuti/certificati'

async function tokenValido(): Promise<string> {
  const { chiavePrivataPem, certificatoBase64Der } = creaCertificatoDiTest()
  const chiave = await importPKCS8(chiavePrivataPem, 'RS256')

  return new SignJWT({})
    .setProtectedHeader({ alg: 'RS256', x5c: [certificatoBase64Der] } as never)
    .setIssuer('operatore-test')
    .setSubject('operatore-test')
    .setAudience('rentrigov.demo.api')
    .setIssuedAt()
    .setExpirationTime('300s')
    .sign(chiave)
}

describe('Canale di controllo', () => {
  it('forza un 503 per il numero di volte richiesto, poi torna normale', async () => {
    const app = creaApp()
    const intestazioni = { authorization: `Bearer ${await tokenValido()}` }

    await app.inject({
      method: 'POST',
      url: '/__controllo/guasto',
      payload: { stato: 503, volte: 1 },
    })

    const primaChiamata = await app.inject({
      method: 'GET',
      url: '/formulari/v1.0/',
      headers: intestazioni,
    })
    expect(primaChiamata.statusCode).toBe(503)

    const secondaChiamata = await app.inject({
      method: 'GET',
      url: '/formulari/v1.0/',
      headers: intestazioni,
    })
    expect(secondaChiamata.statusCode).toBe(200)

    await app.close()
  })

  it('completa una transazione su richiesta e ne rende disponibile il risultato', async () => {
    const app = creaApp()
    const intestazioni = { authorization: `Bearer ${await tokenValido()}` }

    const creazione = await app.inject({
      method: 'POST',
      url: '/formulari/v1.0/FIR-0009/trasmissione',
      headers: intestazioni,
      payload: {},
    })
    const id = creazione.json().transazione_id

    await app.inject({
      method: 'POST',
      url: '/__controllo/completa-transazione',
      payload: { transazione_id: id, risultato: { esito: 'accettato' } },
    })

    const risultato = await app.inject({
      method: 'GET',
      url: `/formulari/v1.0/${id}/result`,
      headers: intestazioni,
    })

    expect(risultato.statusCode).toBe(200)
    expect(risultato.json().risultato).toEqual({ esito: 'accettato' })

    await app.close()
  })
})
```

- [ ] **Step 2: Eseguire i test e verificare che falliscano**

Esegui: `cd tools/rentri-fake && npm test -- controllo`
Atteso: FALLISCE — le rotte `/__controllo/*` non esistono.

- [ ] **Step 3: Estendere l'archivio**

Aggiungi in `tools/rentri-fake/src/stato/archivio.ts`:

```ts
export interface Guasto {
  stato: number
  volte: number
}
```

e dentro la classe:

```ts
  private guasto: Guasto | null = null

  impostaGuasto(guasto: Guasto | null): void {
    this.guasto = guasto
  }

  /**
   * Restituisce il guasto se ancora attivo e ne consuma un'occorrenza.
   */
  guastoAttivo(): Guasto | null {
    if (!this.guasto || this.guasto.volte <= 0) {
      return null
    }

    this.guasto.volte -= 1
    return this.guasto
  }
```

Aggiungi `this.guasto = null` dentro `azzera()`.

- [ ] **Step 4: Implementare il canale di controllo e l'aggancio globale**

`tools/rentri-fake/src/routes/controllo.ts`:

```ts
import { FastifyInstance } from 'fastify'
import { Archivio } from '../stato/archivio'

/**
 * Apparato di prova: prefisso __controllo, inesistente in RENTRI e
 * deliberatamente riconoscibile. Non richiede autenticazione perche' serve
 * ai test per pilotare guasti e completamenti asincroni.
 */
export function registraRotteControllo(app: FastifyInstance, archivio: Archivio): void {
  app.post<{ Body: { stato: number; volte: number } }>(
    '/__controllo/guasto',
    async (richiesta) => {
      archivio.impostaGuasto({ stato: richiesta.body.stato, volte: richiesta.body.volte })
      return { impostato: true }
    }
  )

  app.post<{ Body: { transazione_id: string; risultato: unknown } }>(
    '/__controllo/completa-transazione',
    async (richiesta, risposta) => {
      const transazione = archivio.leggiTransazione(richiesta.body.transazione_id)
      if (!transazione) {
        return risposta.status(404).send({ titolo: 'Transazione non trovata' })
      }

      archivio.completaTransazione(richiesta.body.transazione_id, richiesta.body.risultato)
      return { completata: true }
    }
  )

  app.post('/__controllo/azzera', async () => {
    archivio.azzera()
    return { azzerato: true }
  })
}
```

In `tools/rentri-fake/src/app.ts`, **prima** della registrazione delle altre rotte, aggiungi l'hook che applica il guasto:

```ts
import { registraRotteControllo } from './routes/controllo'
```

```ts
  app.addHook('onRequest', async (richiesta, risposta) => {
    if (richiesta.url.startsWith('/__controllo')) {
      return
    }

    const guasto = archivio.guastoAttivo()
    if (guasto) {
      await risposta.status(guasto.stato).send({
        titolo: 'Guasto simulato',
        dettaglio: `Guasto iniettato dal canale di controllo (stato ${guasto.stato}).`,
      })
    }
  })

  registraRotteControllo(app, archivio)
```

**Attenzione all'ordine:** l'`Archivio` va istanziato prima dell'hook. La sequenza corretta in `creaApp()` è: crea `archivio` → registra hook → `registraRotteControllo` → `registraRotteToken` → `registraRotteFormulari` → `registraRotteTransazioni`.

- [ ] **Step 5: Eseguire tutti i test**

Esegui: `cd tools/rentri-fake && npm test`
Atteso: PASSA, tutte le suite.

- [ ] **Step 6: Commit**

```bash
git add tools/rentri-fake/
git commit -m "feat(rentri-fake): canale di controllo per guasti e completamenti

Permette ai test di forzare 429/503/timeout e di decidere quando una
transazione asincrona si completa."
```

---

### Task 9: Containerizzare e sostituire il segnaposto in docker-compose

**Files:**
- Create: `tools/rentri-fake/Dockerfile`
- Create: `tools/rentri-fake/.dockerignore`
- Modify: `docker-compose.yml` (servizio `rentri-mock`)

**Interfaces:**
- Produce: servizio compose `rentri-fake` in ascolto sulla porta 4010 del container.

- [ ] **Step 1: Scrivere il Dockerfile lean**

`tools/rentri-fake/Dockerfile`:

```dockerfile
# Immagine lean: multistage, node:20-alpine, nessuna devDependency nel runtime.
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=builder /app/dist ./dist
EXPOSE 4010
CMD ["node", "dist/server.js"]
```

`tools/rentri-fake/.dockerignore`:

```
node_modules
dist
test
*.md
```

- [ ] **Step 2: Costruire l'immagine e misurarne la dimensione**

Esegui:

```bash
docker build -t rentri-fake:dev tools/rentri-fake
docker images rentri-fake:dev --format "{{.Size}}"
```

Atteso: build completata; dimensione **inferiore a 200 MB**. Se la supera, individua il livello responsabile con `docker history rentri-fake:dev --human --no-trunc | head -20` e correggi prima di proseguire.

- [ ] **Step 3: Verificare il container in esecuzione**

Esegui:

```bash
docker run -d --name rentri-fake-prova -p 4010:4010 rentri-fake:dev
sleep 2
curl -s http://localhost:4010/__salute
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:4010/token
docker rm -f rentri-fake-prova
```

Atteso: `{"servizio":"rentri-fake","stato":"ok"}` e **404** su `/token`.

- [ ] **Step 4: Sostituire il segnaposto in docker-compose**

In `docker-compose.yml`, sostituisci il servizio `rentri-mock` con:

```yaml
  rentri-fake:
    build:
      context: ./tools/rentri-fake
    container_name: wasteflow-rentri-fake
    environment:
      RENTRI_AUDIENCE: rentrigov.demo.api
    ports:
      - "4010:4010"
    networks:
      - wasteflow-network
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://127.0.0.1:4010/__salute"]
      interval: 10s
      timeout: 3s
      retries: 5
```

Cerca inoltre ogni riferimento residuo al vecchio nome e aggiornalo:

```bash
grep -rn "rentri-mock" --include="*.yml" --include="*.yaml" --include="*.ts" --include="*.env*" . | grep -v node_modules
```

- [ ] **Step 5: Verificare lo stack**

Esegui:

```bash
docker compose up -d rentri-fake
docker compose ps rentri-fake
curl -s http://localhost:4010/__salute
docker compose down
```

Atteso: servizio `healthy` e risposta di salute corretta.

- [ ] **Step 6: Commit**

```bash
git add tools/rentri-fake/Dockerfile tools/rentri-fake/.dockerignore docker-compose.yml
git commit -m "feat(rentri-fake): containerizzazione e sostituzione del segnaposto

Immagine lean multistage su node:20-alpine. Il servizio rentri-mock, che era
un segnaposto, e' sostituito da rentri-fake."
```

---

### Task 10: Auditor di fedeltà

**Deve essere eseguito da un agente diverso da chi ha implementato i Task 2-9.** Chi costruisce la fake non la valida: è la contromisura al rischio che una fake permissiva validi errori con sicurezza.

**Files:**
- Create: `docs/contracts/rentri/FEDELTA.md`

**Interfaces:**
- Consuma: `docs/contracts/rentri/*.yaml` (Task 1) e l'implementazione in `tools/rentri-fake/src/` (Task 2-9).

- [ ] **Step 1: Estrarre l'elenco completo dei path ufficiali**

Esegui:

```bash
grep -nE "^  /" docs/contracts/rentri/formulari.yaml
```

Atteso: 29 path. Costruisci da qui la colonna di sinistra della tabella di fedeltà.

- [ ] **Step 2: Estrarre gli endpoint effettivamente implementati**

Esegui:

```bash
grep -rnE "app\.(get|post|put|patch|delete)" tools/rentri-fake/src/routes/
```

- [ ] **Step 3: Scrivere la tabella di fedeltà**

Crea `docs/contracts/rentri/FEDELTA.md` con questa struttura, una riga per **ciascuno** dei 29 path ufficiali:

```markdown
# Fedeltà della fake API rispetto ai contratti ufficiali

**Auditor:** <nome agente> · **Data:** <data> · **Contratti:** `formulari.yaml` v<versione dal MANIFEST>

Questo documento è redatto da un agente diverso da chi ha implementato la fake.
Il criterio non è «la fake funziona», ma **«dove la fake è più permissiva del vero»**.

| Path ufficiale | Metodi | Implementato | Schema conforme | Codici d'errore allineati | Divergenza |
|---|---|---|---|---|---|
| `/` | GET | sì | ... | ... | ... |
```

Compila ogni riga con: `sì` / `no` / `parziale`, e in caso di divergenza una frase che dica **in che direzione** diverge (più permissiva o più restrittiva del contratto).

- [ ] **Step 4: Scrivere il verdetto**

Aggiungi in coda al documento:

```markdown
## Verdetto

**Copertura:** N path su 29 implementati.

**Divergenze in direzione permissiva** (la fake accetta ciò che RENTRI rifiuterebbe) — sono le uniche che invalidano il valore probatorio della fake:

1. ...

**Divergenze in direzione restrittiva** (la fake rifiuta ciò che RENTRI accetterebbe) — producono falsi allarmi, meno gravi ma da correggere:

1. ...

**Idoneità come oracolo:** <IDONEA / IDONEA CON RISERVE / NON IDONEA> per le pipeline P2 e P3.
```

Se il verdetto è NON IDONEA, elenca le correzioni necessarie: sono lavoro aggiuntivo su Task 2-9 **prima** che le pipeline di dominio possano partire.

- [ ] **Step 5: Commit**

```bash
git add docs/contracts/rentri/FEDELTA.md
git commit -m "docs(contratti): verdetto di fedelta' della fake API RENTRI

Redatto da un agente diverso dall'implementatore. Il criterio e' dove la fake
sia piu' permissiva del contratto ufficiale."
```

---

### Task 11: Banco di prova end-to-end

**Files:**
- Create: `e2e/tests/rentri/fake-disponibile.spec.ts`
- Modify: `e2e/utils/env.ts`
- Modify: `e2e/README.md`

**Interfaces:**
- Consuma: il servizio compose `rentri-fake` (Task 9), la suite Playwright esistente in `e2e/`.
- Produce: `getRentriFakeUrl(): string` in `e2e/utils/env.ts`, che legge `E2E_RENTRI_FAKE_URL` con default `http://localhost:4010`.

- [ ] **Step 1: Aggiungere la risoluzione dell'URL**

In `e2e/utils/env.ts` aggiungi:

```ts
/**
 * URL della fake API RENTRI. Default locale: la fake non deve mai essere
 * cercata su un host di produzione.
 */
export function getRentriFakeUrl(): string {
  return process.env.E2E_RENTRI_FAKE_URL ?? 'http://localhost:4010'
}
```

- [ ] **Step 2: Scrivere il test che fallisce**

`e2e/tests/rentri/fake-disponibile.spec.ts`:

```ts
import { test, expect } from '@playwright/test'
import { getRentriFakeUrl } from '../../utils/env'

/**
 * Verifica che l'oracolo di conformita' sia in piedi e si comporti come
 * RENTRI sui due punti che invalidano l'integrazione attuale: assenza di
 * /token e rifiuto delle chiamate non autenticate.
 */
test.describe('Fake API RENTRI', () => {
  test('risponde alla salute', async ({ request }) => {
    const risposta = await request.get(`${getRentriFakeUrl()}/__salute`, {
      failOnStatusCode: false,
    })

    expect(risposta.status()).toBe(200)
    expect(await risposta.json()).toEqual({ servizio: 'rentri-fake', stato: 'ok' })
  })

  test('non espone /token, come RENTRI', async ({ request }) => {
    const risposta = await request.post(`${getRentriFakeUrl()}/token`, {
      data: { grant_type: 'client_credentials' },
      failOnStatusCode: false,
    })

    expect(risposta.status()).toBe(404)
  })

  test('rifiuta con 401 una chiamata senza JWT', async ({ request }) => {
    const risposta = await request.get(`${getRentriFakeUrl()}/formulari/v1.0/`, {
      failOnStatusCode: false,
    })

    expect(risposta.status()).toBe(401)
  })
})
```

- [ ] **Step 3: Eseguire il test con la fake spenta e verificare che fallisca**

Esegui: `npx playwright test e2e/tests/rentri --config=e2e/playwright.config.ts`
Atteso: FALLISCE con errore di connessione — conferma che il test dipende davvero dal servizio.

- [ ] **Step 4: Avviare la fake ed eseguire di nuovo**

Esegui:

```bash
docker compose up -d rentri-fake
npx playwright test e2e/tests/rentri --config=e2e/playwright.config.ts
```

Atteso: PASSA, 3 test.

- [ ] **Step 5: Documentare nel README della suite**

In `e2e/README.md`, aggiungi una sezione:

```markdown
## Fake API RENTRI

I test in `tests/rentri/` richiedono il servizio `rentri-fake`:

```bash
docker compose up -d rentri-fake
```

URL configurabile con `E2E_RENTRI_FAKE_URL` (default `http://localhost:4010`).
La fake è l'oracolo di conformità: rifiuta ciò che RENTRI rifiuterebbe. Il suo
verdetto di fedeltà è in `docs/contracts/rentri/FEDELTA.md`.
```

- [ ] **Step 6: Commit**

```bash
git add e2e/
git commit -m "test(e2e): banco di prova contro la fake API RENTRI

Tre test che verificano l'oracolo sui punti che invalidano l'integrazione
attuale: assenza di /token e rifiuto delle chiamate non autenticate."
```

---

## Criteri di completamento della Fase 0

- [ ] I contratti ufficiali sono in `docs/contracts/rentri/` con provenienza e digest tracciati.
- [ ] La questione INTEGRITY_REST_01 è stata **accertata** e documentata, non assunta.
- [ ] `npm test` in `tools/rentri-fake` è verde, e **ogni regola ha un caso di rifiuto**.
- [ ] L'immagine è sotto i 200 MB e il container risponde in compose.
- [ ] `FEDELTA.md` esiste, è redatto da un agente diverso dall'implementatore, e il verdetto è IDONEA o IDONEA CON RISERVE. **Se è NON IDONEA, la Fase 0 non è conclusa.**
- [ ] I test e2e in `e2e/tests/rentri/` passano contro il servizio in esecuzione.

## Piani successivi

Questo piano copre solo la Fase 0. I successivi, da scrivere quando questo è concluso:

| Piano | Contenuto | Dipende da |
|---|---|---|
| `P1-sicurezza-rilascio` | Promozione `develop`→`master`, Swagger, sessione singola, hardening auth | — (può partire in parallelo alla Fase 0) |
| `P2-rentri` | Riscrittura dell'integrazione contro i contratti, validata dalla fake | Fase 0 |
| `P3-firma` | Flusso crittografico persistito, documento canonico, QES/TSA dietro interfaccia | P2 |
| `P4-rbac-granulare` | ADR «riparare o rimuovere» e sua esecuzione | P1 |
| `P5-qualita` | Coverage, allineamento gate CI, UAT autenticata | tutte |
