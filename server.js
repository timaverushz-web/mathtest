const express = require('express');
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const fs      = require('fs');
const path    = require('path');

const DATA_FILE = path.join(__dirname, 'data.json');
const SECRET    = process.env.JWT_SECRET || 'dev-secret-change-me';
const PORT      = process.env.PORT || 3000;
const TG_TOKEN  = process.env.TELEGRAM_BOT_TOKEN || '';
const BASE_URL  = process.env.BASE_URL || 'http://localhost:' + PORT;

/* ---------- Хранилище ---------- */
let db = { users: [], classes: [], tests: [], submissions: [], notifications: [] };
if (fs.existsSync(DATA_FILE)) {
  try {
    const loaded = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    db = Object.assign(db, loaded);
    db.notifications = db.notifications || [];
    (db.classes || []).forEach(c => { c.groups = c.groups || []; });
    (db.users || []).forEach(u => {
      u.telegram = u.telegram || null;
      if (!u.linkCode) u.linkCode = Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10);
    });
  } catch (e) {}
}
function save() { fs.writeFileSync(DATA_FILE, JSON.stringify(db), 'utf8'); }
const uid  = () => Math.random().toString(36).slice(2, 10);
const code = () => {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = ''; for (let i = 0; i < 6; i++) s += abc[Math.floor(Math.random() * abc.length)];
  return s;
};

/* ---------- Telegram-бот ---------- */
let bot = null;
if (TG_TOKEN) {
  try {
    const TelegramBot = require('node-telegram-bot-api');
    bot = new TelegramBot(TG_TOKEN, { polling: true });

    bot.on('polling_error', (err) => {
      console.error('Telegram polling error:', err.message);
    });

    bot.onText(/\/start(.*)/, (msg, match) => {
      const chatId   = msg.chat.id;
      const username = msg.from.username ? '@' + msg.from.username : (msg.from.first_name || 'друг');
      const payload  = (match[1] || '').trim();

      if (payload) {
        const u = db.users.find(x => x.linkCode === payload);
        if (u) {
          u.telegram = { chatId: chatId, username: username, at: Date.now() };
          save();
          bot.sendMessage(chatId,
            '✅ ' + u.name + ', Telegram привязан.\n\n' +
            'Теперь вы будете получать уведомления от MathTest.');
          return;
        }
      }
      bot.sendMessage(chatId,
        'Привет, ' + username + '! 👋\n\n' +
        'Это бот MathTest. Чтобы привязать его к аккаунту, ' +
        'откройте приложение → ⚙️ Профиль → «Подключить Telegram».');
    });

    bot.onText(/\/stop/, (msg) => {
      const chatId = msg.chat.id;
      const u = db.users.find(x => x.telegram && x.telegram.chatId === chatId);
      if (u) {
        u.telegram = null; save();
        bot.sendMessage(chatId, '🔕 Уведомления отключены.');
      } else {
        bot.sendMessage(chatId, 'Вы и так не были подписаны.');
      }
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
    .catch(err => {
      console.error('tgSend error:', err.message);
      return false;
    });
}

/* ---------- Внутренние уведомления ---------- */
function notify(userId, type, title, text, link) {
  db.notifications.push({
    id: uid(), userId, type, title, text,
    link: link || null, read: false, at: Date.now()
  });
  const mine = db.notifications
    .filter(n => n.userId === userId)
    .sort((a, b) => b.at - a.at);
  if (mine.length > 80) {
    const toDrop = new Set(mine.slice(80).map(n => n.id));
    db.notifications = db.notifications.filter(n => !toDrop.has(n.id));
  }
  save();
}

const DEFAULT_SETTINGS = { timeLimit: 0, attempts: 1, showAnswers: true };
function normSettings(s) {
  s = s || {};
  return {
    timeLimit:   Math.max(0, parseInt(s.timeLimit)  || 0),
    attempts:    Math.max(0, parseInt(s.attempts)   || 0),
    showAnswers: s.showAnswers !== false
  };
}

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

/* ---------- Авторизация ---------- */
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
function escapeCsv(v) {
  v = String(v == null ? '' : v);
  if (v.includes(',') || v.includes('"') || v.includes('\n'))
    return '"' + v.replace(/"/g, '""') + '"';
  return v;
}

function myClassIds(studentId) {
  return db.classes.filter(c => c.studentIds.includes(studentId)).map(c => c.id);
}
function myGroupIds(studentId) {
  const out = [];
  db.classes.forEach(c => {
    (c.groups || []).forEach(g => {
      if (g.studentIds.includes(studentId)) out.push(g.id);
    });
  });
  return out;
}
function studentSeesTest(studentId, test) {
  const cids = myClassIds(studentId);
  if (!(test.classIds || []).some(id => cids.includes(id))) return false;
  if (test.groupIds && test.groupIds.length > 0) {
    const gids = myGroupIds(studentId);
    if (!test.groupIds.some(id => gids.includes(id))) return false;
  }
  return true;
}

/* =========================================================
   АУТЕНТИФИКАЦИЯ
   ========================================================= */
app.post('/api/auth/register', async (req, res) => {
  const { name, email, password, role } = req.body || {};
  if (!name || !email || !password || !['teacher', 'student'].includes(role))
    return res.status(400).json({ error: 'Заполните все поля' });
  if (password.length < 6)
    return res.status(400).json({ error: 'Пароль минимум 6 символов' });
  const e = email.toLowerCase().trim();
  if (db.users.some(u => u.email === e))
    return res.status(409).json({ error: 'Email уже занят' });
  const user = {
    id: uid(), name: name.trim(), email: e, role,
    pass: await bcrypt.hash(password, 10),
    telegram: null,
    linkCode: uid() + uid(),
    createdAt: Date.now()
  };
  db.users.push(user); save();
  const token = jwt.sign({ id: user.id, role: user.role, name: user.name }, SECRET, { expiresIn: '30d' });
  res.json({ token, user: { id: user.id, name: user.name, role: user.role } });
});
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body || {};
  const u = db.users.find(x => x.email === (email || '').toLowerCase().trim());
  if (!u || !(await bcrypt.compare(password || '', u.pass)))
    return res.status(401).json({ error: 'Неверный email или пароль' });
  if (!u.linkCode) { u.linkCode = uid() + uid(); save(); }
  const token = jwt.sign({ id: u.id, role: u.role, name: u.name }, SECRET, { expiresIn: '30d' });
  res.json({ token, user: { id: u.id, name: u.name, role: u.role } });
});
app.get('/api/auth/me', auth, (req, res) => {
  const u = db.users.find(x => x.id === req.user.id);
  res.json({ user: {
    id: u.id, name: u.name, role: u.role,
    telegram: u.telegram ? { username: u.telegram.username } : null
  }});
});

/* =========================================================
   TELEGRAM
   ========================================================= */
app.get('/api/telegram/link', auth, (req, res) => {
  const u = db.users.find(x => x.id === req.user.id);
  if (!u) return res.status(404).json({ error: 'Пользователь не найден' });
  if (!bot) return res.status(400).json({ error: 'Telegram-бот не настроен на сервере' });
  bot.getMe().then(me => {
    const link = 'https://t.me/' + me.username + '?start=' + u.linkCode;
    res.json({ link, botUsername: me.username, linked: !!u.telegram });
  }).catch(() => {
    res.status(500).json({ error: 'Не удалось получить данные бота' });
  });
});
app.post('/api/telegram/unlink', auth, (req, res) => {
  const u = db.users.find(x => x.id === req.user.id);
  if (!u) return res.status(404).json({ error: 'Пользователь не найден' });
  u.telegram = null; save();
  res.json({ ok: true });
});

/* =========================================================
   КЛАССЫ
   ========================================================= */
app.get('/api/classes', auth, (req, res) => {
  let list = req.user.role === 'teacher'
    ? db.classes.filter(c => c.teacherId === req.user.id)
    : db.classes.filter(c => c.studentIds.includes(req.user.id));
  const enriched = list.map(c => {
    const teacher = db.users.find(u => u.id === c.teacherId);
    const myGroups = (c.groups || []).filter(g =>
      req.user.role !== 'student' || g.studentIds.includes(req.user.id));
    return {
      id: c.id, name: c.name, code: c.code,
      teacherId: c.teacherId,
      teacherName: teacher ? teacher.name : '—',
      studentCount: c.studentIds.length,
      groups: req.user.role === 'teacher'
        ? (c.groups || []).map(g => ({ id: g.id, name: g.name, count: g.studentIds.length }))
        : myGroups.map(g => ({ id: g.id, name: g.name }))
    };
  });
  res.json({ classes: enriched });
});

app.post('/api/classes', auth, teacherOnly, (req, res) => {
  const { name } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: 'Введите название' });
  let c;
  do { c = code(); } while (db.classes.some(x => x.code === c));
  const cls = { id: uid(), name: name.trim(), code: c,
                teacherId: req.user.id, studentIds: [], groups: [], createdAt: Date.now() };
  db.classes.push(cls); save();
  res.json({ class: cls });
});

app.delete('/api/classes/:id', auth, teacherOnly, (req, res) => {
  const c = db.classes.find(x => x.id === req.params.id);
  if (!c) return res.status(404).json({ error: 'Класс не найден' });
  if (c.teacherId !== req.user.id) return res.status(403).json({ error: 'Нет доступа' });
  db.classes = db.classes.filter(x => x.id !== c.id);
  db.tests.forEach(t => { t.classIds = (t.classIds || []).filter(id => id !== c.id); });
  save();
  res.json({ ok: true });
});

app.post('/api/classes/join', auth, (req, res) => {
  const c = db.classes.find(x => x.code === (req.body.code || '').toUpperCase().trim());
  if (!c) return res.status(404).json({ error: 'Класс не найден' });
  if (c.studentIds.includes(req.user.id))
    return res.status(400).json({ error: 'Вы уже в этом классе' });
  c.studentIds.push(req.user.id); save();
  notify(c.teacherId, 'join', 'Новый ученик в классе',
    req.user.name + ' присоединился к «' + c.name + '»', null);

  const teacher = db.users.find(u => u.id === c.teacherId);
  if (teacher && teacher.telegram && teacher.telegram.chatId) {
    tgSend(teacher.telegram.chatId,
      '👤 *' + req.user.name + '* присоединился к классу «' + c.name + '»',
      { parse_mode: 'Markdown' });
  }
  res.json({ class: { id: c.id, name: c.name } });
});

app.post('/api/classes/:id/leave', auth, (req, res) => {
  const c = db.classes.find(x => x.id === req.params.id);
  if (!c) return res.status(404).json({ error: 'Класс не найден' });
  c.studentIds = c.studentIds.filter(id => id !== req.user.id);
  (c.groups || []).forEach(g => { g.studentIds = g.studentIds.filter(id => id !== req.user.id); });
  save();
  res.json({ ok: true });
});

app.get('/api/classes/:id', auth, teacherOnly, (req, res) => {
  const c = db.classes.find(x => x.id === req.params.id);
  if (!c) return res.status(404).json({ error: 'Класс не найден' });
  if (c.teacherId !== req.user.id) return res.status(403).json({ error: 'Нет доступа' });
  const students = c.studentIds.map(id => {
    const u = db.users.find(x => x.id === id);
    if (!u) return null;
    const groups = (c.groups || []).filter(g => g.studentIds.includes(id)).map(g => g.id);
    return { id: u.id, name: u.name, email: u.email, groupIds: groups,
             hasTelegram: !!(u.telegram && u.telegram.chatId) };
  }).filter(Boolean);
  const classTests = db.tests
    .filter(t => (t.classIds || []).includes(c.id))
    .map(t => {
      const subs = db.submissions.filter(s => s.testId === t.id && s.classId === c.id);
      return {
        id: t.id, title: t.title,
        submitted: subs.length, total: students.length,
        unseen: subs.filter(s => !s.seen).length,
        groupIds: t.groupIds || []
      };
    });
  res.json({
    class: { id: c.id, name: c.name, code: c.code,
             groups: (c.groups || []).map(g => ({
               id: g.id, name: g.name, studentIds: g.studentIds.slice()
             })) },
    students, tests: classTests
  });
});

app.delete('/api/classes/:id/students/:sid', auth, teacherOnly, (req, res) => {
  const c = db.classes.find(x => x.id === req.params.id);
  if (!c || c.teacherId !== req.user.id) return res.status(403).json({ error: 'Нет доступа' });
  c.studentIds = c.studentIds.filter(id => id !== req.params.sid);
  (c.groups || []).forEach(g => {
    g.studentIds = g.studentIds.filter(id => id !== req.params.sid);
  });
  save();
  res.json({ ok: true });
});

/* ---------- Массовая рассылка в Telegram ---------- */
app.post('/api/classes/:id/broadcast', auth, teacherOnly, async (req, res) => {
  const c = db.classes.find(x => x.id === req.params.id);
  if (!c || c.teacherId !== req.user.id)
    return res.status(403).json({ error: 'Нет доступа' });
  if (!bot) return res.status(400).json({ error: 'Telegram-бот не настроен' });

  const { message } = req.body || {};
  if (!message || !message.trim())
    return res.status(400).
