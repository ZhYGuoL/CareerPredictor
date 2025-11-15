#!/bin/bash

# Test script for CareerPredictor Worker
# This tests the worker with both Exa (scraping) and Clado (search)

echo "🧪 Testing CareerPredictor Worker..."
echo ""

# Test data
LINKEDIN_URL="https://www.linkedin.com/in/satya-nadella"
CAREER_GOAL="working as a CEO at a major tech company"

echo "📝 Test Parameters:"
echo "  LinkedIn URL: $LINKEDIN_URL"
echo "  Career Goal: $CAREER_GOAL"
echo ""
echo "🚀 Sending request to worker..."
echo ""

# Make the request
curl -X POST http://localhost:8787 \
  -H "Content-Type: application/json" \
  -d "{
    \"linkedinUrl\": \"$LINKEDIN_URL\",
    \"careerGoal\": \"$CAREER_GOAL\"
  }" | jq .

echo ""
echo "✅ Test complete!"

