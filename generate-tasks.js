/* ==========================================================
   MathConst — генератор задач под ЕГЭ 2027 (структура из 20 заданий)
   Запуск: node generate-tasks.js [N]
   N — сколько вариантов на каждый шаблон (по умолчанию 20)
   ========================================================== */

const { Pool } = require('pg');
try { require('dotenv').config(); } catch (e) {}

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) { console.error('❌ Нет DATABASE_URL'); process.exit(1); }

const DB_SSL = process.env.DATABASE_SSL === 'true' || process.env.DATABASE_SSL === '1';
const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: DB_SSL ? { rejectUnauthorized: false } : false
});

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const ri = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const N = Math.max(1, parseInt(process.argv[2]) || 20);
const seen = new Set();

/* Структура ЕГЭ 2027 (профиль) — 20 заданий:
   1. Планиметрия
   2. Векторы
   3. Стереометрия
   4. Вероятность (базовая)
   5. Вероятность (сложная)
   6. Случайные величины · мат. ожидание · дисперсия   ← НОВОЕ 2027
   7. Уравнения
   8. Вычисления и преобразования
   9. Производная и её применение (экстремум)
  10. Прикладные задачи
  11. Текстовые задачи
  12. Функции и графики (с картинкой — не генерируем)
  13. Финансовые задачи                              ← НОВОЕ 2027
  14–20. Вторая часть (развёрнутый ответ) — не в этом файле
*/

const TEMPLATES = [
  /* ===================== №1 ПЛАНИМЕТРИЯ ===================== */
  {
    n: 1, topic: 'Планиметрия', d: 'easy',
    gen: () => {
      const T = [[3,4,5],[6,8,10],[5,12,13],[9,12,15],[8,15,17],[7,24,25],[12,16,20],[20,21,29]];
      const [a,b,c] = pick(T);
      const k = pick([1,1,2,2,3]);
      return {
        stmt: `В треугольнике ABC угол C равен 90°, AC = ${a*k}, BC = ${b*k}. Найдите AB.`,
        ans: String(c*k)
      };
    }
  },
  {
    n: 1, topic: 'Планиметрия', d: 'easy',
    gen: () => {
      const T = [[3,4,5],[6,8,10],[5,12,13],[9,12,15],[8,15,17]];
      const [a,b,c] = pick(T);
      return {
        stmt: `В треугольнике ABC угол C равен 90°, AB = ${c}, BC = ${a}. Найдите AC.`,
        ans: String(b)
      };
    }
  },
  {
    n: 1, topic: 'Планиметрия', d: 'easy',
    gen: () => {
      const S = pick([24, 32, 40, 48, 60, 72, 80, 100]);
      return {
        stmt: `Площадь треугольника ABC равна ${S}. DE — средняя линия, параллельная стороне AB. Найдите площадь трапеции ABED.`,
        ans: String(S * 3 / 4)
      };
    }
  },
  {
    n: 1, topic: 'Планиметрия', d: 'easy',
    gen: () => {
      const d = ri(10, 60);
      return {
        stmt: `Центральный угол на ${d}° больше острого вписанного угла, опирающегося на ту же дугу окружности. Найдите вписанный угол. Ответ дайте в градусах.`,
        ans: String(d)
      };
    }
  },
  {
    n: 1, topic: 'Планиметрия', d: 'easy',
    gen: () => {
      const A = ri(30, 150);
      return {
        stmt: `Четырёхугольник ABCD вписан в окружность. Угол BAD равен ${A}°. Найдите угол BCD. Ответ дайте в градусах.`,
        ans: String(180 - A)
      };
    }
  },
  {
    n: 1, topic: 'Планиметрия', d: 'easy',
    gen: () => {
      const a = ri(4, 15), h = ri(3, 12);
      return {
        stmt: `Сторона параллелограмма равна ${a}, а высота, проведённая к этой стороне, равна ${h}. Найдите площадь параллелограмма.`,
        ans: String(a * h)
      };
    }
  },
  {
    n: 1, topic: 'Планиметрия', d: 'easy',
    gen: () => {
      const AB = ri(4, 15), CD = ri(4, 15);
      return {
        stmt: `В четырёхугольник ABCD вписана окружность, AB = ${AB}, CD = ${CD}. Найдите периметр четырёхугольника ABCD.`,
        ans: String(2 * (AB + CD))
      };
    }
  },
  {
    n: 1, topic: 'Планиметрия', d: 'easy',
    gen: () => {
      const b = ri(20, 70);
      return {
        stmt: `В треугольнике ABC стороны AC и BC равны. Внешний угол при вершине B равен ${180 - b}°. Найдите угол C. Ответ дайте в градусах.`,
        ans: String(b)
      };
    }
  },

  /* ===================== №2 ВЕКТОРЫ ===================== */
  {
    n: 2, topic: 'Векторы', d: 'easy',
    gen: () => {
      const a1 = ri(-10, 10), a2 = ri(-10, 10);
      const b1 = ri(-10, 10), b2 = ri(-10, 10);
      return {
        stmt: `Даны векторы $\\vec{a}(${a1}; ${a2})$ и $\\vec{b}(${b1}; ${b2})$. Найдите скалярное произведение $\\vec{a} \\cdot \\vec{b}$.`,
        ans: String(a1 * b1 + a2 * b2)
      };
    }
  },
  {
    n: 2, topic: 'Векторы', d: 'easy',
    gen: () => {
      const py = [[3,4,5],[6,8,10],[5,12,13],[8,15,17],[7,24,25]];
      const [px, py1, plen] = pick(py);
      const a1 = ri(-5, px + 5);
      const a2 = ri(-5, py1 + 5);
      const b1 = px - a1, b2 = py1 - a2;
      return {
        stmt: `Даны векторы $\\vec{a}(${a1}; ${a2})$ и $\\vec{b}(${b1}; ${b2})$. Найдите длину вектора $\\vec{a} + \\vec{b}$.`,
        ans: String(plen)
      };
    }
  },
  {
    n: 2, topic: 'Векторы', d: 'easy',
    gen: () => {
      const py = [[3,4,5],[6,8,10],[5,12,13],[8,15,17]];
      const [a1, a2, alen] = pick(py);
      const k = pick([2,3,4,5]);
      return {
        stmt: `Даны векторы $\\vec{a}(${a1}; ${a2})$. Найдите длину вектора $${k}\\vec{a}$.`,
        ans: String(k * alen)
      };
    }
  },

  /* ===================== №3 СТЕРЕОМЕТРИЯ ===================== */
  {
    n: 3, topic: 'Стереометрия', d: 'easy',
    gen: () => {
      const T = [[3,4,12,13],[2,3,6,7],[6,8,24,26],[1,2,2,3],[2,10,11,15],[2,6,9,11]];
      const [a,b,c,d] = pick(T);
      const k = pick([1,1,2]);
      return {
        stmt: `В прямоугольном параллелепипеде $ABCDA_1B_1C_1D_1$ известно, что $AB = ${a*k}$, $AD = ${b*k}$, $AA_1 = ${c*k}$. Найдите длину диагонали $AC_1$.`,
        ans: String(d*k)
      };
    }
  },
  {
    n: 3, topic: 'Стереометрия', d: 'easy',
    gen: () => {
      const a = ri(2, 10);
      return {
        stmt: `Объём куба равен ${a*a*a}. Найдите его ребро.`,
        ans: String(a)
      };
    }
  },
  {
    n: 3, topic: 'Стереометрия', d: 'easy',
    gen: () => {
      const r = ri(1, 10);
      return {
        stmt: `Объём шара равен $${4*r*r*r}\\pi$. Найдите его радиус.`,
        ans: String(r)
      };
    }
  },
  {
    n: 3, topic: 'Стереометрия', d: 'easy',
    gen: () => {
      const r = ri(1, 8), h = ri(2, 12);
      return {
        stmt: `Цилиндр имеет радиус основания ${r} и высоту ${h}. Найдите его объём. В ответе укажите $V/\\pi$.`,
        ans: String(r * r * h)
      };
    }
  },
  {
    n: 3, topic: 'Стереометрия', d: 'easy',
    gen: () => {
      const a = ri(2, 6), h = ri(2, 10);
      const prod = a * a * h;
      if (prod % 3 !== 0) return null;
      return {
        stmt: `В основании пирамиды лежит квадрат со стороной ${a}, высота пирамиды равна ${h}. Найдите объём пирамиды.`,
        ans: String(prod / 3)
      };
    }
  },
  {
    n: 3, topic: 'Стереометрия', d: 'easy',
    gen: () => {
      const Vcyl_pi = pick([6, 12, 18, 24, 36]);
      const r3 = Vcyl_pi / 2;
      const r = Math.cbrt(r3);
      if (!Number.isInteger(r)) return null;
      return {
        stmt: `Цилиндр, объём которого равен $${Vcyl_pi}\\pi$, описан около шара. Найдите объём шара. В ответе укажите $V/\\pi$.`,
        ans: String(Math.round(4/3 * r3))
      };
    }
  },

  /* ===================== №4 ВЕРОЯТНОСТЬ (базовая) ===================== */
  {
    n: 4, topic: 'Вероятность', d: 'easy',
    gen: () => {
      const total = pick([20, 25, 40, 50, 60, 80, 100, 200]);
      const good = ri(2, Math.floor(total / 2));
      return {
        stmt: `В сборнике билетов всего ${total} билетов, в ${good} из них встречается вопрос по теме «Логарифмы». Найдите вероятность того, что в случайно выбранном билете школьнику достанется вопрос по теме «Логарифмы».`,
        ans: String(Math.round(good / total * 10000) / 10000)
      };
    }
  },
  {
    n: 4, topic: 'Вероятность', d: 'easy',
    gen: () => {
      const total = pick([20, 30, 50, 60, 100, 200]);
      const bad = ri(2, Math.floor(total / 3));
      return {
        stmt: `В среднем из ${total} садовых насосов, поступивших в продажу, ${bad} подтекают. Найдите вероятность того, что один случайно выбранный для контроля насос не подтекает.`,
        ans: String(Math.round((total - bad) / total * 10000) / 10000)
      };
    }
  },
  {
    n: 4, topic: 'Вероятность', d: 'easy',
    gen: () => {
      const total = ri(15, 60);
      const good = ri(5, total - 5);
      return {
        stmt: `На конференцию приехали учёные: ${good} из России и ${total - good} из других стран. Порядок докладов определяется жеребьёвкой. Найдите вероятность того, что первым будет доклад учёного из России.`,
        ans: String(Math.round(good / total * 10000) / 10000)
      };
    }
  },
  {
    n: 4, topic: 'Вероятность', d: 'easy',
    gen: () => {
      const n = pick([2, 3, 4]);
      const count = pick(['ровно один раз', 'ни разу', 'ровно два раза']);
      let p;
      if (count === 'ни разу') p = 1 / Math.pow(2, n);
      else if (count === 'ровно один раз') p = n / Math.pow(2, n);
      else p = n * (n - 1) / 2 / Math.pow(2, n);
      const word = n === 2 ? 'дважды' : n === 3 ? 'трижды' : 'четыре раза';
      return {
        stmt: `В случайном эксперименте симметричную монету бросают ${word}. Найдите вероятность того, что орёл выпадет ${count}.`,
        ans: String(Math.round(p * 10000) / 10000)
      };
    }
  },

  /* ===================== №5 ВЕРОЯТНОСТЬ (сложная) ===================== */
  {
    n: 5, topic: 'Вероятность · сложное', d: 'medium',
    gen: () => {
      const p = ri(20, 80) / 100;
      const n = pick([3, 4]);
      const q = Math.pow(1 - p, n);
      const word = n === 3 ? 'тремя' : 'четырьмя';
      return {
        stmt: `Помещение освещается ${word} лампами. Вероятность перегорания каждой лампы в течение года равна ${p.toFixed(2)}. Лампы перегорают независимо друг от друга. Найдите вероятность того, что в течение года хотя бы одна лампа не перегорит.`,
        ans: String(Math.round((1 - q) * 10000) / 10000)
      };
    }
  },
  {
    n: 5, topic: 'Вероятность · сложное', d: 'medium',
    gen: () => {
      const p = ri(50, 95) / 100;
      const ans = p * p * (1-p) * (1-p);
      return {
        stmt: `Стрелок стреляет по одному разу в каждую из четырёх мишеней. Вероятность попадания в мишень при каждом отдельном выстреле равна ${p.toFixed(2)}. Найдите вероятность того, что стрелок попадёт в две первые мишени и не попадёт в две последние.`,
        ans: String(Math.round(ans * 100000) / 100000)
      };
    }
  },
  {
    n: 5, topic: 'Вероятность · сложное', d: 'medium',
    gen: () => {
      const k = ri(4, 10);
      const favorable = 6 - Math.abs(k - 7);
      return {
        stmt: `В случайном эксперименте бросают две игральные кости. Найдите вероятность того, что в сумме выпадет ${k} очков. Ответ округлите до сотых.`,
        ans: String(Math.round(favorable / 36 * 100) / 100),
        tol: 0.01
      };
    }
  },
  {
    n: 5, topic: 'Вероятность · сложное', d: 'medium',
    gen: () => {
      const p1 = ri(10, 40) / 100;
      const p2 = ri(80, 99) / 100;
      const p3 = ri(1, 8) / 100;
      // P = p1*p2 + (1-p1)*p3
      const ans = p1 * p2 + (1 - p1) * p3;
      return {
        stmt: `Автоматическая линия изготавливает батарейки. Вероятность того, что готовая батарейка неисправна, равна ${p1.toFixed(2)}. Перед упаковкой каждая батарейка проходит систему контроля. Вероятность того, что система забракует неисправную батарейку, равна ${p2.toFixed(2)}. Вероятность того, что система по ошибке забракует исправную батарейку, равна ${p3.toFixed(2)}. Найдите вероятность того, что случайно выбранная изготовленная батарейка будет забракована системой контроля.`,
        ans: String(Math.round(ans * 10000) / 10000)
      };
    }
  },

  /* ===================== №6 СЛУЧАЙНЫЕ ВЕЛИЧИНЫ (НОВОЕ 2027) ===================== */
  {
    n: 6, topic: 'Случайные величины', d: 'medium',
    gen: () => {
      // Лотерея с несколькими выигрышами, найти E
      const totalTickets = pick([1000, 2000, 5000, 10000]);
      const prizes = [
        { amount: pick([50, 100]), count: ri(50, 200) },
        { amount: pick([500, 1000]), count: ri(10, 50) },
        { amount: pick([5000, 10000]), count: ri(2, 10) }
      ];
      let sum = 0, cnt = 0;
      prizes.forEach(p => { sum += p.amount * p.count; cnt += p.count; });
      if (cnt >= totalTickets) return null;
      const E = sum / totalTickets;
      const lines = prizes.map(p =>
        `${p.amount} руб. — ${p.count} билетов`).join(', ');
      return {
        stmt: `Организаторы лотереи выпустили ${totalTickets} билетов. Среди них выигрышные: ${lines}. Остальные билеты без выигрыша. Найдите математическое ожидание величины «выигрыш на один билет». Ответ дайте в рублях.`,
        ans: String(Math.round(E * 100) / 100),
        tol: 0.01
      };
    }
  },
  {
    n: 6, topic: 'Случайные величины', d: 'medium',
    gen: () => {
      // Дискретная СВ с заданным распределением. E = Σ x_i·p_i
      const vals = [ri(-5, 0), ri(1, 3), ri(4, 8)];
      const probs = [0.2, 0.3, 0.5];
      const E = vals[0]*probs[0] + vals[1]*probs[1] + vals[2]*probs[2];
      return {
        stmt: `Случайная величина X задана распределением: P(X = ${vals[0]}) = ${probs[0]}, P(X = ${vals[1]}) = ${probs[1]}, P(X = ${vals[2]}) = ${probs[2]}. Найдите математическое ожидание E(X).`,
        ans: String(Math.round(E * 100) / 100),
        tol: 0.01
      };
    }
  },
  {
    n: 6, topic: 'Случайные величины', d: 'medium',
    gen: () => {
      // Игральная кость: E = 3.5. Или смещённая кость.
      // Простой вариант: батарейки с вероятностью брака
      const p = ri(5, 25) / 100;
      // Найти E числа неисправных среди 2 батареек = 2p
      const E = 2 * p;
      return {
        stmt: `Вероятность того, что батарейка неисправна, равна ${p.toFixed(2)}. Купили 2 батарейки. Найдите математическое ожидание числа неисправных батареек среди них.`,
        ans: String(Math.round(E * 100) / 100),
        tol: 0.01
      };
    }
  },
  {
    n: 6, topic: 'Случайные величины', d: 'medium',
    gen: () => {
      // Дисперсия дискретной СВ. D = E(X²) - (E(X))²
      const vals = [ri(-3, -1), 0, ri(1, 3)];
      const probs = [0.25, 0.5, 0.25];
      const E = vals[0]*probs[0] + vals[1]*probs[1] + vals[2]*probs[2];
      const E2 = vals[0]*vals[0]*probs[0] + vals[1]*vals[1]*probs[1] + vals[2]*vals[2]*probs[2];
      const D = E2 - E*E;
      return {
        stmt: `Случайная величина X задана распределением: P(X = ${vals[0]}) = 0,25, P(X = ${vals[1]}) = 0,5, P(X = ${vals[2]}) = 0,25. Найдите дисперсию D(X).`,
        ans: String(Math.round(D * 100) / 100),
        tol: 0.01
      };
    }
  },

  /* ===================== №7 УРАВНЕНИЯ ===================== */
  {
    n: 7, topic: 'Уравнения', d: 'easy',
    gen: () => {
      const base = pick([2, 3, 4, 5]);
      const power = ri(2, 5);
      const shift = ri(1, 8);
      const right = Math.pow(base, power);
      return {
        stmt: `Найдите корень уравнения $${base}^{x-${shift}} = ${right}$.`,
        ans: String(power + shift)
      };
    }
  },
  {
    n: 7, topic: 'Уравнения', d: 'easy',
    gen: () => {
      const a = pick([2, 3, 4, 5, 6, 7]);
      const c = ri(2, 4);
      const x = ri(2, 20);
      const b = Math.pow(a, c) - x;
      if (b <= 0) return null;
      return {
        stmt: `Найдите корень уравнения $\\log_{${a}} (x+${b}) = ${c}$.`,
        ans: String(x)
      };
    }
  },
  {
    n: 7, topic: 'Уравнения', d: 'easy',
    gen: () => {
      const c = ri(2, 10);
      const x = ri(1, 50);
      const b = c*c - x;
      const sign = b >= 0 ? `+ ${b}` : `- ${-b}`;
      return {
        stmt: `Найдите корень уравнения $\\sqrt{x ${sign}} = ${c}$.`,
        ans: String(x)
      };
    }
  },
  {
    n: 7, topic: 'Уравнения', d: 'easy',
    gen: () => {
      const a = ri(2, 9), c = ri(2, 9);
      if (a === c) return null;
      const x = ri(-10, 10);
      const b = ri(-15, 15);
      const d = (a - c) * x + b;
      const bS = b >= 0 ? `+ ${b}` : `- ${-b}`;
      const dS = d >= 0 ? `+ ${d}` : `- ${-d}`;
      return {
        stmt: `Найдите корень уравнения $${a}x ${bS} = ${c}x ${dS}$.`,
        ans: String(x)
      };
    }
  },
  {
    n: 7, topic: 'Уравнения', d: 'easy',
    gen: () => {
      const a = ri(2, 6);
      const cube = a * a * a;
      return {
        stmt: `Найдите корень уравнения $x^3 = ${cube}$.`,
        ans: String(a)
      };
    }
  },
  {
    n: 7, topic: 'Уравнения', d: 'easy',
    gen: () => {
      const a = pick([2, 3, 4, 5]);
      const x = ri(1, 10);
      const k = ri(1, 5);
      const m = x + k;
      const right = Math.pow(a, m);
      return {
        stmt: `Найдите корень уравнения $${a}^{x} \\cdot ${a}^{${k}} = ${right}$.`,
        ans: String(x)
      };
    }
  },

  /* ===================== №8 ВЫЧИСЛЕНИЯ ===================== */
  {
    n: 8, topic: 'Вычисления', d: 'easy',
    gen: () => {
      const a = ri(2, 6);
      const b = ri(2, 5), c = ri(2, 5);
      const topPower = b + c;
      return {
        stmt: `Найдите значение выражения $\\frac{${a}^{${b}} \\cdot ${a}^{${c}}}{${a}^{${topPower}}}$.`,
        ans: '1'
      };
    }
  },
  {
    n: 8, topic: 'Вычисления', d: 'easy',
    gen: () => {
      const a = ri(2, 15), b = ri(2, 15);
      return {
        stmt: `Найдите значение выражения $\\frac{\\sqrt{${a*a*b}}}{\\sqrt{${b}}}$.`,
        ans: String(a)
      };
    }
  },
  {
    n: 8, topic: 'Вычисления', d: 'easy',
    gen: () => {
      const base = pick([2, 3, 4, 5]);
      const x = Math.pow(base, ri(2, 4));
      const y = Math.pow(base, ri(1, 3));
      const ans = Math.round(Math.log(x)/Math.log(base) + Math.log(y)/Math.log(base));
      return {
        stmt: `Найдите значение выражения $\\log_{${base}} ${x} + \\log_{${base}} ${y}$.`,
        ans: String(ans)
      };
    }
  },
  {
    n: 8, topic: 'Вычисления', d: 'easy',
    gen: () => {
      const base = pick([2, 3, 4, 5]);
      const b = Math.pow(2, ri(2, 6));
      const ans = Math.round(Math.log(b)/Math.log(2));
      return {
        stmt: `Найдите значение выражения $\\frac{\\log_{${base}} ${b}}{\\log_{${base}} 2}$.`,
        ans: String(ans)
      };
    }
  },
  {
    n: 8, topic: 'Вычисления', d: 'easy',
    gen: () => {
      const base = pick([2, 3, 4, 5]);
      const k = ri(2, 30);
      return {
        stmt: `Найдите значение выражения $${base}^{\\log_{${base}} ${k}}$.`,
        ans: String(k)
      };
    }
  },
  {
    n: 8, topic: 'Вычисления', d: 'easy',
    gen: () => {
      const base = pick([2, 3]);
      const k = ri(2, 5);
      const ans = Math.pow(base, 2) * k;
      return {
        stmt: `Найдите значение выражения $${base}^{2 + \\log_{${base}} ${k}}$.`,
        ans: String(ans)
      };
    }
  },
  {
    n: 8, topic: 'Вычисления', d: 'easy',
    gen: () => {
      const base = pick([2, 3, 4, 5]);
      const x = Math.pow(base, ri(2, 4));
      const y = Math.pow(base, ri(1, 3));
      if (x % y !== 0) return null;
      const ans = Math.round(Math.log(x/y)/Math.log(base));
      return {
        stmt: `Найдите значение выражения $\\log_{${base}} ${x} - \\log_{${base}} ${y}$.`,
        ans: String(ans)
      };
    }
  },

  /* ===================== №9 ПРОИЗВОДНАЯ · ЭКСТРЕМУМ ===================== */
  {
    n: 9, topic: 'Производная', d: 'medium',
    gen: () => {
      const r1 = ri(-8, 4), r2 = ri(-4, 8);
      if (r1 === r2 || (r1 + r2) % 2 !== 0) return null;
      const A = -3 * (r1 + r2) / 2;
      const B = 3 * r1 * r2;
      const maxR = Math.min(r1, r2);
      const minR = Math.max(r1, r2);
      const askMax = Math.random() > 0.5;
      const ans = askMax ? maxR : minR;
      const AStr = A >= 0 ? `+ ${A}` : `- ${-A}`;
      const BStr = B >= 0 ? `+ ${B}` : `- ${-B}`;
      const C = ri(1, 20);
      return {
        stmt: `Найдите точку ${askMax ? 'максимума' : 'минимума'} функции $y = x^3 ${AStr}x^2 ${BStr}x + ${C}$.`,
        ans: String(ans)
      };
    }
  },
  {
    n: 9, topic: 'Производная', d: 'medium',
    gen: () => {
      const a = ri(-10, 10);
      const aStr = a >= 0 ? `+ ${a}` : `- ${-a}`;
      return {
        stmt: `Найдите точку ${Math.random() > 0.5 ? 'максимума' : 'минимума'} функции $y = (x ${aStr}) \\cdot e^x$.`,
        ans: String(-a - 1)
      };
    }
  },
  {
    n: 9, topic: 'Производная', d: 'medium',
    gen: () => {
      const a = ri(1, 15);
      return {
        stmt: `Найдите точку ${Math.random() > 0.5 ? 'максимума' : 'минимума'} функции $y = (${a} - x) \\cdot e^{x}$.`,
        ans: String(a - 1)
      };
    }
  },
  {
    n: 9, topic: 'Производная', d: 'medium',
    gen: () => {
      const a = ri(-10, 10);
      const aStr = a >= 0 ? `+ ${a}` : `- ${-a}`;
      return {
        stmt: `Найдите точку ${Math.random() > 0.5 ? 'максимума' : 'минимума'} функции $y = x - \\ln(x ${aStr})$.`,
        ans: String(1 - a)
      };
    }
  },
  {
    n: 9, topic: 'Производная', d: 'medium',
    gen: () => {
      const k = ri(2, 9);
      const a = ri(-10, 5);
      const C = ri(1, 20);
      const aStr = a >= 0 ? `- ${a}` : `+ ${-a}`;
      return {
        stmt: `Найдите точку ${Math.random() > 0.5 ? 'максимума' : 'минимума'} функции $y = ${k} \\ln(x ${aStr}) - ${k}x + ${C}$.`,
        ans: String(a + 1)
      };
    }
  },
  {
    n: 9, topic: 'Производная', d: 'medium',
    gen: () => {
      const a = ri(1, 15);
      const C = ri(1, 20);
      const askMax = Math.random() > 0.5;
      const ans = askMax ? -a : a;
      return {
        stmt: `Найдите точку ${askMax ? 'максимума' : 'минимума'} функции $y = x^3 - ${3*a*a}x + ${C}$.`,
        ans: String(ans)
      };
    }
  },

  /* ===================== №10 ПРИКЛАДНЫЕ ===================== */
  {
    n: 10, topic: 'Прикладные задачи', d: 'medium',
    gen: () => {
      const U = ri(100, 250);
      const R = ri(20, 60);
      const I = Math.round(U / R * 1000) / 1000;
      return {
        stmt: `Сила тока $I$ (в амперах) в электросети вычисляется по закону Ома: $I = \\frac{U}{R}$, где $U$ — напряжение (в вольтах), $R$ — сопротивление (в омах). При напряжении ${U} В и сопротивлении ${R} Ом найдите силу тока. Ответ дайте в амперах.`,
        ans: String(I),
        tol: 0.01
      };
    }
  },
  {
    n: 10, topic: 'Прикладные задачи', d: 'medium',
    gen: () => {
      const v0 = ri(10, 30);
      const a = ri(2, 6);
      const t = pick([2, 3, 4, 5]);
      const S = v0 * t - a * t * t / 2;
      if (!Number.isInteger(S) || S <= 0) return null;
      return {
        stmt: `Автомобиль, движущийся со скоростью $v_0 = ${v0}$ м/с, начал торможение с постоянным ускорением $a = ${a}$ м/с². За $t$ секунд после начала торможения он прошёл путь $s = v_0 t - \\frac{at^2}{2}$ (м). Определите время, прошедшее с момента начала торможения, если известно, что за это время автомобиль проехал ${S} метров. Ответ дайте в секундах.`,
        ans: String(t)
      };
    }
  },
  {
    n: 10, topic: 'Прикладные задачи', d: 'medium',
    gen: () => {
      const m = ri(1, 5) * 2;
      const v = ri(2, 10);
      const E = m * v * v / 2;
      return {
        stmt: `Кинетическая энергия тела массой $m$ кг, движущегося со скоростью $v$ м/с, вычисляется по формуле $E = \\frac{mv^2}{2}$ (Дж). Найдите кинетическую энергию тела массой ${m} кг, движущегося со скоростью ${v} м/с. Ответ дайте в джоулях.`,
        ans: String(E)
      };
    }
  },
  {
    n: 10, topic: 'Прикладные задачи', d: 'medium',
    gen: () => {
      const R1 = ri(20, 60);
      const Rmin = ri(5, 18);
      if (R1 <= Rmin) return null;
      const R2min = Math.ceil(Rmin * R1 / (R1 - Rmin));
      return {
        stmt: `В розетку электросети подключена электрическая духовка, сопротивление которой составляет $R_1 = ${R1}$ Ом. Параллельно с ней в розетку предполагается подключить электрообогреватель, сопротивление которого $R_2$ (в Ом). При параллельном соединении общее сопротивление $R = \\frac{R_1 R_2}{R_1 + R_2}$. Для нормального функционирования электросети общее сопротивление должно быть не меньше ${Rmin} Ом. Определите наименьшее возможное сопротивление электрообогревателя. Ответ дайте в омах.`,
        ans: String(R2min)
      };
    }
  },
  {
    n: 10, topic: 'Прикладные задачи', d: 'medium',
    gen: () => {
      const h0 = pick([1, 2, 3]);
      const v0 = pick([8, 9, 10, 11, 12]);
      const t1 = 1;
      const hAtT1 = h0 + v0*t1 - 5*t1*t1;
      return {
        stmt: `Высота над землёй подброшенного вверх мяча меняется по закону $h = ${h0} + ${v0}t - 5t^2$, где $h$ — высота в метрах, $t$ — время в секундах, прошедшее с момента броска. Найдите высоту мяча через 1 секунду после броска.`,
        ans: String(hAtT1)
      };
    }
  },

  /* ===================== №11 ТЕКСТОВЫЕ ===================== */
  {
    n: 11, topic: 'Текстовые задачи', d: 'medium',
    gen: () => {
      const percent = pick([2, 4, 5, 8, 10, 20, 25]);
      const part = ri(2, 20);
      const total = part * 100 / percent;
      if (!Number.isInteger(total)) return null;
      return {
        stmt: `Призёрами городской олимпиады по математике стали ${part} учеников, что составило ${percent}% от числа участников. Сколько человек участвовало в олимпиаде?`,
        ans: String(total)
      };
    }
  },
  {
    n: 11, topic: 'Текстовые задачи', d: 'medium',
    gen: () => {
      const v1 = ri(10, 25), v2 = ri(5, v1 - 2);
      const dt = ri(2, 6);
      const S = dt * v1 * v2 / (v1 - v2);
      if (!Number.isInteger(S)) return null;
      return {
        stmt: `Два велосипедиста одновременно отправились в ${S}-километровый пробег. Первый ехал со скоростью на ${v1 - v2} км/ч большей, чем скорость второго, и прибыл к финишу на ${dt} часа раньше второго. Найдите скорость велосипедиста, пришедшего к финишу первым. Ответ дайте в км/ч.`,
        ans: String(v1)
      };
    }
  },
  {
    n: 11, topic: 'Текстовые задачи', d: 'medium',
    gen: () => {
      const k1 = ri(10, 30), k2 = ri(5, k1 - 2);
      const dt = ri(1, 4);
      const N = dt * k1 * k2 / (k1 - k2);
      if (!Number.isInteger(N) || N <= 0) return null;
      return {
        stmt: `Заказ на изготовление ${N} деталей первый рабочий выполняет на ${dt} ч быстрее, чем второй. Сколько деталей за час изготавливает первый рабочий, если известно, что он за час изготавливает на ${k1 - k2} деталей больше второго?`,
        ans: String(k1)
      };
    }
  },
  {
    n: 11, topic: 'Текстовые задачи', d: 'medium',
    gen: () => {
      const v = ri(30, 90);
      const t = ri(10, 60);
      const len = Math.round(v * 1000 / 3600 * t);
      return {
        stmt: `Поезд, двигаясь равномерно со скоростью ${v} км/ч, проезжает мимо придорожного столба за ${t} секунд. Найдите длину поезда в метрах.`,
        ans: String(len)
      };
    }
  },
  {
    n: 11, topic: 'Текстовые задачи', d: 'medium',
    gen: () => {
      const v1 = pick([40, 50, 60, 70, 80]);
      const v2 = pick([50, 60, 70, 80, 90]);
      const v3 = pick([40, 50, 60, 70]);
      const S = v1*1 + v2*2 + v3*1;
      return {
        stmt: `Первый час автомобиль ехал со скоростью ${v1} км/ч, следующие два часа — со скоростью ${v2} км/ч, а затем час — со скоростью ${v3} км/ч. Найдите среднюю скорость автомобиля на протяжении всего пути. Ответ дайте в км/ч.`,
        ans: String(Math.round(S / 4))
      };
    }
  },
  {
    n: 11, topic: 'Текстовые задачи', d: 'medium',
    gen: () => {
      const vlast = ri(15, 30);
      const vflow = ri(2, 6);
      const S = ri(30, 100);
      const tThere = S / (vlast + vflow);
      const tBack = S / (vlast - vflow);
      const totalTime = tThere + tBack;
      if (Math.abs(totalTime - Math.round(totalTime)) > 0.01) return null;
      return {
        stmt: `Теплоход проходит по течению реки до пункта назначения ${S} км и после стоянки возвращается в пункт отправления. Найдите скорость теплохода в неподвижной воде, если скорость течения равна ${vflow} км/ч, а в пункт отправления теплоход возвращается через ${Math.round(totalTime)} часов после отправления из него. Ответ дайте в км/ч.`,
        ans: String(vlast)
      };
    }
  },
  {
    n: 11, topic: 'Текстовые задачи', d: 'medium',
    gen: () => {
      // Сплавы: 2 сплава с процентами, найти массу итогового
      const p1 = pick([30, 40, 45, 50]);
      const p2 = pick([10, 15, 20, 25]);
      if (p1 <= p2) return null;
      const m1 = ri(5, 50);
      const m2 = m1 - ri(5, 20);
      if (m2 <= 0) return null;
      const mass = p1 * m1 + p2 * m2;
      const massTotal = m1 + m2;
      // Итоговый процент должен быть целым
      const pRes = mass / massTotal;
      if (Math.abs(pRes - Math.round(pRes * 100) / 100) > 0.001) return null;
      return {
        stmt: `Имеется два сплава. Первый сплав содержит ${p1}% меди, второй — ${p2}% меди. Масса первого сплава равна ${m1} кг, масса второго — ${m2} кг. Из этих двух сплавов получили третий сплав. Найдите процент содержания меди в третьем сплаве.`,
        ans: String(Math.round(pRes * 100) / 100),
        tol: 0.01
      };
    }
  },

  /* ===================== №13 ФИНАНСОВЫЕ (НОВОЕ 2027) ===================== */
  {
    n: 13, topic: 'Финансы', d: 'medium',
    gen: () => {
      // Аннуитетный кредит: A·kⁿ·(k-1)/(kⁿ-1) = платеж, общая сумма = n·платеж
      // k = 1 + r/100
      const r = pick([10, 15, 20, 25]);
      const n = pick([2, 3, 4]);
      const k = 1 + r/100;
      const kn = Math.pow(k, n);
      // Платёж = A·kⁿ·(k-1)/(kⁿ-1). Найдём A чтобы платёж был целым
      const x = pick([50000, 86400, 100000, 121000, 150000, 200000, 250000, 300000]);
      // A = x·(kⁿ-1)/(kⁿ·(k-1))
      const A = x * (kn - 1) / (kn * (k - 1));
      if (!Number.isInteger(Math.round(A))) return null;
      const Ar = Math.round(A);
      const total = x * n;
      return {
        stmt: `В июле планируется взять кредит в банке на сумму ${Ar.toLocaleString('ru-RU')} рублей на ${n} лет. Условия его возврата таковы: каждый январь долг увеличивается на ${r}% по сравнению с концом предыдущего года; с февраля по июнь каждого года необходимо выплатить одним платежом часть долга. Кредит будет полностью погашен ${n === 2 ? 'двумя' : n === 3 ? 'тремя' : 'четырьмя'} равными платежами. Найдите общую сумму платежей. Ответ дайте в рублях.`,
        ans: String(total)
      };
    }
  },
  {
    n: 13, topic: 'Финансы', d: 'medium',
    gen: () => {
      // Вклад: S под r% годовых. Через n лет S·(1+r/100)ⁿ
      const S = pick([10000, 20000, 50000, 100000, 200000]);
      const r = pick([10, 15, 20, 25, 50]);
      const n = ri(2, 4);
      const k = 1 + r/100;
      const total = S * Math.pow(k, n);
      if (!Number.isInteger(Math.round(total))) return null;
      return {
        stmt: `Вклад планируется открыть на ${n} года. Первоначальный вклад составляет ${S.toLocaleString('ru-RU')} рублей. В конце каждого года вклад увеличивается на ${r}% по сравнению с его размером в начале года. Дополнительных взносов и снятий не производится. Найдите сумму вклада через ${n} года. Ответ дайте в рублях.`,
        ans: String(Math.round(total))
      };
    }
  },
  {
    n: 13, topic: 'Финансы', d: 'medium',
    gen: () => {
      // Дифференцированный кредит: долг уменьшается равномерно.
      // Общая сумма = S + сумма процентов. Проценты = p/100 · S · (n+1)/2
      const S = pick([100000, 200000, 500000, 1000000]);
      const r = pick([10, 15, 20]);
      const n = pick([2, 3, 4]);
      // Переплата = r/100 · S · (n+1)/2
      const overpay = r/100 * S * (n+1) / 2;
      if (!Number.isInteger(overpay)) return null;
      const total = S + overpay;
      return {
        stmt: `В июле планируется взять кредит в банке на сумму ${S.toLocaleString('ru-RU')} рублей на ${n} лет. Условия его возврата таковы: каждый январь долг возрастает на ${r}% по сравнению с концом предыдущего года; с февраля по июнь каждого года необходимо выплатить часть долга; в июле каждого года долг должен быть на одну и ту же сумму меньше долга на июль предыдущего года. Кредит полностью погашен за ${n} ${n === 2 ? 'года' : 'года'}. Найдите общую сумму выплат по кредиту. Ответ дайте в рублях.`,
        ans: String(Math.round(total))
      };
    }
  },
  {
    n: 13, topic: 'Финансы', d: 'medium',
    gen: () => {
      // Вклад с ежегодным пополнением
      const S = pick([10000, 50000, 100000]);
      const r = pick([10, 20]);
      const n = pick([2, 3]);
      const k = 1 + r/100;
      // S·k^n + доп
      let total = S;
      for (let i = 0; i < n; i++) total *= k;
      if (!Number.isInteger(Math.round(total))) return null;
      return {
        stmt: `Вклад планируется открыть на ${n} года. Первоначальный вклад составляет ${S.toLocaleString('ru-RU')} рублей. В конце каждого года вклад увеличивается на ${r}% по сравнению с его размером в начале года. Дополнительных взносов и снятий не производится. Найдите сумму вклада через ${n} года. Ответ дайте в рублях.`,
        ans: String(Math.round(total))
      };
    }
  },
];

async function main() {
  console.log(`═══════════════════════════════════════════════`);
  console.log(`📦 Генератор задач МаТхконст · ЕГЭ 2027`);
  console.log(`   Шаблонов: ${TEMPLATES.length}`);
  console.log(`   Вариантов на шаблон: ${N}`);
  console.log(`   Ожидается задач: ~${TEMPLATES.length * N}`);
  console.log(`   Структура: 20 заданий (генерируются 1–11, 13)`);
  console.log(`═══════════════════════════════════════════════`);

  const admin = await pool.query(
    `SELECT id, name FROM users WHERE role='admin' ORDER BY created_at ASC LIMIT 1`);
  if (!admin.rows.length) {
    console.error('❌ Нет админа в БД. Сначала зарегистрируйся через сайт.');
    process.exit(1);
  }
  const ownerId = admin.rows[0].id;
  console.log(`👤 Владелец задач: ${admin.rows[0].name}\n`);

  let total = 0, failed = 0;
  const before = (await pool.query('SELECT COUNT(*)::int AS n FROM task_bank')).rows[0].n;

  for (const t of TEMPLATES) {
    let made = 0, tries = 0;
    while (made < N && tries < N * 20) {
      tries++;
      let task;
      try { task = t.gen(); } catch (e) { continue; }
      if (!task || !task.stmt || !task.ans) continue;
      if (seen.has(task.stmt)) continue;
      seen.add(task.stmt);

      try {
        await pool.query(
          `INSERT INTO task_bank (id, owner_id, exam_type, exam_task_number, topic, difficulty,
                                  statement, type, answer, tolerance, options, correct_index,
                                  points, is_public, created_at)
           VALUES ($1,$2,'profile',$3,$4,$5,$6,'input',$7,$8,NULL,NULL,1,true,$9)`,
          [uid(), ownerId, t.n, t.topic, t.d, task.stmt, task.ans,
           task.tol || 1e-6, Date.now()]
        );
        total++; made++;
      } catch (e) {
        failed++;
        if (failed < 5) console.error(`   insert error: ${e.message}`);
      }
    }
    console.log(`  №${String(t.n).padStart(2)} ${t.topic.padEnd(28)} → ${made}/${N}`);
  }

  const after = (await pool.query('SELECT COUNT(*)::int AS n FROM task_bank')).rows[0].n;
  console.log(`\n═══════════════════════════════════════════════`);
  console.log(`✅ Добавлено: ${total}`);
  console.log(`   Было в банке: ${before}`);
  console.log(`   Стало: ${after}`);
  if (failed) console.log(`⚠️  Ошибок: ${failed}`);
  console.log(`═══════════════════════════════════════════════`);
  await pool.end();
  process.exit(0);
}

main().catch((e) => {
  console.error('❌ Фатально:', e);
  process.exit(1);
});
