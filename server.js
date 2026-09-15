const express = require('express');
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const fs      = require('fs');
const path    = require('path');
const { Resend } = require('resend');
const { nanoid } = require('nanoid');

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
const FROM_EMAIL = process.env.FROM_EMAIL || 'onboarding@resend.dev';
const BASE_URL   = process.env.BASE_URL || 'http://localhost:3000';

const DATA_FILE = path.join(__dirname, 'data.json');
const SECRET    = process.env.JWT_SECRET || 'dev-secret-change-me';
const PORT      = process.env.PORT || 3000;

/* ---------- хранилище (JSON-файл, сохраняется между запросами) ---------- */
let db = { users: [], classes: [], tests: [], submissions: [] };
if (fs.existsSync(DATA_FILE)) {
  try { db = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch (e) {}
}
function save() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(db), 'utf8');
}
const uid  = () => Math.random().toString(36).slice(2, 10);
const code = () => {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = ''; for (let i = 0; i < 6; i++) s += abc[Math.floor(Math.random() * abc.length)];
  return s;
};

/* ---------- приложение ---------- */
const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

/* ---------- авторизация ---------- */
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
  const { name, email, password, role } = req.body || {};
  if (!name || !email || !password || !['teacher', 'student'].includes(role))
    return res.status(400).json({ error: 'Заполните все поля' });
  if (password.length < 6)
    return res.status(400).json({ error: 'Пароль минимум 6 символов' });

  const e = email.toLowerCase();
  if (db.users.some(u => u.email === e))
    return res.status(409).json({ error: 'Email уже занят' });

  const verifyToken = nanoid(32);
  const user = {
    id: uid(), name: name.trim(), email: e, role,
    pass: await bcrypt.hash(password, 10),
    verified: false,
    verifyToken,
    createdAt: Date.now()
  };
  db.users.push(user); save();

  // отправляем письмо
  if (resend) {
    const link = BASE_URL + '/verify?token=' + verifyToken;
    try {
      await resend.emails.send({
        from: FROM_EMAIL,
        to: e,
        subject: 'Подтверждение почты — MathTest',
        html: `
          <h2>Здравствуйте, ${name}!</h2>
          <p>Вы зарегистрировались на MathTest.</p>
          <p>Чтобы активировать аккаунт, перейдите по ссылке:</p>
          <p><a href="${link}" style="display:inline-block;padding:10px 18px;
             background:#4c8dff;color:#fff;text-decoration:none;border-radius:8px">
             Подтвердить почту</a></p>
          <p>Если кнопка не работает, скопируйте ссылку:</p>
          <p>${link}</p>
          <p>Если вы не регистрировались — просто игнорируйте письмо.</p>
        `
      });
    } catch (err) {
      console.error('Ошибка отправки письма:', err);
    }
  }

  res.json({
    ok: true,
    message: 'Проверьте почту — мы отправили ссылку для подтверждения.'
  });
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body || {};
  const u = db.users.find(x => x.email === (email || '').toLowerCase());
  if (!u || !(await bcrypt.compare(password || '', u.pass)))
    return res.status(401).json({ error: 'Неверный email или пароль' });

  if (!u.verified)
    return res.status(403).json({ error: 'Подтвердите почту. Проверьте входящие письма.' });

  const token = jwt.sign({ id: u.id, role: u.role, name: u.name }, SECRET, { expiresIn: '30d' });
  res.json({ token, user: { id: u.id, name: u.name, role: u.role } });
});
app.get('/verify', (req, res) => {
  const token = req.query.token;
  if (!token) return res.redirect('/?verify=invalid');

  const u = db.users.find(x => x.verifyToken === token);
  if (!u) return res.redirect('/?verify=invalid');

  u.verified = true;
  u.verifyToken = null;
  save();
  res.redirect('/?verify=ok');
});

// повторная отправка письма
app.post('/api/auth/resend', async (req, res) => {
  const { email } = req.body || {};
  const u = db.users.find(x => x.email === (email || '').toLowerCase());
  if (!u) return res.status(404).json({ error: 'Email не найден' });
  if (u.verified) return res.status(400).json({ error: 'Почта уже подтверждена' });

  u.verifyToken = nanoid(32);
  save();

  if (!resend) return res.status(500).json({ error: 'Почта не настроена' });

  const link = BASE_URL + '/verify?token=' + u.verifyToken;
  try {
    await resend.emails.send({
      from: FROM_EMAIL,
      to: u.email,
      subject: 'Подтверждение почты — MathTest',
      html: `<p><a href="${link}">Подтвердить почту</a></p><p>${link}</p>`
    });
  } catch (err) {
    return res.status(500).json({ error: 'Не удалось отправить письмо' });
  }
  res.json({ ok: true });
});

app.get('/api/auth/me', auth, (req, res) => res.json({ user: req.user }));

/* =========================================================
   КЛАССЫ
   ========================================================= */
app.get('/api/classes', auth, (req, res) => {
  let list;
  if (req.user.role === 'teacher') {
    list = db.classes.filter(c => c.teacherId === req.user.id);
  } else {
    list = db.classes.filter(c => c.studentIds.includes(req.user.id));
  }
  // обогащаем данными об учителе
  const enriched = list.map(c => {
    const teacher = db.users.find(u => u.id === c.teacherId);
    return {
      id: c.id, name: c.name, code: c.code,
      teacherId: c.teacherId,
      teacherName: teacher ? teacher.name : '—',
      studentCount: c.studentIds.length
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
                teacherId: req.user.id, studentIds: [], createdAt: Date.now() };
  db.classes.push(cls); save();
  res.json({ class: cls });
});

app.delete('/api/classes/:id', auth, teacherOnly, (req, res) => {
  const c = db.classes.find(x => x.id === req.params.id);
  if (!c) return res.status(404).json({ error: 'Класс не найден' });
  if (c.teacherId !== req.user.id) return res.status(403).json({ error: 'Нет доступа' });
  db.classes = db.classes.filter(x => x.id !== c.id);
  // убираем класс из работ
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
  res.json({ class: { id: c.id, name: c.name } });
});

app.post('/api/classes/:id/leave', auth, (req, res) => {
  const c = db.classes.find(x => x.id === req.params.id);
  if (!c) return res.status(404).json({ error: 'Класс не найден' });
  c.studentIds = c.studentIds.filter(id => id !== req.user.id); save();
  res.json({ ok: true });
});

/* детали класса для учителя: ученики + работы */
app.get('/api/classes/:id', auth, teacherOnly, (req, res) => {
  const c = db.classes.find(x => x.id === req.params.id);
  if (!c) return res.status(404).json({ error: 'Класс не найден' });
  if (c.teacherId !== req.user.id) return res.status(403).json({ error: 'Нет доступа' });

  const students = c.studentIds.map(id => {
    const u = db.users.find(x => x.id === id);
    return u ? { id: u.id, name: u.name, email: u.email } : null;
  }).filter(Boolean);

  const classTests = db.tests
    .filter(t => (t.classIds || []).includes(c.id))
    .map(t => {
      const subs = db.submissions.filter(s => s.testId === t.id && s.classId === c.id);
      return {
        id: t.id, title: t.title,
        submitted: subs.length,
        total: students.length,
        unseen: subs.filter(s => !s.seen).length
      };
    });

  res.json({ class: { id: c.id, name: c.name, code: c.code }, students, tests: classTests });
});

app.delete('/api/classes/:id/students/:sid', auth, teacherOnly, (req, res) => {
  const c = db.classes.find(x => x.id === req.params.id);
  if (!c || c.teacherId !== req.user.id) return res.status(403).json({ error: 'Нет доступа' });
  c.studentIds = c.studentIds.filter(id => id !== req.params.sid); save();
  res.json({ ok: true });
});

/* =========================================================
   РАБОТЫ
   ========================================================= */
app.get('/api/tests', auth, (req, res) => {
  let list;
  if (req.user.role === 'teacher') {
    list = db.tests.filter(t => t.ownerId === req.user.id);
    list = list.map(t => ({
      id: t.id, title: t.title, tasks: t.tasks,
      classIds: t.classIds || [],
      unseen: db.submissions.filter(s => s.testId === t.id && !s.seen).length
    }));
  } else {
    const myCids = db.classes.filter(c => c.studentIds.includes(req.user.id)).map(c => c.id);
    list = db.tests
      .filter(t => (t.classIds || []).some(id => myCids.includes(id)))
      .map(t => ({
        id: t.id,
        title: t.title,
        // ученику не отдаём правильные ответы и correctIndex!
        tasks: t.tasks.map(x => {
          const c = { id: x.id, type: x.type, statement: x.statement, points: x.points };
          if (x.type === 'choice') c.options = x.options;
          return c;
        }),
        classIds: (t.classIds || []).filter(id => myCids.includes(id)),
        mySubmission: (() => {
          const s = db.submissions.filter(x => x.testId === t.id && x.studentId === req.user.id).pop();
          return s ? { score: s.score, max: s.max, at: s.at } : null;
        })()
      }));
  }
  res.json({ tests: list });
});

app.post('/api/tests', auth, teacherOnly, (req, res) => {
  const { title, tasks, classIds } = req.body || {};
  if (!title || !Array.isArray(tasks) || !tasks.length)
    return res.status(400).json({ error: 'Нужно название и задания' });
  const t = {
    id: uid(), ownerId: req.user.id, title: title.trim(),
    tasks, classIds: classIds || [], createdAt: Date.now()
  };
  db.tests.push(t); save();
  res.json({ id: t.id });
});

app.put('/api/tests/:id', auth, teacherOnly, (req, res) => {
  const t = db.tests.find(x => x.id === req.params.id);
  if (!t || t.ownerId !== req.user.id) return res.status(403).json({ error: 'Нет доступа' });
  const { title, tasks, classIds } = req.body || {};
  t.title = title; t.tasks = tasks; t.classIds = classIds || [];
  save();
  res.json({ ok: true });
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
   СДАЧА РАБОТЫ (автопроверка на сервере)
   ========================================================= */
let nerdamer;
try { nerdamer = require('nerdamer/all'); }
catch (e) { try { nerdamer = require('nerdamer'); } catch (e2) { nerdamer = null; } }

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

app.post('/api/tests/:id/submit', auth, (req, res) => {
  if (req.user.role !== 'student') return res.status(403).json({ error: 'Только для учеников' });
  const t = db.tests.find(x => x.id === req.params.id);
  if (!t) return res.status(404).json({ error: 'Работа не найдена' });

  const myCids = db.classes.filter(c => c.studentIds.includes(req.user.id)).map(c => c.id);
  const classId = (t.classIds || []).find(id => myCids.includes(id));
  if (!classId) return res.status(403).json({ error: 'Работа не для вашего класса' });

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
    classId, score, max, results, at: Date.now(), seen: false
  };
  db.submissions.push(sub); save();
  res.json({ id: sub.id, score, max, results });
});

/* =========================================================
   РЕЗУЛЬТАТЫ
   ========================================================= */
app.get('/api/tests/:id/submissions', auth, teacherOnly, (req, res) => {
  const t = db.tests.find(x => x.id === req.params.id);
  if (!t || t.ownerId !== req.user.id) return res.status(403).json({ error: 'Нет доступа' });

  // помечаем все сдачи как просмотренные
  db.submissions.forEach(s => { if (s.testId === t.id) s.seen = true; });
  save();

  const classIds = t.classIds || [];
  const groups = classIds.map(cid => {
    const cls = db.classes.find(c => c.id === cid);
    if (!cls) return null;
    const subs = db.submissions
      .filter(s => s.testId === t.id && s.classId === cid)
      .map(s => ({ id: s.id, studentId: s.studentId, studentName: s.studentName,
                   score: s.score, max: s.max, at: s.at }));
    const submittedIds = new Set(subs.map(s => s.studentId));
    const notSubmitted = cls.studentIds
      .filter(sid => !submittedIds.has(sid))
      .map(sid => { const u = db.users.find(u => u.id === sid); return u ? { id: u.id, name: u.name } : null; })
      .filter(Boolean);
    return { classId: cid, className: cls.name, submitted: subs, notSubmitted };
  }).filter(Boolean);

  res.json({ groups });
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
    if (isTeacher || r.ok) return task;   // учителю всё, ученику — только если верно
    const c = { ...task };
    delete c.answer; delete c.correctIndex;
    return c;
  });

  res.json({
    submission: { id: s.id, score: s.score, max: s.max, at: s.at, results: s.results },
    test: { id: t.id, title: t.title, tasks }
  });
});

/* ---------- запуск ---------- */
app.listen(PORT, () => console.log('MathTest → http://localhost:' + PORT));
