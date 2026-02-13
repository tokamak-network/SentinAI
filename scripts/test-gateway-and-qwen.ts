#!/usr/bin/env node

/**
 * Test LiteLLM Gateway and Qwen API
 */

import * as fs from 'fs';
import * as path from 'path';

// Load .env.local
function loadEnvLocal(): void {
  const envPath = path.resolve(process.cwd(), '.env.local');
  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, 'utf-8');
    content.split('\n').forEach(line => {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        const [key, ...valueParts] = trimmed.split('=');
        if (key && valueParts.length > 0) {
          process.env[key] = valueParts.join('=');
        }
      }
    });
  }
}

async function testGatewayAndQwen(): Promise<void> {
  loadEnvLocal();

  const qwenKey = process.env.QWEN_API_KEY;
  const gatewayUrl = process.env.AI_GATEWAY_URL;

  console.log('🔍 LiteLLM Gateway & Qwen API Test\n');
  console.log(`Qwen API Key: ${qwenKey ? `${qwenKey.slice(0, 10)}...${qwenKey.slice(-4)}` : 'NOT SET'}`);
  console.log(`Gateway URL: ${gatewayUrl || 'NOT SET'}\n`);

  if (!qwenKey || !gatewayUrl) {
    console.error('❌ Missing QWEN_API_KEY or AI_GATEWAY_URL');
    process.exit(1);
  }

  try {
    // Test with LiteLLM Gateway - Qwen model
    console.log('📤 Testing LiteLLM Gateway with qwen3-coder-flash...\n');
    const gatewayResponse = await fetch(`${gatewayUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${qwenKey}`,
      },
      body: JSON.stringify({
        model: 'qwen3-coder-flash',
        messages: [
          {
            role: 'user',
            content: 'Say "hello"',
          },
        ],
        max_tokens: 10,
      }),
    });

    const gatewayData = await gatewayResponse.json() as any;

    if (!gatewayResponse.ok) {
      console.error(`❌ Gateway API Error (${gatewayResponse.status}):`);
      console.error(JSON.stringify(gatewayData, null, 2));
      console.error('\nPossible reasons:');
      console.error('1. Gateway URL is incorrect');
      console.error('2. Gateway is not running or accessible');
      console.error('3. Qwen model name is incorrect for gateway');
      console.error('4. API key format is wrong for gateway');
    } else {
      console.log('✅ Gateway with Qwen works!');
      console.log(`Response: ${gatewayData.choices?.[0]?.message?.content || 'No response'}`);
      console.log(`Tokens: ${gatewayData.usage?.prompt_tokens || 0} prompt, ${gatewayData.usage?.completion_tokens || 0} completion\n`);
    }

    // Also test direct Qwen API (DashScope)
    console.log('📤 Testing Direct Qwen API (DashScope)...\n');
    const qwenResponse = await fetch('https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${qwenKey}`,
      },
      body: JSON.stringify({
        model: 'qwen3-coder-flash',
        messages: [
          {
            role: 'user',
            content: 'Say "hello"',
          },
        ],
        max_tokens: 10,
      }),
    });

    const qwenData = await qwenResponse.json() as any;

    if (!qwenResponse.ok) {
      console.error(`❌ Qwen Direct API Error (${qwenResponse.status}):`);
      console.error(JSON.stringify(qwenData, null, 2));
    } else {
      console.log('✅ Direct Qwen API works!');
      console.log(`Response: ${qwenData.output?.text || qwenData.choices?.[0]?.message?.content || 'No response'}`);
      console.log(`Tokens: ${qwenData.usage?.input_tokens || 0} input, ${qwenData.usage?.output_tokens || 0} output\n`);
    }

  } catch (err) {
    console.error('❌ Error:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

testGatewayAndQwen();
