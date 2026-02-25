#!/usr/bin/env node

/**
 * Comprehensive API Key Diagnostic
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

async function diagnoseAPIs(): Promise<void> {
  tsConsole.log('╔════════════════════════════════════════════════════════════════╗');
  tsConsole.log('║         SentinAI API Key Diagnostic Report                      ║');
  tsConsole.log('╚════════════════════════════════════════════════════════════════╝\n');

  const env = loadEnvLocal();

  // Show environment
  tsConsole.log('📋 Loaded Environment Variables:');
  tsConsole.log(`  QWEN_API_KEY: ${env.QWEN_API_KEY ? `${env.QWEN_API_KEY.slice(0, 10)}...${env.QWEN_API_KEY.slice(-4)}` : '❌ NOT SET'}`);
  tsConsole.log(`  OPENAI_API_KEY: ${env.OPENAI_API_KEY ? `${env.OPENAI_API_KEY.slice(0, 10)}...${env.OPENAI_API_KEY.slice(-4)}` : '❌ NOT SET'}`);
  tsConsole.log(`  ANTHROPIC_API_KEY: ${env.ANTHROPIC_API_KEY ? `${env.ANTHROPIC_API_KEY.slice(0, 10)}...${env.ANTHROPIC_API_KEY.slice(-4)}` : '❌ NOT SET'}`);
  tsConsole.log(`  AI_GATEWAY_URL: ${env.AI_GATEWAY_URL || '❌ NOT SET'}`);
  tsConsole.log('');

  // Test Gateway with Qwen
  tsConsole.log('🧪 Testing API Connectivity:');
  tsConsole.log('');

  const gatewayUrl = env.AI_GATEWAY_URL;
  const qwenKey = env.QWEN_API_KEY;
  const openaiKey = env.OPENAI_API_KEY;

  // Test Qwen through Gateway
  if (gatewayUrl && qwenKey) {
    tsConsole.log(`1️⃣ Testing Qwen through LiteLLM Gateway...`);
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
        tsConsole.log('   ✅ SUCCESS: Qwen through Gateway works!');
      } else {
        const data = await response.json() as any;
        tsConsole.log(`   ❌ FAILED (${response.status}): ${data.error?.message || JSON.stringify(data)}`);
      }
    } catch (err) {
      tsConsole.log(`   ❌ ERROR: ${err instanceof Error ? err.message : String(err)}`);
    }
  } else {
    tsConsole.log(`1️⃣ Testing Qwen through LiteLLM Gateway...`);
    tsConsole.log(`   ❌ SKIPPED: Missing AI_GATEWAY_URL or QWEN_API_KEY`);
  }

  tsConsole.log('');

  // Test OpenAI Direct
  if (openaiKey) {
    tsConsole.log(`2️⃣ Testing OpenAI Direct API...`);
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
        tsConsole.log('   ✅ SUCCESS: OpenAI API key is valid!');
      } else {
        const data = await response.json() as any;
        tsConsole.log(`   ❌ FAILED (${response.status}): ${data.error?.message || JSON.stringify(data)}`);
        if (response.status === 401) {
          tsConsole.log('   💡 Suggestion: OpenAI API key is invalid or expired');
          tsConsole.log('   💡 Get a new key from: https://platform.openai.com/account/api-keys');
        }
      }
    } catch (err) {
      tsConsole.log(`   ❌ ERROR: ${err instanceof Error ? err.message : String(err)}`);
    }
  } else {
    tsConsole.log(`2️⃣ Testing OpenAI Direct API...`);
    tsConsole.log(`   ⏭️  SKIPPED: OPENAI_API_KEY not set`);
  }

  tsConsole.log('');
  tsConsole.log('🔧 Recommendations:');
  tsConsole.log('');

  if (gatewayUrl && qwenKey) {
    tsConsole.log('✅ LiteLLM Gateway with Qwen is ready!');
    tsConsole.log('   Use: npm run benchmark:quick');
    tsConsole.log('');
  }

  if (!openaiKey || openaiKey.slice(0, 10) === 'sk-QcFOZdk') {
    tsConsole.log('⚠️  OpenAI API key issue:');
    tsConsole.log('   Current key: ' + (openaiKey ? 'INVALID' : 'NOT SET'));
    tsConsole.log('   Action: Get a valid key from https://platform.openai.com/account/api-keys');
    tsConsole.log('   Then: Update .env.local with the new key');
    tsConsole.log('');
  }

  tsConsole.log('📚 Documentation: docs/guide/MODEL_BENCHMARK_GUIDE.md');
  tsConsole.log('');
}

diagnoseAPIs().catch(err => {
  tsConsole.error('Error:', err);
  process.exit(1);
});
