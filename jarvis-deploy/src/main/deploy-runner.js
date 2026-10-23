const { runDeploySequence, cancelConnection, DEFAULT_COMMAND_TIMEOUT_MS } = require('./ssh-executor');
const {
  buildDeploySteps,
  getDeployPathSummary,
  previewDeployCommands: buildPreview,
  STEP_TYPE_LABELS,
} = require('./deploy-commands');
const { validateDeployCommands } = require('./deploy-command-parser');
const { classifyDeployError, formatErrorSummary } = require('./error-classifier');
const { validateProjectPaths } = require('./deploy-verify');
const { preDeployToolCheck } = require('./tool-detector');
const db = require('./db');

const activeDeploys = new Map();

function getCommandsForProject(project) {
  return buildDeploySteps(project);
}

async function runDeployPipeline(project, steps, callbacks, projectId, options = {}) {
  const { onLine, onStepStart, onStepComplete, onStepFailed } = callbacks;
  const commandTimeoutMs = options.commandTimeoutMs || DEFAULT_COMMAND_TIMEOUT_MS;
  const stepTimings = [];

  const sshResult = await runDeploySequence(
    project,
    steps.map((s) => ({
      name: s.name,
      command: s.command,
      userCommand: s.userCommand,
      type: s.type,
      typeLabel: s.typeLabel,
    })),
    (text, type, globalStep) => {
      if (type === 'command' && globalStep) {
        const stepDef = steps[globalStep - 1];
        onStepStart?.({
          step: globalStep,
          total: steps.length,
          name: stepDef?.name,
          type: stepDef?.type || 'ssh',
          typeLabel: stepDef?.typeLabel || STEP_TYPE_LABELS.ssh,
          command: stepDef?.userCommand || stepDef?.command,
        });
      }
      onLine(text, type);
    },
    projectId,
    {
      commandTimeoutMs,
      globalStepOffset: 0,
      onStepComplete: (timing) => {
        stepTimings.push(timing);
        onStepComplete?.({
          step: timing.step,
          total: steps.length,
          name: timing.name,
          type: timing.type || 'ssh',
          typeLabel: STEP_TYPE_LABELS.ssh,
          status: 'success',
          durationSeconds: timing.durationSeconds,
          command: timing.command,
        });
      },
    }
  );

  if (!sshResult.success && sshResult.stepIndex) {
    const failedStep = steps[sshResult.stepIndex - 1];
    onStepFailed?.({
      step: sshResult.stepIndex,
      total: steps.length,
      name: sshResult.step || failedStep?.name,
      type: 'ssh',
      status: 'failed',
      exitCode: sshResult.code,
      stderr: sshResult.stderr,
      command: sshResult.userCommand || sshResult.command,
    });
    return { ...sshResult, stepTimings };
  }

  return { ...sshResult, stepTimings };
}

async function executeDeploySteps(project, commands, callbacks, projectId) {
  const settings = project._settings || {};
  const commandTimeoutMs = settings.commandTimeoutMs || DEFAULT_COMMAND_TIMEOUT_MS;
  return runDeployPipeline(project, commands, callbacks, projectId, { commandTimeoutMs });
}

async function startDeploy(project, sendOutput, sendDone) {
  if (activeDeploys.has(project.id)) {
    const err = classifyDeployError({
      validationError: 'Deploy already in progress for this project',
    });
    sendDone({ status: 'failed', ...err, durationSeconds: 0 });
    return { success: false, ...err };
  }

  const validation = validateDeployCommands(project);
  if (!validation.valid) {
    const err = classifyDeployError({ validationError: validation.error });
    sendDone({
      status: 'failed',
      durationSeconds: 0,
      errorCode: err.code,
      errorMessage: err.message,
      fixHint: err.fixHint,
      logId: null,
    });
    return { success: false, ...err };
  }

  const toolCheck = await preDeployToolCheck(project);
  if (!toolCheck.ok) {
    const missingNames = toolCheck.missingTools.map((t) => t.name || t.toolKey).join(', ');
    sendDone({
      status: 'failed',
      durationSeconds: 0,
      errorCode: 'TOOLS_MISSING',
      errorMessage: `Deploy blocked — missing tools: ${missingNames}`,
      fixHint: 'Install the missing tools on your machine, then retry deploy.',
      logId: null,
    });
    return {
      success: false,
      blocked: true,
      missingTools: toolCheck.missingTools,
      requiredTools: toolCheck.requiredTools,
      errorCode: 'TOOLS_MISSING',
      errorMessage: `Deploy blocked — missing tools: ${missingNames}`,
    };
  }

  activeDeploys.set(project.id, true);
  const startTime = Date.now();
  let commands;

  try {
    commands = getCommandsForProject(project);
  } catch (err) {
    activeDeploys.delete(project.id);
    const classified = classifyDeployError({ err, validationError: err.message });
    sendDone({
      status: 'failed',
      durationSeconds: 0,
      errorCode: classified.code,
      errorMessage: classified.message,
      fixHint: classified.fixHint,
    });
    return { success: false, ...classified };
  }

  const pathSummary = getDeployPathSummary(project);
  const logEntry = db.createLog(project.id, project.name);
  let fullOutput = '';
  let currentStep = 0;

  const emitLine = (text, type = 'output') => {
    const timestamp = formatTimestamp();
    const line = `[${timestamp}] ${text}`;
    fullOutput += line + '\n';
    db.appendLogOutput(logEntry.id, line + '\n');
    sendOutput({
      event: 'line',
      line,
      type,
      step: currentStep,
      totalSteps: commands.length,
      stepName: commands[currentStep - 1]?.name || '',
    });
  };

  const emitStepEvent = (event, payload) => {
    if (event === 'step:complete') {
      currentStep = payload.step;
    }
    sendOutput({
      event,
      ...payload,
      totalSteps: commands.length,
    });
  };

  emitLine('INITIATING DEPLOY SEQUENCE...', 'system');
  emitLine(`Target: ${project.name} (${project.host})`, 'system');
  emitLine(`Strategy: ${pathSummary.strategyLabel}`, 'system');
  emitLine(`Project path: ${pathSummary.projectPath}`, 'system');
  if (pathSummary.projectKind === 'backend') {
    emitLine(`PM2 app: ${pathSummary.pm2AppName}`, 'system');
  } else {
    emitLine(`Live path: ${pathSummary.liveWwwPath}`, 'system');
  }
  emitLine(`Branch: ${pathSummary.branch}`, 'system');
  emitLine(`Steps: ${commands.length}`, 'system');
  emitLine('---', 'system');

  const callbacks = {
    onLine: emitLine,
    onStepStart: (data) => {
      currentStep = data.step;
      emitStepEvent('step:start', data);
    },
    onStepComplete: (data) => {
      emitStepEvent('step:complete', data);
      sendOutput({
        event: 'progress',
        line: '',
        step: data.step,
        totalSteps: commands.length,
        stepName: data.name,
      });
    },
    onStepFailed: (data) => emitStepEvent('step:failed', data),
  };

  let connResult;
  try {
    connResult = await executeDeploySteps(project, commands, callbacks, project.id);
  } catch (err) {
    connResult = { success: false, error: err.message, err };
  }

  const durationSeconds = Math.round((Date.now() - startTime) / 1000);
  let status = 'success';
  let errorMeta = null;

  if (connResult.aborted) {
    status = 'cancelled';
    errorMeta = classifyDeployError({
      aborted: true,
      step: connResult.stepIndex,
      command: connResult.userCommand || connResult.command,
    });
    emitLine(errorMeta.message, 'error');
  } else if (!connResult.success) {
    status = 'failed';
    errorMeta = classifyDeployError({
      output: connResult.stderr || '',
      stderr: connResult.stderr || '',
      exitCode: connResult.code,
      step: connResult.stepIndex || connResult.step,
      command: connResult.userCommand || connResult.command,
      err: connResult.err,
      timedOut: connResult.timedOut,
      validationError: connResult.error,
      stepType: connResult.stepType,
    });

    emitLine('---', 'system');
    emitLine(`DEPLOY FAILED: ${errorMeta.message}`, 'error');
    emitLine(`Fix: ${errorMeta.fixHint}`, 'error');
    emitLine(formatErrorSummary(errorMeta), 'error');
  } else {
    emitLine('---', 'system');
    emitLine(`DEPLOY SUCCESS — completed in ${durationSeconds}s`, 'success');
    if (connResult.stepTimings?.length) {
      for (const t of connResult.stepTimings) {
        const label = t.typeLabel || t.type || 'STEP';
        emitLine(`  ✓ Step ${t.step} [${label}] ${t.command} (${t.durationSeconds}s)`, 'success');
      }
    }
  }

  const dbMeta = errorMeta
    ? {
        errorCode: errorMeta.code,
        errorMessage: errorMeta.message,
        failedStep: errorMeta.failedStep,
        failedCommand: errorMeta.failedCommand,
        exitCode: errorMeta.exitCode,
        fixHint: errorMeta.fixHint,
        stepTimings: connResult.stepTimings || [],
      }
    : { stepTimings: connResult.stepTimings || [] };

  db.finishLog(logEntry.id, status, durationSeconds, dbMeta);
  activeDeploys.delete(project.id);

  const result = {
    status,
    durationSeconds,
    logId: logEntry.id,
    errorCode: errorMeta?.code || null,
    errorMessage: errorMeta?.message || null,
    fixHint: errorMeta?.fixHint || null,
    failedStep: errorMeta?.failedStep || null,
    failedCommand: errorMeta?.failedCommand || null,
    exitCode: errorMeta?.exitCode ?? null,
    stepTimings: connResult.stepTimings || [],
    totalSteps: commands.length,
  };

  sendDone(result);
  return { success: status === 'success', ...result };
}

function cancelDeploy(projectId) {
  cancelConnection(projectId);
  activeDeploys.delete(projectId);
  return { success: true };
}

function previewDeployCommands(project) {
  return buildPreview(project);
}

module.exports = {
  startDeploy,
  cancelDeploy,
  getCommandsForProject,
  previewDeployCommands,
  validateProjectPaths,
  runDeployPipeline,
};

function formatTimestamp() {
  const now = new Date();
  return now.toTimeString().slice(0, 8);
}
