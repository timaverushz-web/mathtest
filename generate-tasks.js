/* ==========================================================
   MathConst — генератор задач
   Запуск: node generate-tasks.js [N]
   N — сколько вариантов на каждый шаблон (по умолчанию 20)
   35 шаблонов × N вариантов = итоговое число задач
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
      const T = [[3,4,5],[6,8,10],[5,12,13],[8,15,17]];
      const [a,b,c] = pick(T);
      return {
        stmt: `В треугольнике ABC угол C равен 90°, AB = ${c}, AC = ${b}. Найдите sin B.`,
        ans: `${b}/${c}`
      };
    }
  },
  {
    n: 1, topic: 'Планиметрия', d: 'easy',
    gen: () => {
      const T = [[3,4,5],[6,8,10],[5,12,13],[8,15,17]];
      const [a,b,c] = pick(T);
      return {
        stmt: `В треугольнике ABC угол C равен 90°, AB = ${c}, BC = ${a}. Найдите cos B.`,
        ans: `${a}/${c}`
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
      // Сумма a+b = известная пифагорова пара → длина целая
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
  {
    n: 2, topic: 'Векторы', d: 'easy',
    gen: () => {
      const a1 = ri(-8, 8), a2 = ri(-8, 8);
      const b1 = ri(-8, 8), b2 = ri(-8, 8);
      // Длина 2a - b
      const x = 2*a1 - b1, y = 2*a2 - b2;
      const sq = x*x + y*y;
      return {
        stmt: `Даны векторы $\\vec{a}(${a1}; ${a2})$ и $\\vec{b}(${b1}; ${b2})$. Найдите $\\vec{a} \\cdot \\vec{b} + |\\vec{a}|^2$.`,
        ans: String(a1*b1 + a2*b2 + a1*a1 + a2*a2)
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
      // Объём пирамиды = 1/3 * S * h. S = a²
      const a = ri(2, 6), h = ri(2, 10);
      // Ответ: 1/3 a² h, чтобы было целое — a²h делится на 3
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
      // Цилиндр описан около шара → r_цил = r_шара, h_цил = 2r
      // V_цил = πr²·2r = 2πr³; V_шара = 4/3 π r³
      // V_шара = 2/3 V_цил
      const Vcyl_pi = pick([6, 12, 18, 24, 36]);
      // V_цил = Vcyl_pi * π. r = (Vcyl_pi/2)^(1/3)
      const r3 = Vcyl_pi / 2;
      const r = Math.cbrt(r3);
      if (!Number.isInteger(r)) return null;
      return {
        stmt: `Цилиндр, объём которого равен $${Vcyl_pi}\\pi$, описан около шара. Найдите объём шара. В ответе укажите $V/\\pi$.`,
        ans: String(Math.round(4/3 * r3))
      };
    }
  },

  /* ===================== №4 ВЕРОЯТНОСТЬ БАЗОВАЯ ===================== */
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
      const total = ri(20, 60);
      const good = ri(5, total - 5);
      return {
        stmt: `В соревнованиях по толканию ядра участвуют спортсмены из разных стран: ${good} из России и ${total - good} из других стран. Порядок, в котором выступают спортсмены, определяется жребием. Найдите вероятность того, что спортсмен, выступающий первым, окажется из России.`,
        ans: String(Math.round(good / total * 10000) / 10000)
      };
    }
  },
  {
    n: 4, topic: 'Вероятность', d: 'easy',
    gen: () => {
      // Монета брошена дважды. Ровно один орёл: 2/4 = 0.5
      // Или симметричная монета брошена 3 раза, хотя бы один орёл = 7/8
      const n = pick([2, 3, 4]);
      const count = pick(['ровно один раз', 'ни разу', 'ровно два раза']);
      let p;
      if (count === 'ни разу') p = 1 / Math.pow(2, n);
      else if (count === 'ровно один раз') p = n / Math.pow(2, n);
      else p = n * (n - 1) / 2 / Math.pow(2, n);
      return {
        stmt: `В случайном эксперименте симметричную монету бросают ${n === 2 ? 'дважды' : n === 3 ? 'трижды' : 'четыре раза'}. Найдите вероятность того, что орёл выпадет ${count}.`,
        ans: String(Math.round(p * 10000) / 10000)
      };
    }
  },

  /* ===================== №5 ВЕРОЯТНОСТЬ СЛОЖНАЯ ===================== */
  {
    n: 5, topic: 'Вероятность · сложное', d: 'medium',
    gen: () => {
      const p = ri(20, 80) / 100;
      const n = pick([3, 4]);
      const q = Math.pow(1 - p, n);
      return {
        stmt: `Помещение освещается ${n === 3 ? 'тремя' : 'четырьмя'} лампами. Вероятность перегорания каждой лампы в течение года равна ${p.toFixed(2)}. Лампы перегорают независимо друг от друга. Найдите вероятность того, что в течение года хотя бы одна лампа не перегорит.`,
        ans: String(Math.round((1 - q) * 10000) / 10000)
      };
    }
  },
  {
    n: 5, topic: 'Вероятность · сложное', d: 'medium',
    gen: () => {
      const p = ri(50, 95) / 100;
      // Попадёт в две первые и не попадёт в две последние
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
      // Сумма очков на двух костях = k. P(k) = (6 - |k - 7|)/36
      const k = ri(4, 10);
      const favorable = 6 - Math.abs(k - 7);
      return {
        stmt: `В случайном эксперименте бросают две игральные кости. Найдите вероятность того, что в сумме выпадет ${k} очков. Ответ округлите до сотых.`,
        ans: String(Math.round(favorable / 36 * 100) / 100),
        tol: 0.01
      };
    }
  },

  /* ===================== №6 УРАВНЕНИЯ ===================== */
  {
    n: 6, topic: 'Уравнения', d: 'easy',
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
    n: 6, topic: 'Уравнения', d: 'easy',
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
    n: 6, topic: 'Уравнения', d: 'easy',
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
    n: 6, topic: 'Уравнения', d: 'easy',
    gen: () => {
      // Линейное: ax + b = cx + d
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
    n: 6, topic: 'Уравнения', d: 'easy',
    gen: () => {
      const a = ri(2, 6);
      const x = ri(2, 8);
      const cube = a * a * a;
      return {
        stmt: `Найдите корень уравнения $x^3 = ${cube}$.`,
        ans: String(a)
      };
    }
  },
  {
    n: 6, topic: 'Уравнения', d: 'easy',
    gen: () => {
      // Показательное: a^x * a^k = a^m → x = m - k
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

  /* ===================== №7 ВЫЧИСЛЕНИЯ ===================== */
  {
    n: 7, topic: 'Вычисления', d: 'easy',
    gen: () => {
      const a = ri(2, 6);
      const b = ri(2, 5), c = ri(2, 5);
      const topPower = b + c;
      const botPower = b + c - 1;
      return {
        stmt: `Найдите значение выражения $\\frac{${a}^{${b}} \\cdot ${a}^{${c}}}{${a}^{${topPower}}}$.`,
        ans: '1'
      };
    }
  },
  {
    n: 7, topic: 'Вычисления', d: 'easy',
    gen: () => {
      const a = ri(2, 15), b = ri(2, 15);
      return {
        stmt: `Найдите значение выражения $\\frac{\\sqrt{${a*a*b}}}{\\sqrt{${b}}}$.`,
        ans: String(a)
      };
    }
  },
  {
    n: 7, topic: 'Вычисления', d: 'easy',
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
    n: 7, topic: 'Вычисления', d: 'easy',
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
    n: 7, topic: 'Вычисления', d: 'easy',
    gen: () => {
      // a^log_a(k) = k
      const base = pick([2, 3, 4, 5]);
      const k = ri(2, 30);
      return {
        stmt: `Найдите значение выражения $${base}^{\\log_{${base}} ${k}}$.`,
        ans: String(k)
      };
    }
  },
  {
    n: 7, topic: 'Вычисления', d: 'easy',
    gen: () => {
      // a^(2+log_a(k)) = a²·k
      const base = pick([2, 3]);
      const k = ri(2, 5);
      const ans = Math.pow(base, 2) * k;
      return {
        stmt: `Найдите значение выражения $${base}^{2 + \\log_{${base}} ${k}}$.`,
        ans: String(ans)
      };
    }
  },

  /* ===================== №9 ПРИКЛАДНЫЕ ===================== */
  {
    n: 9, topic: 'Прикладные задачи', d: 'medium',
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
    n: 9, topic: 'Прикладные задачи', d: 'medium',
    gen: () => {
      // S = v0*t - a*t²/2. Дано S, v0, a. Найти t.
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
    n: 9, topic: 'Прикладные задачи', d: 'medium',
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
    n: 9, topic: 'Прикладные задачи', d: 'medium',
    gen: () => {
      const R1 = ri(20, 60);
      const R2 = ri(20, 60);
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
    n: 9, topic: 'Прикладные задачи', d: 'medium',
    gen: () => {
      // Высота подброшенного мяча: h = h0 + v*t - g*t²/2
      const h0 = pick([1, 2, 3]);
      const v0 = pick([8, 9, 10, 11, 12]);
      const g = 5;
      const t1 = 1, t2 = 2;
      const hAtT1 = h0 + v0*t1 - g*t1*t1;
      const hAtT2 = h0 + v0*t2 - g*t2*t2;
      return {
        stmt: `Высота над землёй подброшенного вверх мяча меняется по закону $h = ${h0} + ${v0}t - 5t^2$, где $h$ — высота в метрах, $t$ — время в секундах, прошедшее с момента броска. Найдите высоту мяча через 1 секунду после броска.`,
        ans: String(hAtT1)
      };
    }
  },

  /* ===================== №10 ТЕКСТОВЫЕ ===================== */
  {
    n: 10, topic: 'Текстовые задачи', d: 'medium',
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
    n: 10, topic: 'Текстовые задачи', d: 'medium',
    gen: () => {
      // Два велосипедиста. v1 = v2 + dv, S/v2 - S/v1 = dt
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
    n: 10, topic: 'Текстовые задачи', d: 'medium',
    gen: () => {
      // Работа: N деталей. N/k2 - N/k1 = dt, k1 - k2 = dk
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
    n: 10, topic: 'Текстовые задачи', d: 'medium',
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
    n: 10, topic: 'Текстовые задачи', d: 'medium',
    gen: () => {
      // Два поезда навстречу: время t, сумма длин L1+L2 = (v1+v2)*t
      const v1 = ri(40, 90), v2 = ri(30, 70);
      const t = pick([10, 12, 15, 20, 25, 30]);
      const total = Math.round((v1 + v2) * 1000 / 3600 * t);
      const L2 = ri(100, Math.min(500, total - 50));
      const L1 = total - L2;
      return {
        stmt: `По двум параллельным железнодорожным путям навстречу друг другу следуют два поезда, скорости которых равны соответственно ${v1} км/ч и ${v2} км/ч. Длина одного поезда равна ${L2} метрам. Найдите длину другого поезда, если время, за которое один поезд прошёл мимо другого, равно ${t} секундам. Ответ дайте в метрах.`,
        ans: String(L1)
      };
    }
  },
  {
    n: 10, topic: 'Текстовые задачи', d: 'medium',
    gen: () => {
      // Средняя скорость
      const v1 = pick([40, 50, 60, 70, 80]);
      const v2 = pick([50, 60, 70, 80, 90]);
      const v3 = pick([40, 50, 60, 70]);
      const t1 = 1, t2 = 2, t3 = 1;
      const S = v1*t1 + v2*t2 + v3*t3;
      const T = t1 + t2 + t3;
      return {
        stmt: `Первый час автомобиль ехал со скоростью ${v1} км/ч, следующие два часа — со скоростью ${v2} км/ч, а затем час — со скоростью ${v3} км/ч. Найдите среднюю скорость автомобиля на протяжении всего пути. Ответ дайте в км/ч.`,
        ans: String(Math.round(S / T))
      };
    }
  },
  {
    n: 10, topic: 'Текстовые задачи', d: 'medium',
    gen: () => {
      // Теплоход по течению и обратно
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

  /* ===================== №12 ЭКСТРЕМУМ ===================== */
  {
    n: 12, topic: 'Производная', d: 'medium',
    gen: () => {
      // y = x³ + Ax² + Bx + C. y' = 3x² + 2Ax + B = 3(x-r1)(x-r2) → A = -3(r1+r2)/2, B = 3r1r2
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
    n: 12, topic: 'Производная', d: 'medium',
    gen: () => {
      // y = (x + a)·e^x → y' = e^x + (x+a)e^x = (x+a+1)e^x = 0 → x = -a-1
      const a = ri(-10, 10);
      const aStr = a >= 0 ? `+ ${a}` : `- ${-a}`;
      return {
        stmt: `Найдите точку ${Math.random() > 0.5 ? 'максимума' : 'минимума'} функции $y = (x ${aStr}) \\cdot e^x$.`,
        ans: String(-a - 1)
      };
    }
  },
  {
    n: 12, topic: 'Производная', d: 'medium',
    gen: () => {
      // y = (a - x)·e^x → y' = -e^x + (a-x)e^x = (a-x-1)e^x = 0 → x = a-1
      const a = ri(1, 15);
      return {
        stmt: `Найдите точку ${Math.random() > 0.5 ? 'максимума' : 'минимума'} функции $y = (${a} - x) \\cdot e^{x}$.`,
        ans: String(a - 1)
      };
    }
  },
  {
    n: 12, topic: 'Производная', d: 'medium',
    gen: () => {
      // y = x - ln(x + a) → y' = 1 - 1/(x+a) = 0 → x = 1 - a
      const a = ri(-10, 10);
      const aStr = a >= 0 ? `+ ${a}` : `- ${-a}`;
      return {
        stmt: `Найдите точку ${Math.random() > 0.5 ? 'максимума' : 'минимума'} функции $y = x - \\ln(x ${aStr})$.`,
        ans: String(1 - a)
      };
    }
  },
  {
    n: 12, topic: 'Производная', d: 'medium',
    gen: () => {
      // y = k·ln(x - a) - k·x + C → y' = k/(x-a) - k = 0 → x = a + 1
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
    n: 12, topic: 'Производная', d: 'medium',
    gen: () => {
      // y = x³ - 3a²x + C. y' = 3x² - 3a² = 3(x-a)(x+a) = 0 → x = ±a
      const a = ri(1, 15);
      const C = ri(1, 20);
      const askMax = Math.random() > 0.5;
      // y'' = 6x. At x = -a: y'' = -6a < 0 → max. At x = a: y'' = 6a > 0 → min.
      const ans = askMax ? -a : a;
      return {
        stmt: `Найдите точку ${askMax ? 'максимума' : 'минимума'} функции $y = x^3 - ${3*a*a}x + ${C}$.`,
        ans: String(ans)
      };
    }
  },
];

async function main() {
  console.log(`═══════════════════════════════════════════════`);
  console.log(`📦 Генератор задач МаТхконст`);
  console.log(`   Шаблонов: ${TEMPLATES.length}`);
  console.log(`   Вариантов на шаблон: ${N}`);
  console.log(`   Ожидается задач: ~${TEMPLATES.length * N}`);
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
    while (made < N && tries < N * 10) {
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
    console.log(`  №${String(t.n).padStart(2)} ${t.topic.padEnd(24)} → ${made}/${N}`);
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