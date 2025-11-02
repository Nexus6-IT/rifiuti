import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';

/**
 * Performance Test Suite
 * T238: Load and stress testing for API endpoints
 *
 * Purpose: Verify system performance under load
 *
 * Run tests:
 * - Smoke test: k6 run --vus 1 --duration 30s load-test.js
 * - Load test: k6 run --vus 100 --duration 5m load-test.js
 * - Stress test: k6 run --vus 500 --duration 10m load-test.js
 * - Spike test: k6 run --stage 0s:0,1m:1000,1m:1000,1m:0 load-test.js
 *
 * Metrics:
 * - Response time p95 < 200ms
 * - Response time p99 < 500ms
 * - Error rate < 1%
 * - Throughput > 1000 req/s
 */

// Custom metrics
const errorRate = new Rate('errors');
const apiResponseTime = new Trend('api_response_time');
const permissionCheckTime = new Trend('permission_check_time');
const databaseQueryTime = new Trend('database_query_time');
const cacheHitRate = new Rate('cache_hit_rate');
const authFailures = new Counter('auth_failures');

// Test configuration
export const options = {
  stages: [
    { duration: '2m', target: 50 },   // Ramp-up to 50 users
    { duration: '5m', target: 100 },  // Stay at 100 users
    { duration: '2m', target: 200 },  // Spike to 200 users
    { duration: '5m', target: 200 },  // Stay at 200 users
    { duration: '2m', target: 0 },    // Ramp-down
  ],
  thresholds: {
    'http_req_duration': ['p(95)<200', 'p(99)<500'],  // 95% < 200ms, 99% < 500ms
    'http_req_failed': ['rate<0.01'],                  // Error rate < 1%
    'errors': ['rate<0.01'],
    'api_response_time': ['p(95)<200'],
    'permission_check_time': ['p(95)<10'],             // Permission checks < 10ms
    'database_query_time': ['p(95)<100'],              // DB queries < 100ms
  },
};

// Test data
const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const API_PREFIX = '/api/v1';

// Mock authentication tokens (generated from test users)
const AUTH_TOKENS = {
  admin: __ENV.ADMIN_TOKEN || 'mock-admin-token',
  operator: __ENV.OPERATOR_TOKEN || 'mock-operator-token',
  driver: __ENV.DRIVER_TOKEN || 'mock-driver-token',
};

/**
 * Setup function - runs once per VU
 */
export function setup() {
  // Authenticate and get real tokens if needed
  console.log('Setting up performance tests...');
  return {
    baseUrl: BASE_URL,
    tokens: AUTH_TOKENS,
  };
}

/**
 * Main test scenario
 */
export default function(data) {
  const { baseUrl, tokens } = data;

  // Randomly select user type for realistic distribution
  const userType = selectUserType();
  const token = tokens[userType];

  // Common headers
  const headers = {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
  };

  // Test scenario: Typical user workflow
  testScenario(baseUrl, headers, userType);

  // Wait between iterations (think time)
  sleep(Math.random() * 3 + 1); // 1-4 seconds
}

/**
 * Test typical user workflow
 */
function testScenario(baseUrl, headers, userType) {
  const scenario = Math.random();

  if (scenario < 0.6) {
    // 60% - Read operations (most common)
    testReadOperations(baseUrl, headers);
  } else if (scenario < 0.85) {
    // 25% - Create operations
    testCreateOperations(baseUrl, headers, userType);
  } else {
    // 15% - Update operations
    testUpdateOperations(baseUrl, headers);
  }
}

/**
 * Test read operations (LIST and GET)
 */
function testReadOperations(baseUrl, headers) {
  // List FIRs
  const listResponse = http.get(
    `${baseUrl}${API_PREFIX}/fir?limit=50`,
    { headers, tags: { name: 'list_firs' } }
  );

  check(listResponse, {
    'list FIRs status 200': (r) => r.status === 200,
    'list FIRs response time < 200ms': (r) => r.timings.duration < 200,
    'list FIRs has pagination': (r) => r.json('pagination') !== undefined,
  }) || errorRate.add(1);

  apiResponseTime.add(listResponse.timings.duration);

  // Extract permission check time from headers
  const permCheckTime = listResponse.headers['X-Permission-Check-Time'];
  if (permCheckTime) {
    permissionCheckTime.add(parseFloat(permCheckTime));
  }

  // Extract database query time
  const dbQueryTime = listResponse.headers['X-Database-Query-Time'];
  if (dbQueryTime) {
    databaseQueryTime.add(parseFloat(dbQueryTime));
  }

  // Track cache hits
  const cacheHit = listResponse.headers['X-Cache'] === 'HIT';
  cacheHitRate.add(cacheHit ? 1 : 0);

  sleep(0.5);

  // Get specific FIR
  if (listResponse.json('data') && listResponse.json('data').length > 0) {
    const firstFirId = listResponse.json('data.0.id');

    const getResponse = http.get(
      `${baseUrl}${API_PREFIX}/fir/${firstFirId}`,
      { headers, tags: { name: 'get_fir' } }
    );

    check(getResponse, {
      'get FIR status 200': (r) => r.status === 200,
      'get FIR response time < 100ms': (r) => r.timings.duration < 100,
    }) || errorRate.add(1);

    apiResponseTime.add(getResponse.timings.duration);
  }
}

/**
 * Test create operations
 */
function testCreateOperations(baseUrl, headers, userType) {
  // Only operators and admins can create
  if (userType === 'driver') {
    return testReadOperations(baseUrl, headers);
  }

  const firData = {
    cerCode: '170904',
    quantity: Math.floor(Math.random() * 10000) + 1000,
    unit: 'kg',
    wasteDescription: `Load test waste ${Date.now()}`,
    producerFacilityId: 'test-facility-producer',
    destinationFacilityId: 'test-facility-transporter',
    transportDate: new Date(Date.now() + 86400000).toISOString(),
  };

  const createResponse = http.post(
    `${baseUrl}${API_PREFIX}/fir`,
    JSON.stringify(firData),
    { headers, tags: { name: 'create_fir' } }
  );

  check(createResponse, {
    'create FIR status 201': (r) => r.status === 201,
    'create FIR response time < 500ms': (r) => r.timings.duration < 500,
    'create FIR returns ID': (r) => r.json('data.id') !== undefined,
  }) || errorRate.add(1);

  apiResponseTime.add(createResponse.timings.duration);
}

/**
 * Test update operations
 */
function testUpdateOperations(baseUrl, headers) {
  // First get a FIR to update
  const listResponse = http.get(
    `${baseUrl}${API_PREFIX}/fir?limit=1`,
    { headers }
  );

  if (listResponse.json('data') && listResponse.json('data').length > 0) {
    const firId = listResponse.json('data.0.id');

    const updateData = {
      wasteDescription: `Updated by load test ${Date.now()}`,
    };

    const updateResponse = http.put(
      `${baseUrl}${API_PREFIX}/fir/${firId}`,
      JSON.stringify(updateData),
      { headers, tags: { name: 'update_fir' } }
    );

    check(updateResponse, {
      'update FIR status 200 or 403': (r) => [200, 403].includes(r.status),
      'update FIR response time < 300ms': (r) => r.timings.duration < 300,
    }) || errorRate.add(1);

    if (updateResponse.status === 403) {
      authFailures.add(1);
    }

    apiResponseTime.add(updateResponse.timings.duration);
  }
}

/**
 * Randomly select user type based on realistic distribution
 */
function selectUserType() {
  const rand = Math.random();
  if (rand < 0.1) {
    return 'admin'; // 10% admin
  } else if (rand < 0.5) {
    return 'operator'; // 40% operator
  } else {
    return 'driver'; // 50% driver
  }
}

/**
 * Teardown function - runs once after all iterations
 */
export function teardown(data) {
  console.log('Performance tests completed');
}

/**
 * Additional test scenarios
 */

// Permission check stress test
export function testPermissionChecks() {
  const headers = {
    'Authorization': `Bearer ${AUTH_TOKENS.operator}`,
  };

  for (let i = 0; i < 100; i++) {
    const response = http.get(
      `${BASE_URL}${API_PREFIX}/fir?limit=1`,
      { headers, tags: { name: 'permission_stress' } }
    );

    permissionCheckTime.add(parseFloat(response.headers['X-Permission-Check-Time'] || 0));
  }
}

// Database query performance test
export function testDatabaseQueries() {
  const headers = {
    'Authorization': `Bearer ${AUTH_TOKENS.admin}`,
  };

  // Complex query with filters
  const response = http.get(
    `${BASE_URL}${API_PREFIX}/fir?status=pending&sortBy=createdAt&sortOrder=desc&limit=100`,
    { headers, tags: { name: 'complex_query' } }
  );

  check(response, {
    'complex query < 200ms': (r) => r.timings.duration < 200,
  }) || errorRate.add(1);

  databaseQueryTime.add(parseFloat(response.headers['X-Database-Query-Time'] || 0));
}

// Cache effectiveness test
export function testCacheEffectiveness() {
  const headers = {
    'Authorization': `Bearer ${AUTH_TOKENS.operator}`,
  };

  // Request same endpoint multiple times
  for (let i = 0; i < 10; i++) {
    const response = http.get(
      `${BASE_URL}${API_PREFIX}/fir?limit=50`,
      { headers, tags: { name: 'cache_test' } }
    );

    const cacheHit = response.headers['X-Cache'] === 'HIT';
    cacheHitRate.add(cacheHit ? 1 : 0);

    sleep(0.1);
  }
}
