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
const B2_REGION = process.env.B2_REGION || 'us-west-004';

if (!DATABASE_URL) { console.error('❌ Нет DATABASE_URL'); process.exit(1); }
if (!B2_KEY_ID || !B2_APP_KEY || !B2_BUCKET || !B2_ENDPOINT) {
  console.warn('⚠️  B2 не настроен — файлы не будут загружаться');
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false }
});

let s3 = null;
if (B2_KEY_ID && B2_APP_KEY && B2_ENDPOINT) {
  s3 = new S3Client({
    endpoint: B2_ENDPOINT,
    region: B2_REGION,
    credentials: { accessKeyId: B2_KEY_ID, secretAccessKey: B2_APP_KEY },
    forcePathStyle: true
  });
}

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });
const uploadSmall = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

const uid  = () => Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6);
const code = () => {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = ''; for (let i = 0; i < 6; i++) s += abc[Math.floor(Math.random() * abc.length)];
  return s;
};

/* ---------- S3 helpers ---------- */
async function s3Put(key, buffer, contentType) {
  if (!s3) throw new Error('S3 не настроен');
  await s3.send(new PutObjectCommand({
    Bucket: B2_BUCKET, Key: key, Body: buffer, ContentType: contentType
  }));
  return key;
}
async function s3Get(key) {
  if (!s3) throw new Error('S3 не настроен');
  const r = await s3.send(new GetObjectCommand({ Bucket: B2_BUCKET, Key: key }));
  const chunks = [];
  for await (const c of r.Body) chunks.push(c);
  return { buffer: Buffer.concat(chunks), contentType: r.ContentType };
}
async function s3Del(key) {
  if (!s3 || !key) return;
  try { await s3.send(new DeleteObjectCommand({ Bucket: B2_BUCKET, Key: key })); } catch (e) {}
}

/* ---------- БД ---------- */
async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      pass TEXT NOT NULL,
      role TEXT NOT NULL,
      avatar_key TEXT,
      telegram_chat_id BIGINT,
      telegram_username TEXT,
      link_code TEXT UNIQUE,
      created_at BIGINT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS classes (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      code TEXT UNIQUE NOT NULL,
      teacher_id TEXT NOT NULL,
      created_at BIGINT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS class_students (
      class_id TEXT NOT NULL,
      student_id TEXT NOT NULL,
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
      created_at BIGINT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS submissions (
      id TEXT PRIMARY KEY, test_id TEXT NOT NULL, student_id TEXT NOT NULL,
      student_name TEXT NOT NULL, class_id TEXT NOT NULL,
      score REAL NOT NULL, max REAL NOT NULL, results JSONB NOT NULL,
      attempt INT NOT NULL DEFAULT 1, started_at BIGINT, at BIGINT NOT NULL,
      duration_ms BIGINT, expired BOOLEAN DEFAULT FALSE, seen BOOLEAN DEFAULT FALSE
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
      file_key TEXT, file_name TEXT, file_type TEXT, file_size BIGINT,
      cover_key TEXT,
      created_at BIGINT NOT NULL
    );
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
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      user_name TEXT NOT NULL,
      action TEXT NOT NULL,
      details TEXT,
      at BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_logs_at ON action_logs(at DESC);
  `);
}

/* ---------- Хелперы ---------- */
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

/* ---------- Telegram ---------- */
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
        bot.sendMessage(chatId,
          'Привет! Это бот MathTest.\nОткрой приложение → ⚙️ Профиль → «Подключить Telegram».');
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

/* ---------- Notify ---------- */
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

/* ---------- Express ---------- */
const app = express();
// Логи действий
async function logAction(userId, userName, action, details) {
  try {
    await pool.query(
      `INSERT INTO action_logs (id, user_id, user_name, action, details, at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [uid(), userId, userName, action, details || null, Date.now()]);
    // Чистим старые — оставляем 1000 последних
    await pool.query(
      `DELETE FROM action_logs WHERE id IN (
         SELECT id FROM action_logs ORDER BY at DESC OFFSET 1000
       )`);
  } catch (e) { /* тихо */ }
}
app.use(express.json({ limit: '2mb' }));
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

/* =========================================================
   AUTH
   ========================================================= */
app.post('/api/auth/register', async (req, res) => {
  try {
    const { name, email, password, role } = req.body || {};
    const validRoles = ['teacher', 'student', 'librarian'];
    if (!name || !email || !password || !validRoles.includes(role))
      return res.status(400).json({ error: 'Заполните все поля' });
    if (password.length < 6)
      return res.status(400).json({ error: 'Пароль от 6 символов' });
    const e = email.toLowerCase().trim();
    if (await getUserByEmail(e)) return res.status(409).json({ error: 'Email занят' });

    let finalRole = role;
    if (process.env.ADMIN_EMAIL && e === process.env.ADMIN_EMAIL.toLowerCase().trim())
      finalRole = 'admin';

    const id = uid();
    await pool.query(
      `INSERT INTO users (id,name,email,pass,role,link_code,created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [id, name.trim(), e, await bcrypt.hash(password, 10), finalRole, uid() + uid(), Date.now()]);
    const token = jwt.sign({ id, role: finalRole, name: name.trim() }, SECRET, { expiresIn: '30d' });
    res.json({ token, user: { id, name: name.trim(), role: finalRole } });
  } catch (err) {
    console.error('register:', err.message);
    res.status(500).json({ error: 'Ошибка' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    const u = await getUserByEmail((email || '').toLowerCase().trim());
    if (!u || !(await bcrypt.compare(password || '', u.pass)))
      return res.status(401).json({ error: 'Неверный email или пароль' });

    // Автоповышение до админа, если email совпадает с ADMIN_EMAIL
    let role = u.role;
    if (process.env.ADMIN_EMAIL &&
        u.email.toLowerCase().trim() === process.env.ADMIN_EMAIL.toLowerCase().trim() &&
        u.role !== 'admin') {
      await pool.query("UPDATE users SET role='admin' WHERE id=$1", [u.id]);
      role = 'admin';
      console.log('👑 Пользователь ' + u.email + ' повышен до администратора');
    }

    const token = jwt.sign({ id: u.id, role: role, name: u.name }, SECRET, { expiresIn: '30d' });
    res.json({ token, user: { id: u.id, name: u.name, role: role } });
  } catch (err) {
    console.error('login error:', err.message);
    res.status(500).json({ error: 'Ошибка' });
  }
});

app.get('/api/auth/me', auth, async (req, res) => {
  const u = await getUserById(req.user.id);
  if (!u) return res.status(401).json({ error: 'Войдите заново' });
  res.json({ user: userToJSON(u) });
});

/* =========================================================
   TELEGRAM LOGIN
   ========================================================= */
app.get('/api/telegram/bot-info', async (req, res) => {
  if (!bot) return res.json({ username: null });
  try { const me = await bot.getMe(); res.json({ username: me.username }); }
  catch { res.json({ username: null }); }
});
app.post('/api/auth/telegram', async (req, res) => {
  try {
    if (!TG_TOKEN) return res.status(400).json({ error: 'Telegram не настроен' });
    const data = req.body || {};
    if (!data.id || !data.hash || !data.auth_date)
      return res.status(400).json({ error: 'Некорректные данные' });
    const age = Math.floor(Date.now() / 1000) - Number(data.auth_date);
    if (age > 86400) return res.status(400).json({ error: 'Ссылка устарела' });

    const pairs = Object.keys(data).filter(k => k !== 'hash')
      .map(k => k + '=' + data[k]).sort().join('\n');
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
        const name = [data.first_name, data.last_name].filter(Boolean).join(' ')
                     || data.username || ('tg_' + tgId);
        await pool.query(
          `INSERT INTO users (id,name,email,pass,role,telegram_chat_id,telegram_username,link_code,created_at)
           VALUES ($1,$2,$3,$4,'student',$5,$6,$7,$8)`,
          [id, name, email, 'tg_no_password', tgId,
           data.username ? '@' + data.username : null, uid() + uid(), Date.now()]);
        user = await getUserById(id);
      }
    }
    const token = jwt.sign({ id: user.id, role: user.role, name: user.name }, SECRET, { expiresIn: '30d' });
    res.json({ token, user: { id: user.id, name: user.name, role: user.role } });
  } catch (e) { res.status(500).json({ error: 'Ошибка' }); }
});

/* =========================================================
   GOOGLE LOGIN
   ========================================================= */
app.post('/api/auth/google', async (req, res) => {
  try {
    const { credential } = req.body || {};
    if (!credential) return res.status(400).json({ error: 'Нет токена' });
    const ticket = await googleClient.verifyIdToken({
      idToken: credential, audience: process.env.GOOGLE_CLIENT_ID
    });
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
  } catch (e) { console.error('google:', e.message); res.status(500).json({ error: 'Ошибка' }); }
});

/* =========================================================
   ПРОФИЛЬ
   ========================================================= */
app.patch('/api/users/me', auth, async (req, res) => {
  try {
    const { name, email, password } = req.body || {};
    const u = await getUserById(req.user.id);
    if (!u) return res.status(401).json({ error: 'Войдите заново' });

    if (name && name.trim()) {
      await pool.query('UPDATE users SET name=$1 WHERE id=$2', [name.trim(), u.id]);
    }
    if (email && email.trim()) {
      const e = email.toLowerCase().trim();
      if (e !== u.email) {
        if (await getUserByEmail(e)) return res.status(409).json({ error: 'Email занят' });
        await pool.query('UPDATE users SET email=$1 WHERE id=$2', [e, u.id]);
      }
    }
    if (password && password.length >= 6) {
      await pool.query('UPDATE users SET pass=$1 WHERE id=$2',
        [await bcrypt.hash(password, 10), u.id]);
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
    // сжимаем до 400x400
    const buf = await sharp(req.file.buffer)
      .resize(400, 400, { fit: 'cover' })
      .jpeg({ quality: 85 })
      .toBuffer();

    const key = 'avatars/' + u.id + '_' + Date.now() + '.jpg';
    // удалить старый
    if (u.avatar_key) await s3Del(u.avatar_key);
    await s3Put(key, buf, 'image/jpeg');
    await pool.query('UPDATE users SET avatar_key=$1 WHERE id=$2', [key, u.id]);
    res.json({ ok: true, hasAvatar: true });
  } catch (e) { console.error('avatar:', e.message); res.status(500).json({ error: 'Ошибка' }); }
});

app.get('/api/users/:id/avatar', async (req, res) => {
  try {
    const u = await getUserById(req.params.id);
    if (!u || !u.avatar_key) {
      // отдаём прозрачный 1x1 PNG
      const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
      res.setHeader('Content-Type', 'image/png');
      return res.send(png);
    }
    const { buffer, contentType } = await s3Get(u.avatar_key);
    res.setHeader('Content-Type', contentType || 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400');
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

/* =========================================================
   КЛАССЫ
   ========================================================= */
app.get('/api/classes', auth, async (req, res) => {
  try {
    let rows;
    if (req.user.role === 'admin') {
      rows = (await pool.query('SELECT * FROM classes ORDER BY created_at DESC')).rows;
    } else if (req.user.role === 'teacher') {
      rows = (await pool.query('SELECT * FROM classes WHERE teacher_id=$1', [req.user.id])).rows;
    } else if (req.user.role === 'student') {
      rows = (await pool.query(
        `SELECT c.* FROM classes c JOIN class_students cs ON cs.class_id=c.id
         WHERE cs.student_id=$1`, [req.user.id])).rows;
    } else { rows = []; }

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
  } catch (e) { console.error(e); res.status(500).json({ error: 'Ошибка' }); }
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
    await pool.query('INSERT INTO class_students (class_id, student_id) VALUES ($1,$2)',
      [c.id, req.user.id]);
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
    await pool.query('DELETE FROM class_students WHERE class_id=$1 AND student_id=$2',
      [req.params.id, req.user.id]);
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
    if (!(await canSeeClass(req.user.id, req.user.role, c.id)))
      return res.status(403).json({ error: 'Нет доступа' });

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
  } catch (e) { console.error(e); res.status(500).json({ error: 'Ошибка' }); }
});

app.delete('/api/classes/:id/students/:sid', auth, teacherOnly, async (req, res) => {
  try {
    const c = await getClassById(req.params.id);
    if (!c || (req.user.role !== 'admin' && c.teacher_id !== req.user.id))
      return res.status(403).json({ error: 'Нет доступа' });
    await pool.query('DELETE FROM class_students WHERE class_id=$1 AND student_id=$2',
      [c.id, req.params.sid]);
    await pool.query(
      `DELETE FROM group_students WHERE student_id=$1 AND group_id IN
       (SELECT id FROM groups WHERE class_id=$2)`, [req.params.sid, c.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Ошибка' }); }
});

/* ---------- Группы ---------- */
app.post('/api/classes/:id/groups', auth, teacherOnly, async (req, res) => {
  const c = await getClassById(req.params.id);
  if (!c || (req.user.role !== 'admin' && c.teacher_id !== req.user.id))
    return res.status(403).json({ error: 'Нет доступа' });
  const { name } = req.body || {};
  if (!name) return res.status(400).json({ error: 'Введите название' });
  const id = uid();
  await pool.query('INSERT INTO groups (id,class_id,name) VALUES ($1,$2,$3)',
    [id, c.id, name.trim()]);
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
  await pool.query(
    'INSERT INTO group_students (group_id,student_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
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

/* ---------- Рассылка ---------- */
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

/* =========================================================
   ЧАТ КЛАССА
   ========================================================= */
app.get('/api/classes/:id/messages', auth, async (req, res) => {
  try {
    const c = await getClassById(req.params.id);
    if (!c) return res.status(404).json({ error: 'Класс не найден' });
    if (!(await canSeeClass(req.user.id, req.user.role, c.id)))
      return res.status(403).json({ error: 'Нет доступа' });

    const before = Number(req.query.before) || Date.now() + 1;
    const limit = 50;
    const r = await pool.query(
      `SELECT m.*, u.avatar_key
       FROM messages m JOIN users u ON u.id=m.user_id
       WHERE m.class_id=$1 AND m.created_at < $2
       ORDER BY m.created_at DESC LIMIT $3`,
      [c.id, before, limit]);

    const msgs = r.rows.reverse().map(m => ({
      id: m.id,
      userId: m.user_id,
      userName: m.user_name,
      hasAvatar: !!m.avatar_key,
      text: m.text,
      fileName: m.file_name,
      fileType: m.file_type,
      fileSize: Number(m.file_size) || 0,
      hasFile: !!m.file_key,
      createdAt: Number(m.created_at),
      own: m.user_id === req.user.id
    }));
    res.json({ messages: msgs });
  } catch (e) { console.error('messages:', e.message); res.status(500).json({ error: 'Ошибка' }); }
});

app.post('/api/classes/:id/messages', auth, uploadSmall.single('file'), async (req, res) => {
  try {
    const c = await getClassById(req.params.id);
    if (!c) return res.status(404).json({ error: 'Класс не найден' });
    if (!(await canSeeClass(req.user.id, req.user.role, c.id)))
      return res.status(403).json({ error: 'Нет доступа' });

    const text = (req.body.text || '').trim();
    let fileKey = null, fileName = null, fileType = null, fileSize = 0;

    if (req.file) {
      if (!s3) return res.status(400).json({ error: 'Хранилище не настроено' });
      const key = 'chat/' + c.id + '/' + uid() + '_' + req.file.originalname.replace(/[^\w.-]/g, '_');
      await s3Put(key, req.file.buffer, req.file.mimetype);
      fileKey = key;
      fileName = req.file.originalname;
      fileType = req.file.mimetype;
      fileSize = req.file.size;
    }
    if (!text && !fileKey) return res.status(400).json({ error: 'Пустое сообщение' });

    const id = uid();
    await pool.query(
      `INSERT INTO messages (id,class_id,user_id,user_name,text,file_key,file_name,file_type,file_size,created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [id, c.id, req.user.id, req.user.name, text || null,
       fileKey, fileName, fileType, fileSize, Date.now()]);

    // ограничение: не более 50 вложений в классе
    const cnt = await pool.query(
      'SELECT COUNT(*)::int AS n FROM messages WHERE class_id=$1 AND file_key IS NOT NULL', [c.id]);
    if (cnt.rows[0].n > 50) {
      const old = await pool.query(
        `SELECT id,file_key FROM messages WHERE class_id=$1 AND file_key IS NOT NULL
         ORDER BY created_at ASC LIMIT $2`,
        [c.id, cnt.rows[0].n - 50]);
      for (const m of old.rows) {
        await s3Del(m.file_key);
        await pool.query('UPDATE messages SET file_key=NULL WHERE id=$1', [m.id]);
      }
    }

    res.json({ id });
  } catch (e) { console.error('msg post:', e.message); res.status(500).json({ error: 'Ошибка' }); }
});

app.get('/api/messages/:id/file', auth, async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM messages WHERE id=$1', [req.params.id]);
    const m = r.rows[0];
    if (!m || !m.file_key) return res.status(404).json({ error: 'Файл не найден' });
    if (!(await canSeeClass(req.user.id, req.user.role, m.class_id)))
      return res.status(403).json({ error: 'Нет доступа' });
    const { buffer, contentType } = await s3Get(m.file_key);
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
    // удалять может только автор
    if (m.user_id !== req.user.id)
      return res.status(403).json({ error: 'Можно удалять только свои сообщения' });
    if (m.file_key) await s3Del(m.file_key);
    await pool.query('DELETE FROM messages WHERE id=$1', [m.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Ошибка' }); }
});

/* =========================================================
   КНИГИ
   ========================================================= */
app.get('/api/books', auth, async (req, res) => {
  try {
    const search = (req.query.q || '').toString().trim().toLowerCase();
    const filterClass = req.query.classId || '';
    const sort = req.query.sort || 'new';
    const orderMap = { new: 'created_at DESC', title: 'title ASC', author: 'author ASC NULLS LAST' };
    const order = orderMap[sort] || 'created_at DESC';

    let rows;
    if (req.user.role === 'admin' || req.user.role === 'librarian') {
      rows = (await pool.query(`SELECT * FROM books ORDER BY ${order}`)).rows;
    } else if (req.user.role === 'teacher') {
      rows = (await pool.query(`SELECT * FROM books WHERE owner_id=$1 ORDER BY ${order}`,
        [req.user.id])).rows;
    } else {
      const myCids = await getClassIdsForStudent(req.user.id);
      rows = (await pool.query(
        `SELECT * FROM books WHERE class_ids = '[]'::jsonb OR class_ids ?| $1::text[]
         ORDER BY ${order}`, [myCids])).rows;
    }

    let books = rows.map(b => ({
      id: b.id, title: b.title, author: b.author, subject: b.subject,
      description: b.description, classIds: b.class_ids || [],
      fileName: b.file_name, fileType: b.file_type, fileSize: Number(b.file_size) || 0,
      hasCover: !!b.cover_key,
      ownerId: b.owner_id,
      createdAt: Number(b.created_at)
    }));

    // фильтр поиска
    if (search) {
      books = books.filter(b =>
        (b.title || '').toLowerCase().includes(search) ||
        (b.author || '').toLowerCase().includes(search) ||
        (b.subject || '').toLowerCase().includes(search) ||
        (b.description || '').toLowerCase().includes(search));
    }
    // фильтр по классу
    if (filterClass) {
      books = books.filter(b => b.classIds.includes(filterClass));
    }
    // имена владельцев
    for (const b of books) {
      const u = await getUserById(b.ownerId);
      b.ownerName = u ? u.name : '—';
    }
    res.json({ books });
  } catch (e) { console.error('books:', e.message); res.status(500).json({ error: 'Ошибка' }); }
});

app.post('/api/books', auth, canUploadBooks, upload.single('file'), async (req, res) => {
  try {
    const { title, author, subject, description, classIds } = req.body;
    if (!title || !title.trim()) return res.status(400).json({ error: 'Введите название' });
    let parsedCids = [];
    try { parsedCids = classIds ? JSON.parse(classIds) : []; } catch (e) {}

    let fileKey = null, fileName = null, fileType = null, fileSize = 0;
    if (req.file) {
      if (!s3) return res.status(400).json({ error: 'Хранилище не настроено' });
      const key = 'books/' + uid() + '_' + req.file.originalname.replace(/[^\w.-]/g, '_');
      await s3Put(key, req.file.buffer, req.file.mimetype);
      fileKey = key;
      fileName = req.file.originalname;
      fileType = req.file.mimetype;
      fileSize = req.file.size;
    }

    const id = uid();
    await pool.query(
      `INSERT INTO books (id,owner_id,title,author,subject,description,class_ids,
                          file_key,file_name,file_type,file_size,created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [id, req.user.id, title.trim(),
       author ? author.trim() : null, subject ? subject.trim() : null,
       description ? description.trim() : null, JSON.stringify(parsedCids),
       fileKey, fileName, fileType, fileSize, Date.now()]);

    for (const cid of parsedCids) {
      const studs = await getStudentsInClass(cid);
      for (const s of studs) {
        await notify(s.id, 'new_book', 'Новая книга',
          '«' + title.trim() + '» добавлена в библиотеку', { bookId: id });
      }
    }
    res.json({ id });
  } catch (e) { console.error('book post:', e.message); res.status(500).json({ error: 'Ошибка' }); }
});

app.get('/api/books/:id/download', auth, async (req, res) => {
  try {
    const b = (await pool.query('SELECT * FROM books WHERE id=$1', [req.params.id])).rows[0];
    if (!b || !b.file_key) return res.status(404).json({ error: 'Файл не найден' });
    const isOwner = b.owner_id === req.user.id;
    const isPriv = ['admin', 'librarian'].includes(req.user.role);
    if (!isOwner && !isPriv) {
      const myCids = await getClassIdsForStudent(req.user.id);
      const cids = b.class_ids || [];
      if (cids.length > 0 && !cids.some(id => myCids.includes(id)))
        return res.status(403).json({ error: 'Нет доступа' });
    }
    const { buffer, contentType } = await s3Get(b.file_key);
    res.setHeader('Content-Type', contentType || 'application/octet-stream');
    res.setHeader('Content-Disposition', 'inline; filename="' + encodeURIComponent(b.file_name || 'book') + '"');
    res.send(buffer);
  } catch (e) { console.error(e); res.status(500).json({ error: 'Ошибка' }); }
});

app.delete('/api/books/:id', auth, async (req, res) => {
  try {
    const b = (await pool.query('SELECT * FROM books WHERE id=$1', [req.params.id])).rows[0];
    if (!b) return res.status(404).json({ error: 'Не найдена' });
    if (req.user.role !== 'admin' && b.owner_id !== req.user.id)
      return res.status(403).json({ error: 'Нет доступа' });
    if (b.file_key) await s3Del(b.file_key);
    if (b.cover_key) await s3Del(b.cover_key);
    await pool.query('DELETE FROM books WHERE id=$1', [b.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Ошибка' }); }
});

/* =========================================================
   РАБОТЫ
   ========================================================= */
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
        settings: normSettings(t.settings), unseen: t.unseen
      })) });
    }
    // student
    const myCids = await getClassIdsForStudent(req.user.id);
    if (!myCids.length) return res.json({ tests: [] });
    const r = await pool.query('SELECT * FROM tests WHERE class_ids ?| $1::text[]', [myCids]);
    const out = [];
    for (const t of r.rows) {
      if (!(await studentSeesTest(req.user.id, t))) continue;
      const subsR = await pool.query(
        'SELECT * FROM submissions WHERE test_id=$1 AND student_id=$2 ORDER BY at DESC',
        [t.id, req.user.id]);
      const last = subsR.rows[0];
      out.push({
        id: t.id, title: t.title,
        tasks: t.tasks.map(x => {
          const c = { id: x.id, type: x.type, statement: x.statement, points: x.points };
          if (x.type === 'choice') c.options = x.options;
          return c;
        }),
        classIds: (t.class_ids || []).filter(id => myCids.includes(id)),
        settings: normSettings(t.settings),
        attemptsUsed: subsR.rows.length,
        mySubmission: last ? { score: last.score, max: last.max, at: Number(last.at) } : null
      });
    }
    res.json({ tests: out });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Ошибка' }); }
});

app.post('/api/tests', auth, teacherOnly, async (req, res) => {
  try {
    const { title, tasks, classIds, groupIds, settings } = req.body || {};
    if (!title || !Array.isArray(tasks) || !tasks.length)
      return res.status(400).json({ error: 'Нужно название и задания' });
    const id = uid();
    await pool.query(
      `INSERT INTO tests (id,owner_id,title,tasks,class_ids,group_ids,settings,created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [id, req.user.id, title.trim(), JSON.stringify(tasks),
       JSON.stringify(classIds || []), JSON.stringify(groupIds || []),
       JSON.stringify(normSettings(settings)), Date.now()]);
    const cids = classIds || [];
    const recipients = new Set();
    for (const cid of cids) {
      const studs = await getStudentsInClass(cid);
      studs.forEach(s => recipients.add(s.id));
      for (const s of studs) {
        if (s.telegram_chat_id) {
          tgSend(Number(s.telegram_chat_id),
            '📝 Новая работа: *' + title.trim() + '*\n\nЗаданий: ' + tasks.length + '\n' + BASE_URL,
            { parse_mode: 'Markdown' });
        }
      }
    }
    for (const sid of recipients) {
      await notify(sid, 'new_test', 'Новая работа',
        'Учитель назначил «' + title.trim() + '»', { testId: id });
    }
    res.json({ id });
  } catch (e) { res.status(500).json({ error: 'Ошибка' }); }
});

app.put('/api/tests/:id', auth, teacherOnly, async (req, res) => {
  try {
    const t = (await pool.query('SELECT * FROM tests WHERE id=$1', [req.params.id])).rows[0];
    if (!t || (req.user.role !== 'admin' && t.owner_id !== req.user.id))
      return res.status(403).json({ error: 'Нет доступа' });
    const { title, tasks, classIds, groupIds, settings } = req.body || {};
    await pool.query(
      `UPDATE tests SET title=$1,tasks=$2,class_ids=$3,group_ids=$4,settings=$5 WHERE id=$6`,
      [title, JSON.stringify(tasks), JSON.stringify(classIds || []),
       JSON.stringify(groupIds || []), JSON.stringify(normSettings(settings)), t.id]);
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
      `INSERT INTO tests (id,owner_id,title,tasks,class_ids,group_ids,settings,created_at)
       VALUES ($1,$2,$3,$4,'[]','[]',$5,$6)`,
      [id, req.user.id, t.title + ' (копия)', JSON.stringify(t.tasks),
       JSON.stringify(normSettings(t.settings)), Date.now()]);
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
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Ошибка' }); }
});

/* =========================================================
   СДАЧА + проверка
   ========================================================= */
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
    if (!(await studentSeesTest(req.user.id, t)))
      return res.status(403).json({ error: 'Работа не для вас' });
    const myCids = await getClassIdsForStudent(req.user.id);
    const classId = (t.class_ids || []).find(id => myCids.includes(id));
    if (!classId) return res.status(403).json({ error: 'Класс не найден' });

    const settings = normSettings(t.settings);
    const cnt = (await pool.query(
      'SELECT COUNT(*)::int AS n FROM submissions WHERE test_id=$1 AND student_id=$2',
      [t.id, req.user.id])).rows[0].n;
    if (settings.attempts > 0 && cnt >= settings.attempts)
      return res.status(400).json({ error: 'Лимит попыток' });

    const startedAt = Number(req.body.startedAt) || Date.now();
    const durationMs = Date.now() - startedAt;
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
                                attempt,started_at,at,duration_ms,expired,seen)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,false)`,
      [subId, t.id, req.user.id, req.user.name, classId, score, max,
       JSON.stringify(results), cnt + 1, startedAt, Date.now(), durationMs, expired]);

    const pct = max ? Math.round(score / max * 100) : 0;
    await notify(t.owner_id, 'submission', 'Новая сдача: ' + req.user.name,
      '«' + t.title + '» — ' + score + '/' + max + ' (' + pct + '%)',
      { testId: t.id, submissionId: subId });

    const teacher = await getUserById(t.owner_id);
    if (teacher && teacher.telegram_chat_id) {
      tgSend(Number(teacher.telegram_chat_id),
        '📥 *' + req.user.name + '* сдал «' + t.title + '»\n' + score + '/' + max + ' (' + pct + '%)',
        { parse_mode: 'Markdown' });
    }
    const resultsFull = results.map((r, i) => {
      const task = tasks[i];
      const out = { ok: r.ok, studentText: r.studentText };
      if (settings.showAnswers && !r.ok) {
        if (task.type === 'input') out.correctAnswer = task.answer;
        else out.correctIndex = task.correctIndex;
      }
      return out;
    });
    res.json({ id: subId, score, max, results: resultsFull,
               attempt: cnt + 1, durationMs, expired, settings });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Ошибка' }); }
});

/* =========================================================
   РЕЗУЛЬТАТЫ
   ========================================================= */
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
        `SELECT id,student_id,student_name,score,max,at,attempt,duration_ms,expired
         FROM submissions WHERE test_id=$1 AND class_id=$2 ORDER BY at DESC`, [t.id, cid])).rows
        .map(s => ({ id: s.id, studentId: s.student_id, studentName: s.student_name,
                     score: s.score, max: s.max, at: Number(s.at), attempt: s.attempt,
                     durationMs: Number(s.duration_ms), expired: s.expired }));
      const submittedIds = new Set(subs.map(s => s.studentId));
      let all = await getStudentsInClass(cid);
      if (groupIds.length > 0) {
        const inG = new Set();
        const gg = await getGroupsForClass(cid);
        gg.forEach(g => { if (groupIds.includes(g.id)) g.studentIds.forEach(id => inG.add(id)); });
        all = all.filter(s => inG.has(s.id));
      }
      const notSubmitted = all.filter(s => !submittedIds.has(s.id))
        .map(s => ({ id: s.id, name: s.name }));
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
    res.json({ groups, analytics: perTask, settings: normSettings(t.settings) });
  } catch (e) { res.status(500).json({ error: 'Ошибка' }); }
});

app.get('/api/tests/:id/export.csv', auth, teacherOnly, async (req, res) => {
  try {
    const t = (await pool.query('SELECT * FROM tests WHERE id=$1', [req.params.id])).rows[0];
    if (!t || (req.user.role !== 'admin' && t.owner_id !== req.user.id))
      return res.status(403).json({ error: 'Нет доступа' });
    const subs = (await pool.query('SELECT * FROM submissions WHERE test_id=$1 ORDER BY at', [t.id])).rows;
    const n = (t.tasks || []).length;
    const headers = ['Ученик','Класс','Дата','Попытка','Балл','Макс','%','Время'];
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
                   s.attempt || 1, s.score, s.max, pct + '%', dur];
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
                    durationMs: Number(s.duration_ms), expired: s.expired },
      test: { id: t.id, title: t.title, tasks }
    });
  } catch (e) { res.status(500).json({ error: 'Ошибка' }); }
});

/* =========================================================
   УВЕДОМЛЕНИЯ
   ========================================================= */
app.get('/api/notifications', auth, async (req, res) => {
  const r = await pool.query(
    `SELECT id,type,title,text,link,read,at FROM notifications
     WHERE user_id=$1 ORDER BY at DESC LIMIT 50`, [req.user.id]);
  const list = r.rows.map(n => ({ id: n.id, type: n.type, title: n.title, text: n.text,
    link: n.link, read: n.read, at: Number(n.at) }));
  res.json({ notifications: list, unread: list.filter(n => !n.read).length });
});
app.post('/api/notifications/read-all', auth, async (req, res) => {
  await pool.query('UPDATE notifications SET read=true WHERE user_id=$1', [req.user.id]);
  res.json({ ok: true });
});
app.post('/api/notifications/:id/read', auth, async (req, res) => {
  await pool.query('UPDATE notifications SET read=true WHERE id=$1 AND user_id=$2',
    [req.params.id, req.user.id]);
  res.json({ ok: true });
});

/* =========================================================
   ПРОФИЛЬ/СТАТИСТИКА
   ========================================================= */
app.get('/api/profile/teacher', auth, async (req, res) => {
  try {
    const isAdmin = req.user.role === 'admin';
    const where = isAdmin ? '' : 'WHERE teacher_id=$1';
    const args = isAdmin ? [] : [req.user.id];

    const classesCount = (await pool.query(
      `SELECT COUNT(*)::int AS n FROM classes ${where}`, args)).rows[0].n;
    const studentsCount = (await pool.query(
      `SELECT COUNT(DISTINCT cs.student_id)::int AS n
       FROM class_students cs JOIN classes c ON c.id=cs.class_id
       ${isAdmin ? '' : 'WHERE c.teacher_id=$1'}`, args)).rows[0].n;
    const testsCount = (await pool.query(
      `SELECT COUNT(*)::int AS n FROM tests ${isAdmin ? '' : 'WHERE owner_id=$1'}`, args)).rows[0].n;
    const booksCount = (await pool.query(
      `SELECT COUNT(*)::int AS n FROM books ${isAdmin ? '' : 'WHERE owner_id=$1'}`, args)).rows[0].n;
    const subR = (await pool.query(
      `SELECT COUNT(*)::int AS n,
              COALESCE(AVG(CASE WHEN s.max>0 THEN s.score*100.0/s.max END),0)::float AS avg
       FROM submissions s JOIN tests t ON t.id=s.test_id
       ${isAdmin ? '' : 'WHERE t.owner_id=$1'}`, args)).rows[0];

    const recent = (await pool.query(
      `SELECT s.id,s.student_name,s.score,s.max,s.at,t.title AS test_title
       FROM submissions s JOIN tests t ON t.id=s.test_id
       ${isAdmin ? '' : 'WHERE t.owner_id=$1'}
       ORDER BY s.at DESC LIMIT 5`, args)).rows
      .map(r => ({ id: r.id, studentName: r.student_name, score: r.score,
                   max: r.max, at: Number(r.at), testTitle: r.test_title }));

    res.json({
      classesCount, studentsCount, testsCount, booksCount,
      submissionsCount: subR.n, avgPercent: Math.round(subR.avg),
      recent
    });
  } catch (e) { res.status(500).json({ error: 'Ошибка' }); }
});

app.get('/api/profile/student', auth, async (req, res) => {
  try {
    const cR = (await pool.query(
      'SELECT COUNT(*)::int AS n FROM class_students WHERE student_id=$1', [req.user.id])).rows[0].n;
    const sR = (await pool.query(
      `SELECT COUNT(*)::int AS n,
              COALESCE(AVG(CASE WHEN max>0 THEN score*100.0/max END),0)::float AS avg,
              COALESCE(SUM(score),0)::int AS ts,
              COALESCE(SUM(max),0)::int AS tm
       FROM submissions WHERE student_id=$1`, [req.user.id])).rows[0];

    const recent = (await pool.query(
      `SELECT s.id,s.score,s.max,s.at,t.title AS test_title
       FROM submissions s JOIN tests t ON t.id=s.test_id
       WHERE s.student_id=$1 ORDER BY s.at DESC LIMIT 5`, [req.user.id])).rows
      .map(r => ({ id: r.id, score: r.score, max: r.max, at: Number(r.at), testTitle: r.test_title }));

    const myCids = await getClassIdsForStudent(req.user.id);
    const booksCount = (await pool.query(
      `SELECT COUNT(*)::int AS n FROM books
       WHERE class_ids = '[]'::jsonb OR class_ids ?| $1::text[]`, [myCids])).rows[0].n;

    // полный прогресс
    const all = (await pool.query(
      `SELECT s.id,s.score,s.max,s.at,s.attempt,t.title AS test_title,c.name AS class_name,s.class_id
       FROM submissions s
       JOIN tests t ON t.id=s.test_id
       JOIN classes c ON c.id=s.class_id
       WHERE s.student_id=$1 ORDER BY s.at DESC`, [req.user.id])).rows
      .map(r => ({ id: r.id, score: r.score, max: r.max, at: Number(r.at),
                   attempt: r.attempt, testTitle: r.test_title,
                   className: r.class_name, classId: r.class_id,
                   pct: r.max ? Math.round(r.score / r.max * 100) : 0 }));

    // разбивка по классам
    const byClass = {};
    all.forEach(s => {
      if (!byClass[s.classId]) byClass[s.classId] = { name: s.className, count: 0, sumPct: 0, best: 0, worst: 100 };
      byClass[s.classId].count++;
      byClass[s.classId].sumPct += s.pct;
      if (s.pct > byClass[s.classId].best) byClass[s.classId].best = s.pct;
      if (s.pct < byClass[s.classId].worst) byClass[s.classId].worst = s.pct;
    });
    const classStats = Object.values(byClass).map(c => ({
      name: c.name, count: c.count,
      avgPct: Math.round(c.sumPct / c.count),
      best: c.best, worst: c.worst
    }));

    res.json({
      classesCount: cR, submissionsCount: sR.n,
      avgPercent: Math.round(sR.avg), totalScore: sR.ts, totalMax: sR.tm,
      booksCount, recent, all, classStats
    });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Ошибка' }); }
});

/* =========================================================
   АДМИН
   ========================================================= */
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
          (SELECT COUNT(*)::int FROM books WHERE owner_id=$1) AS books`,
        [u.id])).rows[0];
      users.push({
        id: u.id, name: u.name, email: u.email, role: u.role,
        hasAvatar: !!u.avatar_key,
        createdAt: Number(u.created_at),
        stats
      });
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
  } catch (e) { console.error('admin users:', e.message); res.status(500).json({ error: 'Ошибка' }); }
});

app.post('/api/admin/users/:id/role', auth, adminOnly, async (req, res) => {
  try {
    const { role } = req.body || {};
    if (!['admin', 'teacher', 'student', 'librarian'].includes(role))
      return res.status(400).json({ error: 'Неверная роль' });
    if (req.params.id === req.user.id)
      return res.status(400).json({ error: 'Нельзя менять свою роль' });
    await pool.query('UPDATE users SET role=$1 WHERE id=$2', [role, req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Ошибка' }); }
});

app.post('/api/admin/users/:id/reset-password', auth, adminOnly, async (req, res) => {
  try {
    const newPass = crypto.randomBytes(4).toString('hex'); // 8 символов
    await pool.query('UPDATE users SET pass=$1 WHERE id=$2',
      [await bcrypt.hash(newPass, 10), req.params.id]);
    res.json({ password: newPass });
  } catch (e) { res.status(500).json({ error: 'Ошибка' }); }
});

app.delete('/api/admin/users/:id', auth, adminOnly, async (req, res) => {
  try {
    if (req.params.id === req.user.id)
      return res.status(400).json({ error: 'Нельзя удалить себя' });
    const u = await getUserById(req.params.id);
    if (!u) return res.status(404).json({ error: 'Не найден' });
    // удалить данные
    if (u.avatar_key) await s3Del(u.avatar_key);
    await pool.query('DELETE FROM users WHERE id=$1', [u.id]);
    await pool.query('DELETE FROM class_students WHERE student_id=$1', [u.id]);
    await pool.query('DELETE FROM group_students WHERE student_id=$1', [u.id]);
    await pool.query('DELETE FROM notifications WHERE user_id=$1', [u.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Ошибка' }); }
});

/* =========================================================
   FALLBACK + LISTEN
   ========================================================= */
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
  app.listen(PORT, () => {
    console.log('═══════════════════════════════════');
    console.log('✅ MathTest v2 запущен');
    console.log('🌐 Порт: ' + PORT);
    console.log('🗄️  БД: PostgreSQL');
    console.log('📦 Файлы: ' + (s3 ? 'Backblaze B2' : '❌ не настроены'));
    console.log('🤖 Telegram: ' + (bot ? 'вкл' : 'выкл'));
    console.log('═══════════════════════════════════');
  });
})();
