#!/usr/bin/env node

/**
 * Test GPT-5.2 Models through LiteLLM Gateway
 */

import * as fs from 'fs';
import * as path from 'path';
import { tsConsole } from './console-with-timestamp';

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

async function testGPT52(): Promise<void> {
  const env = loadEnvLocal();
  const gatewayUrl = env.AI_GATEWAY_URL;
  const gptKey = env.GPT_API_KEY;

  tsConsole.log('🔍 Testing GPT-5.2 Models through LiteLLM Gateway\n');
  tsConsole.log(`Gateway URL: ${gatewayUrl || '❌ NOT SET'}`);
  tsConsole.log(`Using GPT API Key: ${gptKey ? `${gptKey.slice(0, 10)}...${gptKey.slice(-4)}` : '❌ NOT SET'}\n`);

  if (!gatewayUrl || !gptKey) {
    tsConsole.error('❌ Missing AI_GATEWAY_URL or GPT_API_KEY');
    process.exit(1);
  }

  const models = ['gpt-5.2', 'gpt-5.2-pro', 'gpt-5.2-codex'];

  tsConsole.log('📤 Testing GPT-5.2 Models through Gateway...\n');

  for (const model of models) {
    tsConsole.log(`Testing ${model}...`);
    try {
      const response = await fetch(`${gatewayUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${gptKey}`,
        },
        body: JSON.stringify({
          model: model,
          messages: [
            {
              role: 'user',
              content: 'Say hello and identify yourself',
            },
          ],
          max_tokens: 50,
        }),
      });

      const data = await response.json() as any;

      if (!response.ok) {
        tsConsole.log(`   ❌ FAILED (${response.status})`);
        tsConsole.log(`      Error: ${data.error?.message || JSON.stringify(data.error || data)}\n`);
      } else {
        tsConsole.log(`   ✅ SUCCESS`);
        tsConsole.log(`      Response: ${data.choices?.[0]?.message?.content || 'No response'}`);
        tsConsole.log(`      Tokens: ${data.usage?.prompt_tokens || 0} prompt, ${data.usage?.completion_tokens || 0} completion\n`);
      }
    } catch (err) {
      tsConsole.log(`   ❌ ERROR: ${err instanceof Error ? err.message : String(err)}\n`);
    }
  }
}

testGPT52().catch(err => {
  tsConsole.error('Error:', err);
  process.exit(1);
});
