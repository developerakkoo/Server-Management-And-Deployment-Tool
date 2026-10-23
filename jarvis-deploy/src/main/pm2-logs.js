const { connectSSH } = require('./ssh-executor');

const activePm2Streams = new Map();

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function openShell(conn) {
  return new Promise((resolve, reject) => {
    conn.shell({ term: 'dumb' }, (err, stream) => {
      if (err) reject(err);
      else resolve(stream);
    });
  });
}

async function startPm2LogStream(project, sendOutput) {
  const projectId = project.id;
  if (activePm2Streams.has(projectId)) {
    return { success: false, error: 'PM2 log stream already active for this project' };
  }

  if (!project.pm2AppName?.trim()) {
    return { success: false, error: 'PM2 App Name is not configured' };
  }

  let conn;
  let shellStream;

  try {
    conn = await connectSSH(project);
    shellStream = await openShell(conn);

    const appName = project.pm2AppName.trim();
    const quotedApp = shellQuote(appName);
    const entry = {
      conn,
      shellStream,
      aborted: false,
    };
    activePm2Streams.set(projectId, entry);

    const emitLine = (line, type = 'output') => {
      sendOutput({
        event: 'line',
        projectId,
        line,
        type,
      });
    };

    shellStream.on('data', (data) => {
      if (entry.aborted) return;
      const text = data.toString();
      for (const line of text.split('\n')) {
        if (line.trim()) {
          emitLine(line, 'output');
        }
      }
    });

    if (shellStream.stderr) {
      shellStream.stderr.on('data', (data) => {
        if (entry.aborted) return;
        const text = data.toString();
        for (const line of text.split('\n')) {
          if (line.trim()) {
            emitLine(line, 'error');
          }
        }
      });
    }

    shellStream.on('close', () => {
      if (!entry.aborted) {
        sendOutput({
          event: 'done',
          projectId,
          success: true,
        });
      }
      activePm2Streams.delete(projectId);
      if (conn) conn.end();
    });

    shellStream.write(`pm2 logs ${quotedApp} --raw\n`);

    return { success: true, appName };
  } catch (err) {
    activePm2Streams.delete(projectId);
    if (shellStream) {
      try {
        shellStream.end('exit\n');
      } catch {
        // ignore
      }
    }
    if (conn) conn.end();
    return { success: false, error: err.message };
  }
}

function stopPm2LogStream(projectId) {
  const entry = activePm2Streams.get(projectId);
  if (!entry) {
    return { success: false, message: 'No active PM2 log stream' };
  }

  entry.aborted = true;
  activePm2Streams.delete(projectId);

  try {
    if (entry.shellStream) {
      entry.shellStream.write('\x03');
      entry.shellStream.end('exit\n');
    }
  } catch {
    // ignore
  }

  if (entry.conn) {
    entry.conn.end();
  }

  return { success: true };
}

function isPm2StreamActive(projectId) {
  return activePm2Streams.has(projectId);
}

module.exports = {
  startPm2LogStream,
  stopPm2LogStream,
  isPm2StreamActive,
};
