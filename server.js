const express = require('express');
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const path    = require('path');
const crypto  = require('crypto');
const { Pool } = require('pg');
const { OAuth2Client } = require('google-auth-library');
const multer = require('multer');
const sharp = require('sharp');
const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');

const SECRET    = process.env.JWT_SECRET || 'dev-secret-change-me';
const PORT      = process.env.PORT || 3000;
const TG_TOKEN  = process.env.TELEGRAM_BOT_TOKEN || '';
const BASE_URL  = process.env.BASE_URL || ('http://localhost:' + PORT);
const DATABASE_URL = process.env.DATABASE_URL;

const B2_KEY_ID  = process.env.B2_KEY_ID;
const B2_APP_KEY = process.env.B2_APP_KEY;
const B2_BUCKET  = process.env.B2_BUCKET;
const B2_ENDPOINT = process.env.B2_ENDPOINT;
const B2_REGION = process.env.B2_REGION || 'eu-central-003';

if (!DATABASE_URL) { console.error('❌ Нет DATABASE_URL'); process.exit(1); }

let s3Endpoint = (B2_ENDPOINT || '').trim();
if (s3Endpoint && !/^https?:\/\//i.test(s3Endpoint)) s3Endpoint = 'https://' + s3Endpoint;
s3Endpoint = s3Endpoint.replace(/\/+$/, '');

if (!B2_KEY_ID || !B2_APP_KEY || !B2_BUCKET || !s3Endpoint) {
  console.warn('⚠️  B2 не настроен — файлы загружаться не будут');
}

/* ---------- Простой rate limiter для логина ---------- */
const loginAttempts = new Map(); // ip -> { fails, resetAt, blockedUntil }
const LOGIN_MAX_FAILS = 5;        // попыток
const LOGIN_WINDOW_MS = 15 * 60 * 1000; // окно 15 минут
const LOGIN_BLOCK_MS = 15 * 60 * 1000;  // блокировка 15 минут

function loginRateCheck(ip){
  const now = Date.now();
  let rec = loginAttempts.get(ip);
  if(!rec){
    rec = { fails: 0, resetAt: now + LOGIN_WINDOW_MS, blockedUntil: 0 };
    loginAttempts.set(ip, rec);
  }
  // если окно истекло и не заблокирован — сбрасываем
  if(now > rec.resetAt && now > rec.blockedUntil){
    rec.fails = 0;
    rec.resetAt = now + LOGIN_WINDOW_MS;
  }
  if(rec.blockedUntil && now < rec.blockedUntil){
    const sec = Math.ceil((rec.blockedUntil - now) / 1000);
    return { ok: false, error: 'Слишком много попыток входа. Повторите через ' + sec + ' сек.' };
  }
  return { ok: true };
}
function loginRateFail(ip){
  const rec = loginAttempts.get(ip);
  if(!rec) return;
  rec.fails++;
  if(rec.fails >= LOGIN_MAX_FAILS){
    rec.blockedUntil = Date.now() + LOGIN_BLOCK_MS;
  }
}
function loginRateSuccess(ip){
  loginAttempts.delete(ip);
}
// раз в час чистим старые записи
setInterval(function(){
  const now = Date.now();
  for(const [ip, rec] of loginAttempts){
    if(now > rec.resetAt + LOGIN_BLOCK_MS) loginAttempts.delete(ip);
  }
}, 60 * 60 * 1000);

const DB_SSL = process.env.DATABASE_SSL === 'true' || process.env.DATABASE_SSL === '1';
const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: DB_SSL ? { rejectUnauthorized: false } : false
});

let s3 = null;
if (B2_KEY_ID && B2_APP_KEY && s3Endpoint) {
  try {
    s3 = new S3Client({
      endpoint: s3Endpoint,
      region: B2_REGION,
      credentials: { accessKeyId: B2_KEY_ID, secretAccessKey: B2_APP_KEY },
      forcePathStyle: true
    });
    console.log('📦 S3: ' + s3Endpoint + ' | bucket: ' + B2_BUCKET);
  } catch (e) { console.error('❌ S3 init:', e.message); s3 = null; }
}

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
const uploadSmall = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
const uploadBook = multer({ storage: multer.memoryStorage(), limits: { fileSize: 60 * 1024 * 1024 } });

const uid  = () => Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6);
const code = () => {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = ''; for (let i = 0; i < 6; i++) s += abc[Math.floor(Math.random() * abc.length)];
  return s;
};
const genPass = () => {
  const abc = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = ''; for (let i = 0; i < 8; i++) s += abc[Math.floor(Math.random() * abc.length)];
  return s;
};

async function s3Put(key, buffer, contentType) {
  if (!s3) throw new Error('Хранилище B2 не настроено.');
  try {
    await s3.send(new PutObjectCommand({ Bucket: B2_BUCKET, Key: key, Body: buffer, ContentType: contentType }));
    return key;
  } catch (e) {
    console.error('❌ s3Put [' + key + ']:', e.name, '—', e.message);
    if (e.message && e.message.includes('Invalid URL'))
      throw new Error('B2_ENDPOINT неверен. Нужен полный URL с https://.');
    throw new Error('B2: ' + e.message);
  }
}
async function s3Get(key, range) {
  if (!s3) throw new Error('S3 не настроен');
  const cmd = new GetObjectCommand({ Bucket: B2_BUCKET, Key: key });
  if (range) cmd.input.Range = range;
  return await s3.send(cmd);
}
async function s3GetBuffer(key) {
  const r = await s3Get(key);
  const chunks = [];
  for await (const c of r.Body) chunks.push(c);
  return { buffer: Buffer.concat(chunks), contentType: r.ContentType };
}
async function s3Del(key) {
  if (!s3 || !key) return;
  try { await s3.send(new DeleteObjectCommand({ Bucket: B2_BUCKET, Key: key })); } catch (e) {}
}

async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL,
      pass TEXT NOT NULL, role TEXT NOT NULL, avatar_key TEXT,
      telegram_chat_id BIGINT, telegram_username TEXT, link_code TEXT UNIQUE,
      created_at BIGINT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS classes (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, code TEXT UNIQUE NOT NULL,
      teacher_id TEXT NOT NULL, created_at BIGINT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS class_students (
      class_id TEXT NOT NULL, student_id TEXT NOT NULL,
      PRIMARY KEY (class_id, student_id)
    );
    CREATE TABLE IF NOT EXISTS groups (
      id TEXT PRIMARY KEY, class_id TEXT NOT NULL, name TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS group_students (
      group_id TEXT NOT NULL, student_id TEXT NOT NULL,
      PRIMARY KEY (group_id, student_id)
    );
    CREATE TABLE IF NOT EXISTS tests (
      id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, title TEXT NOT NULL,
      tasks JSONB NOT NULL,
      class_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
      group_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
      settings JSONB NOT NULL DEFAULT '{}'::jsonb,
      deadline BIGINT,
      created_at BIGINT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS submissions (
      id TEXT PRIMARY KEY, test_id TEXT NOT NULL, student_id TEXT NOT NULL,
      student_name TEXT NOT NULL, class_id TEXT NOT NULL,
      score REAL NOT NULL, max REAL NOT NULL, results JSONB NOT NULL,
      attempt INT NOT NULL DEFAULT 1, started_at BIGINT, at BIGINT NOT NULL,
      duration_ms BIGINT, expired BOOLEAN DEFAULT FALSE,
      late BOOLEAN DEFAULT FALSE, seen BOOLEAN DEFAULT FALSE
    );
    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, type TEXT NOT NULL,
      title TEXT NOT NULL, text TEXT NOT NULL, link JSONB,
      read BOOLEAN DEFAULT FALSE, at BIGINT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS books (
      id TEXT PRIMARY KEY, owner_id TEXT NOT NULL,
      title TEXT NOT NULL, author TEXT, subject TEXT, description TEXT,
      class_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
      pdf_key TEXT, pdf_size BIGINT,
      cover_key TEXT,
      created_at BIGINT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS bookmarks (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      book_id TEXT NOT NULL,
      position INT NOT NULL DEFAULT 0,
      note TEXT,
      created_at BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_bookmarks_user_book ON bookmarks(user_id, book_id);
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY, class_id TEXT NOT NULL,
      user_id TEXT NOT NULL, user_name TEXT NOT NULL,
      text TEXT, file_key TEXT, file_name TEXT, file_type TEXT, file_size BIGINT,
      created_at BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_subs_test ON submissions(test_id);
    CREATE INDEX IF NOT EXISTS idx_subs_student ON submissions(student_id);
    CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id);
    CREATE INDEX IF NOT EXISTS idx_tests_owner ON tests(owner_id);
    CREATE INDEX IF NOT EXISTS idx_cs_student ON class_students(student_id);
    CREATE INDEX IF NOT EXISTS idx_gs_student ON group_students(student_id);
    CREATE INDEX IF NOT EXISTS idx_books_owner ON books(owner_id);
    CREATE INDEX IF NOT EXISTS idx_msg_class ON messages(class_id, created_at DESC);
    CREATE TABLE IF NOT EXISTS action_logs (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, user_name TEXT NOT NULL,
      action TEXT NOT NULL, details TEXT, at BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_logs_at ON action_logs(at DESC);
    CREATE TABLE IF NOT EXISTS backups (
      id TEXT PRIMARY KEY, key TEXT NOT NULL, size BIGINT,
      auto BOOLEAN DEFAULT FALSE, created_at BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_backups_created ON backups(created_at DESC);
  `);
   try { await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_key TEXT`); } catch (e) { console.error('migr users.avatar_key:', e.message); }
  try { await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS telegram_chat_id BIGINT`); } catch (e) {}
  try { await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS telegram_username TEXT`); } catch (e) {}
  try { await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS link_code TEXT`); } catch (e) {}
  try { await pool.query(`ALTER TABLE tests ADD COLUMN IF NOT EXISTS deadline BIGINT`); } catch (e) {}
  try { await pool.query(`ALTER TABLE submissions ADD COLUMN IF NOT EXISTS late BOOLEAN DEFAULT FALSE`); } catch (e) {}
  try { await pool.query(`ALTER TABLE submissions ADD COLUMN IF NOT EXISTS expired BOOLEAN DEFAULT FALSE`); } catch (e) {}
  try { await pool.query(`ALTER TABLE submissions ADD COLUMN IF NOT EXISTS seen BOOLEAN DEFAULT FALSE`); } catch (e) {}
  try { await pool.query(`ALTER TABLE books ADD COLUMN IF NOT EXISTS cover_key TEXT`); } catch (e) {}
  try { await pool.query(`ALTER TABLE books ADD COLUMN IF NOT EXISTS pdf_key TEXT`); } catch (e) {}
  try { await pool.query(`ALTER TABLE books ADD COLUMN IF NOT EXISTS pdf_size BIGINT`); } catch (e) {}
  try { await pool.query(`ALTER TABLE books ADD COLUMN IF NOT EXISTS class_ids JSONB DEFAULT '[]'::jsonb`); } catch (e) {}
}

async function logAction(userId, userName, action, details) {
  try {
    await pool.query(
      `INSERT INTO action_logs (id, user_id, user_name, action, details, at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [uid(), userId, userName, action, details || null, Date.now()]);
    await pool.query(
      `DELETE FROM action_logs WHERE id IN (
         SELECT id FROM action_logs ORDER BY at DESC OFFSET 1000)`);
  } catch (e) {}
}

async function createBackup(auto) {
  try {
    if (!s3) throw new Error('S3 не настроен');
    const dump = {};
    for (const table of ['users','classes','class_students','groups','group_students',
                         'tests','submissions','notifications','books','bookmarks',
                         'messages','action_logs']) {
      const r = await pool.query('SELECT * FROM ' + table);
      dump[table] = r.rows;
    }
    dump._meta = { created: Date.now(), version: '3.1.0' };
    const json = JSON.stringify(dump, null, 2);
    const buf = Buffer.from(json, 'utf8');
    const dateStr = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const key = 'backups/db_' + dateStr + (auto ? '_auto' : '_manual') + '.json';
    await s3Put(key, buf, 'application/json');
    const id = uid();
    await pool.query(
      `INSERT INTO backups (id, key, size, auto, created_at) VALUES ($1,$2,$3,$4,$5)`,
      [id, key, buf.length, !!auto, Date.now()]);
    const cnt = await pool.query('SELECT COUNT(*)::int AS n FROM backups');
    if (cnt.rows[0].n > 7) {
      const old = await pool.query(
        `SELECT id, key FROM backups ORDER BY created_at ASC LIMIT $1`, [cnt.rows[0].n - 7]);
      for (const b of old.rows) { await s3Del(b.key); await pool.query('DELETE FROM backups WHERE id=$1', [b.id]); }
    }
    console.log('💾 Бэкап: ' + key);
    return { key, size: buf.length };
  } catch (e) { console.error('❌ Бэкап:', e.message); throw e; }
}

setTimeout(function scheduleBackup(){
  createBackup(true).catch(function(){});
  setInterval(function(){ createBackup(true).catch(function(){}); }, 24 * 60 * 60 * 1000);
}, 60 * 1000);

async function getUserById(id) {
  const r = await pool.query('SELECT * FROM users WHERE id=$1', [id]);
  return r.rows[0] || null;
}
async function getUserByEmail(email) {
  const r = await pool.query('SELECT * FROM users WHERE email=$1', [email]);
  return r.rows[0] || null;
}
async function getUserByLinkCode(code) {
  const r = await pool.query('SELECT * FROM users WHERE link_code=$1', [code]);
  return r.rows[0] || null;
}
async function getUserByChatId(chatId) {
  const r = await pool.query('SELECT * FROM users WHERE telegram_chat_id=$1', [chatId]);
  return r.rows[0] || null;
}
function userToJSON(u) {
  if (!u) return null;
  return {
    id: u.id, name: u.name, email: u.email, role: u.role,
    hasAvatar: !!u.avatar_key,
    telegram: u.telegram_chat_id ? { chatId: Number(u.telegram_chat_id), username: u.telegram_username } : null
  };
}
async function getClassIdsForStudent(sid) {
  const r = await pool.query('SELECT class_id FROM class_students WHERE student_id=$1', [sid]);
  return r.rows.map(x => x.class_id);
}
async function getGroupIdsForStudent(sid) {
  const r = await pool.query('SELECT group_id FROM group_students WHERE student_id=$1', [sid]);
  return r.rows.map(x => x.group_id);
}
async function getClassById(id) {
  const r = await pool.query('SELECT * FROM classes WHERE id=$1', [id]);
  return r.rows[0] || null;
}
async function getGroupsForClass(cid) {
  const r = await pool.query('SELECT * FROM groups WHERE class_id=$1', [cid]);
  const groups = r.rows;
  if (!groups.length) return [];
  const ids = groups.map(g => g.id);
  const rs = await pool.query('SELECT group_id, student_id FROM group_students WHERE group_id = ANY($1)', [ids]);
  const byGroup = {};
  rs.rows.forEach(r => { (byGroup[r.group_id] = byGroup[r.group_id] || []).push(r.student_id); });
  return groups.map(g => ({ id: g.id, name: g.name, studentIds: byGroup[g.id] || [] }));
}
async function getStudentsInClass(cid) {
  const r = await pool.query(
    `SELECT u.id, u.name, u.email, u.avatar_key, u.telegram_chat_id
     FROM class_students cs JOIN users u ON u.id = cs.student_id
     WHERE cs.class_id=$1`, [cid]);
  return r.rows;
}
function normSettings(s) {
  s = s || {};
  return {
    timeLimit:   Math.max(0, parseInt(s.timeLimit)  || 0),
    attempts:    Math.max(0, parseInt(s.attempts)   || 0),
    showAnswers: s.showAnswers !== false
  };
}
function escapeCsv(v) {
  v = String(v == null ? '' : v);
  if (v.includes(',') || v.includes('"') || v.includes('\n')) return '"' + v.replace(/"/g, '""') + '"';
  return v;
}
async function studentSeesTest(sid, test) {
  const myCids = await getClassIdsForStudent(sid);
  const classIds = test.class_ids || [];
  if (!classIds.some(id => myCids.includes(id))) return false;
  const gids = test.group_ids || [];
  if (gids.length > 0) {
    const myGids = await getGroupIdsForStudent(sid);
    if (!gids.some(id => myGids.includes(id))) return false;
  }
  return true;
}
async function canSeeClass(userId, role, classId) {
  const c = await getClassById(classId);
  if (!c) return false;
  if (role === 'admin') return true;
  if (role === 'teacher') return c.teacher_id === userId;
  if (role === 'student') {
    const r = await pool.query(
      'SELECT 1 FROM class_students WHERE class_id=$1 AND student_id=$2', [classId, userId]);
    return r.rowCount > 0;
  }
  return false;
}
async function canSeeBook(userId, role, b) {
  if (role === 'admin' || role === 'librarian') return true;
  if (b.owner_id === userId) return true;
  if (role === 'teacher') return b.owner_id === userId;
  const myCids = await getClassIdsForStudent(userId);
  const cids = b.class_ids || [];
  if (cids.length === 0) return true;
  return cids.some(id => myCids.includes(id));
}

let bot = null;
if (TG_TOKEN) {
  try {
    const TelegramBot = require('node-telegram-bot-api');
    bot = new TelegramBot(TG_TOKEN, { polling: true });
    bot.on('polling_error', (err) => {
      if (!err.message.includes('409')) console.error('Telegram:', err.message);
    });
    bot.onText(/\/start(.*)/, async (msg, match) => {
      const chatId = msg.chat.id;
      const username = msg.from.username ? '@' + msg.from.username : (msg.from.first_name || 'друг');
      const payload = (match[1] || '').trim();
      try {
        if (payload) {
          const u = await getUserByLinkCode(payload);
          if (u) {
            await pool.query('UPDATE users SET telegram_chat_id=$1, telegram_username=$2 WHERE id=$3',
              [chatId, username, u.id]);
            bot.sendMessage(chatId, '✅ ' + u.name + ', Telegram привязан.');
            return;
          }
        }
        bot.sendMessage(chatId, 'Привет! Это бот MathTest.\nОткрой приложение → Профиль → «Подключить Telegram».');
      } catch (e) { console.error(e); }
    });
    bot.onText(/\/stop/, async (msg) => {
      const u = await getUserByChatId(msg.chat.id);
      if (u) {
        await pool.query('UPDATE users SET telegram_chat_id=NULL, telegram_username=NULL WHERE id=$1', [u.id]);
        bot.sendMessage(msg.chat.id, '🔕 Отключено.');
      }
    });
    console.log('✅ Telegram bot started');
  } catch (e) { console.error('❌ Telegram:', e.message); }
}
function tgSend(chatId, text, opts) {
  if (!bot || !chatId) return Promise.resolve(false);
  return bot.sendMessage(chatId, text, opts || {}).then(() => true).catch(() => false);
}

async function notify(userId, type, title, text, link) {
  try {
    await pool.query(
      `INSERT INTO notifications (id,user_id,type,title,text,link,read,at)
       VALUES ($1,$2,$3,$4,$5,$6,false,$7)`,
      [uid(), userId, type, title, text, link ? JSON.stringify(link) : null, Date.now()]);
    await pool.query(
      `DELETE FROM notifications WHERE id IN (
         SELECT id FROM notifications WHERE user_id=$1 ORDER BY at DESC OFFSET 80)`, [userId]);
  } catch (e) { console.error('notify:', e.message); }
}

const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('sw.js')) {
      res.setHeader('Service-Worker-Allowed', '/');
      res.setHeader('Cache-Control', 'no-cache');
    }
  }
}));

function auth(req, res, next) {
  const h = req.headers.authorization || '';
  const t = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!t) return res.status(401).json({ error: 'Не авторизован' });
  try { req.user = jwt.verify(t, SECRET); next(); }
  catch { res.status(401).json({ error: 'Сессия истекла' }); }
}
function teacherOnly(req, res, next) {
  if (!['teacher', 'admin'].includes(req.user.role))
    return res.status(403).json({ error: 'Только для учителя' });
  next();
}
function adminOnly(req, res, next) {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Только для админа' });
  next();
}
function canUploadBooks(req, res, next) {
  if (!['teacher', 'admin', 'librarian'].includes(req.user.role))
    return res.status(403).json({ error: 'Нет прав' });
  next();
}

/* ========== AUTH ========== */
app.post('/api/auth/register', async (req, res) => {
  try {
    const { name, email, password, role } = req.body || {};
    const validRoles = ['teacher', 'student', 'librarian'];
    if (!name || !email || !password || !validRoles.includes(role))
      return res.status(400).json({ error: 'Заполните все поля' });
    if (password.length < 6) return res.status(400).json({ error: 'Пароль от 6 символов' });
    const e = email.toLowerCase().trim();
    if (await getUserByEmail(e)) return res.status(409).json({ error: 'Email занят' });
    let finalRole = role;
    if (process.env.ADMIN_EMAIL && e === process.env.ADMIN_EMAIL.toLowerCase().trim()) finalRole = 'admin';
    const id = uid();
    await pool.query(
      `INSERT INTO users (id,name,email,pass,role,link_code,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [id, name.trim(), e, await bcrypt.hash(password, 10), finalRole, uid() + uid(), Date.now()]);
    await logAction(id, name.trim(), 'Регистрация', e + ' (' + finalRole + ')');
    const token = jwt.sign({ id, role: finalRole, name: name.trim() }, SECRET, { expiresIn: '30d' });
    res.json({ token, user: { id, name: name.trim(), role: finalRole } });
  } catch (err) { res.status(500).json({ error: 'Ошибка' }); }
});

app.post('/api/auth/login', async (req, res) => {
  const ip = (req.headers['x-forwarded-for'] || req.ip || '').toString().split(',')[0].trim() || 'unknown';

  const rate = loginRateCheck(ip);
  if(!rate.ok) return res.status(429).json({ error: rate.error });

  try {
    const { email, password } = req.body || {};
    const u = await getUserByEmail((email || '').toLowerCase().trim());
    const ok = u && await bcrypt.compare(password || '', u.pass);
    if (!ok) {
      loginRateFail(ip);
      return res.status(401).json({ error: 'Неверный email или пароль' });
    }
    loginRateSuccess(ip);

    let role = u.role;
    if (process.env.ADMIN_EMAIL &&
        u.email.toLowerCase().trim() === process.env.ADMIN_EMAIL.toLowerCase().trim() &&
        u.role !== 'admin') {
      await pool.query("UPDATE users SET role='admin' WHERE id=$1", [u.id]);
      role = 'admin';
    }
    const token = jwt.sign({ id: u.id, role: role, name: u.name }, SECRET, { expiresIn: '30d' });
    res.json({ token, user: { id: u.id, name: u.name, role: role } });
  } catch (err) {
    res.status(500).json({ error: 'Ошибка' });
  }
});

app.get('/api/auth/me', auth, async (req, res) => {
  const u = await getUserById(req.user.id);
  if (!u) return res.status(401).json({ error: 'Войдите заново' });
  res.json({ user: userToJSON(u) });
});

/* ========== TELEGRAM LOGIN ========== */
app.get('/api/telegram/bot-info', async (req, res) => {
  if (!bot) return res.json({ username: null });
  try { const me = await bot.getMe(); res.json({ username: me.username }); }
  catch { res.json({ username: null }); }
});
app.post('/api/auth/telegram', async (req, res) => {
  try {
    if (!TG_TOKEN) return res.status(400).json({ error: 'Telegram не настроен' });
    const data = req.body || {};
    if (!data.id || !data.hash || !data.auth_date) return res.status(400).json({ error: 'Некорректные данные' });
    const age = Math.floor(Date.now() / 1000) - Number(data.auth_date);
    if (age > 86400) return res.status(400).json({ error: 'Ссылка устарела' });
    const pairs = Object.keys(data).filter(k => k !== 'hash').map(k => k + '=' + data[k]).sort().join('\n');
    const secretKey = crypto.createHash('sha256').update(TG_TOKEN).digest();
    const computed = crypto.createHmac('sha256', secretKey).update(pairs).digest('hex');
    if (computed !== data.hash) return res.status(401).json({ error: 'Подпись неверна' });
    const tgId = String(data.id);
    let user = (await pool.query('SELECT * FROM users WHERE telegram_chat_id=$1', [tgId])).rows[0];
    if (!user) {
      const email = 'tg_' + tgId + '@telegram.local';
      user = await getUserByEmail(email);
      if (!user) {
        const id = uid();
        const name = [data.first_name, data.last_name].filter(Boolean).join(' ') || data.username || ('tg_' + tgId);
        await pool.query(
          `INSERT INTO users (id,name,email,pass,role,telegram_chat_id,telegram_username,link_code,created_at)
           VALUES ($1,$2,$3,$4,'student',$5,$6,$7,$8)`,
          [id, name, email, 'tg_no_password', tgId, data.username ? '@' + data.username : null, uid() + uid(), Date.now()]);
        user = await getUserById(id);
      }
    }
    const token = jwt.sign({ id: user.id, role: user.role, name: user.name }, SECRET, { expiresIn: '30d' });
    res.json({ token, user: { id: user.id, name: user.name, role: user.role } });
  } catch (e) { res.status(500).json({ error: 'Ошибка' }); }
});

/* ========== GOOGLE ========== */
app.post('/api/auth/google', async (req, res) => {
  try {
    const { credential } = req.body || {};
    if (!credential) return res.status(400).json({ error: 'Нет токена' });
    const ticket = await googleClient.verifyIdToken({ idToken: credential, audience: process.env.GOOGLE_CLIENT_ID });
    const p = ticket.getPayload();
    let user = await getUserByEmail(p.email);
    if (!user) {
      const id = uid();
      await pool.query(
        `INSERT INTO users (id,name,email,pass,role,link_code,created_at)
         VALUES ($1,$2,$3,'google_no_password','student',$4,$5)`,
        [id, p.name || p.email, p.email.toLowerCase(), uid() + uid(), Date.now()]);
      user = await getUserById(id);
    }
    const token = jwt.sign({ id: user.id, role: user.role, name: user.name }, SECRET, { expiresIn: '30d' });
    res.json({ token, user: { id: user.id, name: user.name, role: user.role } });
  } catch (e) { res.status(500).json({ error: 'Ошибка' }); }
});

/* ========== ПРОФИЛЬ ========== */
app.patch('/api/users/me', auth, async (req, res) => {
  try {
    const { name, email, password } = req.body || {};
    const u = await getUserById(req.user.id);
    if (!u) return res.status(401).json({ error: 'Войдите заново' });
    if (name && name.trim()) await pool.query('UPDATE users SET name=$1 WHERE id=$2', [name.trim(), u.id]);
    if (email && email.trim()) {
      const e = email.toLowerCase().trim();
      if (e !== u.email) {
        if (await getUserByEmail(e)) return res.status(409).json({ error: 'Email занят' });
        await pool.query('UPDATE users SET email=$1 WHERE id=$2', [e, u.id]);
      }
    }
    if (password && password.length >= 6) {
      await pool.query('UPDATE users SET pass=$1 WHERE id=$2', [await bcrypt.hash(password, 10), u.id]);
    }
    const updated = await getUserById(u.id);
    res.json({ user: userToJSON(updated) });
  } catch (e) { res.status(500).json({ error: 'Ошибка' }); }
});

app.post('/api/users/me/avatar', auth, uploadSmall.single('avatar'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Файл не загружен' });
    if (!s3) return res.status(400).json({ error: 'Хранилище не настроено' });
    const u = await getUserById(req.user.id);
    const buf = await sharp(req.file.buffer).resize(400,400,{fit:'cover'}).jpeg({quality:85}).toBuffer();
    const key = 'avatars/' + u.id + '_' + Date.now() + '.jpg';
    if (u.avatar_key) await s3Del(u.avatar_key);
    await s3Put(key, buf, 'image/jpeg');
    await pool.query('UPDATE users SET avatar_key=$1 WHERE id=$2', [key, u.id]);
    res.json({ ok: true, hasAvatar: true });
  } catch (e) { res.status(500).json({ error: e.message || 'Ошибка' }); }
});

app.delete('/api/users/me/avatar', auth, async (req, res) => {
  try {
    const u = await getUserById(req.user.id);
    if (!u) return res.status(401).json({ error: 'Войдите заново' });
    if (u.avatar_key) await s3Del(u.avatar_key);
    await pool.query('UPDATE users SET avatar_key=NULL WHERE id=$1', [u.id]);
    res.json({ ok: true, hasAvatar: false });
  } catch (e) { res.status(500).json({ error: 'Ошибка' }); }
});

app.get('/api/users/:id/avatar', async (req, res) => {
  try {
    const u = await getUserById(req.params.id);
    if (!u || !u.avatar_key) {
      const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Cache-Control', 'public, max-age=30');
      return res.send(png);
    }
    const { buffer, contentType } = await s3GetBuffer(u.avatar_key);
    res.setHeader('Content-Type', contentType || 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=60');
    res.send(buffer);
  } catch (e) { res.status(404).end(); }
});

app.get('/api/telegram/link', auth, async (req, res) => {
  const u = await getUserById(req.user.id);
  if (!u) return res.status(401).json({ error: 'Войдите' });
  if (!bot) return res.status(400).json({ error: 'Telegram не настроен' });
  try {
    const me = await bot.getMe();
    res.json({ link: 'https://t.me/' + me.username + '?start=' + u.link_code,
               botUsername: me.username, linked: !!u.telegram_chat_id });
  } catch { res.status(500).json({ error: 'Ошибка' }); }
});
app.post('/api/telegram/unlink', auth, async (req, res) => {
  await pool.query('UPDATE users SET telegram_chat_id=NULL, telegram_username=NULL WHERE id=$1', [req.user.id]);
  res.json({ ok: true });
});

/* ========== КЛАССЫ ========== */
app.get('/api/classes', auth, async (req, res) => {
  try {
    let rows;
    if (req.user.role === 'admin') rows = (await pool.query('SELECT * FROM classes ORDER BY created_at DESC')).rows;
    else if (req.user.role === 'teacher') rows = (await pool.query('SELECT * FROM classes WHERE teacher_id=$1', [req.user.id])).rows;
    else if (req.user.role === 'student') rows = (await pool.query(
      `SELECT c.* FROM classes c JOIN class_students cs ON cs.class_id=c.id WHERE cs.student_id=$1`, [req.user.id])).rows;
    else rows = [];
    const out = [];
    for (const c of rows) {
      const teacher = await getUserById(c.teacher_id);
      const cnt = (await pool.query('SELECT COUNT(*)::int AS n FROM class_students WHERE class_id=$1', [c.id])).rows[0].n;
      let groups;
      if (req.user.role === 'teacher' || req.user.role === 'admin') {
        const gr = await pool.query(
          `SELECT g.id,g.name,COUNT(gs.student_id)::int AS count
           FROM groups g LEFT JOIN group_students gs ON gs.group_id=g.id
           WHERE g.class_id=$1 GROUP BY g.id,g.name`, [c.id]);
        groups = gr.rows.map(x => ({ id: x.id, name: x.name, count: x.count }));
      } else {
        const gr = await pool.query(
          `SELECT g.id,g.name FROM groups g JOIN group_students gs ON gs.group_id=g.id
           WHERE g.class_id=$1 AND gs.student_id=$2`, [c.id, req.user.id]);
        groups = gr.rows;
      }
      out.push({
        id: c.id, name: c.name, code: c.code,
        teacherId: c.teacher_id, teacherName: teacher ? teacher.name : '—',
        studentCount: cnt, groups
      });
    }
    res.json({ classes: out });
  } catch (e) { res.status(500).json({ error: 'Ошибка' }); }
});

app.post('/api/classes', auth, teacherOnly, async (req, res) => {
  try {
    const { name } = req.body || {};
    if (!name || !name.trim()) return res.status(400).json({ error: 'Введите название' });
    let c, att = 0;
    do { c = code();
      if (!(await pool.query('SELECT 1 FROM classes WHERE code=$1', [c])).rowCount) break;
    } while (++att < 20);
    const id = uid();
    await pool.query('INSERT INTO classes (id,name,code,teacher_id,created_at) VALUES ($1,$2,$3,$4,$5)',
      [id, name.trim(), c, req.user.id, Date.now()]);
    await logAction(req.user.id, req.user.name, 'Создал класс', name.trim() + ' (' + c + ')');
    res.json({ class: { id, name: name.trim(), code: c, teacherId: req.user.id } });
  } catch (e) { res.status(500).json({ error: 'Ошибка' }); }
});

app.delete('/api/classes/:id', auth, teacherOnly, async (req, res) => {
  try {
    const c = await getClassById(req.params.id);
    if (!c) return res.status(404).json({ error: 'Не найден' });
    if (req.user.role !== 'admin' && c.teacher_id !== req.user.id)
      return res.status(403).json({ error: 'Нет доступа' });
    await pool.query('DELETE FROM classes WHERE id=$1', [c.id]);
    await pool.query('DELETE FROM class_students WHERE class_id=$1', [c.id]);
    const gs = await pool.query('SELECT id FROM groups WHERE class_id=$1', [c.id]);
    for (const g of gs.rows) await pool.query('DELETE FROM group_students WHERE group_id=$1', [g.id]);
    await pool.query('DELETE FROM groups WHERE class_id=$1', [c.id]);
    await pool.query('DELETE FROM messages WHERE class_id=$1', [c.id]);
    await logAction(req.user.id, req.user.name, 'Удалил класс', c.name);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Ошибка' }); }
});

app.post('/api/classes/join', auth, async (req, res) => {
  try {
    const c = (await pool.query('SELECT * FROM classes WHERE code=$1',
      [(req.body.code || '').toUpperCase().trim()])).rows[0];
    if (!c) return res.status(404).json({ error: 'Класс не найден' });
    const ex = await pool.query('SELECT 1 FROM class_students WHERE class_id=$1 AND student_id=$2',
      [c.id, req.user.id]);
    if (ex.rowCount) return res.status(400).json({ error: 'Вы уже в классе' });
    await pool.query('INSERT INTO class_students (class_id, student_id) VALUES ($1,$2)', [c.id, req.user.id]);
    await notify(c.teacher_id, 'join', 'Новый ученик', req.user.name + ' → «' + c.name + '»', null);
    const t = await getUserById(c.teacher_id);
    if (t && t.telegram_chat_id) {
      tgSend(t.telegram_chat_id, '👤 *' + req.user.name + '* присоединился к «' + c.name + '»',
        { parse_mode: 'Markdown' });
    }
    res.json({ class: { id: c.id, name: c.name } });
  } catch (e) { res.status(500).json({ error: 'Ошибка' }); }
});

app.post('/api/classes/:id/leave', auth, async (req, res) => {
  try {
    await pool.query('DELETE FROM class_students WHERE class_id=$1 AND student_id=$2', [req.params.id, req.user.id]);
    await pool.query(
      `DELETE FROM group_students WHERE student_id=$1 AND group_id IN
       (SELECT id FROM groups WHERE class_id=$2)`, [req.user.id, req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Ошибка' }); }
});

app.get('/api/classes/:id', auth, async (req, res) => {
  try {
    const c = await getClassById(req.params.id);
    if (!c) return res.status(404).json({ error: 'Не найден' });
    if (!(await canSeeClass(req.user.id, req.user.role, c.id))) return res.status(403).json({ error: 'Нет доступа' });
    const students = await getStudentsInClass(c.id);
    const groups = await getGroupsForClass(c.id);
    const stuGroupMap = {};
    groups.forEach(g => g.studentIds.forEach(sid => {
      (stuGroupMap[sid] = stuGroupMap[sid] || []).push(g.id);
    }));
    const studentsOut = students.map(u => ({
      id: u.id, name: u.name, email: u.email,
      groupIds: stuGroupMap[u.id] || [],
      hasTelegram: !!u.telegram_chat_id,
      hasAvatar: !!u.avatar_key
    }));
    const tR = await pool.query(
      `SELECT t.*,
        (SELECT COUNT(*)::int FROM submissions s WHERE s.test_id=t.id AND s.class_id=$1) AS submitted,
        (SELECT COUNT(*)::int FROM submissions s WHERE s.test_id=t.id AND s.class_id=$1 AND s.seen=false) AS unseen
       FROM tests t WHERE t.class_ids @> $2::jsonb`, [c.id, JSON.stringify([c.id])]);
    const testsOut = tR.rows.map(t => ({
      id: t.id, title: t.title, submitted: t.submitted,
      total: students.length, unseen: t.unseen, groupIds: t.group_ids || []
    }));
    res.json({
      class: { id: c.id, name: c.name, code: c.code, teacherId: c.teacher_id, groups },
      students: studentsOut, tests: testsOut
    });
  } catch (e) { res.status(500).json({ error: 'Ошибка' }); }
});

app.delete('/api/classes/:id/students/:sid', auth, teacherOnly, async (req, res) => {
  try {
    const c = await getClassById(req.params.id);
    if (!c || (req.user.role !== 'admin' && c.teacher_id !== req.user.id))
      return res.status(403).json({ error: 'Нет доступа' });
    await pool.query('DELETE FROM class_students WHERE class_id=$1 AND student_id=$2', [c.id, req.params.sid]);
    await pool.query(
      `DELETE FROM group_students WHERE student_id=$1 AND group_id IN
       (SELECT id FROM groups WHERE class_id=$2)`, [req.params.sid, c.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Ошибка' }); }
});

app.post('/api/classes/:id/import-csv', auth, teacherOnly, uploadSmall.single('file'), async (req, res) => {
  try {
    const c = await getClassById(req.params.id);
    if (!c || (req.user.role !== 'admin' && c.teacher_id !== req.user.id))
      return res.status(403).json({ error: 'Нет доступа' });
    if (!req.file) return res.status(400).json({ error: 'Файл не загружен' });
    const text = req.file.buffer.toString('utf8').replace(/^\uFEFF/, '');
    const lines = text.split(/\r?\n/).filter(l => l.trim());
    const result = { added: [], existing: [], failed: [], skipped: 0 };
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      if (i === 0 && /^(имя|name)/i.test(line)) { result.skipped++; continue; }
      const parts = line.split(',').map(s => s.trim().replace(/^"|"$/g, ''));
      if (parts.length < 2) { result.failed.push({ line, reason: 'мало полей' }); continue; }
      const name = parts[0], email = parts[1].toLowerCase();
      if (!name || !email || !email.includes('@')) { result.failed.push({ line, reason: 'некорректные данные' }); continue; }
      let user = await getUserByEmail(email);
      let password = null, isNew = false;
      if (!user) {
        password = genPass();
        const id = uid();
        await pool.query(
          `INSERT INTO users (id, name, email, pass, role, link_code, created_at)
           VALUES ($1, $2, $3, $4, 'student', $5, $6)`,
          [id, name, email, await bcrypt.hash(password, 10), uid() + uid(), Date.now()]);
        user = await getUserById(id);
        isNew = true;
      }
      const inClass = await pool.query('SELECT 1 FROM class_students WHERE class_id=$1 AND student_id=$2', [c.id, user.id]);
      if (!inClass.rowCount) {
        await pool.query('INSERT INTO class_students (class_id, student_id) VALUES ($1, $2)', [c.id, user.id]);
        if (isNew) result.added.push({ name, email, password });
        else result.existing.push({ name, email, password: null });
      } else {
        if (isNew) result.added.push({ name, email, password, note: 'создан, но уже был в классе' });
        else result.existing.push({ name, email, password: null, note: 'уже в классе' });
      }
    }
    await logAction(req.user.id, req.user.name, 'Импорт CSV',
      'в класс «' + c.name + '»: ' + result.added.length + ' новых');
    res.json(result);
  } catch (e) { res.status(500).json({ error: 'Ошибка импорта: ' + e.message }); }
});

app.post('/api/classes/:id/groups', auth, teacherOnly, async (req, res) => {
  const c = await getClassById(req.params.id);
  if (!c || (req.user.role !== 'admin' && c.teacher_id !== req.user.id))
    return res.status(403).json({ error: 'Нет доступа' });
  const { name } = req.body || {};
  if (!name) return res.status(400).json({ error: 'Введите название' });
  const id = uid();
  await pool.query('INSERT INTO groups (id,class_id,name) VALUES ($1,$2,$3)', [id, c.id, name.trim()]);
  res.json({ group: { id, name: name.trim(), studentIds: [] } });
});
app.delete('/api/classes/:id/groups/:gid', auth, teacherOnly, async (req, res) => {
  const c = await getClassById(req.params.id);
  if (!c || (req.user.role !== 'admin' && c.teacher_id !== req.user.id))
    return res.status(403).json({ error: 'Нет доступа' });
  await pool.query('DELETE FROM group_students WHERE group_id=$1', [req.params.gid]);
  await pool.query('DELETE FROM groups WHERE id=$1 AND class_id=$2', [req.params.gid, c.id]);
  res.json({ ok: true });
});
app.post('/api/classes/:id/groups/:gid/students/:sid', auth, teacherOnly, async (req, res) => {
  const c = await getClassById(req.params.id);
  if (!c || (req.user.role !== 'admin' && c.teacher_id !== req.user.id))
    return res.status(403).json({ error: 'Нет доступа' });
  await pool.query('INSERT INTO group_students (group_id,student_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
    [req.params.gid, req.params.sid]);
  res.json({ ok: true });
});
app.delete('/api/classes/:id/groups/:gid/students/:sid', auth, teacherOnly, async (req, res) => {
  const c = await getClassById(req.params.id);
  if (!c || (req.user.role !== 'admin' && c.teacher_id !== req.user.id))
    return res.status(403).json({ error: 'Нет доступа' });
  await pool.query('DELETE FROM group_students WHERE group_id=$1 AND student_id=$2',
    [req.params.gid, req.params.sid]);
  res.json({ ok: true });
});

app.post('/api/classes/:id/broadcast', auth, teacherOnly, async (req, res) => {
  try {
    const c = await getClassById(req.params.id);
    if (!c || (req.user.role !== 'admin' && c.teacher_id !== req.user.id))
      return res.status(403).json({ error: 'Нет доступа' });
    if (!bot) return res.status(400).json({ error: 'Telegram не настроен' });
    const { message } = req.body || {};
    if (!message || !message.trim()) return res.status(400).json({ error: 'Введите текст' });
    const recipients = await getStudentsInClass(c.id);
    const withTg = recipients.filter(u => u.telegram_chat_id);
    const withoutTg = recipients.filter(u => !u.telegram_chat_id);
    const header = '📢 *' + c.name + '* · от учителя:\n\n' + message;
    let sent = 0, failed = 0;
    for (const u of withTg) {
      const ok = await tgSend(Number(u.telegram_chat_id), header, { parse_mode: 'Markdown' });
      if (ok) sent++; else failed++;
    }
    res.json({ total: recipients.length, sent, failed,
               withoutTelegram: withoutTg.length,
               withoutTelegramNames: withoutTg.map(u => u.name) });
  } catch (e) { res.status(500).json({ error: 'Ошибка' }); }
});

/* ========== АНАЛИТИКА КЛАССА ========== */
app.get('/api/classes/:id/analytics', auth, teacherOnly, async (req, res) => {
  try {
    const c = await getClassById(req.params.id);
    if (!c) return res.status(404).json({ error: 'Класс не найден' });
    if (req.user.role !== 'admin' && c.teacher_id !== req.user.id)
      return res.status(403).json({ error: 'Нет доступа' });

    const students = await getStudentsInClass(c.id);
    const totalStudents = students.length;

    let tests = [];
    try {
      const tR = await pool.query(
        `SELECT * FROM tests WHERE class_ids @> $1::jsonb ORDER BY created_at DESC`,
        [JSON.stringify([c.id])]);
      tests = tR.rows;
    } catch (e) {
      console.error('analytics: tests query', e.message);
      const tR = await pool.query(`SELECT * FROM tests ORDER BY created_at DESC`);
      tests = tR.rows.filter(t => Array.isArray(t.class_ids) && t.class_ids.includes(c.id));
    }

    const perTest = [];
    for (const t of tests) {
      let subsRows = [];
      try {
        const subs = await pool.query(
          `SELECT student_id, score, max FROM submissions WHERE test_id=$1 AND class_id=$2`,
          [t.id, c.id]);
        subsRows = subs.rows;
      } catch (e) { console.error('analytics: subs', e.message); }
      const avg = subsRows.length
        ? Math.round(subsRows.reduce((s, x) => s + (x.max ? x.score / x.max : 0), 0) / subsRows.length * 100)
        : 0;
      perTest.push({
        id: t.id, title: t.title,
        submissions: subsRows.length, total: totalStudents, avgPercent: avg
      });
    }

    const perStudent = [];
    for (const s of students) {
      let rows = [];
      try {
        const subs = await pool.query(
          `SELECT score, max FROM submissions WHERE class_id=$1 AND student_id=$2`,
          [c.id, s.id]);
        rows = subs.rows;
      } catch (e) { console.error('analytics: perStudent', e.message); }
      const avg = rows.length
        ? Math.round(rows.reduce((x, y) => x + (y.max ? y.score / y.max : 0), 0) / rows.length * 100)
        : null;
      perStudent.push({
        id: s.id, name: s.name,
        submissions: rows.length, totalTests: tests.length, avgPercent: avg
      });
    }
    perStudent.sort((a, b) => {
      if (a.avgPercent === null) return 1;
      if (b.avgPercent === null) return -1;
      return b.avgPercent - a.avgPercent;
    });

    let hardTasks = [];
    try {
      const allSubs = await pool.query(
        `SELECT s.results, t.tasks
         FROM submissions s JOIN tests t ON t.id = s.test_id
         WHERE s.class_id = $1`, [c.id]);
      const taskStats = {};
      for (const row of allSubs.rows) {
        const tasks = row.tasks || [];
        const results = row.results || [];
        tasks.forEach((task, i) => {
          const key = (task.statement || '').slice(0, 120);
          if (!taskStats[key]) taskStats[key] = { total: 0, correct: 0 };
          taskStats[key].total++;
          if (results[i] && results[i].ok) taskStats[key].correct++;
        });
      }
      hardTasks = Object.keys(taskStats).map(k => ({
        statement: k, total: taskStats[k].total, correct: taskStats[k].correct,
        pct: taskStats[k].total ? Math.round(taskStats[k].correct / taskStats[k].total * 100) : 0
      })).filter(x => x.total >= 2).sort((a, b) => a.pct - b.pct).slice(0, 10);
    } catch (e) { console.error('analytics: hardTasks', e.message); }

    res.json({ totalStudents, totalTests: tests.length, perTest, perStudent, hardTasks });
  } catch (e) {
    console.error('analytics fatal:', e.message, e.stack);
    res.status(500).json({ error: 'Ошибка аналитики: ' + e.message });
  }
});

app.get('/api/classes/:id/rating', auth, async (req, res) => {
  try {
    const c = await getClassById(req.params.id);
    if (!c) return res.status(404).json({ error: 'Класс не найден' });
    if (!(await canSeeClass(req.user.id, req.user.role, c.id)))
      return res.status(403).json({ error: 'Нет доступа' });

    const students = await getStudentsInClass(c.id);
    const out = [];
    for (const s of students) {
      try {
        const r = await pool.query(
          `SELECT COUNT(*)::int AS n,
                  COALESCE(AVG(CASE WHEN max>0 THEN score*100.0/max END),0)::float AS avg,
                  COALESCE(SUM(score),0)::int AS total
           FROM submissions WHERE class_id=$1 AND student_id=$2`,
          [c.id, s.id]);
        const row = r.rows[0];
        if (!row || row.n === 0) continue;
        out.push({
          id: s.id, name: s.name,
          hasAvatar: !!s.avatar_key,
          submissions: row.n,
          avgPercent: Math.round(row.avg),
          totalScore: row.total
        });
      } catch (e) { console.error('rating row:', e.message); }
    }
    out.sort((a, b) => b.avgPercent - a.avgPercent);

    let myRank = null;
    if (req.user.role === 'student') {
      myRank = out.findIndex(x => x.id === req.user.id);
      if (myRank >= 0) myRank++;
    }
    res.json({ rating: out, myRank });
  } catch (e) {
    console.error('rating fatal:', e.message, e.stack);
    res.status(500).json({ error: 'Ошибка рейтинга: ' + e.message });
  }
});

app.get('/api/student/schedule', auth, async (req, res) => {
  try {
    if (req.user.role !== 'student') return res.json({ schedule: [] });
    const myCids = await getClassIdsForStudent(req.user.id);
    if (!myCids.length) return res.json({ schedule: [] });
    const tR = await pool.query(
      `SELECT t.*, c.name AS class_name
       FROM tests t JOIN classes c ON c.id = ANY($1::text[])
       WHERE t.class_ids ?| $1::text[] ORDER BY t.created_at DESC`, [myCids]);
    const out = [];
    const now = Date.now();
    for (const t of tR.rows) {
      const visible = await studentSeesTest(req.user.id, t);
      if (!visible) continue;
      const mySubs = await pool.query(
        `SELECT COUNT(*)::int AS n FROM submissions WHERE test_id=$1 AND student_id=$2`, [t.id, req.user.id]);
      const attemptsUsed = mySubs.rows[0].n;
      const settings = normSettings(t.settings);
      const canTry = !(settings.attempts > 0 && attemptsUsed >= settings.attempts);
      const deadline = t.deadline ? Number(t.deadline) : null;
      const isOverdue = deadline && now > deadline;
      if (canTry) {
        out.push({ testId: t.id, title: t.title, className: t.class_name,
                   deadline, isOverdue, tasksCount: (t.tasks || []).length, settings });
      }
    }
    out.sort((a, b) => {
      if (a.deadline && b.deadline) return a.deadline - b.deadline;
      if (a.deadline) return -1;
      if (b.deadline) return 1;
      return 0;
    });
    res.json({ schedule: out.slice(0, 20) });
  } catch (e) { res.status(500).json({ error: 'Ошибка' }); }
});

app.get('/api/classes/:id/messages', auth, async (req, res) => {
  try {
    const c = await getClassById(req.params.id);
    if (!c) return res.status(404).json({ error: 'Класс не найден' });
    if (!(await canSeeClass(req.user.id, req.user.role, c.id))) return res.status(403).json({ error: 'Нет доступа' });
    const before = Number(req.query.before) || Date.now() + 1;
    const r = await pool.query(
      `SELECT m.*, u.avatar_key FROM messages m JOIN users u ON u.id=m.user_id
       WHERE m.class_id=$1 AND m.created_at < $2 ORDER BY m.created_at DESC LIMIT 50`, [c.id, before]);
    const msgs = r.rows.reverse().map(m => ({
      id: m.id, userId: m.user_id, userName: m.user_name,
      hasAvatar: !!m.avatar_key, text: m.text,
      fileName: m.file_name, fileType: m.file_type,
      fileSize: Number(m.file_size) || 0, hasFile: !!m.file_key,
      createdAt: Number(m.created_at), own: m.user_id === req.user.id
    }));
    res.json({ messages: msgs });
  } catch (e) { res.status(500).json({ error: 'Ошибка' }); }
});

app.post('/api/classes/:id/messages', auth, uploadSmall.single('file'), async (req, res) => {
  try {
    const c = await getClassById(req.params.id);
    if (!c) return res.status(404).json({ error: 'Класс не найден' });
    if (!(await canSeeClass(req.user.id, req.user.role, c.id))) return res.status(403).json({ error: 'Нет доступа' });
    const text = (req.body.text || '').trim();
    let fileKey = null, fileName = null, fileType = null, fileSize = 0;
    if (req.file) {
      if (!s3) return res.status(400).json({ error: 'Хранилище не настроено' });
      const key = 'chat/' + c.id + '/' + uid() + '_' + req.file.originalname.replace(/[^\w.-]/g, '_');
      await s3Put(key, req.file.buffer, req.file.mimetype);
      fileKey = key; fileName = req.file.originalname;
      fileType = req.file.mimetype; fileSize = req.file.size;
    }
    if (!text && !fileKey) return res.status(400).json({ error: 'Пустое сообщение' });
    const id = uid();
    await pool.query(
      `INSERT INTO messages (id,class_id,user_id,user_name,text,file_key,file_name,file_type,file_size,created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [id, c.id, req.user.id, req.user.name, text || null, fileKey, fileName, fileType, fileSize, Date.now()]);
    const cnt = await pool.query('SELECT COUNT(*)::int AS n FROM messages WHERE class_id=$1 AND file_key IS NOT NULL', [c.id]);
    if (cnt.rows[0].n > 50) {
      const old = await pool.query(
        `SELECT id,file_key FROM messages WHERE class_id=$1 AND file_key IS NOT NULL
         ORDER BY created_at ASC LIMIT $2`, [c.id, cnt.rows[0].n - 50]);
      for (const m of old.rows) { await s3Del(m.file_key); await pool.query('UPDATE messages SET file_key=NULL WHERE id=$1', [m.id]); }
    }
    res.json({ id });
  } catch (e) { res.status(500).json({ error: e.message || 'Ошибка' }); }
});

app.get('/api/messages/:id/file', auth, async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM messages WHERE id=$1', [req.params.id]);
    const m = r.rows[0];
    if (!m || !m.file_key) return res.status(404).json({ error: 'Файл не найден' });
    if (!(await canSeeClass(req.user.id, req.user.role, m.class_id))) return res.status(403).json({ error: 'Нет доступа' });
    const { buffer, contentType } = await s3GetBuffer(m.file_key);
    res.setHeader('Content-Type', contentType || 'application/octet-stream');
    res.setHeader('Content-Disposition', 'inline; filename="' + encodeURIComponent(m.file_name || 'file') + '"');
    res.send(buffer);
  } catch (e) { res.status(500).json({ error: 'Ошибка' }); }
});

app.delete('/api/messages/:id', auth, async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM messages WHERE id=$1', [req.params.id]);
    const m = r.rows[0];
    if (!m) return res.status(404).json({ error: 'Сообщение не найдено' });
    if (m.user_id !== req.user.id) return res.status(403).json({ error: 'Можно удалять только свои сообщения' });
    if (m.file_key) await s3Del(m.file_key);
    await pool.query('DELETE FROM messages WHERE id=$1', [m.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Ошибка' }); }
});

/* ========== КНИГИ (PDF + обложка) ========== */
app.get('/api/books', auth, async (req, res) => {
  try {
    const search = (req.query.q || '').toString().trim().toLowerCase();
    const filterClass = req.query.classId || '';
    const sort = req.query.sort || 'new';
    const orderMap = { new: 'created_at DESC', title: 'title ASC', author: 'author ASC NULLS LAST' };
    const order = orderMap[sort] || 'created_at DESC';

    let rows;
    if (req.user.role === 'admin' || req.user.role === 'librarian') {
      rows = (await pool.query(
        `SELECT id, owner_id, title, author, subject, description, class_ids, cover_key, pdf_size, created_at
         FROM books ORDER BY ${order}`)).rows;
    } else if (req.user.role === 'teacher') {
      rows = (await pool.query(
        `SELECT id, owner_id, title, author, subject, description, class_ids, cover_key, pdf_size, created_at
         FROM books WHERE owner_id=$1 ORDER BY ${order}`, [req.user.id])).rows;
    } else {
      const myCids = await getClassIdsForStudent(req.user.id);
      rows = (await pool.query(
        `SELECT id, owner_id, title, author, subject, description, class_ids, cover_key, pdf_size, created_at
         FROM books WHERE class_ids = '[]'::jsonb OR class_ids ?| $1::text[] ORDER BY ${order}`, [myCids])).rows;
    }

    let books = rows.map(b => ({
      id: b.id, title: b.title, author: b.author, subject: b.subject,
      description: b.description, classIds: b.class_ids || [],
      hasCover: !!b.cover_key,
      pdfSize: Number(b.pdf_size) || 0,
      ownerId: b.owner_id,
      createdAt: Number(b.created_at)
    }));

    if (search) books = books.filter(b =>
      (b.title || '').toLowerCase().includes(search) ||
      (b.author || '').toLowerCase().includes(search) ||
      (b.subject || '').toLowerCase().includes(search) ||
      (b.description || '').toLowerCase().includes(search));
    if (filterClass) books = books.filter(b => b.classIds.includes(filterClass));

    for (const b of books) {
      const u = await getUserById(b.ownerId);
      b.ownerName = u ? u.name : '—';
    }
    res.json({ books });
  } catch (e) { res.status(500).json({ error: 'Ошибка' }); }
});

app.get('/api/books/:id', auth, async (req, res) => {
  try {
    const b = (await pool.query('SELECT * FROM books WHERE id=$1', [req.params.id])).rows[0];
    if (!b) return res.status(404).json({ error: 'Книга не найдена' });
    if (!(await canSeeBook(req.user.id, req.user.role, b)))
      return res.status(403).json({ error: 'Нет доступа' });
    const bm = await pool.query(
      'SELECT id, position, note, created_at FROM bookmarks WHERE user_id=$1 AND book_id=$2 ORDER BY position',
      [req.user.id, b.id]);
    res.json({
      book: {
        id: b.id, title: b.title, author: b.author, subject: b.subject,
        description: b.description, classIds: b.class_ids || [],
        hasCover: !!b.cover_key,
        hasPdf: !!b.pdf_key,
        pdfSize: Number(b.pdf_size) || 0,
        ownerId: b.owner_id,
        createdAt: Number(b.created_at),
        bookmarks: bm.rows.map(x => ({
          id: x.id, position: Number(x.position),
          note: x.note, createdAt: Number(x.created_at)
        }))
      }
    });
  } catch (e) { res.status(500).json({ error: 'Ошибка' }); }
});

app.post('/api/books', auth, canUploadBooks, uploadBook.fields([
  { name: 'cover', maxCount: 1 },
  { name: 'pdf', maxCount: 1 }
]), async (req, res) => {
  try {
    const { title, author, subject, description, classIds } = req.body || {};
    if (!title || !title.trim()) return res.status(400).json({ error: 'Введите название' });
    const pdfFile = req.files && req.files.pdf && req.files.pdf[0];
    if (!pdfFile) return res.status(400).json({ error: 'Загрузите PDF-файл книги' });
    if (!/\.pdf$/i.test(pdfFile.originalname) && pdfFile.mimetype !== 'application/pdf')
      return res.status(400).json({ error: 'Нужен файл PDF' });
    if (!s3) return res.status(400).json({ error: 'Хранилище B2 не настроено' });

    let parsedCids = [];
    try { parsedCids = classIds ? JSON.parse(classIds) : []; } catch (e) {}

    const bookId = uid();

    let coverKey = null;
    const coverFile = req.files && req.files.cover && req.files.cover[0];
    if (coverFile) {
      const buf = await sharp(coverFile.buffer).resize(600, 900, { fit: 'cover' }).jpeg({ quality: 82 }).toBuffer();
      coverKey = 'covers/books/' + bookId + '.jpg';
      await s3Put(coverKey, buf, 'image/jpeg');
    }

    const pdfKey = 'books/pdf/' + bookId + '.pdf';
    await s3Put(pdfKey, pdfFile.buffer, 'application/pdf');

    await pool.query(
      `INSERT INTO books (id, owner_id, title, author, subject, description, class_ids, pdf_key, pdf_size, cover_key, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [bookId, req.user.id, title.trim(),
       author ? author.trim() : null,
       subject ? subject.trim() : null,
       description ? description.trim() : null,
       JSON.stringify(parsedCids),
       pdfKey, pdfFile.size, coverKey, Date.now()]);
    await logAction(req.user.id, req.user.name, 'Загрузил книгу',
      title.trim() + ' (' + Math.round(pdfFile.size / 1024 / 1024 * 10) / 10 + ' МБ)');

    res.json({ id: bookId });

    for (const cid of parsedCids) {
      try {
        const studs = await getStudentsInClass(cid);
        for (const s of studs) {
          await notify(s.id, 'new_book', 'Новая книга в библиотеке',
            '«' + title.trim() + '» — доступна для чтения', { bookId });
        }
      } catch (e) { console.error('notify book:', e.message); }
    }
  } catch (e) {
    console.error('books POST:', e.message);
    res.status(500).json({ error: e.message || 'Ошибка' });
  }
});

app.put('/api/books/:id', auth, canUploadBooks, uploadBook.fields([
  { name: 'cover', maxCount: 1 },
  { name: 'pdf', maxCount: 1 }
]), async (req, res) => {
  try {
    const b = (await pool.query('SELECT * FROM books WHERE id=$1', [req.params.id])).rows[0];
    if (!b) return res.status(404).json({ error: 'Книга не найдена' });
    if (req.user.role !== 'admin' && b.owner_id !== req.user.id)
      return res.status(403).json({ error: 'Нет доступа' });
    const { title, author, subject, description, classIds } = req.body || {};
    let parsedCids = b.class_ids || [];
    try { if (classIds) parsedCids = JSON.parse(classIds); } catch (e) {}

    let coverKey = b.cover_key;
    const coverFile = req.files && req.files.cover && req.files.cover[0];
    if (coverFile && s3) {
      const buf = await sharp(coverFile.buffer).resize(600,900,{fit:'cover'}).jpeg({quality:82}).toBuffer();
      const key = 'covers/books/' + b.id + '_' + Date.now() + '.jpg';
      await s3Put(key, buf, 'image/jpeg');
      if (b.cover_key) await s3Del(b.cover_key);
      coverKey = key;
    }

    let pdfKey = b.pdf_key, pdfSize = b.pdf_size;
    const pdfFile = req.files && req.files.pdf && req.files.pdf[0];
    if (pdfFile && s3) {
      const key = 'books/pdf/' + b.id + '_' + Date.now() + '.pdf';
      await s3Put(key, pdfFile.buffer, 'application/pdf');
      if (b.pdf_key) await s3Del(b.pdf_key);
      pdfKey = key; pdfSize = pdfFile.size;
    }

    await pool.query(
      `UPDATE books SET title=$1, author=$2, subject=$3, description=$4,
                        class_ids=$5, pdf_key=$6, pdf_size=$7, cover_key=$8 WHERE id=$9`,
      [title || b.title,
       author != null ? author : b.author,
       subject != null ? subject : b.subject,
       description != null ? description : b.description,
       JSON.stringify(parsedCids),
       pdfKey, pdfSize, coverKey, b.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message || 'Ошибка' }); }
});

app.get('/api/books/:id/pdf', auth, async (req, res) => {
  try {
    const b = (await pool.query('SELECT * FROM books WHERE id=$1', [req.params.id])).rows[0];
    if (!b || !b.pdf_key) return res.status(404).json({ error: 'PDF не найден' });
    if (!(await canSeeBook(req.user.id, req.user.role, b)))
      return res.status(403).json({ error: 'Нет доступа' });

    const range = req.headers.range;
    let r;
    try {
      r = await s3Get(b.pdf_key, range);
    } catch (e) {
      console.error('s3 range get:', e.message);
      return res.status(500).json({ error: 'Ошибка чтения PDF' });
    }

    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Cache-Control', 'private, max-age=3600');

    if (range && r.ContentRange) {
      res.status(206);
      res.setHeader('Content-Range', r.ContentRange);
    }
    if (r.ContentLength != null) res.setHeader('Content-Length', String(r.ContentLength));
    res.setHeader('Content-Disposition', 'inline; filename="book.pdf"');

    if (r.Body && r.Body.pipe) r.Body.pipe(res);
    else {
      const chunks = [];
      for await (const c of r.Body) chunks.push(c);
      res.send(Buffer.concat(chunks));
    }
  } catch (e) {
    console.error('pdf:', e.message);
    if (!res.headersSent) res.status(500).json({ error: 'Ошибка' });
  }
});

app.get('/api/books/:id/cover', async (req, res) => {
  try {
    const b = (await pool.query('SELECT cover_key FROM books WHERE id=$1', [req.params.id])).rows[0];
    if (!b || !b.cover_key) return res.status(404).end();
    const { buffer, contentType } = await s3GetBuffer(b.cover_key);
    res.setHeader('Content-Type', contentType || 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(buffer);
  } catch (e) { res.status(404).end(); }
});

app.delete('/api/books/:id', auth, async (req, res) => {
  try {
    const b = (await pool.query('SELECT * FROM books WHERE id=$1', [req.params.id])).rows[0];
    if (!b) return res.status(404).json({ error: 'Не найдена' });
    if (req.user.role !== 'admin' && b.owner_id !== req.user.id)
      return res.status(403).json({ error: 'Нет доступа' });
    if (b.cover_key) await s3Del(b.cover_key);
    if (b.pdf_key) await s3Del(b.pdf_key);
    await pool.query('DELETE FROM books WHERE id=$1', [b.id]);
    await pool.query('DELETE FROM bookmarks WHERE book_id=$1', [b.id]);
    await logAction(req.user.id, req.user.name, 'Удалил книгу', b.title);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Ошибка' }); }
});

app.post('/api/books/:id/bookmarks', auth, async (req, res) => {
  try {
    const b = (await pool.query('SELECT id FROM books WHERE id=$1', [req.params.id])).rows[0];
    if (!b) return res.status(404).json({ error: 'Книга не найдена' });
    const { position, note } = req.body || {};
    if (position == null) return res.status(400).json({ error: 'Не указана страница' });
    const id = uid();
    await pool.query(
      `INSERT INTO bookmarks (id, user_id, book_id, position, note, created_at)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [id, req.user.id, b.id, Math.max(1, parseInt(position) || 1),
       note ? String(note).slice(0, 500) : null, Date.now()]);
    res.json({ id });
  } catch (e) { res.status(500).json({ error: 'Ошибка' }); }
});

app.delete('/api/bookmarks/:id', auth, async (req, res) => {
  try {
    const b = (await pool.query('SELECT * FROM bookmarks WHERE id=$1', [req.params.id])).rows[0];
    if (!b) return res.status(404).json({ error: 'Не найдено' });
    if (b.user_id !== req.user.id) return res.status(403).json({ error: 'Нет доступа' });
    await pool.query('DELETE FROM bookmarks WHERE id=$1', [b.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Ошибка' }); }
});

/* ========== РАБОТЫ ========== */
app.get('/api/tests', auth, async (req, res) => {
  try {
    if (req.user.role === 'admin' || req.user.role === 'teacher') {
      let rows;
      if (req.user.role === 'admin') {
        rows = (await pool.query(
          `SELECT t.*, (SELECT COUNT(*)::int FROM submissions s WHERE s.test_id=t.id AND s.seen=false) AS unseen
           FROM tests t ORDER BY t.created_at DESC`)).rows;
      } else {
        rows = (await pool.query(
          `SELECT t.*, (SELECT COUNT(*)::int FROM submissions s WHERE s.test_id=t.id AND s.seen=false) AS unseen
           FROM tests t WHERE t.owner_id=$1 ORDER BY t.created_at DESC`, [req.user.id])).rows;
      }
      return res.json({ tests: rows.map(t => ({
        id: t.id, title: t.title, tasks: t.tasks,
        classIds: t.class_ids || [], groupIds: t.group_ids || [],
        deadline: t.deadline ? Number(t.deadline) : null,
        settings: normSettings(t.settings), unseen: t.unseen
      })) });
    }
    const myCids = await getClassIdsForStudent(req.user.id);
    if (!myCids.length) return res.json({ tests: [] });
    const r = await pool.query('SELECT * FROM tests WHERE class_ids ?| $1::text[]', [myCids]);
    const out = [];
    for (const t of r.rows) {
      if (!(await studentSeesTest(req.user.id, t))) continue;
      const subsR = await pool.query(
        'SELECT * FROM submissions WHERE test_id=$1 AND student_id=$2 ORDER BY at DESC', [t.id, req.user.id]);
      const last = subsR.rows[0];
      out.push({
        id: t.id, title: t.title,
        tasks: t.tasks.map(x => {
          const c = { id: x.id, type: x.type, statement: x.statement, points: x.points };
          if (x.type === 'choice') c.options = x.options;
          return c;
        }),
        classIds: (t.class_ids || []).filter(id => myCids.includes(id)),
        deadline: t.deadline ? Number(t.deadline) : null,
        settings: normSettings(t.settings),
        attemptsUsed: subsR.rows.length,
        mySubmission: last ? { score: last.score, max: last.max, at: Number(last.at) } : null
      });
    }
    res.json({ tests: out });
  } catch (e) { res.status(500).json({ error: 'Ошибка' }); }
});

app.post('/api/tests', auth, teacherOnly, async (req, res) => {
  let id;
  try {
    const { title, tasks, classIds, groupIds, settings, deadline } = req.body || {};
    if (!title || !Array.isArray(tasks) || !tasks.length)
      return res.status(400).json({ error: 'Нужно название и задания' });
    id = uid();
    const dl = deadline ? Number(deadline) : null;
    await pool.query(
      `INSERT INTO tests (id,owner_id,title,tasks,class_ids,group_ids,settings,deadline,created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [id, req.user.id, title.trim(), JSON.stringify(tasks),
       JSON.stringify(classIds || []), JSON.stringify(groupIds || []),
       JSON.stringify(normSettings(settings)), dl, Date.now()]);
  } catch (e) {
    console.error('tests POST insert:', e.message, e.stack);
    return res.status(500).json({ error: 'Не удалось создать работу: ' + e.message });
  }

  res.json({ id });

  try {
    const { title, tasks, classIds } = req.body || {};
    const cids = classIds || [];
    const recipients = new Set();
    for (const cid of cids) {
      const studs = await getStudentsInClass(cid);
      studs.forEach(s => recipients.add(s.id));
      for (const s of studs) {
        if (s.telegram_chat_id) {
          let text = '📝 Новая работа: *' + (title || '').trim() + '*\n\nЗаданий: ' + (tasks || []).length;
          tgSend(Number(s.telegram_chat_id), text, { parse_mode: 'Markdown' }).catch(() => {});
        }
      }
    }
    for (const sid of recipients) {
      try { await notify(sid, 'new_test', 'Новая работа', 'Учитель назначил «' + (title || '').trim() + '»', { testId: id }); }
      catch (e) { console.error('notify new_test:', e.message); }
    }
    try { await logAction(req.user.id, req.user.name, 'Создал работу', (title || '').trim()); } catch (e) {}
  } catch (e) {
    console.error('tests POST post-insert:', e.message);
  }
});

app.put('/api/tests/:id', auth, teacherOnly, async (req, res) => {
  try {
    const t = (await pool.query('SELECT * FROM tests WHERE id=$1', [req.params.id])).rows[0];
    if (!t || (req.user.role !== 'admin' && t.owner_id !== req.user.id))
      return res.status(403).json({ error: 'Нет доступа' });
    const { title, tasks, classIds, groupIds, settings, deadline } = req.body || {};
    const dl = deadline ? Number(deadline) : null;
    await pool.query(
      `UPDATE tests SET title=$1,tasks=$2,class_ids=$3,group_ids=$4,settings=$5,deadline=$6 WHERE id=$7`,
      [title, JSON.stringify(tasks), JSON.stringify(classIds || []),
       JSON.stringify(groupIds || []), JSON.stringify(normSettings(settings)), dl, t.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Ошибка' }); }
});

app.post('/api/tests/:id/duplicate', auth, teacherOnly, async (req, res) => {
  try {
    const t = (await pool.query('SELECT * FROM tests WHERE id=$1', [req.params.id])).rows[0];
    if (!t || (req.user.role !== 'admin' && t.owner_id !== req.user.id))
      return res.status(403).json({ error: 'Нет доступа' });
    const id = uid();
    await pool.query(
      `INSERT INTO tests (id,owner_id,title,tasks,class_ids,group_ids,settings,deadline,created_at)
       VALUES ($1,$2,$3,$4,'[]','[]',$5,NULL,$6)`,
      [id, req.user.id, t.title + ' (копия)', JSON.stringify(t.tasks), JSON.stringify(normSettings(t.settings)), Date.now()]);
    res.json({ id });
  } catch (e) { res.status(500).json({ error: 'Ошибка' }); }
});

app.delete('/api/tests/:id', auth, teacherOnly, async (req, res) => {
  try {
    const t = (await pool.query('SELECT * FROM tests WHERE id=$1', [req.params.id])).rows[0];
    if (!t || (req.user.role !== 'admin' && t.owner_id !== req.user.id))
      return res.status(403).json({ error: 'Нет доступа' });
    await pool.query('DELETE FROM submissions WHERE test_id=$1', [t.id]);
    await pool.query('DELETE FROM tests WHERE id=$1', [t.id]);
    await logAction(req.user.id, req.user.name, 'Удалил работу', t.title);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Ошибка' }); }
});

/* ========== АВТОПРОВЕРКА ========== */
let nerdamer = null;
try { nerdamer = require('nerdamer/all'); } catch (e) { try { nerdamer = require('nerdamer'); } catch (e2) {} }

function norm(s) {
  return String(s || '').replace(/\\left|\\right/g, '')
    .replace(/[−–—]/g, '-').replace(/[×·]/g, '*').replace(/÷/g, '/')
    .replace(/\s+/g, '').toLowerCase();
}
function isCorrect(student, correct, tol = 1e-6) {
  const s = norm(student), c = norm(correct);
  if (!s) return false;
  if (s === c) return true;
  const sn = Number(s), cn = Number(c);
  if (isFinite(sn) && isFinite(cn)) return Math.abs(sn - cn) <= tol;
  if (nerdamer) {
    try { if (nerdamer('simplify((' + s + ')-(' + c + '))').toString() === '0') return true; } catch (e) {}
    try {
      const a = Number(nerdamer(s).evaluate().text('decimals'));
      const b = Number(nerdamer(c).evaluate().text('decimals'));
      if (isFinite(a) && isFinite(b)) return Math.abs(a - b) <= Math.max(tol, 1e-6);
    } catch (e) {}
  }
  return false;
}

app.post('/api/tests/:id/submit', auth, async (req, res) => {
  try {
    if (req.user.role !== 'student') return res.status(403).json({ error: 'Только для учеников' });
    const t = (await pool.query('SELECT * FROM tests WHERE id=$1', [req.params.id])).rows[0];
    if (!t) return res.status(404).json({ error: 'Работа не найдена' });
    if (!(await studentSeesTest(req.user.id, t))) return res.status(403).json({ error: 'Работа не для вас' });
    const myCids = await getClassIdsForStudent(req.user.id);
    const classId = (t.class_ids || []).find(id => myCids.includes(id));
    if (!classId) return res.status(403).json({ error: 'Класс не найден' });

    const settings = normSettings(t.settings);
    const cnt = (await pool.query(
      'SELECT COUNT(*)::int AS n FROM submissions WHERE test_id=$1 AND student_id=$2', [t.id, req.user.id])).rows[0].n;
    if (settings.attempts > 0 && cnt >= settings.attempts) return res.status(400).json({ error: 'Лимит попыток' });

    const now = Date.now();
    const deadline = t.deadline ? Number(t.deadline) : null;
    const isLate = deadline ? now > deadline : false;
    const startedAt = Number(req.body.startedAt) || now;
    const durationMs = now - startedAt;
    const expired = settings.timeLimit > 0 && durationMs > (settings.timeLimit * 60000) + 30000;

    const answers = req.body.answers || [];
    const tasks = t.tasks || [];
    const results = tasks.map((task, i) => {
      const a = answers[i] || {};
      if (task.type === 'input') {
        const ok = isCorrect(a.ascii || a.text || '', task.answer, task.tolerance);
        return { ok, studentText: a.text || a.ascii || '' };
      }
      return { ok: Number(a.index) === Number(task.correctIndex), studentText: '' };
    });
    const score = results.reduce((s, r, i) => s + (r.ok ? (tasks[i].points || 1) : 0), 0);
    const max = tasks.reduce((s, x) => s + (x.points || 1), 0);
    const subId = uid();
    await pool.query(
      `INSERT INTO submissions (id,test_id,student_id,student_name,class_id,score,max,results,
                                attempt,started_at,at,duration_ms,expired,late,seen)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,false)`,
      [subId, t.id, req.user.id, req.user.name, classId, score, max,
       JSON.stringify(results), cnt + 1, startedAt, now, durationMs, expired, isLate]);

    const pct = max ? Math.round(score / max * 100) : 0;
    let notifText = '«' + t.title + '» — ' + score + '/' + max + ' (' + pct + '%)';
    if (isLate) notifText += ' · сдано с опозданием';

    res.json({ id: subId, score, max, results: results.map((r, i) => {
      const task = tasks[i];
      const out = { ok: r.ok, studentText: r.studentText };
      if (settings.showAnswers && !r.ok) {
        if (task.type === 'input') out.correctAnswer = task.answer;
        else out.correctIndex = task.correctIndex;
      }
      return out;
    }), attempt: cnt + 1, durationMs, expired, late: isLate, settings });

    try { await notify(t.owner_id, 'submission', 'Новая сдача: ' + req.user.name, notifText, { testId: t.id, submissionId: subId }); } catch (e) {}
    const teacher = await getUserById(t.owner_id);
    if (teacher && teacher.telegram_chat_id) {
      tgSend(Number(teacher.telegram_chat_id),
        '📥 *' + req.user.name + '* сдал «' + t.title + '»\n' + score + '/' + max + ' (' + pct + '%)',
        { parse_mode: 'Markdown' }).catch(() => {});
    }
  } catch (e) {
    console.error('submit:', e.message, e.stack);
    res.status(500).json({ error: 'Ошибка отправки: ' + e.message });
  }
});

app.get('/api/tests/:id/submissions', auth, teacherOnly, async (req, res) => {
  try {
    const t = (await pool.query('SELECT * FROM tests WHERE id=$1', [req.params.id])).rows[0];
    if (!t || (req.user.role !== 'admin' && t.owner_id !== req.user.id))
      return res.status(403).json({ error: 'Нет доступа' });
    await pool.query('UPDATE submissions SET seen=true WHERE test_id=$1', [t.id]);
    const classIds = t.class_ids || [], groupIds = t.group_ids || [];
    const groups = [];
    for (const cid of classIds) {
      const cls = await getClassById(cid);
      if (!cls) continue;
      const subs = (await pool.query(
        `SELECT id,student_id,student_name,score,max,at,attempt,duration_ms,expired,late
         FROM submissions WHERE test_id=$1 AND class_id=$2 ORDER BY at DESC`, [t.id, cid])).rows
        .map(s => ({ id: s.id, studentId: s.student_id, studentName: s.student_name,
                     score: s.score, max: s.max, at: Number(s.at), attempt: s.attempt,
                     durationMs: Number(s.duration_ms), expired: s.expired, late: s.late }));
      const submittedIds = new Set(subs.map(s => s.studentId));
      let all = await getStudentsInClass(cid);
      if (groupIds.length > 0) {
        const inG = new Set();
        const gg = await getGroupsForClass(cid);
        gg.forEach(g => { if (groupIds.includes(g.id)) g.studentIds.forEach(id => inG.add(id)); });
        all = all.filter(s => inG.has(s.id));
      }
      const notSubmitted = all.filter(s => !submittedIds.has(s.id)).map(s => ({ id: s.id, name: s.name }));
      groups.push({ classId: cid, className: cls.name, submitted: subs, notSubmitted });
    }
    const relR = await pool.query(
      `SELECT results FROM submissions WHERE test_id=$1 AND class_id = ANY($2)`, [t.id, classIds]);
    const tasks = t.tasks || [];
    const perTask = tasks.map((task, i) => {
      let correct = 0, total = 0;
      relR.rows.forEach(row => { total++; if (row.results[i] && row.results[i].ok) correct++; });
      return { index: i + 1, statement: task.statement, points: task.points || 1,
               correct, total, pct: total ? Math.round(correct / total * 100) : 0 };
    });
    res.json({ groups, analytics: perTask, settings: normSettings(t.settings),
               deadline: t.deadline ? Number(t.deadline) : null });
  } catch (e) { res.status(500).json({ error: 'Ошибка' }); }
});

app.get('/api/tests/:id/export.csv', auth, teacherOnly, async (req, res) => {
  try {
    const t = (await pool.query('SELECT * FROM tests WHERE id=$1', [req.params.id])).rows[0];
    if (!t || (req.user.role !== 'admin' && t.owner_id !== req.user.id))
      return res.status(403).json({ error: 'Нет доступа' });
    const subs = (await pool.query('SELECT * FROM submissions WHERE test_id=$1 ORDER BY at', [t.id])).rows;
    const n = (t.tasks || []).length;
    const headers = ['Ученик','Класс','Дата','Попытка','Балл','Макс','%','Время','Опоздание'];
    for (let i = 1; i <= n; i++) headers.push('Задание ' + i);
    const cn = {};
    for (const cid of (t.class_ids || [])) {
      const c = await getClassById(cid);
      if (c) cn[cid] = c.name;
    }
    const rows = subs.map(s => {
      const pct = s.max ? Math.round(s.score / s.max * 100) : 0;
      const dur = s.duration_ms ? Math.round(Number(s.duration_ms) / 1000) + ' с' : '';
      const row = [s.student_name, cn[s.class_id] || '—',
                   new Date(Number(s.at)).toLocaleString('ru-RU'),
                   s.attempt || 1, s.score, s.max, pct + '%', dur, s.late ? 'Да' : 'Нет'];
      for (let i = 0; i < n; i++) {
        const r = s.results[i];
        row.push(r ? (r.ok ? '✓' : '✗') : '');
      }
      return row;
    });
    const csv = [headers, ...rows].map(r => r.map(escapeCsv).join(',')).join('\r\n');
    const safe = t.title.replace(/[^\p{L}\p{N}\-_]+/gu, '_').slice(0, 40);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="results_' + safe + '.csv"');
    res.send('\uFEFF' + csv);
  } catch (e) { res.status(500).json({ error: 'Ошибка' }); }
});

app.get('/api/submissions/:id', auth, async (req, res) => {
  try {
    const s = (await pool.query('SELECT * FROM submissions WHERE id=$1', [req.params.id])).rows[0];
    if (!s) return res.status(404).json({ error: 'Не найдено' });
    const t = (await pool.query('SELECT * FROM tests WHERE id=$1', [s.test_id])).rows[0];
    if (!t) return res.status(404).json({ error: 'Работа не найдена' });
    const isT = t.owner_id === req.user.id || req.user.role === 'admin';
    const isS = s.student_id === req.user.id;
    if (!isT && !isS) return res.status(403).json({ error: 'Нет доступа' });
    const tasks = (t.tasks || []).map((task, i) => {
      const r = s.results[i] || { ok: false };
      if (isT || r.ok) return task;
      const c = { ...task }; delete c.answer; delete c.correctIndex;
      return c;
    });
    res.json({
      submission: { id: s.id, score: s.score, max: s.max, at: Number(s.at),
                    results: s.results, attempt: s.attempt,
                    durationMs: Number(s.duration_ms), expired: s.expired, late: s.late },
      test: { id: t.id, title: t.title, tasks }
    });
  } catch (e) { res.status(500).json({ error: 'Ошибка' }); }
});

app.get('/api/notifications', auth, async (req, res) => {
  const r = await pool.query(
    `SELECT id,type,title,text,link,read,at FROM notifications WHERE user_id=$1 ORDER BY at DESC LIMIT 50`,
    [req.user.id]);
  const list = r.rows.map(n => ({ id: n.id, type: n.type, title: n.title, text: n.text,
    link: n.link, read: n.read, at: Number(n.at) }));
  res.json({ notifications: list, unread: list.filter(n => !n.read).length });
});
app.post('/api/notifications/read-all', auth, async (req, res) => {
  await pool.query('UPDATE notifications SET read=true WHERE user_id=$1', [req.user.id]);
  res.json({ ok: true });
});
app.post('/api/notifications/:id/read', auth, async (req, res) => {
  await pool.query('UPDATE notifications SET read=true WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]);
  res.json({ ok: true });
});

app.get('/api/teacher/dashboard', auth, teacherOnly, async (req, res) => {
  try {
    const isAdmin = req.user.role === 'admin';
    let classes;
    if (isAdmin) classes = (await pool.query('SELECT * FROM classes ORDER BY created_at DESC')).rows;
    else classes = (await pool.query('SELECT * FROM classes WHERE teacher_id=$1', [req.user.id])).rows;
    const perClass = [];
    for (const c of classes) {
      const sub = (await pool.query(
        `SELECT COUNT(*)::int AS n, COALESCE(AVG(CASE WHEN max>0 THEN score*100.0/max END),0)::float AS avg
         FROM submissions WHERE class_id=$1`, [c.id])).rows[0];
      perClass.push({ id: c.id, name: c.name, submissions: sub.n, avgPercent: Math.round(sub.avg) });
    }
    const weeks = [];
    const now = Date.now();
    const weekMs = 7 * 24 * 60 * 60 * 1000;
    for (let i = 7; i >= 0; i--) {
      const start = now - (i + 1) * weekMs;
      const end = now - i * weekMs;
      const sql = isAdmin
        ? `SELECT COUNT(*)::int AS n, COALESCE(AVG(CASE WHEN max>0 THEN score*100.0/max END),0)::float AS avg
           FROM submissions s JOIN tests t ON t.id=s.test_id WHERE s.at >= $1 AND s.at < $2`
        : `SELECT COUNT(*)::int AS n, COALESCE(AVG(CASE WHEN max>0 THEN score*100.0/max END),0)::float AS avg
           FROM submissions s JOIN tests t ON t.id=s.test_id WHERE t.owner_id=$1 AND s.at >= $2 AND s.at < $3`;
      const params = isAdmin ? [start, end] : [req.user.id, start, end];
      const r = (await pool.query(sql, params)).rows[0];
      weeks.push({ start, end,
        label: new Date(start).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' }),
        count: r.n, avgPercent: Math.round(r.avg) });
    }
    const topSql = isAdmin
      ? `SELECT s.student_id, s.student_name, COUNT(*)::int AS cnt,
                COALESCE(AVG(CASE WHEN s.max>0 THEN s.score*100.0/s.max END),0)::float AS avg
         FROM submissions s GROUP BY s.student_id, s.student_name
         HAVING COUNT(*) >= 1 ORDER BY avg DESC LIMIT 5`
      : `SELECT s.student_id, s.student_name, COUNT(*)::int AS cnt,
                COALESCE(AVG(CASE WHEN s.max>0 THEN s.score*100.0/s.max END),0)::float AS avg
         FROM submissions s JOIN tests t ON t.id=s.test_id WHERE t.owner_id=$1
         GROUP BY s.student_id, s.student_name HAVING COUNT(*) >= 1 ORDER BY avg DESC LIMIT 5`;
    const topR = await pool.query(topSql, isAdmin ? [] : [req.user.id]);
    const top = topR.rows.map(r => ({ id: r.student_id, name: r.student_name, submissions: r.cnt, avgPercent: Math.round(r.avg) }));
    const bottomSql = isAdmin
      ? `SELECT s.student_id, s.student_name, COUNT(*)::int AS cnt,
                COALESCE(AVG(CASE WHEN s.max>0 THEN s.score*100.0/s.max END),0)::float AS avg
         FROM submissions s GROUP BY s.student_id, s.student_name
         HAVING COUNT(*) >= 1 ORDER BY avg ASC LIMIT 5`
      : `SELECT s.student_id, s.student_name, COUNT(*)::int AS cnt,
                COALESCE(AVG(CASE WHEN s.max>0 THEN s.score*100.0/s.max END),0)::float AS avg
         FROM submissions s JOIN tests t ON t.id=s.test_id WHERE t.owner_id=$1
         GROUP BY s.student_id, s.student_name HAVING COUNT(*) >= 1 ORDER BY avg ASC LIMIT 5`;
    const bottomR = await pool.query(bottomSql, isAdmin ? [] : [req.user.id]);
    const bottom = bottomR.rows.map(r => ({ id: r.student_id, name: r.student_name, submissions: r.cnt, avgPercent: Math.round(r.avg) }));
    const totalR = isAdmin
      ? `SELECT COUNT(*)::int AS n, COALESCE(AVG(CASE WHEN max>0 THEN score*100.0/max END),0)::float AS avg FROM submissions`
      : `SELECT COUNT(*)::int AS n, COALESCE(AVG(CASE WHEN s.max>0 THEN s.score*100.0/s.max END),0)::float AS avg
         FROM submissions s JOIN tests t ON t.id=s.test_id WHERE t.owner_id=$1`;
    const totalSubs = (await pool.query(totalR, isAdmin ? [] : [req.user.id])).rows[0];
    res.json({
      perClass, weeks, top, bottom,
      total: { classes: classes.length, submissions: totalSubs.n, avgPercent: Math.round(totalSubs.avg) }
    });
  } catch (e) { res.status(500).json({ error: 'Ошибка' }); }
});

app.get('/api/profile/teacher', auth, async (req, res) => {
  try {
    const isAdmin = req.user.role === 'admin';
    const where = isAdmin ? '' : 'WHERE teacher_id=$1';
    const args = isAdmin ? [] : [req.user.id];
    const classesCount = (await pool.query(`SELECT COUNT(*)::int AS n FROM classes ${where}`, args)).rows[0].n;
    const studentsCount = (await pool.query(
      `SELECT COUNT(DISTINCT cs.student_id)::int AS n
       FROM class_students cs JOIN classes c ON c.id=cs.class_id ${isAdmin ? '' : 'WHERE c.teacher_id=$1'}`, args)).rows[0].n;
    const testsCount = (await pool.query(`SELECT COUNT(*)::int AS n FROM tests ${isAdmin ? '' : 'WHERE owner_id=$1'}`, args)).rows[0].n;
    const booksCount = (await pool.query(`SELECT COUNT(*)::int AS n FROM books ${isAdmin ? '' : 'WHERE owner_id=$1'}`, args)).rows[0].n;
    const subR = (await pool.query(
      `SELECT COUNT(*)::int AS n, COALESCE(AVG(CASE WHEN s.max>0 THEN s.score*100.0/s.max END),0)::float AS avg
       FROM submissions s JOIN tests t ON t.id=s.test_id ${isAdmin ? '' : 'WHERE t.owner_id=$1'}`, args)).rows[0];
    const recent = (await pool.query(
      `SELECT s.id,s.student_name,s.score,s.max,s.at,t.title AS test_title
       FROM submissions s JOIN tests t ON t.id=s.test_id ${isAdmin ? '' : 'WHERE t.owner_id=$1'}
       ORDER BY s.at DESC LIMIT 5`, args)).rows
      .map(r => ({ id: r.id, studentName: r.student_name, score: r.score, max: r.max, at: Number(r.at), testTitle: r.test_title }));
    res.json({ classesCount, studentsCount, testsCount, booksCount,
      submissionsCount: subR.n, avgPercent: Math.round(subR.avg), recent });
  } catch (e) { res.status(500).json({ error: 'Ошибка' }); }
});

app.get('/api/profile/student', auth, async (req, res) => {
  try {
    const cR = (await pool.query('SELECT COUNT(*)::int AS n FROM class_students WHERE student_id=$1', [req.user.id])).rows[0].n;
    const sR = (await pool.query(
      `SELECT COUNT(*)::int AS n,
              COALESCE(AVG(CASE WHEN max>0 THEN score*100.0/max END),0)::float AS avg,
              COALESCE(SUM(score),0)::int AS ts, COALESCE(SUM(max),0)::int AS tm
       FROM submissions WHERE student_id=$1`, [req.user.id])).rows[0];
    const recent = (await pool.query(
      `SELECT s.id,s.score,s.max,s.at,t.title AS test_title
       FROM submissions s JOIN tests t ON t.id=s.test_id WHERE s.student_id=$1 ORDER BY s.at DESC LIMIT 5`,
      [req.user.id])).rows
      .map(r => ({ id: r.id, score: r.score, max: r.max, at: Number(r.at), testTitle: r.test_title }));
    const myCids = await getClassIdsForStudent(req.user.id);
    const booksCount = (await pool.query(
      `SELECT COUNT(*)::int AS n FROM books WHERE class_ids = '[]'::jsonb OR class_ids ?| $1::text[]`, [myCids])).rows[0].n;
    const all = (await pool.query(
      `SELECT s.id,s.score,s.max,s.at,s.attempt,t.title AS test_title,c.name AS class_name,s.class_id
       FROM submissions s JOIN tests t ON t.id=s.test_id JOIN classes c ON c.id=s.class_id
       WHERE s.student_id=$1 ORDER BY s.at DESC`, [req.user.id])).rows
      .map(r => ({ id: r.id, score: r.score, max: r.max, at: Number(r.at), attempt: r.attempt,
                   testTitle: r.test_title, className: r.class_name, classId: r.class_id,
                   pct: r.max ? Math.round(r.score / r.max * 100) : 0 }));
    const byClass = {};
    all.forEach(s => {
      if (!byClass[s.classId]) byClass[s.classId] = { name: s.className, count: 0, sumPct: 0, best: 0, worst: 100 };
      byClass[s.classId].count++;
      byClass[s.classId].sumPct += s.pct;
      if (s.pct > byClass[s.classId].best) byClass[s.classId].best = s.pct;
      if (s.pct < byClass[s.classId].worst) byClass[s.classId].worst = s.pct;
    });
    const classStats = Object.values(byClass).map(c => ({
      name: c.name, count: c.count, avgPct: Math.round(c.sumPct / c.count), best: c.best, worst: c.worst
    }));
    res.json({ classesCount: cR, submissionsCount: sR.n, avgPercent: Math.round(sR.avg),
      totalScore: sR.ts, totalMax: sR.tm, booksCount, recent, all, classStats });
  } catch (e) { res.status(500).json({ error: 'Ошибка' }); }
});

app.get('/api/admin/logs', auth, adminOnly, async (req, res) => {
  try{
    const limit = Math.min(500, parseInt(req.query.limit) || 200);
    const r = await pool.query('SELECT * FROM action_logs ORDER BY at DESC LIMIT $1', [limit]);
    res.json({ logs: r.rows.map(l => ({ id: l.id, userId: l.user_id, userName: l.user_name,
      action: l.action, details: l.details, at: Number(l.at) })) });
  }catch(e){ res.status(500).json({ error: 'Ошибка' }); }
});

app.get('/api/admin/users', auth, adminOnly, async (req, res) => {
  try {
    const q = (req.query.q || '').toString().trim().toLowerCase();
    const role = req.query.role || '';
    let sql = 'SELECT * FROM users';
    const args = [];
    const conds = [];
    if (role) { conds.push('role=$' + (args.length + 1)); args.push(role); }
    if (q) {
      conds.push('(LOWER(name) LIKE $' + (args.length + 1) + ' OR LOWER(email) LIKE $' + (args.length + 1) + ')');
      args.push('%' + q + '%');
    }
    if (conds.length) sql += ' WHERE ' + conds.join(' AND ');
    sql += ' ORDER BY created_at DESC LIMIT 500';
    const rows = (await pool.query(sql, args)).rows;
    const users = [];
    for (const u of rows) {
      const stats = (await pool.query(
        `SELECT
          (SELECT COUNT(*)::int FROM classes WHERE teacher_id=$1) AS classes_created,
          (SELECT COUNT(*)::int FROM class_students WHERE student_id=$1) AS classes_joined,
          (SELECT COUNT(*)::int FROM submissions WHERE student_id=$1) AS submissions,
          (SELECT COUNT(*)::int FROM books WHERE owner_id=$1) AS books`, [u.id])).rows[0];
      users.push({ id: u.id, name: u.name, email: u.email, role: u.role,
                   hasAvatar: !!u.avatar_key, createdAt: Number(u.created_at), stats });
    }
    const stats = {
      total: (await pool.query('SELECT COUNT(*)::int AS n FROM users')).rows[0].n,
      admin: (await pool.query("SELECT COUNT(*)::int AS n FROM users WHERE role='admin'")).rows[0].n,
      teacher: (await pool.query("SELECT COUNT(*)::int AS n FROM users WHERE role='teacher'")).rows[0].n,
      student: (await pool.query("SELECT COUNT(*)::int AS n FROM users WHERE role='student'")).rows[0].n,
      librarian: (await pool.query("SELECT COUNT(*)::int AS n FROM users WHERE role='librarian'")).rows[0].n,
      tests: (await pool.query('SELECT COUNT(*)::int AS n FROM tests')).rows[0].n,
      books: (await pool.query('SELECT COUNT(*)::int AS n FROM books')).rows[0].n
    };
    res.json({ users, stats });
  } catch (e) { res.status(500).json({ error: 'Ошибка' }); }
});

app.post('/api/admin/users/:id/role', auth, adminOnly, async (req, res) => {
  try {
    const { role } = req.body || {};
    if (!['admin', 'teacher', 'student', 'librarian'].includes(role))
      return res.status(400).json({ error: 'Неверная роль' });
    if (req.params.id === req.user.id) return res.status(400).json({ error: 'Нельзя менять свою роль' });
    await pool.query('UPDATE users SET role=$1 WHERE id=$2', [role, req.params.id]);
    const target = await getUserById(req.params.id);
    await logAction(req.user.id, req.user.name, 'Сменил роль', (target ? target.name : req.params.id) + ' → ' + role);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Ошибка' }); }
});

app.post('/api/admin/users/:id/reset-password', auth, adminOnly, async (req, res) => {
  try {
    const newPass = crypto.randomBytes(4).toString('hex');
    await pool.query('UPDATE users SET pass=$1 WHERE id=$2', [await bcrypt.hash(newPass, 10), req.params.id]);
    const target = await getUserById(req.params.id);
    await logAction(req.user.id, req.user.name, 'Сбросил пароль', target ? target.name + ' (' + target.email + ')' : req.params.id);
    res.json({ password: newPass });
  } catch (e) { res.status(500).json({ error: 'Ошибка' }); }
});

app.delete('/api/admin/users/:id', auth, adminOnly, async (req, res) => {
  try {
    if (req.params.id === req.user.id) return res.status(400).json({ error: 'Нельзя удалить себя' });
    const u = await getUserById(req.params.id);
    if (!u) return res.status(404).json({ error: 'Не найден' });
    if (u.avatar_key) await s3Del(u.avatar_key);
    await pool.query('DELETE FROM users WHERE id=$1', [u.id]);
    await pool.query('DELETE FROM class_students WHERE student_id=$1', [u.id]);
    await pool.query('DELETE FROM group_students WHERE student_id=$1', [u.id]);
    await pool.query('DELETE FROM notifications WHERE user_id=$1', [u.id]);
    await pool.query('DELETE FROM bookmarks WHERE user_id=$1', [u.id]);
    await logAction(req.user.id, req.user.name, 'Удалил пользователя', u.name + ' (' + u.email + ')');
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Ошибка' }); }
});

app.get('/api/admin/backups', auth, adminOnly, async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM backups ORDER BY created_at DESC LIMIT 20');
    res.json({ backups: r.rows.map(b => ({ id: b.id, key: b.key, size: Number(b.size) || 0,
      auto: b.auto, createdAt: Number(b.created_at) })) });
  } catch (e) { res.status(500).json({ error: 'Ошибка' }); }
});

app.post('/api/admin/backups/create', auth, adminOnly, async (req, res) => {
  try {
    const r = await createBackup(false);
    await logAction(req.user.id, req.user.name, 'Создал бэкап', r.key);
    res.json({ ok: true, key: r.key, size: r.size });
  } catch (e) { res.status(500).json({ error: 'Ошибка: ' + e.message }); }
});

app.get('/api/admin/backups/:id/download', auth, adminOnly, async (req, res) => {
  try {
    const b = (await pool.query('SELECT * FROM backups WHERE id=$1', [req.params.id])).rows[0];
    if (!b) return res.status(404).json({ error: 'Бэкап не найден' });
    const { buffer, contentType } = await s3GetBuffer(b.key);
    res.setHeader('Content-Type', contentType || 'application/json');
    res.setHeader('Content-Disposition', 'attachment; filename="' + path.basename(b.key) + '"');
    res.send(buffer);
  } catch (e) { res.status(500).json({ error: 'Ошибка' }); }
});

app.delete('/api/admin/backups/:id', auth, adminOnly, async (req, res) => {
  try {
    const b = (await pool.query('SELECT * FROM backups WHERE id=$1', [req.params.id])).rows[0];
    if (!b) return res.status(404).json({ error: 'Не найден' });
    await s3Del(b.key);
    await pool.query('DELETE FROM backups WHERE id=$1', [b.id]);
    await logAction(req.user.id, req.user.name, 'Удалил бэкап', b.key);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Ошибка' }); }
});

app.get('/favicon.ico', (req, res) => res.status(204).end());
app.get(/^\/(?!api\/).*/, (req, res, next) => {
  if (req.path.includes('.')) return next();
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});
app.use((err, req, res, next) => {
  console.error('❌', err.message);
  if (res.headersSent) return;
  res.status(500).json({ error: 'Внутренняя ошибка' });
});

(async () => {
  try { await initDB(); console.log('✅ Схема БД готова'); }
  catch (e) { console.error('❌ БД:', e.message); process.exit(1); }

  if (s3) {
    try {
      const probeKey = 'healthcheck/probe_' + Date.now() + '.txt';
      await s3Put(probeKey, Buffer.from('ok'), 'text/plain');
      await s3Del(probeKey);
      console.log('✅ B2 проверен');
    } catch (e) {
      console.error('❌ B2 self-test:', e.message);
    }
  }

  app.listen(PORT, () => {
    console.log('═══════════════════════════════════');
    console.log('✅ MathTest v3.1 (PDF-библиотека)');
    console.log('🌐 Порт: ' + PORT);
    console.log('📦 B2: ' + (s3 ? s3Endpoint : '❌'));
    console.log('📚 Библиотека: PDF + обложка');
    console.log('🤖 Telegram: ' + (bot ? 'вкл' : 'выкл'));
    console.log('═══════════════════════════════════');
  });
})();
