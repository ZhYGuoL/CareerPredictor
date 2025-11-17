#!/bin/bash

# Test Clado API Key
echo "🧪 Testing Clado API..."
echo ""

# Load the API key
source /Users/zhiyuanguo/Desktop/Coding/CareerPredictor/worker/.dev.vars

if [ -z "$CLADO_API_KEY" ]; then
  echo "❌ CLADO_API_KEY not found in .dev.vars"
  exit 1
fi

echo "📋 API Key format: ${CLADO_API_KEY:0:5}..."
echo ""

# Test the API
echo "🔍 Testing search endpoint..."
curl -X GET "https://search.clado.ai/api/search?query=software+engineers+at+tech+companies&limit=3" \
  -H "Authorization: Bearer $CLADO_API_KEY" \
  -H "Content-Type: application/json" \
  -w "\n\n📊 HTTP Status: %{http_code}\n" \
  -s | jq . || echo "(JSON parse failed - check API key)"

echo ""
echo "✅ Test complete!"

