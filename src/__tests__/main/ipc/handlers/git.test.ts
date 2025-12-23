/**
 * Tests for the Git IPC handlers
 *
 * These tests verify the Git-related IPC handlers that provide
 * git operations used across the application.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ipcMain } from 'electron';
import { registerGitHandlers } from '../../../../main/ipc/handlers/git';
import * as execFile from '../../../../main/utils/execFile';

// Mock electron's ipcMain
vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn(),
    removeHandler: vi.fn(),
  },
  BrowserWindow: {
    getAllWindows: vi.fn(() => []),
  },
}));

// Mock the execFile module
vi.mock('../../../../main/utils/execFile', () => ({
  execFileNoThrow: vi.fn(),
}));

// Mock the logger
vi.mock('../../../../main/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock the cliDetection module
vi.mock('../../../../main/utils/cliDetection', () => ({
  resolveGhPath: vi.fn().mockResolvedValue('gh'),
  getCachedGhStatus: vi.fn().mockReturnValue(null),
  setCachedGhStatus: vi.fn(),
}));

// Mock fs/promises
vi.mock('fs/promises', () => ({
  default: {
    access: vi.fn(),
    readdir: vi.fn(),
    rmdir: vi.fn(),
  },
}));

// Mock chokidar
vi.mock('chokidar', () => ({
  default: {
    watch: vi.fn(() => ({
      on: vi.fn().mockReturnThis(),
      close: vi.fn().mockResolvedValue(undefined),
    })),
  },
}));

// Mock child_process for spawnSync (used in git:showFile for images)
// The handler uses require('child_process') at runtime - need vi.hoisted for proper hoisting
const { mockSpawnSync } = vi.hoisted(() => ({
  mockSpawnSync: vi.fn(),
}));

vi.mock('child_process', () => ({
  spawnSync: mockSpawnSync,
  // Include other exports that might be needed
  spawn: vi.fn(),
  exec: vi.fn(),
  execSync: vi.fn(),
  execFile: vi.fn(),
  execFileSync: vi.fn(),
  fork: vi.fn(),
}));

describe('Git IPC handlers', () => {
  let handlers: Map<string, Function>;

  beforeEach(() => {
    // Clear mocks
    vi.clearAllMocks();

    // Capture all registered handlers
    handlers = new Map();
    vi.mocked(ipcMain.handle).mockImplementation((channel, handler) => {
      handlers.set(channel, handler);
    });

    // Register handlers
    registerGitHandlers();
  });

  afterEach(() => {
    handlers.clear();
  });

  describe('registration', () => {
    it('should register all 24 git handlers', () => {
      const expectedChannels = [
        'git:status',
        'git:diff',
        'git:isRepo',
        'git:numstat',
        'git:branch',
        'git:remote',
        'git:branches',
        'git:tags',
        'git:info',
        'git:log',
        'git:commitCount',
        'git:show',
        'git:showFile',
        'git:worktreeInfo',
        'git:getRepoRoot',
        'git:worktreeSetup',
        'git:worktreeCheckout',
        'git:createPR',
        'git:checkGhCli',
        'git:getDefaultBranch',
        'git:listWorktrees',
        'git:scanWorktreeDirectory',
        'git:watchWorktreeDirectory',
        'git:unwatchWorktreeDirectory',
      ];

      expect(handlers.size).toBe(24);
      for (const channel of expectedChannels) {
        expect(handlers.has(channel)).toBe(true);
      }
    });
  });

  describe('git:status', () => {
    it('should return stdout from execFileNoThrow on success', async () => {
      vi.mocked(execFile.execFileNoThrow).mockResolvedValue({
        stdout: 'M  file.txt\nA  new.txt\n',
        stderr: '',
        exitCode: 0,
      });

      const handler = handlers.get('git:status');
      const result = await handler!({} as any, '/test/repo');

      expect(execFile.execFileNoThrow).toHaveBeenCalledWith(
        'git',
        ['status', '--porcelain'],
        '/test/repo'
      );
      expect(result).toEqual({
        stdout: 'M  file.txt\nA  new.txt\n',
        stderr: '',
      });
    });

    it('should return stderr when not a git repo', async () => {
      vi.mocked(execFile.execFileNoThrow).mockResolvedValue({
        stdout: '',
        stderr: 'fatal: not a git repository',
        exitCode: 128,
      });

      const handler = handlers.get('git:status');
      const result = await handler!({} as any, '/not/a/repo');

      expect(result).toEqual({
        stdout: '',
        stderr: 'fatal: not a git repository',
      });
    });

    it('should pass cwd parameter correctly', async () => {
      vi.mocked(execFile.execFileNoThrow).mockResolvedValue({
        stdout: '',
        stderr: '',
        exitCode: 0,
      });

      const handler = handlers.get('git:status');
      await handler!({} as any, '/custom/path');

      expect(execFile.execFileNoThrow).toHaveBeenCalledWith(
        'git',
        ['status', '--porcelain'],
        '/custom/path'
      );
    });

    it('should return empty stdout for clean repository', async () => {
      vi.mocked(execFile.execFileNoThrow).mockResolvedValue({
        stdout: '',
        stderr: '',
        exitCode: 0,
      });

      const handler = handlers.get('git:status');
      const result = await handler!({} as any, '/clean/repo');

      expect(result).toEqual({
        stdout: '',
        stderr: '',
      });
    });
  });

  describe('git:diff', () => {
    it('should return diff output for unstaged changes', async () => {
      const diffOutput = `diff --git a/file.txt b/file.txt
index abc1234..def5678 100644
--- a/file.txt
+++ b/file.txt
@@ -1,3 +1,4 @@
 line 1
+new line
 line 2
 line 3`;

      vi.mocked(execFile.execFileNoThrow).mockResolvedValue({
        stdout: diffOutput,
        stderr: '',
        exitCode: 0,
      });

      const handler = handlers.get('git:diff');
      const result = await handler!({} as any, '/test/repo');

      expect(execFile.execFileNoThrow).toHaveBeenCalledWith(
        'git',
        ['diff'],
        '/test/repo'
      );
      expect(result).toEqual({
        stdout: diffOutput,
        stderr: '',
      });
    });

    it('should return diff for specific file when file path is provided', async () => {
      const fileDiff = `diff --git a/specific.txt b/specific.txt
index 1234567..abcdefg 100644
--- a/specific.txt
+++ b/specific.txt
@@ -1 +1 @@
-old content
+new content`;

      vi.mocked(execFile.execFileNoThrow).mockResolvedValue({
        stdout: fileDiff,
        stderr: '',
        exitCode: 0,
      });

      const handler = handlers.get('git:diff');
      const result = await handler!({} as any, '/test/repo', 'specific.txt');

      expect(execFile.execFileNoThrow).toHaveBeenCalledWith(
        'git',
        ['diff', 'specific.txt'],
        '/test/repo'
      );
      expect(result).toEqual({
        stdout: fileDiff,
        stderr: '',
      });
    });

    it('should return empty diff when no changes exist', async () => {
      vi.mocked(execFile.execFileNoThrow).mockResolvedValue({
        stdout: '',
        stderr: '',
        exitCode: 0,
      });

      const handler = handlers.get('git:diff');
      const result = await handler!({} as any, '/test/repo');

      expect(result).toEqual({
        stdout: '',
        stderr: '',
      });
    });

    it('should return stderr when not a git repo', async () => {
      vi.mocked(execFile.execFileNoThrow).mockResolvedValue({
        stdout: '',
        stderr: 'fatal: not a git repository',
        exitCode: 128,
      });

      const handler = handlers.get('git:diff');
      const result = await handler!({} as any, '/not/a/repo');

      expect(result).toEqual({
        stdout: '',
        stderr: 'fatal: not a git repository',
      });
    });
  });

  describe('git:isRepo', () => {
    it('should return true when directory is inside a git work tree', async () => {
      vi.mocked(execFile.execFileNoThrow).mockResolvedValue({
        stdout: 'true\n',
        stderr: '',
        exitCode: 0,
      });

      const handler = handlers.get('git:isRepo');
      const result = await handler!({} as any, '/valid/git/repo');

      expect(execFile.execFileNoThrow).toHaveBeenCalledWith(
        'git',
        ['rev-parse', '--is-inside-work-tree'],
        '/valid/git/repo'
      );
      expect(result).toBe(true);
    });

    it('should return false when not a git repository', async () => {
      vi.mocked(execFile.execFileNoThrow).mockResolvedValue({
        stdout: '',
        stderr: 'fatal: not a git repository (or any of the parent directories): .git',
        exitCode: 128,
      });

      const handler = handlers.get('git:isRepo');
      const result = await handler!({} as any, '/not/a/repo');

      expect(execFile.execFileNoThrow).toHaveBeenCalledWith(
        'git',
        ['rev-parse', '--is-inside-work-tree'],
        '/not/a/repo'
      );
      expect(result).toBe(false);
    });

    it('should return false for non-zero exit codes', async () => {
      // Test with different non-zero exit code
      vi.mocked(execFile.execFileNoThrow).mockResolvedValue({
        stdout: '',
        stderr: 'error',
        exitCode: 1,
      });

      const handler = handlers.get('git:isRepo');
      const result = await handler!({} as any, '/some/path');

      expect(result).toBe(false);
    });
  });

  describe('git:numstat', () => {
    it('should return parsed numstat output for changed files', async () => {
      const numstatOutput = `10\t5\tfile1.ts
3\t0\tfile2.ts
0\t20\tfile3.ts`;

      vi.mocked(execFile.execFileNoThrow).mockResolvedValue({
        stdout: numstatOutput,
        stderr: '',
        exitCode: 0,
      });

      const handler = handlers.get('git:numstat');
      const result = await handler!({} as any, '/test/repo');

      expect(execFile.execFileNoThrow).toHaveBeenCalledWith(
        'git',
        ['diff', '--numstat'],
        '/test/repo'
      );
      expect(result).toEqual({
        stdout: numstatOutput,
        stderr: '',
      });
    });

    it('should return empty stdout when no changes exist', async () => {
      vi.mocked(execFile.execFileNoThrow).mockResolvedValue({
        stdout: '',
        stderr: '',
        exitCode: 0,
      });

      const handler = handlers.get('git:numstat');
      const result = await handler!({} as any, '/test/repo');

      expect(result).toEqual({
        stdout: '',
        stderr: '',
      });
    });

    it('should return stderr when not a git repo', async () => {
      vi.mocked(execFile.execFileNoThrow).mockResolvedValue({
        stdout: '',
        stderr: 'fatal: not a git repository',
        exitCode: 128,
      });

      const handler = handlers.get('git:numstat');
      const result = await handler!({} as any, '/not/a/repo');

      expect(result).toEqual({
        stdout: '',
        stderr: 'fatal: not a git repository',
      });
    });

    it('should handle binary files in numstat output', async () => {
      // Git uses "-\t-\t" for binary files
      const numstatOutput = `10\t5\tfile1.ts
-\t-\timage.png`;

      vi.mocked(execFile.execFileNoThrow).mockResolvedValue({
        stdout: numstatOutput,
        stderr: '',
        exitCode: 0,
      });

      const handler = handlers.get('git:numstat');
      const result = await handler!({} as any, '/test/repo');

      expect(result).toEqual({
        stdout: numstatOutput,
        stderr: '',
      });
    });
  });

  describe('git:branch', () => {
    it('should return current branch name trimmed', async () => {
      vi.mocked(execFile.execFileNoThrow).mockResolvedValue({
        stdout: 'main\n',
        stderr: '',
        exitCode: 0,
      });

      const handler = handlers.get('git:branch');
      const result = await handler!({} as any, '/test/repo');

      expect(execFile.execFileNoThrow).toHaveBeenCalledWith(
        'git',
        ['rev-parse', '--abbrev-ref', 'HEAD'],
        '/test/repo'
      );
      expect(result).toEqual({
        stdout: 'main',
        stderr: '',
      });
    });

    it('should return HEAD for detached HEAD state', async () => {
      // When in detached HEAD state, git rev-parse --abbrev-ref HEAD returns 'HEAD'
      vi.mocked(execFile.execFileNoThrow).mockResolvedValue({
        stdout: 'HEAD\n',
        stderr: '',
        exitCode: 0,
      });

      const handler = handlers.get('git:branch');
      const result = await handler!({} as any, '/test/repo');

      expect(result).toEqual({
        stdout: 'HEAD',
        stderr: '',
      });
    });

    it('should return stderr when not a git repo', async () => {
      vi.mocked(execFile.execFileNoThrow).mockResolvedValue({
        stdout: '',
        stderr: 'fatal: not a git repository',
        exitCode: 128,
      });

      const handler = handlers.get('git:branch');
      const result = await handler!({} as any, '/not/a/repo');

      expect(result).toEqual({
        stdout: '',
        stderr: 'fatal: not a git repository',
      });
    });

    it('should handle feature branch names', async () => {
      vi.mocked(execFile.execFileNoThrow).mockResolvedValue({
        stdout: 'feature/my-new-feature\n',
        stderr: '',
        exitCode: 0,
      });

      const handler = handlers.get('git:branch');
      const result = await handler!({} as any, '/test/repo');

      expect(result).toEqual({
        stdout: 'feature/my-new-feature',
        stderr: '',
      });
    });
  });

  describe('git:remote', () => {
    it('should return remote URL for origin', async () => {
      vi.mocked(execFile.execFileNoThrow).mockResolvedValue({
        stdout: 'git@github.com:user/repo.git\n',
        stderr: '',
        exitCode: 0,
      });

      const handler = handlers.get('git:remote');
      const result = await handler!({} as any, '/test/repo');

      expect(execFile.execFileNoThrow).toHaveBeenCalledWith(
        'git',
        ['remote', 'get-url', 'origin'],
        '/test/repo'
      );
      expect(result).toEqual({
        stdout: 'git@github.com:user/repo.git',
        stderr: '',
      });
    });

    it('should return HTTPS remote URL', async () => {
      vi.mocked(execFile.execFileNoThrow).mockResolvedValue({
        stdout: 'https://github.com/user/repo.git\n',
        stderr: '',
        exitCode: 0,
      });

      const handler = handlers.get('git:remote');
      const result = await handler!({} as any, '/test/repo');

      expect(result).toEqual({
        stdout: 'https://github.com/user/repo.git',
        stderr: '',
      });
    });

    it('should return stderr when no remote configured', async () => {
      vi.mocked(execFile.execFileNoThrow).mockResolvedValue({
        stdout: '',
        stderr: "fatal: No such remote 'origin'",
        exitCode: 2,
      });

      const handler = handlers.get('git:remote');
      const result = await handler!({} as any, '/test/repo');

      expect(result).toEqual({
        stdout: '',
        stderr: "fatal: No such remote 'origin'",
      });
    });

    it('should return stderr when not a git repo', async () => {
      vi.mocked(execFile.execFileNoThrow).mockResolvedValue({
        stdout: '',
        stderr: 'fatal: not a git repository',
        exitCode: 128,
      });

      const handler = handlers.get('git:remote');
      const result = await handler!({} as any, '/not/a/repo');

      expect(result).toEqual({
        stdout: '',
        stderr: 'fatal: not a git repository',
      });
    });
  });

  describe('git:branches', () => {
    it('should return array of branch names', async () => {
      vi.mocked(execFile.execFileNoThrow).mockResolvedValue({
        stdout: 'main\nfeature/awesome\nfix/bug-123\n',
        stderr: '',
        exitCode: 0,
      });

      const handler = handlers.get('git:branches');
      const result = await handler!({} as any, '/test/repo');

      expect(execFile.execFileNoThrow).toHaveBeenCalledWith(
        'git',
        ['branch', '-a', '--format=%(refname:short)'],
        '/test/repo'
      );
      expect(result).toEqual({
        branches: ['main', 'feature/awesome', 'fix/bug-123'],
      });
    });

    it('should deduplicate local and remote branches', async () => {
      // When a branch exists both locally and on origin
      vi.mocked(execFile.execFileNoThrow).mockResolvedValue({
        stdout: 'main\norigin/main\nfeature/foo\norigin/feature/foo\ndevelop\n',
        stderr: '',
        exitCode: 0,
      });

      const handler = handlers.get('git:branches');
      const result = await handler!({} as any, '/test/repo');

      // parseGitBranches removes 'origin/' prefix and deduplicates
      expect(result).toEqual({
        branches: ['main', 'feature/foo', 'develop'],
      });
    });

    it('should filter out HEAD from branch list', async () => {
      vi.mocked(execFile.execFileNoThrow).mockResolvedValue({
        stdout: 'main\nHEAD\norigin/HEAD\nfeature/test\n',
        stderr: '',
        exitCode: 0,
      });

      const handler = handlers.get('git:branches');
      const result = await handler!({} as any, '/test/repo');

      // parseGitBranches filters out HEAD
      expect(result).toEqual({
        branches: ['main', 'feature/test'],
      });
    });

    it('should return empty array when no branches exist', async () => {
      vi.mocked(execFile.execFileNoThrow).mockResolvedValue({
        stdout: '',
        stderr: '',
        exitCode: 0,
      });

      const handler = handlers.get('git:branches');
      const result = await handler!({} as any, '/test/repo');

      expect(result).toEqual({
        branches: [],
      });
    });

    it('should return empty array with stderr when not a git repo', async () => {
      vi.mocked(execFile.execFileNoThrow).mockResolvedValue({
        stdout: '',
        stderr: 'fatal: not a git repository',
        exitCode: 128,
      });

      const handler = handlers.get('git:branches');
      const result = await handler!({} as any, '/not/a/repo');

      expect(result).toEqual({
        branches: [],
        stderr: 'fatal: not a git repository',
      });
    });
  });

  describe('git:tags', () => {
    it('should return array of tag names', async () => {
      vi.mocked(execFile.execFileNoThrow).mockResolvedValue({
        stdout: 'v1.0.0\nv1.1.0\nv2.0.0-beta\n',
        stderr: '',
        exitCode: 0,
      });

      const handler = handlers.get('git:tags');
      const result = await handler!({} as any, '/test/repo');

      expect(execFile.execFileNoThrow).toHaveBeenCalledWith(
        'git',
        ['tag', '--list'],
        '/test/repo'
      );
      expect(result).toEqual({
        tags: ['v1.0.0', 'v1.1.0', 'v2.0.0-beta'],
      });
    });

    it('should handle tags with special characters', async () => {
      vi.mocked(execFile.execFileNoThrow).mockResolvedValue({
        stdout: 'release/1.0\nhotfix-2023.01.15\nmy_tag_v1\n',
        stderr: '',
        exitCode: 0,
      });

      const handler = handlers.get('git:tags');
      const result = await handler!({} as any, '/test/repo');

      expect(result).toEqual({
        tags: ['release/1.0', 'hotfix-2023.01.15', 'my_tag_v1'],
      });
    });

    it('should return empty array when no tags exist', async () => {
      vi.mocked(execFile.execFileNoThrow).mockResolvedValue({
        stdout: '',
        stderr: '',
        exitCode: 0,
      });

      const handler = handlers.get('git:tags');
      const result = await handler!({} as any, '/test/repo');

      expect(result).toEqual({
        tags: [],
      });
    });

    it('should return empty array with stderr when not a git repo', async () => {
      vi.mocked(execFile.execFileNoThrow).mockResolvedValue({
        stdout: '',
        stderr: 'fatal: not a git repository',
        exitCode: 128,
      });

      const handler = handlers.get('git:tags');
      const result = await handler!({} as any, '/not/a/repo');

      expect(result).toEqual({
        tags: [],
        stderr: 'fatal: not a git repository',
      });
    });
  });

  describe('git:info', () => {
    it('should return combined git info object with all fields', async () => {
      // The handler runs 4 parallel git commands
      vi.mocked(execFile.execFileNoThrow)
        .mockResolvedValueOnce({
          // git rev-parse --abbrev-ref HEAD (branch)
          stdout: 'main\n',
          stderr: '',
          exitCode: 0,
        })
        .mockResolvedValueOnce({
          // git remote get-url origin (remote)
          stdout: 'git@github.com:user/repo.git\n',
          stderr: '',
          exitCode: 0,
        })
        .mockResolvedValueOnce({
          // git status --porcelain (uncommitted changes)
          stdout: 'M  file1.ts\nA  file2.ts\n?? untracked.txt\n',
          stderr: '',
          exitCode: 0,
        })
        .mockResolvedValueOnce({
          // git rev-list --left-right --count @{upstream}...HEAD (behind/ahead)
          stdout: '3\t5\n',
          stderr: '',
          exitCode: 0,
        });

      const handler = handlers.get('git:info');
      const result = await handler!({} as any, '/test/repo');

      expect(result).toEqual({
        branch: 'main',
        remote: 'git@github.com:user/repo.git',
        behind: 3,
        ahead: 5,
        uncommittedChanges: 3,
      });
    });

    it('should return partial info when remote command fails', async () => {
      vi.mocked(execFile.execFileNoThrow)
        .mockResolvedValueOnce({
          // git rev-parse --abbrev-ref HEAD (branch)
          stdout: 'feature/my-branch\n',
          stderr: '',
          exitCode: 0,
        })
        .mockResolvedValueOnce({
          // git remote get-url origin (remote) - fails, no remote
          stdout: '',
          stderr: "fatal: No such remote 'origin'",
          exitCode: 2,
        })
        .mockResolvedValueOnce({
          // git status --porcelain (uncommitted changes)
          stdout: '',
          stderr: '',
          exitCode: 0,
        })
        .mockResolvedValueOnce({
          // git rev-list --left-right --count @{upstream}...HEAD
          stdout: '0\t2\n',
          stderr: '',
          exitCode: 0,
        });

      const handler = handlers.get('git:info');
      const result = await handler!({} as any, '/test/repo');

      // Remote should be empty string when command fails
      expect(result).toEqual({
        branch: 'feature/my-branch',
        remote: '',
        behind: 0,
        ahead: 2,
        uncommittedChanges: 0,
      });
    });

    it('should return zero behind/ahead when upstream is not set', async () => {
      vi.mocked(execFile.execFileNoThrow)
        .mockResolvedValueOnce({
          // git rev-parse --abbrev-ref HEAD (branch)
          stdout: 'new-branch\n',
          stderr: '',
          exitCode: 0,
        })
        .mockResolvedValueOnce({
          // git remote get-url origin (remote)
          stdout: 'https://github.com/user/repo.git\n',
          stderr: '',
          exitCode: 0,
        })
        .mockResolvedValueOnce({
          // git status --porcelain (uncommitted changes)
          stdout: 'M  changed.ts\n',
          stderr: '',
          exitCode: 0,
        })
        .mockResolvedValueOnce({
          // git rev-list --left-right --count @{upstream}...HEAD - fails, no upstream
          stdout: '',
          stderr: "fatal: no upstream configured for branch 'new-branch'",
          exitCode: 128,
        });

      const handler = handlers.get('git:info');
      const result = await handler!({} as any, '/test/repo');

      // behind/ahead should default to 0 when upstream check fails
      expect(result).toEqual({
        branch: 'new-branch',
        remote: 'https://github.com/user/repo.git',
        behind: 0,
        ahead: 0,
        uncommittedChanges: 1,
      });
    });

    it('should handle clean repo with no changes and in sync with upstream', async () => {
      vi.mocked(execFile.execFileNoThrow)
        .mockResolvedValueOnce({
          // git rev-parse --abbrev-ref HEAD (branch)
          stdout: 'main\n',
          stderr: '',
          exitCode: 0,
        })
        .mockResolvedValueOnce({
          // git remote get-url origin (remote)
          stdout: 'git@github.com:user/repo.git\n',
          stderr: '',
          exitCode: 0,
        })
        .mockResolvedValueOnce({
          // git status --porcelain (uncommitted changes) - empty
          stdout: '',
          stderr: '',
          exitCode: 0,
        })
        .mockResolvedValueOnce({
          // git rev-list --left-right --count @{upstream}...HEAD - in sync
          stdout: '0\t0\n',
          stderr: '',
          exitCode: 0,
        });

      const handler = handlers.get('git:info');
      const result = await handler!({} as any, '/test/repo');

      expect(result).toEqual({
        branch: 'main',
        remote: 'git@github.com:user/repo.git',
        behind: 0,
        ahead: 0,
        uncommittedChanges: 0,
      });
    });

    it('should handle detached HEAD state', async () => {
      vi.mocked(execFile.execFileNoThrow)
        .mockResolvedValueOnce({
          // git rev-parse --abbrev-ref HEAD (branch) - detached HEAD returns 'HEAD'
          stdout: 'HEAD\n',
          stderr: '',
          exitCode: 0,
        })
        .mockResolvedValueOnce({
          // git remote get-url origin (remote)
          stdout: 'git@github.com:user/repo.git\n',
          stderr: '',
          exitCode: 0,
        })
        .mockResolvedValueOnce({
          // git status --porcelain (uncommitted changes)
          stdout: '',
          stderr: '',
          exitCode: 0,
        })
        .mockResolvedValueOnce({
          // git rev-list - fails in detached HEAD (no upstream)
          stdout: '',
          stderr: 'fatal: HEAD does not point to a branch',
          exitCode: 128,
        });

      const handler = handlers.get('git:info');
      const result = await handler!({} as any, '/test/repo');

      expect(result).toEqual({
        branch: 'HEAD',
        remote: 'git@github.com:user/repo.git',
        behind: 0,
        ahead: 0,
        uncommittedChanges: 0,
      });
    });
  });

  describe('git:log', () => {
    it('should return parsed log entries with correct structure', async () => {
      // Mock output with COMMIT_START marker format
      const logOutput = `COMMIT_STARTabc123456789|John Doe|2024-01-15T10:30:00+00:00|HEAD -> main, origin/main|Initial commit

 2 files changed, 50 insertions(+), 10 deletions(-)
COMMIT_STARTdef987654321|Jane Smith|2024-01-14T09:00:00+00:00||Add feature

 1 file changed, 25 insertions(+)`;

      vi.mocked(execFile.execFileNoThrow).mockResolvedValue({
        stdout: logOutput,
        stderr: '',
        exitCode: 0,
      });

      const handler = handlers.get('git:log');
      const result = await handler!({} as any, '/test/repo');

      expect(execFile.execFileNoThrow).toHaveBeenCalledWith(
        'git',
        [
          'log',
          '--max-count=100',
          '--pretty=format:COMMIT_START%H|%an|%ad|%D|%s',
          '--date=iso-strict',
          '--shortstat',
        ],
        '/test/repo'
      );

      expect(result).toEqual({
        entries: [
          {
            hash: 'abc123456789',
            shortHash: 'abc1234',
            author: 'John Doe',
            date: '2024-01-15T10:30:00+00:00',
            refs: ['HEAD -> main', 'origin/main'],
            subject: 'Initial commit',
            additions: 50,
            deletions: 10,
          },
          {
            hash: 'def987654321',
            shortHash: 'def9876',
            author: 'Jane Smith',
            date: '2024-01-14T09:00:00+00:00',
            refs: [],
            subject: 'Add feature',
            additions: 25,
            deletions: 0,
          },
        ],
        error: null,
      });
    });

    it('should use custom limit parameter', async () => {
      vi.mocked(execFile.execFileNoThrow).mockResolvedValue({
        stdout: '',
        stderr: '',
        exitCode: 0,
      });

      const handler = handlers.get('git:log');
      await handler!({} as any, '/test/repo', { limit: 50 });

      expect(execFile.execFileNoThrow).toHaveBeenCalledWith(
        'git',
        [
          'log',
          '--max-count=50',
          '--pretty=format:COMMIT_START%H|%an|%ad|%D|%s',
          '--date=iso-strict',
          '--shortstat',
        ],
        '/test/repo'
      );
    });

    it('should include search filter when provided', async () => {
      vi.mocked(execFile.execFileNoThrow).mockResolvedValue({
        stdout: '',
        stderr: '',
        exitCode: 0,
      });

      const handler = handlers.get('git:log');
      await handler!({} as any, '/test/repo', { search: 'bugfix' });

      expect(execFile.execFileNoThrow).toHaveBeenCalledWith(
        'git',
        [
          'log',
          '--max-count=100',
          '--pretty=format:COMMIT_START%H|%an|%ad|%D|%s',
          '--date=iso-strict',
          '--shortstat',
          '--all',
          '--grep=bugfix',
          '-i',
        ],
        '/test/repo'
      );
    });

    it('should return empty entries when no commits exist', async () => {
      vi.mocked(execFile.execFileNoThrow).mockResolvedValue({
        stdout: '',
        stderr: '',
        exitCode: 0,
      });

      const handler = handlers.get('git:log');
      const result = await handler!({} as any, '/test/repo');

      expect(result).toEqual({
        entries: [],
        error: null,
      });
    });

    it('should return error when not a git repo', async () => {
      vi.mocked(execFile.execFileNoThrow).mockResolvedValue({
        stdout: '',
        stderr: 'fatal: not a git repository',
        exitCode: 128,
      });

      const handler = handlers.get('git:log');
      const result = await handler!({} as any, '/not/a/repo');

      expect(result).toEqual({
        entries: [],
        error: 'fatal: not a git repository',
      });
    });

    it('should handle commit subject containing pipe characters', async () => {
      // Pipe character in commit subject should be preserved
      const logOutput = `COMMIT_STARTabc123|Author|2024-01-15T10:00:00+00:00||Fix: handle a | b condition

 1 file changed, 5 insertions(+)`;

      vi.mocked(execFile.execFileNoThrow).mockResolvedValue({
        stdout: logOutput,
        stderr: '',
        exitCode: 0,
      });

      const handler = handlers.get('git:log');
      const result = await handler!({} as any, '/test/repo');

      expect(result.entries[0].subject).toBe('Fix: handle a | b condition');
    });

    it('should handle commits without shortstat (no file changes)', async () => {
      // Merge commits or empty commits may not have shortstat
      const logOutput = `COMMIT_STARTabc1234567890abcdef1234567890abcdef12345678|Author|2024-01-15T10:00:00+00:00|HEAD -> main|Merge branch 'feature'`;

      vi.mocked(execFile.execFileNoThrow).mockResolvedValue({
        stdout: logOutput,
        stderr: '',
        exitCode: 0,
      });

      const handler = handlers.get('git:log');
      const result = await handler!({} as any, '/test/repo');

      expect(result.entries[0]).toEqual({
        hash: 'abc1234567890abcdef1234567890abcdef12345678',
        shortHash: 'abc1234',
        author: 'Author',
        date: '2024-01-15T10:00:00+00:00',
        refs: ['HEAD -> main'],
        subject: "Merge branch 'feature'",
        additions: 0,
        deletions: 0,
      });
    });
  });

  describe('git:commitCount', () => {
    it('should return commit count number', async () => {
      vi.mocked(execFile.execFileNoThrow).mockResolvedValue({
        stdout: '142\n',
        stderr: '',
        exitCode: 0,
      });

      const handler = handlers.get('git:commitCount');
      const result = await handler!({} as any, '/test/repo');

      expect(execFile.execFileNoThrow).toHaveBeenCalledWith(
        'git',
        ['rev-list', '--count', 'HEAD'],
        '/test/repo'
      );
      expect(result).toEqual({
        count: 142,
        error: null,
      });
    });

    it('should return 0 when repository has no commits', async () => {
      // Empty repo or unborn branch returns error
      vi.mocked(execFile.execFileNoThrow).mockResolvedValue({
        stdout: '',
        stderr: "fatal: bad revision 'HEAD'",
        exitCode: 128,
      });

      const handler = handlers.get('git:commitCount');
      const result = await handler!({} as any, '/empty/repo');

      expect(result).toEqual({
        count: 0,
        error: "fatal: bad revision 'HEAD'",
      });
    });

    it('should return error when not a git repo', async () => {
      vi.mocked(execFile.execFileNoThrow).mockResolvedValue({
        stdout: '',
        stderr: 'fatal: not a git repository',
        exitCode: 128,
      });

      const handler = handlers.get('git:commitCount');
      const result = await handler!({} as any, '/not/a/repo');

      expect(result).toEqual({
        count: 0,
        error: 'fatal: not a git repository',
      });
    });

    it('should handle large commit counts', async () => {
      vi.mocked(execFile.execFileNoThrow).mockResolvedValue({
        stdout: '50000\n',
        stderr: '',
        exitCode: 0,
      });

      const handler = handlers.get('git:commitCount');
      const result = await handler!({} as any, '/large/repo');

      expect(result).toEqual({
        count: 50000,
        error: null,
      });
    });

    it('should return 0 for non-numeric output', async () => {
      // Edge case: if somehow git returns non-numeric output
      vi.mocked(execFile.execFileNoThrow).mockResolvedValue({
        stdout: 'not a number\n',
        stderr: '',
        exitCode: 0,
      });

      const handler = handlers.get('git:commitCount');
      const result = await handler!({} as any, '/test/repo');

      // parseInt returns NaN for "not a number", || 0 returns 0
      expect(result).toEqual({
        count: 0,
        error: null,
      });
    });
  });

  describe('git:show', () => {
    it('should return commit details with stat and patch', async () => {
      const showOutput = `commit abc123456789abcdef1234567890abcdef12345678
Author: John Doe <john@example.com>
Date:   Mon Jan 15 10:30:00 2024 +0000

    Add new feature

 src/feature.ts | 25 +++++++++++++++++++++++++
 1 file changed, 25 insertions(+)

diff --git a/src/feature.ts b/src/feature.ts
new file mode 100644
index 0000000..abc1234
--- /dev/null
+++ b/src/feature.ts
@@ -0,0 +1,25 @@
+// New feature code here
+export function newFeature() {
+  return true;
+}`;

      vi.mocked(execFile.execFileNoThrow).mockResolvedValue({
        stdout: showOutput,
        stderr: '',
        exitCode: 0,
      });

      const handler = handlers.get('git:show');
      const result = await handler!({} as any, '/test/repo', 'abc123456789');

      expect(execFile.execFileNoThrow).toHaveBeenCalledWith(
        'git',
        ['show', '--stat', '--patch', 'abc123456789'],
        '/test/repo'
      );
      expect(result).toEqual({
        stdout: showOutput,
        stderr: '',
      });
    });

    it('should return stderr for invalid commit hash', async () => {
      vi.mocked(execFile.execFileNoThrow).mockResolvedValue({
        stdout: '',
        stderr: "fatal: bad object invalidhash123",
        exitCode: 128,
      });

      const handler = handlers.get('git:show');
      const result = await handler!({} as any, '/test/repo', 'invalidhash123');

      expect(execFile.execFileNoThrow).toHaveBeenCalledWith(
        'git',
        ['show', '--stat', '--patch', 'invalidhash123'],
        '/test/repo'
      );
      expect(result).toEqual({
        stdout: '',
        stderr: "fatal: bad object invalidhash123",
      });
    });

    it('should handle short commit hashes', async () => {
      const showOutput = `commit abc1234
Author: Jane Doe <jane@example.com>
Date:   Tue Jan 16 14:00:00 2024 +0000

    Fix bug

 src/fix.ts | 2 +-
 1 file changed, 1 insertion(+), 1 deletion(-)`;

      vi.mocked(execFile.execFileNoThrow).mockResolvedValue({
        stdout: showOutput,
        stderr: '',
        exitCode: 0,
      });

      const handler = handlers.get('git:show');
      const result = await handler!({} as any, '/test/repo', 'abc1234');

      expect(execFile.execFileNoThrow).toHaveBeenCalledWith(
        'git',
        ['show', '--stat', '--patch', 'abc1234'],
        '/test/repo'
      );
      expect(result).toEqual({
        stdout: showOutput,
        stderr: '',
      });
    });

    it('should return stderr when not a git repo', async () => {
      vi.mocked(execFile.execFileNoThrow).mockResolvedValue({
        stdout: '',
        stderr: 'fatal: not a git repository',
        exitCode: 128,
      });

      const handler = handlers.get('git:show');
      const result = await handler!({} as any, '/not/a/repo', 'abc123');

      expect(result).toEqual({
        stdout: '',
        stderr: 'fatal: not a git repository',
      });
    });

    it('should handle merge commits with multiple parents', async () => {
      const mergeShowOutput = `commit def789012345abcdef789012345abcdef12345678
Merge: abc1234 xyz5678
Author: Developer <dev@example.com>
Date:   Wed Jan 17 09:00:00 2024 +0000

    Merge branch 'feature' into main

 src/merged.ts | 10 ++++++++++
 1 file changed, 10 insertions(+)`;

      vi.mocked(execFile.execFileNoThrow).mockResolvedValue({
        stdout: mergeShowOutput,
        stderr: '',
        exitCode: 0,
      });

      const handler = handlers.get('git:show');
      const result = await handler!({} as any, '/test/repo', 'def789012345');

      expect(result).toEqual({
        stdout: mergeShowOutput,
        stderr: '',
      });
    });
  });

  describe('git:showFile', () => {
    beforeEach(() => {
      // Reset the spawnSync mock before each test in this describe block
      mockSpawnSync.mockReset();
    });

    it('should return file content for text files', async () => {
      const fileContent = `import React from 'react';

export function Component() {
  return <div>Hello World</div>;
}`;

      vi.mocked(execFile.execFileNoThrow).mockResolvedValue({
        stdout: fileContent,
        stderr: '',
        exitCode: 0,
      });

      const handler = handlers.get('git:showFile');
      const result = await handler!({} as any, '/test/repo', 'HEAD', 'src/Component.tsx');

      expect(execFile.execFileNoThrow).toHaveBeenCalledWith(
        'git',
        ['show', 'HEAD:src/Component.tsx'],
        '/test/repo'
      );
      expect(result).toEqual({
        content: fileContent,
      });
    });

    it('should return error when file not found in commit', async () => {
      vi.mocked(execFile.execFileNoThrow).mockResolvedValue({
        stdout: '',
        stderr: "fatal: path 'nonexistent.txt' does not exist in 'HEAD'",
        exitCode: 128,
      });

      const handler = handlers.get('git:showFile');
      const result = await handler!({} as any, '/test/repo', 'HEAD', 'nonexistent.txt');

      expect(result).toEqual({
        error: "fatal: path 'nonexistent.txt' does not exist in 'HEAD'",
      });
    });

    it('should return error for invalid commit reference', async () => {
      vi.mocked(execFile.execFileNoThrow).mockResolvedValue({
        stdout: '',
        stderr: "fatal: invalid object name 'invalidref'",
        exitCode: 128,
      });

      const handler = handlers.get('git:showFile');
      const result = await handler!({} as any, '/test/repo', 'invalidref', 'file.txt');

      expect(result).toEqual({
        error: "fatal: invalid object name 'invalidref'",
      });
    });

    // Note: Image file handling tests use spawnSync which is mocked via vi.hoisted.
    // The handler uses require('child_process') at runtime, which interacts with
    // the mock through the gif error test below. Full success path testing for
    // image files requires integration tests.

    it('should recognize image files and use spawnSync for them', async () => {
      // The handler takes different code paths for images vs text files.
      // This test verifies that image files (gif) trigger the spawnSync path
      // by checking the error response when spawnSync returns a failure status.
      mockSpawnSync.mockReturnValue({
        stdout: Buffer.from(''),
        stderr: undefined,
        status: 1,
        pid: 1234,
        output: [null, Buffer.from(''), undefined],
        signal: null,
      });

      const handler = handlers.get('git:showFile');
      const result = await handler!({} as any, '/test/repo', 'HEAD', 'assets/logo.gif');

      // The fact we get this specific error proves the spawnSync path was taken
      expect(result).toEqual({
        error: 'Failed to read file from git',
      });
    });

    it('should handle different git refs (tags, branches, commit hashes)', async () => {
      const fileContent = 'version = "1.0.0"';

      vi.mocked(execFile.execFileNoThrow).mockResolvedValue({
        stdout: fileContent,
        stderr: '',
        exitCode: 0,
      });

      const handler = handlers.get('git:showFile');

      // Test with tag
      await handler!({} as any, '/test/repo', 'v1.0.0', 'package.json');
      expect(execFile.execFileNoThrow).toHaveBeenLastCalledWith(
        'git',
        ['show', 'v1.0.0:package.json'],
        '/test/repo'
      );

      // Test with branch
      await handler!({} as any, '/test/repo', 'feature/new-feature', 'config.ts');
      expect(execFile.execFileNoThrow).toHaveBeenLastCalledWith(
        'git',
        ['show', 'feature/new-feature:config.ts'],
        '/test/repo'
      );

      // Test with short commit hash
      await handler!({} as any, '/test/repo', 'abc1234', 'README.md');
      expect(execFile.execFileNoThrow).toHaveBeenLastCalledWith(
        'git',
        ['show', 'abc1234:README.md'],
        '/test/repo'
      );
    });

    it('should return fallback error when image spawnSync fails without stderr', async () => {
      // When spawnSync fails without a stderr message, we get the fallback error
      mockSpawnSync.mockReturnValue({
        stdout: Buffer.from(''),
        stderr: Buffer.from(''),
        status: 128,
        pid: 1234,
        output: [null, Buffer.from(''), Buffer.from('')],
        signal: null,
      });

      const handler = handlers.get('git:showFile');
      const result = await handler!({} as any, '/test/repo', 'HEAD', 'missing.gif');

      // The empty stderr results in the fallback error message
      expect(result).toEqual({
        error: 'Failed to read file from git',
      });
    });

    it('should return fallback error for text files when execFile fails with no stderr', async () => {
      vi.mocked(execFile.execFileNoThrow).mockResolvedValue({
        stdout: '',
        stderr: '',
        exitCode: 1,
      });

      const handler = handlers.get('git:showFile');
      const result = await handler!({} as any, '/test/repo', 'HEAD', 'missing.txt');

      expect(result).toEqual({
        error: 'Failed to read file from git',
      });
    });

    it('should handle file paths with special characters', async () => {
      const fileContent = 'content';

      vi.mocked(execFile.execFileNoThrow).mockResolvedValue({
        stdout: fileContent,
        stderr: '',
        exitCode: 0,
      });

      const handler = handlers.get('git:showFile');
      await handler!({} as any, '/test/repo', 'HEAD', 'path with spaces/file (1).txt');

      expect(execFile.execFileNoThrow).toHaveBeenCalledWith(
        'git',
        ['show', 'HEAD:path with spaces/file (1).txt'],
        '/test/repo'
      );
    });
  });

  describe('git:worktreeInfo', () => {
    it('should return exists: false when path does not exist', async () => {
      // Mock fs.access to throw (path doesn't exist)
      const fsPromises = await import('fs/promises');
      vi.mocked(fsPromises.default.access).mockRejectedValue(new Error('ENOENT'));

      const handler = handlers.get('git:worktreeInfo');
      const result = await handler!({} as any, '/nonexistent/path');

      // createIpcHandler wraps the result with success: true
      expect(result).toEqual({
        success: true,
        exists: false,
        isWorktree: false,
      });
    });

    it('should return isWorktree: false when path exists but is not a git repo', async () => {
      // Mock fs.access to succeed (path exists)
      const fsPromises = await import('fs/promises');
      vi.mocked(fsPromises.default.access).mockResolvedValue(undefined);

      // Mock git rev-parse --is-inside-work-tree to fail (not a git repo)
      vi.mocked(execFile.execFileNoThrow).mockResolvedValue({
        stdout: '',
        stderr: 'fatal: not a git repository',
        exitCode: 128,
      });

      const handler = handlers.get('git:worktreeInfo');
      const result = await handler!({} as any, '/not/a/repo');

      expect(result).toEqual({
        success: true,
        exists: true,
        isWorktree: false,
      });
    });

    it('should return worktree info when path is a worktree', async () => {
      // Mock fs.access to succeed (path exists)
      const fsPromises = await import('fs/promises');
      vi.mocked(fsPromises.default.access).mockResolvedValue(undefined);

      // Setup mock responses for the sequence of git commands
      vi.mocked(execFile.execFileNoThrow)
        .mockResolvedValueOnce({
          // git rev-parse --is-inside-work-tree
          stdout: 'true\n',
          stderr: '',
          exitCode: 0,
        })
        .mockResolvedValueOnce({
          // git rev-parse --git-dir
          stdout: '.git\n',
          stderr: '',
          exitCode: 0,
        })
        .mockResolvedValueOnce({
          // git rev-parse --git-common-dir (different = worktree)
          stdout: '/main/repo/.git\n',
          stderr: '',
          exitCode: 0,
        })
        .mockResolvedValueOnce({
          // git rev-parse --abbrev-ref HEAD (branch)
          stdout: 'feature/my-branch\n',
          stderr: '',
          exitCode: 0,
        })
        .mockResolvedValueOnce({
          // git rev-parse --show-toplevel (repo root)
          stdout: '/worktree/path\n',
          stderr: '',
          exitCode: 0,
        });

      const handler = handlers.get('git:worktreeInfo');
      const result = await handler!({} as any, '/worktree/path');

      expect(result).toEqual({
        success: true,
        exists: true,
        isWorktree: true,
        currentBranch: 'feature/my-branch',
        repoRoot: '/main/repo',
      });
    });

    it('should return isWorktree: false when path is a main git repo', async () => {
      // Mock fs.access to succeed (path exists)
      const fsPromises = await import('fs/promises');
      vi.mocked(fsPromises.default.access).mockResolvedValue(undefined);

      // Setup mock responses for main repo (git-dir equals git-common-dir)
      vi.mocked(execFile.execFileNoThrow)
        .mockResolvedValueOnce({
          // git rev-parse --is-inside-work-tree
          stdout: 'true\n',
          stderr: '',
          exitCode: 0,
        })
        .mockResolvedValueOnce({
          // git rev-parse --git-dir
          stdout: '.git\n',
          stderr: '',
          exitCode: 0,
        })
        .mockResolvedValueOnce({
          // git rev-parse --git-common-dir (same as git-dir = not a worktree)
          stdout: '.git\n',
          stderr: '',
          exitCode: 0,
        })
        .mockResolvedValueOnce({
          // git rev-parse --abbrev-ref HEAD (branch)
          stdout: 'main\n',
          stderr: '',
          exitCode: 0,
        })
        .mockResolvedValueOnce({
          // git rev-parse --show-toplevel (repo root)
          stdout: '/main/repo\n',
          stderr: '',
          exitCode: 0,
        });

      const handler = handlers.get('git:worktreeInfo');
      const result = await handler!({} as any, '/main/repo');

      expect(result).toEqual({
        success: true,
        exists: true,
        isWorktree: false,
        currentBranch: 'main',
        repoRoot: '/main/repo',
      });
    });

    it('should handle detached HEAD state in worktree', async () => {
      // Mock fs.access to succeed (path exists)
      const fsPromises = await import('fs/promises');
      vi.mocked(fsPromises.default.access).mockResolvedValue(undefined);

      vi.mocked(execFile.execFileNoThrow)
        .mockResolvedValueOnce({
          // git rev-parse --is-inside-work-tree
          stdout: 'true\n',
          stderr: '',
          exitCode: 0,
        })
        .mockResolvedValueOnce({
          // git rev-parse --git-dir
          stdout: '.git\n',
          stderr: '',
          exitCode: 0,
        })
        .mockResolvedValueOnce({
          // git rev-parse --git-common-dir (different = worktree)
          stdout: '/main/repo/.git\n',
          stderr: '',
          exitCode: 0,
        })
        .mockResolvedValueOnce({
          // git rev-parse --abbrev-ref HEAD (detached HEAD)
          stdout: 'HEAD\n',
          stderr: '',
          exitCode: 0,
        })
        .mockResolvedValueOnce({
          // git rev-parse --show-toplevel
          stdout: '/worktree/path\n',
          stderr: '',
          exitCode: 0,
        });

      const handler = handlers.get('git:worktreeInfo');
      const result = await handler!({} as any, '/worktree/path');

      expect(result).toEqual({
        success: true,
        exists: true,
        isWorktree: true,
        currentBranch: 'HEAD',
        repoRoot: '/main/repo',
      });
    });

    it('should handle branch command failure gracefully', async () => {
      // Mock fs.access to succeed (path exists)
      const fsPromises = await import('fs/promises');
      vi.mocked(fsPromises.default.access).mockResolvedValue(undefined);

      vi.mocked(execFile.execFileNoThrow)
        .mockResolvedValueOnce({
          // git rev-parse --is-inside-work-tree
          stdout: 'true\n',
          stderr: '',
          exitCode: 0,
        })
        .mockResolvedValueOnce({
          // git rev-parse --git-dir
          stdout: '.git\n',
          stderr: '',
          exitCode: 0,
        })
        .mockResolvedValueOnce({
          // git rev-parse --git-common-dir
          stdout: '.git\n',
          stderr: '',
          exitCode: 0,
        })
        .mockResolvedValueOnce({
          // git rev-parse --abbrev-ref HEAD (fails - empty repo)
          stdout: '',
          stderr: "fatal: bad revision 'HEAD'",
          exitCode: 128,
        })
        .mockResolvedValueOnce({
          // git rev-parse --show-toplevel
          stdout: '/main/repo\n',
          stderr: '',
          exitCode: 0,
        });

      const handler = handlers.get('git:worktreeInfo');
      const result = await handler!({} as any, '/main/repo');

      expect(result).toEqual({
        success: true,
        exists: true,
        isWorktree: false,
        currentBranch: undefined,
        repoRoot: '/main/repo',
      });
    });
  });
});
