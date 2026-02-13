#!/usr/bin/env node

/**
 * Comprehensive API Key Diagnostic
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

async function diagnoseAPIs(): Promise<void> {
  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║         SentinAI API Key Diagnostic Report                      ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');

  const env = loadEnvLocal();

  // Show environment
  console.log('📋 Loaded Environment Variables:');
  console.log(`  QWEN_API_KEY: ${env.QWEN_API_KEY ? `${env.QWEN_API_KEY.slice(0, 10)}...${env.QWEN_API_KEY.slice(-4)}` : '❌ NOT SET'}`);
  console.log(`  OPENAI_API_KEY: ${env.OPENAI_API_KEY ? `${env.OPENAI_API_KEY.slice(0, 10)}...${env.OPENAI_API_KEY.slice(-4)}` : '❌ NOT SET'}`);
  console.log(`  ANTHROPIC_API_KEY: ${env.ANTHROPIC_API_KEY ? `${env.ANTHROPIC_API_KEY.slice(0, 10)}...${env.ANTHROPIC_API_KEY.slice(-4)}` : '❌ NOT SET'}`);
  console.log(`  AI_GATEWAY_URL: ${env.AI_GATEWAY_URL || '❌ NOT SET'}`);
  console.log('');

  // Test Gateway with Qwen
  console.log('🧪 Testing API Connectivity:');
  console.log('');

  const gatewayUrl = env.AI_GATEWAY_URL;
  const qwenKey = env.QWEN_API_KEY;
  const openaiKey = env.OPENAI_API_KEY;

  // Test Qwen through Gateway
  if (gatewayUrl && qwenKey) {
    console.log(`1️⃣ Testing Qwen through LiteLLM Gateway...`);
    try {
      const response = await fetch(`${gatewayUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${qwenKey}`,
        },
        body: JSON.stringify({
          model: 'qwen3-coder-flash',
          messages: [{ role: 'user', content: 'hello' }],
          max_tokens: 5,
        }),
      });

      if (response.ok) {
        console.log('   ✅ SUCCESS: Qwen through Gateway works!');
      } else {
        const data = await response.json() as any;
        console.log(`   ❌ FAILED (${response.status}): ${data.error?.message || JSON.stringify(data)}`);
      }
    } catch (err) {
      console.log(`   ❌ ERROR: ${err instanceof Error ? err.message : String(err)}`);
    }
  } else {
    console.log(`1️⃣ Testing Qwen through LiteLLM Gateway...`);
    console.log(`   ❌ SKIPPED: Missing AI_GATEWAY_URL or QWEN_API_KEY`);
  }

  console.log('');

  // Test OpenAI Direct
  if (openaiKey) {
    console.log(`2️⃣ Testing OpenAI Direct API...`);
    try {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${openaiKey}`,
        },
        body: JSON.stringify({
          model: 'gpt-4-turbo',
          messages: [{ role: 'user', content: 'hello' }],
          max_tokens: 5,
        }),
      });

      if (response.ok) {
        console.log('   ✅ SUCCESS: OpenAI API key is valid!');
      } else {
        const data = await response.json() as any;
        console.log(`   ❌ FAILED (${response.status}): ${data.error?.message || JSON.stringify(data)}`);
        if (response.status === 401) {
          console.log('   💡 Suggestion: OpenAI API key is invalid or expired');
          console.log('   💡 Get a new key from: https://platform.openai.com/account/api-keys');
        }
      }
    } catch (err) {
      console.log(`   ❌ ERROR: ${err instanceof Error ? err.message : String(err)}`);
    }
  } else {
    console.log(`2️⃣ Testing OpenAI Direct API...`);
    console.log(`   ⏭️  SKIPPED: OPENAI_API_KEY not set`);
  }

  console.log('');
  console.log('🔧 Recommendations:');
  console.log('');

  if (gatewayUrl && qwenKey) {
    console.log('✅ LiteLLM Gateway with Qwen is ready!');
    console.log('   Use: npm run benchmark:quick');
    console.log('');
  }

  if (!openaiKey || openaiKey.slice(0, 10) === 'sk-QcFOZdk') {
    console.log('⚠️  OpenAI API key issue:');
    console.log('   Current key: ' + (openaiKey ? 'INVALID' : 'NOT SET'));
    console.log('   Action: Get a valid key from https://platform.openai.com/account/api-keys');
    console.log('   Then: Update .env.local with the new key');
    console.log('');
  }

  console.log('📚 Documentation: docs/guide/MODEL_BENCHMARK_GUIDE.md');
  console.log('');
}

diagnoseAPIs().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
