import { describe, it, expect } from 'vitest';
import { OpenCodeOutputParser } from '../../../main/parsers/opencode-output-parser';

describe('OpenCodeOutputParser', () => {
  const parser = new OpenCodeOutputParser();

  describe('agentId', () => {
    it('should be opencode', () => {
      expect(parser.agentId).toBe('opencode');
    });
  });

  describe('parseJsonLine', () => {
    it('should return null for empty lines', () => {
      expect(parser.parseJsonLine('')).toBeNull();
      expect(parser.parseJsonLine('  ')).toBeNull();
      expect(parser.parseJsonLine('\n')).toBeNull();
    });

    it('should parse step_start messages as init', () => {
      const line = JSON.stringify({
        type: 'step_start',
        sessionID: 'oc-sess-123',
      });

      const event = parser.parseJsonLine(line);
      expect(event).not.toBeNull();
      expect(event?.type).toBe('init');
      expect(event?.sessionId).toBe('oc-sess-123');
    });

    it('should parse text messages as partial text', () => {
      const line = JSON.stringify({
        type: 'text',
        sessionID: 'oc-sess-123',
        part: {
          text: 'Analyzing your code...',
        },
      });

      const event = parser.parseJsonLine(line);
      expect(event).not.toBeNull();
      expect(event?.type).toBe('text');
      expect(event?.text).toBe('Analyzing your code...');
      expect(event?.sessionId).toBe('oc-sess-123');
      expect(event?.isPartial).toBe(true);
    });

    it('should parse tool_use messages', () => {
      const line = JSON.stringify({
        type: 'tool_use',
        sessionID: 'oc-sess-123',
        tool: {
          name: 'file_read',
          state: { path: '/src/index.ts', reading: true },
        },
      });

      const event = parser.parseJsonLine(line);
      expect(event).not.toBeNull();
      expect(event?.type).toBe('tool_use');
      expect(event?.toolName).toBe('file_read');
      expect(event?.toolState).toEqual({ path: '/src/index.ts', reading: true });
      expect(event?.sessionId).toBe('oc-sess-123');
    });

    it('should parse step_finish messages as result', () => {
      const line = JSON.stringify({
        type: 'step_finish',
        sessionID: 'oc-sess-123',
        result: 'Task completed successfully.',
        part: {
          tokens: {
            input: 500,
            output: 200,
          },
        },
      });

      const event = parser.parseJsonLine(line);
      expect(event).not.toBeNull();
      expect(event?.type).toBe('result');
      expect(event?.text).toBe('Task completed successfully.');
      expect(event?.sessionId).toBe('oc-sess-123');
      expect(event?.usage?.inputTokens).toBe(500);
      expect(event?.usage?.outputTokens).toBe(200);
    });

    it('should parse error messages', () => {
      const line = JSON.stringify({
        sessionID: 'oc-sess-123',
        error: 'Connection failed: timeout',
      });

      const event = parser.parseJsonLine(line);
      expect(event).not.toBeNull();
      expect(event?.type).toBe('error');
      expect(event?.text).toBe('Connection failed: timeout');
      expect(event?.sessionId).toBe('oc-sess-123');
    });

    it('should handle messages with only sessionID', () => {
      const line = JSON.stringify({
        sessionID: 'oc-sess-123',
      });

      const event = parser.parseJsonLine(line);
      expect(event).not.toBeNull();
      expect(event?.type).toBe('system');
      expect(event?.sessionId).toBe('oc-sess-123');
    });

    it('should handle invalid JSON as text', () => {
      const event = parser.parseJsonLine('not valid json');
      expect(event).not.toBeNull();
      expect(event?.type).toBe('text');
      expect(event?.text).toBe('not valid json');
    });

    it('should preserve raw message', () => {
      const original = {
        type: 'step_finish',
        result: 'Test',
        sessionID: 'oc-sess-123',
      };
      const line = JSON.stringify(original);

      const event = parser.parseJsonLine(line);
      expect(event?.raw).toEqual(original);
    });
  });

  describe('isResultMessage', () => {
    it('should return true for step_finish events', () => {
      const resultEvent = parser.parseJsonLine(
        JSON.stringify({ type: 'step_finish', result: 'test' })
      );
      expect(resultEvent).not.toBeNull();
      expect(parser.isResultMessage(resultEvent!)).toBe(true);
    });

    it('should return false for non-result events', () => {
      const initEvent = parser.parseJsonLine(
        JSON.stringify({ type: 'step_start', sessionID: 'sess-123' })
      );
      expect(initEvent).not.toBeNull();
      expect(parser.isResultMessage(initEvent!)).toBe(false);

      const textEvent = parser.parseJsonLine(
        JSON.stringify({ type: 'text', part: { text: 'hi' } })
      );
      expect(textEvent).not.toBeNull();
      expect(parser.isResultMessage(textEvent!)).toBe(false);
    });
  });

  describe('extractSessionId', () => {
    it('should extract session ID from step_start message', () => {
      const event = parser.parseJsonLine(
        JSON.stringify({ type: 'step_start', sessionID: 'oc-xyz' })
      );
      expect(parser.extractSessionId(event!)).toBe('oc-xyz');
    });

    it('should extract session ID from step_finish message', () => {
      const event = parser.parseJsonLine(
        JSON.stringify({ type: 'step_finish', result: 'test', sessionID: 'oc-123' })
      );
      expect(parser.extractSessionId(event!)).toBe('oc-123');
    });

    it('should return null when no session ID', () => {
      const event = parser.parseJsonLine(JSON.stringify({ type: 'step_start' }));
      expect(parser.extractSessionId(event!)).toBeNull();
    });
  });

  describe('extractUsage', () => {
    it('should extract usage from step_finish message', () => {
      const event = parser.parseJsonLine(
        JSON.stringify({
          type: 'step_finish',
          result: 'test',
          part: {
            tokens: {
              input: 100,
              output: 50,
            },
          },
        })
      );

      const usage = parser.extractUsage(event!);
      expect(usage).not.toBeNull();
      expect(usage?.inputTokens).toBe(100);
      expect(usage?.outputTokens).toBe(50);
    });

    it('should return null when no usage stats', () => {
      const event = parser.parseJsonLine(
        JSON.stringify({ type: 'step_start', sessionID: 'sess-123' })
      );
      expect(parser.extractUsage(event!)).toBeNull();
    });

    it('should handle zero tokens', () => {
      const event = parser.parseJsonLine(
        JSON.stringify({
          type: 'step_finish',
          result: 'test',
          part: {
            tokens: {
              input: 0,
              output: 0,
            },
          },
        })
      );

      const usage = parser.extractUsage(event!);
      expect(usage?.inputTokens).toBe(0);
      expect(usage?.outputTokens).toBe(0);
    });
  });

  describe('extractSlashCommands', () => {
    it('should return null - OpenCode may not support slash commands', () => {
      const event = parser.parseJsonLine(
        JSON.stringify({ type: 'step_start', sessionID: 'sess-123' })
      );
      expect(parser.extractSlashCommands(event!)).toBeNull();
    });
  });

  describe('edge cases', () => {
    it('should handle empty result string', () => {
      const event = parser.parseJsonLine(
        JSON.stringify({ type: 'step_finish', result: '', sessionID: 'sess-123' })
      );
      expect(event?.type).toBe('result');
      expect(event?.text).toBe('');
    });

    it('should handle missing part.text', () => {
      const event = parser.parseJsonLine(
        JSON.stringify({ type: 'text', part: {} })
      );
      expect(event?.type).toBe('text');
      expect(event?.text).toBe('');
    });

    it('should handle missing part entirely', () => {
      const event = parser.parseJsonLine(
        JSON.stringify({ type: 'text' })
      );
      expect(event?.type).toBe('text');
      expect(event?.text).toBe('');
    });

    it('should handle missing tool info', () => {
      const event = parser.parseJsonLine(
        JSON.stringify({ type: 'tool_use' })
      );
      expect(event?.type).toBe('tool_use');
      expect(event?.toolName).toBeUndefined();
      expect(event?.toolState).toBeUndefined();
    });

    it('should handle messages without type', () => {
      const event = parser.parseJsonLine(
        JSON.stringify({ data: 'some data' })
      );
      expect(event?.type).toBe('system');
    });
  });
});
