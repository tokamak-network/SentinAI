#!/usr/bin/env npx ts-node

/**
 * SentinAI Model Benchmark Script
 *
 * Compare performance of multiple AI providers/models using real production prompts.
 *
 * Usage:
 *   npx tsx scripts/benchmark-models.ts [options]
 *
 * Options:
 *   --providers <list>    Comma-separated provider list (qwen,anthropic,openai,gemini)
 *   --prompts <list>      Comma-separated prompt list (see prompts.ts for IDs)
 *   --iterations <num>    Number of iterations per config (default: 3)
 *   --output <dir>        Output directory for CSV/Markdown (default: ./benchmark-results)
 *   --help                Show this help message
 *
 * Examples:
 *   npx tsx scripts/benchmark-models.ts
 *   npx tsx scripts/benchmark-models.ts --providers qwen,anthropic --iterations 1
 *   npx tsx scripts/benchmark-models.ts --prompts predictive-scaler,anomaly-analyzer
 */

import path from 'path';
import * as fs from 'fs';
import type { AIProvider } from '@/lib/ai-client';

/**
 * Load environment variables from .env.local
 */
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

// Load environment variables
loadEnvLocal();
import { runAllBenchmarks, aggregateResults } from './benchmark/runner';
import { printResults } from './benchmark/runner';
import { generateCSVReport, generateMarkdownReport } from './benchmark/reporter';
import { BENCHMARK_PROMPTS } from './benchmark/prompts';
import { TEST_MODELS_QWEN_VS_GPT, BENCHMARK_PRESETS, getModel, getPresetModels } from './benchmark/models-config';

/**
 * Parse command-line arguments
 */
function parseArgs(): {
  providers?: AIProvider[];
  modelIds?: string[];
  preset?: keyof typeof BENCHMARK_PRESETS;
  iterations: number;
  outputDir: string;
  showHelp: boolean;
  listModels: boolean;
} {
  const args = process.argv.slice(2);
  const result = {
    providers: undefined as AIProvider[] | undefined,
    modelIds: undefined as string[] | undefined,
    preset: undefined as keyof typeof BENCHMARK_PRESETS | undefined,
    iterations: 3,
    outputDir: 'benchmark-results',
    showHelp: false,
    listModels: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--help') {
      result.showHelp = true;
      break;
    }

    if (arg === '--list-models' || arg === '--list') {
      result.listModels = true;
      break;
    }

    if (arg === '--preset' && i + 1 < args.length) {
      const presetName = args[i + 1] as keyof typeof BENCHMARK_PRESETS;
      if (presetName in BENCHMARK_PRESETS) {
        result.preset = presetName;
      } else {
        console.error(`❌ Unknown preset: ${presetName}`);
        process.exit(1);
      }
      i++;
    }

    if (arg === '--models' && i + 1 < args.length) {
      result.modelIds = args[i + 1]
        .split(',')
        .map(m => m.trim());
      i++;
    }

    if (arg === '--providers' && i + 1 < args.length) {
      result.providers = args[i + 1]
        .split(',')
        .map(p => p.trim() as AIProvider);
      i++;
    }

    if (arg === '--iterations' && i + 1 < args.length) {
      result.iterations = parseInt(args[i + 1], 10);
      i++;
    }

    if (arg === '--output' && i + 1 < args.length) {
      result.outputDir = args[i + 1];
      i++;
    }
  }

  return result;
}

/**
 * Check environment variables
 */
function checkEnvironment(): {
  hasQwen: boolean;
  hasAnthropic: boolean;
  hasOpenAI: boolean;
  hasGemini: boolean;
} {
  return {
    hasQwen: !!process.env.QWEN_API_KEY,
    hasAnthropic: !!process.env.ANTHROPIC_API_KEY,
    hasOpenAI: !!process.env.OPENAI_API_KEY,
    hasGemini: !!process.env.GEMINI_API_KEY,
  };
}

/**
 * List supported models and their pricing
 */
function listModels(): void {
  const models: Record<string, { fast: string; best: string; pricing: string }> = {
    qwen: {
      fast: 'qwen-turbo-latest',
      best: 'qwen-max-latest',
      pricing: 'Input: $0.50/M, Output: $0.50/M (fast) | Input: $2.00/M, Output: $2.00/M (best)',
    },
    anthropic: {
      fast: 'claude-haiku-4-5-20251001',
      best: 'claude-sonnet-4-5-20250929',
      pricing: 'Input: $0.80/M, Output: $0.15/M (fast) | Input: $3.00/M, Output: $15.00/M (best)',
    },
    openai: {
      fast: 'gpt-4.1-mini ⚠️',
      best: 'gpt-4.1 ⚠️',
      pricing: 'Input: $0.15/M, Output: $0.60/M (fast) | Input: $30.00/M, Output: $60.00/M (best)',
    },
    gemini: {
      fast: 'gemini-2.5-flash-lite',
      best: 'gemini-2.5-pro',
      pricing: 'Input: $0.075/M, Output: $0.30/M (fast) | Input: $1.50/M, Output: $6.00/M (best)',
    },
  };

  console.log(`
╔════════════════════════════════════════════════════════════════╗
║       SentinAI Model Benchmark - Supported Models             ║
╚════════════════════════════════════════════════════════════════╝

🟢 QWEN (Alibaba)
  Fast:  ${models.qwen.fast}
  Best:  ${models.qwen.best}
  Price: ${models.qwen.pricing}
  Env:   QWEN_API_KEY, QWEN_BASE_URL (optional), QWEN_MODEL (optional)

🔵 ANTHROPIC (Claude)
  Fast:  ${models.anthropic.fast}
  Best:  ${models.anthropic.best}
  Price: ${models.anthropic.pricing}
  Env:   ANTHROPIC_API_KEY

🟡 OPENAI (GPT) ⚠️  Model names may need verification
  Fast:  ${models.openai.fast}
  Best:  ${models.openai.best}
  Price: ${models.openai.pricing}
  Env:   OPENAI_API_KEY, OPENAI_BASE_URL (optional), OPENAI_MODEL_FAST/BEST (optional)

🟣 GEMINI (Google)
  Fast:  ${models.gemini.fast}
  Best:  ${models.gemini.best}
  Price: ${models.gemini.pricing}
  Env:   GEMINI_API_KEY

Pricing: Per 1 million tokens (2026-02 rates)

Note: Use environment variables to override default models:
  export OPENAI_MODEL=gpt-4-turbo
  export OPENAI_MODEL_FAST=gpt-3.5-turbo
  export OPENAI_MODEL_BEST=gpt-4o

See docs/guide/MODEL_BENCHMARK_GUIDE.md for detailed information.
  `);
}

/**
 * Show help message
 */
function showHelp(): void {
  const presetList = Object.entries(BENCHMARK_PRESETS)
    .map(([name, config]) => `  ${name}: ${config.description}`)
    .join('\n');

  console.log(`
SentinAI Model Benchmark Script

Compare performance of multiple AI models using real production prompts.

Usage:
  npx tsx scripts/benchmark-models.ts [options]

Options:
  --preset <name>       Use preset model configuration
                        Available: quick, standard, comprehensive, cost-focused, quality-focused
  --models <list>       Comma-separated model IDs to test
  --iterations <num>    Number of iterations per model (default: 3)
  --output <dir>        Output directory for CSV/Markdown (default: ./benchmark-results)
  --list-models         List supported models and pricing information
  --help                Show this help message

Examples:
  # Show supported models
  npx tsx scripts/benchmark-models.ts --list-models

  # Run standard preset (6 models × 2 iterations)
  npx tsx scripts/benchmark-models.ts --preset standard

  # Test specific models with 1 iteration
  npx tsx scripts/benchmark-models.ts --models qwen-turbo,gpt-4o,gpt-4o-mini --iterations 1

  # Run quick preset for cost-effective testing
  npx tsx scripts/benchmark-models.ts --preset quick

  # Save results to custom directory
  npx tsx scripts/benchmark-models.ts --preset comprehensive --output ./my-results

Presets:
${presetList}

Prompts included:
${BENCHMARK_PROMPTS.map(p => `  - ${p.id} (${p.tier} tier): ${p.description}`).join('\n')}

Environment variables required:
  At least one of:
    QWEN_API_KEY
    ANTHROPIC_API_KEY
    OPENAI_API_KEY
    GEMINI_API_KEY
  `);
}

/**
 * Main entry point
 */
async function main(): Promise<void> {
  const options = parseArgs();

  if (options.showHelp) {
    showHelp();
    process.exit(0);
  }

  if (options.listModels) {
    listModels();
    process.exit(0);
  }

  // Check environment
  const env = checkEnvironment();
  const availableProviders = Object.entries(env)
    .filter(([, has]) => has)
    .map(([name]) => name.slice(3).toLowerCase()) as AIProvider[];

  if (availableProviders.length === 0) {
    console.error(
      '❌ No AI API keys found. Please set at least one of:\n' +
      '  QWEN_API_KEY\n' +
      '  ANTHROPIC_API_KEY\n' +
      '  OPENAI_API_KEY\n' +
      '  GEMINI_API_KEY\n'
    );
    process.exit(1);
  }

  // Determine which models to test
  let modelsToTest;

  if (options.preset) {
    // Use preset configuration
    modelsToTest = getPresetModels(options.preset);
    console.log(`📋 Using preset: ${options.preset}`);
    console.log(`📊 Models: ${modelsToTest.map(m => m.id).join(', ')}`);
    const iterations = BENCHMARK_PRESETS[options.preset].iterations;
    options.iterations = iterations;
    console.log(`🔁 Iterations (from preset): ${iterations}`);
  } else if (options.modelIds && options.modelIds.length > 0) {
    // Use manually specified models
    const modelsMap = new Map<string, any>();
    TEST_MODELS_QWEN_VS_GPT.forEach(m => modelsMap.set(m.id, m));

    modelsToTest = options.modelIds
      .map(id => {
        const model = getModel(id);
        if (!model) {
          console.error(`❌ Unknown model: ${id}`);
          process.exit(1);
        }
        return model;
      });

    console.log(`🎯 Testing specified models: ${options.modelIds.join(', ')}`);
  } else {
    // Default: use standard preset
    modelsToTest = getPresetModels('standard');
    console.log(`📋 No preset/models specified, using standard preset`);
    console.log(`📊 Models: ${modelsToTest.map(m => m.id).join(', ')}`);
  }

  if (modelsToTest.length === 0) {
    console.error('❌ No models to test');
    process.exit(1);
  }

  console.log(`📄 Prompts: ${BENCHMARK_PROMPTS.map(p => p.id).join(', ')}`);
  console.log(`🔁 Iterations: ${options.iterations}\n`);

  // Run benchmarks
  const results = await runAllBenchmarks({
    models: modelsToTest,
    iterations: options.iterations,
    timeoutFast: 30000,
    timeoutBest: 60000,
  });

  // Aggregate results
  const aggregated = aggregateResults(results);

  // Print results
  printResults(results, aggregated);

  // Generate reports
  console.log(`📝 Generating reports...`);
  const csvPath = await generateCSVReport(results, options.outputDir);
  const mdPath = await generateMarkdownReport(
    results,
    aggregated,
    options.outputDir
  );

  console.log(`✅ Reports generated:`);
  console.log(`   CSV: ${path.relative(process.cwd(), csvPath)}`);
  console.log(`   Markdown: ${path.relative(process.cwd(), mdPath)}\n`);

  process.exit(0);
}

// Run
main().catch(err => {
  console.error('❌ Benchmark error:', err);
  process.exit(1);
});
