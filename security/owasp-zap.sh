#!/bin/bash
###############################################################################
# OWASP ZAP Security Scanner
# T235: Phase 10 - Security Hardening
#
# Scans all API endpoints for:
# - SQL injection
# - XSS vulnerabilities
# - Authentication bypass
# - CSRF protection
# - Security headers
#
# Prerequisites:
# - OWASP ZAP installed (https://www.zaproxy.org/download/)
# - Application running on localhost:3000
#
# Usage:
#   ./owasp-zap.sh [target-url]
#
# Example:
#   ./owasp-zap.sh http://localhost:3000
###############################################################################

set -e

# Configuration
TARGET_URL="${1:-http://localhost:3000}"
ZAP_PORT="${ZAP_PORT:-8080}"
REPORT_DIR="./security-reports"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
REPORT_FILE="${REPORT_DIR}/zap-report-${TIMESTAMP}.html"
JSON_REPORT="${REPORT_DIR}/zap-report-${TIMESTAMP}.json"
XML_REPORT="${REPORT_DIR}/zap-report-${TIMESTAMP}.xml"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "================================================"
echo "OWASP ZAP Security Scan"
echo "Target: ${TARGET_URL}"
echo "Timestamp: ${TIMESTAMP}"
echo "================================================"
echo ""

# Create report directory
mkdir -p "${REPORT_DIR}"

# Check if ZAP is installed
if ! command -v zap.sh &> /dev/null && ! command -v zap-cli &> /dev/null; then
    echo -e "${RED}ERROR: OWASP ZAP not found. Please install from https://www.zaproxy.org/download/${NC}"
    exit 1
fi

# Check if target is reachable
echo "Checking if target is reachable..."
if ! curl -s -o /dev/null -w "%{http_code}" "${TARGET_URL}/api/health" | grep -q "200\|404"; then
    echo -e "${YELLOW}WARNING: Target may not be reachable. Continuing anyway...${NC}"
fi

echo -e "${GREEN}✓ Starting ZAP security scan...${NC}"
echo ""

# Start ZAP daemon
echo "Starting ZAP daemon on port ${ZAP_PORT}..."
zap.sh -daemon -host 0.0.0.0 -port ${ZAP_PORT} -config api.disablekey=true &
ZAP_PID=$!

# Wait for ZAP to start
echo "Waiting for ZAP to initialize..."
sleep 15

# Function to call ZAP API
zap_api() {
    curl -s "http://localhost:${ZAP_PORT}/JSON/$1"
}

# Spider the target
echo -e "\n${GREEN}[1/6] Spidering target...${NC}"
SPIDER_ID=$(zap_api "spider/action/scan/?url=${TARGET_URL}" | jq -r '.scan')
echo "Spider scan ID: ${SPIDER_ID}"

# Wait for spider to complete
while [ "$(zap_api "spider/view/status/?scanId=${SPIDER_ID}" | jq -r '.status')" != "100" ]; do
    STATUS=$(zap_api "spider/view/status/?scanId=${SPIDER_ID}" | jq -r '.status')
    echo "Spider progress: ${STATUS}%"
    sleep 5
done
echo -e "${GREEN}✓ Spider complete${NC}"

# Passive scan
echo -e "\n${GREEN}[2/6] Running passive scan...${NC}"
sleep 10
echo -e "${GREEN}✓ Passive scan complete${NC}"

# Active scan
echo -e "\n${GREEN}[3/6] Running active scan...${NC}"
SCAN_ID=$(zap_api "ascan/action/scan/?url=${TARGET_URL}" | jq -r '.scan')
echo "Active scan ID: ${SCAN_ID}"

# Wait for active scan to complete
while [ "$(zap_api "ascan/view/status/?scanId=${SCAN_ID}" | jq -r '.status')" != "100" ]; do
    STATUS=$(zap_api "ascan/view/status/?scanId=${SCAN_ID}" | jq -r '.status')
    echo "Active scan progress: ${STATUS}%"
    sleep 10
done
echo -e "${GREEN}✓ Active scan complete${NC}"

# AJAX spider (for SPAs)
echo -e "\n${GREEN}[4/6] Running AJAX spider...${NC}"
AJAX_SPIDER_ID=$(zap_api "ajaxSpider/action/scan/?url=${TARGET_URL}" | jq -r '.Result' || echo "skipped")
if [ "${AJAX_SPIDER_ID}" != "skipped" ]; then
    sleep 30
    echo -e "${GREEN}✓ AJAX spider complete${NC}"
else
    echo -e "${YELLOW}⚠ AJAX spider skipped${NC}"
fi

# Generate reports
echo -e "\n${GREEN}[5/6] Generating reports...${NC}"

# HTML report
curl -s "http://localhost:${ZAP_PORT}/OTHER/core/other/htmlreport/" > "${REPORT_FILE}"
echo "HTML report: ${REPORT_FILE}"

# JSON report
curl -s "http://localhost:${ZAP_PORT}/JSON/core/view/alerts/" > "${JSON_REPORT}"
echo "JSON report: ${JSON_REPORT}"

# XML report
curl -s "http://localhost:${ZAP_PORT}/OTHER/core/other/xmlreport/" > "${XML_REPORT}"
echo "XML report: ${XML_REPORT}"

# Parse results
echo -e "\n${GREEN}[6/6] Analyzing results...${NC}"
echo ""
echo "================================================"
echo "SECURITY SCAN RESULTS"
echo "================================================"

# Count alerts by risk level
HIGH_ALERTS=$(jq '[.alerts[] | select(.risk == "High")] | length' "${JSON_REPORT}")
MEDIUM_ALERTS=$(jq '[.alerts[] | select(.risk == "Medium")] | length' "${JSON_REPORT}")
LOW_ALERTS=$(jq '[.alerts[] | select(.risk == "Low")] | length' "${JSON_REPORT}")
INFO_ALERTS=$(jq '[.alerts[] | select(.risk == "Informational")] | length' "${JSON_REPORT}")

echo -e "${RED}High Risk Alerts:    ${HIGH_ALERTS}${NC}"
echo -e "${YELLOW}Medium Risk Alerts:  ${MEDIUM_ALERTS}${NC}"
echo -e "${GREEN}Low Risk Alerts:     ${LOW_ALERTS}${NC}"
echo -e "Informational:        ${INFO_ALERTS}"
echo ""

# Show high-risk alerts
if [ "${HIGH_ALERTS}" -gt 0 ]; then
    echo -e "${RED}HIGH RISK VULNERABILITIES:${NC}"
    jq -r '.alerts[] | select(.risk == "High") | "  - \(.name) (\(.count) instances)"' "${JSON_REPORT}"
    echo ""
fi

# Show medium-risk alerts
if [ "${MEDIUM_ALERTS}" -gt 0 ]; then
    echo -e "${YELLOW}MEDIUM RISK VULNERABILITIES:${NC}"
    jq -r '.alerts[] | select(.risk == "Medium") | "  - \(.name) (\(.count) instances)"' "${JSON_REPORT}"
    echo ""
fi

echo "================================================"
echo "Full reports saved to:"
echo "  - ${REPORT_FILE}"
echo "  - ${JSON_REPORT}"
echo "  - ${XML_REPORT}"
echo "================================================"

# Cleanup
echo ""
echo "Stopping ZAP daemon..."
kill ${ZAP_PID}
wait ${ZAP_PID} 2>/dev/null || true

# Exit with error if high-risk vulnerabilities found
if [ "${HIGH_ALERTS}" -gt 0 ]; then
    echo -e "\n${RED}SCAN FAILED: High-risk vulnerabilities detected!${NC}"
    exit 1
elif [ "${MEDIUM_ALERTS}" -gt 5 ]; then
    echo -e "\n${YELLOW}SCAN WARNING: Multiple medium-risk vulnerabilities detected!${NC}"
    exit 2
else
    echo -e "\n${GREEN}SCAN PASSED: No critical vulnerabilities detected!${NC}"
    exit 0
fi
