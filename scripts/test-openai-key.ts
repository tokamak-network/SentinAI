#!/usr/bin/env node

/**
 * Test OpenAI API Key and List Available Models
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

async function testOpenAIKey(): Promise<void> {
  loadEnvLocal();

  const apiKey = process.env.OPENAI_API_KEY;
  const gatewayUrl = process.env.AI_GATEWAY_URL;

  tsConsole.log('🔍 OpenAI API Key Test\n');
  tsConsole.log(`API Key: ${apiKey ? `${apiKey.slice(0, 10)}...${apiKey.slice(-4)}` : 'NOT SET'}`);
  tsConsole.log(`Gateway URL: ${gatewayUrl || 'NOT SET'}\n`);

  if (!apiKey) {
    tsConsole.error('❌ OPENAI_API_KEY is not set in .env.local');
    process.exit(1);
  }

  try {
    // Test with gpt-4-turbo
    tsConsole.log('Testing gpt-4-turbo...');
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4-turbo',
        messages: [
          {
            role: 'user',
            content: 'Hello',
          },
        ],
        max_tokens: 10,
      }),
    });

    const data = await response.json() as any;

    if (!response.ok) {
      tsConsole.error(`❌ API Error (${response.status}):`, data.error?.message || data);
      tsConsole.error('\nPossible reasons:');
      tsConsole.error('1. Invalid or expired API key');
      tsConsole.error('2. Account has no access to GPT-4 models');
      tsConsole.error('3. Rate limit exceeded');
      tsConsole.error('4. Model name is incorrect');
      process.exit(1);
    }

    tsConsole.log('✅ gpt-4-turbo works!');
    tsConsole.log(`Response: ${data.choices?.[0]?.message?.content || 'No response'}`);
    tsConsole.log(`Tokens used: ${data.usage?.prompt_tokens || 0} prompt, ${data.usage?.completion_tokens || 0} completion\n`);

    // Test with gpt-4o
    tsConsole.log('Testing gpt-4o...');
    const response2 = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [
          {
            role: 'user',
            content: 'Hello',
          },
        ],
        max_tokens: 10,
      }),
    });

    const data2 = await response2.json() as any;

    if (!response2.ok) {
      tsConsole.error(`❌ API Error (${response2.status}):`, data2.error?.message || data2);
      process.exit(1);
    }

    tsConsole.log('✅ gpt-4o works!');
    tsConsole.log(`Response: ${data2.choices?.[0]?.message?.content || 'No response'}`);
    tsConsole.log(`Tokens used: ${data2.usage?.prompt_tokens || 0} prompt, ${data2.usage?.completion_tokens || 0} completion\n`);

  } catch (err) {
    tsConsole.error('❌ Error:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

testOpenAIKey();
