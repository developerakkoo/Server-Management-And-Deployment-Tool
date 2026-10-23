const { exec } = require('child_process');
const { promisify } = require('util');
const { TOOLS, STEP_TOOL_MAP } = require('./tools-registry');
const { parseDeployCommands } = require('./deploy-command-parser');

const execAsync = promisify(exec);

const DETECT_TIMEOUT_MS = 5000;

function getPlatform() {
  if (process.platform === 'darwin') return 'mac';
  if (process.platform === 'linux') return 'linux';
  if (process.platform === 'win32') return 'windows';
  return 'linux';
}

function parseVersion(toolKey, stdout, stderr) {
  const combined = `${stdout || ''}\n${stderr || ''}`.trim();
  if (!combined) return null;

  const patterns = {
    rsync: /rsync\s+version\s+([\d.]+)/i,
    ssh: /OpenSSH[_\s]+([\w._-]+)/i,
    git: /git version\s+([\d.]+)/i,
    node: /v?([\d]+\.[\d]+\.[\d]+)/,
    zip: /([\d]+\.[\d]+)/,
    docker: /Docker version\s+([\d.]+)/i,
  };

  const pattern = patterns[toolKey];
  if (pattern) {
    const match = combined.match(pattern);
    if (match) return match[1];
  }

  const firstLine = combined.split('\n')[0].trim();
  return firstLine.length > 80 ? firstLine.slice(0, 80) + '…' : firstLine;
}

async function detect(toolKey) {
  const tool = TOOLS[toolKey];
  const platform = getPlatform();

  if (!tool) {
    return {
      toolKey,
      available: false,
      version: null,
      platform,
      error: `Unknown tool: ${toolKey}`,
      critical: false,
    };
  }

  try {
    const { stdout, stderr } = await execAsync(tool.checkCommand, {
      timeout: DETECT_TIMEOUT_MS,
      windowsHide: true,
      shell: process.platform === 'win32' ? 'cmd.exe' : '/bin/sh',
    });

    const version = parseVersion(toolKey, stdout, stderr);

    return {
      toolKey,
      available: true,
      version,
      platform,
      error: null,
      critical: !!tool.critical,
      name: tool.name,
      description: tool.description,
      icon: tool.icon,
    };
  } catch (err) {
    if (toolKey === 'ssh' && err.killed) {
      return {
        toolKey,
        available: false,
        version: null,
        platform,
        error: err.message || 'Detection timed out',
        critical: !!tool.critical,
        name: tool.name,
        description: tool.description,
        icon: tool.icon,
      };
    }

    if (toolKey === 'node') {
      try {
        const { stdout, stderr } = await execAsync('node --version', {
          timeout: DETECT_TIMEOUT_MS,
          windowsHide: true,
        });
        const version = parseVersion(toolKey, stdout, stderr);
        return {
          toolKey,
          available: true,
          version,
          platform,
          error: null,
          critical: !!tool.critical,
          name: tool.name,
          description: tool.description,
          icon: tool.icon,
        };
      } catch {
        // fall through
      }
    }

    return {
      toolKey,
      available: false,
      version: null,
      platform,
      error: err.message || 'Command not found',
      critical: !!tool.critical,
      name: tool.name,
      description: tool.description,
      icon: tool.icon,
    };
  }
}

async function detectAll(toolKeys) {
  const unique = [...new Set(toolKeys.filter((key) => TOOLS[key]))];
  return Promise.all(unique.map((key) => detect(key)));
}

function inferStepTypeFromCommand(command) {
  const trimmed = command.trim();
  const lower = trimmed.toLowerCase();

  if (/^rsync\s/.test(lower) || /\brsync\s+-/.test(lower)) return 'RSYNC';
  if (/\bgit\s+(pull|fetch|clone|checkout)\b/.test(lower)) return 'GIT_PULL';
  if (/^npm\s|^npx\s|^node\s/.test(lower)) return 'LOCAL_SHELL';
  if (/^zip\s|^unzip\s/.test(lower)) return 'LOCAL_ZIP';
  if (/\bdocker\s/.test(lower)) return 'DOCKER';
  if (/^scp\s/.test(lower)) return 'SCP_FILE';
  if (/^sftp\s/.test(lower)) return 'SFTP_UPLOAD';
  if (/\bpm2\s/.test(lower)) return 'PM2_COMMAND';
  if (/\bnginx\s+-t\b/.test(lower) || /\bsystemctl\s+reload\s+nginx\b/.test(lower)) {
    return 'NGINX_RELOAD';
  }

  return 'SSH_COMMAND';
}

function getToolsForStepType(stepType, command = '') {
  const mapped = STEP_TOOL_MAP[stepType];
  if (!mapped) return ['ssh'];

  if (stepType === 'LOCAL_SHELL') {
    const lower = command.trim().toLowerCase();
    if (/^(npm|npx|node)\s/.test(lower)) {
      return ['node'];
    }
    if (/^docker\s/.test(lower)) {
      return ['docker'];
    }
    return [];
  }

  return [...mapped];
}

async function detectForStep(stepType, command = '') {
  const toolKeys = getToolsForStepType(stepType, command);
  if (toolKeys.length === 0) return [];
  return detectAll(toolKeys);
}

function collectToolsForProject(project) {
  const toolSet = new Set(['ssh']);
  const lines = parseDeployCommands(project.deployCommands || '');

  for (const line of lines) {
    const lower = line.toLowerCase();
    if (/\brsync\b/.test(lower)) toolSet.add('rsync');
    if (/\bzip\b/.test(lower)) toolSet.add('zip');
    if (/\bdocker\b/.test(lower)) toolSet.add('docker');
    if (/\bgit\b/.test(lower)) toolSet.add('git');
    if (/^(npm|npx|node)\s/.test(lower) || /\bnpm install\b/.test(lower)) toolSet.add('node');
  }

  return [...toolSet];
}

async function preDeployToolCheck(project) {
  const requiredTools = collectToolsForProject(project);
  const results = await detectAll(requiredTools);
  const missing = results.filter((r) => !r.available);

  return {
    ok: missing.length === 0,
    requiredTools,
    results,
    missingTools: missing,
  };
}

function isCriticalMissing(results) {
  return results.some((r) => !r.available && (TOOLS[r.toolKey]?.critical || r.critical));
}

module.exports = {
  detect,
  detectAll,
  detectForStep,
  getPlatform,
  inferStepTypeFromCommand,
  getToolsForStepType,
  collectToolsForProject,
  preDeployToolCheck,
  isCriticalMissing,
};
