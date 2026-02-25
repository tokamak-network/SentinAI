#!/usr/bin/env node

/**
 * Test LiteLLM Gateway and Qwen API
 */

import * as fs from 'fs';
import * as path from 'path';
import { tsConsole } from './console-with-timestamp';

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

  tsConsole.log('🔍 LiteLLM Gateway & Qwen API Test\n');
  tsConsole.log(`Qwen API Key: ${qwenKey ? `${qwenKey.slice(0, 10)}...${qwenKey.slice(-4)}` : 'NOT SET'}`);
  tsConsole.log(`Gateway URL: ${gatewayUrl || 'NOT SET'}\n`);

  if (!qwenKey || !gatewayUrl) {
    tsConsole.error('❌ Missing QWEN_API_KEY or AI_GATEWAY_URL');
    process.exit(1);
  }

  try {
    // Test with LiteLLM Gateway - Qwen model
    tsConsole.log('📤 Testing LiteLLM Gateway with qwen3-coder-flash...\n');
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
      tsConsole.error(`❌ Gateway API Error (${gatewayResponse.status}):`);
      tsConsole.error(JSON.stringify(gatewayData, null, 2));
      tsConsole.error('\nPossible reasons:');
      tsConsole.error('1. Gateway URL is incorrect');
      tsConsole.error('2. Gateway is not running or accessible');
      tsConsole.error('3. Qwen model name is incorrect for gateway');
      tsConsole.error('4. API key format is wrong for gateway');
    } else {
      tsConsole.log('✅ Gateway with Qwen works!');
      tsConsole.log(`Response: ${gatewayData.choices?.[0]?.message?.content || 'No response'}`);
      tsConsole.log(`Tokens: ${gatewayData.usage?.prompt_tokens || 0} prompt, ${gatewayData.usage?.completion_tokens || 0} completion\n`);
    }

    // Also test direct Qwen API (DashScope)
    tsConsole.log('📤 Testing Direct Qwen API (DashScope)...\n');
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
      tsConsole.error(`❌ Qwen Direct API Error (${qwenResponse.status}):`);
      tsConsole.error(JSON.stringify(qwenData, null, 2));
    } else {
      tsConsole.log('✅ Direct Qwen API works!');
      tsConsole.log(`Response: ${qwenData.output?.text || qwenData.choices?.[0]?.message?.content || 'No response'}`);
      tsConsole.log(`Tokens: ${qwenData.usage?.input_tokens || 0} input, ${qwenData.usage?.output_tokens || 0} output\n`);
    }

  } catch (err) {
    tsConsole.error('❌ Error:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

testGatewayAndQwen();
