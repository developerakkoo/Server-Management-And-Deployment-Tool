const Store = require('electron-store');
const { v4: uuidv4 } = require('uuid');
const {
  getDefaultDeployCommands,
  getDefaultFrontendDeployCommands,
  migrateLegacyProject,
  stripLegacyFields,
  isBackendProject,
} = require('./deploy-command-parser');

const store = new Store({
  name: 'techlapse-deploy-config',
  defaults: {
    projects: [],
    servers: [],
    settings: {
      defaultPort: 22,
      defaultBranch: 'main',
      defaultDeployCommands: getDefaultDeployCommands(),
      commandTimeoutMs: 600000,
      migratedFromJarvis: false,
    },
  },
});

function migrateFromLegacyJarvisStore() {
  const settings = store.get('settings', {});
  if (settings.migratedFromJarvis) return;

  const hasData =
    store.get('projects', []).length > 0 || store.get('servers', []).length > 0;
  if (hasData) {
    store.set('settings', { ...settings, migratedFromJarvis: true });
    return;
  }

  const legacyStore = new Store({ name: 'jarvis-deploy-config' });
  const legacyProjects = legacyStore.get('projects', []);
  const legacyServers = legacyStore.get('servers', []);
  const legacySettings = legacyStore.get('settings', {});

  if (legacyProjects.length === 0 && legacyServers.length === 0) {
    store.set('settings', { ...settings, migratedFromJarvis: true });
    return;
  }

  store.set('projects', legacyProjects);
  store.set('servers', legacyServers);
  store.set('settings', {
    defaultPort: legacySettings.defaultPort || 22,
    defaultBranch: legacySettings.defaultBranch || 'main',
    defaultDeployCommands:
      legacySettings.defaultDeployCommands || getDefaultDeployCommands(),
    commandTimeoutMs: legacySettings.commandTimeoutMs || 600000,
    migratedFromJarvis: true,
  });
}

migrateFromLegacyJarvisStore();

function extractServerCredentials(source) {
  if (!source) return null;
  const authMethod = source.authMethod || (source.password ? 'password' : 'pem-key');
  return {
    host: source.host,
    port: source.port || 22,
    username: source.username,
    authMethod,
    privateKeyPath: source.privateKeyPath || '',
    password: source.password || '',
  };
}

function normalizeProject(project) {
  let normalized = migrateLegacyProject({ ...project });

  if (!normalized.liveWwwPath && normalized.wwwPath) {
    normalized.liveWwwPath = normalized.wwwPath;
  }

  if (!normalized.nginxUser) {
    normalized.nginxUser = 'www-data';
  }

  if (!normalized.branch) {
    normalized.branch = store.get('settings.defaultBranch', 'main');
  }

  if (!normalized.projectKind) {
    normalized.projectKind = 'frontend';
  }

  if (!normalized.deployCommands?.trim()) {
    normalized.deployCommands = isBackendProject(normalized)
      ? getDefaultDeployCommands(normalized)
      : store.get('settings.defaultDeployCommands') || getDefaultFrontendDeployCommands();
  }

  return normalized;
}

function sanitizeProjectForRenderer(project) {
  const normalized = normalizeProject(project);
  const stripped = stripLegacyFields(normalized);
  const { password, ...rest } = stripped;
  return {
    ...rest,
    hasPassword: Boolean(password),
  };
}

function getRawProjects() {
  return store.get('projects', []);
}

function getProjects() {
  return getRawProjects().map(sanitizeProjectForRenderer);
}

function getProjectById(id) {
  const project = getRawProjects().find((p) => p.id === id);
  return project ? normalizeProject(project) : null;
}

function buildProjectRecord(projectData, existing = null) {
  const authMethod = projectData.authMethod || 'pem-key';
  const settings = getSettings();

  const record = stripLegacyFields(
    normalizeProject({
      ...(existing || {}),
      ...projectData,
      authMethod,
      projectPath: projectData.projectPath ?? existing?.projectPath ?? '',
      projectKind: projectData.projectKind ?? existing?.projectKind ?? 'frontend',
      pm2AppName: projectData.pm2AppName ?? existing?.pm2AppName ?? '',
      runNpmInstallOnDeploy:
        projectData.runNpmInstallOnDeploy ?? existing?.runNpmInstallOnDeploy ?? false,
      branch: projectData.branch || existing?.branch || settings.defaultBranch || 'main',
      liveWwwPath: projectData.liveWwwPath || existing?.liveWwwPath || '',
      nginxUser: projectData.nginxUser || existing?.nginxUser || 'www-data',
      deployCommands:
        projectData.deployCommands?.trim() ||
        existing?.deployCommands ||
        (projectData.projectKind === 'backend' || existing?.projectKind === 'backend'
          ? getDefaultDeployCommands({
              projectKind: projectData.projectKind ?? existing?.projectKind,
              runNpmInstallOnDeploy:
                projectData.runNpmInstallOnDeploy ?? existing?.runNpmInstallOnDeploy,
              pm2AppName: projectData.pm2AppName ?? existing?.pm2AppName,
            })
          : settings.defaultDeployCommands || getDefaultFrontendDeployCommands()),
    })
  );

  if (authMethod === 'password') {
    record.privateKeyPath = '';
    if (!projectData.password && existing?.password) {
      record.password = existing.password;
    } else {
      record.password = projectData.password || '';
    }
  } else {
    record.password = '';
    record.privateKeyPath = projectData.privateKeyPath || existing?.privateKeyPath || '';
  }

  return record;
}

function saveProject(projectData) {
  const projects = getRawProjects();
  const now = Date.now();

  if (projectData.id) {
    const index = projects.findIndex((p) => p.id === projectData.id);
    if (index === -1) {
      throw new Error('Project not found');
    }

    const existing = projects[index];
    const updated = buildProjectRecord(projectData, existing);
    updated.id = existing.id;
    updated.createdAt = existing.createdAt;
    updated.updatedAt = now;

    projects[index] = updated;
    store.set('projects', projects);
    return sanitizeProjectForRenderer(projects[index]);
  }

  const newProject = buildProjectRecord(projectData);
  newProject.id = uuidv4();
  newProject.createdAt = now;
  newProject.updatedAt = now;

  projects.push(newProject);
  store.set('projects', projects);
  return sanitizeProjectForRenderer(newProject);
}

function deleteProject(id) {
  const projects = getRawProjects().filter((p) => p.id !== id);
  store.set('projects', projects);
  return { success: true };
}

function getSettings() {
  const settings = store.get('settings');
  if (!settings.defaultDeployCommands) {
    settings.defaultDeployCommands = getDefaultDeployCommands();
  }
  if (!settings.commandTimeoutMs) {
    settings.commandTimeoutMs = 600000;
  }
  return settings;
}

function saveSettings(settings) {
  const current = getSettings();
  store.set('settings', { ...current, ...settings });
  return getSettings();
}

function sanitizeServerForRenderer(server) {
  const { password, ...rest } = server;
  return {
    ...rest,
    hasPassword: Boolean(password),
  };
}

function getRawServers() {
  return store.get('servers', []);
}

function getServers() {
  return getRawServers().map(sanitizeServerForRenderer);
}

function getServerById(id) {
  return getRawServers().find((s) => s.id === id) || null;
}

function getServerCredentials(sourceType, id) {
  if (sourceType === 'preset') {
    return extractServerCredentials(getServerById(id));
  }
  if (sourceType === 'project') {
    return extractServerCredentials(getProjectById(id));
  }
  return null;
}

function saveServerPreset(serverData) {
  const servers = getRawServers();
  const now = Date.now();
  const authMethod = serverData.authMethod || 'pem-key';

  if (serverData.id) {
    const index = servers.findIndex((s) => s.id === serverData.id);
    if (index === -1) {
      throw new Error('Server preset not found');
    }

    const existing = servers[index];
    const updated = {
      ...existing,
      ...serverData,
      authMethod,
      updatedAt: now,
    };

    if (authMethod === 'password') {
      updated.privateKeyPath = '';
      if (!serverData.password && existing.password) {
        updated.password = existing.password;
      }
    } else {
      updated.password = '';
    }

    servers[index] = updated;
    store.set('servers', servers);
    return sanitizeServerForRenderer(servers[index]);
  }

  const newServer = {
    id: uuidv4(),
    name: serverData.name,
    host: serverData.host,
    port: serverData.port || store.get('settings.defaultPort', 22),
    username: serverData.username,
    authMethod,
    privateKeyPath: authMethod === 'pem-key' ? serverData.privateKeyPath || '' : '',
    password: authMethod === 'password' ? serverData.password || '' : '',
    createdAt: now,
    updatedAt: now,
  };

  servers.push(newServer);
  store.set('servers', servers);
  return sanitizeServerForRenderer(newServer);
}

function deleteServerPreset(id) {
  const servers = getRawServers().filter((s) => s.id !== id);
  store.set('servers', servers);
  return { success: true };
}

function resetAllData() {
  store.clear();
  store.set('projects', []);
  store.set('servers', []);
  store.set('settings', {
    defaultPort: 22,
    defaultBranch: 'main',
    defaultDeployCommands: getDefaultDeployCommands(),
    commandTimeoutMs: 600000,
    migratedFromJarvis: false,
  });
}

module.exports = {
  getProjects,
  getProjectById,
  saveProject,
  deleteProject,
  getServers,
  getServerCredentials,
  saveServerPreset,
  deleteServerPreset,
  getSettings,
  saveSettings,
  resetAllData,
};
