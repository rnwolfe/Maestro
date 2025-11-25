import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import * as pty from 'node-pty';
import { stripControlSequences } from './utils/terminalFilter';

interface ProcessConfig {
  sessionId: string;
  toolType: string;
  cwd: string;
  command: string;
  args: string[];
  requiresPty?: boolean; // Whether this agent needs a pseudo-terminal
  prompt?: string; // For batch mode agents like Claude (passed as CLI argument)
  shell?: string; // Shell to use for terminal sessions (e.g., 'zsh', 'bash', 'fish')
}

interface ManagedProcess {
  sessionId: string;
  toolType: string;
  ptyProcess?: pty.IPty;
  childProcess?: ChildProcess;
  cwd: string;
  pid: number;
  isTerminal: boolean;
  isBatchMode?: boolean; // True for agents that run in batch mode (exit after response)
  jsonBuffer?: string; // Buffer for accumulating JSON output in batch mode
  lastCommand?: string; // Last command sent to terminal (for filtering command echoes)
}

export class ProcessManager extends EventEmitter {
  private processes: Map<string, ManagedProcess> = new Map();

  /**
   * Spawn a new process for a session
   */
  spawn(config: ProcessConfig): { pid: number; success: boolean } {
    const { sessionId, toolType, cwd, command, args, requiresPty, prompt, shell } = config;

    // For batch mode with prompt, append prompt to args with -- separator
    // The -- ensures prompt is treated as positional arg, not a flag (even if it starts with --)
    const finalArgs = prompt ? [...args, '--', prompt] : args;

    console.log('[ProcessManager] spawn() config:', {
      sessionId,
      toolType,
      hasPrompt: !!prompt,
      promptValue: prompt,
      baseArgs: args,
      finalArgs
    });

    // Determine if this should use a PTY:
    // - If toolType is 'terminal', always use PTY for full shell emulation
    // - If requiresPty is true, use PTY for AI agents that need TTY (like Claude Code)
    // - Batch mode (with prompt) never uses PTY
    const usePty = (toolType === 'terminal' || requiresPty === true) && !prompt;
    const isTerminal = toolType === 'terminal';

    try {
      if (usePty) {
        // Use node-pty for terminal mode or AI agents that require PTY
        let ptyCommand: string;
        let ptyArgs: string[];

        if (isTerminal) {
          // Full shell emulation for terminal mode
          // Use the provided shell, or default based on platform
          if (shell) {
            ptyCommand = shell;
          } else {
            ptyCommand = process.platform === 'win32' ? 'powershell.exe' : 'bash';
          }
          ptyArgs = [];
        } else {
          // Spawn the AI agent directly with PTY support
          ptyCommand = command;
          ptyArgs = finalArgs;
        }

        const ptyProcess = pty.spawn(ptyCommand, ptyArgs, {
          name: 'xterm-256color',
          cols: 100,
          rows: 30,
          cwd: cwd,
          env: process.env as any,
        });

        const managedProcess: ManagedProcess = {
          sessionId,
          toolType,
          ptyProcess,
          cwd,
          pid: ptyProcess.pid,
          isTerminal: true,
        };

        this.processes.set(sessionId, managedProcess);

        // Handle output
        ptyProcess.onData((data) => {
          // Strip terminal control sequences and filter prompts/echoes
          const managedProc = this.processes.get(sessionId);
          const cleanedData = stripControlSequences(data, managedProc?.lastCommand, isTerminal);
          console.log(`[ProcessManager] PTY onData for session ${sessionId} (PID ${ptyProcess.pid}):`, cleanedData.substring(0, 100));
          // Only emit if there's actual content after filtering
          if (cleanedData.trim()) {
            this.emit('data', sessionId, cleanedData);
          }
        });

        ptyProcess.onExit(({ exitCode }) => {
          console.log(`[ProcessManager] PTY onExit for session ${sessionId}:`, exitCode);
          this.emit('exit', sessionId, exitCode);
          this.processes.delete(sessionId);
        });

        console.log(`[ProcessManager] PTY process created:`, {
          sessionId,
          toolType,
          isTerminal,
          requiresPty: requiresPty || false,
          pid: ptyProcess.pid,
          command: ptyCommand,
          args: ptyArgs,
          cwd
        });

        return { pid: ptyProcess.pid, success: true };
      } else {
        // Use regular child_process for AI tools (including batch mode)
        const childProcess = spawn(command, finalArgs, {
          cwd,
          env: process.env,
          shell: false, // Explicitly disable shell to prevent injection
        });

        const isBatchMode = !!prompt;

        const managedProcess: ManagedProcess = {
          sessionId,
          toolType,
          childProcess,
          cwd,
          pid: childProcess.pid || -1,
          isTerminal: false,
          isBatchMode,
          jsonBuffer: isBatchMode ? '' : undefined,
        };

        this.processes.set(sessionId, managedProcess);

        // Handle stdout
        childProcess.stdout?.on('data', (data: Buffer) => {
          const output = data.toString();

          console.log('[ProcessManager] stdout data received:', {
            sessionId,
            isBatchMode,
            dataLength: output.length,
            dataPreview: output.substring(0, 200)
          });

          if (isBatchMode) {
            // In batch mode, accumulate JSON output
            managedProcess.jsonBuffer = (managedProcess.jsonBuffer || '') + output;
            console.log('[ProcessManager] Accumulated JSON buffer length:', managedProcess.jsonBuffer.length);
          } else {
            // In interactive mode, emit data immediately
            this.emit('data', sessionId, output);
          }
        });

        // Handle stderr
        childProcess.stderr?.on('data', (data: Buffer) => {
          this.emit('data', sessionId, `[stderr] ${data.toString()}`);
        });

        // Handle exit
        childProcess.on('exit', (code) => {
          if (isBatchMode && managedProcess.jsonBuffer) {
            // Parse JSON response from batch mode
            try {
              const jsonResponse = JSON.parse(managedProcess.jsonBuffer);

              // Emit the result text
              if (jsonResponse.result) {
                this.emit('data', sessionId, jsonResponse.result);
              }

              // Emit session_id if present
              if (jsonResponse.session_id) {
                this.emit('session-id', sessionId, jsonResponse.session_id);
              }

              // Emit full response for debugging
              console.log('[ProcessManager] Batch mode JSON response:', {
                sessionId,
                hasResult: !!jsonResponse.result,
                hasSessionId: !!jsonResponse.session_id,
                sessionIdValue: jsonResponse.session_id
              });
            } catch (error) {
              console.error('[ProcessManager] Failed to parse JSON response:', error);
              // Emit raw buffer as fallback
              this.emit('data', sessionId, managedProcess.jsonBuffer);
            }
          }

          this.emit('exit', sessionId, code || 0);
          this.processes.delete(sessionId);
        });

        childProcess.on('error', (error) => {
          this.emit('data', sessionId, `[error] ${error.message}`);
          this.processes.delete(sessionId);
        });

        return { pid: childProcess.pid || -1, success: true };
      }
    } catch (error: any) {
      console.error('Failed to spawn process:', error);
      return { pid: -1, success: false };
    }
  }

  /**
   * Write data to a process's stdin
   */
  write(sessionId: string, data: string): boolean {
    const process = this.processes.get(sessionId);
    if (!process) {
      console.error(`[ProcessManager] write() - No process found for session: ${sessionId}`);
      return false;
    }

    console.log('[ProcessManager] write() - Process info:', {
      sessionId,
      toolType: process.toolType,
      isTerminal: process.isTerminal,
      pid: process.pid,
      hasPtyProcess: !!process.ptyProcess,
      hasChildProcess: !!process.childProcess,
      hasStdin: !!process.childProcess?.stdin,
      dataLength: data.length,
      dataPreview: data.substring(0, 50)
    });

    try {
      if (process.isTerminal && process.ptyProcess) {
        console.log(`[ProcessManager] Writing to PTY process (PID ${process.pid})`);
        // Track the command for filtering echoes (remove trailing newline for comparison)
        const command = data.replace(/\r?\n$/, '');
        if (command.trim()) {
          process.lastCommand = command.trim();
        }
        process.ptyProcess.write(data);
        return true;
      } else if (process.childProcess?.stdin) {
        console.log(`[ProcessManager] Writing to child process stdin (PID ${process.pid})`);
        process.childProcess.stdin.write(data);
        return true;
      }
      console.error(`[ProcessManager] No valid input stream for session: ${sessionId}`);
      return false;
    } catch (error) {
      console.error('Failed to write to process:', error);
      return false;
    }
  }

  /**
   * Resize terminal (for pty processes)
   */
  resize(sessionId: string, cols: number, rows: number): boolean {
    const process = this.processes.get(sessionId);
    if (!process || !process.isTerminal || !process.ptyProcess) return false;

    try {
      process.ptyProcess.resize(cols, rows);
      return true;
    } catch (error) {
      console.error('Failed to resize terminal:', error);
      return false;
    }
  }

  /**
   * Send interrupt signal (SIGINT/Ctrl+C) to a process
   * This attempts a graceful interrupt first, like pressing Ctrl+C
   */
  interrupt(sessionId: string): boolean {
    const process = this.processes.get(sessionId);
    if (!process) {
      console.error(`[ProcessManager] interrupt() - No process found for session: ${sessionId}`);
      return false;
    }

    try {
      if (process.isTerminal && process.ptyProcess) {
        // For PTY processes, send Ctrl+C character
        console.log(`[ProcessManager] Sending Ctrl+C to PTY process (PID ${process.pid})`);
        process.ptyProcess.write('\x03'); // Ctrl+C
        return true;
      } else if (process.childProcess) {
        // For child processes, send SIGINT signal
        console.log(`[ProcessManager] Sending SIGINT to child process (PID ${process.pid})`);
        process.childProcess.kill('SIGINT');
        return true;
      }
      console.error(`[ProcessManager] No valid process to interrupt for session: ${sessionId}`);
      return false;
    } catch (error) {
      console.error('Failed to interrupt process:', error);
      return false;
    }
  }

  /**
   * Kill a specific process
   */
  kill(sessionId: string): boolean {
    const process = this.processes.get(sessionId);
    if (!process) return false;

    try {
      if (process.isTerminal && process.ptyProcess) {
        process.ptyProcess.kill();
      } else if (process.childProcess) {
        process.childProcess.kill('SIGTERM');
      }
      this.processes.delete(sessionId);
      return true;
    } catch (error) {
      console.error('Failed to kill process:', error);
      return false;
    }
  }

  /**
   * Kill all managed processes
   */
  killAll(): void {
    for (const [sessionId] of this.processes) {
      this.kill(sessionId);
    }
  }

  /**
   * Get all active processes
   */
  getAll(): ManagedProcess[] {
    return Array.from(this.processes.values());
  }

  /**
   * Get a specific process
   */
  get(sessionId: string): ManagedProcess | undefined {
    return this.processes.get(sessionId);
  }

  /**
   * Run a single command and capture stdout/stderr cleanly
   * This does NOT use PTY - it spawns the command directly via shell -c
   * and captures only the command output without prompts or echoes.
   *
   * @param sessionId - Session ID for event emission
   * @param command - The shell command to execute
   * @param cwd - Working directory
   * @param shell - Shell to use (default: bash)
   * @returns Promise that resolves when command completes
   */
  runCommand(
    sessionId: string,
    command: string,
    cwd: string,
    shell: string = 'bash'
  ): Promise<{ exitCode: number }> {
    return new Promise((resolve) => {
      console.log('[ProcessManager] runCommand():', { sessionId, command, cwd, shell });

      // Build the command with shell config sourcing
      // This ensures PATH, aliases, and functions are available
      const shellName = shell.split('/').pop() || shell;
      let wrappedCommand: string;

      if (shellName === 'fish') {
        // Fish auto-sources config.fish, just run the command
        wrappedCommand = command;
      } else if (shellName === 'zsh') {
        // Source .zshrc for aliases, then use eval to parse command AFTER aliases are loaded
        // Without eval, the shell parses the command before .zshrc is sourced, so aliases aren't available
        const escapedCommand = command.replace(/'/g, "'\\''");
        wrappedCommand = `source ~/.zshrc 2>/dev/null; eval '${escapedCommand}'`;
      } else if (shellName === 'bash') {
        // Source .bashrc for aliases, use eval for same reason as zsh
        const escapedCommand = command.replace(/'/g, "'\\''");
        wrappedCommand = `source ~/.bashrc 2>/dev/null; eval '${escapedCommand}'`;
      } else {
        // Other POSIX-compatible shells
        wrappedCommand = command;
      }

      // Ensure PATH includes standard binary locations
      // Electron's main process may have a stripped-down PATH
      const env = { ...process.env };
      const standardPaths = '/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin';
      if (env.PATH) {
        // Prepend standard paths if not already present
        if (!env.PATH.includes('/bin')) {
          env.PATH = `${standardPaths}:${env.PATH}`;
        }
      } else {
        env.PATH = standardPaths;
      }

      console.log('[ProcessManager] runCommand spawning:', { shell, wrappedCommand, cwd, PATH: env.PATH?.substring(0, 100) });

      const childProcess = spawn(wrappedCommand, [], {
        cwd,
        env,
        shell: shell, // Use specified shell to interpret command
      });

      let stdoutBuffer = '';
      let stderrBuffer = '';

      // Handle stdout - emit data events for real-time streaming
      childProcess.stdout?.on('data', (data: Buffer) => {
        let output = data.toString();
        console.log('[ProcessManager] runCommand stdout RAW:', { sessionId, rawLength: output.length, raw: output.substring(0, 200) });

        // Filter out shell integration sequences that may appear in interactive shells
        // These include iTerm2, VSCode, and other terminal emulator integration markers
        // Format: ]1337;..., ]133;..., ]7;... (with or without ESC prefix)
        output = output.replace(/\x1b?\]1337;[^\x07\x1b\n]*(\x07|\x1b\\)?/g, '');
        output = output.replace(/\x1b?\]133;[^\x07\x1b\n]*(\x07|\x1b\\)?/g, '');
        output = output.replace(/\x1b?\]7;[^\x07\x1b\n]*(\x07|\x1b\\)?/g, '');
        // Remove OSC sequences for window title, etc.
        output = output.replace(/\x1b?\][0-9];[^\x07\x1b\n]*(\x07|\x1b\\)?/g, '');

        console.log('[ProcessManager] runCommand stdout FILTERED:', { sessionId, filteredLength: output.length, filtered: output.substring(0, 200), trimmedEmpty: !output.trim() });

        // Only emit if there's actual content after filtering
        if (output.trim()) {
          stdoutBuffer += output;
          console.log('[ProcessManager] runCommand EMITTING data event:', { sessionId, outputLength: output.length });
          this.emit('data', sessionId, output);
        } else {
          console.log('[ProcessManager] runCommand SKIPPED emit (empty after trim):', { sessionId });
        }
      });

      // Handle stderr - emit with [stderr] prefix for differentiation
      childProcess.stderr?.on('data', (data: Buffer) => {
        const output = data.toString();
        stderrBuffer += output;
        // Emit stderr with prefix so renderer can style it differently
        this.emit('stderr', sessionId, output);
      });

      // Handle process exit
      childProcess.on('exit', (code) => {
        console.log('[ProcessManager] runCommand exit:', { sessionId, exitCode: code });
        this.emit('command-exit', sessionId, code || 0);
        resolve({ exitCode: code || 0 });
      });

      // Handle errors (e.g., spawn failures)
      childProcess.on('error', (error) => {
        console.error('[ProcessManager] runCommand error:', error);
        this.emit('stderr', sessionId, `Error: ${error.message}`);
        this.emit('command-exit', sessionId, 1);
        resolve({ exitCode: 1 });
      });
    });
  }
}
