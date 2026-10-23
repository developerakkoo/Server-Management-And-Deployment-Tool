const ERROR_CATALOG = {
  SSH_CONNECT_TIMEOUT: {
    message: 'SSH connection timed out',
    fixHint: 'Check host, port, firewall, and that the server is online.',
  },
  SSH_AUTH_FAILED: {
    message: 'SSH authentication failed',
    fixHint: 'Verify PEM key path, password, or username.',
  },
  SSH_KEY_MISSING: {
    message: 'SSH private key not found',
    fixHint: 'Browse and select a valid PEM key file in project settings.',
  },
  SSH_HOST_UNREACHABLE: {
    message: 'Server host unreachable',
    fixHint: 'Check host IP, DNS, port 22, and network connectivity.',
  },
  COMMAND_TIMEOUT: {
    message: 'Command timed out',
    fixHint: 'Increase command timeout in settings or split long-running commands.',
  },
  COMMAND_NOT_FOUND: {
    message: 'Command not found on server',
    fixHint: 'Install the required tool on the server or fix the command spelling.',
  },
  GIT_CONFLICT: {
    message: 'Git merge conflict',
    fixHint: 'SSH to the server, resolve conflicts manually, then re-deploy.',
  },
  GIT_AUTH_FAILED: {
    message: 'Git authentication failed',
    fixHint: 'Ensure deploy keys or git credentials are configured on the server.',
  },
  GIT_PUSH_FAILED: {
    message: 'Git push failed',
    fixHint:
      'Check remote URL, branch name, and that git credentials work when pushing from Local Project Path.',
  },
  GIT_NOT_REPO: {
    message: 'Folder is not a Git repository',
    fixHint: 'Run git init in Local Project Path or disable Push to Git after build.',
  },
  BUILD_FAILED: {
    message: 'Build command failed',
    fixHint: 'Check build output — verify dependencies, Node version, and build script.',
  },
  PATH_NOT_FOUND: {
    message: 'Path not found on server',
    fixHint: 'Verify Remote Project Path, output folder, and Live Nginx Path.',
  },
  PERMISSION_DENIED: {
    message: 'Permission denied',
    fixHint: 'Add sudo to commands or fix file/directory permissions on the server.',
  },
  NGINX_INVALID: {
    message: 'Nginx configuration invalid',
    fixHint: 'SSH to server and run nginx -t to inspect config errors.',
  },
  PM2_NOT_FOUND: {
    message: 'PM2 is not installed on the server',
    fixHint: 'SSH to the server and install PM2 globally: npm install -g pm2',
  },
  PM2_APP_MISSING: {
    message: 'PM2 app not found on server',
    fixHint: 'Verify PM2 App Name matches `pm2 list` on the server, then save the project.',
  },
  PM2_RESTART_FAILED: {
    message: 'PM2 restart failed',
    fixHint: 'SSH to server, run pm2 list and pm2 logs <app> to diagnose the process.',
  },
  COPY_FAILED: {
    message: 'Copy command failed',
    fixHint:
      'Use cp -r www/* {{liveWwwPath}}/ (not {{projectPath}}/www) after build. Set Remote Project Path to full path e.g. /root/Website-tracker-Front-End.',
  },
  VALIDATION_FAILED: {
    message: 'Deploy commands invalid',
    fixHint: 'Fix missing fields or unresolved {{placeholders}} in deploy commands.',
  },
  TOOLS_MISSING: {
    message: 'Deploy blocked — missing required tools',
    fixHint: 'Install missing CLI tools on your machine using the install guide, then retry.',
  },
  SYNC_FAILED: {
    message: 'File sync to server failed',
    fixHint: 'Check SSH credentials, host, live path, and that the server is reachable.',
  },
  LOCAL_BUILD_FAILED: {
    message: 'Local build command failed',
    fixHint: 'Fix the Local Build Command — verify Node/npm and run it manually in Local Project Path.',
  },
  LOCAL_PATH_MISSING: {
    message: 'Local project path not found',
    fixHint: 'Set Local Project Path and ensure the folder exists on your machine.',
  },
  SYNC_AUTH_UNSUPPORTED: {
    message: 'Local sync authentication not configured',
    fixHint: 'Set SSH password or PEM key in project settings for Build locally + sync.',
  },
  BUILD_OUTPUT_EMPTY: {
    message: 'Build output folder is missing or empty',
    fixHint:
      'Check Local Output Folder (e.g. www) and ensure the build command produces files before sync.',
  },
  SYNC_ZERO_FILES: {
    message: 'No files were transferred to the server',
    fixHint:
      'Verify Local Output Folder points to your build output (e.g. www) and that the build step succeeded.',
  },
  SYNC_PARTIAL: {
    message: 'File sync was interrupted or incomplete',
    fixHint: 'Retry deploy. If cancelled mid-sync, verify server files and run deploy again.',
  },
  POST_COMMAND_FAILED: {
    message: 'Server post-commands failed after sync',
    fixHint:
      'Files may be on the server but chown/nginx reload failed — check permissions and run post-commands manually.',
  },
  LIVE_VERIFY_FAILED: {
    message: 'Post-deploy live verification failed',
    fixHint:
      'Files synced but live path or nginx check failed — verify Live Nginx Path and nginx configuration.',
  },
  DEPLOY_CANCELLED: {
    message: 'Deploy cancelled',
    fixHint: 'Deploy was stopped by operator. No changes after the last successful step.',
  },
  UNKNOWN: {
    message: 'Deploy command failed',
    fixHint: 'Review full terminal output for details.',
  },
};

function truncateDetail(text, maxLen = 500) {
  if (!text) return '';
  const trimmed = text.trim();
  if (trimmed.length <= maxLen) return trimmed;
  return '...' + trimmed.slice(-maxLen);
}

function classifyFromOutput(output, stderr, exitCode, step, command) {
  const combined = `${output || ''}\n${stderr || ''}`.toLowerCase();
  const cmd = (command || '').toLowerCase();

  if (combined.includes('timed out') || combined.includes('command timeout')) {
    return 'COMMAND_TIMEOUT';
  }
  if (
    combined.includes('authentication failed') ||
    combined.includes('auth fail') ||
    combined.includes('permission denied (publickey') ||
    combined.includes('no supported authentication')
  ) {
    return 'SSH_AUTH_FAILED';
  }
  if (combined.includes('private key not found') || combined.includes('enoent') && combined.includes('.pem')) {
    return 'SSH_KEY_MISSING';
  }
  if (
    combined.includes('econnrefused') ||
    combined.includes('enotfound') ||
    combined.includes('getaddrinfo') ||
    combined.includes('unable to establish secure channel')
  ) {
    return 'SSH_HOST_UNREACHABLE';
  }
  if (combined.includes('connection timed out after')) {
    return 'SSH_CONNECT_TIMEOUT';
  }
  if (combined.includes('command not found') || combined.includes(': not found')) {
    return 'COMMAND_NOT_FOUND';
  }
  if (
    combined.includes('merge conflict') ||
    combined.includes('unmerged paths') ||
    combined.includes('automatic merge failed')
  ) {
    return 'GIT_CONFLICT';
  }
  if (
    combined.includes('could not read username') ||
    combined.includes('fatal: could not read from remote')
  ) {
    return 'GIT_AUTH_FAILED';
  }
  if (combined.includes('not a git repository')) {
    return 'GIT_NOT_REPO';
  }
  if (combined.includes('failed to push') || (combined.includes('rejected') && /\bgit\b/.test(combined))) {
    return 'GIT_PUSH_FAILED';
  }
  if (
    combined.includes('nginx: [emerg]') ||
    (combined.includes('nginx: configuration file') && combined.includes('test failed'))
  ) {
    return 'NGINX_INVALID';
  }
  if (combined.includes('cp: cannot stat') || combined.includes('cannot stat')) {
    return 'COPY_FAILED';
  }
  if (combined.includes('permission denied') || combined.includes('eacces')) {
    return 'PERMISSION_DENIED';
  }
  if (combined.includes('no such file or directory')) {
    return 'PATH_NOT_FOUND';
  }
  if (/\bpm2\b/.test(combined) && combined.includes('command not found')) {
    return 'PM2_NOT_FOUND';
  }
  if (
    combined.includes('process or namespace not found') ||
    (combined.includes('[pm2]') && combined.includes('not found'))
  ) {
    return 'PM2_APP_MISSING';
  }
  if (/\bpm2 restart\b/.test(cmd) && exitCode !== 0 && exitCode != null) {
    return 'PM2_RESTART_FAILED';
  }
  if (
    cmd.includes('npm') ||
    cmd.includes('ionic') ||
    cmd.includes('ng build') ||
    cmd.includes('yarn') ||
    cmd.includes('build')
  ) {
    if (exitCode !== 0 && exitCode != null) {
      return 'BUILD_FAILED';
    }
  }

  return 'UNKNOWN';
}

function classifyDeployError({
  output = '',
  stderr = '',
  exitCode = null,
  step = null,
  command = null,
  err = null,
  aborted = false,
  timedOut = false,
  validationError = null,
  stepType = null,
}) {
  if (validationError) {
    const catalog = ERROR_CATALOG.VALIDATION_FAILED;
    return {
      code: 'VALIDATION_FAILED',
      message: catalog.message,
      detail: validationError,
      fixHint: catalog.fixHint,
      failedStep: null,
      failedCommand: null,
      exitCode: null,
    };
  }

  if (aborted) {
    const catalog = ERROR_CATALOG.DEPLOY_CANCELLED;
    return {
      code: 'DEPLOY_CANCELLED',
      message: catalog.message,
      detail: 'Deploy cancelled by operator',
      fixHint: catalog.fixHint,
      failedStep: step,
      failedCommand: command,
      exitCode: null,
    };
  }

  if (timedOut) {
    const catalog = ERROR_CATALOG.COMMAND_TIMEOUT;
    return {
      code: 'COMMAND_TIMEOUT',
      message: catalog.message,
      detail: truncateDetail(stderr || output),
      fixHint: catalog.fixHint,
      failedStep: step,
      failedCommand: command,
      exitCode: exitCode,
    };
  }

  if (err) {
    const errMsg = err.message || String(err);
    let code = err.code || 'UNKNOWN';
    if (code === 'UNKNOWN' || !ERROR_CATALOG[code]) {
      if (errMsg.includes('private key not found')) code = 'SSH_KEY_MISSING';
      else if (errMsg.includes('SSH password not configured for local sync')) {
        code = 'SSH_AUTH_FAILED';
      } else if (errMsg.includes('Output directory') || errMsg.includes('output folder is empty')) {
        code = 'BUILD_OUTPUT_EMPTY';
      } else if (errMsg.includes('No files to sync') || errMsg.includes('No files were transferred')) {
        code = 'SYNC_ZERO_FILES';
      } else if (errMsg.includes('Sync cancelled')) {
        code = 'SYNC_PARTIAL';
      } else if (errMsg.includes('Live verification') || errMsg.includes('nginx -t')) {
        code = 'LIVE_VERIFY_FAILED';
      } else if (errMsg.includes('Local source path not found') || errMsg.includes('Local project path')) {
        code = 'LOCAL_PATH_MISSING';
      } else if (errMsg.includes('timed out after 30')) code = 'SSH_CONNECT_TIMEOUT';
      else if (errMsg.includes('authentication') || errMsg.includes('AUTH')) code = 'SSH_AUTH_FAILED';
      else if (errMsg.includes('ECONNREFUSED') || errMsg.includes('ENOTFOUND')) code = 'SSH_HOST_UNREACHABLE';
    }

    const catalog = ERROR_CATALOG[code] || ERROR_CATALOG.UNKNOWN;
    return {
      code,
      message: catalog.message,
      detail: errMsg,
      fixHint: catalog.fixHint,
      failedStep: step,
      failedCommand: command,
      exitCode: exitCode,
    };
  }

  let code = classifyFromOutput(output, stderr, exitCode, step, command);

  if (stepType === 'verify' && exitCode !== 0 && exitCode != null) {
    code = 'LIVE_VERIFY_FAILED';
  } else if (stepType === 'local_sync' && exitCode !== 0 && exitCode != null) {
    code = 'SYNC_FAILED';
  } else if (stepType === 'local_shell' && exitCode !== 0 && exitCode != null) {
    const cmdLower = (command || '').toLowerCase();
    if (!/\bgit\b/.test(cmdLower)) {
      code = 'LOCAL_BUILD_FAILED';
    } else if (code === 'UNKNOWN' && /\bgit push\b/.test(cmdLower)) {
      code = 'GIT_PUSH_FAILED';
    }
  } else if (stepType === 'ssh' && (command || '').includes('[verify]') && exitCode !== 0) {
    code = 'LIVE_VERIFY_FAILED';
  } else if (
    ((command || '').includes('[auto] Sync') || `${output}\n${stderr}`.toLowerCase().includes('rsync')) &&
    exitCode !== 0 &&
    exitCode != null
  ) {
    code = 'SYNC_FAILED';
  }

  const catalog = ERROR_CATALOG[code] || ERROR_CATALOG.UNKNOWN;
  const stepNum = step ? (typeof step === 'number' ? step : parseInt(String(step).replace(/\D/g, ''), 10) || null) : null;

  let message = catalog.message;
  if (stepNum) {
    message = `${catalog.message} at step ${stepNum}`;
  }

  return {
    code,
    message,
    detail: truncateDetail(stderr || output),
    fixHint: catalog.fixHint,
    failedStep: stepNum,
    failedCommand: command,
    exitCode: exitCode,
  };
}

function formatErrorSummary(errorMeta) {
  if (!errorMeta) return '';
  const parts = [];
  if (errorMeta.failedStep) parts.push(`STEP ${errorMeta.failedStep}`);
  if (errorMeta.failedCommand) parts.push(errorMeta.failedCommand);
  if (errorMeta.exitCode != null) parts.push(`exit ${errorMeta.exitCode}`);
  if (errorMeta.code) parts.push(errorMeta.code);
  return parts.join(' — ');
}

module.exports = {
  ERROR_CATALOG,
  classifyDeployError,
  formatErrorSummary,
  truncateDetail,
};
