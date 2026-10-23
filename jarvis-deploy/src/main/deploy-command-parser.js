const PLACEHOLDER_PATTERN = /\{\{(\w+)\}\}/g;

const PROJECT_KINDS = {
  FRONTEND: 'frontend',
  BACKEND: 'backend',
};

const PLACEHOLDER_KEYS = [
  'projectPath',
  'branch',
  'liveWwwPath',
  'nginxUser',
  'pm2AppName',
  'host',
  'username',
];

function getProjectKind(project) {
  if (project.projectKind === PROJECT_KINDS.BACKEND) {
    return PROJECT_KINDS.BACKEND;
  }
  return PROJECT_KINDS.FRONTEND;
}

function isBackendProject(project) {
  return getProjectKind(project) === PROJECT_KINDS.BACKEND;
}

function isFrontendProject(project) {
  return getProjectKind(project) === PROJECT_KINDS.FRONTEND;
}

function getDefaultFrontendDeployCommands() {
  return `cd {{projectPath}} && git pull
npm run build
cp -r www/* {{liveWwwPath}}/
chown -R {{nginxUser}}:{{nginxUser}} {{liveWwwPath}}
nginx -t && systemctl reload nginx`;
}

function getDefaultBackendDeployCommands(project = {}) {
  const lines = ['git pull'];
  if (project.runNpmInstallOnDeploy) {
    lines.push('npm install');
  }
  lines.push('pm2 restart {{pm2AppName}}');
  lines.push('nginx -t && systemctl reload nginx');
  return lines.join('\n');
}

function getDefaultDeployCommands(project = {}) {
  if (isBackendProject(project)) {
    return getDefaultBackendDeployCommands(project);
  }
  return getDefaultFrontendDeployCommands();
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function commandHasOwnCd(command) {
  return /^cd\s+/i.test(command.trim());
}

function stripProjectPathPrefix(command, projectPath) {
  if (!projectPath) return command;

  const normalized = projectPath.replace(/\/+$/, '');
  const escaped = normalized.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const withSlash = new RegExp(`${escaped}/`, 'g');

  if (withSlash.test(command)) {
    return command.replace(withSlash, '');
  }

  const basename = normalized.split('/').filter(Boolean).pop();
  if (basename && basename !== normalized) {
    const baseEscaped = basename.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const basePattern = new RegExp(`${baseEscaped}/`, 'g');
    if (basePattern.test(command)) {
      return command.replace(basePattern, '');
    }
  }

  return command;
}

function prepareCommandForExecution(command) {
  return command;
}

function getPlaceholderValues(project) {
  return {
    projectPath: project.projectPath || '',
    branch: project.branch || 'main',
    liveWwwPath: project.liveWwwPath || project.wwwPath || '',
    nginxUser: project.nginxUser || 'www-data',
    pm2AppName: project.pm2AppName || '',
    host: project.host || '',
    username: project.username || '',
  };
}

function parseDeployCommands(raw) {
  if (!raw || typeof raw !== 'string') return [];

  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'));
}

function classifyCommandLine(line) {
  const trimmed = line.trim();

  if (/^local:\s*/i.test(trimmed)) {
    return {
      type: 'ssh',
      raw: trimmed,
      body: trimmed.replace(/^local:\s*/i, '').trim(),
    };
  }

  if (/^sync:\s*/i.test(trimmed) || /^sync:$/i.test(trimmed) || /^sync$/i.test(trimmed)) {
    return null;
  }

  if (/^remote:\s*/i.test(trimmed)) {
    return {
      type: 'ssh',
      raw: trimmed,
      body: trimmed.replace(/^remote:\s*/i, '').trim(),
    };
  }

  return { type: 'ssh', raw: trimmed, body: trimmed };
}

function commandsHaveLegacyPrefixes(project) {
  const lines = parseDeployCommands(project.deployCommands || '');
  return lines.some((line) => {
    const lower = line.toLowerCase();
    return (
      lower.startsWith('local:') ||
      lower.startsWith('sync:') ||
      lower === 'sync' ||
      lower.startsWith('remote:')
    );
  });
}

function migratePrefixCommands(project) {
  const lines = parseDeployCommands(project.deployCommands || '');
  const remoteCommands = [];

  for (const line of lines) {
    const classified = classifyCommandLine(line);
    if (classified?.body) {
      remoteCommands.push(classified.body);
    }
  }

  return {
    ...project,
    deployCommands: remoteCommands.join('\n') || getDefaultDeployCommands(),
  };
}

function normalizeDeployStrategy(project) {
  let normalized = { ...project };

  if (commandsHaveLegacyPrefixes(normalized)) {
    normalized = migratePrefixCommands(normalized);
  }

  if (normalized.deployStrategy === 'local-build-sync') {
    normalized.deployStrategy = 'remote-ssh';
    if (
      !normalized.deployCommands?.trim() ||
      normalized.deployCommands.trim() === `chown -R {{nginxUser}}:{{nginxUser}} {{liveWwwPath}}\nnginx -t && systemctl reload nginx`
    ) {
      normalized.deployCommands = getDefaultDeployCommands();
    }
  }

  delete normalized.deployStrategy;
  delete normalized.localProjectPath;
  delete normalized.localOutputSubpath;
  delete normalized.localBuildCommand;
  delete normalized.syncDeleteStale;
  delete normalized.gitPublishEnabled;
  delete normalized.gitCommitMessage;

  if (!normalized.projectKind) {
    normalized.projectKind = PROJECT_KINDS.FRONTEND;
  }

  if (normalized.runNpmInstallOnDeploy === undefined) {
    normalized.runNpmInstallOnDeploy = false;
  }

  return normalized;
}

function substitutePlaceholders(line, values) {
  return line.replace(PLACEHOLDER_PATTERN, (match, key) => {
    if (Object.prototype.hasOwnProperty.call(values, key)) {
      return values[key];
    }
    return match;
  });
}

function findUnresolvedTokens(text) {
  const tokens = new Set();
  let match;
  const pattern = new RegExp(PLACEHOLDER_PATTERN.source, 'g');
  while ((match = pattern.exec(text)) !== null) {
    tokens.add(match[1]);
  }
  return [...tokens];
}

function getUnresolvedPlaceholders(project) {
  const values = getPlaceholderValues(project);
  const unresolved = new Set();

  for (const token of findUnresolvedTokens(project.deployCommands || '')) {
    if (!values[token] && values[token] !== 0) {
      unresolved.add(token);
    }
  }

  return [...unresolved];
}

function resolveDeployStep(project, classified, values) {
  const resolved = substitutePlaceholders(classified.body, values);

  return {
    type: 'ssh',
    command: prepareCommandForExecution(resolved),
    cwd: null,
    syncTarget: null,
    syncFlags: [],
  };
}

function composeDeployPipeline(project) {
  const values = getPlaceholderValues(project);
  const lines = parseDeployCommands(project.deployCommands || '');

  return lines
    .map((line) => {
      const classified = classifyCommandLine(line);
      if (!classified) return null;
      const resolved = resolveDeployStep(project, classified, values);
      return {
        ...resolved,
        userCommand: line,
        classifiedType: classified.type,
      };
    })
    .filter(Boolean);
}

function buildResolvedSteps(project) {
  return composeDeployPipeline(project);
}

function resolveDeployCommands(project) {
  return composeDeployPipeline(project).map((step) => step.command);
}

function validateDeployCommands(project) {
  const unresolved = getUnresolvedPlaceholders(project);
  const lines = parseDeployCommands(project.deployCommands || '');

  if (lines.length === 0) {
    return { valid: false, error: 'At least one deploy command is required' };
  }

  if (isBackendProject(project)) {
    if (!project.pm2AppName?.trim()) {
      return { valid: false, error: 'PM2 App Name is required for backend projects' };
    }
  } else if (!project.liveWwwPath && !project.wwwPath) {
    return { valid: false, error: 'Live Nginx Path is required for frontend projects' };
  }

  if (unresolved.length > 0) {
    return {
      valid: false,
      error: `Unresolved placeholders: ${unresolved.map((t) => `{{${t}}}`).join(', ')}`,
      unresolved,
    };
  }

  const commandCount = composeDeployPipeline(project).length;
  return {
    valid: true,
    commandCount,
    strategy: 'remote-ssh',
    projectKind: getProjectKind(project),
  };
}

function buildLegacyStaticGitCommands(project) {
  const branch = project.branch || 'main';
  const nginxUser = project.nginxUser || 'www-data';
  const outputFolder = project.outputFolder || 'dist';
  const useSudo = project.useSudo !== false;
  const sudo = useSudo ? 'sudo ' : '';

  const lines = [`cd {{projectPath}} && git pull origin {{branch}}`];

  if (project.runBuildOnDeploy !== false && project.buildCommand?.trim()) {
    lines.push(`cd {{projectPath}} && ${project.buildCommand.trim()}`);
  }

  if (project.customCopyCommand?.trim()) {
    lines.push(project.customCopyCommand.trim());
  } else if (outputFolder && outputFolder !== '.') {
    lines.push(`${sudo}cp -r ${outputFolder}/. {{liveWwwPath}}/`);
  } else {
    lines.push(`${sudo}cp -r . {{liveWwwPath}}/`);
  }

  lines.push(`${sudo}chown -R {{nginxUser}}:{{nginxUser}} {{liveWwwPath}}`);
  lines.push(`${sudo}nginx -t && ${sudo}systemctl reload nginx`);

  return lines.join('\n');
}

function buildLegacyNodePm2Commands(project) {
  const branch = project.branch || 'main';
  const pm2App = project.pm2AppName || 'app';

  return [
    `cd {{projectPath}} && git fetch --all`,
    `cd {{projectPath}} && git reset --hard origin/${branch}`,
    `cd {{projectPath}} && npm install --production`,
    `cd {{projectPath}} && pm2 restart ${pm2App}`,
    `cd {{projectPath}} && pm2 status ${pm2App}`,
  ].join('\n');
}

function migrateLegacyProject(project) {
  if (project.deployCommands?.trim()) {
    return normalizeDeployStrategy(project);
  }

  const migrated = { ...project };

  if (project.type === 'nodejs-pm2') {
    migrated.projectKind = PROJECT_KINDS.BACKEND;
    migrated.pm2AppName = project.pm2AppName || 'app';
    migrated.deployCommands = buildLegacyNodePm2Commands(project);
  } else if (project.type === 'static-nginx' && project.deployMethod === 'direct-sync') {
    migrated.deployCommands = buildLegacyStaticGitCommands(project);
  } else if (project.type === 'static-nginx') {
    migrated.deployCommands = buildLegacyStaticGitCommands(project);
  } else {
    migrated.deployCommands = getDefaultDeployCommands();
  }

  return normalizeDeployStrategy(migrated);
}

function stripLegacyFields(project) {
  const {
    type,
    deployMethod,
    deployStrategy,
    pm2AppName,
    buildCommand,
    wwwPath,
    framework,
    outputFolder,
    runBuildOnDeploy,
    localSourcePath,
    localProjectPath,
    localOutputSubpath,
    localBuildCommand,
    syncDeleteStale,
    gitPublishEnabled,
    gitCommitMessage,
    runLocalBuildBeforeSync,
    syncTool,
    useSudo,
    customCopyCommand,
    entryFile,
    ...rest
  } = project;

  return {
    ...rest,
    projectKind: rest.projectKind || PROJECT_KINDS.FRONTEND,
    pm2AppName: rest.pm2AppName || pm2AppName || '',
    runNpmInstallOnDeploy: !!rest.runNpmInstallOnDeploy,
    liveWwwPath: rest.liveWwwPath || wwwPath || '',
    branch: rest.branch || 'main',
    nginxUser: rest.nginxUser || 'www-data',
  };
}

module.exports = {
  PROJECT_KINDS,
  getProjectKind,
  isBackendProject,
  isFrontendProject,
  PLACEHOLDER_KEYS,
  getDefaultDeployCommands,
  getDefaultFrontendDeployCommands,
  getDefaultBackendDeployCommands,
  getPlaceholderValues,
  parseDeployCommands,
  classifyCommandLine,
  commandsHaveLegacyPrefixes,
  migratePrefixCommands,
  normalizeDeployStrategy,
  substitutePlaceholders,
  findUnresolvedTokens,
  getUnresolvedPlaceholders,
  composeDeployPipeline,
  buildResolvedSteps,
  resolveDeployCommands,
  resolveDeployStep,
  prepareCommandForExecution,
  stripProjectPathPrefix,
  commandHasOwnCd,
  validateDeployCommands,
  migrateLegacyProject,
  stripLegacyFields,
  buildLegacyStaticGitCommands,
  buildLegacyNodePm2Commands,
};
