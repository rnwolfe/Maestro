import { describe, it, expect } from 'vitest';
import { ClaudeOutputParser } from '../../../main/parsers/claude-output-parser';

describe('ClaudeOutputParser', () => {
  const parser = new ClaudeOutputParser();

  describe('agentId', () => {
    it('should be claude-code', () => {
      expect(parser.agentId).toBe('claude-code');
    });
  });

  describe('parseJsonLine', () => {
    it('should return null for empty lines', () => {
      expect(parser.parseJsonLine('')).toBeNull();
      expect(parser.parseJsonLine('  ')).toBeNull();
      expect(parser.parseJsonLine('\n')).toBeNull();
    });

    it('should parse system init messages', () => {
      const line = JSON.stringify({
        type: 'system',
        subtype: 'init',
        session_id: 'sess-abc123',
        slash_commands: ['/help', '/compact', '/clear'],
      });

      const event = parser.parseJsonLine(line);
      expect(event).not.toBeNull();
      expect(event?.type).toBe('init');
      expect(event?.sessionId).toBe('sess-abc123');
      expect(event?.slashCommands).toEqual(['/help', '/compact', '/clear']);
    });

    it('should parse result messages', () => {
      const line = JSON.stringify({
        type: 'result',
        result: 'Here is the answer to your question.',
        session_id: 'sess-abc123',
        modelUsage: {
          'claude-3-sonnet': {
            inputTokens: 1000,
            outputTokens: 500,
            cacheReadInputTokens: 200,
            cacheCreationInputTokens: 100,
            contextWindow: 200000,
          },
        },
        total_cost_usd: 0.05,
      });

      const event = parser.parseJsonLine(line);
      expect(event).not.toBeNull();
      expect(event?.type).toBe('result');
      expect(event?.text).toBe('Here is the answer to your question.');
      expect(event?.sessionId).toBe('sess-abc123');
      expect(event?.usage).toBeDefined();
      expect(event?.usage?.inputTokens).toBe(1000);
      expect(event?.usage?.outputTokens).toBe(500);
      expect(event?.usage?.costUsd).toBe(0.05);
    });

    it('should parse assistant messages as partial text', () => {
      const line = JSON.stringify({
        type: 'assistant',
        session_id: 'sess-abc123',
        message: {
          role: 'assistant',
          content: 'Partial response...',
        },
      });

      const event = parser.parseJsonLine(line);
      expect(event).not.toBeNull();
      expect(event?.type).toBe('text');
      expect(event?.text).toBe('Partial response...');
      expect(event?.sessionId).toBe('sess-abc123');
      expect(event?.isPartial).toBe(true);
    });

    it('should handle assistant messages with content array', () => {
      const line = JSON.stringify({
        type: 'assistant',
        session_id: 'sess-abc123',
        message: {
          role: 'assistant',
          content: [
            { type: 'text', text: 'First part.' },
            { type: 'text', text: ' Second part.' },
          ],
        },
      });

      const event = parser.parseJsonLine(line);
      expect(event).not.toBeNull();
      expect(event?.type).toBe('text');
      expect(event?.text).toBe('First part. Second part.');
    });

    it('should handle messages with only usage stats', () => {
      const line = JSON.stringify({
        session_id: 'sess-abc123',
        modelUsage: {
          'claude-3-sonnet': {
            inputTokens: 500,
            outputTokens: 200,
          },
        },
        total_cost_usd: 0.02,
      });

      const event = parser.parseJsonLine(line);
      expect(event).not.toBeNull();
      expect(event?.type).toBe('usage');
      expect(event?.usage?.inputTokens).toBe(500);
      expect(event?.usage?.outputTokens).toBe(200);
      expect(event?.usage?.costUsd).toBe(0.02);
    });

    it('should handle system messages without init subtype', () => {
      const line = JSON.stringify({
        type: 'system',
        session_id: 'sess-abc123',
      });

      const event = parser.parseJsonLine(line);
      expect(event).not.toBeNull();
      expect(event?.type).toBe('system');
      expect(event?.sessionId).toBe('sess-abc123');
    });

    it('should handle invalid JSON as text', () => {
      const event = parser.parseJsonLine('not valid json');
      expect(event).not.toBeNull();
      expect(event?.type).toBe('text');
      expect(event?.text).toBe('not valid json');
    });

    it('should preserve raw message', () => {
      const original = {
        type: 'result',
        result: 'Test',
        session_id: 'sess-123',
      };
      const line = JSON.stringify(original);

      const event = parser.parseJsonLine(line);
      expect(event?.raw).toEqual(original);
    });
  });

  describe('isResultMessage', () => {
    it('should return true for result events', () => {
      const resultEvent = parser.parseJsonLine(
        JSON.stringify({ type: 'result', result: 'test' })
      );
      expect(resultEvent).not.toBeNull();
      expect(parser.isResultMessage(resultEvent!)).toBe(true);
    });

    it('should return false for non-result events', () => {
      const initEvent = parser.parseJsonLine(
        JSON.stringify({ type: 'system', subtype: 'init' })
      );
      expect(initEvent).not.toBeNull();
      expect(parser.isResultMessage(initEvent!)).toBe(false);

      const textEvent = parser.parseJsonLine(
        JSON.stringify({ type: 'assistant', message: { content: 'hi' } })
      );
      expect(textEvent).not.toBeNull();
      expect(parser.isResultMessage(textEvent!)).toBe(false);
    });
  });

  describe('extractSessionId', () => {
    it('should extract session ID from init message', () => {
      const event = parser.parseJsonLine(
        JSON.stringify({ type: 'system', subtype: 'init', session_id: 'sess-xyz' })
      );
      expect(parser.extractSessionId(event!)).toBe('sess-xyz');
    });

    it('should extract session ID from result message', () => {
      const event = parser.parseJsonLine(
        JSON.stringify({ type: 'result', result: 'test', session_id: 'sess-123' })
      );
      expect(parser.extractSessionId(event!)).toBe('sess-123');
    });

    it('should return null when no session ID', () => {
      const event = parser.parseJsonLine(JSON.stringify({ type: 'system', subtype: 'init' }));
      expect(parser.extractSessionId(event!)).toBeNull();
    });
  });

  describe('extractUsage', () => {
    it('should extract usage from result message with modelUsage', () => {
      const event = parser.parseJsonLine(
        JSON.stringify({
          type: 'result',
          result: 'test',
          modelUsage: {
            'claude-3-sonnet': {
              inputTokens: 100,
              outputTokens: 50,
              cacheReadInputTokens: 20,
              cacheCreationInputTokens: 10,
              contextWindow: 200000,
            },
          },
          total_cost_usd: 0.01,
        })
      );

      const usage = parser.extractUsage(event!);
      expect(usage).not.toBeNull();
      expect(usage?.inputTokens).toBe(100);
      expect(usage?.outputTokens).toBe(50);
      expect(usage?.cacheReadTokens).toBe(20);
      expect(usage?.cacheCreationTokens).toBe(10);
      expect(usage?.contextWindow).toBe(200000);
      expect(usage?.costUsd).toBe(0.01);
    });

    it('should extract usage with fallback to top-level usage', () => {
      const event = parser.parseJsonLine(
        JSON.stringify({
          type: 'result',
          result: 'test',
          usage: {
            input_tokens: 100,
            output_tokens: 50,
          },
          total_cost_usd: 0.01,
        })
      );

      const usage = parser.extractUsage(event!);
      expect(usage).not.toBeNull();
      expect(usage?.inputTokens).toBe(100);
      expect(usage?.outputTokens).toBe(50);
    });

    it('should return null when no usage stats', () => {
      const event = parser.parseJsonLine(
        JSON.stringify({ type: 'system', subtype: 'init' })
      );
      expect(parser.extractUsage(event!)).toBeNull();
    });

    it('should aggregate usage from multiple models', () => {
      const event = parser.parseJsonLine(
        JSON.stringify({
          type: 'result',
          result: 'test',
          modelUsage: {
            'claude-3-sonnet': {
              inputTokens: 100,
              outputTokens: 50,
            },
            'claude-3-haiku': {
              inputTokens: 200,
              outputTokens: 100,
            },
          },
        })
      );

      const usage = parser.extractUsage(event!);
      expect(usage?.inputTokens).toBe(300);
      expect(usage?.outputTokens).toBe(150);
    });
  });

  describe('extractSlashCommands', () => {
    it('should extract slash commands from init message', () => {
      const event = parser.parseJsonLine(
        JSON.stringify({
          type: 'system',
          subtype: 'init',
          slash_commands: ['/help', '/compact', '/clear', '/exit'],
        })
      );

      const commands = parser.extractSlashCommands(event!);
      expect(commands).toEqual(['/help', '/compact', '/clear', '/exit']);
    });

    it('should return null when no slash commands', () => {
      const event = parser.parseJsonLine(
        JSON.stringify({ type: 'result', result: 'test' })
      );
      expect(parser.extractSlashCommands(event!)).toBeNull();
    });
  });

  describe('edge cases', () => {
    it('should handle empty result string', () => {
      const event = parser.parseJsonLine(
        JSON.stringify({ type: 'result', result: '', session_id: 'sess-123' })
      );
      expect(event?.type).toBe('result');
      expect(event?.text).toBe('');
    });

    it('should handle missing message content', () => {
      const event = parser.parseJsonLine(
        JSON.stringify({ type: 'assistant', message: {} })
      );
      expect(event?.type).toBe('text');
      expect(event?.text).toBe('');
    });

    it('should handle content array with no text blocks', () => {
      const event = parser.parseJsonLine(
        JSON.stringify({
          type: 'assistant',
          message: {
            content: [{ type: 'image', source: {} }],
          },
        })
      );
      expect(event?.type).toBe('text');
      expect(event?.text).toBe('');
    });

    it('should handle zero cost', () => {
      const event = parser.parseJsonLine(
        JSON.stringify({
          type: 'result',
          result: 'test',
          total_cost_usd: 0,
        })
      );
      expect(event?.usage?.costUsd).toBe(0);
    });
  });
});
