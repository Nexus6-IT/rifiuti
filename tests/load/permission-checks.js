/**
 * k6 Load Testing Script - Permission Checks
 * T232: Phase 10 - Load Testing
 *
 * Scenario: 1000 concurrent users checking permissions
 * Target: <10ms P99 latency, >1000 RPS
 *
 * Run with: k6 run permission-checks.js
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';

// Custom metrics
const permissionCheckDuration = new Trend('permission_check_duration', true);
const permissionCheckSuccess = new Rate('permission_check_success');
const permissionDenials = new Counter('permission_denials');
const abacOverhead = new Trend('abac_overhead_ms');

// Configuration
export const options = {
  stages: [
    { duration: '1m', target: 100 },  // Ramp up to 100 users
    { duration: '2m', target: 500 },  // Ramp up to 500 users
    { duration: '3m', target: 1000 }, // Ramp up to 1000 users
    { duration: '5m', target: 1000 }, // Hold at 1000 users
    { duration: '2m', target: 0 },    // Ramp down
  ],
  thresholds: {
    'permission_check_duration': ['p(99)<10'], // P99 < 10ms
    'permission_check_success': ['rate>0.99'], // 99% success rate
    'http_req_duration': ['p(95)<50'],         // Overall P95 < 50ms
    'http_reqs': ['rate>1000'],                // >1000 RPS
  },
};

// Test configuration
const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const AUTH_TOKEN = __ENV.AUTH_TOKEN || 'test-jwt-token';

// Test data
const resources = ['fir', 'facility', 'report', 'user'];
const actions = ['create', 'read', 'update', 'delete'];
const scopes = ['own', 'facility', 'all'];

/**
 * Setup function - runs once per VU
 */
export function setup() {
  console.log('Starting permission check load test...');
  console.log(`Base URL: ${BASE_URL}`);
  console.log(`Target: 1000 concurrent users, >1000 RPS, P99 < 10ms`);
}

/**
 * Main test function - runs repeatedly for each VU
 */
export default function () {
  // Generate random permission check
  const resource = resources[Math.floor(Math.random() * resources.length)];
  const action = actions[Math.floor(Math.random() * actions.length)];
  const scope = scopes[Math.floor(Math.random() * scopes.length)];

  const permission = `${resource}:${action}:${scope}`;

  // Make permission check request
  const startTime = Date.now();

  const response = http.get(`${BASE_URL}/api/v1/test/permission-check`, {
    headers: {
      'Authorization': `Bearer ${AUTH_TOKEN}`,
      'Content-Type': 'application/json',
      'X-Tenant-ID': 'test-tenant',
      'X-Test-Permission': permission,
    },
    tags: {
      resource,
      action,
      scope,
    },
  });

  const duration = Date.now() - startTime;

  // Record metrics
  permissionCheckDuration.add(duration);

  // Check response
  const success = check(response, {
    'status is 200 or 403': (r) => r.status === 200 || r.status === 403,
    'response time < 50ms': () => duration < 50,
    'has decision field': (r) => {
      try {
        const body = JSON.parse(r.body);
        return body.decision !== undefined;
      } catch {
        return false;
      }
    },
  });

  permissionCheckSuccess.add(success);

  // Track denials
  if (response.status === 403) {
    permissionDenials.add(1);
  }

  // Parse ABAC overhead if available
  try {
    const body = JSON.parse(response.body);
    if (body.abacEvaluationTimeMs) {
      abacOverhead.add(body.abacEvaluationTimeMs);
    }
  } catch (e) {
    // Ignore parsing errors
  }

  // Random think time between 0.1s and 1s
  sleep(Math.random() * 0.9 + 0.1);
}

/**
 * Teardown function - runs once after all VUs complete
 */
export function teardown(data) {
  console.log('Load test completed!');
  console.log('Check metrics and thresholds above.');
}

/**
 * Additional test scenarios
 */

// Spike test - sudden burst of traffic
export function spikeTest() {
  const startTime = Date.now();

  const responses = http.batch([
    ['GET', `${BASE_URL}/api/v1/firs`, null, { headers: { 'Authorization': `Bearer ${AUTH_TOKEN}` } }],
    ['GET', `${BASE_URL}/api/v1/facilities`, null, { headers: { 'Authorization': `Bearer ${AUTH_TOKEN}` } }],
    ['GET', `${BASE_URL}/api/v1/reports`, null, { headers: { 'Authorization': `Bearer ${AUTH_TOKEN}` } }],
  ]);

  const duration = Date.now() - startTime;
  permissionCheckDuration.add(duration / responses.length);

  responses.forEach((response) => {
    permissionCheckSuccess.add(response.status >= 200 && response.status < 400);
  });
}

// Stress test - gradually increase load until failure
export const stressTestOptions = {
  stages: [
    { duration: '5m', target: 2000 },  // Increase to 2000 users
    { duration: '10m', target: 5000 }, // Increase to 5000 users
    { duration: '5m', target: 10000 }, // Increase to 10000 users
    { duration: '5m', target: 0 },     // Ramp down
  ],
};

// Endurance test - sustained load over long period
export const enduranceTestOptions = {
  stages: [
    { duration: '5m', target: 1000 },   // Ramp up
    { duration: '60m', target: 1000 },  // Hold for 1 hour
    { duration: '5m', target: 0 },      // Ramp down
  ],
};
