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
  if (!u) return res.status(401).json({ error: 'Сессия устарела. Войдите заново.' });
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
  if (!u) return res.status(401).json({ error: 'Сессия устарела. Войдите заново.' });
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
    return res.status(400).json({ error: 'Введите текст сообщения' });

  const recipients = c.studentIds.map(id => db.users.find(u => u.id === id)).filter(Boolean);
  const withTg = recipients.filter(u => u.telegram && u.telegram.chatId);
  const withoutTg = recipients.filter(u => !u.telegram || !u.telegram.chatId);

  const header = '📢 *' + c.name + '* · сообщение от учителя:\n\n' + message;
  let sent = 0, failed = 0;
  for (const u of withTg) {
    const ok = await tgSend(u.telegram.chatId, header, { parse_mode: 'Markdown' });
    if (ok) sent++; else failed++;
  }
  res.json({
    total: recipients.length, sent, failed,
    withoutTelegram: withoutTg.length,
    withoutTelegramNames: withoutTg.map(u => u.name)
  });
});

/* ---------- Уведомление о новой работе ---------- */
async function notifyClassAboutTest(classId, test) {
  const c = db.classes.find(x => x.id === classId);
  if (!c) return;
  const text = '📝 Новая работа: *' + test.title + '*\n\n' +
    'Заданий: ' + test.tasks.length + '\n' +
    'Откройте приложение, чтобы начать: ' + BASE_URL;
  for (const sid of c.studentIds) {
    const u = db.users.find(x => x.id === sid);
    if (u && u.telegram && u.telegram.chatId) {
      tgSend(u.telegram.chatId, text, { parse_mode: 'Markdown' });
    }
  }
}

/* ---------- Группы ---------- */
app.post('/api/classes/:id/groups', auth, teacherOnly, (req, res) => {
  const c = db.classes.find(x => x.id === req.params.id);
  if (!c || c.teacherId !== req.user.id) return res.status(403).json({ error: 'Нет доступа' });
  const { name } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: 'Введите название группы' });
  c.groups = c.groups || [];
  const g = { id: uid(), name: name.trim(), studentIds: [] };
  c.groups.push(g); save();
  res.json({ group: g });
});
app.delete('/api/classes/:id/groups/:gid', auth, teacherOnly, (req, res) => {
  const c = db.classes.find(x => x.id === req.params.id);
  if (!c || c.teacherId !== req.user.id) return res.status(403).json({ error: 'Нет доступа' });
  c.groups = (c.groups || []).filter(g => g.id !== req.params.gid);
  save();
  res.json({ ok: true });
});
app.post('/api/classes/:id/groups/:gid/students/:sid', auth, teacherOnly, (req, res) => {
  const c = db.classes.find(x => x.id === req.params.id);
  if (!c || c.teacherId !== req.user.id) return res.status(403).json({ error: 'Нет доступа' });
  const g = (c.groups || []).find(x => x.id === req.params.gid);
  if (!g) return res.status(404).json({ error: 'Группа не найдена' });
  if (!c.studentIds.includes(req.params.sid))
    return res.status(400).json({ error: 'Ученик не в классе' });
  if (!g.studentIds.includes(req.params.sid)) g.studentIds.push(req.params.sid);
  save();
  res.json({ ok: true });
});
app.delete('/api/classes/:id/groups/:gid/students/:sid', auth, teacherOnly, (req, res) => {
  const c = db.classes.find(x => x.id === req.params.id);
  if (!c || c.teacherId !== req.user.id) return res.status(403).json({ error: 'Нет доступа' });
  const g = (c.groups || []).find(x => x.id === req.params.gid);
  if (!g) return res.status(404).json({ error: 'Группа не найдена' });
  g.studentIds = g.studentIds.filter(id => id !== req.params.sid);
  save();
  res.json({ ok: true });
});

/* =========================================================
   РАБОТЫ
   ========================================================= */
app.get('/api/tests', auth, (req, res) => {
  let list;
  if (req.user.role === 'teacher') {
    list = db.tests.filter(t => t.ownerId === req.user.id).map(t => ({
      id: t.id, title: t.title, tasks: t.tasks,
      classIds: t.classIds || [],
      groupIds: t.groupIds || [],
      settings: normSettings(t.settings),
      unseen: db.submissions.filter(s => s.testId === t.id && !s.seen).length
    }));
  } else {
    list = db.tests
      .filter(t => studentSeesTest(req.user.id, t))
      .map(t => {
        const mySubs = db.submissions
          .filter(x => x.testId === t.id && x.studentId === req.user.id);
        const lastSub = mySubs.sort((a, b) => b.at - a.at)[0];
        const myCids = myClassIds(req.user.id);
        return {
          id: t.id, title: t.title,
          tasks: t.tasks.map(x => {
            const c = { id: x.id, type: x.type, statement: x.statement, points: x.points };
            if (x.type === 'choice') c.options = x.options;
            return c;
          }),
          classIds: (t.classIds || []).filter(id => myCids.includes(id)),
          settings: normSettings(t.settings),
          attemptsUsed: mySubs.length,
          mySubmission: lastSub
            ? { score: lastSub.score, max: lastSub.max, at: lastSub.at }
            : null
        };
      });
  }
  res.json({ tests: list });
});

app.post('/api/tests', auth, teacherOnly, (req, res) => {
  const { title, tasks, classIds, groupIds, settings } = req.body || {};
  if (!title || !Array.isArray(tasks) || !tasks.length)
    return res.status(400).json({ error: 'Нужно название и задания' });
  const t = {
    id: uid(), ownerId: req.user.id, title: title.trim(),
    tasks, classIds: classIds || [], groupIds: groupIds || [],
    settings: normSettings(settings), createdAt: Date.now()
  };
  db.tests.push(t); save();

  const recipients = db.classes
    .filter(c => (t.classIds || []).includes(c.id))
    .flatMap(c => c.studentIds);
  const unique = [...new Set(recipients)];
  unique.forEach(sid => {
    notify(sid, 'new_test', 'Новая работа',
      'Учитель назначил «' + t.title + '»', { testId: t.id });
  });
  save();

  (t.classIds || []).forEach(cid => notifyClassAboutTest(cid, t));

  res.json({ id: t.id });
});

app.put('/api/tests/:id', auth, teacherOnly, (req, res) => {
  const t = db.tests.find(x => x.id === req.params.id);
  if (!t || t.ownerId !== req.user.id) return res.status(403).json({ error: 'Нет доступа' });
  const { title, tasks, classIds, groupIds, settings } = req.body || {};
  t.title = title; t.tasks = tasks;
  t.classIds = classIds || []; t.groupIds = groupIds || [];
  t.settings = normSettings(settings);
  save();
  res.json({ ok: true });
});

app.post('/api/tests/:id/duplicate', auth, teacherOnly, (req, res) => {
  const t = db.tests.find(x => x.id === req.params.id);
  if (!t || t.ownerId !== req.user.id) return res.status(403).json({ error: 'Нет доступа' });
  const copy = {
    id: uid(), ownerId: req.user.id,
    title: t.title + ' (копия)',
    tasks: JSON.parse(JSON.stringify(t.tasks)),
    classIds: [], groupIds: [],
    settings: normSettings(t.settings),
    createdAt: Date.now()
  };
  db.tests.push(copy); save();
  res.json({ id: copy.id });
});

app.delete('/api/tests/:id', auth, teacherOnly, (req, res) => {
  const t = db.tests.find(x => x.id === req.params.id);
  if (!t || t.ownerId !== req.user.id) return res.status(403).json({ error: 'Нет доступа' });
  db.tests = db.tests.filter(x => x.id !== t.id);
  db.submissions = db.submissions.filter(s => s.testId !== t.id);
  save();
  res.json({ ok: true });
});

/* =========================================================
   УВЕДОМЛЕНИЯ
   ========================================================= */
app.get('/api/notifications', auth, (req, res) => {
  const list = db.notifications
    .filter(n => n.userId === req.user.id)
    .sort((a, b) => b.at - a.at)
    .slice(0, 50);
  const unread = list.filter(n => !n.read).length;
  res.json({ notifications: list, unread });
});
app.post('/api/notifications/read-all', auth, (req, res) => {
  db.notifications.forEach(n => { if (n.userId === req.user.id) n.read = true; });
  save(); res.json({ ok: true });
});
app.post('/api/notifications/:id/read', auth, (req, res) => {
  const n = db.notifications.find(x => x.id === req.params.id && x.userId === req.user.id);
  if (!n) return res.status(404).json({ error: 'Не найдено' });
  n.read = true; save();
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
app.post('/api/tests/:id/submit', auth, (req, res) => {
  if (req.user.role !== 'student')
    return res.status(403).json({ error: 'Только для учеников' });
  const t = db.tests.find(x => x.id === req.params.id);
  if (!t) return res.status(404).json({ error: 'Работа не найдена' });
  if (!studentSeesTest(req.user.id, t))
    return res.status(403).json({ error: 'Работа не для вас' });

  const cids = myClassIds(req.user.id);
  const classId = (t.classIds || []).find(id => cids.includes(id));
  if (!classId) return res.status(403).json({ error: 'Работа не для вашего класса' });

  const settings = normSettings(t.settings);
  const myAttempts = db.submissions
    .filter(s => s.testId === t.id && s.studentId === req.user.id).length;
  if (settings.attempts > 0 && myAttempts >= settings.attempts) {
    return res.status(400).json({ error: 'Достигнут лимит попыток (' + settings.attempts + ')' });
  }

  const startedAt = Number(req.body.startedAt) || Date.now();
  const durationMs = Date.now() - startedAt;
  const expired = settings.timeLimit > 0 &&
                  durationMs > (settings.timeLimit * 60000) + 30000;

  const answers = req.body.answers || [];
  const results = t.tasks.map((task, i) => {
    const a = answers[i] || {};
    if (task.type === 'input') {
      const ok = isCorrect(a.ascii || a.text || '', task.answer, task.tolerance);
      return { ok, studentText: a.text || a.ascii || '' };
    }
    return { ok: Number(a.index) === Number(task.correctIndex), studentText: '' };
  });
  const score = results.reduce((s, r, i) => s + (r.ok ? (t.tasks[i].points || 1) : 0), 0);
  const max   = t.tasks.reduce((s, x) => s + (x.points || 1), 0);

  const sub = {
    id: uid(), testId: t.id, studentId: req.user.id, studentName: req.user.name,
    classId, score, max, results,
    attempt: myAttempts + 1,
    startedAt, at: Date.now(),
    durationMs, expired: !!expired, seen: false
  };
  db.submissions.push(sub);

  const pct = max ? Math.round(score / max * 100) : 0;
  notify(t.ownerId, 'submission', 'Новая сдача: ' + req.user.name,
    '«' + t.title + '» — ' + score + '/' + max + ' (' + pct + '%)',
    { testId: t.id, submissionId: sub.id });

  const teacher = db.users.find(u => u.id === t.ownerId);
  if (teacher && teacher.telegram && teacher.telegram.chatId) {
    tgSend(teacher.telegram.chatId,
      '📥 *' + req.user.name + '* сдал работу «' + t.title + '»\n' +
      'Результат: ' + score + '/' + max + ' (' + pct + '%)',
      { parse_mode: 'Markdown' });
  }
  save();

  const resultsFull = results.map((r, i) => {
    const task = t.tasks[i];
    const out = { ok: r.ok, studentText: r.studentText };
    if (settings.showAnswers && !r.ok) {
      if (task.type === 'input') out.correctAnswer = task.answer;
      else out.correctIndex = task.correctIndex;
    }
    return out;
  });

  res.json({
    id: sub.id, score, max, results: resultsFull,
    attempt: sub.attempt, durationMs, expires: sub.expired,
    expired: sub.expired, settings
  });
});

/* =========================================================
   РЕЗУЛЬТАТЫ
   ========================================================= */
app.get('/api/tests/:id/submissions', auth, teacherOnly, (req, res) => {
  const t = db.tests.find(x => x.id === req.params.id);
  if (!t || t.ownerId !== req.user.id) return res.status(403).json({ error: 'Нет доступа' });

  db.submissions.forEach(s => { if (s.testId === t.id) s.seen = true; });
  save();

  const classIds = t.classIds || [];
  const groups = classIds.map(cid => {
    const cls = db.classes.find(c => c.id === cid);
    if (!cls) return null;
    const subs = db.submissions
      .filter(s => s.testId === t.id && s.classId === cid)
      .sort((a, b) => b.at - a.at)
      .map(s => ({
        id: s.id, studentId: s.studentId, studentName: s.studentName,
        score: s.score, max: s.max, at: s.at,
        attempt: s.attempt, durationMs: s.durationMs, expired: s.expired
      }));
    const submittedIds = new Set(subs.map(s => s.studentId));

    let targetStudentIds = cls.studentIds.slice();
    if (t.groupIds && t.groupIds.length > 0) {
      const inGroups = new Set();
      (cls.groups || []).forEach(g => {
        if (t.groupIds.includes(g.id)) g.studentIds.forEach(id => inGroups.add(id));
      });
      targetStudentIds = targetStudentIds.filter(id => inGroups.has(id));
    }

    const notSubmitted = targetStudentIds
      .filter(sid => !submittedIds.has(sid))
      .map(sid => {
        const u = db.users.find(u => u.id === sid);
        return u ? { id: u.id, name: u.name } : null;
      }).filter(Boolean);

    return { classId: cid, className: cls.name, submitted: subs, notSubmitted };
  }).filter(Boolean);

  const relevantSubs = db.submissions
    .filter(s => s.testId === t.id && classIds.includes(s.classId));
  const perTask = t.tasks.map((task, i) => {
    let correct = 0, total = 0;
    relevantSubs.forEach(s => {
      total++;
      if (s.results[i] && s.results[i].ok) correct++;
    });
    return {
      index: i + 1, statement: task.statement,
      points: task.points || 1, correct, total,
      pct: total ? Math.round(correct / total * 100) : 0
    };
  });

  res.json({ groups, analytics: perTask, settings: normSettings(t.settings) });
});

app.get('/api/tests/:id/export.csv', auth, teacherOnly, (req, res) => {
  const t = db.tests.find(x => x.id === req.params.id);
  if (!t || t.ownerId !== req.user.id)
    return res.status(403).json({ error: 'Нет доступа' });
  const subs = db.submissions.filter(s => s.testId === t.id).sort((a, b) => a.at - b.at);
  const taskCount = t.tasks.length;
  const headers = ['Ученик', 'Класс', 'Дата', 'Попытка', 'Балл', 'Макс', '%', 'Время'];
  for (let i = 1; i <= taskCount; i++) headers.push('Задание ' + i);
  const rows = subs.map(s => {
    const cls = db.classes.find(c => c.id === s.classId);
    const pct = s.max ? Math.round(s.score / s.max * 100) : 0;
    const dur = s.durationMs ? Math.round(s.durationMs / 1000) + ' с' : '';
    const row = [s.studentName, cls ? cls.name : '—',
                 new Date(s.at).toLocaleString('ru-RU'),
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
});

app.get('/api/submissions/:id', auth, (req, res) => {
  const s = db.submissions.find(x => x.id === req.params.id);
  if (!s) return res.status(404).json({ error: 'Сдача не найдена' });
  const t = db.tests.find(x => x.id === s.testId);
  if (!t) return res.status(404).json({ error: 'Работа не найдена' });
  const isTeacher = t.ownerId === req.user.id;
  const isStudent = s.studentId === req.user.id;
  if (!isTeacher && !isStudent) return res.status(403).json({ error: 'Нет доступа' });
  const tasks = t.tasks.map((task, i) => {
    const r = s.results[i] || { ok: false };
    if (isTeacher || r.ok) return task;
    const c = { ...task };
    delete c.answer; delete c.correctIndex;
    return c;
  });
  res.json({
    submission: {
      id: s.id, score: s.score, max: s.max, at: s.at,
      results: s.results, attempt: s.attempt,
      durationMs: s.durationMs, expired: s.expired
    },
    test: { id: t.id, title: t.title, tasks }
  });
});

/* favicon — тихо отдаём 204, чтобы не сыпалось SendStream.error */
app.get('/favicon.ico', (req, res) => res.status(204).end());

/* 404 для статики — отдаём index.html, чтобы SPA-роутинг работал */
app.get(/^\/(?!api\/).*/, (req, res, next) => {
  if (req.path.includes('.')) return next(); // файлы .css, .js, .png — пропускаем
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

/* Глобальный обработчик ошибок — сервер не падает от одной ошибки */
app.use((err, req, res, next) => {
  console.error('❌ Ошибка:', err.message);
  res.status(500).json({ error: 'Внутренняя ошибка сервера' });
});

app.listen(PORT, () => {
  console.log('═══════════════════════════════════════');
  console.log('✅ MathTest сервер запущен');
  console.log('🌐 Порт: ' + PORT);
  console.log('🤖 Telegram: ' + (bot ? 'включён' : 'выключен'));
  console.log('═══════════════════════════════════════');
});
