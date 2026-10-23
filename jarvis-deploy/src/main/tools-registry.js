const TOOLS = {
  rsync: {
    name: 'Rsync',
    icon: '⇄',
    description: 'File synchronization tool — syncs only changed files to server',
    usedBy: ['RSYNC step'],
    checkCommand: 'rsync --version',
    critical: false,
    platforms: {
      mac: {
        preInstalled: true,
        note: 'Built into macOS. Should work out of the box.',
        installSteps: [
          'Open Terminal',
          'Run: xcode-select --install',
          'If still missing, run: brew install rsync',
          'Verify with: rsync --version',
        ],
        installCommands: ['brew install rsync'],
      },
      linux: {
        preInstalled: false,
        note: 'Available via package manager. Not always pre-installed.',
        installSteps: [
          'Open Terminal',
          'Run: sudo apt install rsync (Ubuntu/Debian)',
          'OR: sudo yum install rsync (CentOS/RHEL)',
          'OR: sudo dnf install rsync (Fedora)',
          'Verify with: rsync --version',
        ],
        installCommands: ['sudo apt install rsync'],
      },
      windows: {
        preInstalled: false,
        note: 'NOT built into Windows. Requires WSL or Git Bash or Cygwin.',
        installSteps: [
          'OPTION A — WSL (Recommended):',
          '  1. Open PowerShell as Administrator',
          '  2. Run: wsl --install',
          '  3. Restart your machine',
          '  4. Open WSL terminal and run: sudo apt install rsync',
          '',
          'OPTION B — Git for Windows:',
          '  1. Download Git for Windows from https://git-scm.com/download/win',
          '  2. During install, select "Use Git and optional Unix tools from Command Prompt"',
          '  3. Restart your machine',
          '  4. Open Command Prompt and run: rsync --version',
          '',
          'OPTION C — Cygwin:',
          '  1. Download Cygwin from https://www.cygwin.com/',
          '  2. During setup, select the rsync package',
          '  3. Add Cygwin bin folder to system PATH',
        ],
        installCommands: [],
      },
    },
  },

  ssh: {
    name: 'SSH Client',
    icon: '⬡',
    description: 'Secure Shell — used to connect and run commands on remote servers',
    usedBy: ['SSH_COMMAND', 'GIT_PULL', 'PM2_COMMAND', 'NGINX_RELOAD', 'all remote steps'],
    checkCommand: 'ssh -V',
    critical: true,
    platforms: {
      mac: {
        preInstalled: true,
        note: 'Built into macOS. Available in all versions.',
        installSteps: ['Already installed. No action needed.'],
        installCommands: [],
      },
      linux: {
        preInstalled: true,
        note: 'Usually pre-installed. If missing, install openssh-client.',
        installSteps: ['Run: sudo apt install openssh-client', 'Verify: ssh -V'],
        installCommands: ['sudo apt install openssh-client'],
      },
      windows: {
        preInstalled: true,
        note:
          'Built into Windows 10 (1809+) and Windows 11 via OpenSSH Client optional feature.',
        installSteps: [
          'If ssh command is not found:',
          '  1. Open Settings → Apps → Optional Features',
          '  2. Click "Add a feature"',
          '  3. Find and install "OpenSSH Client"',
          '  4. Restart Command Prompt and run: ssh -V',
          '',
          'Alternative — Git for Windows includes SSH:',
          '  Download from https://git-scm.com/download/win',
        ],
        installCommands: [],
      },
    },
  },

  git: {
    name: 'Git',
    icon: '⎇',
    description: 'Version control — used for git pull on remote server steps',
    usedBy: ['GIT_PULL step'],
    checkCommand: 'git --version',
    critical: false,
    platforms: {
      mac: {
        preInstalled: true,
        note: 'Included with Xcode Command Line Tools.',
        installSteps: [
          'Run: xcode-select --install',
          'OR install via Homebrew: brew install git',
          'Verify: git --version',
        ],
        installCommands: ['brew install git'],
      },
      linux: {
        preInstalled: false,
        note: 'Install via package manager.',
        installSteps: ['Run: sudo apt install git', 'Verify: git --version'],
        installCommands: ['sudo apt install git'],
      },
      windows: {
        preInstalled: false,
        note: 'Not built into Windows. Install Git for Windows.',
        installSteps: [
          '  1. Go to https://git-scm.com/download/win',
          '  2. Download and run the installer',
          '  3. Use default settings',
          '  4. Restart Command Prompt',
          '  5. Verify: git --version',
        ],
        installCommands: [],
      },
    },
  },

  node: {
    name: 'Node.js',
    icon: '◉',
    description: 'JavaScript runtime — needed for npm install and npm run build locally',
    usedBy: ['LOCAL_SHELL steps running npm commands'],
    checkCommand: 'node --version',
    critical: false,
    platforms: {
      mac: {
        preInstalled: false,
        note: 'Install via nvm (recommended) or official installer.',
        installSteps: [
          'RECOMMENDED — nvm:',
          '  1. Run: curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash',
          '  2. Restart terminal',
          '  3. Run: nvm install --lts',
          '  4. Verify: node --version',
          '',
          'OR download installer from: https://nodejs.org',
        ],
        installCommands: ['brew install node'],
      },
      linux: {
        preInstalled: false,
        note: 'Install via nvm or NodeSource.',
        installSteps: [
          'Run: curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -',
          'Run: sudo apt install nodejs',
          'Verify: node --version',
        ],
        installCommands: [],
      },
      windows: {
        preInstalled: false,
        note: 'Download from official Node.js website.',
        installSteps: [
          '  1. Go to https://nodejs.org',
          '  2. Download the LTS installer',
          '  3. Run installer with default settings',
          '  4. Restart Command Prompt',
          '  5. Verify: node --version',
        ],
        installCommands: [],
      },
    },
  },

  zip: {
    name: 'Zip / Unzip',
    icon: '▣',
    description: 'File compression — used for zip-based deploy strategies',
    usedBy: ['LOCAL_ZIP step', 'REMOTE_UNZIP step'],
    checkCommand: 'zip --version',
    critical: false,
    platforms: {
      mac: {
        preInstalled: true,
        note: 'Built into macOS.',
        installSteps: ['Already installed. No action needed.'],
        installCommands: [],
      },
      linux: {
        preInstalled: false,
        note: 'Install via package manager.',
        installSteps: ['Run: sudo apt install zip unzip', 'Verify: zip --version'],
        installCommands: ['sudo apt install zip unzip'],
      },
      windows: {
        preInstalled: true,
        note: 'Windows has built-in zip support. For command-line zip, use 7-Zip.',
        installSteps: [
          'For command-line zip (7-Zip recommended):',
          '  1. Download from https://www.7-zip.org/',
          '  2. Install and add to PATH',
          '  3. Verify: 7z --help',
          '',
          'OR use PowerShell built-in:',
          '  Compress-Archive -Path .\\dist -DestinationPath dist.zip',
        ],
        installCommands: [],
      },
    },
  },

  docker: {
    name: 'Docker',
    icon: '⬢',
    description: 'Container platform — used for Docker-based frontend deploys',
    usedBy: ['LOCAL_SHELL steps running docker commands'],
    checkCommand: 'docker --version',
    critical: false,
    platforms: {
      mac: {
        preInstalled: false,
        note: 'Install Docker Desktop for Mac.',
        installSteps: [
          '  1. Go to https://www.docker.com/products/docker-desktop',
          '  2. Download Docker Desktop for Mac (choose Apple Silicon or Intel)',
          '  3. Install and launch Docker Desktop',
          '  4. Verify: docker --version',
        ],
        installCommands: ['brew install --cask docker'],
      },
      linux: {
        preInstalled: false,
        note: 'Install Docker Engine.',
        installSteps: [
          '  1. Run: curl -fsSL https://get.docker.com | sh',
          '  2. Run: sudo usermod -aG docker $USER',
          '  3. Logout and login again',
          '  4. Verify: docker --version',
        ],
        installCommands: [],
      },
      windows: {
        preInstalled: false,
        note: 'Install Docker Desktop for Windows. Requires WSL2.',
        installSteps: [
          '  1. First install WSL2: wsl --install in PowerShell as Admin',
          '  2. Restart machine',
          '  3. Go to https://www.docker.com/products/docker-desktop',
          '  4. Download and install Docker Desktop for Windows',
          '  5. Launch Docker Desktop',
          '  6. Verify: docker --version',
        ],
        installCommands: [],
      },
    },
  },
};

const CRITICAL_TOOLS = ['ssh'];
const STARTUP_SCAN_TOOLS = ['rsync', 'ssh', 'git', 'node', 'zip'];

const STEP_TOOL_MAP = {
  RSYNC: ['rsync', 'ssh'],
  SSH_COMMAND: ['ssh'],
  GIT_PULL: ['ssh', 'git'],
  LOCAL_SHELL: ['node'],
  LOCAL_ZIP: ['zip'],
  SCP_FILE: ['ssh'],
  SFTP_UPLOAD: ['ssh'],
  DOCKER: ['docker'],
  PM2_COMMAND: ['ssh'],
  NGINX_RELOAD: ['ssh'],
  REMOTE_UNZIP: ['ssh'],
  LOCAL_SYNC: ['rsync', 'ssh'],
};

module.exports = {
  TOOLS,
  CRITICAL_TOOLS,
  STARTUP_SCAN_TOOLS,
  STEP_TOOL_MAP,
};
