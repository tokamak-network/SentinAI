#!/usr/bin/env node

/**
 * Test OpenAI API Key and List Available Models
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

async function testOpenAIKey(): Promise<void> {
  loadEnvLocal();

  const apiKey = process.env.OPENAI_API_KEY;
  const gatewayUrl = process.env.AI_GATEWAY_URL;

  console.log('🔍 OpenAI API Key Test\n');
  console.log(`API Key: ${apiKey ? `${apiKey.slice(0, 10)}...${apiKey.slice(-4)}` : 'NOT SET'}`);
  console.log(`Gateway URL: ${gatewayUrl || 'NOT SET'}\n`);

  if (!apiKey) {
    console.error('❌ OPENAI_API_KEY is not set in .env.local');
    process.exit(1);
  }

  try {
    // Test with gpt-4-turbo
    console.log('Testing gpt-4-turbo...');
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
      console.error(`❌ API Error (${response.status}):`, data.error?.message || data);
      console.error('\nPossible reasons:');
      console.error('1. Invalid or expired API key');
      console.error('2. Account has no access to GPT-4 models');
      console.error('3. Rate limit exceeded');
      console.error('4. Model name is incorrect');
      process.exit(1);
    }

    console.log('✅ gpt-4-turbo works!');
    console.log(`Response: ${data.choices?.[0]?.message?.content || 'No response'}`);
    console.log(`Tokens used: ${data.usage?.prompt_tokens || 0} prompt, ${data.usage?.completion_tokens || 0} completion\n`);

    // Test with gpt-4o
    console.log('Testing gpt-4o...');
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
      console.error(`❌ API Error (${response2.status}):`, data2.error?.message || data2);
      process.exit(1);
    }

    console.log('✅ gpt-4o works!');
    console.log(`Response: ${data2.choices?.[0]?.message?.content || 'No response'}`);
    console.log(`Tokens used: ${data2.usage?.prompt_tokens || 0} prompt, ${data2.usage?.completion_tokens || 0} completion\n`);

  } catch (err) {
    console.error('❌ Error:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

testOpenAIKey();
