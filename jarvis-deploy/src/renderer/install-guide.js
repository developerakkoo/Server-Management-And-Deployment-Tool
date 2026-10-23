/**
 * JARVIS Deploy Control — Install Guide Modal
 */
(function () {
  'use strict';

  const PLATFORM_LABELS = {
    mac: 'macOS',
    linux: 'Linux',
    windows: 'Windows',
  };

  const COMMAND_PATTERN = /^(Run:|sudo |brew |curl |wsl |npm |nvm |apt |yum |dnf |Compress-Archive)/i;

  let currentToolKey = null;
  let currentPlatform = 'mac';
  let onStatusUpdate = null;
  let onClose = null;

  function getApi() {
    return window.jarvis?.tools || window.techlapse?.tools;
  }

  function isCommandStep(step) {
    const trimmed = step.trim();
    if (!trimmed) return false;
    if (COMMAND_PATTERN.test(trimmed)) return true;
    if (/^[\w./\\-]+(\s+[\w./\\-]+)*$/.test(trimmed) && !trimmed.startsWith('OPTION')) {
      return trimmed.includes(' ') || trimmed.includes('install') || trimmed.includes('--');
    }
    return false;
  }

  function renderSteps(steps) {
    let stepNum = 0;
    let html = '<ol class="ig-steps">';

    steps.forEach((step) => {
      const trimmed = step.trim();
      if (!trimmed) return;

      if (isCommandStep(trimmed)) {
        html += `
          <li class="ig-step">
            <div class="ig-code-block">
              <code>${escapeHtml(trimmed)}</code>
              <button type="button" class="ig-copy-btn" data-copy="${escapeAttr(trimmed)}">COPY</button>
            </div>
          </li>`;
      } else {
        stepNum += 1;
        html += `<li class="ig-step"><span class="ig-step-num">${String(stepNum).padStart(2, '0')}.</span>${escapeHtml(trimmed)}</li>`;
      }
    });

    html += '</ol>';
    return html;
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function escapeAttr(str) {
    return escapeHtml(str).replace(/'/g, '&#39;');
  }

  async function openInstallGuide(toolKey, options = {}) {
    const api = getApi();
    if (!api) return;

    currentToolKey = toolKey;
    onStatusUpdate = options.onStatusUpdate || null;
    onClose = options.onClose || null;

    const [toolDef, platform] = await Promise.all([
      api.getToolDefinition(toolKey),
      api.getPlatform(),
    ]);

    if (!toolDef) return;

    currentPlatform = platform;
    const overlay = document.getElementById('install-guide-overlay');
    const panel = document.getElementById('install-guide-panel');
    if (!overlay || !panel) return;

    const isCritical = toolDef.critical;

    panel.innerHTML = `
      <div class="ig-header">
        <span class="ig-icon">${toolDef.icon || '◈'}</span>
        <div class="ig-title-block">
          <h2>${escapeHtml(toolDef.name)}</h2>
          <div class="ig-label">INSTALLATION REQUIRED</div>
        </div>
      </div>
      <div class="ig-tabs" id="ig-tabs">
        ${['mac', 'linux', 'windows']
          .map(
            (p) =>
              `<button type="button" class="ig-tab${p === platform ? ' active' : ''}" data-platform="${p}">${PLATFORM_LABELS[p]}</button>`
          )
          .join('')}
      </div>
      <div class="ig-content" id="ig-content"></div>
      <div class="ig-footer">
        <button type="button" class="ig-btn" id="ig-rescan">↻ RE-SCAN THIS TOOL</button>
        ${isCritical ? '' : '<button type="button" class="ig-btn ig-btn-danger" id="ig-skip">SKIP FOR NOW</button>'}
        <button type="button" class="ig-btn ig-btn-success" id="ig-resolved">✓ MARK AS RESOLVED</button>
      </div>
    `;

    renderPlatformContent(toolDef, platform);
    bindGuideEvents(toolDef, isCritical);

    overlay.classList.remove('hidden');
  }

  function renderPlatformContent(toolDef, platform) {
    const content = document.getElementById('ig-content');
    if (!content) return;

    const plat = toolDef.platforms?.[platform];
    if (!plat) {
      content.innerHTML = '<p class="ig-note">No install guide available for this platform.</p>';
      return;
    }

    let html = '';

    if (plat.preInstalled) {
      html += '<div class="ig-preinstalled">✓ PRE-INSTALLED ON THIS OS</div>';
      html += '<p class="ig-note" style="margin-top:-8px;font-size:13px;">If missing, this may indicate a corrupted installation</p>';
    }

    html += `<div class="ig-note">${escapeHtml(plat.note)}</div>`;
    html += renderSteps(plat.installSteps || []);

    if (plat.installCommands && plat.installCommands.length > 0) {
      const cmd = plat.installCommands[0];
      html += `
        <div class="ig-quick-install">
          <button type="button" class="diag-btn" id="ig-quick-copy">⚡ COPY INSTALL COMMAND</button>
          <div class="ig-code-block" style="margin-left:0;margin-top:10px;">
            <code>${escapeHtml(cmd)}</code>
          </div>
        </div>`;
    }

    content.innerHTML = html;

    content.querySelectorAll('.ig-copy-btn').forEach((btn) => {
      btn.addEventListener('click', () => copyText(btn.dataset.copy, btn));
    });

    const quickCopy = document.getElementById('ig-quick-copy');
    if (quickCopy && plat.installCommands?.[0]) {
      quickCopy.addEventListener('click', () => {
        copyText(plat.installCommands[0], quickCopy, 'COPIED TO CLIPBOARD');
      });
    }
  }

  function bindGuideEvents(toolDef, isCritical) {
    document.getElementById('ig-tabs')?.querySelectorAll('.ig-tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.ig-tab').forEach((t) => t.classList.remove('active'));
        tab.classList.add('active');
        currentPlatform = tab.dataset.platform;
        renderPlatformContent(toolDef, currentPlatform);
      });
    });

    document.getElementById('ig-rescan')?.addEventListener('click', async () => {
      const btn = document.getElementById('ig-rescan');
      if (!btn) return;
      const original = btn.textContent;
      btn.disabled = true;
      btn.innerHTML = '<span class="ig-rescan-spinner">↻</span> SCANNING...';

      const api = getApi();
      const result = await api.rescan(currentToolKey);

      btn.disabled = false;
      btn.textContent = original;

      if (onStatusUpdate) {
        onStatusUpdate(result);
      }

      if (result.available) {
        closeInstallGuide();
      }
    });

    document.getElementById('ig-skip')?.addEventListener('click', () => {
      closeInstallGuide();
    });

    document.getElementById('ig-resolved')?.addEventListener('click', async () => {
      const btn = document.getElementById('ig-resolved');
      if (!btn) return;
      btn.disabled = true;
      btn.textContent = 'VERIFYING...';

      const api = getApi();
      const result = await api.rescan(currentToolKey);

      btn.disabled = false;
      btn.textContent = '✓ MARK AS RESOLVED';

      if (onStatusUpdate) {
        onStatusUpdate(result);
      }

      if (result.available) {
        closeInstallGuide();
      } else {
        btn.textContent = '✕ STILL MISSING — TRY AGAIN';
        setTimeout(() => {
          btn.textContent = '✓ MARK AS RESOLVED';
        }, 2500);
      }
    });
  }

  function copyText(text, btn, flashText = 'COPIED') {
    const api = getApi();
    if (api?.copyToClipboard) {
      api.copyToClipboard(text);
    } else if (navigator.clipboard) {
      navigator.clipboard.writeText(text);
    }

    if (btn) {
      const original = btn.textContent;
      btn.textContent = flashText;
      btn.classList.add('copied');
      setTimeout(() => {
        btn.textContent = original;
        btn.classList.remove('copied');
      }, 2000);
    }
  }

  function closeInstallGuide() {
    const overlay = document.getElementById('install-guide-overlay');
    if (overlay) overlay.classList.add('hidden');
    if (onClose) onClose();
  }

  window.InstallGuide = {
    open: openInstallGuide,
    close: closeInstallGuide,
  };
})();
