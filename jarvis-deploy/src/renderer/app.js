/**
 * TechLapse Deploy Control — Renderer Application Logic
 */

(function () {
  'use strict';

  const PROJECT_KINDS = {
    FRONTEND: 'frontend',
    BACKEND: 'backend',
  };

  const DEFAULT_FRONTEND_DEPLOY_COMMANDS = `cd {{projectPath}} && git pull
npm run build
cp -r www/* {{liveWwwPath}}/
chown -R {{nginxUser}}:{{nginxUser}} {{liveWwwPath}}
nginx -t && systemctl reload nginx`;

  function buildBackendDefaultCommands(includeNpmInstall = false) {
    const lines = ['git pull'];
    if (includeNpmInstall) {
      lines.push('npm install');
    }
    lines.push('pm2 restart {{pm2AppName}}');
    lines.push('nginx -t && systemctl reload nginx');
    return lines.join('\n');
  }

  const state = {
    projects: [],
    servers: [],
    selectedProjectId: null,
    activeDeployProjectId: null,
    activePm2LogsProjectId: null,
    currentLogsProjectId: null,
    settings: {
      defaultPort: 22,
      defaultBranch: 'main',
      defaultDeployCommands: DEFAULT_FRONTEND_DEPLOY_COMMANDS,
    },
    deployUnsubscribers: [],
    pm2LogsUnsubscriber: null,
    projectFormShowErrors: false,
    deployLogText: '',
    deploySteps: [],
  };

  const deployTerminal = new Terminal('deploy-terminal');
  const pm2LogsTerminal = new Terminal('pm2-logs-terminal');

  // ─── DOM References ───
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  const els = {
    systemStatus: $('#system-status'),
    projectsGrid: $('#projects-grid'),
    emptyProjects: $('#empty-projects'),
    screenDashboard: $('#screen-dashboard'),
    screenLogs: $('#screen-logs'),
    deployPanel: $('#deploy-panel'),
    deployOverlay: $('#deploy-overlay'),
    deployPanelTitle: $('#deploy-panel-title'),
    deployBanner: $('#deploy-banner'),
    deployErrorDetail: $('#deploy-error-detail'),
    btnCopyDeployLog: $('#btn-copy-deploy-log'),
    progressRing: $('#progress-ring'),
    progressStep: $('#progress-step'),
    progressName: $('#progress-name'),
    btnCancelDeploy: $('#btn-cancel-deploy'),
    btnCloseDeploy: $('#btn-close-deploy'),
    projectModal: $('#project-modal'),
    projectForm: $('#project-form'),
    connectionResult: $('#connection-result'),
    logsList: $('#logs-list'),
    emptyLogs: $('#empty-logs'),
    logsTitle: $('#logs-title'),
    settingsModal: $('#settings-modal'),
    toolsBlockedModal: $('#tools-blocked-modal'),
    toolsBlockedList: $('#tools-blocked-list'),
    deployStepChecklist: $('#deploy-step-checklist'),
    pm2LogsPanel: $('#pm2-logs-panel'),
    pm2LogsOverlay: $('#pm2-logs-overlay'),
    pm2LogsPanelTitle: $('#pm2-logs-panel-title'),
    pm2LogsBanner: $('#pm2-logs-banner'),
    btnStopPm2Logs: $('#btn-stop-pm2-logs'),
    btnClosePm2Logs: $('#btn-close-pm2-logs'),
  };

  // ─── Clock ───
  function updateClock() {
    const now = new Date();
    const time = now.toTimeString().slice(0, 8);
    const date = now.toLocaleDateString('en-IN', {
      weekday: 'short',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
    els.systemStatus.textContent = `SYSTEM ONLINE — ${time} — ${date}`;
  }

  setInterval(updateClock, 1000);
  updateClock();

  // ─── Time Ago ───
  function timeAgo(dateStr) {
    if (!dateStr) return 'Never';
    const diff = Date.now() - new Date(dateStr).getTime();
    const seconds = Math.floor(diff / 1000);
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  }

  // ─── Load Data ───
  async function loadProjects() {
    state.projects = await window.techlapse.getProjects();
    await renderProjects();
  }

  async function loadServers() {
    state.servers = await window.techlapse.getServers();
  }

  async function loadSettings() {
    state.settings = await window.techlapse.getSettings();
    $('#setting-port').value = state.settings.defaultPort || 22;
    $('#setting-branch').value = state.settings.defaultBranch || 'main';
    $('#setting-deploy-commands').value =
      state.settings.defaultDeployCommands || DEFAULT_FRONTEND_DEPLOY_COMMANDS;
    $('#setting-command-timeout').value = Math.round(
      (state.settings.commandTimeoutMs || 600000) / 60000
    );
    const version = await window.techlapse.getAppVersion();
    $('#app-version').textContent = version;
  }

  // ─── Render Projects ───
  async function renderProjects() {
    const grid = els.projectsGrid;
    grid.innerHTML = '';

    if (state.projects.length === 0) {
      els.emptyProjects.classList.remove('hidden');
      grid.classList.add('hidden');
      return;
    }

    els.emptyProjects.classList.add('hidden');
    grid.classList.remove('hidden');

    for (const project of state.projects) {
      const logs = await window.techlapse.getLogsByProject(project.id, 1);
      const lastLog = logs[0] || null;

      const card = document.createElement('div');
      card.className = 'project-card';
      card.dataset.id = project.id;
      if (state.selectedProjectId === project.id) {
        card.classList.add('selected');
      }

      const kind = project.projectKind || PROJECT_KINDS.FRONTEND;
      const kindPrefix = kind === PROJECT_KINDS.BACKEND ? 'BACKEND' : 'FRONTEND';
      const commandCount = parseCommandLines(project.deployCommands || '').length;
      const typeLabel = commandCount > 0 ? `${kindPrefix} · ${commandCount} CMD` : kindPrefix;
      const pm2LogsBtn =
        kind === PROJECT_KINDS.BACKEND && project.pm2AppName
          ? `<button class="btn btn-ghost btn-pm2-logs" data-id="${project.id}">PM2 LOGS</button>`
          : '';

      let dotClass = 'never';
      let deployBadge = '';
      let lastDeployText = 'Last deploy: Never';

      let failHint = '';
      if (lastLog) {
        dotClass = lastLog.status === 'running' ? 'running' : lastLog.status;
        lastDeployText = `Last deploy: ${timeAgo(lastLog.startedAt)}`;
        if (lastLog.status !== 'running') {
          deployBadge = `<span class="deploy-badge ${lastLog.status}">${lastLog.status.toUpperCase()}</span>`;
        } else {
          deployBadge = `<span class="deploy-badge running">DEPLOYING</span>`;
        }
        if (lastLog.status === 'failed' && lastLog.failedCommand) {
          failHint = `<span class="project-fail-hint">Failed at step ${lastLog.failedStep || '?'}: ${escapeHtml(lastLog.failedCommand)}</span>`;
        }
      }

      card.innerHTML = `
        <div class="project-card-header">
          <span class="project-name">${escapeHtml(project.name)}</span>
          <span class="status-dot ${dotClass}"></span>
        </div>
        <span class="type-badge">[${typeLabel}]</span>
        <div class="project-host">${escapeHtml(project.username)}@${escapeHtml(project.host)}:${project.port || 22}</div>
        <div class="project-last-deploy">
          ${lastDeployText}
          ${deployBadge}
          ${failHint}
        </div>
        <div class="project-actions">
          <button class="btn btn-primary btn-deploy" data-id="${project.id}">DEPLOY</button>
          ${pm2LogsBtn}
          <button class="btn btn-ghost btn-logs" data-id="${project.id}">LOGS</button>
          <button class="btn btn-ghost btn-edit" data-id="${project.id}" title="Edit">✎</button>
        </div>
      `;

      card.addEventListener('click', (e) => {
        if (!e.target.closest('button')) {
          selectProject(project.id);
        }
      });

      grid.appendChild(card);
    }

    grid.querySelectorAll('.btn-deploy').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        startDeploy(btn.dataset.id);
      });
    });

    grid.querySelectorAll('.btn-logs').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        showLogs(btn.dataset.id);
      });
    });

    grid.querySelectorAll('.btn-edit').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        openProjectModal(btn.dataset.id);
      });
    });

    grid.querySelectorAll('.btn-pm2-logs').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        startPm2Logs(btn.dataset.id);
      });
    });
  }

  function selectProject(id) {
    state.selectedProjectId = id;
    $$('.project-card').forEach((card) => {
      card.classList.toggle('selected', card.dataset.id === id);
    });
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // ─── Deploy Panel ───
  function resetDeployStepChecklist() {
    state.deploySteps = [];
    if (els.deployStepChecklist) {
      els.deployStepChecklist.innerHTML = '';
      els.deployStepChecklist.classList.add('hidden');
    }
  }

  function renderDeployStepChecklist() {
    if (!els.deployStepChecklist) return;

    if (state.deploySteps.length === 0) {
      els.deployStepChecklist.classList.add('hidden');
      return;
    }

    els.deployStepChecklist.classList.remove('hidden');
    els.deployStepChecklist.innerHTML = state.deploySteps
      .map((step) => {
        const icon =
          step.status === 'success'
            ? '✓'
            : step.status === 'failed'
              ? '✕'
              : step.status === 'running'
                ? '●'
                : '○';
        const statusClass = step.status || 'pending';
        const duration =
          step.durationSeconds != null ? ` <span class="step-duration">(${step.durationSeconds}s)</span>` : '';
        const metrics =
          step.metrics?.filesUploaded != null
            ? ` — ${step.metrics.filesUploaded} files`
            : '';
        return `<div class="deploy-step-item ${statusClass}" data-step="${step.step}">
          <span class="step-icon">${icon}</span>
          <span class="step-num">Step ${step.step}</span>
          <span class="step-type">[${escapeHtml(step.typeLabel || step.type || 'STEP')}]</span>
          <span class="step-cmd">${escapeHtml(step.command || step.name || '')}${metrics}</span>${duration}
        </div>`;
      })
      .join('');
  }

  function handleDeployStepEvent(data) {
    const event = data.event;
    if (!event || !event.startsWith('step:')) return;

    const existing = state.deploySteps.find((s) => s.step === data.step);

    if (event === 'step:start') {
      const entry = {
        step: data.step,
        name: data.name,
        type: data.type,
        typeLabel: data.typeLabel,
        command: data.command,
        status: 'running',
      };
      if (existing) {
        Object.assign(existing, entry);
      } else {
        state.deploySteps.push(entry);
        state.deploySteps.sort((a, b) => a.step - b.step);
      }
    } else if (event === 'step:complete') {
      const entry = existing || { step: data.step };
      entry.status = 'success';
      entry.durationSeconds = data.durationSeconds;
      entry.metrics = data.metrics;
      entry.typeLabel = data.typeLabel || entry.typeLabel;
      entry.command = data.command || entry.command;
      if (!existing) {
        state.deploySteps.push(entry);
        state.deploySteps.sort((a, b) => a.step - b.step);
      }
      updateDeployProgress(data.step, data.total || data.totalSteps, data.name);
    } else if (event === 'step:failed') {
      const entry = existing || { step: data.step };
      entry.status = 'failed';
      entry.exitCode = data.exitCode;
      entry.command = data.command || entry.command;
      entry.typeLabel = data.typeLabel || entry.typeLabel;
      if (!existing) {
        state.deploySteps.push(entry);
        state.deploySteps.sort((a, b) => a.step - b.step);
      }
    }

    renderDeployStepChecklist();
  }

  function openDeployPanel(project) {
    els.deployPanelTitle.textContent = project.name.toUpperCase();
    deployTerminal.clear();
    state.deployLogText = '';
    resetDeployStepChecklist();
    els.deployBanner.classList.add('hidden');
    els.deployBanner.className = 'deploy-status-banner hidden';
    if (els.deployErrorDetail) {
      els.deployErrorDetail.classList.add('hidden');
      els.deployErrorDetail.innerHTML = '';
    }
    els.progressRing.classList.remove('hidden');
    els.progressRing.classList.add('deploying');
    els.progressStep.textContent = 'INITIATING...';
    els.progressStep.classList.add('initiating');
    els.progressName.textContent = 'AWAITING SECURE CHANNEL';
    els.btnCancelDeploy.classList.remove('hidden');
    els.btnCloseDeploy.classList.add('hidden');
    if (els.btnCopyDeployLog) els.btnCopyDeployLog.classList.add('hidden');

    els.deployPanel.classList.remove('hidden');
    els.deployOverlay.classList.remove('hidden');
    requestAnimationFrame(() => {
      els.deployPanel.classList.add('visible');
      els.deployOverlay.classList.add('visible');
    });
  }

  function closeDeployPanel(force = false) {
    if (state.activeDeployProjectId && !force) {
      const keepWatching = confirm(
        'Deploy in progress.\n\nOK = keep watching\nCancel = stop deploy and close panel'
      );
      if (keepWatching) return;
      cancelDeploy();
    }

    els.deployPanel.classList.remove('visible');
    els.deployOverlay.classList.remove('visible');
    setTimeout(() => {
      els.deployPanel.classList.add('hidden');
      els.deployOverlay.classList.add('hidden');
      if (!state.activeDeployProjectId) {
        cleanupDeployListeners();
      }
    }, 300);
  }

  function updateDeployProgress(step, totalSteps, stepName) {
    els.progressStep.classList.remove('initiating');
    els.progressStep.textContent = `STEP ${step} OF ${totalSteps}`;
    els.progressName.textContent = stepName || 'EXECUTING';
  }

  function showDeployResult(result) {
    const {
      status,
      durationSeconds,
      errorMessage,
      errorCode,
      fixHint,
      failedStep,
      failedCommand,
      exitCode,
    } = result;

    els.progressRing.classList.add('hidden');
    els.progressRing.classList.remove('deploying');
    els.btnCancelDeploy.classList.add('hidden');
    els.btnCloseDeploy.classList.remove('hidden');
    if (els.btnCopyDeployLog) els.btnCopyDeployLog.classList.remove('hidden');

    els.deployBanner.classList.remove('hidden');
    els.deployBanner.className = `deploy-status-banner ${status}`;

    if (status === 'success') {
      els.deployBanner.textContent = `✓ DEPLOY SUCCESS — ${durationSeconds}s`;
      els.progressStep.textContent = 'COMPLETE';
      els.progressName.textContent = 'ALL SYSTEMS NOMINAL';
      if (els.deployErrorDetail) els.deployErrorDetail.classList.add('hidden');
      if (result.stepTimings?.length) {
        renderDeployStepChecklist();
      }
    } else if (status === 'cancelled') {
      els.deployBanner.textContent = `⊘ DEPLOY CANCELLED — ${durationSeconds}s`;
      els.progressStep.textContent = 'CANCELLED';
      els.progressName.textContent = errorMessage || 'Stopped by operator';
      if (els.deployErrorDetail) els.deployErrorDetail.classList.add('hidden');
    } else {
      els.deployBanner.textContent = `✕ DEPLOY FAILED — ${durationSeconds}s`;
      els.progressStep.textContent = failedStep ? `FAILED AT STEP ${failedStep}` : 'ABORTED';
      els.progressName.textContent = errorMessage || 'SEQUENCE TERMINATED';

      if (els.deployErrorDetail) {
        els.deployErrorDetail.classList.remove('hidden');
        let html = '';
        if (errorCode) html += `<div class="error-code">${escapeHtml(errorCode)}</div>`;
        if (failedStep && failedCommand) {
          html += `<div><strong>Step ${failedStep}:</strong> ${escapeHtml(failedCommand)}</div>`;
        }
        if (exitCode != null) html += `<div>Exit code: ${exitCode}</div>`;
        if (fixHint) html += `<div class="error-fix">Fix: ${escapeHtml(fixHint)}</div>`;
        els.deployErrorDetail.innerHTML = html;
      }
    }
  }

  function showDeployBlockedModal(missingTools) {
    if (!els.toolsBlockedModal || !els.toolsBlockedList) return;

    els.toolsBlockedList.innerHTML = (missingTools || [])
      .map(
        (tool) => `
        <li class="tools-blocked-item">
          <div class="tools-blocked-item-info">
            <span class="tools-blocked-item-icon">${escapeHtml(tool.icon || '◈')}</span>
            <div>
              <div class="tools-blocked-item-name">${escapeHtml(tool.name || tool.toolKey)}</div>
              <div class="tools-blocked-item-desc">${escapeHtml(tool.description || 'Required for deploy')}</div>
            </div>
          </div>
          <button type="button" class="tools-blocked-guide-btn" data-tool-guide="${tool.toolKey}">VIEW GUIDE</button>
        </li>`
      )
      .join('');

    els.toolsBlockedList.querySelectorAll('[data-tool-guide]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (window.InstallGuide) {
          window.InstallGuide.open(btn.dataset.toolGuide);
        }
      });
    });

    els.toolsBlockedModal.showModal();
  }

  function closeDeployBlockedModal() {
    els.toolsBlockedModal?.close();
  }

  async function startDeploy(projectId) {
    const project = state.projects.find((p) => p.id === projectId);
    if (!project) return;

    if (state.activeDeployProjectId) {
      return;
    }

    if (state.activePm2LogsProjectId) {
      alert('PM2 logs are streaming. Stop the stream before deploying.');
      return;
    }

    const toolCheck = await window.techlapse.tools.preDeployCheck(projectId);
    if (!toolCheck.ok) {
      showDeployBlockedModal(toolCheck.missingTools);
      return;
    }

    state.activeDeployProjectId = projectId;
    openDeployPanel(project);
    setupDeployListeners(projectId);

    try {
      const result = await window.techlapse.startDeploy(projectId);
      if (result?.blocked) {
        state.activeDeployProjectId = null;
        closeDeployPanel();
        showDeployBlockedModal(result.missingTools);
      }
    } catch (err) {
      state.activeDeployProjectId = null;
      deployTerminal.appendLine(`[ERROR] ${err.message}`, 'error');
      showDeployResult({
        status: 'failed',
        durationSeconds: 0,
        errorMessage: err.message,
      });
    }
  }

  function setupDeployListeners(projectId) {
    cleanupDeployListeners();

    const unsubOutput = window.techlapse.onDeployOutput((data) => {
      if (data.projectId !== projectId) return;

      if (data.event?.startsWith('step:')) {
        handleDeployStepEvent(data);
        return;
      }

      if (data.event === 'progress' || data.type === 'progress') {
        updateDeployProgress(data.step, data.totalSteps, data.stepName);
        return;
      }

      if (data.line) {
        state.deployLogText += data.line + '\n';
        deployTerminal.appendLine(data.line, data.type || 'output');
      }
    });

    const unsubDone = window.techlapse.onDeployDone((data) => {
      if (data.projectId !== projectId) return;
      if (data.stepTimings?.length) {
        state.deploySteps = data.stepTimings.map((t) => ({
          step: t.step,
          name: t.name,
          type: t.type,
          typeLabel: t.typeLabel,
          command: t.command,
          status: 'success',
          durationSeconds: t.durationSeconds,
          metrics: t.metrics,
        }));
        renderDeployStepChecklist();
      }
      showDeployResult(data);
      state.activeDeployProjectId = null;
      loadProjects();
    });

    state.deployUnsubscribers = [unsubOutput, unsubDone];
  }

  function cleanupDeployListeners() {
    state.deployUnsubscribers.forEach((unsub) => {
      if (typeof unsub === 'function') unsub();
    });
    state.deployUnsubscribers = [];
  }

  async function cancelDeploy() {
    if (!state.activeDeployProjectId) return;
    await window.techlapse.cancelDeploy(state.activeDeployProjectId);
    deployTerminal.appendLine('[SYSTEM] Deploy cancelled by operator', 'system');
  }

  // ─── PM2 Live Logs Panel ───
  function cleanupPm2LogsListener() {
    if (typeof state.pm2LogsUnsubscriber === 'function') {
      state.pm2LogsUnsubscriber();
      state.pm2LogsUnsubscriber = null;
    }
  }

  function closePm2LogsPanel(force = false) {
    if (state.activePm2LogsProjectId && !force) {
      stopPm2LogsStream();
      return;
    }
    cleanupPm2LogsListener();
    els.pm2LogsPanel.classList.add('hidden');
    els.pm2LogsOverlay.classList.add('hidden');
    els.btnStopPm2Logs.classList.add('hidden');
    els.btnClosePm2Logs.classList.add('hidden');
    els.pm2LogsBanner.classList.add('hidden');
    state.activePm2LogsProjectId = null;
  }

  async function stopPm2LogsStream() {
    if (!state.activePm2LogsProjectId) return;
    await window.techlapse.stopPm2Logs(state.activePm2LogsProjectId);
    pm2LogsTerminal.appendLine('[SYSTEM] PM2 log stream stopped', 'system');
    els.btnStopPm2Logs.classList.add('hidden');
    els.btnClosePm2Logs.classList.remove('hidden');
    els.pm2LogsBanner.textContent = 'Stream stopped';
    els.pm2LogsBanner.className = 'deploy-status-banner';
    els.pm2LogsBanner.classList.remove('hidden');
    state.activePm2LogsProjectId = null;
  }

  async function startPm2Logs(projectId) {
    const project = state.projects.find((p) => p.id === projectId);
    if (!project) return;

    if (project.projectKind !== PROJECT_KINDS.BACKEND) {
      alert('PM2 live logs are only available for backend projects.');
      return;
    }

    if (!project.pm2AppName) {
      alert('Set a PM2 App Name in project settings first.');
      return;
    }

    if (state.activeDeployProjectId) {
      alert('A deploy is in progress. Wait for it to finish or cancel it first.');
      return;
    }

    if (state.activePm2LogsProjectId) {
      await stopPm2LogsStream();
    }

    cleanupPm2LogsListener();
    pm2LogsTerminal.clear();
    els.pm2LogsPanelTitle.textContent = `PM2 LOGS — ${project.name.toUpperCase()}`;
    els.pm2LogsBanner.textContent = `Streaming pm2 logs ${project.pm2AppName}…`;
    els.pm2LogsBanner.className = 'deploy-status-banner running';
    els.pm2LogsBanner.classList.remove('hidden');
    els.pm2LogsPanel.classList.remove('hidden');
    els.pm2LogsOverlay.classList.remove('hidden');
    els.btnStopPm2Logs.classList.remove('hidden');
    els.btnClosePm2Logs.classList.add('hidden');

    state.activePm2LogsProjectId = projectId;

    state.pm2LogsUnsubscriber = window.techlapse.onPm2LogsOutput((data) => {
      if (data.projectId !== projectId) return;
      if (data.event === 'line' && data.line) {
        pm2LogsTerminal.appendLine(data.line, data.type || 'output');
      } else if (data.event === 'done') {
        if (data.error) {
          pm2LogsTerminal.appendLine(`[ERROR] ${data.error}`, 'error');
          els.pm2LogsBanner.textContent = data.error;
          els.pm2LogsBanner.className = 'deploy-status-banner failed';
        } else {
          els.pm2LogsBanner.textContent = 'Stream ended';
          els.pm2LogsBanner.className = 'deploy-status-banner';
        }
        els.pm2LogsBanner.classList.remove('hidden');
        els.btnStopPm2Logs.classList.add('hidden');
        els.btnClosePm2Logs.classList.remove('hidden');
        state.activePm2LogsProjectId = null;
      }
    });

    pm2LogsTerminal.appendLine(`Connecting to ${project.host}…`, 'system');
    const result = await window.techlapse.startPm2Logs(projectId);
    if (!result.success) {
      pm2LogsTerminal.appendLine(`[ERROR] ${result.error || 'Failed to start PM2 logs'}`, 'error');
      els.pm2LogsBanner.textContent = result.error || 'Failed to start stream';
      els.pm2LogsBanner.className = 'deploy-status-banner failed';
      els.btnStopPm2Logs.classList.add('hidden');
      els.btnClosePm2Logs.classList.remove('hidden');
      state.activePm2LogsProjectId = null;
    } else {
      pm2LogsTerminal.appendLine(`$ pm2 logs ${project.pm2AppName} --raw`, 'command');
    }
  }

  // ─── Project Modal ───
  async function openProjectModal(projectId = null) {
    state.projectFormShowErrors = false;
    clearValidationUI();
    els.projectForm.reset();
    els.connectionResult.classList.add('hidden');
    $('#preview-result').classList.add('hidden');
    $('#validate-result').classList.add('hidden');
    $('#ready-result').classList.add('hidden');
    $('#project-id').value = '';
    await loadServers();
    await populateServerLoadDropdown(projectId);

    if (projectId) {
      const project = state.projects.find((p) => p.id === projectId);
      if (!project) return;

      $('#project-modal-title').textContent = 'EDIT PROJECT';
      $('#project-id').value = project.id;
      $('#project-name').value = project.name;
      $('#project-host').value = project.host;
      $('#project-port').value = project.port || 22;
      $('#project-username').value = project.username;
      setAuthMethod(project.authMethod || 'pem-key', project);
      setProjectKind(project.projectKind || PROJECT_KINDS.FRONTEND, { skipDefaults: true });
      $('#project-path').value = project.projectPath || '';
      $('#project-branch').value = project.branch || 'main';
      $('#project-www').value = project.liveWwwPath || '';
      $('#project-nginx-user').value = project.nginxUser || 'www-data';
      $('#project-pm2-app').value = project.pm2AppName || '';
      $('#project-npm-install').checked = !!project.runNpmInstallOnDeploy;
      $('#project-deploy-commands').value =
        project.deployCommands ||
        (project.projectKind === PROJECT_KINDS.BACKEND
          ? buildBackendDefaultCommands(project.runNpmInstallOnDeploy)
          : state.settings.defaultDeployCommands || DEFAULT_FRONTEND_DEPLOY_COMMANDS);
    } else {
      $('#project-modal-title').textContent = 'ADD PROJECT';
      $('#project-port').value = state.settings.defaultPort || 22;
      $('#project-branch').value = state.settings.defaultBranch || 'main';
      $('#project-nginx-user').value = 'www-data';
      $('#project-pm2-app').value = '';
      $('#project-npm-install').checked = false;
      setProjectKind(PROJECT_KINDS.FRONTEND, { skipDefaults: true });
      $('#project-deploy-commands').value =
        state.settings.defaultDeployCommands || DEFAULT_FRONTEND_DEPLOY_COMMANDS;
      setAuthMethod('pem-key');
    }

    els.projectModal.showModal();
    requestAnimationFrame(() => updateFormValidationState());
  }

  async function populateServerLoadDropdown(excludeProjectId = null) {
    const select = $('#server-load-select');
    select.innerHTML = '<option value="">— Select server to autofill —</option>';

    if (state.servers.length > 0) {
      const presetGroup = document.createElement('optgroup');
      presetGroup.label = 'Saved Servers';
      state.servers.forEach((server) => {
        const opt = document.createElement('option');
        opt.value = `preset:${server.id}`;
        opt.textContent = `${server.name} (${server.username}@${server.host})`;
        presetGroup.appendChild(opt);
      });
      select.appendChild(presetGroup);
    }

    const otherProjects = state.projects.filter((p) => p.id !== excludeProjectId);
    if (otherProjects.length > 0) {
      const projectGroup = document.createElement('optgroup');
      projectGroup.label = 'From Existing Project';
      otherProjects.forEach((project) => {
        const opt = document.createElement('option');
        opt.value = `project:${project.id}`;
        opt.textContent = `${project.name} (${project.username}@${project.host})`;
        projectGroup.appendChild(opt);
      });
      select.appendChild(projectGroup);
    }
  }

  function applyServerCredentials(creds) {
    if (!creds) return;

    $('#project-host').value = creds.host || '';
    $('#project-port').value = creds.port || 22;
    $('#project-username').value = creds.username || '';

    const authProject = {
      privateKeyPath: creds.privateKeyPath,
      password: creds.password,
      hasPassword: Boolean(creds.password),
    };
    setAuthMethod(creds.authMethod || 'pem-key', authProject);

    if (creds.authMethod === 'password' && creds.password) {
      $('#project-password').value = creds.password;
      $('#password-hint').classList.add('hidden');
    }

    updateFormValidationState();
  }

  async function onServerLoadChange() {
    const value = $('#server-load-select').value;
    if (!value) return;

    const [sourceType, id] = value.split(':');
    const creds = await window.techlapse.getServerCredentials(sourceType, id);
    applyServerCredentials(creds);
    $('#server-load-select').value = '';
  }

  async function saveCurrentAsServer() {
    const host = $('#project-host').value.trim();
    const username = $('#project-username').value.trim();
    if (!host || !username) {
      alert('Enter host and username before saving as a server preset.');
      return;
    }

    const authMethod = getActiveAuthMethod();
    if (authMethod === 'pem-key' && !$('#project-key').value.trim()) {
      alert('Select a PEM key before saving this server preset.');
      return;
    }
    if (authMethod === 'password' && !$('#project-password').value.trim()) {
      const projectId = $('#project-id').value;
      const project = projectId ? state.projects.find((p) => p.id === projectId) : null;
      if (!project?.hasPassword) {
        alert('Enter SSH password before saving this server preset.');
        return;
      }
    }

    const defaultName = host || 'My Server';
    const name = prompt('Name for this server preset:', defaultName);
    if (!name || !name.trim()) return;

    let password = authMethod === 'password' ? $('#project-password').value : '';
    if (authMethod === 'password' && !password) {
      const projectId = $('#project-id').value;
      if (projectId) {
        const creds = await window.techlapse.getServerCredentials('project', projectId);
        password = creds?.password || '';
      }
    }

    await window.techlapse.saveServerPreset({
      name: name.trim(),
      host,
      port: parseInt($('#project-port').value, 10) || 22,
      username,
      authMethod,
      privateKeyPath: authMethod === 'pem-key' ? $('#project-key').value.trim() : '',
      password,
    });

    await loadServers();
    await populateServerLoadDropdown($('#project-id').value || null);
    alert(`Server preset "${name.trim()}" saved.`);
  }

  function closeProjectModal() {
    els.projectModal.close();
  }

  function parseCommandLines(raw) {
    return (raw || '')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith('#'));
  }

  function getActiveProjectKind() {
    return $('.strategy-btn[data-kind].active')?.dataset.kind || PROJECT_KINDS.FRONTEND;
  }

  function isBackendKind() {
    return getActiveProjectKind() === PROJECT_KINDS.BACKEND;
  }

  function setProjectKind(kind, options = {}) {
    const { skipDefaults = false } = options;
    const prev = getActiveProjectKind();

    $$('.strategy-btn[data-kind]').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.kind === kind);
    });

    const isBackend = kind === PROJECT_KINDS.BACKEND;

    $('#kind-hint-frontend').classList.toggle('hidden', isBackend);
    $('#kind-hint-backend').classList.toggle('hidden', !isBackend);
    $('#field-www').classList.toggle('hidden', isBackend);
    $('#field-nginx-user').classList.toggle('hidden', isBackend);
    $('#field-pm2-app').classList.toggle('hidden', !isBackend);
    $('#field-npm-install').classList.toggle('hidden', !isBackend);
    $('#command-snippets-frontend').classList.toggle('hidden', isBackend);
    $('#command-snippets-backend').classList.toggle('hidden', !isBackend);
    $('#deploy-commands-hint-frontend').classList.toggle('hidden', isBackend);
    $('#deploy-commands-hint-backend').classList.toggle('hidden', !isBackend);

    if (!skipDefaults && prev !== kind) {
      const current = $('#project-deploy-commands').value.trim();
      const frontendDefault =
        state.settings.defaultDeployCommands || DEFAULT_FRONTEND_DEPLOY_COMMANDS;
      const backendDefault = buildBackendDefaultCommands($('#project-npm-install').checked);

      if (isBackend) {
        if (!current || current === frontendDefault) {
          $('#project-deploy-commands').value = backendDefault;
        }
      } else if (!current || current === backendDefault || current.startsWith('git pull')) {
        $('#project-deploy-commands').value = frontendDefault;
      }
    }

    updateFormValidationState();
  }

  function syncBackendCommandsFromNpmCheckbox() {
    if (!isBackendKind()) return;

    const lines = parseCommandLines($('#project-deploy-commands').value);
    const hasNpm = lines.some((line) => /^npm install\b/i.test(line));
    const wantsNpm = $('#project-npm-install').checked;

    if (wantsNpm && !hasNpm) {
      const pullIndex = lines.findIndex((line) => /^git pull\b/i.test(line));
      if (pullIndex >= 0) {
        lines.splice(pullIndex + 1, 0, 'npm install');
      } else {
        lines.unshift('npm install');
      }
      $('#project-deploy-commands').value = lines.join('\n');
    } else if (!wantsNpm && hasNpm) {
      $('#project-deploy-commands').value = lines
        .filter((line) => !/^npm install\b/i.test(line))
        .join('\n');
    }
  }

  function getPlaceholderValuesFromForm() {
    return {
      projectPath: $('#project-path').value.trim(),
      branch: $('#project-branch').value.trim() || 'main',
      liveWwwPath: $('#project-www').value.trim(),
      nginxUser: $('#project-nginx-user').value.trim() || 'www-data',
      pm2AppName: $('#project-pm2-app').value.trim(),
      host: $('#project-host').value.trim(),
      username: $('#project-username').value.trim(),
    };
  }

  function getUnresolvedPlaceholdersFromForm() {
    const values = getPlaceholderValuesFromForm();
    const unresolved = new Set();
    const pattern = /\{\{(\w+)\}\}/g;
    const textsToCheck = [$('#project-deploy-commands').value];

    for (const text of textsToCheck) {
      for (const line of parseCommandLines(text)) {
        let match;
        const re = new RegExp(pattern.source, 'g');
        while ((match = re.exec(line)) !== null) {
          const key = match[1];
          if (!values[key]) {
            unresolved.add(key);
          }
        }
      }
    }

    return [...unresolved];
  }

  function setAuthMethod(method, project = null) {
    $$('.auth-btn[data-auth]').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.auth === method);
    });

    const isPem = method === 'pem-key';
    $('#field-pem').classList.toggle('hidden', !isPem);
    $('#field-password').classList.toggle('hidden', isPem);

    if (isPem) {
      $('#project-key').value = project?.privateKeyPath || '';
      $('#project-password').value = '';
      $('#password-hint').classList.add('hidden');
    } else {
      $('#project-key').value = '';
      if (project?.password) {
        $('#project-password').value = project.password;
        $('#password-hint').classList.add('hidden');
      } else {
        $('#project-password').value = '';
        const isEdit = Boolean(project?.id);
        const hasPassword = Boolean(project?.hasPassword);
        $('#password-hint').classList.toggle('hidden', !(isEdit && hasPassword));
        $('#project-password').placeholder =
          isEdit && hasPassword ? 'Leave blank to keep existing password' : 'Enter SSH password';
      }
    }
    updateFormValidationState();
  }

  function getActiveAuthMethod() {
    return $('.auth-btn[data-auth].active')?.dataset.auth || 'pem-key';
  }

  function getProjectFormData() {
    const authMethod = getActiveAuthMethod();
    const id = $('#project-id').value;

    const data = {
      name: $('#project-name').value.trim(),
      host: $('#project-host').value.trim(),
      port: parseInt($('#project-port').value, 10) || 22,
      username: $('#project-username').value.trim(),
      authMethod,
      privateKeyPath: authMethod === 'pem-key' ? $('#project-key').value.trim() : '',
      password: authMethod === 'password' ? $('#project-password').value : '',
      projectPath: $('#project-path').value.trim(),
      projectKind: getActiveProjectKind(),
      pm2AppName: $('#project-pm2-app').value.trim(),
      runNpmInstallOnDeploy: isBackendKind() && $('#project-npm-install').checked,
      branch: $('#project-branch').value.trim() || 'main',
      liveWwwPath: $('#project-www').value.trim(),
      nginxUser: $('#project-nginx-user').value.trim() || 'www-data',
      deployCommands: $('#project-deploy-commands').value,
    };

    if (id) data.id = id;
    return data;
  }

  function isFieldVisible(element) {
    if (!element) return false;
    let node = element;
    while (node && node !== els.projectForm) {
      if (node.classList?.contains('hidden')) return false;
      node = node.parentElement;
    }
    return true;
  }

  function addValidationError(errors, fieldId, label, message) {
    const element = document.getElementById(fieldId);
    if (!element || !isFieldVisible(element)) return;
    const row =
      element.closest('.form-row') ||
      element.closest('.form-field')?.closest('.form-row-2') ||
      element.closest('.form-field')?.closest('.form-row');
    errors.push({ fieldId, label, message, element, row });
  }

  function getValidationErrors() {
    const errors = [];
    const checks = [];

    checks.push({
      id: 'project-name',
      label: 'Project Name',
      message: 'Project name is required',
      invalid: !$('#project-name').value.trim(),
    });
    checks.push({
      id: 'project-host',
      label: 'Host',
      message: 'Host address is required',
      invalid: !$('#project-host').value.trim(),
    });
    checks.push({
      id: 'project-username',
      label: 'SSH Username',
      message: 'SSH username is required',
      invalid: !$('#project-username').value.trim(),
    });

    if (isBackendKind()) {
      checks.push({
        id: 'project-pm2-app',
        label: 'PM2 App Name',
        message: 'PM2 app name is required for backend projects',
        invalid: !$('#project-pm2-app').value.trim(),
      });
    } else {
      checks.push({
        id: 'project-www',
        label: 'Live Nginx Path',
        message: 'Live Nginx Path is required for frontend projects',
        invalid: !$('#project-www').value.trim(),
      });
    }

    const authMethod = getActiveAuthMethod();
    if (authMethod === 'pem-key') {
      checks.push({
        id: 'project-key',
        label: 'SSH Private Key',
        message: 'Select a PEM key file using Browse',
        invalid: !$('#project-key').value.trim(),
      });
    } else {
      const projectId = $('#project-id').value;
      const project = projectId ? state.projects.find((p) => p.id === projectId) : null;
      const canKeepExisting = Boolean(projectId && project?.hasPassword);
      checks.push({
        id: 'project-password',
        label: 'SSH Password',
        message: canKeepExisting
          ? 'Enter password or leave blank to keep existing'
          : 'SSH password is required',
        invalid: !$('#project-password').value && !canKeepExisting,
      });
    }

    const commandLines = parseCommandLines($('#project-deploy-commands').value);
    if (commandLines.length === 0) {
      checks.push({
        id: 'project-deploy-commands',
        label: 'Deploy Commands',
        message: 'At least one deploy command is required',
        invalid: true,
      });
    }

    const unresolved = getUnresolvedPlaceholdersFromForm();
    if (unresolved.length > 0) {
      checks.push({
        id: 'project-deploy-commands',
        label: 'Deploy Commands',
        message: `Unresolved placeholders: ${unresolved.map((t) => `{{${t}}}`).join(', ')}`,
        invalid: true,
      });
    }

    checks.forEach((check) => {
      if (check.invalid) {
        addValidationError(errors, check.id, check.label, check.message);
      }
    });

    return errors;
  }

  function clearValidationUI() {
    $$('#project-form .invalid').forEach((el) => el.classList.remove('invalid'));
    $$('#project-form .form-row-invalid, #project-form .form-row-2.form-row-invalid').forEach((el) =>
      el.classList.remove('form-row-invalid')
    );
    $$('#project-form .field-error').forEach((el) => el.remove());
    const banner = $('#form-validation-banner');
    if (banner) {
      banner.classList.add('hidden');
      banner.textContent = '';
    }
  }

  function applyValidationUI(errors, scrollToFirst = false) {
    clearValidationUI();

    if (!errors.length) return;

    errors.forEach((err) => {
      err.element.classList.add('invalid');
      if (err.row) {
        err.row.classList.add('form-row-invalid');
        let errorEl = err.row.querySelector(`.field-error[data-for="${err.fieldId}"]`);
        if (!errorEl) {
          errorEl = document.createElement('span');
          errorEl.className = 'field-error';
          errorEl.dataset.for = err.fieldId;
          errorEl.setAttribute('role', 'alert');
          err.row.appendChild(errorEl);
        }
        errorEl.textContent = err.message;
      }
    });

    const banner = $('#form-validation-banner');
    if (banner) {
      banner.classList.remove('hidden');
      const count = errors.length;
      banner.innerHTML = `<strong>${count} required field${count > 1 ? 's' : ''} missing</strong> — ${errors[0].label}: ${errors[0].message}`;
    }

    if (scrollToFirst && errors[0]) {
      const scrollTarget = errors[0].row || errors[0].element;
      scrollTarget?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setTimeout(() => {
        try {
          errors[0].element.focus({ preventScroll: true });
        } catch {
          errors[0].element.focus?.();
        }
      }, 350);
    }
  }

  function updateFormValidationState(scrollToFirst = false) {
    if (scrollToFirst) {
      state.projectFormShowErrors = true;
    }

    const errors = getValidationErrors();
    const saveBtn = $('#btn-save-project');
    const isValid = errors.length === 0;

    const saveWrap = $('#save-btn-wrap');
    if (saveBtn) {
      saveBtn.disabled = !isValid;
      saveBtn.title = isValid
        ? ''
        : `Complete ${errors.length} required field(s) to save`;
    }
    if (saveWrap) {
      saveWrap.classList.toggle('save-btn-invalid', !isValid);
      saveWrap.title = isValid
        ? ''
        : `Click to see ${errors.length} missing required field(s)`;
    }

    if (state.projectFormShowErrors && errors.length > 0) {
      applyValidationUI(errors, scrollToFirst);
    } else if (isValid) {
      clearValidationUI();
      state.projectFormShowErrors = false;
    }

    return isValid;
  }

  function validateProjectForm(scrollToFirst = false) {
    return updateFormValidationState(scrollToFirst);
  }

  async function saveProject(e) {
    e.preventDefault();
    if (!validateProjectForm(true)) return;

    await window.techlapse.saveProject(getProjectFormData());
    closeProjectModal();
    await loadProjects();
  }

  async function testConnection() {
    if (!validateProjectForm(true)) return;

    els.connectionResult.classList.remove('hidden', 'success', 'failed');
    els.connectionResult.textContent = 'Testing secure channel...';

    const formData = getProjectFormData();
    if (!formData.name) {
      formData.name = 'Test';
    }

    const saved = await window.techlapse.saveProject(formData);
    if (saved?.id) {
      $('#project-id').value = saved.id;
      const result = await window.techlapse.testConnection(saved.id);
      showConnectionResult(result);
      await loadProjects();
    }
  }

  function showConnectionResult(result) {
    els.connectionResult.classList.remove('hidden', 'success', 'failed');
    if (result.success) {
      els.connectionResult.classList.add('success');
      els.connectionResult.textContent = `✓ ${result.message}`;
    } else {
      els.connectionResult.classList.add('failed');
      els.connectionResult.textContent = `✕ ${result.message}${result.error ? '\n' + result.error : ''}`;
    }
  }

  function showPreviewResult(stepsOrCommands, strategyLabel) {
    const el = $('#preview-result');
    el.classList.remove('hidden', 'success', 'failed');
    el.classList.add('success');

    const strategyLine = strategyLabel ? `<strong>Strategy:</strong> ${strategyLabel}\n` : '';

    if (stepsOrCommands[0]?.typeLabel) {
      const lines = stepsOrCommands.map(
        (s, i) =>
          `${i + 1}. [${s.typeLabel}] ${s.userCommand}\n   → ${s.resolvedCommand}`
      );
      el.innerHTML = `${strategyLine}<strong>Deploy pipeline preview:</strong>\n${lines.join('\n')}`;
      return;
    }

    el.innerHTML = `${strategyLine}<strong>Deploy commands preview:</strong>\n${stepsOrCommands.map((c, i) => `${i + 1}. ${c}`).join('\n')}`;
  }

  function showValidateResult(result) {
    const el = $('#validate-result');
    el.classList.remove('hidden', 'success', 'failed');
    el.classList.add(result.success ? 'success' : 'failed');

    if (result.error && !result.checks?.length) {
      el.textContent = `✕ ${result.error}`;
      return;
    }

    const lines = (result.checks || []).map((check) => {
      const icon = check.ok ? '✓' : '✕';
      return `${icon} ${check.name}: ${check.path}\n   ${check.message}`;
    });
    el.innerHTML = `${result.success ? '✓ All path checks passed' : '✕ Path validation issues found'}\n${lines.join('\n')}`;
  }

  async function previewDeploy() {
    if (!validateProjectForm(true)) return;

    const el = $('#preview-result');
    el.classList.add('hidden');
    const result = await window.techlapse.previewDeploy(getProjectFormData());

    if (!result?.success && result?.error) {
      el.classList.remove('hidden', 'success');
      el.classList.add('failed');
      el.textContent = `✕ ${result.error}`;
      return;
    }

    if (result?.steps?.length) {
      showPreviewResult(result.steps, result.strategyLabel);
    } else if (result?.commands?.length) {
      showPreviewResult(result.commands, result.strategyLabel);
    }
  }

  async function readyCheck() {
    if (!validateProjectForm(true)) return;

    const el = $('#ready-result');
    el.classList.remove('hidden', 'success', 'failed');
    el.textContent = 'Running ready check...';

    const result = await window.techlapse.readyCheck(getProjectFormData());

    if (result.projectId && !$('#project-id').value) {
      $('#project-id').value = result.projectId;
      await loadProjects();
    }

    el.classList.add(result.success ? 'success' : 'failed');
    const lines = (result.checks || []).map((check) => {
      const icon = check.ok ? '✓' : '✕';
      return `${icon} ${check.name}: ${check.message || check.path || ''}`;
    });
    el.innerHTML = `${result.success ? '✓ Ready to deploy' : '✕ Not ready — fix issues below'}\n${lines.join('\n')}`;
  }

  function insertCommandSnippet(snippet) {
    const textarea = $('#project-deploy-commands');
    const current = textarea.value.trim();
    textarea.value = current ? `${current}\n${snippet}` : snippet;
    updateFormValidationState();
  }

  async function copyDeployLog() {
    const text = state.deployLogText || deployTerminal.getRawText?.() || '';
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      if (els.btnCopyDeployLog) {
        const orig = els.btnCopyDeployLog.textContent;
        els.btnCopyDeployLog.textContent = 'COPIED';
        setTimeout(() => {
          els.btnCopyDeployLog.textContent = orig;
        }, 1500);
      }
    } catch {
      alert('Could not copy to clipboard');
    }
  }

  async function validatePaths() {
    if (!validateProjectForm(true)) return;

    $('#validate-result').classList.add('hidden');
    $('#validate-result').textContent = 'Validating server paths...';
    $('#validate-result').classList.remove('hidden');

    let projectId = $('#project-id').value;
    if (!projectId) {
      const formData = getProjectFormData();
      if (!formData.name) formData.name = 'Validate';
      const saved = await window.techlapse.saveProject(formData);
      projectId = saved?.id;
      if (projectId) {
        $('#project-id').value = projectId;
        await loadProjects();
      }
    }

    if (!projectId) return;

    const result = await window.techlapse.validatePaths(projectId);
    showValidateResult(result);
  }

  async function browseKey() {
    const path = await window.techlapse.openFilePicker();
    if (path) {
      $('#project-key').value = path;
      updateFormValidationState();
    }
  }

  // ─── Logs Screen ───
  async function showLogs(projectId) {
    const project = state.projects.find((p) => p.id === projectId);
    if (!project) return;

    state.currentLogsProjectId = projectId;
    els.screenDashboard.classList.add('hidden');
    els.screenLogs.classList.remove('hidden');
    els.logsTitle.textContent = `LOGS — ${project.name.toUpperCase()}`;

    await renderLogs(projectId);
  }

  function hideLogs() {
    els.screenLogs.classList.add('hidden');
    els.screenDashboard.classList.remove('hidden');
    state.currentLogsProjectId = null;
  }

  async function renderLogs(projectId) {
    const logs = await window.techlapse.getLogsByProject(projectId, 100);
    els.logsList.innerHTML = '';

    if (logs.length === 0) {
      els.emptyLogs.classList.remove('hidden');
      els.logsList.classList.add('hidden');
      return;
    }

    els.emptyLogs.classList.add('hidden');
    els.logsList.classList.remove('hidden');

    for (const log of logs) {
      const entry = document.createElement('div');
      entry.className = 'log-entry';
      entry.innerHTML = `
        <div class="log-entry-header" data-log-id="${log.id}">
          <div class="log-entry-info">
            <span class="log-date">${new Date(log.startedAt).toLocaleString()}</span>
            <span class="log-duration">${log.durationSeconds != null ? log.durationSeconds + 's' : '—'}</span>
            <span class="deploy-badge ${log.status}">${log.status.toUpperCase()}</span>
          </div>
          <button class="btn btn-ghost btn-sm btn-view-output" data-log-id="${log.id}">VIEW OUTPUT</button>
        </div>
        <div class="log-entry-output" id="log-output-${log.id}">
          <div class="terminal-wrapper">
            <div class="terminal" id="log-terminal-${log.id}"></div>
            <div class="terminal-scanlines" aria-hidden="true"></div>
          </div>
        </div>
      `;

      els.logsList.appendChild(entry);
    }

    els.logsList.querySelectorAll('.btn-view-output').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const logId = btn.dataset.logId;
        const outputEl = $(`#log-output-${logId}`);
        const isExpanded = outputEl.classList.contains('expanded');

        if (isExpanded) {
          outputEl.classList.remove('expanded');
          btn.textContent = 'VIEW OUTPUT';
        } else {
          const detail = await window.techlapse.getLogDetail(parseInt(logId, 10));
          const terminal = new Terminal(`log-terminal-${logId}`);
          terminal.clear();
          if (detail && detail.output) {
            terminal.appendRawOutput(detail.output);
          }
          outputEl.classList.add('expanded');
          btn.textContent = 'HIDE OUTPUT';
        }
      });
    });
  }

  async function clearLogs() {
    if (!state.currentLogsProjectId) return;

    const confirmed = confirm(
      'Clear all deployment logs for this project?\n\nThis action cannot be undone.'
    );
    if (!confirmed) return;

    const doubleConfirm = confirm('FINAL CONFIRMATION: Delete all logs?');
    if (!doubleConfirm) return;

    await window.techlapse.clearLogs(state.currentLogsProjectId);
    await renderLogs(state.currentLogsProjectId);
  }

  // ─── Settings ───
  async function renderServerPresetsList() {
    await loadServers();
    const container = $('#server-presets-list');
    container.innerHTML = '';

    if (state.servers.length === 0) {
      container.innerHTML = '<p class="field-hint">No server presets saved yet. Use SAVE AS SERVER in the project form.</p>';
      return;
    }

    state.servers.forEach((server) => {
      const item = document.createElement('div');
      item.className = 'server-preset-item';
      item.innerHTML = `
        <div class="server-preset-info">
          <span class="server-preset-name">${escapeHtml(server.name)}</span>
          <span class="server-preset-host">${escapeHtml(server.username)}@${escapeHtml(server.host)}:${server.port || 22}</span>
        </div>
        <button type="button" class="btn btn-danger btn-sm btn-delete-server" data-id="${server.id}">DELETE</button>
      `;
      container.appendChild(item);
    });

    container.querySelectorAll('.btn-delete-server').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const name = state.servers.find((s) => s.id === btn.dataset.id)?.name || 'this server';
        if (!confirm(`Delete server preset "${name}"?`)) return;
        await window.techlapse.deleteServerPreset(btn.dataset.id);
        await renderServerPresetsList();
      });
    });
  }

  async function openSettings() {
    await loadSettings();
    await renderServerPresetsList();
    els.settingsModal.showModal();
  }

  async function saveSettingsHandler() {
    const timeoutMinutes = parseInt($('#setting-command-timeout').value, 10) || 10;
    await window.techlapse.saveSettings({
      defaultPort: parseInt($('#setting-port').value, 10) || 22,
      defaultBranch: $('#setting-branch').value.trim() || 'main',
      defaultDeployCommands: $('#setting-deploy-commands').value,
      commandTimeoutMs: timeoutMinutes * 60 * 1000,
    });
    state.settings = await window.techlapse.getSettings();
    els.settingsModal.close();
  }

  async function resetAllData() {
    const confirm1 = confirm(
      'WARNING: This will delete ALL projects and deployment logs.\n\nProceed?'
    );
    if (!confirm1) return;

    const confirm2 = confirm(
      'FINAL WARNING: All data will be permanently erased. Continue?'
    );
    if (!confirm2) return;

    await window.techlapse.resetAllData();
    els.settingsModal.close();
    state.projects = [];
    state.selectedProjectId = null;
    await loadProjects();
  }

  function bindCloseButton(element, handler) {
    if (!element || typeof handler !== 'function') return;

    const run = (e) => {
      e.preventDefault();
      e.stopPropagation();
      handler(e);
    };

    element.addEventListener('click', run, true);
  }

  function setupDialogDismiss(dialog, onClose) {
    if (!dialog) return;

    dialog.addEventListener('cancel', (e) => {
      e.preventDefault();
      onClose();
    });

    dialog.addEventListener('click', (e) => {
      if (e.target === dialog) {
        onClose();
      }
    });
  }

  // ─── Window Controls ───
  function setupWindowControls() {
    bindCloseButton($('#btn-minimize'), () => window.techlapse.minimizeWindow());
    bindCloseButton($('#btn-maximize'), () => window.techlapse.maximizeWindow());
    bindCloseButton($('#btn-close'), () => window.techlapse.closeWindow());
  }

  // ─── Keyboard Shortcuts ───
  function setupKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'd') {
        e.preventDefault();
        if (state.selectedProjectId && !state.activeDeployProjectId) {
          startDeploy(state.selectedProjectId);
        }
      }
      if (e.key === 'Enter' && state.selectedProjectId && !state.activeDeployProjectId) {
        const tag = document.activeElement?.tagName;
        if (tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT' && !document.querySelector('dialog[open]')) {
          e.preventDefault();
          startDeploy(state.selectedProjectId);
        }
      }
    });
  }

  // ─── Event Bindings ───
  function bindEvents() {
    $('#btn-add-project').addEventListener('click', () => openProjectModal());
    $('#btn-add-first').addEventListener('click', () => openProjectModal());
    $('#btn-settings').addEventListener('click', openSettings);
    bindCloseButton($('#project-modal-close'), closeProjectModal);
    bindCloseButton($('#btn-cancel-project'), closeProjectModal);
    setupDialogDismiss(els.projectModal, closeProjectModal);
    $('#project-form').addEventListener('submit', saveProject);
    els.projectForm.addEventListener('input', () => updateFormValidationState());
    els.projectForm.addEventListener('change', () => updateFormValidationState());

    $('#save-btn-wrap')?.addEventListener('click', (e) => {
      const saveBtn = $('#btn-save-project');
      if (saveBtn?.disabled) {
        e.preventDefault();
        validateProjectForm(true);
      }
    });
    $('#btn-browse-key').addEventListener('click', browseKey);
    $('#btn-ready-check').addEventListener('click', readyCheck);
    $('#btn-test-connection').addEventListener('click', testConnection);
    $('#btn-preview-deploy').addEventListener('click', previewDeploy);
    $('#btn-validate-paths').addEventListener('click', validatePaths);

    $$('.snippet-chip').forEach((chip) => {
      chip.addEventListener('click', () => insertCommandSnippet(chip.dataset.snippet));
    });

    $$('.strategy-btn[data-kind]').forEach((btn) => {
      btn.addEventListener('click', () => setProjectKind(btn.dataset.kind));
    });

    $('#project-npm-install')?.addEventListener('change', () => {
      syncBackendCommandsFromNpmCheckbox();
      updateFormValidationState();
    });

    $$('.auth-btn[data-auth]').forEach((btn) => {
      btn.addEventListener('click', () => {
        setAuthMethod(btn.dataset.auth);
        updateFormValidationState();
      });
    });

    $('#server-load-select').addEventListener('change', onServerLoadChange);
    $('#btn-save-server').addEventListener('click', saveCurrentAsServer);

    bindCloseButton($('#deploy-panel-close'), closeDeployPanel);
    $('#btn-cancel-deploy').addEventListener('click', cancelDeploy);
    $('#btn-copy-deploy-log')?.addEventListener('click', copyDeployLog);
    $('#btn-close-deploy').addEventListener('click', () => closeDeployPanel(true));
    els.deployOverlay.addEventListener('click', closeDeployPanel);

    bindCloseButton($('#pm2-logs-panel-close'), () => closePm2LogsPanel(true));
    $('#btn-stop-pm2-logs')?.addEventListener('click', stopPm2LogsStream);
    $('#btn-close-pm2-logs')?.addEventListener('click', () => closePm2LogsPanel(true));
    els.pm2LogsOverlay?.addEventListener('click', () => closePm2LogsPanel(true));

    $('#btn-logs-back').addEventListener('click', hideLogs);
    $('#btn-clear-logs').addEventListener('click', clearLogs);

    const closeSettings = () => els.settingsModal.close();
    bindCloseButton($('#settings-modal-close'), closeSettings);
    bindCloseButton($('#btn-cancel-settings'), closeSettings);
    setupDialogDismiss(els.settingsModal, closeSettings);
    $('#btn-save-settings').addEventListener('click', saveSettingsHandler);
    $('#btn-reset-data').addEventListener('click', resetAllData);
  }

  function setupDeployBlockedListeners() {
    window.techlapse.onDeployBlocked((data) => {
      if (state.activeDeployProjectId === data.projectId) {
        state.activeDeployProjectId = null;
        closeDeployPanel();
      }
      showDeployBlockedModal(data.missingTools);
    });

    bindCloseButton($('#tools-blocked-close'), closeDeployBlockedModal);
    bindCloseButton($('#tools-blocked-cancel'), closeDeployBlockedModal);
    setupDialogDismiss(els.toolsBlockedModal, closeDeployBlockedModal);
  }

  // ─── Init ───
  async function init() {
    setupWindowControls();
    setupKeyboardShortcuts();
    bindEvents();
    setupDeployBlockedListeners();
    await loadSettings();
    await loadServers();
    await loadProjects();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
