/**
 * RENTRI Mock API Server
 *
 * Simula l'API RENTRI per lo sviluppo e i test automatici (RENTRI_MODE=mock).
 * Accetta il formato xFIR conforme alle specifiche D.M. 59/2023.
 *
 * ROTTE DISPONIBILI:
 *
 * Stile legacy (percorsi interni, compatibilità backwards):
 *   POST /api/v1/fir/validate   → validazione pre-invio
 *   POST /api/v1/fir/submit     → invio FIR
 *   GET  /api/v1/fir/:firId     → stato FIR
 *
 * Stile API reale RENTRI (servizio `vidimazione-formulari` v1.0 — DA CONFERMARE):
 *   POST /vidimazione-formulari/v1.0/formulari            → vidima/crea FIR
 *   GET  /vidimazione-formulari/v1.0/formulari/:firId     → stato FIR
 *   POST /vidimazione-formulari/v1.0/formulari/:firId/annulla-fir → annulla FIR
 *
 * Entrambi gli stili accettano il payload xFIR direttamente nel body (senza wrapper).
 */

const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json());

// In-memory storage for mock data
const firRegistry = new Map();
const registryEntries = [];

// ---------------------------------------------------------------------------
// Helper: genera una risposta mock xFIR (numero protocollo + rentriId)
// ---------------------------------------------------------------------------
function generateMockResponse(firId, xFIR) {
  const rentriId = `RENTRI-${new Date().getFullYear()}-${String(Math.floor(Math.random() * 1000000)).padStart(6, '0')}`;
  return {
    firId,
    rentriId,
    protocolNumber: rentriId,
    numeroFormulario: xFIR.numeroFormulario,
    status: 'ACCEPTED',
    receivedAt: new Date().toISOString(),
    registeredAt: new Date().toISOString(),
    validationErrors: [],
    data: xFIR,
  };
}

// ---------------------------------------------------------------------------
// Helper: valida il body xFIR (struttura RENTRI — D.M. 59/2023)
// ---------------------------------------------------------------------------
function validateXFIR(xFIR) {
  const errors = [];
  if (!xFIR) {
    errors.push({ code: 'E000', field: 'body', message: 'Payload xFIR obbligatorio' });
    return errors;
  }
  if (!xFIR.firId) {
    errors.push({ code: 'E001', field: 'firId', message: 'firId obbligatorio' });
  }
  if (!xFIR.produttore?.partitaIva) {
    errors.push({ code: 'E010', field: 'produttore.partitaIva', message: 'Partita IVA produttore obbligatoria' });
  }
  if (!xFIR.trasportatore?.partitaIva) {
    errors.push({ code: 'E011', field: 'trasportatore.partitaIva', message: 'Partita IVA trasportatore obbligatoria' });
  }
  if (!xFIR.destinatario?.partitaIva) {
    errors.push({ code: 'E012', field: 'destinatario.partitaIva', message: 'Partita IVA destinatario obbligatoria' });
  }
  if (!xFIR.rifiuto?.codiceEER) {
    errors.push({ code: 'E020', field: 'rifiuto.codiceEER', message: 'Codice EER obbligatorio' });
  }
  if (!xFIR.rifiuto?.quantita || xFIR.rifiuto.quantita <= 0) {
    errors.push({ code: 'E021', field: 'rifiuto.quantita', message: 'Quantità rifiuto obbligatoria e > 0' });
  }
  if (!xFIR.trasporto?.dataPartenza) {
    errors.push({ code: 'E030', field: 'trasporto.dataPartenza', message: 'Data di partenza obbligatoria' });
  }
  return errors;
}

// ---------------------------------------------------------------------------
// Helper: simula random failure (5%) e log
// ---------------------------------------------------------------------------
function randomServiceUnavailable(res) {
  if (Math.random() < 0.05) {
    res.status(503).json({
      error: 'SERVICE_UNAVAILABLE',
      message: 'RENTRI service temporarily unavailable',
      retryAfter: 300,
    });
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    service: 'RENTRI Mock API (vidimazione-formulari)',
    version: 'v1.0',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    note: 'Mock locale — ATTIVARE: caricare certificato + iscrizione RENTRI per go-live',
  });
});

// ===========================================================================
// Stile API reale RENTRI: POST /vidimazione-formulari/v1.0/formulari
// (servizio confermato; path DA CONFERMARE sull'OpenAPI ufficiale)
// ===========================================================================

// POST /vidimazione-formulari/v1.0/formulari — vidima/crea FIR (xFIR body diretto)
app.post('/vidimazione-formulari/v1.0/formulari', (req, res) => {
  const xFIR = req.body;
  const errors = validateXFIR(xFIR);

  if (errors.length > 0) {
    return res.status(400).json({ valid: false, errors });
  }

  if (randomServiceUnavailable(res)) return;

  const firId = xFIR.firId;
  const mockResponse = generateMockResponse(firId, xFIR);
  firRegistry.set(firId, mockResponse);

  registryEntries.push({
    firId,
    protocolNumber: mockResponse.protocolNumber,
    submittedAt: mockResponse.registeredAt,
    cerCode: xFIR.rifiuto?.codiceEER,
    quantity: xFIR.rifiuto?.quantita,
    producerVat: xFIR.produttore?.partitaIva,
  });

  console.log(`[RENTRI Mock] FIR vidimato: ${firId} -> ${mockResponse.rentriId}`);
  res.status(201).json(mockResponse);
});

// GET /vidimazione-formulari/v1.0/formulari/:firId — stato FIR
app.get('/vidimazione-formulari/v1.0/formulari/:firId', (req, res) => {
  const { firId } = req.params;
  const fir = firRegistry.get(firId);
  if (!fir) {
    return res.status(404).json({
      error: 'NOT_FOUND',
      message: `FIR ${firId} non trovato nel registro RENTRI mock`,
    });
  }
  res.status(200).json(fir);
});

// POST /vidimazione-formulari/v1.0/formulari/:firId/annulla-fir — annulla FIR
app.post('/vidimazione-formulari/v1.0/formulari/:firId/annulla-fir', (req, res) => {
  const { firId } = req.params;
  if (!firRegistry.has(firId)) {
    return res.status(404).json({ error: 'NOT_FOUND', message: `FIR ${firId} non trovato` });
  }
  const existing = firRegistry.get(firId);
  existing.status = 'CANCELLED';
  existing.cancelledAt = new Date().toISOString();
  console.log(`[RENTRI Mock] FIR annullato: ${firId}`);
  res.status(200).json({ success: true, firId, status: 'CANCELLED' });
});

// ===========================================================================
// Stile legacy (percorsi interni) — retrocompatibilità con il client mock
// ===========================================================================

// POST /api/v1/fir/validate — validazione pre-invio (xFIR body diretto)
app.post('/api/v1/fir/validate', (req, res) => {
  const xFIR = req.body;
  const errors = validateXFIR(xFIR);

  if (errors.length > 0) {
    return res.status(400).json({ valid: false, errors });
  }

  res.status(200).json({
    valid: true,
    errors: [],
    warnings: [],
    message: 'FIR valido secondo le specifiche xFIR (mock)',
  });
});

// POST /api/v1/fir/submit — invio FIR (xFIR body diretto)
app.post('/api/v1/fir/submit', (req, res) => {
  const xFIR = req.body;

  if (!xFIR?.firId) {
    return res.status(400).json({ error: 'BAD_REQUEST', message: 'firId obbligatorio nel payload xFIR' });
  }

  if (randomServiceUnavailable(res)) return;

  const firId = xFIR.firId;
  const mockResponse = generateMockResponse(firId, xFIR);
  firRegistry.set(firId, mockResponse);

  registryEntries.push({
    firId,
    protocolNumber: mockResponse.protocolNumber,
    submittedAt: mockResponse.registeredAt,
    cerCode: xFIR.rifiuto?.codiceEER,
    quantity: xFIR.rifiuto?.quantita,
    producerVat: xFIR.produttore?.partitaIva,
  });

  console.log(`[RENTRI Mock] FIR submitted: ${firId} -> ${mockResponse.protocolNumber}`);
  res.status(201).json(mockResponse);
});

// GET /api/v1/fir/:firId — stato FIR (legacy)
app.get('/api/v1/fir/:firId', (req, res) => {
  const { firId } = req.params;
  const fir = firRegistry.get(firId);
  if (!fir) {
    return res.status(404).json({
      error: 'NOT_FOUND',
      message: `FIR with ID ${firId} not found in RENTRI registry`,
    });
  }
  res.status(200).json(fir);
});

// POST /api/v1/registry/batch — batch submit (legacy)
app.post('/api/v1/registry/batch', (req, res) => {
  const { entries } = req.body;
  if (!entries || !Array.isArray(entries)) {
    return res.status(400).json({ error: 'BAD_REQUEST', message: 'entries array is required' });
  }

  const results = entries.map(entry => {
    const firId = entry.firId || `FIR-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const mockResponse = generateMockResponse(firId, entry);
    firRegistry.set(firId, mockResponse);
    return mockResponse;
  });

  console.log(`[RENTRI Mock] Batch submitted: ${results.length} entries`);
  res.status(201).json({ success: true, processedCount: results.length, results });
});

// GET /api/v1/registry/search — ricerca (legacy)
app.get('/api/v1/registry/search', (req, res) => {
  const { cerCode, partitaIva, dateFrom, dateTo } = req.query;
  let filtered = registryEntries;

  if (cerCode) filtered = filtered.filter(e => e.cerCode === cerCode);
  if (partitaIva) filtered = filtered.filter(e => e.producerVat === partitaIva);
  if (dateFrom) filtered = filtered.filter(e => new Date(e.submittedAt) >= new Date(dateFrom));
  if (dateTo) filtered = filtered.filter(e => new Date(e.submittedAt) <= new Date(dateTo));

  res.status(200).json({ total: filtered.length, entries: filtered });
});

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------
app.use((err, req, res, _next) => {
  console.error('[RENTRI Mock] Error:', err);
  res.status(500).json({ error: 'INTERNAL_SERVER_ERROR', message: err.message });
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
app.listen(PORT, () => {
  console.log(`[RENTRI Mock API] Server running on port ${PORT}`);
  console.log(`[RENTRI Mock API] Health:  http://localhost:${PORT}/health`);
  console.log(`[RENTRI Mock API] Submit:  POST http://localhost:${PORT}/vidimazione-formulari/v1.0/formulari`);
  console.log(`[RENTRI Mock API] Legacy:  POST http://localhost:${PORT}/api/v1/fir/submit`);
  console.log(`[RENTRI Mock API] NOTE: ATTIVARE con certificato RENTRI reale per go-live`);
});

process.on('SIGTERM', () => { console.log('[RENTRI Mock] SIGTERM'); process.exit(0); });
process.on('SIGINT',  () => { console.log('[RENTRI Mock] SIGINT');  process.exit(0); });
