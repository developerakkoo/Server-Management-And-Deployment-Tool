const { Client } = require('ssh2');
const fs = require('fs');
const { classifyDeployError } = require('./error-classifier');

const activeConnections = new Map();
const DEFAULT_COMMAND_TIMEOUT_MS = 10 * 60 * 1000;

function readPrivateKey(keyPath) {
  if (!keyPath || !fs.existsSync(keyPath)) {
    const err = new Error(`SSH private key not found at: ${keyPath || '(not set)'}`);
    err.code = 'SSH_KEY_MISSING';
    throw err;
  }
  return fs.readFileSync(keyPath, 'utf8');
}

function buildConnectConfig(project) {
  const config = {
    host: project.host,
    port: project.port || 22,
    username: project.username,
    readyTimeout: 30000,
    keepaliveInterval: 10000,
  };

  const authMethod = project.authMethod || (project.password ? 'password' : 'pem-key');

  if (authMethod === 'password') {
    if (!project.password) {
      const err = new Error('SSH password not configured');
      err.code = 'SSH_AUTH_FAILED';
      throw err;
    }
    config.password = project.password;
    return config;
  }

  config.privateKey = readPrivateKey(project.privateKeyPath);
  return config;
}

function connectSSH(project) {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    let connectConfig;

    try {
      connectConfig = buildConnectConfig(project);
    } catch (err) {
      reject(err);
      return;
    }

    const timeout = setTimeout(() => {
      conn.end();
      const err = new Error('Connection timed out after 30 seconds');
      err.code = 'SSH_CONNECT_TIMEOUT';
      reject(err);
    }, 30000);

    conn.on('ready', () => {
      clearTimeout(timeout);
      resolve(conn);
    });

    conn.on('error', (err) => {
      clearTimeout(timeout);
      const wrapped = new Error(`UNABLE TO ESTABLISH SECURE CHANNEL: ${err.message}`);
      wrapped.code = 'SSH_AUTH_FAILED';
      if (err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND') {
        wrapped.code = 'SSH_HOST_UNREACHABLE';
      }
      reject(wrapped);
    });

    conn.connect(connectConfig);
  });
}

function execCommand(conn, command, onOutput, timeoutMs = DEFAULT_COMMAND_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    conn.exec(command, { pty: false }, (err, stream) => {
      if (err) {
        reject(err);
        return;
      }

      let stdout = '';
      let stderr = '';
      let timedOut = false;

      const timer = setTimeout(() => {
        timedOut = true;
        try {
          stream.close();
        } catch {
          // stream may already be closed
        }
        resolve({
          code: 124,
          stdout,
          stderr: stderr + '\nCommand timed out',
          timedOut: true,
        });
      }, timeoutMs);

      stream.on('error', (streamErr) => {
        clearTimeout(timer);
        resolve({
          code: 1,
          stdout,
          stderr: stderr + (stderr ? '\n' : '') + streamErr.message,
          timedOut: false,
        });
      });

      stream.on('close', (code) => {
        clearTimeout(timer);
        resolve({
          code: timedOut ? 124 : code == null ? 1 : code,
          stdout,
          stderr,
          timedOut,
        });
      });

      stream.on('data', (data) => {
        const text = data.toString();
        stdout += text;
        if (onOutput) {
          onOutput(text, 'stdout');
        }
      });

      stream.stderr.on('data', (data) => {
        const text = data.toString();
        stderr += text;
        if (onOutput) {
          onOutput(text, 'stderr');
        }
      });
    });
  });
}

async function testConnection(project) {
  let conn;
  try {
    conn = await connectSSH(project);
    const result = await execCommand(conn, 'echo "TECHLAPSE_CONNECTION_OK"', null, 15000);
    const success = result.code === 0 && result.stdout.includes('TECHLAPSE_CONNECTION_OK');
    return {
      success,
      message: success ? 'Secure channel established' : 'Connection test failed',
      error: success ? null : result.stderr || 'Unknown error',
      errorCode: success ? null : 'SSH_AUTH_FAILED',
    };
  } catch (err) {
    const classified = classifyDeployError({ err });
    return {
      success: false,
      message: classified.message,
      error: err.message,
      errorCode: classified.code,
      fixHint: classified.fixHint,
    };
  } finally {
    if (conn) {
      conn.end();
    }
  }
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function openShell(conn) {
  return new Promise((resolve, reject) => {
    conn.shell({ term: 'dumb' }, (err, stream) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(stream);
    });
  });
}

function wrapShellCommand(command, marker) {
  const b64 = Buffer.from(command, 'utf8').toString('base64');
  return `eval "$(echo ${b64} | base64 -d)"; echo "${marker}:$?"`;
}

function execInShell(stream, command, onOutput, timeoutMs) {
  return new Promise((resolve) => {
    const marker = `__TL_STEP_${Date.now()}_${Math.random().toString(36).slice(2, 8)}__`;
    const wrapped = wrapShellCommand(command, marker);
    const markerPattern = new RegExp(`${marker}:(\\d+)`);
    let buffer = '';
    let settled = false;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      stream.removeListener('data', onData);
      if (stream.stderr) {
        stream.stderr.removeListener('data', onStderr);
      }
      resolve(result);
    };

    const emitText = (text, type) => {
      if (!onOutput || !text) return;
      const lines = text.split('\n');
      for (const line of lines) {
        if (line.trim()) {
          onOutput(line, type);
        }
      }
    };

    const onData = (data) => {
      const text = data.toString();
      buffer += text;
      emitText(text, 'stdout');

      const match = buffer.match(markerPattern);
      if (match) {
        const code = parseInt(match[1], 10);
        finish({
          code: Number.isNaN(code) ? 1 : code,
          stdout: buffer,
          stderr: '',
          timedOut: false,
        });
      }
    };

    const onStderr = (data) => {
      const text = data.toString();
      buffer += text;
      emitText(text, 'stderr');
    };

    const timer = setTimeout(() => {
      finish({
        code: 124,
        stdout: buffer,
        stderr: buffer + '\nCommand timed out',
        timedOut: true,
      });
    }, timeoutMs);

    stream.on('data', onData);
    if (stream.stderr) {
      stream.stderr.on('data', onStderr);
    }

    stream.write(`${wrapped}\n`);
  });
}

async function runDeploySequence(project, commands, onLine, projectId, options = {}) {
  let conn;
  let shellStream;
  const connectionId = projectId || project.id;
  const commandTimeoutMs = options.commandTimeoutMs || DEFAULT_COMMAND_TIMEOUT_MS;
  const globalStepOffset = options.globalStepOffset || 0;
  const onStepComplete = options.onStepComplete;
  const stepTimings = [];
  const projectPath = (project.projectPath || '').trim();

  try {
    conn = await connectSSH(project);
    activeConnections.set(connectionId, conn);
    shellStream = await openShell(conn);

    if (projectPath) {
      onLine(`$ cd ${projectPath}`, 'command', globalStepOffset || 1);
      const cdResult = await execInShell(
        shellStream,
        `cd ${shellQuote(projectPath)}`,
        (text, type) => onLine(text, type === 'stderr' ? 'error' : 'output', globalStepOffset || 1),
        commandTimeoutMs
      );

      if (cdResult.code !== 0 || cdResult.timedOut) {
        return {
          success: false,
          stepIndex: globalStepOffset + 1,
          step: 'cd project',
          userCommand: `cd ${projectPath}`,
          command: `cd ${shellQuote(projectPath)}`,
          code: cdResult.code,
          stderr: cdResult.stderr || 'Failed to change to project directory',
          stdout: cdResult.stdout,
          timedOut: cdResult.timedOut,
          stepType: 'ssh',
          stepTimings,
        };
      }
      onLine(`Working directory: ${projectPath}`, 'system', globalStepOffset || 1);
    }

    for (let i = 0; i < commands.length; i++) {
      const step = commands[i];
      const globalStep = globalStepOffset + i + 1;

      if (!activeConnections.has(connectionId)) {
        return {
          success: false,
          aborted: true,
          stepIndex: globalStep,
          step: step.name,
          userCommand: step.userCommand,
          command: step.command,
          stepTimings,
        };
      }

      onLine(`$ ${step.command}`, 'command', globalStep);
      const stepStart = Date.now();

      const result = await execInShell(
        shellStream,
        step.command,
        (text, type) => {
          onLine(text, type === 'stderr' ? 'error' : 'output', globalStep);
        },
        commandTimeoutMs
      );

      if (result.code !== 0 || result.timedOut) {
        return {
          success: false,
          stepIndex: globalStep,
          step: step.name,
          userCommand: step.userCommand,
          command: step.command,
          code: result.code,
          stderr: result.stderr,
          stdout: result.stdout,
          timedOut: result.timedOut,
          stepType: 'ssh',
          stepTimings,
        };
      }

      const stepDuration = Math.round((Date.now() - stepStart) / 1000);
      const timing = {
        step: globalStep,
        name: step.name,
        command: step.userCommand || step.command,
        durationSeconds: stepDuration,
        type: 'ssh',
      };
      stepTimings.push(timing);
      onStepComplete?.(timing);
      onLine(`[${stepDuration}s] Step ${globalStep} complete`, 'system', globalStep);
    }

    return { success: true, stepTimings };
  } catch (err) {
    return {
      success: false,
      error: err.message,
      err,
      stepIndex: globalStepOffset + 1,
      stepTimings,
    };
  } finally {
    activeConnections.delete(connectionId);
    if (shellStream) {
      try {
        shellStream.end('exit\n');
      } catch {
        // shell may already be closed
      }
    }
    if (conn) {
      conn.end();
    }
  }
}

function cancelConnection(projectId) {
  const conn = activeConnections.get(projectId);
  if (conn) {
    activeConnections.delete(projectId);
    conn.end();
    return { success: true };
  }
  return { success: false, message: 'No active connection' };
}

module.exports = {
  connectSSH,
  execCommand,
  testConnection,
  runDeploySequence,
  cancelConnection,
  DEFAULT_COMMAND_TIMEOUT_MS,
};
