/**
 * Terminal output handler for TechLapse Deploy Control
 */

class Terminal {
  constructor(containerId) {
    this.container = document.getElementById(containerId);
    this.autoScroll = true;
  }

  clear() {
    if (this.container) {
      this.container.innerHTML = '';
    }
  }

  appendLine(text, type = 'output') {
    if (!this.container) return;

    const line = document.createElement('div');
    line.className = `terminal-line ${type}`;
    line.textContent = text;
    this.container.appendChild(line);

    if (this.autoScroll) {
      this.scrollToBottom();
    }
  }

  appendRawOutput(rawText) {
    if (!rawText) return;
    const lines = rawText.split('\n');
    for (const text of lines) {
      if (text.trim()) {
        let type = 'output';
        if (text.includes('DEPLOY SUCCESS') || text.includes('SUCCESS')) {
          type = 'success';
        } else if (
          text.includes('FAILED') ||
          text.includes('ERROR') ||
          text.includes('error:')
        ) {
          type = 'error';
        } else if (text.startsWith('[') && text.includes(']$')) {
          type = 'command';
        } else if (text.includes('INITIATING') || text.includes('STEP')) {
          type = 'system';
        }
        this.appendLine(text, type);
      }
    }
    this.scrollToBottom();
  }

  scrollToBottom() {
    if (this.container) {
      this.container.scrollTop = this.container.scrollHeight;
    }
  }

  setAutoScroll(enabled) {
    this.autoScroll = enabled;
  }

  getRawText() {
    if (!this.container) return '';
    return Array.from(this.container.querySelectorAll('.terminal-line'))
      .map((el) => el.textContent)
      .join('\n');
  }
}

window.Terminal = Terminal;
