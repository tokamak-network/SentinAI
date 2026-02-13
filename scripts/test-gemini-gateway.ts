#!/usr/bin/env node

/**
 * Test Gemini API through LiteLLM Gateway
 */

import * as fs from 'fs';
import * as path from 'path';

function loadEnvLocal(): Record<string, string> {
  const envPath = path.resolve(process.cwd(), '.env.local');
  const env: Record<string, string> = {};
  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, 'utf-8');
    content.split('\n').forEach(line => {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        const [key, ...valueParts] = trimmed.split('=');
        if (key && valueParts.length > 0) {
          env[key] = valueParts.join('=');
        }
      }
    });
  }
  return env;
}

async function testGemini(): Promise<void> {
  const env = loadEnvLocal();
  const gatewayUrl = env.AI_GATEWAY_URL;
  const geminiKey = env.GEMINI_API_KEY;

  console.log('🔍 Testing Gemini Models through LiteLLM Gateway\n');
  console.log(`Gateway URL: ${gatewayUrl || '❌ NOT SET'}`);
  console.log(`Gemini API Key: ${geminiKey ? `${geminiKey.slice(0, 10)}...${geminiKey.slice(-4)}` : '❌ NOT SET'}\n`);

  if (!gatewayUrl || !geminiKey) {
    console.error('❌ Missing AI_GATEWAY_URL or GEMINI_API_KEY');
    process.exit(1);
  }

  const models = ['gemini-3-flash', 'gemini-3-pro'];

  for (const model of models) {
    console.log(`📤 Testing ${model}...`);
    try {
      const response = await fetch(`${gatewayUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${geminiKey}`,
        },
        body: JSON.stringify({
          model: model,
          messages: [
            {
              role: 'user',
              content: 'Say "hello"',
            },
          ],
          max_tokens: 10,
        }),
      });

      const data = await response.json() as any;

      if (!response.ok) {
        console.log(`   ❌ FAILED (${response.status}): ${data.error?.message || JSON.stringify(data.error || data)}`);
      } else {
        console.log(`   ✅ SUCCESS`);
        console.log(`      Response: ${data.choices?.[0]?.message?.content || 'No response'}`);
        console.log(`      Tokens: ${data.usage?.prompt_tokens || 0} prompt, ${data.usage?.completion_tokens || 0} completion\n`);
      }
    } catch (err) {
      console.log(`   ❌ ERROR: ${err instanceof Error ? err.message : String(err)}\n`);
    }
  }

  // Also test GPT models through gateway
  console.log('📤 Testing GPT models through Gateway...\n');
  const gptModels = ['gpt-4o-mini', 'gpt-4o'];

  for (const model of gptModels) {
    console.log(`Testing ${model}...`);
    try {
      const response = await fetch(`${gatewayUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${geminiKey}`,  // Using Gemini key for gateway
        },
        body: JSON.stringify({
          model: model,
          messages: [
            {
              role: 'user',
              content: 'Say "hello"',
            },
          ],
          max_tokens: 10,
        }),
      });

      const data = await response.json() as any;

      if (!response.ok) {
        console.log(`   ❌ FAILED (${response.status}): ${data.error?.message || JSON.stringify(data.error || data)}`);
      } else {
        console.log(`   ✅ SUCCESS`);
        console.log(`      Response: ${data.choices?.[0]?.message?.content || 'No response'}`);
        console.log(`      Tokens: ${data.usage?.prompt_tokens || 0} prompt, ${data.usage?.completion_tokens || 0} completion\n`);
      }
    } catch (err) {
      console.log(`   ❌ ERROR: ${err instanceof Error ? err.message : String(err)}\n`);
    }
  }
}

testGemini().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
