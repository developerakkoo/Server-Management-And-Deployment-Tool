const { execCommand, connectSSH } = require('./ssh-executor');
const { isBackendProject } = require('./deploy-command-parser');

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

async function validateProjectPaths(project) {
  const checks = [];
  const dest = project.liveWwwPath || '';

  let conn;
  try {
    conn = await connectSSH(project);

    if (project.projectPath) {
      const projectCheck = await execCommand(
        conn,
        `test -d ${shellQuote(project.projectPath)} && echo PROJECT_OK || echo PROJECT_MISSING`
      );
      checks.push({
        name: 'Remote project path',
        path: project.projectPath,
        ok: projectCheck.stdout.includes('PROJECT_OK'),
        message: projectCheck.stdout.includes('PROJECT_OK')
          ? 'Exists'
          : 'Directory not found',
      });
    }

    if (isBackendProject(project) && project.pm2AppName?.trim()) {
      const quotedApp = shellQuote(project.pm2AppName.trim());
      const pm2Check = await execCommand(
        conn,
        `pm2 describe ${quotedApp} >/dev/null 2>&1 && echo PM2_OK || echo PM2_MISSING`
      );
      checks.push({
        name: 'PM2 process',
        path: project.pm2AppName,
        ok: pm2Check.stdout.includes('PM2_OK'),
        message: pm2Check.stdout.includes('PM2_OK')
          ? 'PM2 app found on server'
          : 'PM2 app not found — verify app name with pm2 list',
      });
    }

    if (dest && !isBackendProject(project)) {
      const destCheck = await execCommand(
        conn,
        `test -d ${shellQuote(dest)} && echo DEST_OK || echo DEST_MISSING`
      );

      checks.push({
        name: 'Live nginx path',
        path: dest,
        ok: destCheck.stdout.includes('DEST_OK'),
        message: destCheck.stdout.includes('DEST_OK')
          ? 'Exists'
          : 'Directory not found',
      });

      const escapedDest = dest.replace(/'/g, `'\\''`);
      const nginxCheck = await execCommand(
        conn,
        `grep -r "root " /etc/nginx/ 2>/dev/null | grep -F '${escapedDest}' || echo NGINX_NO_MATCH`
      );
      const nginxMatch = !nginxCheck.stdout.includes('NGINX_NO_MATCH') && nginxCheck.stdout.trim();
      checks.push({
        name: 'Nginx root directive',
        path: dest,
        ok: Boolean(nginxMatch),
        message: nginxMatch
          ? 'Nginx config references this path'
          : 'No matching nginx root directive found — verify live path',
      });
    }

    const allOk = checks.every((c) => c.ok);
    return { success: allOk, checks };
  } catch (err) {
    return {
      success: false,
      error: err.message,
      checks,
    };
  } finally {
    if (conn) conn.end();
  }
}

async function verifyLiveDeployment(project, options = {}) {
  const { localFileCount = 0 } = options;
  const dest = project.liveWwwPath || '';

  if (!dest) {
    return {
      success: false,
      error: 'Live Nginx Path is not configured',
      code: 'LIVE_VERIFY_FAILED',
    };
  }

  let conn;
  try {
    conn = await connectSSH(project);
    const quotedDest = shellQuote(dest);

    const pathCheck = await execCommand(
      conn,
      `test -d ${quotedDest} && echo LIVE_OK || echo LIVE_MISSING`
    );
    if (!pathCheck.stdout.includes('LIVE_OK')) {
      return {
        success: false,
        error: `Live verification failed: directory not found at ${dest}`,
        code: 'LIVE_VERIFY_FAILED',
        stderr: pathCheck.stderr,
      };
    }

    const countCheck = await execCommand(
      conn,
      `find ${quotedDest} -type f 2>/dev/null | wc -l`
    );
    const remoteCount = parseInt((countCheck.stdout || '0').trim(), 10) || 0;

    if (localFileCount > 0 && remoteCount === 0) {
      return {
        success: false,
        error: `Live verification failed: no files found in ${dest} after sync`,
        code: 'SYNC_ZERO_FILES',
        remoteFileCount: remoteCount,
        localFileCount,
      };
    }

    const nginxCheck = await execCommand(conn, 'nginx -t 2>&1');
    if (nginxCheck.code !== 0) {
      return {
        success: false,
        error: 'Live verification failed: nginx -t reported errors',
        code: 'LIVE_VERIFY_FAILED',
        stderr: nginxCheck.stderr || nginxCheck.stdout,
      };
    }

    const listCheck = await execCommand(
      conn,
      `ls -la ${quotedDest} 2>/dev/null | head -5`
    );

    return {
      success: true,
      remoteFileCount: remoteCount,
      localFileCount,
      sampleListing: listCheck.stdout.trim(),
      message: `Live path OK — ${remoteCount} file(s) on server, nginx config valid`,
    };
  } catch (err) {
    return {
      success: false,
      error: err.message || 'Live verification failed',
      code: 'LIVE_VERIFY_FAILED',
      err,
    };
  } finally {
    if (conn) conn.end();
  }
}

module.exports = {
  validateProjectPaths,
  verifyLiveDeployment,
};
