/* Dalala — SQLite storage engine for the shared database.
   The application keeps its data as lists of records (students, invoices…) and as keyed objects
   (attendance, marks, timetable, settings). Each record is one row, so a change writes only the rows
   that changed, inside one transaction: a power cut can never leave a half-written database.
     rec(col, id, json)   one row per record, in insertion order
     ent(obj, k, json)    one row per entry of the keyed objects
     kv(k, json)          any other top-level value
     meta(k, v)           version counter
   Needs better-sqlite3 (built for Electron in the app, for Node when run as a standalone server). */
'use strict';
const fs = require('fs');
const path = require('path');

function open(file) {
  const Database = require('better-sqlite3');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = FULL'); // every confirmed change is on disk
  db.pragma('foreign_keys = OFF');
  db.exec(`CREATE TABLE IF NOT EXISTS rec (col TEXT NOT NULL, id TEXT NOT NULL, json TEXT NOT NULL, PRIMARY KEY (col, id));
    CREATE TABLE IF NOT EXISTS ent (obj TEXT NOT NULL, k TEXT NOT NULL, json TEXT NOT NULL, PRIMARY KEY (obj, k));
    CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS objs (name TEXT PRIMARY KEY);
    CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL);`);

  const q = {
    putRec: db.prepare('INSERT INTO rec (col, id, json) VALUES (?, ?, ?) ON CONFLICT (col, id) DO UPDATE SET json = excluded.json'),
    delRec: db.prepare('DELETE FROM rec WHERE col = ? AND id = ?'),
    putEnt: db.prepare('INSERT INTO ent (obj, k, json) VALUES (?, ?, ?) ON CONFLICT (obj, k) DO UPDATE SET json = excluded.json'),
    delEnt: db.prepare('DELETE FROM ent WHERE obj = ? AND k = ?'),
    delObj: db.prepare('DELETE FROM ent WHERE obj = ?'),
    putKv: db.prepare('INSERT INTO kv (k, json) VALUES (?, ?) ON CONFLICT (k) DO UPDATE SET json = excluded.json'),
    delKv: db.prepare('DELETE FROM kv WHERE k = ?'),
    putObj: db.prepare('INSERT OR IGNORE INTO objs (name) VALUES (?)'),
    delObjName: db.prepare('DELETE FROM objs WHERE name = ?'),
    putMeta: db.prepare('INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v'),
    getMeta: db.prepare('SELECT v FROM meta WHERE k = ?'),
  };
  const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
  const kinds = new Set(); // names stored as keyed objects (so a later patch knows where to write)

  function setObject(name, value) {
    q.delObj.run(name); q.delKv.run(name);
    if (isObj(value)) { kinds.add(name); q.putObj.run(name); for (const [k, v] of Object.entries(value)) { const s = JSON.stringify(v); if (s !== undefined) q.putEnt.run(name, k, s); } }
    else { kinds.delete(name); q.delObjName.run(name); const s = JSON.stringify(value); if (s !== undefined) q.putKv.run(name, s); }
  }
  /* one change set as produced by the server: { col, put[], del[] } | { obj, value } | { obj, patch, unset } */
  function applyChange(c) {
    if (c.obj) {
      if (c.value !== undefined) { setObject(c.obj, c.value); return; }
      kinds.add(c.obj); q.putObj.run(c.obj);
      for (const [k, v] of Object.entries(c.patch || {})) { const s = JSON.stringify(v); if (s !== undefined) q.putEnt.run(c.obj, k, s); }
      for (const k of c.unset || []) q.delEnt.run(c.obj, k);
      return;
    }
    for (const id of c.del || []) q.delRec.run(c.col, String(id));
    for (const r of c.put || []) q.putRec.run(c.col, String(r.id), JSON.stringify(r));
  }
  const commitTx = db.transaction((changes, version) => { for (const c of changes) applyChange(c); q.putMeta.run('version', String(version)); });
  const replaceTx = db.transaction((data, version) => {
    db.exec('DELETE FROM rec; DELETE FROM ent; DELETE FROM kv; DELETE FROM objs;'); kinds.clear();
    for (const [name, v] of Object.entries(data || {})) {
      /* a list of records with ids is stored row by row; anything else (empty list, list of plain values) as one value */
      if (Array.isArray(v) && v.length && v.every(r => r && typeof r === 'object' && (typeof r.id === 'string' || typeof r.id === 'number'))) { for (const r of v) q.putRec.run(name, String(r.id), JSON.stringify(r)); }
      else setObject(name, v);
    }
    q.putMeta.run('version', String(version));
  });

  return {
    file,
    /* { version, data } — data is null for a brand-new database */
    load() {
      const vr = q.getMeta.get('version'); if (!vr) return { version: 0, data: null };
      const data = {};
      for (const r of db.prepare('SELECT col, json FROM rec ORDER BY rowid').iterate()) (data[r.col] || (data[r.col] = [])).push(JSON.parse(r.json));
      for (const r of db.prepare('SELECT obj, k, json FROM ent').iterate()) { kinds.add(r.obj); (data[r.obj] || (data[r.obj] = {}))[r.k] = JSON.parse(r.json); }
      for (const r of db.prepare('SELECT name FROM objs').iterate()) if (!data[r.name]) data[r.name] = {};
      for (const r of db.prepare('SELECT k, json FROM kv').iterate()) if (!(r.k in data)) data[r.k] = JSON.parse(r.json); // an empty-list marker never hides rows added later
      return { version: +vr.v || 0, data };
    },
    commit(changes, version) { commitTx(changes, version); },
    replaceAll(data, version) { replaceTx(data, version); },
    /* consistent copy of the whole database into a new file */
    backupTo(dest) { fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.rmSync(dest, { force: true }); db.exec(`VACUUM INTO '${String(dest).replace(/'/g, "''")}'`); },
    checkpoint() { try { db.pragma('wal_checkpoint(TRUNCATE)'); } catch (e) { /* ignore */ } },
    close() { try { db.pragma('wal_checkpoint(TRUNCATE)'); } catch (e) { /* ignore */ } try { db.close(); } catch (e) { /* ignore */ } },
  };
}
module.exports = { open };
