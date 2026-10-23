const {
  validateDeployCommands,
  composeDeployPipeline,
  getProjectKind,
  isBackendProject,
} = require('./deploy-command-parser');

const STEP_TYPE_LABELS = {
  ssh: 'REMOTE',
  verify: 'VERIFY',
};

function buildDeploySteps(project) {
  const validation = validateDeployCommands(project);
  if (!validation.valid) {
    throw new Error(validation.error);
  }

  const resolved = composeDeployPipeline(project);

  return resolved.map((step, index) => ({
    name: `Step ${index + 1}`,
    type: step.type,
    command: step.command,
    userCommand: step.userCommand,
    cwd: step.cwd,
    syncTarget: step.syncTarget,
    syncFlags: step.syncFlags,
    sourcePath: step.sourcePath,
    typeLabel: step.typeLabel || STEP_TYPE_LABELS[step.type] || 'REMOTE',
  }));
}

function previewDeployCommands(project) {
  const validation = validateDeployCommands(project);
  if (!validation.valid) {
    return { success: false, error: validation.error, commands: [], steps: [] };
  }

  const steps = buildDeploySteps(project);

  const kindLabel = isBackendProject(project) ? 'Backend' : 'Frontend';

  return {
    success: true,
    strategy: 'remote-ssh',
    strategyLabel: `${kindLabel} · Server SSH`,
    projectKind: getProjectKind(project),
    commands: steps.map((s) => s.command),
    steps: steps.map((s) => ({
      userCommand: s.userCommand,
      type: s.type,
      typeLabel: s.typeLabel,
      resolvedCommand: s.command,
      syncTarget: null,
      syncFlags: [],
    })),
  };
}

function getDeployPathSummary(project) {
  let commandCount = 0;

  try {
    commandCount = composeDeployPipeline(project).length;
  } catch {
    commandCount = 0;
  }

  return {
    projectPath: project.projectPath || '(not set)',
    liveWwwPath: project.liveWwwPath || '(not set)',
    branch: project.branch || 'main',
    commandCount,
    deployStrategy: 'remote-ssh',
    strategyLabel: isBackendProject(project) ? 'Backend · Server SSH' : 'Frontend · Server SSH',
    projectKind: getProjectKind(project),
    pm2AppName: project.pm2AppName || '(not set)',
  };
}

module.exports = {
  buildDeploySteps,
  previewDeployCommands,
  getDeployPathSummary,
  STEP_TYPE_LABELS,
};
