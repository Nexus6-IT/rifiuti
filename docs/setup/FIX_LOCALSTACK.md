# 🔧 LocalStack Issue - Risolto

## Problema

LocalStack crashava all'avvio con:
```
OSError: [Errno 16] Device or resource busy: '/tmp/localstack'
```

## Causa

Conflitto tra volume Docker montato e tentativo di LocalStack di pulire la directory `/tmp/localstack`.

## Soluzione

**LocalStack è stato temporaneamente disabilitato** nel `docker-compose.yml`.

### Perché è OK?

LocalStack serve solo per:
- ✅ Simulare AWS S3 in locale
- ✅ Test upload file
- ✅ Non essenziale per iniziare

**Puoi sviluppare senza LocalStack!** Il file storage può essere:
- Locale (`./uploads` directory)
- S3 reale (solo in produzione)

---

## Come Riabilitare LocalStack (Quando Serve)

### Opzione 1: Usa Versione Fix

Modifica `docker-compose.yml`:

```yaml
localstack:
  image: localstack/localstack:latest
  container_name: wasteflow-localstack
  environment:
    SERVICES: s3
    PERSISTENCE: 0  # Disabilita persistenza
    AWS_DEFAULT_REGION: eu-south-1
  ports:
    - "4566:4566"
  tmpfs:
    - /tmp/localstack  # Usa tmpfs invece di volume
  networks:
    - wasteflow-network
```

### Opzione 2: Senza Persistenza

```yaml
localstack:
  image: localstack/localstack:latest
  container_name: wasteflow-localstack
  environment:
    SERVICES: s3
    AWS_DEFAULT_REGION: eu-south-1
  ports:
    - "4566:4566"
  # Nessun volume - dati volatili
  networks:
    - wasteflow-network
```

---

## Alternative a LocalStack

### Storage Locale (Raccomandato per Dev)

Nel backend `.env`:
```env
STORAGE_TYPE=local
STORAGE_PATH=./uploads
```

### MinIO (Alternativa S3-Compatible)

Più stabile di LocalStack:

```yaml
minio:
  image: minio/minio:latest
  container_name: wasteflow-minio
  command: server /data --console-address ":9001"
  environment:
    MINIO_ROOT_USER: minioadmin
    MINIO_ROOT_PASSWORD: minioadmin
  ports:
    - "9000:9000"
    - "9001:9001"
  volumes:
    - minio_data:/data
  networks:
    - wasteflow-network
```

Web UI: http://localhost:9001

---

## Servizi Essenziali (Tutti Funzionanti)

✅ **PostgreSQL** - Database principale
✅ **Redis** - Cache
✅ **Keycloak** - Autenticazione SPID
✅ **MailHog** - Test email
✅ **pgAdmin** - Database UI
❌ **LocalStack** - Disabilitato (non essenziale)
❌ **RENTRI Mock** - Opzionale (per test API RENTRI)

---

## Verifica Servizi Attivi

```cmd
docker-compose ps
```

Dovresti vedere tutti UP tranne LocalStack:

```
NAME                      STATUS
wasteflow-postgres        Up (healthy)
wasteflow-redis           Up (healthy)
wasteflow-keycloak        Up (healthy)
wasteflow-mailhog         Up (healthy)
wasteflow-pgadmin         Up
```

---

## Next Steps

Continua con il setup senza problemi:

```cmd
cd apps\backend
npm install
npx prisma generate
npx prisma migrate dev
```

---

**LocalStack non serve per iniziare! Tutti i servizi essenziali funzionano correttamente.** ✅
