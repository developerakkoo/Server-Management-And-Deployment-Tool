const {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  Tray,
  Menu,
  nativeImage,
  Notification,
  clipboard,
} = require('electron');
const path = require('path');
const fs = require('fs');
const configStore = require('./src/main/config-store');
const db = require('./src/main/db');
const { testConnection } = require('./src/main/ssh-executor');
const { startPm2LogStream, stopPm2LogStream } = require('./src/main/pm2-logs');
const { isBackendProject } = require('./src/main/deploy-command-parser');
const {
  startDeploy,
  cancelDeploy,
  previewDeployCommands,
  validateProjectPaths,
} = require('./src/main/deploy-runner');
const {
  detect,
  detectAll,
  detectForStep,
  getPlatform,
  preDeployToolCheck: runPreDeployToolCheck,
} = require('./src/main/tool-detector');
const { TOOLS } = require('./src/main/tools-registry');

let mainWindow = null;
let tray = null;
let lastDeployStatus = 'idle';
let diagnosticPassed = false;

const isMac = process.platform === 'darwin';
const APP_NAME = 'TechLapse Deploy Control';

function getIconPath() {
  return path.join(__dirname, 'assets', 'icon.png');
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1280,
    minHeight: 800,
    frame: false,
    titleBarStyle: 'hidden',
    backgroundColor: '#0a0c10',
    icon: getIconPath(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  const entryPage = diagnosticPassed
    ? path.join(__dirname, 'src', 'renderer', 'index.html')
    : path.join(__dirname, 'src', 'renderer', 'diagnostic.html');
  mainWindow.loadFile(entryPage);

  mainWindow.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function updateTrayTooltip(status) {
  if (!tray) return;
  const labels = {
    idle: `${APP_NAME} — Ready`,
    running: `${APP_NAME} — Deploy in progress`,
    success: `${APP_NAME} — Last deploy: SUCCESS`,
    failed: `${APP_NAME} — Last deploy: FAILED`,
    cancelled: `${APP_NAME} — Last deploy: CANCELLED`,
  };
  tray.setToolTip(labels[status] || labels.idle);
}

function showDeployNotification(result, projectName) {
  if (!Notification.isSupported()) return;
  if (mainWindow && mainWindow.isVisible() && mainWindow.isFocused()) return;

  const title =
    result.status === 'success'
      ? `${APP_NAME} — Success`
      : result.status === 'cancelled'
        ? `${APP_NAME} — Cancelled`
        : `${APP_NAME} — Failed`;

  let body = projectName || 'Deploy';
  if (result.status === 'success') {
    body += ` completed in ${result.durationSeconds}s`;
  } else if (result.errorMessage) {
    body += `: ${result.errorMessage}`;
  }

  const notification = new Notification({ title, body, silent: false });
  notification.show();
}

function createTray() {
  const iconPath = getIconPath();
  let trayIcon;

  if (fs.existsSync(iconPath)) {
    trayIcon = nativeImage.createFromPath(iconPath);
    if (isMac) {
      trayIcon = trayIcon.resize({ width: 16, height: 16 });
    }
  } else {
    trayIcon = nativeImage.createEmpty();
  }

  tray = new Tray(trayIcon);
  updateTrayTooltip('idle');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: `Show ${APP_NAME}`,
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        }
      },
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        app.isQuitting = true;
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);
  tray.on('click', () => {
    if (mainWindow) {
      if (mainWindow.isVisible()) {
        mainWindow.focus();
      } else {
        mainWindow.show();
      }
    }
  });
}

function mergeProjectData(projectData) {
  let project = { ...projectData };
  if (projectData.id) {
    const existing = configStore.getProjectById(projectData.id);
    if (existing) {
      project = { ...existing, ...projectData };
      if (!projectData.password && existing.password) {
        project.password = existing.password;
      }
    }
  }
  const settings = configStore.getSettings();
  project._settings = settings;
  return project;
}

function registerIpcHandlers() {
  ipcMain.handle('projects:get', () => configStore.getProjects());

  ipcMain.handle('projects:save', (_event, projectData) => {
    return configStore.saveProject(projectData);
  });

  ipcMain.handle('projects:delete', (_event, id) => {
    return configStore.deleteProject(id);
  });

  ipcMain.handle('servers:get', () => configStore.getServers());

  ipcMain.handle('servers:getCredentials', (_event, sourceType, id) => {
    return configStore.getServerCredentials(sourceType, id);
  });

  ipcMain.handle('servers:save', (_event, serverData) => {
    return configStore.saveServerPreset(serverData);
  });

  ipcMain.handle('servers:delete', (_event, id) => {
    return configStore.deleteServerPreset(id);
  });

  ipcMain.handle('connection:test', async (_event, projectId) => {
    const project = configStore.getProjectById(projectId);
    if (!project) {
      return { success: false, error: 'Project not found', errorCode: 'VALIDATION_FAILED' };
    }
    return testConnection(project);
  });

  ipcMain.handle('deploy:preview', (_event, projectData) => {
    return previewDeployCommands(mergeProjectData(projectData));
  });

  ipcMain.handle('deploy:validatePaths', async (_event, projectId) => {
    const project = configStore.getProjectById(projectId);
    if (!project) {
      return { success: false, error: 'Project not found' };
    }
    return validateProjectPaths(project);
  });

  ipcMain.handle('deploy:readyCheck', async (_event, projectData) => {
    const checks = [];
    let project = mergeProjectData(projectData);
    let projectId = projectData.id;

    if (!projectId) {
      if (!projectData.name) projectData.name = 'ReadyCheck';
      const saved = configStore.saveProject(projectData);
      projectId = saved?.id;
      if (projectId) {
        project = configStore.getProjectById(projectId);
        project._settings = configStore.getSettings();
      }
    }

    const preview = previewDeployCommands(project);
    checks.push({
      name: 'Deploy commands',
      ok: preview.success,
      message: preview.success
        ? `${preview.steps?.length || preview.commands?.length || 0} command(s) ready`
        : preview.error || 'Invalid commands',
    });

    const toolCheck = await runPreDeployToolCheck(project);
    checks.push({
      name: 'Required tools',
      ok: toolCheck.ok,
      message: toolCheck.ok
        ? `${toolCheck.requiredTools.join(', ')} available`
        : `Missing: ${toolCheck.missingTools.map((t) => t.name || t.toolKey).join(', ')}`,
    });

    if (projectId) {
      const conn = await testConnection(project);
      checks.push({
        name: 'SSH connection',
        ok: conn.success,
        message: conn.success ? conn.message : conn.error || conn.message,
      });

      const paths = await validateProjectPaths(project);
      if (paths.checks) {
        paths.checks.forEach((c) => checks.push(c));
      } else if (paths.error) {
        checks.push({ name: 'Path validation', ok: false, message: paths.error });
      }

    } else {
      checks.push({
        name: 'SSH connection',
        ok: false,
        message: 'Save project first to test connection',
      });
    }

    const allOk = checks.every((c) => c.ok);
    return { success: allOk, checks, projectId: projectId || null };
  });

  ipcMain.handle('deploy:start', async (_event, projectId) => {
    const project = configStore.getProjectById(projectId);

    const sendOutput = (data) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('deploy:output', { projectId, ...data });
      }
    };

    const sendDone = (result) => {
      if (result.status === 'success') {
        lastDeployStatus = 'success';
      } else if (result.status === 'cancelled') {
        lastDeployStatus = 'cancelled';
      } else {
        lastDeployStatus = 'failed';
      }
      updateTrayTooltip(lastDeployStatus);
      showDeployNotification(result, project?.name || 'Deploy');
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('deploy:done', { projectId, ...result });
      }
    };

    if (!project) {
      const failResult = {
        status: 'failed',
        durationSeconds: 0,
        errorCode: 'VALIDATION_FAILED',
        errorMessage: 'Project not found',
        fixHint: 'Save the project and try again.',
        logId: null,
        stepTimings: [],
      };
      sendDone(failResult);
      return { success: false, error: 'Project not found', ...failResult };
    }

    project._settings = configStore.getSettings();

    lastDeployStatus = 'running';
    updateTrayTooltip('running');

    const result = await startDeploy(project, sendOutput, sendDone);

    if (result.blocked && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('deploy:blocked', {
        projectId,
        missingTools: result.missingTools,
        requiredTools: result.requiredTools,
      });
    }

    return result;
  });

  ipcMain.handle('deploy:cancel', (_event, projectId) => {
    return cancelDeploy(projectId);
  });

  ipcMain.handle('pm2Logs:start', async (_event, projectId) => {
    const project = configStore.getProjectById(projectId);
    if (!project) {
      return { success: false, error: 'Project not found' };
    }

    if (!isBackendProject(project)) {
      return { success: false, error: 'PM2 logs are only available for backend projects' };
    }

    const sendOutput = (data) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('pm2Logs:output', { projectId, ...data });
      }
    };

    return startPm2LogStream(project, sendOutput);
  });

  ipcMain.handle('pm2Logs:stop', (_event, projectId) => {
    const result = stopPm2LogStream(projectId);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('pm2Logs:output', {
        projectId,
        event: 'done',
        success: true,
        stopped: true,
      });
    }
    return result;
  });

  ipcMain.handle('logs:get', (_event, limit = 50) => {
    return db.getLogs(limit);
  });

  ipcMain.handle('logs:getByProject', (_event, projectId, limit = 50) => {
    return db.getLogsByProject(projectId, limit);
  });

  ipcMain.handle('logs:getDetail', (_event, logId) => {
    return db.getLogDetail(logId);
  });

  ipcMain.handle('logs:clear', (_event, projectId) => {
    return db.clearLogsForProject(projectId);
  });

  ipcMain.handle('settings:get', () => configStore.getSettings());

  ipcMain.handle('settings:save', (_event, settings) => {
    return configStore.saveSettings(settings);
  });

  ipcMain.handle('settings:reset', () => {
    configStore.resetAllData();
    db.resetDatabase();
    return { success: true };
  });

  ipcMain.handle('dialog:openDirectory', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Select Local Folder',
      properties: ['openDirectory'],
    });

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }
    return result.filePaths[0];
  });

  ipcMain.handle('dialog:openFile', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Select SSH Private Key',
      properties: ['openFile'],
      filters: [
        { name: 'SSH Keys', extensions: ['pem', 'key', 'rsa', 'pub'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    });

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }
    return result.filePaths[0];
  });

  ipcMain.handle('app:version', () => app.getVersion());

  ipcMain.handle('tools:detectAll', (_event, toolKeys) => detectAll(toolKeys));

  ipcMain.handle('tools:detectForStep', (_event, stepType, command) =>
    detectForStep(stepType, command || '')
  );

  ipcMain.handle('tools:getPlatform', () => getPlatform());

  ipcMain.handle('tools:rescan', (_event, toolKey) => detect(toolKey));

  ipcMain.handle('tools:getToolDefinition', (_event, toolKey) => {
    const tool = TOOLS[toolKey];
    if (!tool) return null;
    return {
      ...tool,
      toolKey,
    };
  });

  ipcMain.handle('tools:preDeployCheck', async (_event, projectId) => {
    const project = configStore.getProjectById(projectId);
    if (!project) {
      return { ok: false, error: 'Project not found', missingTools: [] };
    }
    return runPreDeployToolCheck(project);
  });

  ipcMain.on('tools:copyToClipboard', (_event, text) => {
    clipboard.writeText(String(text));
  });

  ipcMain.on('diagnostic:complete', () => {
    diagnosticPassed = true;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.loadFile(path.join(__dirname, 'src', 'renderer', 'index.html'));
    }
  });

  ipcMain.on('window:minimize', () => {
    if (mainWindow) mainWindow.minimize();
  });

  ipcMain.on('window:maximize', () => {
    if (mainWindow) {
      if (mainWindow.isMaximized()) {
        mainWindow.unmaximize();
      } else {
        mainWindow.maximize();
      }
    }
  });

  ipcMain.on('window:close', () => {
    if (mainWindow) mainWindow.hide();
  });
}

app.whenReady().then(() => {
  db.initDatabase();
  createWindow();
  createTray();
  registerIpcHandlers();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    } else if (mainWindow) {
      mainWindow.show();
    }
  });
});

app.on('before-quit', () => {
  app.isQuitting = true;
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
