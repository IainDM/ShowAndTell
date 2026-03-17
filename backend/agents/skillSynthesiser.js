import { readFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

let systemPrompt = null;

async function getSystemPrompt() {
  if (!systemPrompt) {
    systemPrompt = await readFile(join(__dirname, '..', 'prompts', 'synthesise.txt'), 'utf-8');
  }
  return systemPrompt;
}

/**
 * Agent 3: Skill Synthesiser
 * Combines context analysis and action analysis into a structured SKILL.md document.
 */
export async function synthesiseSkill(client, intent, contextAnalysis, actionAnalysis) {
  const prompt = await getSystemPrompt();

  const userMessage = `Intent: ${intent}

Context Analysis:
${JSON.stringify(contextAnalysis, null, 2)}

Action Analysis:
${JSON.stringify(actionAnalysis, null, 2)}`;

  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 8192,
    temperature: 0,
    system: prompt,
    messages: [{ role: 'user', content: userMessage }]
  });

  return response.content[0]?.text || '';
}

/**
 * Convert a SKILL.md document into an MCP tool definition.
 */
export async function convertToMcpTool(client, skillMarkdown) {
  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 4096,
    temperature: 0,
    system: `You are a tool definition generator. Convert the given SKILL.md document into an MCP tool definition JSON object.

The output should follow this schema:
{
  "name": "snake_case_tool_name",
  "description": "What the tool does",
  "inputSchema": {
    "type": "object",
    "properties": {
      "param_name": {
        "type": "string",
        "description": "What this parameter is"
      }
    },
    "required": ["list", "of", "required", "params"]
  }
}

Extract parameters from the skill's Parameters section. Use the skill's Purpose as the description. Return ONLY valid JSON, no other text.`,
    messages: [{ role: 'user', content: skillMarkdown }]
  });

  const text = response.content[0]?.text || '';

  try {
    return JSON.parse(text);
  } catch {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    throw new Error('Failed to generate MCP tool definition');
  }
}
