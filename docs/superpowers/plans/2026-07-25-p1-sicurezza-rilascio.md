# P1 — Sicurezza e rilascio: piano di implementazione

> **Per agenti esecutori:** SUB-SKILL RICHIESTA: usare `superpowers:subagent-driven-development`. I passi usano checkbox (`- [ ]`).

**Obiettivo:** chiudere i difetti di autenticazione ancora aperti e portare in produzione i 17 difetti già corretti su `develop` ma tuttora attivi in esercizio, fra cui i tre critici.

**Architettura:** interventi mirati su `apps/backend/src/auth/` (strategia JWT, servizio Redis, controller di autenticazione) e sulla configurazione Swagger; nessun cambio di schema del database. Il rilascio avviene per promozione di `develop` su `master`, che innesca la pipeline Gitea Actions esistente.

**Stack:** NestJS 10, Passport JWT, Redis (ioredis), Jest.

## Vincoli globali

- **Italiano** in messaggi utente, commenti e documentazione. Identificatori di codice in inglese.
- **Prettier + ESLint** sui file toccati prima di ogni commit: il gate CI del backend fallisce sulla formattazione.
- **Nessuna migrazione Prisma**: se una modifica sembra richiederla, fermarsi e segnalarlo.
- **Non rompere l'impersonificazione né il cambio tenant**: entrambi ri-emettono un JWT e devono continuare a funzionare.
- Commit in italiano, **senza attribuzione ad AI**.
- **Segreti**: mai in commit, log o messaggi.

## Decisioni già prese dal committente (2026-07-25)

- **Sessione singola: da implementare.** Un nuovo accesso invalida il precedente. Nessuna variante con avviso all'utente.
- **Rilascio in produzione: autorizzato**, incluso il merge su `master` e il deploy automatico conseguente, con verifica post-rilascio e rollback in caso di anomalia.

## Stato di partenza accertato

- `apps/backend/src/auth/services/redis.service.ts` espone già `revokeAllRefreshTokens(userId)`, `revokeAccessToken(token, ttl)` e `isAccessTokenRevoked(token)`.
- **`isAccessTokenRevoked` non è invocato da nessun punto del codice** (verificato con `grep -rn "isAccessTokenRevoked" apps/backend/src`): la lista di revoca viene scritta al logout ma mai consultata, quindi **il logout non invalida l'access token**, che resta valido fino a scadenza naturale (15 minuti).
- `storeRefreshToken` usa la chiave `refresh_token:${userId}:${token}`, una per token: le sessioni concorrenti sono illimitate e nessun login invalida il precedente.
- `apps/backend/src/auth/strategies/jwt.strategy.ts` valida il payload e ricarica l'utente dal database; **non** riceve la richiesta, quindi oggi non può leggere il token grezzo.
- La produzione gira `master`, che non contiene `09d8fd5` (hardening RBAC) né il lavoro successivo. Migrazioni Prisma identiche fra i due rami: la promozione non tocca lo schema.

---

### Task 1: Far valere la lista di revoca degli access token

Senza questo, il logout è una finzione e la sessione singola del Task 2 sarebbe aggirabile con il token già in mano.

**Files:**
- Modify: `apps/backend/src/auth/strategies/jwt.strategy.ts`
- Modify: `apps/backend/src/auth/auth.module.ts` (se serve iniettare `RedisService` nella strategia)
- Test: `apps/backend/src/auth/strategies/jwt.strategy.spec.ts` (creare se assente)

**Interfaces:**
- Consuma: `RedisService.isAccessTokenRevoked(token: string): Promise<boolean>`.
- Produce: `JwtStrategy.validate(req, payload)` — firma a due argomenti dovuta a `passReqToCallback: true`.

- [ ] **Step 1: Scrivere il test che fallisce**

In `apps/backend/src/auth/strategies/jwt.strategy.spec.ts`:

```ts
import { UnauthorizedException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { JwtStrategy } from './jwt.strategy'

describe('JwtStrategy — lista di revoca', () => {
  const utente = {
    id: 'utente-1',
    email: 'mario@example.it',
    fiscalCode: 'MNZGZN78A01F839X',
    tenantId: 'tenant-1',
    role: 'ADMIN',
  }

  const prisma = { user: { findUnique: jest.fn() } } as never
  const config = { get: jest.fn().mockReturnValue('segreto-di-prova') } as unknown as ConfigService

  function richiestaCon(token: string) {
    return { headers: { authorization: `Bearer ${token}` } } as never
  }

  beforeEach(() => {
    ;(prisma as unknown as { user: { findUnique: jest.Mock } }).user.findUnique.mockResolvedValue(
      utente
    )
  })

  it('rifiuta un access token presente nella lista di revoca', async () => {
    const redis = { isAccessTokenRevoked: jest.fn().mockResolvedValue(true) }
    const strategia = new JwtStrategy(config, prisma, redis as never)

    await expect(
      strategia.validate(richiestaCon('token-revocato'), { sub: utente.id } as never)
    ).rejects.toThrow(UnauthorizedException)
  })

  it('accetta un access token non revocato', async () => {
    const redis = { isAccessTokenRevoked: jest.fn().mockResolvedValue(false) }
    const strategia = new JwtStrategy(config, prisma, redis as never)

    const risultato = await strategia.validate(richiestaCon('token-buono'), {
      sub: utente.id,
    } as never)

    expect(risultato.id).toBe(utente.id)
    expect(redis.isAccessTokenRevoked).toHaveBeenCalledWith('token-buono')
  })
})
```

- [ ] **Step 2: Eseguire il test e verificare che fallisca**

Esegui: `cd apps/backend && npx jest src/auth/strategies/jwt.strategy.spec.ts`
Atteso: FALLISCE — il costruttore accetta due argomenti e `validate` uno solo.

- [ ] **Step 3: Implementare**

In `jwt.strategy.ts`, aggiungi `passReqToCallback: true` alle opzioni del costruttore, inietta `RedisService`, e cambia `validate` perché riceva la richiesta come primo argomento. Inserisci il controllo **prima** della lettura dal database, così un token revocato non costa una query:

```ts
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('JWT_SECRET'),
      passReqToCallback: true,
    })
```

```ts
  /**
   * La lista di revoca va consultata QUI: e' l'unico punto attraversato da
   * ogni richiesta autenticata. Senza questo controllo il logout scrive la
   * revoca ma nessuno la legge, e il token resta valido fino a scadenza.
   */
  async validate(req: Request, payload: JwtPayload): Promise<CurrentUserPayload> {
    const token = ExtractJwt.fromAuthHeaderAsBearerToken()(req as never)

    if (token && (await this.redisService.isAccessTokenRevoked(token))) {
      throw new UnauthorizedException('Token revocato')
    }

    // ... resto invariato
```

Importa `Request` da `express`. Se `RedisService` non è già disponibile nel modulo che registra la strategia, aggiungilo ai provider.

- [ ] **Step 4: Eseguire i test e verificare che passino**

Esegui: `cd apps/backend && npx jest src/auth/strategies/jwt.strategy.spec.ts`
Atteso: PASSA, 2 test.

- [ ] **Step 5: Verificare che nulla sia regredito**

Esegui: `cd apps/backend && npx jest --runInBand`
Atteso: tutte le suite verdi. Se qualche test costruiva `JwtStrategy` con due argomenti, aggiornalo.

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/auth/
git commit -m "fix(auth): la lista di revoca degli access token viene finalmente consultata

Il logout scriveva la revoca in Redis ma nessuno la leggeva: il token restava
valido fino a scadenza naturale. Il controllo entra nella strategia JWT, unico
punto attraversato da ogni richiesta autenticata."
```

---

### Task 2: Sessione singola per utente

**Files:**
- Modify: `apps/backend/src/auth/services/redis.service.ts`
- Modify: `apps/backend/src/auth/controllers/auth.controller.ts`
- Modify: `apps/backend/src/auth/strategies/jwt.strategy.ts`
- Test: `apps/backend/src/auth/services/redis.service.spec.ts` (creare se assente)

**Interfaces:**
- Produce su `RedisService`: `impostaEpocaSessione(userId: string): Promise<number>` (restituisce l'epoca in secondi) e `leggiEpocaSessione(userId: string): Promise<number | null>`.
- Consuma: `revokeAllRefreshTokens(userId)` già esistente.

**Progettazione.** Due meccanismi complementari, perché i token sono di due tipi:
- **Refresh token**: al login si revocano tutti quelli precedenti dell'utente, così la vecchia sessione non può rinnovarsi.
- **Access token** già emessi (vivi fino a 15 minuti): si registra un'**epoca di sessione** per utente; la strategia JWT rifiuta i token la cui claim `iat` è anteriore all'epoca. Senza questo, la sessione precedente resterebbe operativa per un quarto d'ora.

- [ ] **Step 1: Scrivere i test che falliscono**

In `apps/backend/src/auth/services/redis.service.spec.ts`:

```ts
import { RedisService } from './redis.service'

describe('RedisService — epoca di sessione', () => {
  function servizioConFinta() {
    const archivio = new Map<string, string>()
    const servizio = Object.create(RedisService.prototype) as RedisService
    ;(servizio as unknown as { client: unknown }).client = {
      set: async (chiave: string, valore: string) => {
        archivio.set(chiave, valore)
        return 'OK'
      },
      get: async (chiave: string) => archivio.get(chiave) ?? null,
    }
    return servizio
  }

  it('registra e rilegge l\'epoca di sessione di un utente', async () => {
    const servizio = servizioConFinta()

    const epoca = await servizio.impostaEpocaSessione('utente-1')
    const riletta = await servizio.leggiEpocaSessione('utente-1')

    expect(typeof epoca).toBe('number')
    expect(riletta).toBe(epoca)
  })

  it('restituisce null per un utente senza epoca registrata', async () => {
    const servizio = servizioConFinta()

    expect(await servizio.leggiEpocaSessione('mai-visto')).toBeNull()
  })
})
```

- [ ] **Step 2: Eseguire e verificare il fallimento**

Esegui: `cd apps/backend && npx jest src/auth/services/redis.service.spec.ts`
Atteso: FALLISCE — i due metodi non esistono.

- [ ] **Step 3: Implementare l'epoca di sessione**

In `redis.service.ts`:

```ts
  /**
   * Sessione singola: registra l'istante dell'ultimo accesso dell'utente.
   * Gli access token emessi PRIMA di questo istante vanno considerati non
   * piu' validi, altrimenti la sessione precedente sopravvivrebbe fino alla
   * scadenza naturale del token (15 minuti).
   */
  async impostaEpocaSessione(userId: string): Promise<number> {
    const epoca = Math.floor(Date.now() / 1000)
    await this.client.set(`session_epoch:${userId}`, String(epoca), 'EX', 7 * 24 * 60 * 60)
    return epoca
  }

  async leggiEpocaSessione(userId: string): Promise<number | null> {
    const valore = await this.client.get(`session_epoch:${userId}`)
    return valore === null ? null : Number(valore)
  }
```

- [ ] **Step 4: Applicare la sessione singola al login**

In `auth.controller.ts`, nel callback SPID, **prima** di `storeRefreshToken`:

```ts
    // Sessione singola (regola trasversale): un nuovo accesso invalida il
    // precedente. Si revocano i refresh token gia' emessi e si sposta in
    // avanti l'epoca di sessione, che rende non validi anche gli access
    // token ancora vivi della sessione precedente.
    await this.redisService.revokeAllRefreshTokens(spidUser.id)
    await this.redisService.impostaEpocaSessione(spidUser.id)
```

- [ ] **Step 5: Far valere l'epoca nella strategia JWT**

In `jwt.strategy.ts`, dopo il controllo della lista di revoca:

```ts
    const epoca = await this.redisService.leggiEpocaSessione(payload.sub)
    if (epoca !== null && typeof payload.iat === 'number' && payload.iat < epoca) {
      throw new UnauthorizedException('Sessione superata da un accesso piu\' recente')
    }
```

Assicurati che `JwtPayload` dichiari `iat?: number`; se non lo dichiara, aggiungilo.

- [ ] **Step 6: Scrivere il test della strategia**

Aggiungi in `jwt.strategy.spec.ts`:

```ts
  it('rifiuta un token emesso prima dell\'ultimo accesso dell\'utente', async () => {
    const redis = {
      isAccessTokenRevoked: jest.fn().mockResolvedValue(false),
      leggiEpocaSessione: jest.fn().mockResolvedValue(2000),
    }
    const strategia = new JwtStrategy(config, prisma, redis as never)

    await expect(
      strategia.validate(richiestaCon('token-vecchio'), { sub: utente.id, iat: 1000 } as never)
    ).rejects.toThrow(UnauthorizedException)
  })

  it('accetta un token emesso dopo l\'ultimo accesso', async () => {
    const redis = {
      isAccessTokenRevoked: jest.fn().mockResolvedValue(false),
      leggiEpocaSessione: jest.fn().mockResolvedValue(2000),
    }
    const strategia = new JwtStrategy(config, prisma, redis as never)

    const risultato = await strategia.validate(richiestaCon('token-nuovo'), {
      sub: utente.id,
      iat: 3000,
    } as never)

    expect(risultato.id).toBe(utente.id)
  })
```

Aggiorna anche i due test del Task 1 perché la finta di Redis esponga `leggiEpocaSessione` restituendo `null`.

- [ ] **Step 7: Eseguire tutti i test**

Esegui: `cd apps/backend && npx jest --runInBand`
Atteso: tutte le suite verdi.

**Attenzione alle regressioni:** impersonificazione e cambio tenant ri-emettono un JWT. Verifica che i loro test restino verdi: i token ri-emessi hanno `iat` successivo all'epoca, quindi devono passare. Se un test fallisce, **non** rimuovere il controllo: capisci se quel flusso deve aggiornare l'epoca.

- [ ] **Step 8: Commit**

```bash
git add apps/backend/src/auth/
git commit -m "feat(auth): sessione singola per utente

Un nuovo accesso revoca i refresh token precedenti e sposta in avanti
l'epoca di sessione, cosi' anche gli access token gia' emessi della sessione
precedente smettono di essere validi. Regola trasversale obbligatoria,
finora non implementata."
```

---

### Task 3: Swagger non pubblico in produzione

**Files:**
- Modify: `apps/backend/src/main.ts` (o il file che chiama `SwaggerModule.setup`)
- Modify: `e2e/tests/public/swagger-exposure.spec.ts`

- [ ] **Step 1: Individuare il punto di registrazione**

Esegui: `grep -rn "SwaggerModule.setup\|createDocument" apps/backend/src --include=*.ts`

- [ ] **Step 2: Condizionare la registrazione**

Avvolgi la registrazione di Swagger in una condizione sull'ambiente, con un commento che spieghi il perché:

```ts
  // La spec OpenAPI completa (82 path, inclusi admin e billing) abbassa
  // drasticamente il costo di ricognizione per un attaccante: in produzione
  // non va esposta. Riattivabile con SWAGGER_ENABLED=true per diagnosi.
  const swaggerAbilitato =
    configService.get<string>('NODE_ENV') !== 'production' ||
    configService.get<string>('SWAGGER_ENABLED') === 'true'

  if (swaggerAbilitato) {
    SwaggerModule.setup('api/docs', app, documento)
  }
```

- [ ] **Step 3: Verificare in locale**

Avvia il backend con `NODE_ENV=production` e verifica che `/api/docs` e `/api/docs-json` rispondano 404; poi senza quella variabile e verifica che rispondano 200. Incolla entrambi gli esiti.

- [ ] **Step 4: Aggiornare il test e2e**

In `e2e/tests/public/swagger-exposure.spec.ts` **rimuovi** la riga `test.fixme(...)`: il test esprime già il requisito corretto (la spec non deve rispondere 200 senza autenticazione) e deve tornare a essere un controllo attivo dopo il rilascio.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/main.ts e2e/tests/public/swagger-exposure.spec.ts
git commit -m "fix(sicurezza): Swagger non esposto in produzione

La spec OpenAPI completa era pubblica su rifiuti.ignicraft.com. Riattivabile
con SWAGGER_ENABLED=true per diagnosi."
```

---

### Task 4: Promozione a master e rilascio

**Autorizzato dal committente.** Il merge su `master` innesca la pipeline `.gitea/workflows/deploy.yml`.

- [ ] **Step 1: Verificare che develop sia sano prima di promuovere**

Esegui, e **non proseguire** se qualcosa è rosso:

```bash
cd apps/backend && npx jest --runInBand
cd ../.. && npx tsc --noEmit -p apps/backend/tsconfig.json
npm run lint
```

- [ ] **Step 2: Annotare lo stato attuale della produzione per il rollback**

```bash
curl -s https://rifiuti.ignicraft.com/api/v1/health
git log --oneline origin/master -1
```

Registra lo SHA di `master` **prima** della promozione: è il bersaglio del rollback.

- [ ] **Step 3: Promuovere**

```bash
git checkout master
git merge --no-ff develop -m "release: hardening RBAC, sessione singola, Swagger non pubblico

Porta in produzione 17 difetti gia' corretti su develop, fra cui tre critici:
backup/restore accessibile a qualunque utente autenticato, PDF MUD generato
con tenant hard-coded, firma FIR senza controllo di ruolo. Aggiunge sessione
singola per utente e consultazione effettiva della lista di revoca."
git push origin master
git checkout develop
```

- [ ] **Step 4: Seguire la pipeline**

Il deploy gira su Gitea Actions. Segui l'esito; se fallisce, leggi i log secondo la procedura del progetto (Proxmox → `qm guest exec 100` → pod Gitea, log in `/data/actions_log/`).

- [ ] **Step 5: Verificare la produzione dopo il rilascio**

```bash
curl -s https://rifiuti.ignicraft.com/api/v1/health
curl -s -o /dev/null -w "docs: %{http_code}\n" https://rifiuti.ignicraft.com/api/docs-json
curl -s -o /dev/null -w "fir: %{http_code}\n" https://rifiuti.ignicraft.com/api/v1/fir
curl -sI https://rifiuti.ignicraft.com/ | grep -iE "strict-transport|content-security|server"
```

Atteso: salute `ok`; `docs-json` **404**; `/fir` **401**; header di sicurezza presenti sul documento HTML e `Server` senza versione.

- [ ] **Step 6: Eseguire la suite e2e pubblica contro la produzione**

```bash
npm run e2e:prod
```

Atteso: tutti verdi, **inclusi** i due test prima in `fixme` (header di sicurezza e Swagger), che ora devono passare davvero.

- [ ] **Step 7: In caso di anomalia, rollback**

```bash
gh workflow run deploy.yml -f tag=sha-<sha-precedente>
```

oppure, se la pipeline non lo consente, `git revert` del merge su `master` e nuovo push. Verifica la salute dopo il rollback.

- [ ] **Step 8: Riattivare il test degli header di sicurezza**

Se lo Step 5 conferma gli header sul documento HTML, rimuovi `test.fixme(...)` da `e2e/tests/public/security-headers.spec.ts` e committa su `develop`.

---

## Criteri di completamento di P1

- [ ] Un access token revocato al logout viene effettivamente rifiutato.
- [ ] Un secondo accesso dello stesso utente invalida la sessione precedente, **inclusi** gli access token già emessi.
- [ ] `https://rifiuti.ignicraft.com/api/docs-json` risponde 404.
- [ ] La produzione gira il codice che contiene `09d8fd5`: `POST /backup/restore` e `DELETE /backup/cleanup` non sono più accessibili a un utente non SUPER_ADMIN.
- [ ] `npm run e2e:prod` è verde con i due test riattivati.
- [ ] Impersonificazione e cambio tenant funzionano ancora.
