/**
 * JARVIS Deploy Control — Startup System Diagnostic
 */
(function () {
  'use strict';

  const STARTUP_TOOLS = ['rsync', 'ssh', 'git', 'node', 'zip'];
  const CRITICAL_TOOLS = ['ssh'];
  const STAGGER_MS = 200;
  const AUTO_PROCEED_MS = 1500;

  const state = {
    toolResults: new Map(),
    scanComplete: false,
  };

  function getApi() {
    return window.jarvis?.tools || window.techlapse?.tools;
  }

  function getWindowApi() {
    return window.jarvis || window.techlapse;
  }

  function $(sel) {
    return document.querySelector(sel);
  }

  function createToolRows() {
    const list = $('#tool-list');
    if (!list) return;

    list.innerHTML = STARTUP_TOOLS.map((key, index) => `
      <div class="diag-tool-row" id="tool-row-${key}" data-tool="${key}" style="transition-delay: ${index * STAGGER_MS}ms">
        <span class="diag-tool-icon" id="tool-icon-${key}">◈</span>
        <span class="diag-tool-name" id="tool-name-${key}">${key.toUpperCase()}</span>
        <span class="diag-tool-desc" id="tool-desc-${key}">Initializing scan...</span>
        <span class="diag-status-badge pending" id="tool-badge-${key}">
          <span class="diag-status-dot"></span> PENDING
        </span>
      </div>
    `).join('');
  }

  function setBadge(toolKey, status, text) {
    const badge = $(`#tool-badge-${toolKey}`);
    if (!badge) return;

    badge.className = `diag-status-badge ${status}`;
    let dotClass = '';
    if (status === 'scanning') dotClass = 'amber';
    else if (status === 'online') dotClass = 'green';
    else if (status === 'missing') dotClass = 'red';

    badge.innerHTML = dotClass
      ? `<span class="diag-status-dot ${dotClass}"></span> ${text}`
      : text;
  }

  function updateToolRow(result) {
    const row = $(`#tool-row-${result.toolKey}`);
    const icon = $(`#tool-icon-${result.toolKey}`);
    const name = $(`#tool-name-${result.toolKey}`);
    const desc = $(`#tool-desc-${result.toolKey}`);

    if (icon && result.icon) icon.textContent = result.icon;
    if (name && result.name) name.textContent = result.name.toUpperCase();
    if (desc && result.description) desc.textContent = result.description;

    if (row) {
      row.classList.add('visible');
      row.classList.toggle('missing', !result.available);
    }

    if (result.available) {
      const versionText = result.version ? `v${result.version}` : 'OK';
      setBadge(result.toolKey, 'online', `ONLINE ${versionText}`);
    } else {
      setBadge(result.toolKey, 'missing', 'MISSING — ACTION REQUIRED');
    }

    state.toolResults.set(result.toolKey, result);
  }

  async function scanToolSequential(toolKey, index) {
    await delay(index * STAGGER_MS);

    setBadge(toolKey, 'scanning', 'SCANNING...');
    const row = $(`#tool-row-${toolKey}`);
    if (row) row.classList.add('visible');

    const api = getApi();
    const result = await api.rescan(toolKey);
    updateToolRow(result);
    return result;
  }

  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function runDiagnostic() {
    createToolRows();

    const api = getApi();
    const definitions = await Promise.all(
      STARTUP_TOOLS.map((key) => api.getToolDefinition(key))
    );

    definitions.forEach((def, i) => {
      if (!def) return;
      const key = STARTUP_TOOLS[i];
      const desc = $(`#tool-desc-${key}`);
      const icon = $(`#tool-icon-${key}`);
      const name = $(`#tool-name-${key}`);
      if (desc) desc.textContent = def.description;
      if (icon) icon.textContent = def.icon || '◈';
      if (name) name.textContent = def.name.toUpperCase();
    });

    const scanPromises = STARTUP_TOOLS.map((key, index) => scanToolSequential(key, index));
    const results = await Promise.all(scanPromises);

    state.scanComplete = true;
    finishDiagnostic(results);
  }

  function finishDiagnostic(results) {
    const sweep = $('#sweep-line');
    if (sweep) sweep.classList.add('done');

    const missing = results.filter((r) => !r.available);
    const criticalMissing = missing.filter((r) => CRITICAL_TOOLS.includes(r.toolKey));
    const allOnline = missing.length === 0;

    if (allOnline) {
      showNominalState();
      return;
    }

    showWarningState(missing, criticalMissing);
  }

  function showNominalState() {
    const nominal = $('#diag-nominal');
    const warning = $('#diag-warning');
    if (warning) warning.classList.add('hidden');
    if (nominal) nominal.classList.remove('hidden');

    const fill = $('#countdown-fill');
    if (fill) {
      requestAnimationFrame(() => {
        fill.classList.add('counting');
      });
    }

    setTimeout(() => {
      proceedToDashboard();
    }, AUTO_PROCEED_MS);
  }

  function showWarningState(missing, criticalMissing) {
    const nominal = $('#diag-nominal');
    const warning = $('#diag-warning');
    const actions = $('#missing-actions');
    const continueBtn = $('#btn-continue-dashboard');

    if (nominal) nominal.classList.add('hidden');
    if (warning) warning.classList.remove('hidden');

    if (actions) {
      actions.innerHTML = missing
        .map(
          (r) =>
            `<button type="button" class="diag-btn" data-guide="${r.toolKey}">VIEW INSTALL GUIDE — ${r.name || r.toolKey}</button>`
        )
        .join('');

      actions.querySelectorAll('[data-guide]').forEach((btn) => {
        btn.addEventListener('click', () => {
          window.InstallGuide.open(btn.dataset.guide, {
            onStatusUpdate: (result) => updateToolRow(result),
            onClose: () => recheckAfterGuide(),
          });
        });
      });
    }

    if (continueBtn) {
      if (criticalMissing.length === 0) {
        continueBtn.classList.remove('hidden');
        continueBtn.addEventListener('click', proceedToDashboard, { once: true });
      } else {
        continueBtn.classList.add('hidden');
      }
    }
  }

  function recheckAfterGuide() {
    const results = [...state.toolResults.values()];
    const missing = results.filter((r) => !r.available);
    const criticalMissing = missing.filter((r) => CRITICAL_TOOLS.includes(r.toolKey));

    if (missing.length === 0) {
      showNominalState();
    } else if (criticalMissing.length === 0) {
      const continueBtn = $('#btn-continue-dashboard');
      if (continueBtn) continueBtn.classList.remove('hidden');
    }
  }

  function proceedToDashboard() {
    const winApi = getWindowApi();
    if (winApi?.diagnosticComplete) {
      winApi.diagnosticComplete();
    }
  }

  function setupWindowControls() {
    const winApi = getWindowApi();
    if (!winApi) return;

    $('#btn-minimize')?.addEventListener('click', () => winApi.minimizeWindow());
    $('#btn-maximize')?.addEventListener('click', () => winApi.maximizeWindow());
    $('#btn-close')?.addEventListener('click', () => winApi.closeWindow());
  }

  document.addEventListener('DOMContentLoaded', () => {
    setupWindowControls();
    runDiagnostic();
  });
})();
