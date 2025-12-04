// Run playbook command
// Executes a playbook and streams events to stdout

import { getSessionById, resolveAgentId } from '../services/storage';
import { getPlaybook, resolvePlaybookId } from '../services/playbooks';
import { runPlaybook as executePlaybook } from '../services/batch-processor';
import { detectClaude } from '../services/agent-spawner';
import { emitError } from '../output/jsonl';
import { formatRunEvent, formatError, formatInfo, RunEvent } from '../output/formatter';

interface RunPlaybookOptions {
  agent: string;
  playbook: string;
  dryRun?: boolean;
  history?: boolean; // commander uses --no-history which becomes history: false
  json?: boolean;
}

export async function runPlaybook(options: RunPlaybookOptions): Promise<void> {
  const useJson = options.json;

  try {
    // Check if Claude is available
    const claude = await detectClaude();
    if (!claude.available) {
      if (useJson) {
        emitError('Claude Code not found. Please install claude-code CLI.', 'CLAUDE_NOT_FOUND');
      } else {
        console.error(formatError('Claude Code not found. Please install claude-code CLI.'));
      }
      process.exit(1);
    }

    // Resolve agent ID (supports partial IDs)
    let agentId: string;
    try {
      agentId = resolveAgentId(options.agent);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      if (useJson) {
        emitError(message, 'AGENT_NOT_FOUND');
      } else {
        console.error(formatError(message));
      }
      process.exit(1);
    }

    const agent = getSessionById(agentId)!;

    // Resolve playbook ID (supports partial IDs)
    let playbookId: string;
    try {
      playbookId = resolvePlaybookId(agentId, options.playbook);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      if (useJson) {
        emitError(message, 'PLAYBOOK_NOT_FOUND');
      } else {
        console.error(formatError(message));
      }
      process.exit(1);
    }

    const playbook = getPlaybook(agentId, playbookId)!;

    // Determine Auto Run folder path
    const folderPath = agent.autoRunFolderPath;
    if (!folderPath) {
      if (useJson) {
        emitError('Agent does not have an Auto Run folder configured', 'NO_AUTORUN_FOLDER');
      } else {
        console.error(formatError('Agent does not have an Auto Run folder configured'));
      }
      process.exit(1);
    }

    // Show startup info in human-readable mode
    if (!useJson) {
      console.log(formatInfo(`Running playbook: ${playbook.name}`));
      console.log(formatInfo(`Agent: ${agent.name}`));
      console.log(formatInfo(`Documents: ${playbook.documents.length}`));
      if (options.dryRun) {
        console.log(formatInfo('Dry run mode - no changes will be made'));
      }
      console.log('');
    }

    // Execute playbook and stream events
    const generator = executePlaybook(agent, playbook, folderPath, {
      dryRun: options.dryRun,
      writeHistory: options.history !== false, // --no-history sets history to false
    });

    for await (const event of generator) {
      if (useJson) {
        console.log(JSON.stringify(event));
      } else {
        console.log(formatRunEvent(event as RunEvent));
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    if (useJson) {
      emitError(`Failed to run playbook: ${message}`, 'EXECUTION_ERROR');
    } else {
      console.error(formatError(`Failed to run playbook: ${message}`));
    }
    process.exit(1);
  }
}
