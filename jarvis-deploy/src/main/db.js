const Database = require('better-sqlite3');
const path = require('path');
const { app } = require('electron');
const fs = require('fs');

let db = null;

function getDbPath() {
  const userDataPath = app.getPath('userData');
  return path.join(userDataPath, 'deploy-logs.db');
}

function migrateSchema(database) {
  const columns = database.prepare(`PRAGMA table_info(deploy_logs)`).all();
  const columnNames = new Set(columns.map((c) => c.name));

  const additions = [
    ['errorCode', 'TEXT'],
    ['errorMessage', 'TEXT'],
    ['failedStep', 'INTEGER'],
    ['failedCommand', 'TEXT'],
    ['exitCode', 'INTEGER'],
    ['stepTimings', 'TEXT'],
    ['fixHint', 'TEXT'],
  ];

  for (const [name, type] of additions) {
    if (!columnNames.has(name)) {
      database.exec(`ALTER TABLE deploy_logs ADD COLUMN ${name} ${type}`);
    }
  }

  const tableSql = database
    .prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='deploy_logs'`)
    .get();
  if (tableSql?.sql && !tableSql.sql.includes('cancelled')) {
    database.exec(`
      CREATE TABLE IF NOT EXISTS deploy_logs_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        projectId TEXT NOT NULL,
        projectName TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('running', 'success', 'failed', 'cancelled')),
        startedAt TEXT NOT NULL,
        finishedAt TEXT,
        durationSeconds INTEGER,
        output TEXT DEFAULT '',
        errorCode TEXT,
        errorMessage TEXT,
        failedStep INTEGER,
        failedCommand TEXT,
        exitCode INTEGER,
        stepTimings TEXT,
        fixHint TEXT
      );
      INSERT INTO deploy_logs_new (
        id, projectId, projectName, status, startedAt, finishedAt, durationSeconds, output,
        errorCode, errorMessage, failedStep, failedCommand, exitCode, stepTimings, fixHint
      )
      SELECT
        id, projectId, projectName, status, startedAt, finishedAt, durationSeconds, output,
        errorCode, errorMessage, failedStep, failedCommand, exitCode, stepTimings, fixHint
      FROM deploy_logs;
      DROP TABLE deploy_logs;
      ALTER TABLE deploy_logs_new RENAME TO deploy_logs;
      CREATE INDEX IF NOT EXISTS idx_deploy_logs_projectId ON deploy_logs(projectId);
      CREATE INDEX IF NOT EXISTS idx_deploy_logs_startedAt ON deploy_logs(startedAt DESC);
    `);
  }
}

function initDatabase() {
  const dbPath = getDbPath();
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS deploy_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      projectId TEXT NOT NULL,
      projectName TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('running', 'success', 'failed', 'cancelled')),
      startedAt TEXT NOT NULL,
      finishedAt TEXT,
      durationSeconds INTEGER,
      output TEXT DEFAULT ''
    );

    CREATE INDEX IF NOT EXISTS idx_deploy_logs_projectId ON deploy_logs(projectId);
    CREATE INDEX IF NOT EXISTS idx_deploy_logs_startedAt ON deploy_logs(startedAt DESC);
  `);

  migrateSchema(db);

  return db;
}

function getDb() {
  if (!db) {
    initDatabase();
  }
  return db;
}

const LOG_LIST_COLUMNS = `
  id, projectId, projectName, status, startedAt, finishedAt, durationSeconds,
  errorCode, errorMessage, failedStep, failedCommand, exitCode, fixHint
`;

function createLog(projectId, projectName) {
  const stmt = getDb().prepare(`
    INSERT INTO deploy_logs (projectId, projectName, status, startedAt, output)
    VALUES (?, ?, 'running', ?, '')
  `);
  const startedAt = new Date().toISOString();
  const result = stmt.run(projectId, projectName, startedAt);
  return { id: result.lastInsertRowid, startedAt };
}

function appendLogOutput(logId, text) {
  const stmt = getDb().prepare(`
    UPDATE deploy_logs SET output = output || ? WHERE id = ?
  `);
  stmt.run(text, logId);
}

function finishLog(logId, status, durationSeconds, errorMeta = null) {
  const stmt = getDb().prepare(`
    UPDATE deploy_logs
    SET status = ?, finishedAt = ?, durationSeconds = ?,
        errorCode = ?, errorMessage = ?, failedStep = ?, failedCommand = ?,
        exitCode = ?, stepTimings = ?, fixHint = ?
    WHERE id = ?
  `);
  const finishedAt = new Date().toISOString();
  const meta = errorMeta || {};
  stmt.run(
    status,
    finishedAt,
    durationSeconds,
    meta.errorCode || null,
    meta.errorMessage || null,
    meta.failedStep ?? null,
    meta.failedCommand || null,
    meta.exitCode ?? null,
    meta.stepTimings ? JSON.stringify(meta.stepTimings) : null,
    meta.fixHint || null,
    logId
  );
}

function getLogs(limit = 50) {
  const stmt = getDb().prepare(`
    SELECT ${LOG_LIST_COLUMNS}
    FROM deploy_logs
    ORDER BY startedAt DESC
    LIMIT ?
  `);
  return stmt.all(limit);
}

function getLogsByProject(projectId, limit = 50) {
  const stmt = getDb().prepare(`
    SELECT ${LOG_LIST_COLUMNS}
    FROM deploy_logs
    WHERE projectId = ?
    ORDER BY startedAt DESC
    LIMIT ?
  `);
  return stmt.all(projectId, limit);
}

function getLogDetail(logId) {
  const stmt = getDb().prepare(`
    SELECT * FROM deploy_logs WHERE id = ?
  `);
  const row = stmt.get(logId) || null;
  if (row?.stepTimings) {
    try {
      row.stepTimings = JSON.parse(row.stepTimings);
    } catch {
      row.stepTimings = [];
    }
  }
  return row;
}

function getLastLogForProject(projectId) {
  const stmt = getDb().prepare(`
    SELECT ${LOG_LIST_COLUMNS}
    FROM deploy_logs
    WHERE projectId = ?
    ORDER BY startedAt DESC
    LIMIT 1
  `);
  return stmt.get(projectId) || null;
}

function clearLogsForProject(projectId) {
  const stmt = getDb().prepare(`DELETE FROM deploy_logs WHERE projectId = ?`);
  const result = stmt.run(projectId);
  return { deleted: result.changes };
}

function resetDatabase() {
  if (db) {
    db.exec('DELETE FROM deploy_logs');
  }
}

module.exports = {
  initDatabase,
  createLog,
  appendLogOutput,
  finishLog,
  getLogs,
  getLogsByProject,
  getLogDetail,
  getLastLogForProject,
  clearLogsForProject,
  resetDatabase,
};
