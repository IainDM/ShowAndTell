import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import Anthropic from '@anthropic-ai/sdk';
import { writeFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

import { analyseContext } from './agents/contextAnalyser.js';
import { analyseActions } from './agents/actionAnalyser.js';
import { synthesiseSkill, convertToMcpTool } from './agents/skillSynthesiser.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

// Initialize Anthropic client
const anthropic = new Anthropic();

// Middleware
app.use(cors({ origin: true })); // Accept all origins for development
app.use(express.json({ limit: '5mb' }));

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', version: '0.1.0' });
});

/**
 * POST /api/process
 * Accepts { intent: string, events: array }
 * Returns { skill: string } with the generated SKILL.md
 */
app.post('/api/process', async (req, res) => {
  const { intent, events } = req.body;

  // Validate input
  if (!intent || typeof intent !== 'string') {
    return res.status(400).json({ error: 'intent is required and must be a string' });
  }
  if (!events || !Array.isArray(events) || events.length === 0) {
    return res.status(400).json({ error: 'events is required and must be a non-empty array' });
  }

  console.log(`Processing: "${intent}" (${events.length} events)`);

  try {
    // Run Agent 1 (Context) and Agent 2 (Action) in parallel
    console.log('Running context and action analysis in parallel...');
    const [contextAnalysis, actionAnalysis] = await Promise.all([
      analyseContext(anthropic, intent, events),
      analyseActions(anthropic, intent, events)
    ]);

    console.log('Context analysis complete:', JSON.stringify(contextAnalysis).substring(0, 200));
    console.log('Action analysis complete:', actionAnalysis.phases?.length || 0, 'phases identified');

    // Run Agent 3 (Skill Synthesiser) with outputs from 1 and 2
    console.log('Synthesising skill...');
    const skill = await synthesiseSkill(anthropic, intent, contextAnalysis, actionAnalysis);

    console.log('Skill generated:', skill.substring(0, 100), '...');

    // Save to output directory
    try {
      const outputDir = join(__dirname, 'output');
      await mkdir(outputDir, { recursive: true });
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `${timestamp}.skill.md`;
      await writeFile(join(outputDir, filename), skill);
      console.log(`Saved to output/${filename}`);
    } catch (writeErr) {
      console.warn('Failed to save output file:', writeErr.message);
    }

    res.json({ skill });
  } catch (err) {
    console.error('Processing error:', err);
    res.status(500).json({ error: err.message || 'Internal processing error' });
  }
});

/**
 * POST /api/export-mcp
 * Accepts { skill: string } (SKILL.md content)
 * Returns MCP tool definition JSON
 */
app.post('/api/export-mcp', async (req, res) => {
  const { skill } = req.body;

  if (!skill || typeof skill !== 'string') {
    return res.status(400).json({ error: 'skill is required and must be a string' });
  }

  try {
    const mcpTool = await convertToMcpTool(anthropic, skill);
    res.json(mcpTool);
  } catch (err) {
    console.error('MCP export error:', err);
    res.status(500).json({ error: err.message || 'Failed to generate MCP tool definition' });
  }
});

app.listen(PORT, () => {
  console.log(`Skill Recorder backend running on http://localhost:${PORT}`);
  console.log(`Anthropic API key: ${process.env.ANTHROPIC_API_KEY ? 'configured' : 'MISSING — set ANTHROPIC_API_KEY'}`);
});
