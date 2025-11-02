const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(bodyParser.json());

// In-memory storage for mock data
const firRegistry = new Map();
const registryEntries = [];

// Mock data generator
const generateMockResponse = (firId, data) => {
  return {
    firId: firId,
    protocolNumber: `RENTRI-${new Date().getFullYear()}-${String(Math.floor(Math.random() * 100000)).padStart(6, '0')}`,
    status: 'ACCEPTED',
    registeredAt: new Date().toISOString(),
    validationErrors: [],
    data: data
  };
};

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    service: 'RENTRI Mock API',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// POST /api/v1/fir/validate - Pre-submission validation
app.post('/api/v1/fir/validate', (req, res) => {
  const { fir } = req.body;

  const errors = [];

  // Basic validation rules
  if (!fir) {
    errors.push({ field: 'fir', message: 'FIR data is required' });
  } else {
    if (!fir.wasteProducer || !fir.wasteProducer.partitaIva) {
      errors.push({ field: 'wasteProducer.partitaIva', message: 'Producer VAT number is required' });
    }
    if (!fir.wasteCarrier || !fir.wasteCarrier.partitaIva) {
      errors.push({ field: 'wasteCarrier.partitaIva', message: 'Carrier VAT number is required' });
    }
    if (!fir.wasteReceiver || !fir.wasteReceiver.partitaIva) {
      errors.push({ field: 'wasteReceiver.partitaIva', message: 'Receiver VAT number is required' });
    }
    if (!fir.wasteDetails || !fir.wasteDetails.cerCode) {
      errors.push({ field: 'wasteDetails.cerCode', message: 'CER code is required' });
    }
    if (!fir.wasteDetails || !fir.wasteDetails.quantity || fir.wasteDetails.quantity <= 0) {
      errors.push({ field: 'wasteDetails.quantity', message: 'Valid quantity is required' });
    }
    if (!fir.transportDate) {
      errors.push({ field: 'transportDate', message: 'Transport date is required' });
    }
  }

  if (errors.length > 0) {
    return res.status(400).json({
      valid: false,
      errors: errors
    });
  }

  res.status(200).json({
    valid: true,
    errors: [],
    message: 'FIR validation passed'
  });
});

// POST /api/v1/fir/submit - Submit FIR to RENTRI
app.post('/api/v1/fir/submit', (req, res) => {
  const { firId, fir } = req.body;

  if (!firId) {
    return res.status(400).json({
      error: 'BAD_REQUEST',
      message: 'firId is required'
    });
  }

  if (!fir) {
    return res.status(400).json({
      error: 'BAD_REQUEST',
      message: 'FIR data is required'
    });
  }

  // Simulate random failures (5% failure rate)
  const shouldFail = Math.random() < 0.05;

  if (shouldFail) {
    return res.status(503).json({
      error: 'SERVICE_UNAVAILABLE',
      message: 'RENTRI service temporarily unavailable',
      retryAfter: 300
    });
  }

  // Store FIR in mock registry
  const mockResponse = generateMockResponse(firId, fir);
  firRegistry.set(firId, mockResponse);

  // Add to registry entries
  registryEntries.push({
    firId: firId,
    protocolNumber: mockResponse.protocolNumber,
    submittedAt: mockResponse.registeredAt,
    cerCode: fir.wasteDetails?.cerCode,
    quantity: fir.wasteDetails?.quantity,
    producerVat: fir.wasteProducer?.partitaIva
  });

  console.log(`[RENTRI Mock] FIR submitted: ${firId} -> ${mockResponse.protocolNumber}`);

  res.status(201).json(mockResponse);
});

// GET /api/v1/fir/:firId - Get FIR status
app.get('/api/v1/fir/:firId', (req, res) => {
  const { firId } = req.params;

  const fir = firRegistry.get(firId);

  if (!fir) {
    return res.status(404).json({
      error: 'NOT_FOUND',
      message: `FIR with ID ${firId} not found in RENTRI registry`
    });
  }

  res.status(200).json(fir);
});

// POST /api/v1/registry/batch - Batch submit registry entries
app.post('/api/v1/registry/batch', (req, res) => {
  const { entries } = req.body;

  if (!entries || !Array.isArray(entries)) {
    return res.status(400).json({
      error: 'BAD_REQUEST',
      message: 'entries array is required'
    });
  }

  const results = entries.map(entry => {
    const firId = entry.firId || `FIR-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const mockResponse = generateMockResponse(firId, entry);
    firRegistry.set(firId, mockResponse);
    return mockResponse;
  });

  console.log(`[RENTRI Mock] Batch submitted: ${results.length} entries`);

  res.status(201).json({
    success: true,
    processedCount: results.length,
    results: results
  });
});

// GET /api/v1/registry/search - Search registry entries
app.get('/api/v1/registry/search', (req, res) => {
  const { cerCode, partitaIva, dateFrom, dateTo } = req.query;

  let filtered = registryEntries;

  if (cerCode) {
    filtered = filtered.filter(e => e.cerCode === cerCode);
  }

  if (partitaIva) {
    filtered = filtered.filter(e => e.producerVat === partitaIva);
  }

  if (dateFrom) {
    filtered = filtered.filter(e => new Date(e.submittedAt) >= new Date(dateFrom));
  }

  if (dateTo) {
    filtered = filtered.filter(e => new Date(e.submittedAt) <= new Date(dateTo));
  }

  res.status(200).json({
    total: filtered.length,
    entries: filtered
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('[RENTRI Mock] Error:', err);
  res.status(500).json({
    error: 'INTERNAL_SERVER_ERROR',
    message: err.message
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`[RENTRI Mock API] Server running on port ${PORT}`);
  console.log(`[RENTRI Mock API] Health check: http://localhost:${PORT}/health`);
  console.log(`[RENTRI Mock API] Environment: ${process.env.NODE_ENV || 'development'}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('[RENTRI Mock API] SIGTERM received, shutting down gracefully');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('[RENTRI Mock API] SIGINT received, shutting down gracefully');
  process.exit(0);
});
