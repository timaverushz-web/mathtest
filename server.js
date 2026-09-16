const express = require('express');
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const path    = require('path');
const crypto  = require('crypto');
const { Pool } = require('pg');

const SECRET    = process.env.JWT_SECRET || 'dev-secret-change-me';
const PORT      = process.env.PORT || 3000;
const TG_TOKEN  = process.env.TELEGRAM_BOT_TOKEN || '';
const BASE_URL  = process.env.BASE_URL || ('http://localhost:' + PORT);
const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error('❌ Не задана переменная DATABASE_URL. Добавьте её в Environment.');
  process.exit(1);
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false }
});

const uid  = () => Math.random().toString(36).slice(2, 10);
const code = () => {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = ''; for (let i = 0; i < 6; i++) s += abc[Math.floor(Math.random() * abc.length)];
  return s;
};

/* ---------- Инициализация схемы ---------- */
async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      pass TEXT NOT NULL,
      role TEXT NOT NULL,
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
      id TEXT PRIMARY KEY,
      class_id TEXT NOT NULL,
      name TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS group_students (
      group_id TEXT NOT NULL,
      student_id TEXT NOT NULL,
      PRIMARY KEY (group_id, student_id)
    );
    CREATE TABLE IF NOT EXISTS tests (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      title TEXT NOT NULL,
      tasks JSONB NOT NULL,
      class_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
      group_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
      settings JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at BIGINT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS submissions (
      id TEXT PRIMARY KEY,
      test_id TEXT NOT NULL,
      student_id TEXT NOT NULL,
      student_name TEXT NOT NULL,
      class_id TEXT NOT NULL,
      score REAL NOT NULL,
      max REAL NOT NULL,
      results JSONB NOT NULL,
      attempt INT NOT NULL DEFAULT 1,
      started_at BIGINT,
      at BIGINT NOT NULL,
      duration_ms BIGINT,
      expired BOOLEAN DEFAULT FALSE,
      seen BOOLEAN DEFAULT FALSE
    );
    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      text TEXT NOT NULL,
      link JSONB,
      read BOOLEAN DEFAULT FALSE,
      at BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_subs_test ON submissions(test_id);
    CREATE INDEX IF NOT EXISTS idx_subs_student ON submissions(student_id);
    CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id);
    CREATE INDEX IF NOT EXISTS idx_tests_owner ON tests(owner_id);
    CREATE INDEX IF NOT EXISTS idx_cs_student ON class_students(student_id);
    CREATE INDEX IF NOT EXISTS idx_gs_student ON group_students(student_id);
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
    telegram: u.telegram_chat_id ? { chatId: Number(u.telegram_chat_id), username: u.telegram_username } : null
  };
}

async function getClassIdsForStudent(studentId) {
  const r = await pool.query('SELECT class_id FROM class_students WHERE student_id=$1', [studentId]);
  return r.rows.map(x => x.class_id);
}
async function getGroupIdsForStudent(studentId) {
  const r = await pool.query('SELECT group_id FROM group_students WHERE student_id=$1', [studentId]);
  return r.rows.map(x => x.group_id);
}
async function getClassById(id) {
  const r = await pool.query('SELECT * FROM classes WHERE id=$1', [id]);
  return r.rows[0] || null;
}
async function getGroupsForClass(classId) {
  const r = await pool.query('SELECT * FROM groups WHERE class_id=$1', [classId]);
  const groups = r.rows;
  if (!groups.length) return [];
  const ids = groups.map(g => g.id);
  const rs = await pool.query('SELECT group_id, student_id FROM group_students WHERE group_id = ANY($1)', [ids]);
  const byGroup = {};
  rs.rows.forEach(r => {
    (byGroup[r.group_id] = byGroup[r.group_id] || []).push(r.student_id);
  });
  return groups.map(g => ({
    id: g.id, name: g.name,
    studentIds: byGroup[g.id] || []
  }));
}
async function getStudentsInClass(classId) {
  const r = await pool.query(
    `SELECT u.id, u.name, u.email, u.telegram_chat_id
     FROM class_students cs JOIN users u ON u.id = cs.student_id
     WHERE cs.class_id=$1`, [classId]);
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
  if (v.includes(',') || v.includes('"') || v.includes('\n'))
    return '"' + v.replace(/"/g, '""') + '"';
  return v;
}

async function studentSeesTest(studentId, test) {
  const myCids = await getClassIdsForStudent(studentId);
  const classIds = test.class_ids || [];
  if (!classIds.some(id => myCids.includes(id))) return false;
  const gids = test.group_ids || [];
  if (gids.length > 0) {
    const myGids = await getGroupIdsForStudent(studentId);
    if (!gids.some(id => myGids.includes(id))) return false;
  }
  return true;
}

/* ---------- Telegram-бот ---------- */
let bot = null;
if (TG_TOKEN) {
  try {
    const TelegramBot = require('node-telegram-bot-api');
    bot = new TelegramBot(TG_TOKEN, { polling: true });

    bot.on('polling_error', (err) => {
      if (!err.message.includes('409')) console.error('Telegram polling error:', err.message);
    });

    bot.onText(/\/start(.*)/, async (msg, match) => {
      const chatId   = msg.chat.id;
      const username = msg.from.username ? '@' + msg.from.username : (msg.from.first_name || 'друг');
      const payload  = (match[1] || '').trim();

      try {
        if (payload) {
          const u = await getUserByLinkCode(payload);
          if (u) {
            await pool.query(
              'UPDATE users SET telegram_chat_id=$1, telegram_username=$2 WHERE id=$3',
              [chatId, username, u.id]);
            bot.sendMessage(chatId,
              '✅ ' + u.name + ', Telegram привязан.\n\nТеперь вы будете получать уведомления от MathTest.');
            return;
          }
        }
        bot.sendMessage(chatId,
          'Привет, ' + username + '! 👋\n\n' +
          'Это бот MathTest. Чтобы привязать его к аккаунту, ' +
          'откройте приложение → ⚙️ Профиль → «Подключить Telegram».');
      } catch (e) {
        console.error('Ошибка /start:', e.message);
      }
    });

    bot.onText(/\/stop/, async (msg) => {
      const chatId = msg.chat.id;
      try {
        const u = await getUserByChatId(chatId);
        if (u) {
          await pool.query('UPDATE users SET telegram_chat_id=NULL, telegram_username=NULL WHERE id=$1', [u.id]);
          bot.sendMessage(chatId, '🔕 Уведомления отключены.');
        } else {
          bot.sendMessage(chatId, 'Вы и так не были подписаны.');
        }
      } catch (e) { console.error(e); }
    });

    console.log('✅ Telegram bot started (polling)');
  } catch (e) {
    console.error('❌ Не удалось запустить Telegram-бота:', e.message);
  }
} else {
  console.log('ℹ️  Telegram не настроен (нет TELEGRAM_BOT_TOKEN)');
}

function tgSend(chatId, text, opts) {
  if (!bot || !chatId) return Promise.resolve(false);
  return bot.sendMessage(chatId, text, opts || {})
    .then(() => true)
    .catch(err => { console.error('tgSend error:', err.message); return false; });
}

/* ---------- Уведомления ---------- */
async function notify(userId, type, title, text, link) {
  try {
    await pool.query(
      `INSERT INTO notifications (id, user_id, type, title, text, link, read, at)
       VALUES ($1,$2,$3,$4,$5,$6,false,$7)`,
      [uid(), userId, type, title, text, link ? JSON.stringify(link) : null, Date.now()]);
    await pool.query(
      `DELETE FROM notifications WHERE id IN (
         SELECT id FROM notifications WHERE user_id=$1 ORDER BY at DESC OFFSET 80
       )`, [userId]);
  } catch (e) { console.error('notify error:', e.message); }
}

/* ---------- Express ---------- */
const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

function auth(req, res, next) {
  const h = req.headers.authorization || '';
  const t = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!t) return res.status(401).json({ error: 'Не авторизован' });
  try { req.user = jwt.verify(t, SECRET); next(); }
  catch { res.status(401).json({ error: 'Сессия истекла' }); }
}
function teacherOnly(req, res, next) {
  if (req.user.role !== 'teacher') return res.status(403).json({ error: 'Только для учителя' });
  next();
}

/* =========================================================
   АУТЕНТИФИКАЦИЯ
   ========================================================= */
app.post('/api/auth/register', async (req, res) => {
  try {
    const { name, email, password, role } = req.body || {};
    if (!name || !email || !password || !['teacher', 'student'].includes(role))
      return res.status(400).json({ error: 'Заполните все поля' });
    if (password.length < 6)
      return res.status(400).json({ error: 'Пароль минимум 6 символов' });
    const e = email.toLowerCase().trim();
    const exists = await getUserByEmail(e);
    if (exists) return res.status(409).json({ error: 'Email уже занят' });

    const id = uid();
    const linkCode = uid() + uid();
    await pool.query(
      `INSERT INTO users (id, name, email, pass, role, link_code, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [id, name.trim(), e, await bcrypt.hash(password, 10), role, linkCode, Date.now()]);
    const token = jwt.sign({ id, role, name: name.trim() }, SECRET, { expiresIn: '30d' });
    res.json({ token, user: { id, name: name.trim(), role } });
  } catch (err) {
    console.error('register error:', err.message);
    res.status(500).json({ error: 'Ошибка регистрации' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    const u = await getUserByEmail((email || '').toLowerCase().trim());
    if (!u || !(await bcrypt.compare(password || '', u.pass)))
      return res.status(401).json({ error: 'Неверный email или пароль' });
    if (!u.link_code) {
      const lc = uid() + uid();
      await pool.query('UPDATE users SET link_code=$1 WHERE id=$2', [lc, u.id]);
    }
    const token = jwt.sign({ id: u.id, role: u.role, name: u.name }, SECRET, { expiresIn: '30d' });
    res.json({ token, user: { id: u.id, name: u.name, role: u.role } });
  } catch (err) {
    console.error('login error:', err.message);
    res.status(500).json({ error: 'Ошибка входа' });
  }
});

app.get('/api/auth/me', auth, async (req, res) => {
  const u = await getUserById(req.user.id);
  if (!u) return res.status(401).json({ error: 'Сессия устарела. Войдите заново.' });
  res.json({ user: userToJSON(u) });
});

/* =========================================================
   TELEGRAM LOGIN WIDGET
   ========================================================= */
app.get('/api/telegram/bot-info', async (req, res) => {
  if (!bot) return res.json({ username: null });
  try {
    const me = await bot.getMe();
    res.json({ username: me.username });
  } catch (e) {
    res.json({ username: null });
  }
});

app.post('/api/auth/telegram', async (req, res) => {
  try {
    if (!TG_TOKEN) return res.status(400).json({ error: 'Telegram не настроен' });
    const data = req.body || {};

    if (!data.id || !data.hash || !data.auth_date)
      return res.status(400).json({ error: 'Некорректные данные от Telegram' });

    const age = Math.floor(Date.now() / 1000) - Number(data.auth_date);
    if (age > 86400)
      return res.status(400).json({ error: 'Ссылка авторизации устарела' });

    const checkHash = data.hash;
    const pairs = Object.keys(data)
      .filter(k => k !== 'hash')
      .map(k => k + '=' + data[k])
      .sort()
      .join('\n');

    const secretKey = crypto.createHash('sha256').update(TG_TOKEN).digest();
    const computed = crypto.createHmac('sha256', secretKey)
      .update(pairs).digest('hex');

    if (computed !== checkHash)
      return res.status(401).json({ error: 'Подпись Telegram неверна' });

    const tgId = String(data.id);
    const existing = await pool.query(
      'SELECT * FROM users WHERE telegram_chat_id=$1', [tgId]);
    let user = existing.rows[0];

    if (!user) {
      const email = 'tg_' + tgId + '@telegram.local';
      const byEmail = await getUserByEmail(email);
      if (byEmail) {
        user = byEmail;
      } else {
        const id = uid();
        const name = [data.first_name, data.last_name].filter(Boolean).join(' ')
                     || data.username || ('tg_' + tgId);
        await pool.query(
          `INSERT INTO users (id, name, email, pass, role, telegram_chat_id, telegram_username, link_code, created_at)
           VALUES ($1,$2,$3,$4,'student',$5,$6,$7,$8)`,
          [id, name, email, 'tg_no_password', tgId,
           data.username ? '@' + data.username : null,
           uid() + uid(), Date.now()]);
        user = await getUserById(id);
      }
    }

    if (!user.telegram_chat_id) {
      await pool.query(
        'UPDATE users SET telegram_chat_id=$1, telegram_username=$2 WHERE id=$3',
        [tgId, data.username ? '@' + data.username : null, user.id]);
      user.telegram_chat_id = tgId;
    }

    const token = jwt.sign(
      { id: user.id, role: user.role, name: user.name },
      SECRET, { expiresIn: '30d' });

    res.json({
      token,
      user: { id: user.id, name: user.name, role: user.role }
    });
  } catch (e) {
    console.error('telegram auth error:', e.message);
    res.status(500).json({ error: 'Ошибка авторизации через Telegram' });
  }
});

/* =========================================================
   TELEGRAM (профиль)
   ========================================================= */
app.get('/api/telegram/link', auth, async (req, res) => {
  const u = await getUserById(req.user.id);
  if (!u) return res.status(401).json({ error: 'Сессия устарела. Войдите заново.' });
  if (!bot) return res.status(400).json({ error: 'Telegram-бот не настроен на сервере' });
  try {
    const me = await bot.getMe();
    const link = 'https://t.me/' + me.username + '?start=' + u.link_code;
    res.json({ link, botUsername: me.username, linked: !!u.telegram_chat_id });
  } catch (e) {
    res.status(500).json({ error: 'Не удалось получить данные бота' });
  }
});

app.post('/api/telegram/unlink', auth, async (req, res) => {
  const u = await getUserById(req.user.id);
  if (!u) return res.status(401).json({ error: 'Сессия устарела. Войдите заново.' });
  await pool.query('UPDATE users SET telegram_chat_id=NULL, telegram_username=NULL WHERE id=$1', [u.id]);
  res.json({ ok: true });
});

/* =========================================================
   КЛАССЫ
   ========================================================= */
app.get('/api/classes', auth, async (req, res) => {
  try {
    let rows;
    if (req.user.role === 'teacher') {
      const r = await pool.query('SELECT * FROM classes WHERE teacher_id=$1', [req.user.id]);
      rows = r.rows;
    } else {
      const r = await pool.query(
        `SELECT c.* FROM classes c
         JOIN class_students cs ON cs.class_id = c.id
         WHERE cs.student_id=$1`, [req.user.id]);
      rows = r.rows;
    }
    const enriched = [];
    for (const c of rows) {
      const teacher = await getUserById(c.teacher_id);
      const countR = await pool.query('SELECT COUNT(*)::int AS n FROM class_students WHERE class_id=$1', [c.id]);
      const studentCount = countR.rows[0].n;
      let groups;
      if (req.user.role === 'teacher') {
        const gr = await pool.query(
          `SELECT g.id, g.name, COUNT(gs.student_id)::int AS count
           FROM groups g LEFT JOIN group_students gs ON gs.group_id = g.id
           WHERE g.class_id=$1 GROUP BY g.id, g.name`, [c.id]);
        groups = gr.rows.map(x => ({ id: x.id, name: x.name, count: x.count }));
      } else {
        const gr = await pool.query(
          `SELECT g.id, g.name FROM groups g
           JOIN group_students gs ON gs.group_id = g.id
           WHERE g.class_id=$1 AND gs.student_id=$2`, [c.id, req.user.id]);
        groups = gr.rows;
      }
      enriched.push({
        id: c.id, name: c.name, code: c.code,
        teacherId: c.teacher_id,
        teacherName: teacher ? teacher.name : '—',
        studentCount, groups
      });
    }
    res.json({ classes: enriched });
  } catch (e) {
    console.error('GET /classes:', e.message);
    res.status(500).json({ error: 'Ошибка' });
  }
});

app.post('/api/classes', auth, teacherOnly, async (req, res) => {
  try {
    const { name } = req.body || {};
    if (!name || !name.trim()) return res.status(400).json({ error: 'Введите название' });
    let c;
    let attempt = 0;
    do {
      c = code();
      const ex = await pool.query('SELECT 1 FROM classes WHERE code=$1', [c]);
      if (!ex.rowCount) break;
    } while (++attempt < 20);

    const id = uid();
    await pool.query(
      'INSERT INTO classes (id, name, code, teacher_id, created_at) VALUES ($1,$2,$3,$4,$5)',
      [id, name.trim(), c, req.user.id, Date.now()]);
    res.json({ class: { id, name: name.trim(), code: c, teacherId: req.user.id, studentIds: [], groups: [] } });
  } catch (e) {
    console.error('POST /classes:', e.message);
    res.status(500).json({ error: 'Ошибка' });
  }
});

app.delete('/api/classes/:id', auth, teacherOnly, async (req, res) => {
  try {
    const c = await getClassById(req.params.id);
    if (!c) return res.status(404).json({ error: 'Класс не найден' });
    if (c.teacher_id !== req.user.id) return res.status(403).json({ error: 'Нет доступа' });
    await pool.query('DELETE FROM classes WHERE id=$1', [c.id]);
    await pool.query('DELETE FROM class_students WHERE class_id=$1', [c.id]);
    const gs = await pool.query('SELECT id FROM groups WHERE class_id=$1', [c.id]);
    for (const g of gs.rows) {
      await pool.query('DELETE FROM group_students WHERE group_id=$1', [g.id]);
    }
    await pool.query('DELETE FROM groups WHERE class_id=$1', [c.id]);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Ошибка' });
  }
});

app.post('/api/classes/join', auth, async (req, res) => {
  try {
    const cR = await pool.query('SELECT * FROM classes WHERE code=$1', [(req.body.code || '').toUpperCase().trim()]);
    const c = cR.rows[0];
    if (!c) return res.status(404).json({ error: 'Класс не найден' });
    const ex = await pool.query(
      'SELECT 1 FROM class_students WHERE class_id=$1 AND student_id=$2',
      [c.id, req.user.id]);
    if (ex.rowCount) return res.status(400).json({ error: 'Вы уже в этом классе' });
    await pool.query(
      'INSERT INTO class_students (class_id, student_id) VALUES ($1,$2)',
      [c.id, req.user.id]);
    await notify(c.teacher_id, 'join', 'Новый ученик в классе',
      req.user.name + ' присоединился к «' + c.name + '»', null);

    const teacher = await getUserById(c.teacher_id);
    if (teacher && teacher.telegram_chat_id) {
      tgSend(teacher.telegram_chat_id,
        '👤 *' + req.user.name + '* присоединился к классу «' + c.name + '»',
        { parse_mode: 'Markdown' });
    }
    res.json({ class: { id: c.id, name: c.name } });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Ошибка' });
  }
});

app.post('/api/classes/:id/leave', auth, async (req, res) => {
  try {
    await pool.query('DELETE FROM class_students WHERE class_id=$1 AND student_id=$2',
      [req.params.id, req.user.id]);
    await pool.query(
      `DELETE FROM group_students WHERE student_id=$1 AND group_id IN
       (SELECT id FROM groups WHERE class_id=$2)`,
      [req.user.id, req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Ошибка' }); }
});

app.get('/api/classes/:id', auth, teacherOnly, async (req, res) => {
  try {
    const c = await getClassById(req.params.id);
    if (!c) return res.status(404).json({ error: 'Класс не найден' });
    if (c.teacher_id !== req.user.id) return res.status(403).json({ error: 'Нет доступа' });

    const students = await getStudentsInClass(c.id);
    const groups = await getGroupsForClass(c.id);

    const studentGroupMap = {};
    groups.forEach(g => {
      g.studentIds.forEach(sid => {
        (studentGroupMap[sid] = studentGroupMap[sid] || []).push(g.id);
      });
    });

    const studentsOut = students.map(u => ({
      id: u.id, name: u.name, email: u.email,
      groupIds: studentGroupMap[u.id] || [],
      hasTelegram: !!u.telegram_chat_id
    }));

    const tR = await pool.query(
      `SELECT t.*,
        (SELECT COUNT(*)::int FROM submissions s WHERE s.test_id=t.id AND s.class_id=$1) AS submitted,
        (SELECT COUNT(*)::int FROM submissions s WHERE s.test_id=t.id AND s.class_id=$1 AND s.seen=false) AS unseen
       FROM tests t
       WHERE t.class_ids @> $2::jsonb`,
      [c.id, JSON.stringify([c.id])]);

    const testsOut = tR.rows.map(t => ({
      id: t.id, title: t.title,
      submitted: t.submitted,
      total: students.length,
      unseen: t.unseen,
      groupIds: t.group_ids || []
    }));

    res.json({
      class: { id: c.id, name: c.name, code: c.code, groups },
      students: studentsOut, tests: testsOut
    });
  } catch (e) {
    console.error('GET /classes/:id:', e.message);
    res.status(500).json({ error: 'Ошибка' });
  }
});

app.delete('/api/classes/:id/students/:sid', auth, teacherOnly, async (req, res) => {
  try {
    const c = await getClassById(req.params.id);
    if (!c || c.teacher_id !== req.user.id) return res.status(403).json({ error: 'Нет доступа' });
    await pool.query('DELETE FROM class_students WHERE class_id=$1 AND student_id=$2',
      [c.id, req.params.sid]);
    await pool.query(
      `DELETE FROM group_students WHERE student_id=$1 AND group_id IN
       (SELECT id FROM groups WHERE class_id=$2)`,
      [req.params.sid, c.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Ошибка' }); }
});

/* ---------- Рассылка ---------- */
app.post('/api/classes/:id/broadcast', auth, teacherOnly, async (req, res) => {
  try {
    const c = await getClassById(req.params.id);
    if (!c || c.teacher_id !== req.user.id) return res.status(403).json({ error: 'Нет доступа' });
    if (!bot) return res.status(400).json({ error: 'Telegram-бот не настроен' });
    const { message } = req.body || {};
    if (!message || !message.trim())
      return res.status(400).json({ error: 'Введите текст сообщения' });

    const recipients = await getStudentsInClass(c.id);
    const withTg = recipients.filter(u => u.telegram_chat_id);
    const withoutTg = recipients.filter(u => !u.telegram_chat_id);
    const header = '📢 *' + c.name + '* · сообщение от учителя:\n\n' + message;
    let sent = 0, failed = 0;
    for (const u of withTg) {
      const ok = await tgSend(Number(u.telegram_chat_id), header, { parse_mode: 'Markdown' });
      if (ok) sent++; else failed++;
    }
    res.json({
      total: recipients.length, sent, failed,
      withoutTelegram: withoutTg.length,
      withoutTelegramNames: withoutTg.map(u => u.name)
    });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Ошибка' }); }
});

/* ---------- Группы ---------- */
app.post('/api/classes/:id/groups', auth, teacherOnly, async (req, res) => {
  try {
    const c = await getClassById(req.params.id);
    if (!c || c.teacher_id !== req.user.id) return res.status(403).json({ error: 'Нет доступа' });
    const { name } = req.body || {};
    if (!name || !name.trim()) return res.status(400).json({ error: 'Введите название группы' });
    const id = uid();
    await pool.query('INSERT INTO groups (id, class_id, name) VALUES ($1,$2,$3)',
      [id, c.id, name.trim()]);
    res.json({ group: { id, name: name.trim(), studentIds: [] } });
  } catch (e) { res.status(500).json({ error: 'Ошибка' }); }
});
app.delete('/api/classes/:id/groups/:gid', auth, teacherOnly, async (req, res) => {
  try {
    const c = await getClassById(req.params.id);
    if (!c || c.teacher_id !== req.user.id) return res.status(403).json({ error: 'Нет доступа' });
    await pool.query('DELETE FROM group_students WHERE group_id=$1', [req.params.gid]);
    await pool.query('DELETE FROM groups WHERE id=$1 AND class_id=$2', [req.params.gid, c.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Ошибка' }); }
});
app.post('/api/classes/:id/groups/:gid/students/:sid', auth, teacherOnly, async (req, res) => {
  try {
    const c = await getClassById(req.params.id);
    if (!c || c.teacher_id !== req.user.id) return res.status(403).json({ error: 'Нет доступа' });
    const g = await pool.query('SELECT * FROM groups WHERE id=$1 AND class_id=$2', [req.params.gid, c.id]);
    if (!g.rowCount) return res.status(404).json({ error: 'Группа не найдена' });
    const inClass = await pool.query(
      'SELECT 1 FROM class_students WHERE class_id=$1 AND student_id=$2',
      [c.id, req.params.sid]);
    if (!inClass.rowCount) return res.status(400).json({ error: 'Ученик не в классе' });
    await pool.query(
      'INSERT INTO group_students (group_id, student_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
      [req.params.gid, req.params.sid]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Ошибка' }); }
});
app.delete('/api/classes/:id/groups/:gid/students/:sid', auth, teacherOnly, async (req, res) => {
  try {
    const c = await getClassById(req.params.id);
    if (!c || c.teacher_id !== req.user.id) return res.status(403).json({ error: 'Нет доступа' });
    await pool.query('DELETE FROM group_students WHERE group_id=$1 AND student_id=$2',
      [req.params.gid, req.params.sid]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Ошибка' }); }
});

/* =========================================================
   РАБОТЫ
   ========================================================= */
app.get('/api/tests', auth, async (req, res) => {
  try {
    if (req.user.role === 'teacher') {
      const r = await pool.query(
        `SELECT t.*,
          (SELECT COUNT(*)::int FROM submissions s WHERE s.test_id=t.id AND s.seen=false) AS unseen
         FROM tests t WHERE t.owner_id=$1 ORDER BY t.created_at DESC`,
        [req.user.id]);
      const list = r.rows.map(t => ({
        id: t.id, title: t.title, tasks: t.tasks,
        classIds: t.class_ids || [],
        groupIds: t.group_ids || [],
        settings: normSettings(t.settings),
        unseen: t.unseen
      }));
      return res.json({ tests: list });
    }

    const myCids = await getClassIdsForStudent(req.user.id);
    if (!myCids.length) return res.json({ tests: [] });
    const r = await pool.query(
      'SELECT * FROM tests WHERE class_ids ?| $1::text[]',
      [myCids]);
    const out = [];
    for (const t of r.rows) {
      const visible = await studentSeesTest(req.user.id, t);
      if (!visible) continue;
      const subsR = await pool.query(
        `SELECT * FROM submissions WHERE test_id=$1 AND student_id=$2 ORDER BY at DESC`,
        [t.id, req.user.id]);
      const mySubs = subsR.rows;
      const lastSub = mySubs[0];
      const tasks = (t.tasks || []).map(x => {
        const c = { id: x.id, type: x.type, statement: x.statement, points: x.points };
        if (x.type === 'choice') c.options = x.options;
        return c;
      });
      out.push({
        id: t.id, title: t.title, tasks,
        classIds: (t.class_ids || []).filter(id => myCids.includes(id)),
        settings: normSettings(t.settings),
        attemptsUsed: mySubs.length,
        mySubmission: lastSub
          ? { score: lastSub.score, max: lastSub.max, at: Number(lastSub.at) }
          : null
      });
    }
    res.json({ tests: out });
  } catch (e) {
    console.error('GET /tests:', e.message);
    res.status(500).json({ error: 'Ошибка' });
  }
});

app.post('/api/tests', auth, teacherOnly, async (req, res) => {
  try {
    const { title, tasks, classIds, groupIds, settings } = req.body || {};
    if (!title || !Array.isArray(tasks) || !tasks.length)
      return res.status(400).json({ error: 'Нужно название и задания' });
    const id = uid();
    await pool.query(
      `INSERT INTO tests (id, owner_id, title, tasks, class_ids, group_ids, settings, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [id, req.user.id, title.trim(), JSON.stringify(tasks),
       JSON.stringify(classIds || []), JSON.stringify(groupIds || []),
       JSON.stringify(normSettings(settings)), Date.now()]);

    const cids = classIds || [];
    const recipients = new Set();
    for (const cid of cids) {
      const studs = await getStudentsInClass(cid);
      studs.forEach(s => recipients.add(s.id));
    }
    for (const sid of recipients) {
      await notify(sid, 'new_test', 'Новая работа',
        'Учитель назначил «' + title.trim() + '»', { testId: id });
    }
    for (const cid of cids) {
      const studs = await getStudentsInClass(cid);
      for (const s of studs) {
        if (s.telegram_chat_id) {
          tgSend(Number(s.telegram_chat_id),
            '📝 Новая работа: *' + title.trim() + '*\n\nЗаданий: ' + tasks.length +
            '\nОткройте: ' + BASE_URL,
            { parse_mode: 'Markdown' });
        }
      }
    }
    res.json({ id });
  } catch (e) {
    console.error('POST /tests:', e.message);
    res.status(500).json({ error: 'Ошибка' });
  }
});

app.put('/api/tests/:id', auth, teacherOnly, async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM tests WHERE id=$1', [req.params.id]);
    const t = r.rows[0];
    if (!t || t.owner_id !== req.user.id) return res.status(403).json({ error: 'Нет доступа' });
    const { title, tasks, classIds, groupIds, settings } = req.body || {};
    await pool.query(
      `UPDATE tests SET title=$1, tasks=$2, class_ids=$3, group_ids=$4, settings=$5 WHERE id=$6`,
      [title, JSON.stringify(tasks), JSON.stringify(classIds || []),
       JSON.stringify(groupIds || []), JSON.stringify(normSettings(settings)), t.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Ошибка' }); }
});

app.post('/api/tests/:id/duplicate', auth, teacherOnly, async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM tests WHERE id=$1', [req.params.id]);
    const t = r.rows[0];
    if (!t || t.owner_id !== req.user.id) return res.status(403).json({ error: 'Нет доступа' });
    const id = uid();
    await pool.query(
      `INSERT INTO tests (id, owner_id, title, tasks, class_ids, group_ids, settings, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [id, req.user.id, t.title + ' (копия)', JSON.stringify(t.tasks),
       '[]', '[]', JSON.stringify(normSettings(t.settings)), Date.now()]);
    res.json({ id });
  } catch (e) { res.status(500).json({ error: 'Ошибка' }); }
});

app.delete('/api/tests/:id', auth, teacherOnly, async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM tests WHERE id=$1', [req.params.id]);
    const t = r.rows[0];
    if (!t || t.owner_id !== req.user.id) return res.status(403).json({ error: 'Нет доступа' });
    await pool.query('DELETE FROM submissions WHERE test_id=$1', [t.id]);
    await pool.query('DELETE FROM tests WHERE id=$1', [t.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Ошибка' }); }
});

/* =========================================================
   УВЕДОМЛЕНИЯ
   ========================================================= */
app.get('/api/notifications', auth, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT id, type, title, text, link, read, at
       FROM notifications WHERE user_id=$1 ORDER BY at DESC LIMIT 50`,
      [req.user.id]);
    const list = r.rows.map(n => ({
      id: n.id, type: n.type, title: n.title, text: n.text,
      link: n.link, read: n.read, at: Number(n.at)
    }));
    const unread = list.filter(n => !n.read).length;
    res.json({ notifications: list, unread });
  } catch (e) { res.status(500).json({ error: 'Ошибка' }); }
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
   АВТОПРОВЕРКА
   ========================================================= */
let nerdamer = null;
try { nerdamer = require('nerdamer/all'); }
catch (e) { try { nerdamer = require('nerdamer'); } catch (e2) {} }

function norm(s) {
  return String(s || '')
    .replace(/\\left|\\right/g, '')
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
    try {
      if (nerdamer('simplify((' + s + ')-(' + c + '))').toString() === '0') return true;
    } catch (e) {}
    try {
      const a = Number(nerdamer(s).evaluate().text('decimals'));
      const b = Number(nerdamer(c).evaluate().text('decimals'));
      if (isFinite(a) && isFinite(b)) return Math.abs(a - b) <= Math.max(tol, 1e-6);
    } catch (e) {}
  }
  return false;
}

/* =========================================================
   СДАЧА
   ========================================================= */
app.post('/api/tests/:id/submit', auth, async (req, res) => {
  try {
    if (req.user.role !== 'student')
      return res.status(403).json({ error: 'Только для учеников' });
    const tr = await pool.query('SELECT * FROM tests WHERE id=$1', [req.params.id]);
    const t = tr.rows[0];
    if (!t) return res.status(404).json({ error: 'Работа не найдена' });
    if (!(await studentSeesTest(req.user.id, t)))
      return res.status(403).json({ error: 'Работа не для вас' });

    const myCids = await getClassIdsForStudent(req.user.id);
    const classId = (t.class_ids || []).find(id => myCids.includes(id));
    if (!classId) return res.status(403).json({ error: 'Работа не для вашего класса' });

    const settings = normSettings(t.settings);
    const cntR = await pool.query(
      'SELECT COUNT(*)::int AS n FROM submissions WHERE test_id=$1 AND student_id=$2',
      [t.id, req.user.id]);
    const myAttempts = cntR.rows[0].n;

    if (settings.attempts > 0 && myAttempts >= settings.attempts)
      return res.status(400).json({ error: 'Достигнут лимит попыток (' + settings.attempts + ')' });

    const startedAt = Number(req.body.startedAt) || Date.now();
    const durationMs = Date.now() - startedAt;
    const expired = settings.timeLimit > 0 &&
                    durationMs > (settings.timeLimit * 60000) + 30000;

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
    const max   = tasks.reduce((s, x) => s + (x.points || 1), 0);

    const subId = uid();
    await pool.query(
      `INSERT INTO submissions
        (id, test_id, student_id, student_name, class_id, score, max, results,
         attempt, started_at, at, duration_ms, expired, seen)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,false)`,
      [subId, t.id, req.user.id, req.user.name, classId,
       score, max, JSON.stringify(results), myAttempts + 1,
       startedAt, Date.now(), durationMs, expired]);

    const pct = max ? Math.round(score / max * 100) : 0;
    await notify(t.owner_id, 'submission', 'Новая сдача: ' + req.user.name,
      '«' + t.title + '» — ' + score + '/' + max + ' (' + pct + '%)',
      { testId: t.id, submissionId: subId });

    const teacher = await getUserById(t.owner_id);
    if (teacher && teacher.telegram_chat_id) {
      tgSend(Number(teacher.telegram_chat_id),
        '📥 *' + req.user.name + '* сдал работу «' + t.title + '»\n' +
        'Результат: ' + score + '/' + max + ' (' + pct + '%)',
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

    res.json({
      id: subId, score, max, results: resultsFull,
      attempt: myAttempts + 1, durationMs,
      expired, settings
    });
  } catch (e) {
    console.error('submit error:', e.message);
    res.status(500).json({ error: 'Ошибка' });
  }
});

/* =========================================================
   РЕЗУЛЬТАТЫ
   ========================================================= */
app.get('/api/tests/:id/submissions', auth, teacherOnly, async (req, res) => {
  try {
    const tr = await pool.query('SELECT * FROM tests WHERE id=$1', [req.params.id]);
    const t = tr.rows[0];
    if (!t || t.owner_id !== req.user.id) return res.status(403).json({ error: 'Нет доступа' });

    await pool.query('UPDATE submissions SET seen=true WHERE test_id=$1', [t.id]);

    const classIds = t.class_ids || [];
    const groupIds = t.group_ids || [];
    const groups = [];
    for (const cid of classIds) {
      const cls = await getClassById(cid);
      if (!cls) continue;
      const subsR = await pool.query(
        `SELECT id, student_id, student_name, score, max, at, attempt, duration_ms, expired
         FROM submissions WHERE test_id=$1 AND class_id=$2 ORDER BY at DESC`,
        [t.id, cid]);
      const subs = subsR.rows.map(s => ({
        id: s.id, studentId: s.student_id, studentName: s.student_name,
        score: s.score, max: s.max, at: Number(s.at),
        attempt: s.attempt, durationMs: Number(s.duration_ms),
        expired: s.expired
      }));
      const submittedIds = new Set(subs.map(s => s.studentId));
      let allStudents = await getStudentsInClass(cid);
      if (groupIds.length > 0) {
        const inGroups = new Set();
        const gg = await getGroupsForClass(cid);
        gg.forEach(g => {
          if (groupIds.includes(g.id)) g.studentIds.forEach(id => inGroups.add(id));
        });
        allStudents = allStudents.filter(s => inGroups.has(s.id));
      }
      const notSubmitted = allStudents
        .filter(s => !submittedIds.has(s.id))
        .map(s => ({ id: s.id, name: s.name }));
      groups.push({ classId: cid, className: cls.name, submitted: subs, notSubmitted });
    }

    const relR = await pool.query(
      `SELECT results FROM submissions WHERE test_id=$1 AND class_id = ANY($2)`,
      [t.id, classIds]);
    const tasks = t.tasks || [];
    const perTask = tasks.map((task, i) => {
      let correct = 0, total = 0;
      relR.rows.forEach(row => {
        total++;
        if (row.results[i] && row.results[i].ok) correct++;
      });
      return {
        index: i + 1, statement: task.statement,
        points: task.points || 1, correct, total,
        pct: total ? Math.round(correct / total * 100) : 0
      };
    });

    res.json({ groups, analytics: perTask, settings: normSettings(t.settings) });
  } catch (e) {
    console.error('GET submissions:', e.message);
    res.status(500).json({ error: 'Ошибка' });
  }
});

app.get('/api/tests/:id/export.csv', auth, teacherOnly, async (req, res) => {
  try {
    const tr = await pool.query('SELECT * FROM tests WHERE id=$1', [req.params.id]);
    const t = tr.rows[0];
    if (!t || t.owner_id !== req.user.id) return res.status(403).json({ error: 'Нет доступа' });

    const sr = await pool.query('SELECT * FROM submissions WHERE test_id=$1 ORDER BY at', [t.id]);
    const taskCount = (t.tasks || []).length;
    const headers = ['Ученик', 'Класс', 'Дата', 'Попытка', 'Балл', 'Макс', '%', 'Время'];
    for (let i = 1; i <= taskCount; i++) headers.push('Задание ' + i);

    const classNames = {};
    for (const cid of (t.class_ids || [])) {
      const c = await getClassById(cid);
      if (c) classNames[cid] = c.name;
    }

    const rows = sr.rows.map(s => {
      const pct = s.max ? Math.round(s.score / s.max * 100) : 0;
      const dur = s.duration_ms ? Math.round(Number(s.duration_ms) / 1000) + ' с' : '';
      const row = [s.student_name, classNames[s.class_id] || '—',
                   new Date(Number(s.at)).toLocaleString('ru-RU'),
                   s.attempt || 1, s.score, s.max, pct + '%', dur];
      for (let i = 0; i < taskCount; i++) {
        const r = s.results[i];
        row.push(r ? (r.ok ? '✓' : '✗') : '');
      }
      return row;
    });
    const csv = [headers, ...rows].map(r => r.map(escapeCsv).join(',')).join('\r\n');
    const safeTitle = t.title.replace(/[^\p{L}\p{N}\-_]+/gu, '_').slice(0, 40);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="results_' + safeTitle + '.csv"');
    res.send('\uFEFF' + csv);
  } catch (e) { res.status(500).json({ error: 'Ошибка' }); }
});

app.get('/api/submissions/:id', auth, async (req, res) => {
  try {
    const sr = await pool.query('SELECT * FROM submissions WHERE id=$1', [req.params.id]);
    const s = sr.rows[0];
    if (!s) return res.status(404).json({ error: 'Сдача не найдена' });
    const tr = await pool.query('SELECT * FROM tests WHERE id=$1', [s.test_id]);
    const t = tr.rows[0];
    if (!t) return res.status(404).json({ error: 'Работа не найдена' });
    const isTeacher = t.owner_id === req.user.id;
    const isStudent = s.student_id === req.user.id;
    if (!isTeacher && !isStudent) return res.status(403).json({ error: 'Нет доступа' });

    const tasks = (t.tasks || []).map((task, i) => {
      const r = s.results[i] || { ok: false };
      if (isTeacher || r.ok) return task;
      const c = { ...task };
      delete c.answer; delete c.correctIndex;
      return c;
    });
    res.json({
      submission: {
        id: s.id, score: s.score, max: s.max, at: Number(s.at),
        results: s.results, attempt: s.attempt,
        durationMs: Number(s.duration_ms), expired: s.expired
      },
      test: { id: t.id, title: t.title, tasks }
    });
  } catch (e) { res.status(500).json({ error: 'Ошибка' }); }
});

/* ---------- Favicon + SPA fallback + обработчик ошибок ---------- */
app.get('/favicon.ico', (req, res) => res.status(204).end());

app.get(/^\/(?!api\/).*/, (req, res, next) => {
  if (req.path.includes('.')) return next();
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.use((err, req, res, next) => {
  console.error('❌ Ошибка:', err.message);
  if (res.headersSent) return;
  res.status(500).json({ error: 'Внутренняя ошибка сервера' });
});

/* ---------- Старт ---------- */
(async () => {
  try {
    await initDB();
    console.log('✅ Схема БД готова');
  } catch (e) {
    console.error('❌ Ошибка инициализации БД:', e.message);
    process.exit(1);
  }
  app.listen(PORT, () => {
    console.log('═══════════════════════════════════════');
    console.log('✅ MathTest сервер запущен');
    console.log('🌐 Порт: ' + PORT);
    console.log('🗄️  БД: PostgreSQL');
    console.log('🤖 Telegram: ' + (bot ? 'включён' : 'выключен'));
    console.log('═══════════════════════════════════════');
  });
})();
