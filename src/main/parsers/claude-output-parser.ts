/**
 * Claude Code Output Parser
 *
 * Parses stream-json output from Claude Code CLI.
 * Claude Code outputs JSONL (JSON Lines) with different message types:
 * - system/init: Session initialization with slash commands
 * - assistant: Streaming text content (partial responses)
 * - result: Final complete response
 * - Messages may include session_id, modelUsage, usage, total_cost_usd
 *
 * @see https://github.com/anthropics/claude-code
 */

import type { ToolType } from '../../shared/types';
import type { AgentOutputParser, ParsedEvent } from './agent-output-parser';
import { aggregateModelUsage, type ModelStats } from './usage-aggregator';

/**
 * Raw message structure from Claude Code stream-json output
 */
interface ClaudeRawMessage {
  type: string;
  subtype?: string;
  session_id?: string;
  result?: string;
  message?: {
    role?: string;
    content?: string | Array<{ type: string; text?: string }>;
  };
  slash_commands?: string[];
  modelUsage?: Record<string, ModelStats>;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
  total_cost_usd?: number;
}

/**
 * Claude Code Output Parser Implementation
 *
 * Transforms Claude Code's stream-json format into normalized ParsedEvents.
 */
export class ClaudeOutputParser implements AgentOutputParser {
  readonly agentId: ToolType = 'claude-code';

  /**
   * Parse a single JSON line from Claude Code output
   *
   * Claude Code message types:
   * - { type: 'system', subtype: 'init', session_id, slash_commands }
   * - { type: 'assistant', message: { role, content } }
   * - { type: 'result', result: string, session_id, modelUsage, usage, total_cost_usd }
   */
  parseJsonLine(line: string): ParsedEvent | null {
    if (!line.trim()) {
      return null;
    }

    try {
      const msg: ClaudeRawMessage = JSON.parse(line);
      return this.transformMessage(msg);
    } catch {
      // Not valid JSON - return as raw text event
      return {
        type: 'text',
        text: line,
        raw: line,
      };
    }
  }

  /**
   * Transform a parsed Claude message into a normalized ParsedEvent
   */
  private transformMessage(msg: ClaudeRawMessage): ParsedEvent {
    // Handle system/init messages
    if (msg.type === 'system' && msg.subtype === 'init') {
      return {
        type: 'init',
        sessionId: msg.session_id,
        slashCommands: msg.slash_commands,
        raw: msg,
      };
    }

    // Handle result messages (final complete response)
    if (msg.type === 'result') {
      const event: ParsedEvent = {
        type: 'result',
        text: msg.result,
        sessionId: msg.session_id,
        raw: msg,
      };

      // Extract usage stats if present
      const usage = this.extractUsageFromRaw(msg);
      if (usage) {
        event.usage = usage;
      }

      return event;
    }

    // Handle assistant messages (streaming partial responses)
    if (msg.type === 'assistant') {
      const text = this.extractTextFromMessage(msg);
      return {
        type: 'text',
        text,
        sessionId: msg.session_id,
        isPartial: true,
        raw: msg,
      };
    }

    // Handle messages with only usage stats (no content type)
    if (msg.modelUsage || msg.usage || msg.total_cost_usd !== undefined) {
      const usage = this.extractUsageFromRaw(msg);
      return {
        type: 'usage',
        sessionId: msg.session_id,
        usage: usage || undefined,
        raw: msg,
      };
    }

    // Handle system messages (other subtypes)
    if (msg.type === 'system') {
      return {
        type: 'system',
        sessionId: msg.session_id,
        raw: msg,
      };
    }

    // Default: preserve as system event
    return {
      type: 'system',
      sessionId: msg.session_id,
      raw: msg,
    };
  }

  /**
   * Extract text content from a Claude assistant message
   */
  private extractTextFromMessage(msg: ClaudeRawMessage): string {
    if (!msg.message?.content) {
      return '';
    }

    // Content can be string or array of content blocks
    if (typeof msg.message.content === 'string') {
      return msg.message.content;
    }

    // Array of content blocks - extract text from text blocks
    return msg.message.content
      .filter((block) => block.type === 'text' && block.text)
      .map((block) => block.text!)
      .join('');
  }

  /**
   * Extract usage statistics from raw Claude message
   */
  private extractUsageFromRaw(msg: ClaudeRawMessage): ParsedEvent['usage'] | null {
    if (!msg.modelUsage && !msg.usage && msg.total_cost_usd === undefined) {
      return null;
    }

    // Use the aggregateModelUsage helper from process-manager
    const aggregated = aggregateModelUsage(
      msg.modelUsage,
      msg.usage || {},
      msg.total_cost_usd || 0
    );

    return {
      inputTokens: aggregated.inputTokens,
      outputTokens: aggregated.outputTokens,
      cacheReadTokens: aggregated.cacheReadInputTokens,
      cacheCreationTokens: aggregated.cacheCreationInputTokens,
      contextWindow: aggregated.contextWindow,
      costUsd: aggregated.totalCostUsd,
    };
  }

  /**
   * Check if an event is a final result message
   */
  isResultMessage(event: ParsedEvent): boolean {
    return event.type === 'result';
  }

  /**
   * Extract session ID from an event
   */
  extractSessionId(event: ParsedEvent): string | null {
    return event.sessionId || null;
  }

  /**
   * Extract usage statistics from an event
   */
  extractUsage(event: ParsedEvent): ParsedEvent['usage'] | null {
    return event.usage || null;
  }

  /**
   * Extract slash commands from an event
   */
  extractSlashCommands(event: ParsedEvent): string[] | null {
    return event.slashCommands || null;
  }
}
