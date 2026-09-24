(function(){
'use strict';

var $=function(s,r){return (r||document).querySelector(s);};
var $$=function(s,r){return Array.prototype.slice.call((r||document).querySelectorAll(s));};
var esc=function(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});};
var uid=function(){return Math.random().toString(36).slice(2,10);};

var fmt=function(t){
  if(!t)return '';
  var d=new Date(t),now=Date.now(),diff=Math.floor((now-t)/1000);
  if(diff<60)return 'только что';
  if(diff<3600)return Math.floor(diff/60)+' мин назад';
  if(diff<86400)return Math.floor(diff/3600)+' ч назад';
  return d.toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'});
};
var fmtDur=function(ms){
  if(!ms)return '';
  var s=Math.round(ms/1000);
  if(s<60)return s+' с';
  var m=Math.floor(s/60),sec=s%60;
  return m+' мин'+(sec?' '+sec+' с':'');
};
var fmtSize=function(b){
  if(!b)return '';
  if(b<1024)return b+' Б';
  if(b<1048576)return (b/1024).toFixed(1)+' КБ';
  return (b/1048576).toFixed(1)+' МБ';
};
var fmtDate=function(t){return new Date(t).toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',year:'2-digit',hour:'2-digit',minute:'2-digit'});};
var fmtDeadline=function(t){
  var d=new Date(t),diffMs=t-Date.now(),diffH=Math.round(diffMs/3600000);
  var dateStr=d.toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'});
  if(diffMs<0) return 'просрочено · '+dateStr;
  if(diffH<24) return 'осталось '+diffH+' ч · '+dateStr;
  return 'осталось '+Math.round(diffH/24)+' дн · '+dateStr;
};
function isDeadlineSoon(t){if(!t)return false;var d=t-Date.now();return d>0 && d<24*3600000;}

/* THEME */
var THEME_KEY='mathtest_theme';
function applyTheme(t){document.documentElement.setAttribute('data-theme',t);try{localStorage.setItem(THEME_KEY,t);}catch(e){}}
(function(){var s='dark';try{s=localStorage.getItem(THEME_KEY)||'dark';}catch(e){}applyTheme(s);})();
var PALETTE_KEY='mathtest_palette';
function applyPalette(p){document.documentElement.setAttribute('data-palette',p);try{localStorage.setItem(PALETTE_KEY,p);}catch(e){}}
(function(){var s='orange';try{s=localStorage.getItem(PALETTE_KEY)||'orange';}catch(e){}applyPalette(s);})();

function registerSW(){
  if(!('serviceWorker' in navigator)) return;
  if(location.protocol !== 'https:' && location.hostname !== 'localhost') return;
  navigator.serviceWorker.register('/sw.js').then(function(reg){setInterval(function(){reg.update();},30*60*1000);}).catch(function(){});
}

function toast(msg,type){
  type=type||'info';
  var box=$('#toasts');if(!box)return;
  var t=document.createElement('div');
  t.className='toast '+(type==='info'?'':type);
  var icons={ok:'✓',err:'✕',warn:'⚠',info:'ℹ'};
  t.innerHTML='<span class="ico">'+icons[type]+'</span><span>'+esc(msg)+'</span>';
  box.appendChild(t);
  setTimeout(function(){t.classList.add('hide');setTimeout(function(){t.remove();},300);},3500);
}

/* API */
var TOKEN_KEY='mathtest_token';
var getToken=function(){return localStorage.getItem(TOKEN_KEY);};
var setToken=function(t){t?localStorage.setItem(TOKEN_KEY,t):localStorage.removeItem(TOKEN_KEY);};

async function api(path,opts){
  opts=opts||{};
  var headers={'Content-Type':'application/json'};
  var tk=getToken();if(tk)headers.Authorization='Bearer '+tk;
  if(opts.headers)Object.assign(headers,opts.headers);
  var r=await fetch('/api'+path,{method:opts.method||'GET',headers:headers,body:opts.body?JSON.stringify(opts.body):undefined});
  var data=await r.json().catch(function(){return {};});
  if(!r.ok){var e=new Error(data.error||'Ошибка');e.status=r.status;if(r.status===401)setToken(null);throw e;}
  return data;
}
async function apiForm(path,fd,method){
  var tk=getToken();
  var r=await fetch('/api'+path,{method:method||'POST',headers:tk?{Authorization:'Bearer '+tk}:{},body:fd});
  var data=await r.json().catch(function(){return {};});
  if(!r.ok){var e=new Error(data.error||'Ошибка');e.status=r.status;throw e;}
  return data;
}

/* HELPERS */
function isTeacherLike(){return currentUser&&(currentUser.role==='teacher'||currentUser.role==='admin');}
function isAdmin(){return currentUser&&currentUser.role==='admin';}
function canUploadBooks(){return currentUser&&['teacher','admin','librarian'].includes(currentUser.role);}
function canUseBank(){return !!currentUser;}
function canEditBank(){return currentUser&&['teacher','admin'].includes(currentUser.role);}
function roleLabel(){
  if(!currentUser)return '';
  return {'admin':'администратор','teacher':'репетитор','librarian':'библиотекарь','student':'ученик'}[currentUser.role]||currentUser.role;
}
function avatarUrl(id,bust){return '/api/users/'+id+'/avatar'+(bust?('?v='+bust):'');}

function renderAvatar(el,user,size){
  if(!el)return;
  el.style.width=(size||28)+'px';
  el.style.height=(size||28)+'px';
  el.style.fontSize=Math.round((size||28)*0.45)+'px';
  el.style.backgroundImage='';
  if(user && user.hasAvatar){
    var bust=null;
    try{ bust=localStorage.getItem('avatar_bust_'+user.id); }catch(e){}
    var url=avatarUrl(user.id,bust);
    var probe=new Image();
    probe.onload=function(){
      el.style.backgroundImage="url('"+url+"')";
      el.textContent='';
    };
    probe.onerror=function(){
      el.style.backgroundImage='';
      el.textContent=(user.name?user.name[0]:'?').toUpperCase();
    };
    probe.src=url;
  } else {
    el.textContent=(user&&user.name?user.name[0]:'?').toUpperCase();
  }
}

/* FORMULA INPUTS */
var lastFocused=null;

function textToLatex(t){
  if(!t)return'';
  t=String(t);
  t=t.replace(/sqrt\s*\(([^()]*)\)/gi,'\\sqrt{$1}');
  t=t.replace(/root\s*\(([^,]+),\s*([^()]+)\)/gi,'\\sqrt[$1]{$2}');
  t=t.replace(/abs\s*\(([^()]*)\)/gi,'\\left|$1\\right|');
  t=t.replace(/√/g,'\\sqrt{}').replace(/π/g,'\\pi ').replace(/∞/g,'\\infty ');
  t=t.replace(/≤/g,'\\le ').replace(/≥/g,'\\ge ').replace(/≠/g,'\\ne ');
  t=t.replace(/→/g,'\\to ').replace(/∂/g,'\\partial ').replace(/∫/g,'\\int ')
       .replace(/Σ/g,'\\sum ').replace(/±/g,'\\pm ').replace(/×/g,'\\times ')
       .replace(/÷/g,'\\div ').replace(/·/g,'\\cdot ');
  t=t.replace(/²/g,'^{2}').replace(/³/g,'^{3}').replace(/¹/g,'^{1}');
  t=t.replace(/⁴/g,'^{4}').replace(/₀/g,'_{0}').replace(/₁/g,'_{1}');
  t=t.replace(/₂/g,'_{2}').replace(/ₓ/g,'_{x}').replace(/ₙ/g,'_{n}');
  t=t.replace(/([0-9a-zA-Z]+)\s*\/\s*([0-9a-zA-Z]+)/g,'\\frac{$1}{$2}');
  t=t.replace(/\^(-?\d+)/g,'^{$1}').replace(/\*/g,'\\cdot ');
  return t;
}

/* Рендерит текст со встроенными $...$ формулами и <div class="task-figure">... */
function renderMixedText(el, raw){
  if(!el) return;
  el.innerHTML = '';
  if(!raw){ return; }
  var str = String(raw);

  /* Вырезаем блок с чертежом (img или svg) — вставляем как отдельный блок */
  var figMatch = str.match(/<div class="task-figure">([\s\S]*?)<\/div>/);
  if (figMatch) {
    var figDiv = document.createElement('div');
    figDiv.className = 'task-figure';
    figDiv.innerHTML = figMatch[1];
    el.appendChild(figDiv);
    str = str.replace(figMatch[0], '').trim();
  }

  var parts = [];
  var re = /\$([^$]+)\$/g;
  var last = 0, m;
  while((m = re.exec(str))){
    if(m.index > last) parts.push({ text: str.slice(last, m.index) });
    parts.push({ tex: m[1] });
    last = m.index + m[0].length;
  }
  if(last < str.length) parts.push({ text: str.slice(last) });

  parts.forEach(function(p){
    if(p.text){
      el.appendChild(document.createTextNode(p.text));
    } else if(p.tex){
      var span = document.createElement('span');
      el.appendChild(span);
      if(window.katex){
        try { katex.render(p.tex, span, { throwOnError: false }); }
        catch(e){ span.textContent = '$' + p.tex + '$'; }
      } else {
        span.textContent = '$' + p.tex + '$';
      }
    }
  });
}

function createMathInput(initial,readonly,onChange){
  var wrap=document.createElement('div');
  wrap.className='mi-wrap' + (readonly ? ' mi-readonly' : '');
  var ta=document.createElement('textarea');ta.className='mi-input';
  ta.rows=2;ta.spellcheck=false;ta.placeholder='Например: sqrt(16), 2^2+3, sin(pi/2)';
  ta.value=initial||'';if(readonly)ta.readOnly=true;
  var prev=document.createElement('div');prev.className='mi-preview';
  wrap.appendChild(ta);wrap.appendChild(prev);

  function render(){
    var raw = ta.value;

    if(readonly){
      renderMixedText(prev, raw);
      return;
    }

    if(/\$[^$]+\$/.test(raw)){
      renderMixedText(prev, raw);
      return;
    }

    var hasCyr = /[А-Яа-яЁё]/.test(raw);
    if(hasCyr){
      prev.textContent = raw;
      prev.classList.add('mi-preview-plain');
      return;
    }
    prev.classList.remove('mi-preview-plain');
    var tex = textToLatex(raw);
    if(window.katex && tex){
      try { katex.render(tex, prev, { throwOnError: false }); }
      catch(e){ prev.textContent = raw; }
    } else prev.textContent = raw;
  }

  ta.addEventListener('input',function(){render();if(onChange)onChange(ta.value);});
  if(!readonly) ta.addEventListener('focus',function(){lastFocused=api;});

  var api={
    el:wrap,textarea:ta,
    getValue:function(){return ta.value;},
    setValue:function(v){ta.value=v||'';render();},
    insertAtCursor:function(str){
      if(ta.readOnly)return;
      var s=ta.selectionStart,e=ta.selectionEnd,v=ta.value;
      ta.value=v.slice(0,s)+str+v.slice(e);
      ta.selectionStart=ta.selectionEnd=s+str.length;ta.focus();render();
      if(onChange)onChange(ta.value);
    },
    insertAroundCursor:function(before,after){
      if(ta.readOnly)return;
      var s=ta.selectionStart,e=ta.selectionEnd,v=ta.value;
      var sel=v.slice(s,e);
      ta.value=v.slice(0,s)+before+sel+after+v.slice(e);
      ta.selectionStart=ta.selectionEnd=s+before.length+sel.length;ta.focus();render();
      if(onChange)onChange(ta.value);
    }
  };
  render();return api;
}

var SYMBOLS_BASIC=[
  {label:'√',wrap:['√(',')']},{label:'ⁿ√',wrap:['root(3,',')']},
  {label:'x²',insert:'^2'},{label:'xⁿ',wrap:['^(',')']},
  {label:'a/b',wrap:['(',')/(',')']},{label:'( )',wrap:['(',')']},
  {label:'π',insert:'π'},{label:'∞',insert:'∞'},
  {label:'sin',wrap:['sin(',')']},{label:'cos',wrap:['cos(',')']},
  {label:'tan',wrap:['tan(',')']},{label:'ln',wrap:['ln(',')']},
  {label:'log',wrap:['log(',')']},
  {label:'≤',insert:'≤'},{label:'≥',insert:'≥'},{label:'≠',insert:'≠'},
  {label:'±',insert:'±'},{label:'×',insert:'×'},{label:'÷',insert:'÷'}
];
var SYMBOLS_ADVANCED=[
  {label:'∫',wrap:['∫(',')dx']},{label:'∫ₐᵇ',wrap:['∫(',')d']},
  {label:'Σ',wrap:['Σ(',')']},{label:'lim',insert:'lim('},
  {label:'d/dx',wrap:['d/dx(',')']},{label:'∂',insert:'∂'},
  {label:'→',insert:'→'},{label:'|x|',wrap:['|','|']},
  {label:'x⁴',insert:'^4'},{label:'xₙ',insert:'_n'},
  {label:'asin',wrap:['asin(',')']},{label:'acos',wrap:['acos(',')']},
  {label:'atan',wrap:['atan(',')']},{label:'sinh',wrap:['sinh(',')']},
  {label:'cosh',wrap:['cosh(',')']},{label:'tanh',wrap:['tanh(',')']},
  {label:'e^x',insert:'e^'},{label:'exp',wrap:['exp(',')']},
  {label:'∛',wrap:['root(3,',')']},{label:'!',insert:'!'},
  {label:'gcd',wrap:['gcd(',',',')']},
  {label:'min',wrap:['min(',',',')']},{label:'max',wrap:['max(',',',')']}
];
var currentSymTab='basic';
var currentBankSymTab='basic';

function buildSymbolBar(c){
  if(!c)return;c.innerHTML='';
  var list=currentSymTab==='basic'?SYMBOLS_BASIC:SYMBOLS_ADVANCED;
  list.forEach(function(s){
    var b=document.createElement('button');b.type='button';
    b.textContent=s.label;b.title=s.label;
    b.addEventListener('mousedown',function(e){e.preventDefault();});
    b.onclick=function(){
      if(!lastFocused)return;
      if(s.wrap)lastFocused.insertAroundCursor(s.wrap[0],s.wrap[1]);
      else lastFocused.insertAtCursor(s.insert);
    };
    c.appendChild(b);
  });
}

function buildBankSymbolBar(c){
  if(!c)return;c.innerHTML='';
  var list=currentBankSymTab==='basic'?SYMBOLS_BASIC:SYMBOLS_ADVANCED;
  list.forEach(function(s){
    var b=document.createElement('button');b.type='button';
    b.textContent=s.label;b.title=s.label;
    b.addEventListener('mousedown',function(e){e.preventDefault();});
    b.onclick=function(){
      if(!lastFocused)return;
      if(s.wrap)lastFocused.insertAroundCursor(s.wrap[0],s.wrap[1]);
      else lastFocused.insertAtCursor(s.insert);
    };
    c.appendChild(b);
  });
}

/* STATE */
var currentUser=null,currentTest=null,answerInputs=[],choicePicks=[];
var editingTestId=null,draftTasks=[],draftClassIds=[],draftGroupIds=[];
var currentClassId=null,currentSubmissionTest=null;
var stmtInput=null,ansInput=null;
var timerInterval=null,testDeadline=null,draftTimer=null;
var notifOpen=false,notifTimer=null;
var bookView='grid';
var chatPollTimer=null,lastChatTime=0;
var lastCsvResult=null;
var supportOpen=false;
var takeCurrentTask=0;
var userMenuOpen=false;
var __draftAnswers=null;
var editingBookId=null;

var bankState={
  list: [],
  meta: { topics: [], presetTopics: [] },
  editingId: null,
  statementInput: null,
  answerInput: null,
  figureUrl: null,
  pickerSelected: {},
  pickerList: []
};

/* Тематики номеров ЕГЭ профиль 2027 */
var EXAM_TOPICS = {
  1:  'Планиметрия',
  2:  'Векторы',
  3:  'Стереометрия',
  4:  'Вероятность',
  5:  'Вероятность · сложное',
  6:  'Случайные величины',
  7:  'Уравнения',
  8:  'Вычисления',
  9:  'Производная',
  10: 'Прикладные задачи',
  11: 'Текстовые задачи',
  12: 'Функции и графики',
  13: 'Финансы',
  14: 'Тригонометрия',
  15: 'Стереометрия · 2ч',
  16: 'Неравенства',
  17: 'Прикладная · 2ч',
  18: 'Планиметрия · 2ч',
  19: 'Параметры',
  20: 'Теория чисел'
};

var EXAM_ICONS = {
  1:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 20h18L12 4z"/></svg>',
  2:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="19" x2="19" y2="5"/><polyline points="14 5 19 5 19 10"/></svg>',
  3:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2 3 7v10l9 5 9-5V7z"/><path d="M12 22V12"/><path d="M3 7l9 5 9-5"/></svg>',
  4:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M9 9h.01M15 9h.01M9 15h.01M15 15h.01M12 12h.01"/></svg>',
  5:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="1"/><circle cx="16" cy="8" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="8" cy="16" r="1"/><circle cx="16" cy="16" r="1"/></svg>',
  6:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 20h4v-6H3zM10 20h4V8h-4zM17 20h4V4h-4z"/></svg>',
  7:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="12" x2="20" y2="12"/><polyline points="8 8 4 12 8 16"/><polyline points="16 8 20 12 16 16"/></svg>',
  8:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 4v16M19 4v16M5 12h14M9 4l-4 4M15 20l4-4"/></svg>',
  9:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 20c4-8 8-12 14-14M17 6h4v4"/></svg>',
  10: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 0 0-.1-1l2-1.5-2-3.5-2.4 1a7 7 0 0 0-1.7-1L14.5 3h-5l-.3 2.5a7 7 0 0 0-1.7 1L5 5.5l-2 3.5L5 11a7 7 0 0 0 0 2l-2 1.5 2 3.5 2.4-1a7 7 0 0 0 1.7 1l.3 2.5h5l.3-2.5a7 7 0 0 0 1.7-1l2.4 1 2-3.5-2-1.5c.1-.3.1-.7.1-1z"/></svg>',
  11: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h13l5 6-5 6H3z"/><path d="M8 10v4M12 10v4"/></svg>',
  12: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 20 9 8l4 6 3-4 5 10z"/></svg>',
  13: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M14.5 9.5c0-1-1-2-2.5-2s-2.5 1-2.5 2 1 2 2.5 2 2.5 1 2.5 2-1 2-2.5 2-2.5-1-2.5-2M12 6v12"/></svg>',
  14: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 18c0-8 8-14 16-14M4 18c8 0 14-8 14-16"/></svg>',
  15: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2 4 6v12l8 4 8-4V6z"/><path d="M12 12 4 6M12 12l8-6M12 12v10"/></svg>',
  16: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12h6l2-8 2 16 2-8h4"/></svg>',
  17: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3v4a1 1 0 0 0 1 1h4"/><path d="M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2z"/><path d="M9 13h6M9 17h6"/></svg>',
  18: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 3v18M3 12h18"/></svg>',
  19: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="6" x2="20" y2="6"/><circle cx="9" cy="6" r="2"/><line x1="4" y1="12" x2="20" y2="12"/><circle cx="15" cy="12" r="2"/><line x1="4" y1="18" x2="20" y2="18"/><circle cx="11" cy="18" r="2"/></svg>',
  20: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 21h10M9 3v6l-4 8c-.5 1 .3 2 1.5 2h11c1.2 0 2-1 1.5-2l-4-8V3"/><path d="M7 3h10"/></svg>'
};

var EXAM_MAX_POINTS = {
  1:1, 2:1, 3:1, 4:1, 5:1, 6:1, 7:1, 8:1, 9:1, 10:1, 11:1, 12:1, 13:1,
  14:2, 15:3, 16:2, 17:2, 18:3, 19:4, 20:4
};

function pluralTasks(n){
  var m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return 'задача';
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return 'задачи';
  return 'задач';
}

function renderExamWidgets(counts){
  var host = document.getElementById('examWidgets');
  if (!host) return;
  host.innerHTML = '';
  counts = counts || {};
  var cur = ($('#bankFilterNum') && parseInt($('#bankFilterNum').value)) || 0;

  for (var num = 1; num <= 20; num++) {
    var cnt = counts[num] || 0;
    var cls = 'exam-widget';
    if (cnt === 0) cls += ' empty';
    if (cnt > 0 && cnt < 5) cls += ' low';
    if (cnt >= 5) cls += ' full';
    if (num === cur) cls += ' active';

    var pct = Math.min(100, cnt * 12);
    var pts = EXAM_MAX_POINTS[num] || 1;
    var part = num <= 13 ? 'ч.1' : 'ч.2';

    var w = document.createElement('div');
    w.className = cls;
    w.dataset.num = num;
    w.title = 'Задание №' + num + ' · ' + (EXAM_TOPICS[num] || '') + ' · макс. ' + pts + ' б.';
    w.innerHTML =
      '<div class="exam-widget-top">' +
        '<span class="exam-widget-icon">' + (EXAM_ICONS[num] || '') + '</span>' +
        '<span class="exam-widget-part">' + part + '</span>' +
      '</div>' +
      '<div class="exam-widget-num">№' + num + '</div>' +
      '<div class="exam-widget-topic">' + (EXAM_TOPICS[num] || '—') + '</div>' +
      '<div class="exam-widget-bar">' +
        '<div class="exam-widget-bar-fill" style="width:' + pct + '%"></div>' +
      '</div>' +
      '<div class="exam-widget-foot">' +
        '<span class="exam-widget-count">' + cnt + '</span>' +
        '<span class="exam-widget-pts">макс ' + pts + 'б</span>' +
      '</div>';

    w.onclick = (function(n){
      return function(){
        var sel = $('#bankFilterNum');
        if (!sel) return;
        var targetVal = String(n);
        var hasOpt = false;
        for (var i = 0; i < sel.options.length; i++) {
          if (sel.options[i].value === targetVal) { hasOpt = true; break; }
        }
        if (!hasOpt) {
          var opt = document.createElement('option');
          opt.value = targetVal;
          opt.textContent = '№' + n;
          sel.appendChild(opt);
        }
        var newVal = (parseInt(sel.value) === n) ? '0' : targetVal;
        sel.value = newVal;
        if (newVal !== '0') {
          var ex = $('#bankFilterExam');
          if (ex) ex.value = 'profile';
        }
        syncWidgetsActive();
        loadBankList();
      };
    })(num);
    host.appendChild(w);
  }
}

function syncWidgetsActive(){
  var cur = ($('#bankFilterNum') && parseInt($('#bankFilterNum').value)) || 0;
  $$('#examWidgets .exam-widget').forEach(function(el){
    el.classList.toggle('active', parseInt(el.dataset.num) === cur);
  });
}

async function refreshExamWidgets(){
  try {
    var r = await api('/task-bank/counts');
    renderExamWidgets(r.counts || {});
  } catch (e) {
    console.warn('exam counts:', e.message);
  }
}

/* READER STATE */
var reader = {
  bookId:null, book:null, pdf:null, totalPages:0,
  currentPage:1, zoom:1,
  activeSlot:'A',
  animating:false,
  cache:{},
  outline:[],
  uiHidden:false,
  hintShown:false
};
  /* TOPBAR TABS */
function updateTopbarTabs(){
  var active='';
  if($('#view-teacher') && $('#view-teacher').classList.contains('active')) active='home';
  else if($('#view-student') && $('#view-student').classList.contains('active')) active='home';
  else if($('#view-taskbank') && $('#view-taskbank').classList.contains('active')) active='bank';
  else if($('#view-library') && $('#view-library').classList.contains('active')) active='library';
  else if($('#view-reader') && $('#view-reader').classList.contains('active')) active='library';
  $$('#topbarTabs .tt-btn').forEach(function(b){
    b.classList.toggle('active', b.dataset.tab===active);
  });
}
window.updateTopbarTabs = updateTopbarTabs;

function show(id){
  var privateViews = [
    'view-teacher','view-student','view-taskbank','view-library','view-reader',
    'view-admin','view-dashboard','view-editor','view-class','view-analytics',
    'view-rating','view-take','view-submissions','view-profile','view-editprofile'
  ];
  if(!currentUser && privateViews.indexOf(id) >= 0){
    id = 'view-landing';
  }
  var wasReader = $('#view-reader').classList.contains('active');
  $$('.view').forEach(function(v){v.classList.toggle('active',v.id===id);});
  var isReader = id==='view-reader';
  document.body.classList.toggle('reader-mode', isReader);
  if(!isReader) window.scrollTo(0,0);
  if(id!=='view-class'&&chatPollTimer){clearInterval(chatPollTimer);chatPollTimer=null;}
  if(wasReader && !isReader){ readerClose(); }
  var mn=$$('#mobile-nav button');
  mn.forEach(function(b){b.classList.remove('active');});
  if(id==='view-teacher'||id==='view-student'){var h=$('[data-mnav="home"]');if(h)h.classList.add('active');}
  else if(id==='view-taskbank'){var bk=$('[data-mnav="bank"]');if(bk)bk.classList.add('active');}
  else if(id==='view-library'||id==='view-reader'){var l=$('[data-mnav="library"]');if(l)l.classList.add('active');}
  else if(id==='view-dashboard'||id==='view-analytics'||id==='view-rating'){var d=$('[data-mnav="home"]');if(d)d.classList.add('active');}
  else if(id==='view-profile'||id==='view-editprofile'){var p=$('[data-mnav="profile"]');if(p)p.classList.add('active');}
  if(typeof updateTopbarTabs === 'function') updateTopbarTabs();
}

function skeleton(host,lines){
  if(!host)return;lines=lines||3;
  var html='<div class="skeleton">';
  for(var i=0;i<lines;i++)html+='<div class="sk-line w'+(60+((i*17)%40))+'"></div>';
  html+='</div>';host.innerHTML=html;
}

function initReveal(){
  var els=$$('.reveal');
  if(!('IntersectionObserver' in window)){els.forEach(function(el){el.classList.add('visible');});return;}
  var io=new IntersectionObserver(function(entries){entries.forEach(function(en){if(en.isIntersecting){en.target.classList.add('visible');io.unobserve(en.target);}});},{threshold:.15});
  els.forEach(function(el){io.observe(el);});
}

function animateCounters(){
  var els=$$('.ld-number-value[data-count], .landing-stat .ls-value[data-count]');
  els.forEach(function(el){
    var raw=el.dataset.count;if(raw==='infinity') return;
    var target=parseInt(raw);if(isNaN(target)) return;
    var suffix=el.textContent.replace(/^[\d\s]+/,'');
    var dur=1600,start=null;
    function tick(ts){
      if(!start)start=ts;
      var p=Math.min(1,(ts-start)/dur);
      var v=Math.round(target*(1-Math.pow(1-p,3)));
      el.textContent=v.toLocaleString('ru-RU')+suffix;
      if(p<1)requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  });
}

/* USER MENU */
function closeUserMenu(){userMenuOpen=false;var c=$('#userChip');var m=$('#userMenu');if(c)c.classList.remove('open');if(m)m.hidden=true;}
function openUserMenu(){userMenuOpen=true;var c=$('#userChip');var m=$('#userMenu');if(c)c.classList.add('open');if(m)m.hidden=false;}

function buildUserMenu(){
  var menu=$('#userMenu');if(!menu)return;
  menu.innerHTML='';
  function item(icon,text,hint,onClick,danger){
    var b=document.createElement('button');b.type='button';
    b.className='user-menu-item'+(danger?' danger':'');
    b.innerHTML='<div class="um-icon"><svg><use href="#'+icon+'"/></svg></div>'+
      '<div class="um-text">'+esc(text)+(hint?'<div class="um-hint">'+esc(hint)+'</div>':'')+'</div>';
    b.onclick=function(){closeUserMenu();if(onClick)onClick();};
    return b;
  }
  function sep(){var d=document.createElement('div');d.className='user-menu-sep';return d;}
  menu.appendChild(item('i-settings','Личный кабинет','Профиль и настройки',openProfileStats));
  if(isTeacherLike()) menu.appendChild(item('i-chart','Дашборд','Успеваемость, топ учеников',openDashboard));
  if(currentUser) menu.appendChild(item('i-layers','Банк заданий','Задачи по номерам ЕГЭ',openTaskBank));
  menu.appendChild(item('i-book','Библиотека','Учебники и пособия',openLibrary));
  if(isTeacherLike()) menu.appendChild(item('i-edit','Мои работы','Работы и группы',goTeacher));
  else if(currentUser&&currentUser.role==='student') menu.appendChild(item('i-edit','Мои работы','Доступные работы',goStudent));
  if(isAdmin()) menu.appendChild(item('i-crown','Админ-панель','Пользователи, логи, бэкапы',openAdmin));
  menu.appendChild(sep());
  var curTheme=document.documentElement.getAttribute('data-theme');
  menu.appendChild(item(curTheme==='dark'?'i-sun':'i-moon',curTheme==='dark'?'Светлая тема':'Тёмная тема','Переключить оформление',function(){
    var t=document.documentElement.getAttribute('data-theme');
    applyTheme(t==='dark'?'light':'dark');buildUserMenu();
  }));
  menu.appendChild(sep());
  menu.appendChild(item('i-logout','Выйти из аккаунта',null,logout,true));
}

function renderTop(){
  var wrap=$('#userChipWrap');
  var tabs=$('#topbarTabs');
  if(!currentUser){
    if(wrap)wrap.hidden=true;
    if(tabs)tabs.hidden=true;
    return;
  }
  if(wrap)wrap.hidden=false;
  if(tabs)tabs.hidden=false;
  var a=$('#chipAvatar'),n=$('#chipName'),r=$('#chipRole');
  if(n)n.textContent=currentUser.name;
  if(r)r.textContent=roleLabel();
  renderAvatar(a,currentUser,32);
  buildUserMenu();
}

function logout(){
  setToken(null);currentUser=null;
  if(notifTimer){clearInterval(notifTimer);notifTimer=null;}
  if(chatPollTimer){clearInterval(chatPollTimer);chatPollTimer=null;}
  closeUserMenu();closeNotifPanel();renderTop();show('view-landing');toast('Вы вышли','info');
}

/* NOTIFICATIONS */
function closeNotifPanel(){notifOpen=false;var p=$('#notifPanel');if(p)p.hidden=true;}

async function refreshNotifBadge(){
  if(!currentUser)return;
  try{
    var r=await api('/notifications');
    var b=$('#notifBadge');if(!b)return;
    if(r.unread>0){b.textContent=r.unread>9?'9+':r.unread;b.hidden=false;}
    else b.hidden=true;
  }catch(e){}
}

async function loadNotifications(){
  var list=$('#notifList');if(!list)return;
  skeleton(list,3);
  try{
    var r=await api('/notifications');
    list.innerHTML='';
    if(!r.notifications.length){list.innerHTML='<div class="empty" style="padding:40px 20px">Пока нет уведомлений</div>';return;}
    r.notifications.forEach(function(n){
      var el=document.createElement('div');
      el.className='notif-item'+(n.read?'':' unread');
      var icon=n.type==='submission'?'📝':(n.type==='new_test'?'📚':(n.type==='new_book'?'📖':(n.type==='chat'?'💬':'👤')));
      el.innerHTML='<div class="ni-icon">'+icon+'</div>'+
        '<div class="ni-body"><div class="ni-title">'+esc(n.title)+'</div>'+
        '<div class="ni-text">'+esc(n.text)+'</div>'+
        '<div class="ni-time">'+fmt(n.at)+'</div></div>';
      el.onclick=async function(){
        try{await api('/notifications/'+n.id+'/read',{method:'POST'});}catch(e){}
        el.classList.remove('unread');closeNotifPanel();
        if(n.type==='submission'&&n.link&&n.link.testId&&isTeacherLike()){
          try{var rr=await api('/tests');var t=rr.tests.find(function(x){return x.id===n.link.testId;});if(t)showSubmissions(t);}catch(e){}
        } else if(n.type==='new_test'&&currentUser.role==='student'){ goStudent(); }
        else if(n.type==='new_book'&&n.link&&n.link.bookId){ openReader(n.link.bookId); }
        else if(n.type==='new_book'){ openLibrary(); }
        refreshNotifBadge();
      };
      list.appendChild(el);
    });
  }catch(e){list.innerHTML='<div class="err" style="padding:20px">'+esc(e.message)+'</div>';}
}

/* GOOGLE + TELEGRAM */
var GOOGLE_CLIENT_ID='279103327474-sp6osb2jhb92puqqvh9fmdkiv73prgk7.apps.googleusercontent.com';

function initGoogleLogin(){
  if(!GOOGLE_CLIENT_ID||window.__googleReady)return;
  window.__googleReady=true;
  window.handleGoogleLogin=async function(response){
    var errEl=$('#googleLoginErr');if(errEl)errEl.textContent='';
    try{var r=await api('/auth/google',{method:'POST',body:{credential:response.credential}});setToken(r.token);enterApp(r.user);toast('Вы вошли через Google','ok');}
    catch(e){if(errEl)errEl.textContent=e.message;toast(e.message,'err');}
  };
  function tryRender(){
    if(!window.google||!window.google.accounts||!window.google.accounts.id){setTimeout(tryRender,200);return;}
    google.accounts.id.initialize({client_id:GOOGLE_CLIENT_ID,callback:window.handleGoogleLogin});
    var box=document.getElementById('googleBtnBox');if(!box)return;box.innerHTML='';
    google.accounts.id.renderButton(box,{type:'standard',theme:'outline',size:'large',text:'signin_with',shape:'rectangular',logo_alignment:'left',width:280});
  }
  if(!document.getElementById('gsi-script')){
    var s=document.createElement('script');s.id='gsi-script';s.src='https://accounts.google.com/gsi/client';s.async=true;s.defer=true;s.onload=tryRender;document.head.appendChild(s);
  } else tryRender();
}

function initTelegramLogin(){
  var wrap=document.getElementById('tgLoginWrap');
  if(!wrap||!window.TELEGRAM_BOT_USERNAME||wrap.dataset.ready)return;
  wrap.dataset.ready='1';
  window.onTelegramAuth=async function(user){
    var errEl=$('#tgLoginErr');if(errEl)errEl.textContent='';
    try{var r=await api('/auth/telegram',{method:'POST',body:user});setToken(r.token);enterApp(r.user);toast('Вы вошли через Telegram','ok');}
    catch(e){if(errEl)errEl.textContent=e.message;toast(e.message,'err');}
  };
  var script=document.createElement('script');script.async=true;
  script.src='https://telegram.org/js/telegram-widget.js?22';
  script.setAttribute('data-telegram-login',window.TELEGRAM_BOT_USERNAME);
  script.setAttribute('data-size','large');script.setAttribute('data-radius','10');
  script.setAttribute('data-userpic','false');script.setAttribute('data-color','white');
  script.setAttribute('data-onauth','onTelegramAuth(user)');script.setAttribute('data-request-access','write');
  wrap.appendChild(script);
}

async function loadTelegramInfo(){
  try{var r=await api('/telegram/bot-info');if(r.username)window.TELEGRAM_BOT_USERNAME=r.username;}catch(e){}
}

/* SUPPORT */
var SUPPORT_KB={
  'как создать':'Нажмите «+ Группа» в кабинете. Получите код — отправьте его ученикам.',
  'как пригласить ученика':'Откройте группу и нажмите «Ссылка» — ученик перейдёт по ней и сразу присоединится.',
  'как добавить книгу':'Библиотека → «Загрузить». Заполните поля, загрузите PDF (до 60 МБ) и, при желании, обложку.',
  'как поставить дедлайн':'В редакторе работы в блоке «Настройки» укажите дату в поле «Сдать до».',
  'как работает автопроверка':'Система сравнивает ответ ученика с правильным: точное совпадение, числовое сравнение с допуском, символьное упрощение через Nerdamer.',
  'банк заданий':'Банк заданий — ваша коллекция. В конструкторе работы нажмите «Из банка», чтобы добавить готовые задачи.'
};

function supportAnswer(text){
  var t=text.toLowerCase().trim();
  for(var key in SUPPORT_KB){ if(t.indexOf(key)>=0) return SUPPORT_KB[key]; }
  if(/групп|класс/i.test(t)) return SUPPORT_KB['как создать'];
  if(/ученик|приглас|join/i.test(t)) return SUPPORT_KB['как пригласить ученика'];
  if(/книг|библиотек|чита|pdf/i.test(t)) return SUPPORT_KB['как добавить книгу'];
  if(/дедлайн|срок/i.test(t)) return SUPPORT_KB['как поставить дедлайн'];
  if(/банк|задани/i.test(t)) return SUPPORT_KB['банк заданий'];
  if(/проверк|оценк|балл/i.test(t)) return SUPPORT_KB['как работает автопроверка'];
  return 'Спасибо! Сообщение получено. Напишите на support@mathconst.ru, если срочно.';
}

function supportAddMessage(text,from){
  var box=$('#supportMessages');if(!box)return;
  var el=document.createElement('div');
  el.className='support-msg from-'+from;
  var time=new Date().toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'});
  el.innerHTML=esc(text)+'<span class="time">'+time+'</span>';
  box.appendChild(el);box.scrollTop=box.scrollHeight;
}

function toggleSupport(){
  supportOpen=!supportOpen;
  var panel=$('#supportPanel');if(!panel)return;
  panel.hidden=!supportOpen;
  if(supportOpen){
    var box=$('#supportMessages');
    if(box&&!box.dataset.init){box.dataset.init='1';supportAddMessage('Здравствуйте! Я помогу с любым вопросом по МаТхконст.','bot');}
    setTimeout(function(){var i=$('#supportInput');if(i)i.focus();},100);
  }
}

function supportSend(msg){
  var input=$('#supportInput');
  var text=(msg||(input?input.value:'')).trim();
  if(!text)return;
  supportAddMessage(text,'user');if(input)input.value='';
  setTimeout(function(){supportAddMessage(supportAnswer(text),'bot');},500);
}

/* TEACHER */
async function goTeacher(){
  show('view-teacher');
  await Promise.all([renderTeacherSummary(),renderTeacherClasses(),renderTeacherTests()]);
}

async function renderTeacherSummary(){
  var host=$('#teacherSummary');if(!host)return;
  try{
    var r=await api('/profile/teacher');
    host.innerHTML='';
    var items=[
      ['Групп', r.classesCount, 'i-book', false],['Учеников', r.studentsCount, 'i-users', false],
      ['Работ', r.testsCount, 'i-edit', false],['Сдач', r.submissionsCount, 'i-chart', false],
      ['Средний', r.avgPercent+'%', 'i-chart', true],['Банк', r.bankCount||0, 'i-layers', false]
    ];
    items.forEach(function(it){
      var c=document.createElement('div');c.className='dash-item';
      c.innerHTML='<div class="di-label">'+it[0]+'</div>'+
        '<div class="di-value'+(it[3]?' accent':'')+'">'+it[1]+'</div>'+
        '<div class="di-icon"><svg><use href="#'+it[2]+'"/></svg></div>';
      host.appendChild(c);
    });
    var qa=$('#teacherQuickActions');
    if(qa){
      qa.innerHTML='';
      [['Создать группу','i-plus',function(){var b=$('#btnNewClass');if(b)b.click();}],
       ['Создать работу','i-edit',function(){var b=$('#btnNewTest');if(b)b.click();}],
       ['Банк заданий','i-layers',openTaskBank],
       ['Библиотека','i-book',openLibrary]].forEach(function(b){
        var btn=document.createElement('button');
        btn.className='qa-btn';
        btn.innerHTML='<div class="qa-icon"><svg><use href="#'+b[1]+'"/></svg></div>'+b[0];
        btn.onclick=b[2];qa.appendChild(btn);
      });
    }
  }catch(e){host.innerHTML='';}
}

async function renderTeacherClasses(){
  var list=$('#classList');if(!list)return;
  skeleton(list,2);
  try{
    var r=await api('/classes');
    list.innerHTML='';
    if(!r.classes.length){
      list.innerHTML='<div class="card"><div class="empty"><div class="icon">✨</div><div style="font-size:20px;font-weight:800;color:var(--text);margin-bottom:8px">Здесь пока пусто</div>Создайте первую группу — ученики присоединятся по ссылке.<br>Кнопка <b style="color:var(--accent)">«+ Класс»</b> вверху страницы.</div></div>';
      return;
    }
    r.classes.forEach(function(c){
      var el=document.createElement('div');el.className='class-card';
      el.innerHTML='<div style="flex:1;min-width:200px"><h4>'+esc(c.name)+'</h4>'+
        '<div class="muted" style="margin-top:4px">Учеников: '+c.studentCount+
        ' · Подгрупп: '+(c.groups||[]).length+
        (c.teacherName&&isAdmin()?' · Владелец: '+esc(c.teacherName):'')+'</div></div>'+
        '<div class="code-box" title="Клик — копировать">'+c.code+'</div>';
      var bV=document.createElement('button');bV.className='small';bV.textContent='Открыть';
      bV.onclick=function(){openClassView(c.id);};
      var bD=document.createElement('button');bD.className='ghost small danger';bD.textContent='Удалить';
      bD.onclick=async function(){
        if(!confirm('Удалить группу «'+c.name+'»?'))return;
        try{await api('/classes/'+c.id,{method:'DELETE'});toast('Группа удалена','ok');goTeacher();}
        catch(e){toast(e.message,'err');}
      };
      el.appendChild(bV);el.appendChild(bD);
      var cb=el.querySelector('.code-box');
      cb.onclick=function(){
        copyToClipboard(c.code).then(function(ok){
          var old=cb.textContent;
          cb.textContent = ok ? '✓' : c.code;
          toast(ok?'Код скопирован':'Код: '+c.code, ok?'ok':'warn');
          setTimeout(function(){cb.textContent=old;},1000);
        });
      };
      list.appendChild(el);
    });
  }catch(e){list.innerHTML='<div class="card err">'+esc(e.message)+'</div>';}
}

async function renderTeacherTests(){
  var host=$('#testList');if(!host)return;
  skeleton(host,3);
  try{
    var r=await api('/tests');
    host.innerHTML='';
    if(!r.tests.length){
      host.innerHTML='<div class="card"><div class="empty"><div class="icon">✨</div><div style="font-size:20px;font-weight:800;color:var(--text);margin-bottom:8px">Здесь пока пусто</div>Создайте первую работу — ученики её увидят и смогут пройти.<br>Кнопка <b style="color:var(--accent)">«+ Работа»</b> вверху страницы.</div></div>';
      return;
    }
    r.tests.forEach(function(test){
      var max=test.tasks.reduce(function(s,t){return s+(t.points||1);},0);
      var s=test.settings||{},unseen=test.unseen||0,deadline=test.deadline;
      var card=document.createElement('div');card.className='test-card-v2';
      var statusLabel=s.timeLimit>0?('Активна · '+s.timeLimit+' мин'):'Активна · без ограничения';
      var deadlinePill='';
      if(deadline){
        var overdue=Date.now()>deadline,soon=isDeadlineSoon(deadline);
        var cls='pill deadline'+(overdue?' overdue':(soon?' soon':''));
        deadlinePill='<span class="'+cls+'"><svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><use href="#i-calendar"/></svg> '+esc(fmtDeadline(deadline))+'</span>';
      }
      card.innerHTML='<div class="tc-top">'+
        '<div class="tc-icon"><svg><use href="#i-edit"/></svg></div>'+
        '<div class="tc-title"><h4>'+esc(test.title)+'</h4>'+
        '<div class="tc-status active"><span class="dot"></span>'+statusLabel+'</div></div>'+
        (unseen?'<span class="badge red">'+unseen+'</span>':'')+
        '</div>'+
        '<div class="tc-meta">'+
        '<span class="pill">'+test.tasks.length+' заданий</span>'+
        '<span class="pill">'+max+' баллов</span>'+
        '<span class="pill blue">'+((test.classIds||[]).length)+' групп</span>'+
        ((test.groupIds||[]).length?'<span class="pill warn">по подгруппам</span>':'')+
        deadlinePill+
        '</div>';
      var actions=document.createElement('div');actions.className='tc-actions';
      var bE=document.createElement('button');bE.className='small';bE.textContent='Редактировать';
      bE.onclick=async function(e){e.stopPropagation();try{var rr=await api('/tests');var full=rr.tests.find(function(x){return x.id===test.id;});openEditor(full);}catch(e){toast(e.message,'err');}};
      var bR=document.createElement('button');bR.className='primary small';bR.textContent='Результаты';
      bR.onclick=function(e){e.stopPropagation();showSubmissions(test);};
      var bC=document.createElement('button');bC.className='ghost small';bC.textContent='Дублировать';
      bC.onclick=async function(e){e.stopPropagation();try{await api('/tests/'+test.id+'/duplicate',{method:'POST'});toast('Копия создана','ok');goTeacher();}catch(e){toast(e.message,'err');}};
      var bD=document.createElement('button');bD.className='ghost small danger';bD.textContent='Удалить';
      bD.onclick=async function(e){e.stopPropagation();if(!confirm('Удалить работу «'+test.title+'»?'))return;try{await api('/tests/'+test.id,{method:'DELETE'});toast('Работа удалена','ok');goTeacher();}catch(e){toast(e.message,'err');}};
      actions.appendChild(bE);actions.appendChild(bR);actions.appendChild(bC);actions.appendChild(bD);
      card.appendChild(actions);host.appendChild(card);
    });
  }catch(e){host.innerHTML='<div class="card err">'+esc(e.message)+'</div>';}
}

/* CLIPBOARD */
function copyToClipboard(text){
  return new Promise(function(resolve){
    function fallback(t){
      try{
        var ta=document.createElement('textarea');
        ta.value=t;ta.style.cssText='position:fixed;top:-9999px;left:-9999px;opacity:0';
        document.body.appendChild(ta);ta.focus();ta.select();
        var ok=document.execCommand('copy');
        document.body.removeChild(ta);
        return ok;
      }catch(e){return false;}
    }
    if(navigator.clipboard&&navigator.clipboard.writeText){
      navigator.clipboard.writeText(text).then(function(){resolve(true);}).catch(function(){resolve(fallback(text));});
    } else resolve(fallback(text));
  });
}

/* BANK */
function examTypeLabel(t){ return 'ЕГЭ профиль'; }
function difficultyLabel(d){ return {'easy':'Легко','medium':'Средне','hard':'Сложно'}[d] || 'Средне'; }
function difficultyColor(d){ return {'easy':'var(--ok)','medium':'var(--warn)','hard':'var(--err)'}[d] || 'var(--warn)'; }

function fillBankNumSelect(sel, examType, selected){
  if(!sel) return;
  var max = 20;
  var html = (sel.id === 'bankFilterNum' || sel.id === 'bpNum') ? '<option value="0">Все номера</option>' : '';
  for(var i=1;i<=max;i++){
    html += '<option value="'+i+'"'+(i===parseInt(selected)?' selected':'')+'>№'+i+'</option>';
  }
  sel.innerHTML = html;
}

async function openTaskBank(){
  if(!currentUser){ show('view-auth'); return; }
  show('view-taskbank');
  var host=$('#bankList');
  skeleton(host, 4);

  var numSel = $('#bankFilterNum');
  if(numSel){
    var curVal = parseInt(numSel.value) || 0;
    fillBankNumSelect(numSel, 'profile', curVal);
  }

  var bAdd=$('#btnAddBankTask');
  if(bAdd) bAdd.hidden = !canEditBank();
  var bImp=$('#btnImportBankCsv');
  if(bImp) bImp.hidden = !canEditBank();

  await refreshExamWidgets();
  try{
    if(!bankState.meta.topics.length){
      var m = await api('/task-bank/meta');
      bankState.meta.topics = m.topics || [];
      bankState.meta.presetTopics = m.presetTopics || [];
      fillTopicSelects();
    }
  }catch(e){}

  try {
    var adminBox = $('#bankAdminBox');
    if (adminBox) {
      if (isAdmin()) {
        adminBox.hidden = false;
        refreshBankStats();
      } else {
        adminBox.hidden = true;
      }
    }
  } catch(e) { console.error('bankAdminBox:', e); }

  await loadBankList();
}

function fillTopicSelects(){
  var sel = $('#bankFilterTopic');
  if(sel){
    var cur = sel.value;
    var html = '<option value="">Все темы</option>';
    bankState.meta.presetTopics.forEach(function(t){
      html += '<option value="'+esc(t)+'"'+(t===cur?' selected':'')+'>'+esc(t)+'</option>';
    });
    bankState.meta.topics.forEach(function(t){
      if(bankState.meta.presetTopics.indexOf(t)<0){
        html += '<option value="'+esc(t)+'"'+(t===cur?' selected':'')+'>'+esc(t)+'</option>';
      }
    });
    sel.innerHTML = html;
  }
  var bp = $('#bpTopic');
  if(bp){
    var cur2 = bp.value;
    var html2 = '<option value="">Все темы</option>';
    bankState.meta.presetTopics.forEach(function(t){
      html2 += '<option value="'+esc(t)+'"'+(t===cur2?' selected':'')+'>'+esc(t)+'</option>';
    });
    bankState.meta.topics.forEach(function(t){
      if(bankState.meta.presetTopics.indexOf(t)<0){
        html2 += '<option value="'+esc(t)+'"'+(t===cur2?' selected':'')+'>'+esc(t)+'</option>';
      }
    });
    bp.innerHTML = html2;
  }
  var dl = $('#bankTopicsList');
  if(dl){
    var html3 = '';
    bankState.meta.presetTopics.forEach(function(t){ html3 += '<option value="'+esc(t)+'"></option>'; });
    dl.innerHTML = html3;
  }
}

async function loadBankList(){
  var host=$('#bankList');if(!host)return;
  skeleton(host,4);
  try{
    var exam = $('#bankFilterExam') ? $('#bankFilterExam').value : '';
    var num = $('#bankFilterNum') ? $('#bankFilterNum').value : '0';
    var topic = $('#bankFilterTopic') ? $('#bankFilterTopic').value : '';
    var diff = $('#bankFilterDifficulty') ? $('#bankFilterDifficulty').value : '';
    var scope = $('#bankFilterScope') ? $('#bankFilterScope').value : 'all';
    var q = $('#bankSearch') ? $('#bankSearch').value.trim() : '';
    var params = '?examType='+encodeURIComponent(exam)+
                 '&examTask='+encodeURIComponent(num)+
                 '&topic='+encodeURIComponent(topic)+
                 '&difficulty='+encodeURIComponent(diff)+
                 '&scope='+encodeURIComponent(scope)+
                 '&q='+encodeURIComponent(q);
    var r = await api('/task-bank'+params);
    bankState.list = r.tasks || [];
    renderBankList();
    syncWidgetsActive();
  }catch(e){
    host.innerHTML = '<div class="card err">'+esc(e.message)+'</div>';
  }
}

function renderBankList(){
  var host=$('#bankList');if(!host)return;
  host.innerHTML='';
  if(!bankState.list.length){
    host.innerHTML='<div class="card"><div class="empty"><div class="icon">🗂️</div>Задач по фильтру не найдено.<br>Измените фильтры или добавьте новую задачу.</div></div>';
    return;
  }

  var byNum = {};
  bankState.list.forEach(function(t){
    var k = 'profile_' + (t.examTaskNumber || 0);
    (byNum[k] = byNum[k] || []).push(t);
  });

  var keys = Object.keys(byNum).sort(function(a,b){
    return parseInt(a.split('_')[1]) - parseInt(b.split('_')[1]);
  });

  keys.forEach(function(k){
    var num = parseInt(k.split('_')[1]);
    var group = byNum[k];
    var groupCard = document.createElement('div');
    groupCard.className = 'bank-group';

    var protos = group.filter(function(x){return x.isPrototype;});
    var variants = group.filter(function(x){return !x.isPrototype;});

    var head = document.createElement('div');
    head.className = 'bank-group-head';
    head.innerHTML = '<span class="pill blue">'+(num?'ЕГЭ профиль · №'+num:'Без номера')+'</span>'+
                     '<span class="muted">'+group.length+' задач · '+protos.length+' прототипов · '+variants.length+' вариаций</span>';
    groupCard.appendChild(head);

    var protoMap = {};
    protos.forEach(function(p){ protoMap[p.id] = { proto: p, variants: [] }; });

    var orphan = [];
    variants.forEach(function(v){
      if (v.prototypeId && protoMap[v.prototypeId]) protoMap[v.prototypeId].variants.push(v);
      else orphan.push(v);
    });

    Object.keys(protoMap).forEach(function(pid){
      var node = protoMap[pid];
      groupCard.appendChild(renderPrototypeBlock(node.proto, node.variants));
    });

    if (orphan.length) {
      var orphanBlock = document.createElement('div');
      orphanBlock.className = 'orphan-variants';
      var oh = document.createElement('div');
      oh.className = 'muted';
      oh.style.cssText = 'padding:8px 12px;font-size:13px;margin:8px 0 4px';
      oh.textContent = 'Вариации без прототипа:';
      orphanBlock.appendChild(oh);
      orphan.forEach(function(t){ orphanBlock.appendChild(renderBankTaskCard(t, true)); });
      groupCard.appendChild(orphanBlock);
    }

    host.appendChild(groupCard);
  });
}

function renderPrototypeBlock(proto, variants){
  var wrap = document.createElement('div');
  wrap.className = 'proto-block';

  wrap.appendChild(renderBankTaskCard(proto, false));

  if (!variants.length) {
    var hint = document.createElement('div');
    hint.className = 'muted proto-empty-hint';
    hint.textContent = 'Вариаций пока нет. Нажмите «🎲 Генерировать» выше.';
    wrap.appendChild(hint);
    return wrap;
  }

  var header = document.createElement('div');
  header.className = 'variants-header';
  var btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'variants-toggle';
  btn.innerHTML = '📎 Вариации ('+variants.length+') <span class="caret">▾</span>';
  header.appendChild(btn);

  var list = document.createElement('div');
  list.className = 'variants-list';
  list.hidden = true;

  variants.sort(function(a,b){ return (a.variantIndex||0)-(b.variantIndex||0); });
  variants.forEach(function(v){ list.appendChild(renderBankTaskCard(v, true)); });

  btn.onclick = function(){
    list.hidden = !list.hidden;
    btn.querySelector('.caret').textContent = list.hidden ? '▾' : '▴';
  };

  wrap.appendChild(header);
  wrap.appendChild(list);
  return wrap;
}

/* ==========================================================
   КАРТОЧКА ЗАДАЧИ В СТИЛЕ UCHUS.ONLINE
   - Шапка с №, темами, сложностью (Легко/Средне/Сложно)
   - Условие (+ чертёж, если есть)
   - Поле ответа или радио-варианты
   - Кнопки «Ответить», «Решение», «Изменить», «Удалить», «🎲»
   - Результат и решение — раскрываются в самой карточке
   ========================================================== */
function renderBankTaskCard(t, isVariant){
  var card = document.createElement('div');
  card.className = 'bank-task' + (isVariant ? ' bank-task-variant' : '');
  if (t.isPrototype) card.classList.add('bank-task-proto-card');

  /* --- Шапка --- */
  var header = document.createElement('div');
  header.className = 'bank-task-header';
  var numLabel = t.examTaskNumber ? '№' + t.examTaskNumber : '—';
  var diffColor = {easy: 'var(--ok)', medium: 'var(--warn)', hard: 'var(--err)'}[t.difficulty] || 'var(--warn)';
  header.innerHTML =
    '<div class="bank-task-num">'+numLabel+'</div>' +
    '<div class="bank-task-header-meta">' +
      (t.topic ? '<span class="pill">'+esc(t.topic)+'</span>' : '') +
      (t.isPrototype ? '<span class="pill blue">📘 прототип ФИПИ</span>' : '') +
      (t.variantIndex ? '<span class="pill">вариант '+t.variantIndex+'</span>' : '') +
      '<span class="pill">'+(t.points||1)+' б.</span>' +
      (t.isPublic ? '<span class="pill green">публичная</span>' : '') +
    '</div>' +
    '<div class="bank-task-diff"><span class="diff-badge" style="background:'+diffColor+'">'+difficultyLabel(t.difficulty)+'</span></div>';
  card.appendChild(header);

  /* --- Условие --- */
  var body = document.createElement('div');
  body.className = 'bank-task-body';
  var stmt = createMathInput(t.statement, true);
  body.appendChild(stmt.el);
  card.appendChild(body);

  /* --- Поле ответа + кнопки --- */
  var answerBlock = document.createElement('div');
  answerBlock.className = 'bank-task-answer';

  if (t.type === 'input') {
    var inputRow = document.createElement('div');
    inputRow.className = 'bank-task-input-row';
    var label = document.createElement('span');
    label.className = 'bank-task-input-label';
    label.textContent = 'Введите ответ (число):';
    var ansInput = document.createElement('input');
    ansInput.type = 'text';
    ansInput.className = 'bank-task-input';
    ansInput.placeholder = 'Например: 5';
    ansInput.autocomplete = 'off';
    inputRow.appendChild(label);
    inputRow.appendChild(ansInput);
    answerBlock.appendChild(inputRow);
    card._answerInput = ansInput;
  } else {
    var choices = document.createElement('div');
    choices.className = 'bank-task-choices';
    (t.options || []).forEach(function(opt, i){
      var lab = document.createElement('label');
      lab.className = 'bank-task-choice';
      var rd = document.createElement('input');
      rd.type = 'radio';
      rd.name = 'bt_' + t.id;
      rd.value = i;
      lab.appendChild(rd);
      var txt = document.createElement('span');
      txt.textContent = opt.text || '';
      lab.appendChild(txt);
      choices.appendChild(lab);
    });
    answerBlock.appendChild(choices);
    card._choices = choices;
  }

  /* --- Кнопки --- */
  var btnRow = document.createElement('div');
  btnRow.className = 'bank-task-btn-row';

  var bAnswer = document.createElement('button');
  bAnswer.className = 'primary small';
  bAnswer.innerHTML = '<svg><use href="#i-check"/></svg> Ответить';
  bAnswer.onclick = function(){ checkBankTaskAnswer(card, t); };
  btnRow.appendChild(bAnswer);

  var bSolution = document.createElement('button');
  bSolution.className = 'small';
  bSolution.innerHTML = '📝 Решение';
  bSolution.onclick = function(){ revealBankTaskSolution(card, t); };
  btnRow.appendChild(bSolution);

  if (canEditBank() && (isAdmin() || (currentUser && t.ownerId === currentUser.id))) {
    var bEdit = document.createElement('button');
    bEdit.className = 'ghost small';
    bEdit.innerHTML = '<svg><use href="#i-edit"/></svg> Изменить';
    bEdit.onclick = function(){ openBankForm(t); };
    btnRow.appendChild(bEdit);

    var bDel = document.createElement('button');
    bDel.className = 'ghost small danger';
    bDel.innerHTML = '<svg><use href="#i-trash"/></svg> Удалить';
    bDel.onclick = async function(){
      if(!confirm('Удалить задачу?')) return;
      try{
        await api('/task-bank/'+t.id,{method:'DELETE'});
        toast('Удалено','ok');
        await loadBankList();
        refreshExamWidgets();
      } catch(e){ toast(e.message,'err'); }
    };
    btnRow.appendChild(bDel);

    if (t.isPrototype) {
      var bGen = document.createElement('button');
      bGen.className = 'ghost small';
      bGen.innerHTML = '🎲 Генерировать';
      bGen.title = 'Создать вариации с другими числами';
      bGen.onclick = function(){ generateVariantsForPrototype(t); };
      btnRow.appendChild(bGen);
    }
  }

  answerBlock.appendChild(btnRow);

  /* --- Результат и решение --- */
  var res = document.createElement('div');
  res.className = 'bank-task-result';
  res.hidden = true;
  card._resultEl = res;
  answerBlock.appendChild(res);

  var sol = document.createElement('div');
  sol.className = 'bank-task-solution';
  sol.hidden = true;
  card._solutionEl = sol;
  answerBlock.appendChild(sol);

  card.appendChild(answerBlock);
  return card;
}

function bankTaskNorm(s){
  return String(s || '').replace(/\\left|\\right/g,'')
    .replace(/[−–—]/g,'-').replace(/[×·]/g,'*').replace(/÷/g,'/')
    .replace(/\s+/g,'').replace(/,/g,'.').toLowerCase();
}

function checkBankTaskAnswer(card, t){
  var res = card._resultEl;
  var userAns = '', ok = false, correctText = '';

  if (t.type === 'input') {
    userAns = card._answerInput ? card._answerInput.value.trim() : '';
    if (!userAns) { toast('Введите ответ', 'warn'); return; }
    var sn = Number(bankTaskNorm(userAns));
    var cn = Number(bankTaskNorm(t.answer));
    if (isFinite(sn) && isFinite(cn)) {
      ok = Math.abs(sn - cn) <= (t.tolerance || 1e-6);
    } else {
      ok = bankTaskNorm(userAns) === bankTaskNorm(t.answer);
    }
    correctText = t.answer;
  } else {
    var rd = card._choices ? card._choices.querySelector('input[type=radio]:checked') : null;
    if (!rd) { toast('Выберите вариант', 'warn'); return; }
    ok = Number(rd.value) === Number(t.correctIndex);
    correctText = t.options && t.options[t.correctIndex] ? t.options[t.correctIndex].text : '';
  }

  res.hidden = false;
  if (ok) {
    res.className = 'bank-task-result ok';
    res.innerHTML = '<b>✓ Верно!</b> <span class="muted">+' + (t.points||1) + ' б.</span>';
  } else {
    res.className = 'bank-task-result err';
    res.innerHTML = '<b>✗ Неверно.</b> Правильный ответ: <code>' + esc(correctText) + '</code>';
  }

  if (card._answerInput) card._answerInput.disabled = true;
  if (card._choices) {
    Array.prototype.forEach.call(card._choices.querySelectorAll('input'), function(r){ r.disabled = true; });
  }
}

async function revealBankTaskSolution(card, t){
  var sol = card._solutionEl;
  if (!sol.hidden) { sol.hidden = true; return; }

  sol.hidden = false;
  sol.innerHTML = '<div class="muted">Загрузка…</div>';

  var text = t.solution;
  if (!text) {
    try {
      var r = await api('/task-bank/' + t.id + '?reveal=1');
      text = r.task.solution;
      t.solution = text;
    } catch (e) {
      sol.innerHTML = '<div class="err">Ошибка: ' + esc(e.message) + '</div>';
      return;
    }
  }

  if (!text) {
    sol.innerHTML = '<div class="muted">Решение для этой задачи пока не добавлено.</div>';
    return;
  }

  sol.innerHTML = '<div class="bank-task-solution-title">📝 Решение</div>';
  var body = document.createElement('div');
  body.className = 'bank-task-solution-body';
  renderMixedText(body, text);
  sol.appendChild(body);
}

/* ==========================================================
   АДМИН: ОЧИСТКА / СБРОС / СТАТИСТИКА БАНКА
   ========================================================== */
async function resetTaskBank(){
  if (!confirm('⚠️ СБРОСИТЬ БАНК ЗАДАНИЙ?\n\nВсе задачи будут удалены и заново загружены прототипы ФИПИ.\nЭто необратимо.')) return;
  if (!confirm('Точно? Все текущие задачи пропадут.')) return;
  try {
    var r = await api('/admin/task-bank/reset', { method: 'POST' });
    toast('Готово: удалено ' + r.deleted + ', загружено: ' + r.seeded, 'ok');
    refreshBankStats();
    if ($('#view-taskbank').classList.contains('active')) {
      await loadBankList();
      refreshExamWidgets();
    }
  } catch (e) { toast(e.message, 'err'); }
}

async function clearTaskBank(){
  if (!confirm('⚠️ ОЧИСТИТЬ БАНК ЗАДАНИЙ?\n\nВсе задачи будут удалены безвозвратно (без пересева).')) return;
  try {
    var r = await api('/admin/task-bank/clear', { method: 'POST' });
    toast('Удалено задач: ' + r.deleted, 'ok');
    refreshBankStats();
    if ($('#view-taskbank').classList.contains('active')) {
      await loadBankList();
      refreshExamWidgets();
    }
  } catch (e) { toast(e.message, 'err'); }
}

async function refreshBankStats(){
  var el = $('#bankStatsBox');
  if (!el) return;
  try {
    var r = await api('/admin/task-bank/stats');
    el.innerHTML = '<b>' + r.total + '</b> задач · ' +
                   '<b style="color:var(--accent)">' + r.prototypes + '</b> прототипов · ' +
                   '<b>' + r.variants + '</b> вариаций';
  } catch (e) {
    console.warn('refreshBankStats:', e.message);
    el.textContent = '—';
  }
}

async function generateVariantsForPrototype(proto){
  var n = prompt('Сколько вариаций сгенерировать для этого прототипа?\n(1–200, рекомендуется 20–40)', '20');
  if (!n) return;
  n = parseInt(n);
  if (!n || n < 1 || n > 200) { toast('Нужно число от 1 до 200', 'warn'); return; }

  toast('Генерация... подождите 20–60 секунд', 'info');
  try {
    var r = await api('/admin/generate-tasks', {
      method: 'POST',
      body: { n: n, prototypeId: proto.id }
    });
    toast('Добавлено вариаций: ' + r.added + (r.failed ? ' · ошибок: ' + r.failed : ''), 'ok');
    await loadBankList();
    refreshExamWidgets();
    refreshBankStats();
  } catch (e) { toast(e.message, 'err'); }
}

/* ==========================================================
   ЗАГРУЗКА ЧЕРТЕЖЕЙ К ЗАДАЧАМ
   ========================================================== */
function renderBankFigurePreview(){
  var box = $('#bankFigurePreview');
  var nameEl = $('#bankFigureName');
  var clearBtn = $('#btnBankFigureClear');
  if (!box) return;

  if (!bankState.figureUrl) {
    box.hidden = true;
    box.innerHTML = '';
    if (nameEl) nameEl.textContent = '';
    if (clearBtn) clearBtn.hidden = true;
    return;
  }

  box.hidden = false;
  if (bankState.figureUrl.indexOf('inline:') === 0) {
    box.innerHTML = bankState.figureUrl.slice(7);
    if (nameEl) nameEl.textContent = 'SVG (встроенный)';
  } else {
    box.innerHTML = '<img src="' + bankState.figureUrl + '" alt="Чертёж">';
    if (nameEl) nameEl.textContent = bankState.figureUrl.split('/').pop();
  }
  if (clearBtn) clearBtn.hidden = false;
}

function clearBankFigure(){
  bankState.figureUrl = null;
  renderBankFigurePreview();
  var inp = $('#bankFigureInput');
  if (inp) inp.value = '';
}

async function uploadBankFigure(file){
  if (!file) return;
  if (file.size > 5 * 1024 * 1024) {
    toast('Файл больше 5 МБ', 'warn');
    return;
  }
  var fd = new FormData();
  fd.append('figure', file);
  try {
    toast('Загрузка чертежа...', 'info');
    var r = await apiForm('/task-bank/upload-figure', fd);
    bankState.figureUrl = r.url;
    renderBankFigurePreview();
    toast('Чертёж загружен', 'ok');
  } catch (e) {
    toast(e.message, 'err');
  }
}

/* ==========================================================
   ФОРМА ЗАДАЧИ БАНКА
   ========================================================== */
function initBankFormFields(){
  if(bankState.statementInput) return;
  var sh=$('#bankStatementHost'), ah=$('#bankAnswerHost');
  if(!sh||!ah) return;
  bankState.statementInput = createMathInput('', false);
  bankState.answerInput = createMathInput('', false);
  sh.appendChild(bankState.statementInput.el);
  ah.appendChild(bankState.answerInput.el);
  buildBankSymbolBar($('#bankSymbolBar'));
  bankAddOption(); bankAddOption();
  var tt = $('#bankTaskType');
  if(tt) tt.onchange = function(){
    var isInput = tt.value==='input';
    $('#bankInputBlock').hidden = !isInput;
    $('#bankChoiceBlock').hidden = isInput;
  };
  var bao = $('#btnBankAddOption'); if(bao) bao.onclick = bankAddOption;
}

function bankAddOption(){
  var ol=$('#bankOptionsList'); if(!ol) return;
  var row=document.createElement('div'); row.className='option-row';
  var r=document.createElement('input'); r.type='radio'; r.name='bankCorrectOpt';
  var mi=createMathInput('', false);
  var d=document.createElement('button'); d.type='button'; d.className='ghost small'; d.textContent='✕';
  d.onclick=function(){ row.remove(); };
  row.appendChild(r); row.appendChild(mi.el); row.appendChild(d);
  ol.appendChild(row);
}

function openBankForm(task){
  if(!canUseBank()) return;
  initBankFormFields();
  bankState.editingId = task ? task.id : null;
  $('#bankForm').hidden = false;
  $('#bankFormTitle').textContent = task ? 'Редактирование задачи' : 'Новая задача';
  $('#bankErr').textContent = '';
  $('#bankExamType').value = 'profile';
  fillBankNumSelect($('#bankExamTaskNumber'), 'profile', task ? task.examTaskNumber : 0);
  $('#bankTopic').value = (task && task.topic) || '';
  $('#bankDifficulty').value = (task && task.difficulty) || 'medium';
  $('#bankTaskType').value = (task && task.type) || 'input';
  bankState.statementInput.setValue(task ? task.statement : '');
  bankState.answerInput.setValue(task && task.type==='input' ? (task.answer||'') : '');
  $('#bankTol').value = (task && task.tolerance) || '1e-6';
  $('#bankPoints').value = (task && task.points) || 1;
  $('#bankIsPublic').checked = !!(task && task.isPublic);

  var ol = $('#bankOptionsList');
  ol.innerHTML = '';
  if(task && task.type==='choice' && Array.isArray(task.options)){
    task.options.forEach(function(o, i){
      var row=document.createElement('div'); row.className='option-row';
      var r=document.createElement('input'); r.type='radio'; r.name='bankCorrectOpt';
      r.checked = (i === task.correctIndex);
      var mi=createMathInput(o.text || '', false);
      var d=document.createElement('button'); d.type='button'; d.className='ghost small'; d.textContent='✕';
      d.onclick=function(){ row.remove(); };
      row.appendChild(r); row.appendChild(mi.el); row.appendChild(d);
      ol.appendChild(row);
    });
  } else {
    bankAddOption(); bankAddOption();
  }
  $('#bankTaskType').onchange();

  if ($('#bankIsPrototype')) $('#bankIsPrototype').checked = !!(task && task.isPrototype);
  if ($('#bankPrototypeId')) $('#bankPrototypeId').value = (task && task.prototypeId) || '';
  if ($('#bankSolutionInput')) $('#bankSolutionInput').value = (task && task.solution) || '';

  /* Чертёж: вытаскиваем URL из statement, если он там уже вшит */
  bankState.figureUrl = null;
  var stmtRaw = (task && task.statement) || '';
  var figRe = /<div class="task-figure">\s*<img[^>]*src="([^"]+)"/i;
  var m = stmtRaw.match(figRe);
  if (m) {
    bankState.figureUrl = m[1];
    var stripped = stmtRaw.replace(/<div class="task-figure">[\s\S]*?<\/div>\s*/i, '').trim();
    if (bankState.statementInput) bankState.statementInput.setValue(stripped);
  } else if (task && task.figureSvg) {
    /* Старый формат — SVG в отдельном поле */
    bankState.figureUrl = 'inline:' + task.figureSvg;
  }
  renderBankFigurePreview();

  $('#bankForm').scrollIntoView({behavior:'smooth', block:'start'});
}

function closeBankForm(){
  $('#bankForm').hidden = true;
  bankState.editingId = null;
  bankState.figureUrl = null;
  $('#bankErr').textContent = '';
  renderBankFigurePreview();
}

async function saveBankTask(){
  var err=$('#bankErr'); if(err) err.textContent='';
  var statement = bankState.statementInput ? bankState.statementInput.getValue().trim() : '';
  if(!statement){ err.textContent='Введите условие задачи'; return; }
  var type = $('#bankTaskType').value;

  /* Вшиваем чертёж прямо в statement */
  var finalStatement = statement;
  if (bankState.figureUrl) {
    var figureHtml;
    if (bankState.figureUrl.indexOf('inline:') === 0) {
      figureHtml = bankState.figureUrl.slice(7);
    } else {
      figureHtml = '<img src="' + bankState.figureUrl + '" alt="Чертёж">';
    }
    finalStatement = '<div class="task-figure">' + figureHtml + '</div>\n' + statement;
  }

  var body = {
    examType: 'profile',
    examTaskNumber: parseInt($('#bankExamTaskNumber').value) || null,
    topic: $('#bankTopic').value.trim() || null,
    difficulty: $('#bankDifficulty').value,
    statement: finalStatement,
    type: type,
    points: Math.max(0.5, Number($('#bankPoints').value) || 1),
    isPublic: $('#bankIsPublic').checked,
    isPrototype: $('#bankIsPrototype') ? $('#bankIsPrototype').checked : false,
    prototypeId: $('#bankPrototypeId') ? ($('#bankPrototypeId').value.trim() || null) : null,
    solution: $('#bankSolutionInput') ? $('#bankSolutionInput').value.trim() : null,
    figureSvg: null
  };
  if(type === 'input'){
    var ans = bankState.answerInput ? bankState.answerInput.getValue().trim() : '';
    if(!ans){ err.textContent='Введите правильный ответ'; return; }
    body.answer = ans;
    body.tolerance = parseFloat($('#bankTol').value) || 1e-6;
  } else {
    var rows = $$('#bankOptionsList .option-row');
    if(rows.length < 2){ err.textContent='Нужно минимум 2 варианта'; return; }
    var opts = rows.map(function(r){ return { text: r.querySelector('.mi-input').value }; });
    var ci = rows.findIndex(function(r){ return r.querySelector('input[type=radio]').checked; });
    if(ci < 0){ err.textContent='Отметьте правильный вариант'; return; }
    body.options = opts;
    body.correctIndex = ci;
  }
  var btn = $('#btnBankSave'); btn.disabled = true;
  try{
    if(bankState.editingId){
      await api('/task-bank/'+bankState.editingId, { method:'PUT', body: body });
      toast('Задача обновлена','ok');
    } else {
      await api('/task-bank', { method:'POST', body: body });
      toast('Задача добавлена','ok');
    }
    closeBankForm();
    try{
      var m = await api('/task-bank/meta');
      bankState.meta.topics = m.topics || [];
      fillTopicSelects();
    }catch(e){}
    await loadBankList();
    refreshExamWidgets();
  }catch(e){ err.textContent = e.message; toast(e.message,'err'); }
  finally{ btn.disabled = false; }
}

/* --- БАНК: ПИКЕР (выбор задач в работу) --- */
async function openBankPicker(){
  if(!canUseBank()) return;
  bankState.pickerSelected = {};
  var modal = $('#bankPickerModal');
  if(!modal) return;
  modal.hidden = false;
  fillBankNumSelect($('#bpNum'), 'profile', 0);
  try{
    if(!bankState.meta.topics.length){
      var m = await api('/task-bank/meta');
      bankState.meta.topics = m.topics || [];
      bankState.meta.presetTopics = m.presetTopics || [];
      fillTopicSelects();
    }
  }catch(e){}
  await loadBankPickerList();
}
function closeBankPicker(){
  var modal = $('#bankPickerModal');
  if(modal) modal.hidden = true;
}
async function loadBankPickerList(){
  var host=$('#bpList'); if(!host) return;
  skeleton(host, 4);
  try{
    var exam = $('#bpExam') ? $('#bpExam').value : '';
    var num = $('#bpNum') ? $('#bpNum').value : '0';
    var topic = $('#bpTopic') ? $('#bpTopic').value : '';
    var diff = $('#bpDifficulty') ? $('#bpDifficulty').value : '';
    var scope = $('#bpScope') ? $('#bpScope').value : 'all';
    var q = $('#bpSearch') ? $('#bpSearch').value.trim() : '';
    var params = '?examType='+encodeURIComponent(exam)+
                 '&examTask='+encodeURIComponent(num)+
                 '&topic='+encodeURIComponent(topic)+
                 '&difficulty='+encodeURIComponent(diff)+
                 '&scope='+encodeURIComponent(scope)+
                 '&q='+encodeURIComponent(q);
    var r = await api('/task-bank'+params);
    bankState.pickerList = r.tasks || [];
    renderBankPickerList();
  }catch(e){
    host.innerHTML='<div class="err" style="padding:20px">'+esc(e.message)+'</div>';
  }
}
function renderBankPickerList(){
  var host=$('#bpList'); if(!host) return;
  host.innerHTML='';
  if(!bankState.pickerList.length){
    host.innerHTML='<div class="empty" style="padding:32px">Ничего не найдено</div>';
    updateBankPickerCount();
    return;
  }
  bankState.pickerList.forEach(function(t){
    var el=document.createElement('label');
    el.className='bank-pick-item';
    var cb=document.createElement('input');
    cb.type='checkbox';
    cb.checked = !!bankState.pickerSelected[t.id];
    cb.onchange=function(){
      if(cb.checked) bankState.pickerSelected[t.id] = true;
      else delete bankState.pickerSelected[t.id];
      updateBankPickerCount();
    };
    el.appendChild(cb);
    var body=document.createElement('div');
    body.className='bank-pick-body';
    var meta=[];
    meta.push('<span class="pill blue">'+(t.examTaskNumber?'№'+t.examTaskNumber:'—')+'</span>');
    if(t.topic) meta.push('<span class="pill">'+esc(t.topic)+'</span>');
    meta.push('<span class="pill" style="color:'+difficultyColor(t.difficulty)+'">'+difficultyLabel(t.difficulty)+'</span>');
    meta.push('<span class="pill">'+(t.points||1)+' б.</span>');
    body.innerHTML = '<div class="bank-pick-meta">'+meta.join(' ')+'</div>'+
                     '<div class="bank-pick-stmt">'+esc((t.statement||'').slice(0,180))+'</div>';
    el.appendChild(body);
    host.appendChild(el);
  });
  updateBankPickerCount();
}
function updateBankPickerCount(){
  var n = Object.keys(bankState.pickerSelected).length;
  var el = $('#bpCount');
  if(el) el.textContent = 'Выбрано: ' + n;
}
function addSelectedToDraft(){
  var ids = Object.keys(bankState.pickerSelected);
  if(!ids.length){ toast('Ничего не выбрано','warn'); return; }
  var added = 0;
  ids.forEach(function(id){
    var t = bankState.pickerList.find(function(x){ return x.id===id; });
    if(!t) return;
    var task = {
      id: uid(),
      type: t.type,
      statement: t.statement,
      points: t.points || 1
    };
    if(t.type === 'input'){
      task.answer = t.answer || '';
      task.tolerance = t.tolerance || 1e-6;
    } else {
      task.options = (t.options||[]).map(function(o){ return { text: o.text }; });
      task.correctIndex = t.correctIndex || 0;
    }
    draftTasks.push(task);
    added++;
  });
  renderDraft();
  closeBankPicker();
  toast('Добавлено задач: '+added, 'ok');
}

async function saveCurrentToBank(){
  var statement = stmtInput ? stmtInput.getValue().trim() : '';
  if(!statement){ toast('Сначала введите условие задания','warn'); return; }
  var type = $('#taskType').value;
  var body = {
    examType: 'profile',
    examTaskNumber: null,
    topic: null,
    difficulty: 'medium',
    statement: statement,
    type: type,
    points: Math.max(0.5, Number($('#taskPoints').value) || 1),
    isPublic: false
  };
  if(type==='input'){
    var a = ansInput ? ansInput.getValue().trim() : '';
    if(!a){ toast('Введите правильный ответ','warn'); return; }
    body.answer = a;
    body.tolerance = parseFloat($('#taskTol').value) || 1e-6;
  } else {
    var rows = $$('#optionsList .option-row');
    if(rows.length<2){ toast('Нужно 2+ варианта','warn'); return; }
    body.options = rows.map(function(r){ return { text: r.querySelector('.mi-input').value }; });
    body.correctIndex = rows.findIndex(function(r){ return r.querySelector('input[type=radio]').checked; });
    if(body.correctIndex < 0){ toast('Отметьте правильный','warn'); return; }
  }
  try{
    await api('/task-bank',{ method:'POST', body: body });
    toast('Сохранено в банк','ok');
  }catch(e){ toast(e.message,'err'); }
}
  /* CLASS VIEW */
async function openClassView(id){
  currentClassId=id;show('view-class');
  skeleton($('#classStudents'),2);skeleton($('#classGroups'),2);skeleton($('#classTests'),2);
  var cb=$('#chatBox');if(cb)cb.style.display='none';
  $('#csvResultBox').hidden=true;
  var bic=$('#btnImportCsv');if(bic)bic.hidden=!isTeacherLike();
  var bca=$('#btnClassAnalytics');if(bca)bca.hidden=!isTeacherLike();
  var bcr=$('#btnClassRating');if(bcr)bcr.hidden=false;
  try{
    var r=await api('/classes/'+id);
    $('#classTitle').textContent=r.class.name;
    var codeBig=$('#classCodeBig');
    codeBig.textContent=r.class.code;
    codeBig.style.cursor='pointer';
    codeBig.onclick=function(){
      copyToClipboard(r.class.code).then(function(ok){
        var old=codeBig.textContent;
        codeBig.textContent = ok ? '✓ скопировано' : r.class.code;
        toast(ok?'Код скопирован':'Скопируйте вручную: '+r.class.code, ok?'ok':'warn');
        setTimeout(function(){codeBig.textContent=old==='✓ скопировано'?r.class.code:old;},1000);
      });
    };
    var bci=$('#btnCopyInvite');
    if(bci)bci.onclick=function(){
      var url=location.origin+location.pathname+'?join='+r.class.code;
      copyToClipboard(url).then(function(ok){
        toast(ok?'Ссылка скопирована':'Скопируйте вручную: '+url, ok?'ok':'warn');
      });
    };
    var stu=$('#classStudents');stu.innerHTML='';
    $('#classStuCount').textContent=r.students.length;
    if(!r.students.length){
      stu.innerHTML='<div class="empty" style="padding:40px 20px"><div class="icon">👥</div>Пока нет учеников.<br>Код: <b>'+esc(r.class.code)+'</b></div>';
    }
    r.students.forEach(function(u){
      var el=document.createElement('div');el.className='stu-row';
      var groupsHtml=(u.groupIds||[]).map(function(gid){
        var g=(r.class.groups||[]).find(function(x){return x.id===gid;});
        return g?'<span class="pill blue">'+esc(g.name)+'</span>':'';
      }).join('');
      var tg=u.hasTelegram?' <span class="pill green" title="Telegram">✈️</span>':'';
      el.innerHTML='<div class="avatar"></div>'+
        '<div class="name"><div style="font-weight:600">'+esc(u.name)+' '+groupsHtml+tg+'</div>'+
        '<div class="muted">'+esc(u.email)+'</div></div>';
      renderAvatar(el.querySelector('.avatar'),u,36);
      var b=document.createElement('button');b.className='ghost small danger';b.textContent='Исключить';
      b.onclick=async function(){if(!confirm('Исключить '+u.name+'?'))return;try{await api('/classes/'+id+'/students/'+u.id,{method:'DELETE'});openClassView(id);}catch(e){toast(e.message,'err');}};
      if(isTeacherLike())el.appendChild(b);
      stu.appendChild(el);
    });
    var gr=$('#classGroups');gr.innerHTML='';
    if(!(r.class.groups||[]).length) gr.innerHTML='<div class="empty" style="padding:24px">Подгрупп пока нет</div>';
    (r.class.groups||[]).forEach(function(g){
      var el=document.createElement('div');el.className='group-card';
      el.innerHTML='<div class="gc-head"><h5>'+esc(g.name)+'</h5><span class="pill">'+(g.studentIds||[]).length+'</span></div>';
      var chips=document.createElement('div');chips.className='gc-students';
      (g.studentIds||[]).forEach(function(sid){
        var u=r.students.find(function(x){return x.id===sid;});if(!u)return;
        var chip=document.createElement('span');chip.className='group-chip';
        chip.innerHTML=esc(u.name)+' <button title="Убрать">✕</button>';
        chip.querySelector('button').onclick=async function(){try{await api('/classes/'+id+'/groups/'+g.id+'/students/'+sid,{method:'DELETE'});openClassView(id);}catch(e){toast(e.message,'err');}};
        chips.appendChild(chip);
      });
      if(isTeacherLike()){
        var notIn=r.students.filter(function(u){return !(g.studentIds||[]).includes(u.id);});
        if(notIn.length){
          var sel=document.createElement('select');
          sel.style.cssText='width:auto;padding:6px 12px';
          sel.innerHTML='<option value="">+ добавить...</option>'+notIn.map(function(u){return '<option value="'+u.id+'">'+esc(u.name)+'</option>';}).join('');
          sel.onchange=async function(){if(!sel.value)return;try{await api('/classes/'+id+'/groups/'+g.id+'/students/'+sel.value,{method:'POST'});openClassView(id);}catch(e){toast(e.message,'err');}};
          chips.appendChild(sel);
        }
      }
      el.appendChild(chips);
      if(isTeacherLike()){
        var del=document.createElement('button');del.className='ghost small danger';del.textContent='Удалить подгруппу';del.style.marginTop='12px';
        del.onclick=async function(){if(!confirm('Удалить подгруппу «'+g.name+'»?'))return;try{await api('/classes/'+id+'/groups/'+g.id,{method:'DELETE'});openClassView(id);}catch(e){toast(e.message,'err');}};
        el.appendChild(del);
      }
      gr.appendChild(el);
    });
    var oldB=$('#btnBroadcast');if(oldB)oldB.remove();
    if(isTeacherLike()){
      var bb=document.createElement('button');
      bb.id='btnBroadcast';bb.className='primary small';bb.textContent='Разослать в Telegram';bb.style.marginTop='14px';
      bb.onclick=async function(){
        var msg=prompt('Сообщение всем ученикам группы в Telegram:');
        if(!msg||!msg.trim())return;
        try{var res=await api('/classes/'+id+'/broadcast',{method:'POST',body:{message:msg.trim()}});
          var text='Отправлено: '+res.sent;
          if(res.failed)text+=' · ошибок: '+res.failed;
          if(res.withoutTelegram)text+=' · без Telegram: '+res.withoutTelegram;
          toast(text,'ok');
        }catch(e){toast(e.message,'err');}
      };
      $('#classGroups').parentNode.appendChild(bb);
    }
    var cardTests = $('#classTestsCard');
    if(cardTests) cardTests.hidden = !isTeacherLike();

    var ts=$('#classTests');ts.innerHTML='';
    if(!r.tests.length)ts.innerHTML='<div class="empty" style="padding:32px">Этой группе ещё не назначено работ.</div>';
    r.tests.forEach(function(t){
      var el=document.createElement('div');el.className='test-card';
      var gi=t.groupIds&&t.groupIds.length?' · подгруппы: '+t.groupIds.map(function(gid){var g=(r.class.groups||[]).find(function(x){return x.id===gid;});return g?esc(g.name):'?';}).join(', '):'';
      el.innerHTML='<div class="row tight"><h4 style="flex:1;margin:0">'+esc(t.title)+'</h4>'+
        (t.unseen?'<span class="badge red">'+t.unseen+'</span>':'')+'</div>'+
        '<div class="meta">Сдали: '+t.submitted+' из '+t.total+gi+'</div>';
      var b=document.createElement('button');b.className='primary small';b.textContent='Открыть';
      b.onclick=async function(){try{var rr=await api('/tests');var full=rr.tests.find(function(x){return x.id===t.id;});if(full)showSubmissions(full);}catch(e){toast(e.message,'err');}};
      el.appendChild(b);ts.appendChild(el);
    });
    if(cb){cb.style.display='';lastChatTime=0;await loadChatMessages(id,true);
      if(chatPollTimer)clearInterval(chatPollTimer);
      chatPollTimer=setInterval(function(){loadChatMessages(id,false);},4000);
    }
  }catch(e){toast(e.message,'err');}
}

async function openClassAnalytics(){
  if(!currentClassId||!isTeacherLike())return;
  show('view-analytics');
  var host=$('#analyticsBody');skeleton(host,6);
  try{
    var r=await api('/classes/'+currentClassId+'/analytics');
    var cls=await api('/classes/'+currentClassId);
    host.innerHTML='';
    var h1=document.createElement('div');
    h1.innerHTML='<h2 style="margin-bottom:24px">'+esc(cls.class.name)+'</h2>';
    host.appendChild(h1);
    var grid=document.createElement('div');grid.className='analytics-grid';
    var valid=r.perStudent.filter(function(x){return x.avgPercent!==null;});
    var avgAll=valid.length?Math.round(valid.reduce(function(s,x){return s+x.avgPercent;},0)/valid.length):0;
    [['Учеников',r.totalStudents,false],['Работ',r.totalTests,false],['Средний балл',avgAll+'%',true]].forEach(function(k){
      var c=document.createElement('div');c.className='analytics-kpi';
      c.innerHTML='<div class="ak-label">'+k[0]+'</div><div class="ak-value'+(k[2]?' accent':'')+'">'+k[1]+'</div>';
      grid.appendChild(c);
    });
    host.appendChild(grid);
    if(r.hardTasks.length){
      var hardCard=document.createElement('div');hardCard.className='card';
      hardCard.innerHTML='<h3>Самые сложные задания</h3><div class="muted" style="margin-bottom:16px">Процент правильных ответов</div>';
      r.hardTasks.forEach(function(t){
        var color=t.pct>=75?'var(--ok)':(t.pct>=40?'var(--warn)':'var(--err)');
        var row=document.createElement('div');
        row.className='hard-task-row '+(t.pct>=75?'ok':(t.pct>=40?'warn':''));
        row.innerHTML='<div class="ht-body"><div class="ht-stmt">'+esc(t.statement)+'</div>'+
          '<div class="ht-bar"><div class="ht-fill" style="width:'+t.pct+'%;background:'+color+'"></div></div></div>'+
          '<div class="ht-pct" style="color:'+color+'">'+t.pct+'%</div>';
        hardCard.appendChild(row);
      });
      host.appendChild(hardCard);
    }
    var stCard=document.createElement('div');stCard.className='card';
    stCard.innerHTML='<h3>Ученики</h3>';
    var table=document.createElement('table');table.className='analytics-table';
    table.innerHTML='<thead><tr><th>Имя</th><th style="text-align:right">Сдано</th><th style="text-align:right">Из</th><th style="text-align:right">Средний</th></tr></thead>';
    var tbody=document.createElement('tbody');
    r.perStudent.forEach(function(s){
      var tr=document.createElement('tr');
      var color=s.avgPercent===null?'var(--text-3)':(s.avgPercent>=80?'var(--ok)':(s.avgPercent>=60?'var(--warn)':'var(--err)'));
      tr.innerHTML='<td><b>'+esc(s.name)+'</b></td><td class="cell-num">'+s.submissions+'</td><td class="cell-num muted">'+s.totalTests+'</td><td class="cell-num" style="color:'+color+'">'+(s.avgPercent===null?'—':s.avgPercent+'%')+'</td>';
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);stCard.appendChild(table);host.appendChild(stCard);
    if(r.perTest.length){
      var tCard=document.createElement('div');tCard.className='card';
      tCard.innerHTML='<h3>Работы</h3>';
      var tb=document.createElement('table');tb.className='analytics-table';
      tb.innerHTML='<thead><tr><th>Работа</th><th style="text-align:right">Сдано</th><th style="text-align:right">Средний</th></tr></thead>';
      var tbody2=document.createElement('tbody');
      r.perTest.forEach(function(t){
        var tr=document.createElement('tr');
        var color=t.avgPercent>=80?'var(--ok)':(t.avgPercent>=60?'var(--warn)':'var(--err)');
        tr.innerHTML='<td><b>'+esc(t.title)+'</b></td><td class="cell-num">'+t.submissions+' / '+t.total+'</td><td class="cell-num" style="color:'+color+'">'+t.avgPercent+'%</td>';
        tbody2.appendChild(tr);
      });
      tb.appendChild(tbody2);tCard.appendChild(tb);host.appendChild(tCard);
    }
  }catch(e){host.innerHTML='<div class="card err">'+esc(e.message)+'</div>';}
}

async function openClassRating(){
  if(!currentClassId)return;
  show('view-rating');
  var host=$('#ratingBody');skeleton(host,6);
  try{
    var r=await api('/classes/'+currentClassId+'/rating');
    var cls=await api('/classes/'+currentClassId);
    host.innerHTML='';
    var h1=document.createElement('div');
    h1.innerHTML='<h2 style="margin-bottom:24px">'+esc(cls.class.name)+'</h2>';
    host.appendChild(h1);
    if(!r.rating.length){
      host.innerHTML+='<div class="card"><div class="empty"><div class="icon">🏆</div>Пока никто не сдал ни одной работы.</div></div>';
      return;
    }
    var podium=document.createElement('div');podium.className='rating-podium';
    var top3=r.rating.slice(0,3);
    var order=[top3[1],top3[0],top3[2]];
    var rankMap=[2,1,3];
    var medalMap={1:'🥇',2:'🥈',3:'🥉'};
    var classMap={1:'first',2:'second',3:'third'};
    order.forEach(function(u,i){
      if(!u)return;
      var rank=rankMap[i];
      var el=document.createElement('div');el.className='podium-item '+classMap[rank];
      var medal=document.createElement('div');medal.className='podium-medal';medal.textContent=medalMap[rank];
      el.appendChild(medal);
      var av=document.createElement('div');av.className='podium-avatar';av.style.background='var(--accent)';
      el.appendChild(av);renderAvatar(av,u,64);
      var nm=document.createElement('div');nm.className='podium-name';nm.textContent=u.name;el.appendChild(nm);
      var sc=document.createElement('div');sc.className='podium-score';sc.textContent=u.avgPercent+'%';el.appendChild(sc);
      var lb=document.createElement('div');lb.className='podium-label';lb.textContent=u.submissions+' сдач';el.appendChild(lb);
      podium.appendChild(el);
    });
    host.appendChild(podium);
    var list=document.createElement('div');list.className='card';
    list.innerHTML='<h3>Полный рейтинг</h3>';
    r.rating.forEach(function(u,i){
      var row=document.createElement('div');
      row.className='rating-row'+(currentUser&&u.id===currentUser.id?' me':'');
      row.innerHTML='<div class="rr-rank">#'+(i+1)+'</div><div class="rr-name">'+esc(u.name)+'</div><div class="rr-score">'+u.avgPercent+'%</div>';
      list.appendChild(row);
    });
    host.appendChild(list);
    if(r.myRank&&currentUser.role==='student'){
      var myRow=document.createElement('div');
      myRow.style.cssText='text-align:center;padding:20px;font-size:16px;font-weight:800;color:var(--accent)';
      myRow.textContent='Ваше место: #'+r.myRank;
      host.appendChild(myRow);
    }
  }catch(e){host.innerHTML='<div class="card err">'+esc(e.message)+'</div>';}
}

/* CHAT */
async function loadChatMessages(classId, reset){
  var box=$('#chatMessages');if(!box)return;
  try{
    var r=await api('/classes/'+classId+'/messages');
    var atBottom=box.scrollHeight-box.scrollTop-box.clientHeight<60;
    if(reset)box.innerHTML='';
    var fresh=r.messages.filter(function(m){return m.createdAt>lastChatTime;});
    fresh.forEach(function(m){
      var el=document.createElement('div');
      el.className='chat-msg'+(m.own?' own':'');
      el.dataset.mid=m.id;
      el.innerHTML='<div class="avatar"></div>'+
        '<div class="chat-msg-body">'+
          '<div class="chat-msg-head"><b>'+esc(m.userName)+'</b> · '+fmt(m.createdAt)+'</div>'+
          (m.text?'<div class="chat-msg-text">'+esc(m.text)+'</div>':'')+
          (m.hasFile?'<div class="chat-msg-file" onclick="downloadChatFile(\''+m.id+'\')">📎 '+esc(m.fileName||'файл')+' · '+fmtSize(m.fileSize)+'</div>':'')+
          (m.own?'<button class="chat-msg-del" title="Удалить" data-del="'+m.id+'">✕</button>':'')+
        '</div>';
      renderAvatar(el.querySelector('.avatar'),{id:m.userId,name:m.userName,hasAvatar:m.hasAvatar},38);
      if(m.own){
        var db=el.querySelector('[data-del]');
        if(db)db.onclick=async function(){if(!confirm('Удалить сообщение?'))return;try{await api('/messages/'+m.id,{method:'DELETE'});el.remove();}catch(e){toast(e.message,'err');}};
      }
      box.appendChild(el);
      lastChatTime=Math.max(lastChatTime,m.createdAt);
    });
    if(reset||atBottom)box.scrollTop=box.scrollHeight;
  }catch(e){}
}

window.downloadChatFile=function(mid){
  var tk=getToken();
  fetch('/api/messages/'+mid+'/file',{headers:{Authorization:'Bearer '+tk}})
    .then(function(r){if(!r.ok)throw new Error('Ошибка');return r.blob();})
    .then(function(b){window.open(URL.createObjectURL(b),'_blank');})
    .catch(function(e){toast(e.message,'err');});
};

async function sendChatMessage(){
  if(!currentClassId)return;
  var text=$('#chatText').value.trim();
  var fileInput=$('#chatFileInput');var file=fileInput.files[0];
  if(!text&&!file)return;
  var fd=new FormData();
  if(text)fd.append('text',text);
  if(file)fd.append('file',file);
  try{await apiForm('/classes/'+currentClassId+'/messages',fd);$('#chatText').value='';fileInput.value='';$('#chatFileName').textContent='';await loadChatMessages(currentClassId,false);}
  catch(e){toast(e.message,'err');}
}

/* CSV */
function openCsvPicker(){if(!currentClassId)return;$('#csvFileInput').click();}

async function uploadCsv(file){
  if(!file||!currentClassId)return;
  var fd=new FormData();fd.append('file',file);
  try{toast('Импорт...','info');var r=await apiForm('/classes/'+currentClassId+'/import-csv',fd);lastCsvResult=r;showCsvResult(r);openClassView(currentClassId);}
  catch(e){toast(e.message,'err');}
}

function showCsvResult(r){
  var box=$('#csvResultBox');if(!box)return;
  box.hidden=false;
  var host=$('#csvResult');host.innerHTML='';
  if(r.added.length){
    var block=document.createElement('div');block.className='csv-result-block';
    block.innerHTML='<h4>Добавлено новых: '+r.added.length+'</h4>';
    r.added.forEach(function(u){
      var el=document.createElement('div');el.className='stu-row';
      el.innerHTML='<div class="avatar">'+esc((u.name[0]||'?').toUpperCase())+'</div>'+
        '<div class="name"><div style="font-weight:600">'+esc(u.name)+'</div><div class="muted">'+esc(u.email)+'</div></div>'+
        '<span class="pill green" style="font-family:monospace;font-weight:700">'+esc(u.password||'')+'</span>';
      block.appendChild(el);
    });
    host.appendChild(block);
  }
  if(r.existing.length){
    var b2=document.createElement('div');b2.className='csv-result-block';
    b2.innerHTML='<h4>Уже существовали: '+r.existing.length+'</h4>';
    r.existing.slice(0,20).forEach(function(u){
      var el=document.createElement('div');el.className='stu-row';el.style.opacity='.7';
      el.innerHTML='<div class="avatar" style="background:var(--panel-2);color:var(--text-2)">'+esc((u.name[0]||'?').toUpperCase())+'</div>'+
        '<div class="name"><div>'+esc(u.name)+'</div><div class="muted">'+esc(u.email)+'</div></div>'+
        (u.note?'<span class="pill">'+esc(u.note)+'</span>':'');
      b2.appendChild(el);
    });
    host.appendChild(b2);
  }
  if(r.failed.length){
    var b3=document.createElement('div');b3.className='csv-result-block';
    b3.innerHTML='<h4>Ошибок: '+r.failed.length+'</h4>';
    r.failed.forEach(function(f){
      var el=document.createElement('div');el.className='stu-row';el.style.opacity='.7';
      el.innerHTML='<div class="muted">'+esc(f.line)+'</div><span class="pill red">'+esc(f.reason)+'</span>';
      b3.appendChild(el);
    });
    host.appendChild(b3);
  }
}

function downloadPasswords(){
  if(!lastCsvResult||!lastCsvResult.added||!lastCsvResult.added.length){toast('Нет новых паролей','warn');return;}
  var rows=[['Имя','Email','Пароль']];
  lastCsvResult.added.forEach(function(u){rows.push([u.name,u.email,u.password]);});
  var csv=rows.map(function(r){return r.map(function(v){v=String(v==null?'':v);if(v.includes(',')||v.includes('"'))return '"'+v.replace(/"/g,'""')+'"';return v;}).join(',');}).join('\r\n');
  var blob=new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8'});
  var a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='passwords.csv';document.body.appendChild(a);a.click();a.remove();
}

/* EDITOR */
function initEditorFields(){
  if(stmtInput)return;
  var sh=$('#statementHost'),ah=$('#answerHost');if(!sh||!ah)return;
  stmtInput=createMathInput('',false);
  ansInput=createMathInput('',false);
  sh.appendChild(stmtInput.el);ah.appendChild(ansInput.el);
  buildSymbolBar($('#symbolBar'));
  addOption();addOption();
  var tt=$('#taskType');
  if(tt)tt.onchange=function(){var i=tt.value==='input';$('#inputBlock').hidden=!i;$('#choiceBlock').hidden=i;};
  var bao=$('#btnAddOption');if(bao)bao.onclick=function(){addOption();};
  var bat=$('#btnAddTask');if(bat)bat.onclick=addTask;
  var bst=$('#btnSaveTest');if(bst)bst.onclick=saveTest;
  var bng=$('#btnNewGroup');if(bng)bng.onclick=async function(){
    if(!currentClassId)return;
    var name=prompt('Название подгруппы (например: Подгруппа А)');
    if(!name||!name.trim())return;
    try{await api('/classes/'+currentClassId+'/groups',{method:'POST',body:{name:name.trim()}});toast('Подгруппа создана','ok');openClassView(currentClassId);}catch(e){toast(e.message,'err');}
  };
  var bjc=$('#btnJoinClass');if(bjc)bjc.onclick=joinClass;
  var bst2=$('#btnSubmitTest');if(bst2)bst2.onclick=function(){if(!confirm('Завершить работу?'))return;submitTest();};
  var bec=$('#btnExportCsv');if(bec)bec.onclick=exportCsv;
  var bsa=$('#btnShowAnalytics');if(bsa)bsa.onclick=showAnalytics;
  var bra=$('#btnReadAll');if(bra)bra.onclick=async function(){try{await api('/notifications/read-all',{method:'POST'});loadNotifications();refreshNotifBadge();toast('Все прочитаны','ok');}catch(e){toast(e.message,'err');}};
  var bic=$('#btnImportCsv');if(bic)bic.onclick=openCsvPicker;
  var cfi=$('#csvFileInput');if(cfi)cfi.onchange=function(){if(this.files[0])uploadCsv(this.files[0]);};
  var bdp=$('#btnDownloadPasswords');if(bdp)bdp.onclick=downloadPasswords;
  var bcc=$('#btnCloseCsvResult');if(bcc)bcc.onclick=function(){$('#csvResultBox').hidden=true;};
  var bcf=$('#btnChatFile');if(bcf)bcf.onclick=function(){$('#chatFileInput').click();};
  var chfi=$('#chatFileInput');if(chfi)chfi.onchange=function(){$('#chatFileName').textContent=this.files[0]?('📎 '+this.files[0].name):'';};
  var bcs=$('#btnChatSend');if(bcs)bcs.onclick=sendChatMessage;
  var cht=$('#chatText');if(cht)cht.onkeydown=function(e){if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendChatMessage();}};

  var bpf=$('#btnPickFromBank'); if(bpf) bpf.onclick = openBankPicker;
  var bstb=$('#btnSaveToBank'); if(bstb) bstb.onclick = saveCurrentToBank;

  /* --- Админские кнопки банка --- */
  var bReset = $('#btnResetBank');
  if (bReset) bReset.onclick = resetTaskBank;
  var bClear = $('#btnClearBank');
  if (bClear) bClear.onclick = clearTaskBank;

  /* --- Чертёж в форме банка --- */
  var bFigPick = $('#btnBankFigurePick');
  if (bFigPick) bFigPick.onclick = function(){ var i = $('#bankFigureInput'); if (i) i.click(); };
  var bFigInput = $('#bankFigureInput');
  if (bFigInput) bFigInput.onchange = function(){
    if (this.files && this.files[0]) uploadBankFigure(this.files[0]);
  };
  var bFigClear = $('#btnBankFigureClear');
  if (bFigClear) bFigClear.onclick = clearBankFigure;

  var babs=$('#btnAddBankTask');
  var bImp=$('#btnImportBankCsv');
  if(bImp) bImp.onclick = function(){ var f=$('#bankCsvInput'); if(f) f.click(); };
  var bcsv=$('#bankCsvInput');
  if(bcsv) bcsv.onchange = async function(){
    var file = this.files[0];
    if (!file) return;
    var fd = new FormData();
    fd.append('file', file);
    try {
      toast('Импорт задач...', 'info');
      var r = await apiForm('/task-bank/import-csv', fd);
      var msg = 'Добавлено: ' + r.added;
      if (r.failed && r.failed.length) msg += ' · ошибок: ' + r.failed.length;
      toast(msg, r.added > 0 ? 'ok' : 'warn');
      if (r.failed && r.failed.length) {
        console.warn('Проблемные строки:', r.failed);
      }
      bcsv.value = '';
      await loadBankList();
      refreshExamWidgets();
    } catch(e) {
      toast(e.message, 'err');
    }
  };
  if(babs) babs.onclick = function(){ openBankForm(null); };
  var bbsc=$('#btnBankSave'); if(bbsc) bbsc.onclick = saveBankTask;
  var bbcx=$('#btnBankCancel'); if(bbcx) bbcx.onclick = closeBankForm;
  var bet=$('#bankExamType');
  if(bet) bet.onchange = function(){ fillBankNumSelect($('#bankExamTaskNumber'), 'profile', 0); };
  var bbtt=$('#bankTaskType');
  if(bbtt) bbtt.onchange = function(){
    var isInput = bbtt.value==='input';
    $('#bankInputBlock').hidden = !isInput;
    $('#bankChoiceBlock').hidden = isInput;
  };

  var bs=$('#bankSearch'); if(bs){ var st=null; bs.oninput=function(){ clearTimeout(st); st=setTimeout(loadBankList,250); }; }
  ['#bankFilterScope','#bankFilterExam','#bankFilterNum','#bankFilterDifficulty','#bankFilterTopic'].forEach(function(id){
    var el = $(id); if(el) el.onchange = loadBankList;
  });
  var bfe = $('#bankFilterExam');
  if(bfe) bfe.onchange = function(){
    fillBankNumSelect($('#bankFilterNum'), 'profile', 0);
    loadBankList();
  };
  var bfn = $('#bankFilterNum');
  if(bfn) bfn.onchange = function(){ syncWidgetsActive(); loadBankList(); };

  var bcbp = $('#btnCloseBankPicker'); if(bcbp) bcbp.onclick = closeBankPicker;
  var bpClr = $('#bpClear'); if(bpClr) bpClr.onclick = function(){ bankState.pickerSelected = {}; renderBankPickerList(); };
  var bpAdd = $('#bpAdd'); if(bpAdd) bpAdd.onclick = addSelectedToDraft;
  var bpS=$('#bpSearch'); if(bpS){ var st2=null; bpS.oninput=function(){ clearTimeout(st2); st2=setTimeout(loadBankPickerList,250); }; }
  ['#bpExam','#bpNum','#bpDifficulty','#bpTopic','#bpScope'].forEach(function(id){
    var el = $(id); if(el) el.onchange = loadBankPickerList;
  });
  var bpE = $('#bpExam');
  if(bpE) bpE.onchange = function(){ fillBankNumSelect($('#bpNum'), 'profile', 0); loadBankPickerList(); };

  var bpModal = $('#bankPickerModal');
  if(bpModal){
    bpModal.addEventListener('click', function(e){
      if(e.target === bpModal) closeBankPicker();
    });
  }
}

function addOption(){
  var ol=$('#optionsList');if(!ol)return;
  var row=document.createElement('div');row.className='option-row';
  var r=document.createElement('input');r.type='radio';r.name='correctOpt';
  var mi=createMathInput('',false);
  var d=document.createElement('button');d.type='button';d.className='ghost small';d.textContent='✕';
  d.onclick=function(){row.remove();};
  row.appendChild(r);row.appendChild(mi.el);row.appendChild(d);
  ol.appendChild(row);
}

async function renderClassPicker(){
  var host=$('#classPicker');if(!host)return;
  host.innerHTML='';
  try{
    var r=await api('/classes');
    if(!r.classes.length){host.innerHTML='<div class="muted">У вас нет групп.</div>';return;}
    r.classes.forEach(function(c){
      var lab=document.createElement('label');lab.className='class-pick';
      var cb=document.createElement('input');cb.type='checkbox';
      cb.checked=draftClassIds.indexOf(c.id)>=0;
      cb.onchange=function(){
        if(cb.checked){if(draftClassIds.indexOf(c.id)<0)draftClassIds.push(c.id);}
        else draftClassIds=draftClassIds.filter(function(x){return x!==c.id;});
        renderGroupPicker();
      };
      var s=document.createElement('span');
      s.innerHTML='<b>'+esc(c.name)+'</b> <span class="muted">('+c.studentCount+')</span>';
      lab.appendChild(cb);lab.appendChild(s);host.appendChild(lab);
    });
    renderGroupPicker();
  }catch(e){host.innerHTML='<div class="err">'+esc(e.message)+'</div>';}
}

async function renderGroupPicker(){
  var host=$('#classPicker');if(!host)return;
  $$('.group-picker-block',host).forEach(function(el){el.remove();});
  if(!draftClassIds.length)return;
  try{
    var r=await api('/classes');
    draftClassIds.forEach(function(cid){
      var c=r.classes.find(function(x){return x.id===cid;});
      if(!c||!(c.groups||[]).length)return;
      var block=document.createElement('div');
      block.className='class-pick group-picker-block';
      block.style.cssText='flex-direction:column;align-items:stretch;background:var(--accent-soft)';
      var inner='<div style="margin-bottom:10px;font-weight:700;font-size:13.5px">'+esc(c.name)+' → только для подгрупп:</div>';
      c.groups.forEach(function(g){
        var checked=draftGroupIds.indexOf(g.id)>=0?'checked':'';
        inner+='<label style="display:flex;align-items:center;gap:10px;padding:6px 0;margin:0;color:var(--text);font-size:13.5px;font-weight:500">'+
          '<input type="checkbox" data-gid="'+g.id+'" '+checked+' style="width:18px;height:18px;margin:0;accent-color:var(--accent)">'+
          '<span>'+esc(g.name)+' <span class="muted">('+g.count+')</span></span></label>';
      });
      inner+='<div class="muted" style="margin-top:6px;font-size:12px">Пусто — работа видна всем</div>';
      block.innerHTML=inner;
      block.querySelectorAll('input[type=checkbox]').forEach(function(cb){
        cb.onchange=function(){
          var gid=cb.dataset.gid;
          if(cb.checked){if(draftGroupIds.indexOf(gid)<0)draftGroupIds.push(gid);}
          else draftGroupIds=draftGroupIds.filter(function(x){return x!==gid;});
        };
      });
      host.appendChild(block);
    });
  }catch(e){}
}

function toLocalDatetime(ts){
  if(!ts)return '';
  var d=new Date(ts);
  var pad=function(n){return String(n).padStart(2,'0');};
  return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate())+'T'+pad(d.getHours())+':'+pad(d.getMinutes());
}

async function openEditor(test){
  initEditorFields();
  editingTestId=test?test.id:null;
  draftTasks=test?JSON.parse(JSON.stringify(test.tasks)):[];
  draftClassIds=test?(test.classIds||[]).slice():[];
  draftGroupIds=test?(test.groupIds||[]).slice():[];
  $('#testTitle').value=test?test.title:'';
  var s=test&&test.settings?test.settings:{timeLimit:0,attempts:1,showAnswers:true};
  $('#setTimeLimit').value=s.timeLimit||0;
  $('#setAttempts').value=s.attempts!==undefined?s.attempts:1;
  $('#setDeadline').value=test&&test.deadline?toLocalDatetime(test.deadline):'';
  $('#setShowAnswers').checked=s.showAnswers!==false;
  stmtInput.setValue('');ansInput.setValue('');
  $('#taskPoints').value=1;$('#taskTol').value='1e-6';
  $('#taskType').value='input';$('#taskType').onchange();
  $('#optionsList').innerHTML='';addOption();addOption();
  await renderClassPicker();
  renderDraft();show('view-editor');
}

function renderDraft(){
  var host=$('#draftList');if(!host)return;
  host.innerHTML='';$('#taskCount').textContent=draftTasks.length;
  if(!draftTasks.length){host.innerHTML='<div class="empty" style="padding:32px">Заданий нет</div>';return;}
  draftTasks.forEach(function(t,i){
    var d=document.createElement('div');
    d.style.cssText='background:var(--panel-2);border-radius:var(--radius);padding:16px;margin-bottom:12px';
    var h=document.createElement('div');h.className='task-head';
    h.innerHTML='<span class="badge">'+(i+1)+'</span><span class="pill">'+(t.type==='input'?'ввод':'выбор')+'</span><span class="pill">'+t.points+' б.</span>';
    var del=document.createElement('button');del.className='ghost small';
    del.textContent='✕';del.style.marginLeft='auto';
    del.onclick=function(){draftTasks.splice(i,1);renderDraft();};
    h.appendChild(del);d.appendChild(h);
    var s=createMathInput(t.statement,true);d.appendChild(s.el);
    host.appendChild(d);
  });
}

function addTask(){
  var type=$('#taskType').value;
  var statement=stmtInput.getValue().trim();
  if(!statement){toast('Введите условие','warn');return;}
  var points=Math.max(1,Number($('#taskPoints').value)||1);
  var task={id:uid(),type:type,statement:statement,points:points};
  if(type==='input'){
    var a=ansInput.getValue().trim();
    if(!a){toast('Введите ответ','warn');return;}
    task.answer=a;task.tolerance=parseFloat($('#taskTol').value)||1e-6;
  }else{
    var rows=$$('#optionsList .option-row');
    if(rows.length<2){toast('Нужно 2+ варианта','warn');return;}
    task.options=rows.map(function(r){return{text:r.querySelector('.mi-input').value};});
    task.correctIndex=rows.findIndex(function(r){return r.querySelector('input[type=radio]').checked;});
    if(task.correctIndex<0){toast('Отметьте правильный','warn');return;}
  }
  draftTasks.push(task);
  stmtInput.setValue('');ansInput.setValue('');
  $('#optionsList').innerHTML='';addOption();addOption();
  renderDraft();toast('Задание добавлено','ok');
}

async function saveTest(){
  var title=$('#testTitle').value.trim()||'Без названия';
  if(!draftTasks.length){toast('Добавьте задание','warn');return;}
  var settings={
    timeLimit:Math.max(0,parseInt($('#setTimeLimit').value)||0),
    attempts:Math.max(0,parseInt($('#setAttempts').value)||0),
    showAnswers:$('#setShowAnswers').checked
  };
  var dlVal=$('#setDeadline').value;
  var deadline=dlVal?new Date(dlVal).getTime():null;
  var btn=$('#btnSaveTest');btn.disabled=true;
  try{
    if(editingTestId){
      await api('/tests/'+editingTestId,{method:'PUT',body:{title:title,tasks:draftTasks,classIds:draftClassIds,groupIds:draftGroupIds,settings:settings,deadline:deadline}});
      toast('Работа обновлена','ok');
    }else{
      await api('/tests',{method:'POST',body:{title:title,tasks:draftTasks,classIds:draftClassIds,groupIds:draftGroupIds,settings:settings,deadline:deadline}});
      toast('Работа создана','ok');
    }
    goTeacher();
  }catch(e){toast(e.message,'err');}
  finally{btn.disabled=false;}
}

/* STUDENT */
async function goStudent(){
  show('view-student');
  await Promise.all([renderStudentSummary(),renderStudentTests(),renderStudentClasses(),renderStudentSchedule()]);
}

async function renderStudentSummary(){
  var host=$('#studentSummary');if(!host)return;
  try{
    var r=await api('/profile/student');
    host.innerHTML='';
    [['Групп',r.classesCount,'i-book'],['Сдач',r.submissionsCount,'i-edit'],
     ['Средний',r.avgPercent+'%','i-chart'],['Баллы',r.totalScore+' / '+r.totalMax,'i-chart'],
     ['Книг',r.booksCount,'i-book']].forEach(function(it){
      var c=document.createElement('div');c.className='dash-item';
      c.innerHTML='<div class="di-label">'+it[0]+'</div>'+
        '<div class="di-value'+(it[0]==='Средний'?' accent':'')+'">'+it[1]+'</div>'+
        '<div class="di-icon"><svg><use href="#'+it[2]+'"/></svg></div>';
      host.appendChild(c);
    });
  }catch(e){host.innerHTML='';}
}

async function renderStudentSchedule(){
  var host=$('#scheduleBlock');if(!host)return;
  try{
    var r=await api('/student/schedule');
    if(!r.schedule||!r.schedule.length){host.innerHTML='';return;}
    host.innerHTML='';
    var block=document.createElement('div');
    block.className='schedule-block';
    block.innerHTML='<div class="schedule-title"><svg fill="none" stroke="currentColor" stroke-width="2"><use href="#i-calendar"/></svg>Что нужно сдать</div>';
    var list=document.createElement('div');list.className='schedule-list';
    r.schedule.forEach(function(s){
      var card=document.createElement('div');
      card.className='schedule-card'+(s.isOverdue?' overdue':'');
      var dlHtml='';
      if(s.deadline){
        var soon=isDeadlineSoon(s.deadline);
        dlHtml='<div class="sc-deadline'+(soon?' urgent':'')+'"><svg fill="none" stroke="currentColor" stroke-width="2"><use href="#i-clock"/></svg>'+esc(fmtDeadline(s.deadline))+'</div>';
      } else dlHtml='<div class="sc-deadline"><svg fill="none" stroke="currentColor" stroke-width="2"><use href="#i-clock"/></svg>без дедлайна</div>';
      card.innerHTML='<div class="sc-class">'+esc(s.className)+'</div>'+
        '<div class="sc-title">'+esc(s.title)+'</div>'+
        '<div class="muted" style="font-size:12.5px;margin-bottom:10px">'+s.tasksCount+' заданий</div>'+dlHtml;
      card.onclick=async function(){
        try{var tests=await api('/tests');var full=tests.tests.find(function(x){return x.id===s.testId;});if(full)openTest(full);}catch(e){toast(e.message,'err');}
      };
      list.appendChild(card);
    });
    block.appendChild(list);host.appendChild(block);
  }catch(e){host.innerHTML='';}
}

async function renderStudentTests(){
  var host=$('#studentList');if(!host)return;
  skeleton(host,3);
  try{
    var r=await api('/tests');
    host.innerHTML='';
    if(!r.tests.length){
      host.innerHTML='<div class="card" style="grid-column:1/-1"><div class="empty"><div class="icon">✨</div><div style="font-size:20px;font-weight:800;color:var(--text);margin-bottom:8px">Пока нет работ</div>Присоединитесь к группе во вкладке «Мои группы».</div></div>';
      return;
    }
    r.tests.forEach(function(test){
      var max=test.tasks.reduce(function(s,t){return s+(t.points||1);},0);
      var s=test.settings||{},used=test.attemptsUsed||0;
      var can=!(s.attempts>0&&used>=s.attempts);
      var draft=loadDraft(test.id),deadline=test.deadline;
      var card=document.createElement('div');card.className='card';card.style.marginBottom='0';
      var dlHtml='';
      if(deadline){
        var overdue=Date.now()>deadline,soon=isDeadlineSoon(deadline);
        var cls='pill deadline'+(overdue?' overdue':(soon?' soon':''));
        dlHtml='<span class="'+cls+'"><svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><use href="#i-calendar"/></svg> '+esc(fmtDeadline(deadline))+'</span>';
      }
      card.innerHTML='<h3 style="margin-bottom:12px">'+esc(test.title)+'</h3>'+
        '<div style="margin-bottom:16px">'+
        '<span class="pill">'+test.tasks.length+' заданий</span> '+
        '<span class="pill">макс. '+max+' б.</span>'+
        (s.timeLimit>0?' <span class="pill warn">'+s.timeLimit+' мин</span>':'')+
        (s.attempts>0?' <span class="pill">попыток: '+used+' / '+s.attempts+'</span>':'')+
        (draft?' <span class="pill green">черновик</span>':'')+
        (dlHtml?' '+dlHtml:'')+'</div>'+
        (test.mySubmission?'<div class="ok" style="margin-bottom:16px;font-weight:600">Последний результат: '+test.mySubmission.score+' / '+test.mySubmission.max+' <span class="muted">· '+fmt(test.mySubmission.at)+'</span></div>':'');
      var b=document.createElement('button');b.className='primary block';
      if(!can){b.disabled=true;b.textContent='Попытки исчерпаны';}
      else{b.textContent=test.mySubmission?'Пройти заново':'Начать';b.onclick=function(){openTest(test);};}
      card.appendChild(b);host.appendChild(card);
    });
  }catch(e){host.innerHTML='<div class="card err">'+esc(e.message)+'</div>';}
}

async function renderStudentClasses(){
  var host=$('#myClasses');if(!host)return;
  skeleton(host,2);
  try{
    var r=await api('/classes');
    host.innerHTML='';
    if(!r.classes.length){host.innerHTML='<div class="empty" style="padding:32px">Вы не в группе.</div>';return;}
    r.classes.forEach(function(c){
      var gH=(c.groups||[]).length?' · подгруппы: '+c.groups.map(function(g){return esc(g.name);}).join(', '):'';
      var el=document.createElement('div');el.className='stu-row';
      el.innerHTML='<div class="avatar">'+esc((c.name[0]||'?').toUpperCase())+'</div>'+
        '<div class="name"><div style="font-weight:600">'+esc(c.name)+'</div>'+
        '<div class="muted">Репетитор: '+esc(c.teacherName)+gH+'</div></div>';

      var bOpen=document.createElement('button');
      bOpen.className='primary small';
      bOpen.innerHTML='<svg><use href="#i-arrow-right"/></svg> Открыть';
      bOpen.onclick=function(){ openClassView(c.id); };
      el.appendChild(bOpen);

      var b=document.createElement('button');
      b.className='ghost small danger';
      b.textContent='Покинуть';
      b.onclick=async function(){
        if(!confirm('Покинуть группу «'+c.name+'»?'))return;
        try{
          await api('/classes/'+c.id+'/leave',{method:'POST'});
          toast('Вы покинули группу','info');
          renderStudentClasses();
          renderStudentTests();
        }catch(e){toast(e.message,'err');}
      };
      el.appendChild(b);
      host.appendChild(el);
    });
  }catch(e){host.innerHTML='<div class="err">'+esc(e.message)+'</div>';}
}

async function joinClass(){
  var je=$('#joinErr');if(je)je.textContent='';
  var c=$('#joinCode').value.trim().toUpperCase();
  if(!c){if(je)je.textContent='Введите код';return;}
  try{await api('/classes/join',{method:'POST',body:{code:c}});$('#joinCode').value='';toast('Вы присоединились','ok');renderStudentClasses();renderStudentTests();renderStudentSchedule();}
  catch(e){if(je)je.textContent=e.message;toast(e.message,'err');}
}

/* DRAFTS */
function draftKey(tid){return 'mathtest_draft_'+currentUser.id+'_'+tid;}
function saveDraft(tid,data){try{localStorage.setItem(draftKey(tid),JSON.stringify(data));}catch(e){}}
function loadDraft(tid){try{var raw=localStorage.getItem(draftKey(tid));return raw?JSON.parse(raw):null;}catch(e){return null;}}
function clearDraft(tid){try{localStorage.removeItem(draftKey(tid));}catch(e){}}

function scheduleDraftSave(){
  if(!currentTest)return;
  clearTimeout(draftTimer);
  draftTimer=setTimeout(function(){
    var answers=currentTest.tasks.map(function(t,i){
      if(t.type==='input'){var mi=answerInputs[i];return mi?mi.getValue():'';}
      return choicePicks[i]===undefined?null:choicePicks[i];
    });
    saveDraft(currentTest.id,{answers:answers,at:Date.now()});
  },600);
}

/* TEST TAKING */
function updateTakeSlider(){
  if(!currentTest)return;
  var total=currentTest.tasks.length;
  var tsInfo=$('#tsInfo');
  if(tsInfo)tsInfo.innerHTML='Задача <b>'+(takeCurrentTask+1)+'</b> из <b>'+total+'</b>';
  var fill=$('#tsFill');
  if(fill)fill.style.width=(((takeCurrentTask+1)/total)*100)+'%';
  var dots=$('#tsDots');
  if(dots){
    dots.querySelectorAll('.ts-dot').forEach(function(d,i){
      d.classList.toggle('active',i===takeCurrentTask);
      var t=currentTest.tasks[i],filled=false;
      if(t.type==='input'){var mi=answerInputs[i];if(mi&&mi.getValue().trim())filled=true;}
      else{if(choicePicks[i]!==undefined)filled=true;}
      d.classList.toggle('filled',filled);
    });
  }
}

function renderTakeTask(){
  if(!currentTest)return;
  var host=$('#takeBody');host.innerHTML='';
  var task=currentTest.tasks[takeCurrentTask];if(!task)return;
  var card=document.createElement('div');card.className='card take-task';
  var h=document.createElement('div');h.className='task-head';
  h.innerHTML='<span class="badge">'+(takeCurrentTask+1)+'</span><span class="pill">'+(task.points||1)+' б.</span>';
  card.appendChild(h);
  var stmt=createMathInput(task.statement,true);card.appendChild(stmt.el);
  if(task.type==='input'){
    var initial='';
    if(answerInputs[takeCurrentTask]&&answerInputs[takeCurrentTask].getValue)initial=answerInputs[takeCurrentTask].getValue();
    if(!initial&&__draftAnswers&&typeof __draftAnswers[takeCurrentTask]==='string')initial=__draftAnswers[takeCurrentTask];
    var mi=createMathInput(initial,false,function(){updateTakeSlider();scheduleDraftSave();});
    card.appendChild(mi.el);
    answerInputs[takeCurrentTask]=mi;
  } else {
    var w=document.createElement('div');w.style.marginTop='10px';
    var picked=choicePicks[takeCurrentTask];
    task.options.forEach(function(opt,j){
      var lab=document.createElement('label');
      lab.style.cssText='display:flex;align-items:center;gap:12px;background:var(--panel-2);border-radius:var(--radius);padding:14px 18px;margin:8px 0;cursor:pointer;transition:var(--trans);border:1.5px solid transparent';
      if(picked===j){lab.style.borderColor='var(--accent)';lab.style.background='var(--accent-soft)';}
      var rd=document.createElement('input');rd.type='radio';rd.name='qtake';
      rd.checked=(picked===j);
      rd.onchange=function(){
        choicePicks[takeCurrentTask]=j;
        w.querySelectorAll('label').forEach(function(L){L.style.borderColor='transparent';L.style.background='var(--panel-2)';});
        lab.style.borderColor='var(--accent)';lab.style.background='var(--accent-soft)';
        updateTakeSlider();scheduleDraftSave();
      };
      var ob=createMathInput(opt.text,true);ob.el.style.flex='1';ob.el.style.margin='0';
      lab.appendChild(rd);lab.appendChild(ob.el);w.appendChild(lab);
    });
    card.appendChild(w);
  }
  var nav=document.createElement('div');nav.className='task-nav';
  var bPrev=document.createElement('button');bPrev.className='ghost';
  bPrev.innerHTML='<svg><use href="#i-arrow-left"/></svg> Назад';
  bPrev.disabled=(takeCurrentTask===0);
  bPrev.onclick=function(){if(takeCurrentTask>0){takeCurrentTask--;renderTakeTask();updateTakeSlider();}};
  var bNext=document.createElement('button');
  if(takeCurrentTask===currentTest.tasks.length-1){
    bNext.className='primary';bNext.innerHTML='Завершить <svg><use href="#i-check"/></svg>';
    bNext.onclick=function(){if(confirm('Отправить работу репетитору?'))submitTest();};
  } else {
    bNext.className='primary';bNext.innerHTML='Далее <svg><use href="#i-arrow-right"/></svg>';
    bNext.onclick=function(){takeCurrentTask++;renderTakeTask();updateTakeSlider();window.scrollTo({top:0,behavior:'smooth'});};
  }
  nav.appendChild(bPrev);nav.appendChild(bNext);card.appendChild(nav);host.appendChild(card);
}

function updateTimer(){
  if(!testDeadline)return;
  var left=Math.max(0,testDeadline-Date.now());
  var total=(currentTest.settings.timeLimit||0)*60000;
  var pct=total?left/total*100:0;
  var el=$('#timerDisplay');if(!el)return;
  var m=Math.floor(left/60000),s=Math.floor((left%60000)/1000);
  el.textContent=String(m).padStart(2,'0')+':'+String(s).padStart(2,'0');
  el.className='timer'+(pct<10?' critical':(pct<25?' warning':''));
  if(left<=0){clearInterval(timerInterval);timerInterval=null;toast('Время вышло','warn');setTimeout(submitTest,500);}
}

function openTest(test){
  currentTest=test;answerInputs=[];choicePicks=[];takeCurrentTask=0;
  $('#takeTitle').textContent=test.title;
  var draft=loadDraft(test.id);var dh=$('#draftHint');__draftAnswers=null;
  if(draft){
    if(dh){dh.hidden=false;dh.textContent='Черновик от '+fmt(draft.at)+' — ответы восстановлены';}
    if(draft.answers){__draftAnswers=draft.answers;
      draft.answers.forEach(function(a,i){if(a===null||a===undefined)return;var t=test.tasks[i];if(!t)return;if(t.type!=='input')choicePicks[i]=a;});
    }
  } else if(dh)dh.hidden=true;
  var dots=$('#tsDots');
  if(dots){dots.innerHTML='';test.tasks.forEach(function(t,i){
    var d=document.createElement('button');d.className='ts-dot';d.textContent=(i+1);
    d.onclick=function(){takeCurrentTask=i;renderTakeTask();updateTakeSlider();};
    dots.appendChild(d);
  });}
  renderTakeTask();updateTakeSlider();
  var timer=$('#timerDisplay');
  if(test.settings&&test.settings.timeLimit>0){
    var key='test_start_'+test.id;
    var started=parseInt(sessionStorage.getItem(key));
    if(!started||isNaN(started)){started=Date.now();sessionStorage.setItem(key,started);}
    testDeadline=started+test.settings.timeLimit*60000;
    if(timer)timer.hidden=false;
    if(timerInterval)clearInterval(timerInterval);
    updateTimer();timerInterval=setInterval(updateTimer,1000);
  } else {
    if(timer)timer.hidden=true;testDeadline=null;
    if(timerInterval){clearInterval(timerInterval);timerInterval=null;}
  }
  show('view-take');
}

async function submitTest(){
  if(!currentTest)return;
  if(timerInterval){clearInterval(timerInterval);timerInterval=null;}
  var answers=currentTest.tasks.map(function(t,i){
    if(t.type==='input'){var mi=answerInputs[i];return {text:mi?mi.getValue():''};}
    return {index:choicePicks[i]===undefined?-1:choicePicks[i]};
  });
  var started=parseInt(sessionStorage.getItem('test_start_'+currentTest.id))||Date.now();
  try{
    var r=await api('/tests/'+currentTest.id+'/submit',{method:'POST',body:{answers:answers,startedAt:started}});
    clearDraft(currentTest.id);sessionStorage.removeItem('test_start_'+currentTest.id);__draftAnswers=null;$('#draftHint').hidden=true;
    if(r.expired)toast('Работа сдана с опозданием','warn');
    if(r.late)toast('Работа сдана после дедлайна','warn');
    showResult(currentTest,r);
  }catch(e){toast(e.message,'err');}
}

function showResult(test,r){
  var card=$('#resultCard');
  var score=r.score,max=r.max;
  var pct=max?Math.round(score/max*100):0;
  var gc=pct>=80?'':(pct>=60?'mid':'bad');
  var gt=pct>=80?'Отличный результат!':(pct>=60?'Хороший результат':'Стоит повторить');
  card.innerHTML='<h2 style="margin-bottom:28px">'+esc(test.title)+'</h2>'+
    '<div style="display:flex;align-items:center;gap:32px;flex-wrap:wrap;margin-bottom:28px">'+
    '<div class="score-circle" data-grade="'+gc+'" style="--pct:'+pct+'"><div class="val">'+score+' / '+max+'</div><div class="lbl">'+pct+'%</div></div>'+
    '<div style="flex:1;min-width:220px"><div style="font-size:20px;font-weight:800;margin-bottom:8px;letter-spacing:-0.02em">'+gt+'</div>'+
    '<div class="muted">'+(r.durationMs?'Время: '+fmtDur(r.durationMs)+'<br>':'')+(r.attempt?'Попытка №'+r.attempt:'')+
    (r.late?'<br><span style="color:var(--err)">Сдано после дедлайна</span>':'')+'</div></div></div>';
  test.tasks.forEach(function(task,i){
    var res=r.results[i]||{ok:false};
    var line=document.createElement('div');line.className='result-line '+(res.ok?'ok':'err');
    var s=createMathInput(task.statement,true);s.el.style.marginBottom='10px';line.appendChild(s.el);
    var info=document.createElement('div');info.style.fontSize='14px';info.style.fontWeight='600';
    info.innerHTML=res.ok
      ?'<span class="ok">✓ Верно</span> <span class="muted">· '+(task.points||1)+' б.</span>'
      :'<span class="err">✗ Неверно</span> <span class="muted">· 0 из '+(task.points||1)+' б.</span>';
    line.appendChild(info);
    if(!res.ok&&res.correctAnswer){
      var a=document.createElement('div');a.style.marginTop='14px';
      a.innerHTML='<div class="muted" style="margin-bottom:6px">Правильный ответ:</div>';
      var mf=createMathInput(res.correctAnswer,true);a.appendChild(mf.el);line.appendChild(a);
    }
    if(!res.ok&&!res.correctAnswer&&r.settings&&!r.settings.showAnswers){
      var n=document.createElement('div');n.className='muted';n.style.marginTop='10px';
      n.textContent='(Ответ скрыт репетитором)';line.appendChild(n);
    }
    if(task.type==='choice'&&res.correctIndex!==undefined){
      var a2=document.createElement('div');a2.style.marginTop='14px';
      a2.innerHTML='<div class="muted" style="margin-bottom:6px">Правильный вариант:</div>';
      var mf2=createMathInput(task.options[res.correctIndex].text,true);a2.appendChild(mf2.el);line.appendChild(a2);
    }
    card.appendChild(line);
  });
  show('view-result');
}

/* SUBMISSIONS */
async function showSubmissions(test){
  currentSubmissionTest=test;
  $('#subsTitle').textContent=test.title;
  var body=$('#subsBody');skeleton(body,4);show('view-submissions');
  try{
    var r=await api('/tests/'+test.id+'/submissions');
    body.innerHTML='';
    if(!r.groups.length){body.innerHTML='<div class="card"><div class="empty" style="padding:48px">Не назначено ни одной группе.</div></div>';return;}
    r.groups.forEach(function(g){
      var card=document.createElement('div');card.className='card';
      var total=g.submitted.length+g.notSubmitted.length;
      var avg=g.submitted.length?Math.round(g.submitted.reduce(function(s,x){return s+(x.max?x.score/x.max:0);},0)/g.submitted.length*100):0;
      card.innerHTML='<div class="row tight"><h3 style="flex:1;margin:0">'+esc(g.className)+'</h3>'+
        '<span class="pill">сдано: '+g.submitted.length+' / '+total+'</span>'+
        (g.submitted.length?'<span class="pill green">средний: '+avg+'%</span>':'')+'</div>';
      if(g.submitted.length){
        var h=document.createElement('h4');h.className='sec';h.textContent='Сдали';card.appendChild(h);
        g.submitted.forEach(function(s){
          var pct=s.max?Math.round(s.score/s.max*100):0;
          var el=document.createElement('div');el.className='stu-row';
          el.innerHTML='<div class="avatar">'+esc((s.studentName[0]||'?').toUpperCase())+'</div>'+
            '<div class="name"><div style="font-weight:600">'+esc(s.studentName)+
            (s.attempt>1?' <span class="pill" style="font-size:11px">попытка '+s.attempt+'</span>':'')+
            (s.late?' <span class="pill red" style="font-size:11px">с опозданием</span>':'')+
            '</div><div class="muted">'+fmt(s.at)+(s.durationMs?' · '+fmtDur(s.durationMs):'')+'</div></div>'+
            '<div class="score '+(pct>=60?'ok':'err')+'">'+s.score+' / '+s.max+' ('+pct+'%)</div>';
          var b=document.createElement('button');b.className='ghost small';b.textContent='Работа';
          b.onclick=function(){openSubmissionDetail(s.id,test.id);};
          el.appendChild(b);card.appendChild(el);
        });
      }
      if(g.notSubmitted.length){
        var h2=document.createElement('h4');h2.className='sec';h2.textContent='Не сдали ('+g.notSubmitted.length+')';card.appendChild(h2);
        g.notSubmitted.forEach(function(u){
          var el=document.createElement('div');el.className='stu-row';el.style.opacity='.6';
          el.innerHTML='<div class="avatar" style="background:var(--panel-2);color:var(--text-2)">'+esc((u.name[0]||'?').toUpperCase())+'</div>'+
            '<div class="name">'+esc(u.name)+'</div><div class="muted">нет сдачи</div>';
          card.appendChild(el);
        });
      }
      body.appendChild(card);
    });
  }catch(e){body.innerHTML='<div class="card err">'+esc(e.message)+'</div>';}
}

async function exportCsv(){
  if(!currentSubmissionTest)return;
  try{
    var tk=getToken();
    var res=await fetch('/api/tests/'+currentSubmissionTest.id+'/export.csv',{headers:{Authorization:'Bearer '+tk}});
    if(!res.ok)throw new Error('Не удалось');
    var blob=await res.blob();
    var a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='results.csv';
    document.body.appendChild(a);a.click();a.remove();toast('CSV скачан','ok');
  }catch(e){toast(e.message,'err');}
}

async function showAnalytics(){
  if(!currentSubmissionTest)return;
  $('#subsTitle').textContent='Аналитика';
  var body=$('#subsBody');skeleton(body,4);
  try{
    var r=await api('/tests/'+currentSubmissionTest.id+'/submissions');
    body.innerHTML='';
    var card=document.createElement('div');card.className='card';
    card.innerHTML='<h3>Успешность по заданиям</h3><div class="muted" style="margin-bottom:20px">Процент учеников, справившихся с заданием.</div>';
    if(!r.analytics||!r.analytics.length)card.innerHTML+='<div class="empty" style="padding:40px">Нет данных</div>';
    r.analytics.forEach(function(a){
      var color=a.pct>=75?'var(--ok)':(a.pct>=40?'var(--warn)':'var(--err)');
      var row=document.createElement('div');row.className='analytics-row';
      row.innerHTML='<div class="num">'+a.index+'</div>'+
        '<div class="body"><div style="font-size:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+esc(a.statement.replace(/[#*_`~]/g,'').slice(0,70))+'</div>'+
        '<div class="bar-track"><div class="bar-fill" style="width:'+a.pct+'%;background:'+color+'"></div></div></div>'+
        '<div class="pct" style="color:'+color+'">'+a.pct+'%</div>'+
        '<div class="muted" style="font-size:12px;min-width:70px;text-align:right">'+a.correct+' / '+a.total+'</div>';
      card.appendChild(row);
    });
    body.appendChild(card);
    var back=document.createElement('button');back.className='primary';back.textContent='К результатам';
    back.onclick=function(){showSubmissions(currentSubmissionTest);};body.appendChild(back);
  }catch(e){body.innerHTML='<div class="card err">'+esc(e.message)+'</div>';}
}

async function openSubmissionDetail(subId,testId){
  try{
    var r=await api('/submissions/'+subId);
    var body=$('#subsBody');$('#subsTitle').textContent=r.test.title;
    body.innerHTML='';
    var card=document.createElement('div');card.className='card';
    var pct=r.submission.max?Math.round(r.submission.score/r.submission.max*100):0;
    var gc=pct>=80?'':(pct>=60?'mid':'bad');
    card.innerHTML='<div style="display:flex;align-items:center;gap:32px;flex-wrap:wrap;margin-bottom:28px">'+
      '<div class="score-circle" data-grade="'+gc+'" style="--pct:'+pct+'"><div class="val">'+r.submission.score+' / '+r.submission.max+'</div><div class="lbl">'+pct+'%</div></div>'+
      '<div class="muted" style="flex:1">'+fmt(r.submission.at)+
      (r.submission.durationMs?'<br>Время: '+fmtDur(r.submission.durationMs):'')+
      (r.submission.attempt?'<br>Попытка №'+r.submission.attempt:'')+
      (r.submission.late?'<br><span style="color:var(--err)">С опозданием</span>':'')+'</div></div>';
    r.test.tasks.forEach(function(task,i){
      var res=r.submission.results[i]||{ok:false,studentText:''};
      var line=document.createElement('div');line.className='result-line '+(res.ok?'ok':'err');
      var s=createMathInput(task.statement,true);s.el.style.marginBottom='10px';line.appendChild(s.el);
      var info=document.createElement('div');info.style.fontWeight='600';
      info.innerHTML=res.ok
        ?'<span class="ok">✓ Верно</span> <span class="muted">· '+(task.points||1)+' б.</span>'
        :'<span class="err">✗ Неверно</span> <span class="muted">· '+(task.points||1)+' б.</span>';
      line.appendChild(info);
      if(task.type==='input'){
        var st=document.createElement('div');st.style.marginTop='14px';
        st.innerHTML='<div class="muted" style="margin-bottom:6px">Ответ ученика:</div>';
        var mf=createMathInput(res.studentText||'(пусто)',true);st.appendChild(mf.el);line.appendChild(st);
        if(!res.ok){
          var c=document.createElement('div');c.style.marginTop='14px';
          c.innerHTML='<div class="muted" style="margin-bottom:6px">Правильный ответ:</div>';
          var mfc=createMathInput(task.answer,true);c.appendChild(mfc.el);line.appendChild(c);
        }
      } else if(!res.ok){
        var c2=document.createElement('div');c2.style.marginTop='14px';
        c2.innerHTML='<div class="muted" style="margin-bottom:6px">Правильный вариант:</div>';
        var mf2=createMathInput(task.options[task.correctIndex].text,true);c2.appendChild(mf2.el);line.appendChild(c2);
      }
      card.appendChild(line);
    });
    var b=document.createElement('button');b.className='primary';b.textContent='К результатам';
    b.onclick=function(){var t=currentSubmissionTest||{};if(t.id===testId)showSubmissions(t);else goTeacher();};
    card.appendChild(b);body.appendChild(card);
  }catch(e){toast(e.message,'err');}
}

/* DASHBOARD */
async function openDashboard(){
  if(!isTeacherLike())return;
  show('view-dashboard');
  var host=$('#dashboardBody');skeleton(host,6);
  try{
    var r=await api('/teacher/dashboard');
    host.innerHTML='';
    var top=document.createElement('div');top.className='grid';
    [['Групп',r.total.classes],['Всего сдач',r.total.submissions],['Средний балл',r.total.avgPercent+'%']].forEach(function(s){
      var c=document.createElement('div');c.className='stat-card';
      c.innerHTML='<div class="stat-value">'+s[1]+'</div><div class="stat-label">'+s[0]+'</div>';
      top.appendChild(c);
    });
    host.appendChild(top);
    var wCard=document.createElement('div');wCard.className='card';wCard.style.marginTop='24px';
    wCard.innerHTML='<h3>Динамика по неделям</h3>';
    var wrap=document.createElement('div');wrap.className='chart-wrap';
    var bars=document.createElement('div');bars.className='chart-bars';
    r.weeks.forEach(function(w){
      var b=document.createElement('div');b.className='chart-bar';
      var color=w.avgPercent>=80?'var(--ok)':(w.avgPercent>=60?'var(--warn)':(w.avgPercent>0?'var(--err)':'var(--border)'));
      b.style.cssText='height:'+Math.max(6,w.avgPercent)+'%;background:'+color;
      b.title=w.label+' — '+w.count+' сдач, средний '+w.avgPercent+'%';
      b.dataset.label=w.label;bars.appendChild(b);
    });
    wrap.appendChild(bars);wCard.appendChild(wrap);host.appendChild(wCard);
    var cCard=document.createElement('div');cCard.className='card';
    cCard.innerHTML='<h3>Средний балл по группам</h3>';
    if(!r.perClass.length)cCard.innerHTML+='<div class="empty" style="padding:40px">Групп нет</div>';
    r.perClass.forEach(function(c){
      var color=c.avgPercent>=80?'var(--ok)':(c.avgPercent>=60?'var(--warn)':'var(--err)');
      var row=document.createElement('div');row.className='analytics-row';
      row.innerHTML='<div class="body"><div style="font-size:14px;font-weight:700">'+esc(c.name)+' <span class="muted">('+c.submissions+' сдач)</span></div>'+
        '<div class="bar-track"><div class="bar-fill" style="width:'+c.avgPercent+'%;background:'+color+'"></div></div></div>'+
        '<div class="pct" style="color:'+color+'">'+c.avgPercent+'%</div>';
      cCard.appendChild(row);
    });
    host.appendChild(cCard);
    var twoCol=document.createElement('div');twoCol.className='two-col';
    var topCard=document.createElement('div');topCard.className='card';
    topCard.innerHTML='<h3>Лучшие ученики</h3>';
    if(!r.top.length)topCard.innerHTML+='<div class="empty" style="padding:40px">Нет данных</div>';
    r.top.forEach(function(u,i){
      var el=document.createElement('div');el.className='stu-row';
      el.innerHTML='<span class="badge" style="background:'+(i===0?'#ffb547':(i===1?'#c0c0c0':(i===2?'#cd7f32':'var(--panel-2)')))+';color:'+(i<3?'#000':'var(--text-2)')+'">'+(i+1)+'</span>'+
        '<div class="name"><div style="font-weight:600">'+esc(u.name)+'</div><div class="muted">'+u.submissions+' сдач</div></div>'+
        '<div class="score ok">'+u.avgPercent+'%</div>';
      topCard.appendChild(el);
    });
    twoCol.appendChild(topCard);
    var bottomCard=document.createElement('div');bottomCard.className='card';
    bottomCard.innerHTML='<h3>Требуют внимания</h3>';
    if(!r.bottom.length)bottomCard.innerHTML+='<div class="empty" style="padding:40px">Нет данных</div>';
    r.bottom.forEach(function(u,i){
      var el=document.createElement('div');el.className='stu-row';
      el.innerHTML='<span class="badge red">'+(i+1)+'</span>'+
        '<div class="name"><div style="font-weight:600">'+esc(u.name)+'</div><div class="muted">'+u.submissions+' сдач</div></div>'+
        '<div class="score err">'+u.avgPercent+'%</div>';
      bottomCard.appendChild(el);
    });
    twoCol.appendChild(bottomCard);host.appendChild(twoCol);
  }catch(e){host.innerHTML='<div class="card err">'+esc(e.message)+'</div>';}
}
  /* LIBRARY */
async function openLibrary(){
  show('view-library');
  var host=$('#bookList');skeleton(host,4);
  var bab=$('#btnAddBook');
  if(bab)bab.hidden=!canUploadBooks();
  if(!canUploadBooks())$('#bookUploadForm').hidden=true;
  editingBookId=null;
  try{
    var cr=await api('/classes');
    var sel=$('#bookClassFilter');
    if(sel)sel.innerHTML='<option value="">Все группы</option>'+cr.classes.map(function(c){return '<option value="'+c.id+'">'+esc(c.name)+'</option>';}).join('');
  }catch(e){}
  await searchBooks();
}

function bookCoverUrl(id){return '/api/books/'+id+'/cover';}

function renderBookCard(b){
  var card=document.createElement('div');card.className='book-card';
  var coverStyle='',coverContent='';
  if(b.hasCover)coverStyle='background-image:url(\''+bookCoverUrl(b.id)+'\')';
  else coverContent='<div class="book-cover-fallback">'+esc((b.title[0]||'?').toUpperCase())+'</div>';
  card.innerHTML='<div class="book-cover" style="'+coverStyle+'">'+coverContent+'</div>'+
    '<div class="book-title">'+esc(b.title)+'</div>'+
    (b.author?'<div class="book-author">'+esc(b.author)+'</div>':'')+
    '<div class="book-meta">'+
    (b.subject?'<span class="pill">'+esc(b.subject)+'</span>':'')+
    (b.pdfSize?'<span class="pill">'+fmtSize(b.pdfSize)+'</span>':'')+
    (b.ownerName?'<span class="pill">'+esc(b.ownerName)+'</span>':'')+'</div>'+
    (b.description?'<div class="book-desc">'+esc(b.description)+'</div>':'');
  var actions=document.createElement('div');actions.className='book-actions';
  var read=document.createElement('button');read.className='primary small';
  read.innerHTML='<svg><use href="#i-book"/></svg> Читать';
  read.onclick=function(e){e.stopPropagation();openReader(b.id);};
  actions.appendChild(read);
  if(isAdmin()||(isTeacherLike()&&b.ownerId===currentUser.id)||currentUser.role==='librarian'){
    var ed=document.createElement('button');ed.className='ghost small';ed.textContent='Изменить';
    ed.onclick=function(e){e.stopPropagation();editBook(b.id);};actions.appendChild(ed);
    var del=document.createElement('button');del.className='ghost small danger';del.textContent='Удалить';
    del.onclick=async function(e){e.stopPropagation();if(!confirm('Удалить «'+b.title+'»?'))return;try{await api('/books/'+b.id,{method:'DELETE'});toast('Удалено','ok');searchBooks();}catch(e){toast(e.message,'err');}};
    actions.appendChild(del);
  }
  card.appendChild(actions);
  card.onclick=function(){openReader(b.id);};
  return card;
}

function renderBookRow(b){
  var el=document.createElement('div');el.className='book-list-row';
  var coverStyle='',coverContent='';
  if(b.hasCover)coverStyle='background-image:url(\''+bookCoverUrl(b.id)+'\')';
  else coverContent=esc((b.title[0]||'?').toUpperCase());
  el.innerHTML='<div class="blc-cover" style="'+coverStyle+'">'+coverContent+'</div>'+
    '<div class="binfo"><div class="btitle">'+esc(b.title)+'</div>'+
    '<div class="bauthor">'+esc(b.author||'—')+(b.subject?' · '+esc(b.subject):'')+(b.pdfSize?' · '+fmtSize(b.pdfSize):'')+(b.ownerName?' · '+esc(b.ownerName):'')+'</div></div>';
  var actions=document.createElement('div');actions.style.cssText='display:flex;gap:8px';
  var read=document.createElement('button');read.className='primary small';read.textContent='Читать';
  read.onclick=function(e){e.stopPropagation();openReader(b.id);};
  actions.appendChild(read);
  if(isAdmin()||(isTeacherLike()&&b.ownerId===currentUser.id)||currentUser.role==='librarian'){
    var ed=document.createElement('button');ed.className='ghost small';ed.textContent='Изменить';
    ed.onclick=function(e){e.stopPropagation();editBook(b.id);};actions.appendChild(ed);
    var del=document.createElement('button');del.className='ghost small danger';del.textContent='✕';
    del.onclick=async function(e){e.stopPropagation();if(!confirm('Удалить?'))return;try{await api('/books/'+b.id,{method:'DELETE'});toast('Удалено','ok');searchBooks();}catch(e){toast(e.message,'err');}};
    actions.appendChild(del);
  }
  el.appendChild(actions);
  el.onclick=function(){openReader(b.id);};
  return el;
}

async function searchBooks(){
  var host=$('#bookList');if(!host)return;
  skeleton(host,3);
  try{
    var q=$('#bookSearch')?$('#bookSearch').value.trim():'';
    var cid=$('#bookClassFilter')?$('#bookClassFilter').value:'';
    var sort=$('#bookSort')?$('#bookSort').value:'new';
    var params='?q='+encodeURIComponent(q)+'&classId='+encodeURIComponent(cid)+'&sort='+encodeURIComponent(sort);
    var r=await api('/books'+params);
    host.innerHTML='';
    if(!r.books.length){
      if(q || cid){
        host.innerHTML='<div class="card"><div class="empty">'+
          '<div class="icon">🔍</div>'+
          '<div style="font-size:18px;font-weight:800;color:var(--text);margin-bottom:6px">Ничего не найдено</div>'+
          'Попробуйте изменить поиск или фильтр.'+
          '</div></div>';
      } else if(canUploadBooks()){
        host.innerHTML='<div class="card"><div class="empty">'+
          '<div class="icon">📚</div>'+
          '<div style="font-size:22px;font-weight:900;color:var(--text);margin-bottom:10px;letter-spacing:-0.02em">Библиотека пуста</div>'+
          '<div style="max-width:420px;margin:0 auto;line-height:1.6">Загрузите первый учебник или сборник — ученики смогут читать прямо в браузере с закладками и оглавлением.</div>'+
          '<div style="margin-top:22px"><button class="primary" id="emptyAddBookBtn">'+
            '<svg><use href="#i-plus"/></svg> Загрузить первую книгу'+
          '</button></div>'+
          '</div></div>';
        var eab=$('#emptyAddBookBtn');
        if(eab) eab.onclick=function(){ var b=$('#btnAddBook'); if(b) b.click(); };
      } else {
        host.innerHTML='<div class="card"><div class="empty">'+
          '<div class="icon">📚</div>'+
          '<div style="font-size:20px;font-weight:800;color:var(--text);margin-bottom:6px">Книг пока нет</div>'+
          'Как только репетитор добавит учебник — он появится здесь.'+
          '</div></div>';
      }
      return;
    }
    if(bookView==='grid'){
      var grid=document.createElement('div');grid.className='grid';
      r.books.forEach(function(b){grid.appendChild(renderBookCard(b));});
      host.appendChild(grid);
    } else r.books.forEach(function(b){host.appendChild(renderBookRow(b));});
  }catch(e){host.innerHTML='<div class="card err">'+esc(e.message)+'</div>';}
}

async function renderBookClassPicker(){
  var host=$('#bookClassPicker');if(!host)return;
  try{
    var r=await api('/classes');
    host.innerHTML='';window.__bookClassIds=[];
    if(!r.classes.length){host.innerHTML='<div class="muted">Нет групп — книга видна всем.</div>';return;}
    var currentBook=null;
    if(editingBookId){try{currentBook=(await api('/books/'+editingBookId)).book;}catch(e){}}
    r.classes.forEach(function(c){
      var lab=document.createElement('label');lab.className='class-pick';
      var cb=document.createElement('input');cb.type='checkbox';
      if(currentBook&&(currentBook.classIds||[]).indexOf(c.id)>=0){cb.checked=true;window.__bookClassIds.push(c.id);}
      cb.onchange=function(){
        if(cb.checked){if(window.__bookClassIds.indexOf(c.id)<0)window.__bookClassIds.push(c.id);}
        else window.__bookClassIds=window.__bookClassIds.filter(function(x){return x!==c.id;});
      };
      var s=document.createElement('span');
      s.innerHTML='<b>'+esc(c.name)+'</b> <span class="muted">('+c.studentCount+')</span>';
      lab.appendChild(cb);lab.appendChild(s);host.appendChild(lab);
    });
  }catch(e){}
}

function bindCoverDrop(){
  var drop=$('#bookCoverDrop'),input=$('#bookCover'),preview=$('#bookCoverPreview'),clearBtn=$('#bookCoverClear');
  if(!drop||!input||!preview)return;
  function emptyHtml(){return '<div class="bcu-empty"><svg><use href="#i-image"/></svg><b>Обложка</b><span>Перетащите или нажмите</span><span class="bcu-hint">JPG, PNG, WebP · до 5 МБ</span></div>';}
  function showPreview(file){if(!file)return;var r=new FileReader();r.onload=function(e){preview.style.backgroundImage='url('+e.target.result+')';preview.innerHTML='';if(clearBtn)clearBtn.hidden=false;};r.readAsDataURL(file);}
  window.__bookCoverReset=function(){preview.style.backgroundImage='';preview.innerHTML=emptyHtml();input.value='';if(clearBtn)clearBtn.hidden=true;};
  window.__bookCoverShowExisting=function(bookId){preview.style.backgroundImage='url(/api/books/'+bookId+'/cover)';preview.innerHTML='';if(clearBtn)clearBtn.hidden=false;};
  drop.onclick=function(e){if(e.target===clearBtn)return;input.click();};
  input.onchange=function(){if(this.files[0])showPreview(this.files[0]);};
  drop.ondragover=function(e){e.preventDefault();drop.classList.add('drag');};
  drop.ondragleave=function(){drop.classList.remove('drag');};
  drop.ondrop=function(e){e.preventDefault();drop.classList.remove('drag');var f=e.dataTransfer.files[0];if(!f)return;if(!/^image\//.test(f.type)){toast('Только изображения','warn');return;}if(f.size>5*1024*1024){toast('Файл больше 5 МБ','warn');return;}try{var dt=new DataTransfer();dt.items.add(f);input.files=dt.files;}catch(err){}showPreview(f);};
  if(clearBtn)clearBtn.onclick=function(e){e.stopPropagation();window.__bookCoverReset();};
}

function bindPdfDrop(){
  var drop=$('#bookPdfDrop'),input=$('#bookPdf'),preview=$('#bookPdfPreview'),meta=$('#bookPdfMeta'),clearBtn=$('#bookPdfClear');
  if(!drop||!input)return;
  function emptyHtml(){return '<div class="bpd-empty"><svg><use href="#i-file"/></svg><b>PDF-файл книги *</b><span>Перетащите или нажмите</span><span class="bcu-hint">До 60 МБ</span></div>';}
  function setFile(file){
    if(!file)return;
    if(!/\.pdf$/i.test(file.name) && file.type!=='application/pdf'){toast('Нужен файл PDF','warn');return;}
    if(file.size>60*1024*1024){toast('Файл больше 60 МБ','warn');return;}
    preview.hidden=true;meta.hidden=false;
    meta.innerHTML='<svg><use href="#i-file"/></svg><div><div class="bpd-name">'+esc(file.name)+'</div><div class="bpd-size">'+fmtSize(file.size)+'</div></div>';
    drop.classList.add('has-file');if(clearBtn)clearBtn.hidden=false;
  }
  window.__bookPdfReset=function(){preview.hidden=false;preview.innerHTML=emptyHtml();meta.hidden=true;meta.innerHTML='';input.value='';drop.classList.remove('has-file');if(clearBtn)clearBtn.hidden=true;};
  window.__bookPdfShowExisting=function(name,size){
    preview.hidden=true;meta.hidden=false;
    meta.innerHTML='<svg><use href="#i-file"/></svg><div><div class="bpd-name">'+esc(name||'book.pdf')+'</div><div class="bpd-size">'+fmtSize(size||0)+' (текущий)</div></div>';
    drop.classList.add('has-file');if(clearBtn)clearBtn.hidden=false;
  };
  drop.onclick=function(e){if(e.target===clearBtn)return;input.click();};
  input.onchange=function(){if(this.files[0])setFile(this.files[0]);};
  drop.ondragover=function(e){e.preventDefault();drop.classList.add('drag');};
  drop.ondragleave=function(){drop.classList.remove('drag');};
  drop.ondrop=function(e){e.preventDefault();drop.classList.remove('drag');var f=e.dataTransfer.files[0];if(!f)return;try{var dt=new DataTransfer();dt.items.add(f);input.files=dt.files;}catch(err){}setFile(f);};
  if(clearBtn)clearBtn.onclick=function(e){e.stopPropagation();window.__bookPdfReset();};
}

function clearBookForm(){
  ['bookTitle','bookAuthor','bookSubject','bookDescription'].forEach(function(id){var el=$('#'+id);if(el)el.value='';});
  $('#bookErr').textContent='';editingBookId=null;
  if(window.__bookCoverReset)window.__bookCoverReset();
  if(window.__bookPdfReset)window.__bookPdfReset();
  $('#bookFormTitle').textContent='Новая книга';
}

async function editBook(id){
  try{
    var r=await api('/books/'+id);
    var b=r.book;editingBookId=b.id;
    $('#bookFormTitle').textContent='Редактирование книги';
    $('#bookTitle').value=b.title||'';$('#bookAuthor').value=b.author||'';
    $('#bookSubject').value=b.subject||'';$('#bookDescription').value=b.description||'';
    $('#bookUploadForm').hidden=false;
    await renderBookClassPicker();
    window.__bookClassIds=(b.classIds||[]).slice();
    if(window.__bookCoverReset)window.__bookCoverReset();
    if(b.hasCover && window.__bookCoverShowExisting)window.__bookCoverShowExisting(b.id);
    if(window.__bookPdfReset)window.__bookPdfReset();
    if(b.hasPdf && window.__bookPdfShowExisting)window.__bookPdfShowExisting(b.title+'.pdf',b.pdfSize);
  }catch(e){toast(e.message,'err');}
}

async function saveBook(){
  var err=$('#bookErr');if(err)err.textContent='';
  var title=$('#bookTitle').value.trim();
  if(!title){if(err)err.textContent='Введите название';return;}
  var pdfInput=$('#bookPdf');var pdfFile=pdfInput && pdfInput.files[0];
  if(!editingBookId && !pdfFile){if(err)err.textContent='Загрузите PDF-файл';return;}
  var fd=new FormData();
  fd.append('title',title);
  fd.append('author',$('#bookAuthor').value.trim());
  fd.append('subject',$('#bookSubject').value.trim());
  fd.append('description',$('#bookDescription').value.trim());
  fd.append('classIds',JSON.stringify(window.__bookClassIds||[]));
  var cover=$('#bookCover').files[0];
  if(cover){if(cover.size>5*1024*1024){if(err)err.textContent='Обложка больше 5 МБ';return;}fd.append('cover',cover);}
  if(pdfFile)fd.append('pdf',pdfFile);
  var btn=$('#btnSaveBook');btn.disabled=true;var oldTxt=btn.innerHTML;btn.innerHTML='Загрузка…';
  try{
    if(editingBookId){await apiForm('/books/'+editingBookId,fd,'PUT');toast('Книга обновлена','ok');}
    else{await apiForm('/books',fd);toast('Книга добавлена','ok');}
    $('#bookUploadForm').hidden=true;clearBookForm();searchBooks();
  }catch(e){if(err)err.textContent=e.message;toast(e.message,'err');}
  finally{btn.disabled=false;btn.innerHTML=oldTxt;}
}

/* PDF READER */
function pdfSetupWorker(){
  if(window.pdfjsLib && pdfjsLib.GlobalWorkerOptions && !pdfjsLib.GlobalWorkerOptions.workerSrc){
    pdfjsLib.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  }
}
function readerStep(){ return window.innerWidth < 700 ? 1 : 2; }
function normalizeLeftPage(n){
  if(!n || n < 1) return 1;
  var step = readerStep();
  if(step === 1) return n;
  return (n % 2 === 0) ? n - 1 : n;
}
function readerClose(){
  if(reader.pdf){try{reader.pdf.destroy();}catch(e){}}
  reader.pdf=null;reader.totalPages=0;reader.currentPage=1;reader.cache={};reader.outline=[];
  var a=$('#readerSlotA'),b=$('#readerSlotB');
  if(a)a.innerHTML='';if(b)b.innerHTML='';
  reader.animating=false;
}
function activeSlot(){return reader.activeSlot==='A'?$('#readerSlotA'):$('#readerSlotB');}
function inactiveSlot(){return reader.activeSlot==='A'?$('#readerSlotB'):$('#readerSlotA');}

async function renderPdfToCanvas(pageNum, maxW, maxH){
  if(reader.cache[pageNum]) return reader.cache[pageNum];
  var page=await reader.pdf.getPage(pageNum);
  var v1=page.getViewport({scale:1});
  var fitScale=Math.min(maxW/v1.width, maxH/v1.height);
  var dpr=Math.min(2,window.devicePixelRatio||1);
  var finalScale=fitScale*reader.zoom;
  var viewport=page.getViewport({scale:finalScale*dpr});
  var canvas=document.createElement('canvas');
  canvas.width=Math.floor(viewport.width);
  canvas.height=Math.floor(viewport.height);
  canvas.style.width=Math.floor(viewport.width/dpr)+'px';
  canvas.style.height=Math.floor(viewport.height/dpr)+'px';
  var ctx=canvas.getContext('2d');
  await page.render({canvasContext:ctx, viewport:viewport}).promise;
  reader.cache[pageNum]=canvas;
  return canvas;
}

async function renderSpreadToSlot(slotEl, leftPage){
  slotEl.innerHTML='';
  var stage=$('#readerStage');
  var step=readerStep();
  var gap=step===2?16:0;
  var padH=step===2?24:8;
  var availH=stage.clientHeight-40;
  var availW=step===2 ? ((stage.clientWidth - padH - gap) / 2) : (stage.clientWidth - padH);
  var wrap=document.createElement('div');
  wrap.className='reader-spread'+(step===1?' single':'');
  wrap.style.gap=gap+'px';
  var leftCanvas = await renderPdfToCanvas(leftPage, availW, availH);
  wrap.appendChild(leftCanvas);
  if(step===2 && (leftPage + 1) <= reader.totalPages){
    try{
      var rightCanvas = await renderPdfToCanvas(leftPage + 1, availW, availH);
      wrap.appendChild(rightCanvas);
    }catch(e){ console.warn('right page:', e.message); }
  }
  slotEl.appendChild(wrap);
}

function updateReaderIndicator(){
  var ind=$('#readerPageIndicator');
  var step=readerStep();
  var rightPage = (step===2 && (reader.currentPage+1)<=reader.totalPages) ? reader.currentPage+1 : null;
  if(ind){
    ind.textContent = rightPage
      ? (reader.currentPage + '–' + rightPage + ' / ' + reader.totalPages)
      : (reader.currentPage + ' / ' + reader.totalPages);
  }
  var pr=$('#readerProgress');
  if(pr&&reader.totalPages) pr.style.width=((reader.currentPage/reader.totalPages)*100)+'%';
  var prevBtn=$('#readerPrev');if(prevBtn)prevBtn.disabled=(reader.currentPage<=1);
  var nextBtn=$('#readerNext');
  if(nextBtn) nextBtn.disabled=(reader.currentPage + step > reader.totalPages);
}

async function renderCurrentPage(){
  var slot=activeSlot();
  if(!slot) return;
  var loading=$('#readerLoading');
  if(loading)loading.hidden=false;
  try{
    await renderSpreadToSlot(slot, reader.currentPage);
    slot.style.transform='translateX(0)';
    slot.classList.remove('hidden');
  }catch(e){ console.error('render spread:', e); }
  if(loading)loading.hidden=true;
}

async function goToPage(target, direction){
  if(!reader.pdf || reader.animating) return;
  var step=readerStep();
  target=normalizeLeftPage(target);
  target=Math.max(1, Math.min(reader.totalPages, target));
  if(target===reader.currentPage) return;
  reader.animating=true;
  var dir = direction || (target>reader.currentPage ? 'next' : 'prev');
  var cur = activeSlot();
  var nxt = inactiveSlot();
  nxt.innerHTML='';
  var loading=$('#readerLoading');
  if(loading)loading.hidden=false;
  try{
    await renderSpreadToSlot(nxt, target);
  }catch(e){console.error(e);}
  if(loading)loading.hidden=true;
  var offX = dir==='next' ? '100%' : '-100%';
  var exitX = dir==='next' ? '-100%' : '100%';
  nxt.style.transition='none';
  nxt.style.transform='translateX('+offX+')';
  nxt.classList.remove('hidden');
  void nxt.offsetWidth;
  nxt.style.transition='';
  cur.style.transition='';
  nxt.style.transform='translateX(0)';
  cur.style.transform='translateX('+exitX+')';
  setTimeout(function(){
    cur.classList.add('hidden');
    cur.style.transform='translateX(0)';
    reader.activeSlot = reader.activeSlot==='A' ? 'B' : 'A';
    reader.currentPage = target;
    updateReaderIndicator();
    reader.animating=false;
  }, 340);
}

function updateReaderZoomLabel(){
  var el=$('#readerZoomVal');
  if(el) el.textContent=Math.round(reader.zoom*100)+'%';
}
function readerZoom(delta){
  var z=Math.max(0.5, Math.min(3, reader.zoom + delta));
  if(z===reader.zoom) return;
  reader.zoom=z;
  reader.cache={};
  updateReaderZoomLabel();
  var slot=activeSlot(); if(slot) slot.innerHTML='';
  renderCurrentPage();
}

async function resolveOutlineDest(dest){
  if(!dest || !reader.pdf) return -1;
  try{
    var d = dest;
    if(typeof d === 'string'){
      d = await reader.pdf.getDestination(d);
      if(!d) return -1;
    }
    if(!d || !d[0]) return -1;
    var ref = d[0];
    if(typeof ref === 'number') return ref;
    var idx = await reader.pdf.getPageIndex(ref);
    return (typeof idx === 'number' && idx >= 0) ? idx : -1;
  }catch(e){ console.warn('outline dest:', e.message); return -1; }
}

async function renderReaderToc(){
  var host=$('#readerTocList');if(!host)return;
  host.innerHTML='<div class="muted" style="padding:20px;text-align:center;font-size:13px">Загрузка оглавления…</div>';
  if(!reader.outline || !reader.outline.length){
    host.innerHTML='<div class="empty" style="padding:24px 16px">В PDF нет встроенного оглавления</div>';
    return;
  }
  var flat = [];
  async function collect(items, level){
    for(var i=0;i<items.length;i++){
      var it = items[i];
      var pageIdx = await resolveOutlineDest(it.dest);
      flat.push({ title: it.title || '—', level: Math.min(3, level), pageIndex: pageIdx });
      if(it.items && it.items.length) await collect(it.items, level+1);
    }
  }
  try { await collect(reader.outline, 1); } catch(e){ console.error(e); }
  host.innerHTML='';
  if(!flat.length){ host.innerHTML='<div class="empty" style="padding:24px 16px">Пустое оглавление</div>'; return; }
  flat.forEach(function(item){
    var btn=document.createElement('button');
    btn.className='reader-toc-item lvl-'+item.level;
    btn.textContent=item.title;
    if(item.pageIndex < 0){
      btn.style.opacity='.5';
      btn.title='Страница не определена';
    }
    btn.onclick=function(){
      if(item.pageIndex < 0){ toast('Не удалось определить страницу','warn'); return; }
      $('#readerTocPanel').hidden=true;
      var target = item.pageIndex + 1;
      goToPage(target, target > reader.currentPage ? 'next' : 'prev');
    };
    host.appendChild(btn);
  });
}

async function openReader(bookId){
  show('view-reader');
  readerClose();
  reader.bookId=bookId;
  reader.activeSlot='A';
  reader.zoom=1;
  updateReaderZoomLabel();
  var slotA=$('#readerSlotA'),slotB=$('#readerSlotB');
  slotA.innerHTML='';slotB.innerHTML='';
  slotA.style.transform='translateX(0)';
  slotB.style.transform='translateX(0)';
  slotA.classList.remove('hidden');
  slotB.classList.add('hidden');
  var loading=$('#readerLoading');if(loading)loading.hidden=false;
  try{
    var r=await api('/books/'+bookId);
    var b=r.book;
    reader.book=b;
    $('#readerTitle').textContent=b.title;
    if(!b.hasPdf){
      if(loading)loading.hidden=true;
      $('#readerSlotA').innerHTML='<div class="card err" style="margin:40px auto;max-width:600px">К этой книге не загружен PDF-файл.</div>';
      return;
    }
    pdfSetupWorker();
    if(!window.pdfjsLib){
      if(loading)loading.hidden=true;
      $('#readerSlotA').innerHTML='<div class="card err" style="margin:40px auto;max-width:600px">Не удалось загрузить pdf.js.</div>';
      return;
    }
    var tk=getToken();
    var loadingTask=pdfjsLib.getDocument({
      url:'/api/books/'+bookId+'/pdf',
      httpHeaders: tk ? {'Authorization':'Bearer '+tk} : {},
      withCredentials:false
    });
    reader.pdf=await loadingTask.promise;
    reader.totalPages=reader.pdf.numPages;
    var saved=1;
    try{ saved=parseInt(localStorage.getItem('reader_page_'+bookId)||'1')||1; }catch(e){}
    reader.currentPage=normalizeLeftPage(Math.max(1, Math.min(reader.totalPages, saved)));
    updateReaderIndicator();
    await renderCurrentPage();
    if(loading)loading.hidden=true;
    try{
      var outline=await reader.pdf.getOutline();
      reader.outline=outline||[];
    }catch(e){reader.outline=[];}
    renderReaderToc();
    renderReaderBookmarks(b.bookmarks||[]);
    if(!reader.hintShown && 'ontouchstart' in window){
      reader.hintShown=true;
      var hint=$('#readerHint');
      if(hint){hint.hidden=false;setTimeout(function(){hint.hidden=true;},3500);}
    }
    window.__readerSavePage=function(){
      try{localStorage.setItem('reader_page_'+bookId, String(reader.currentPage));}catch(e){}
    };
  }catch(e){
    console.error(e);
    if(loading)loading.hidden=true;
    $('#readerSlotA').innerHTML='<div class="card err" style="margin:40px auto;max-width:600px">'+esc(e.message||'Ошибка загрузки PDF')+'</div>';
  }
}

function renderReaderBookmarks(bms){
  var host=$('#readerBookmarksList');if(!host)return;
  host.innerHTML='';
  if(!bms.length){host.innerHTML='<div class="empty" style="padding:24px 16px">Закладок нет</div>';return;}
  bms.forEach(function(bm){
    var el=document.createElement('div');el.className='bookmark-item';
    el.innerHTML='<div class="bm-body"><div class="bm-pos">Страница '+bm.position+'</div>'+
      (bm.note?'<div class="bm-note">'+esc(bm.note)+'</div>':'')+'</div>';
    var del=document.createElement('button');del.textContent='✕';
    del.onclick=async function(e){e.stopPropagation();try{await api('/bookmarks/'+bm.id,{method:'DELETE'});openReader(reader.bookId);}catch(e){toast(e.message,'err');}};
    el.appendChild(del);
    el.onclick=function(){
      $('#readerBookmarksPanel').hidden=true;
      goToPage(bm.position, bm.position>reader.currentPage?'next':'prev');
    };
    host.appendChild(el);
  });
}

async function addBookmarkFromReader(){
  if(!reader.bookId)return;
  var page=reader.currentPage||1;
  var note=prompt('Заметка к закладке (страница '+page+', можно оставить пустым):','');
  if(note===null)return;
  try{await api('/books/'+reader.bookId+'/bookmarks',{method:'POST',body:{position:page,note:note||null}});toast('Закладка добавлена','ok');openReader(reader.bookId);}
  catch(e){toast(e.message,'err');}
}

function toggleReaderUI(){
  reader.uiHidden=!reader.uiHidden;
  ['#readerTopbar','#readerProgress'].forEach(function(sel){
    var el=$(sel);if(!el)return;
    el.classList.toggle('hidden-ui', reader.uiHidden);
  });
  var ind=$('#readerPageIndicator');
  if(ind)ind.classList.toggle('hidden-ui', reader.uiHidden);
}

/* ADMIN */
async function openAdmin(){
  if(!isAdmin())return;
  show('view-admin');
  try { skeleton($('#adminStats'),3); } catch(e){}
  try { skeleton($('#adminUsersList'),4); } catch(e){}
  try { await loadAdminUsers(); } catch(e){ console.error('loadAdminUsers:', e); }
  try { refreshBankStats(); } catch(e){ console.error('refreshBankStats:', e); }
}

async function loadAdminLogs(){
  var host=$('#adminLogsList');if(!host)return;skeleton(host,5);
  try{
    var r=await api('/admin/logs?limit=200');
    host.innerHTML='';
    if(!r.logs.length){host.innerHTML='<div class="empty" style="padding:40px">Пока нет записей</div>';return;}
    r.logs.forEach(function(l){
      var el=document.createElement('div');el.className='log-row';
      el.innerHTML='<div class="log-time">'+fmtDate(l.at)+'</div>'+
        '<div class="log-who">'+esc(l.userName)+'</div>'+
        '<div class="log-action">'+esc(l.action)+(l.details?'<div class="log-details">'+esc(l.details)+'</div>':'')+'</div>';
      host.appendChild(el);
    });
  }catch(e){host.innerHTML='<div class="err">'+esc(e.message)+'</div>';}
}

async function loadBackups(){
  var host=$('#adminBackupsList');if(!host)return;skeleton(host,3);
  try{
    var r=await api('/admin/backups');
    host.innerHTML='';
    if(!r.backups.length){host.innerHTML='<div class="empty" style="padding:40px">Пока нет бэкапов</div>';return;}
    r.backups.forEach(function(b){
      var el=document.createElement('div');el.className='backup-row';
      var date=new Date(b.createdAt).toLocaleString('ru-RU');
      el.innerHTML='<div class="bi-info"><b>'+(b.auto?'Авто':'Ручной')+'</b><div class="muted">'+date+' · '+fmtSize(b.size)+'</div></div>';
      var dl=document.createElement('button');dl.className='primary small';dl.textContent='Скачать';
      dl.onclick=async function(){
        try{
          var tk=getToken();
          var res=await fetch('/api/admin/backups/'+b.id+'/download',{headers:{Authorization:'Bearer '+tk}});
          if(!res.ok)throw new Error('Не удалось');
          var blob=await res.blob();
          var a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=b.key.split('/').pop();
          document.body.appendChild(a);a.click();a.remove();
        }catch(e){toast(e.message,'err');}
      };
      var del=document.createElement('button');del.className='ghost small danger';del.textContent='✕';
      del.onclick=async function(){if(!confirm('Удалить бэкап?'))return;try{await api('/admin/backups/'+b.id,{method:'DELETE'});toast('Удалён','ok');loadBackups();}catch(e){toast(e.message,'err');}};
      el.appendChild(dl);el.appendChild(del);host.appendChild(el);
    });
  }catch(e){host.innerHTML='<div class="err">'+esc(e.message)+'</div>';}
}

async function createBackupNow(){
  var btn=$('#btnCreateBackup');if(!btn)return;btn.disabled=true;
  try{await api('/admin/backups/create',{method:'POST'});toast('Бэкап создан','ok');loadBackups();}
  catch(e){toast(e.message,'err');}
  finally{btn.disabled=false;}
}

async function loadAdminUsers(){
  try{
    var q=$('#adminSearch').value.trim();
    var role=$('#adminRoleFilter').value;
    var r=await api('/admin/users?q='+encodeURIComponent(q)+'&role='+encodeURIComponent(role));
    var sh=$('#adminStats');sh.innerHTML='';
    [['Всего',r.stats.total],['Админов',r.stats.admin],['Репетиторов',r.stats.teacher],
     ['Библиотекарей',r.stats.librarian],['Учеников',r.stats.student],
     ['Работ',r.stats.tests],['Книг',r.stats.books],['Банк',r.stats.bank||0]].forEach(function(s){
      var c=document.createElement('div');c.className='stat-card';
      c.innerHTML='<div class="stat-value">'+s[1]+'</div><div class="stat-label">'+s[0]+'</div>';
      sh.appendChild(c);
    });
    var host=$('#adminUsersList');host.innerHTML='';
    if(!r.users.length){host.innerHTML='<div class="empty" style="padding:40px">Никого не найдено</div>';return;}
    r.users.forEach(function(u){
      var el=document.createElement('div');el.className='admin-row';
      el.innerHTML='<div class="avatar"></div>'+
        '<div class="info"><b>'+esc(u.name)+'</b>'+
        '<div class="muted">'+esc(u.email)+' · '+fmtDate(u.createdAt)+'</div>'+
        '<div class="muted" style="font-size:12px;margin-top:3px">Групп: '+u.stats.classes_created+' · В группах: '+u.stats.classes_joined+' · Сдач: '+u.stats.submissions+' · Книг: '+u.stats.books+'</div></div>';
      renderAvatar(el.querySelector('.avatar'),u,44);
      var sel=document.createElement('select');sel.style.cssText='width:auto;margin:0';
      ['student','teacher','librarian','admin'].forEach(function(role){
        var o=document.createElement('option');o.value=role;
        o.textContent={'admin':'Администратор','teacher':'Репетитор','librarian':'Библиотекарь','student':'Ученик'}[role];
        if(role===u.role)o.selected=true;sel.appendChild(o);
      });
      sel.onchange=async function(){
        if(u.id===currentUser.id){toast('Нельзя менять свою роль','warn');sel.value=u.role;return;}
        if(!confirm('Изменить роль '+u.name+' на «'+sel.options[sel.selectedIndex].text+'»?')){sel.value=u.role;return;}
        try{await api('/admin/users/'+u.id+'/role',{method:'POST',body:{role:sel.value}});toast('Роль изменена','ok');loadAdminUsers();}
        catch(e){toast(e.message,'err');sel.value=u.role;}
      };
      el.appendChild(sel);
      var bReset=document.createElement('button');bReset.className='ghost small';bReset.textContent='Сбросить пароль';
      bReset.onclick=async function(){
        if(!confirm('Сбросить пароль для '+u.name+'?'))return;
        try{var rr=await api('/admin/users/'+u.id+'/reset-password',{method:'POST'});prompt('Новый пароль:',rr.password);}
        catch(e){toast(e.message,'err');}
      };
      el.appendChild(bReset);
      var bDel=document.createElement('button');bDel.className='ghost small danger';bDel.textContent='Удалить';
      bDel.onclick=async function(){
        if(u.id===currentUser.id){toast('Нельзя удалить себя','warn');return;}
        if(!confirm('Удалить '+u.name+' ('+u.email+')?'))return;
        try{await api('/admin/users/'+u.id,{method:'DELETE'});toast('Удалён','ok');loadAdminUsers();}
        catch(e){toast(e.message,'err');}
      };
      el.appendChild(bDel);host.appendChild(el);
    });
  }catch(e){toast(e.message,'err');}
}

/* PROFILE */
async function openProfileStats(){
  if(!currentUser)return;
  show('view-profile');
  var host=$('#profileStats');if(!host)return;skeleton(host,4);
  try{
    var meR=await api('/auth/me');var user=meR.user;currentUser=user;renderTop();
    var stats=null;
    if(user.role==='student'){try{stats=await api('/profile/student');}catch(e){}}
    else if(user.role==='teacher'||user.role==='admin'){try{stats=await api('/profile/teacher');}catch(e){}}
    host.innerHTML='';
    var hero=document.createElement('div');hero.className='card';
    hero.style.cssText='display:flex;align-items:center;gap:22px;flex-wrap:wrap;padding:24px 26px';
    hero.innerHTML='<div class="avatar" id="profHeroAvatar" style="width:88px;height:88px;font-size:34px"></div>'+
      '<div style="flex:1;min-width:200px">'+
      '<div style="font-size:28px;font-weight:900;letter-spacing:-0.03em;line-height:1.1;margin-bottom:8px">'+esc(user.name)+'</div>'+
      '<span class="pill blue">'+roleLabel()+'</span>'+
      '<div class="muted" style="margin-top:10px;font-size:13.5px">'+esc(user.email)+'</div></div>';
    host.appendChild(hero);
    renderAvatar($('#profHeroAvatar'),user,88);

    var sc=document.createElement('div');sc.className='card';sc.style.marginTop='16px';
    var curTheme=document.documentElement.getAttribute('data-theme');
    var curPal=document.documentElement.getAttribute('data-palette')||'orange';
    sc.innerHTML='<h3 style="margin-bottom:16px">Оформление</h3>'+
      '<div class="muted" style="font-size:12.5px;margin-bottom:8px;font-weight:700">Тема</div>'+
      '<div class="theme-picker" id="profThemePicker">'+
      '<button class="theme-option'+(curTheme==='dark'?' active':'')+'" data-theme-set="dark">Тёмная</button>'+
      '<button class="theme-option'+(curTheme==='light'?' active':'')+'" data-theme-set="light">Светлая</button></div>'+
      '<div class="muted" style="font-size:12.5px;margin:20px 0 8px;font-weight:700">Палитра</div>'+
      '<div class="palette-picker" id="profPalettePicker">'+
      '<div class="palette-option'+(curPal==='orange'?' active':'')+'" data-pal="orange"></div>'+
      '<div class="palette-option'+(curPal==='blue'?' active':'')+'" data-pal="blue"></div>'+
      '<div class="palette-option'+(curPal==='violet'?' active':'')+'" data-pal="violet"></div>'+
      '<div class="palette-option'+(curPal==='emerald'?' active':'')+'" data-pal="emerald"></div></div>';
    host.appendChild(sc);
    $$('#profThemePicker .theme-option').forEach(function(b){b.onclick=function(){applyTheme(b.dataset.themeSet);$$('#profThemePicker .theme-option').forEach(function(x){x.classList.remove('active');});b.classList.add('active');buildUserMenu();};});
    $$('#profPalettePicker .palette-option').forEach(function(b){b.onclick=function(){applyPalette(b.dataset.pal);$$('#profPalettePicker .palette-option').forEach(function(x){x.classList.remove('active');});b.classList.add('active');};});
    var tgCard=document.createElement('div');tgCard.className='card';tgCard.style.marginTop='16px';
    tgCard.innerHTML='<h3 style="margin-bottom:14px">Telegram-уведомления</h3><div id="profTgBox"><div class="muted">Проверка…</div></div>';
    host.appendChild(tgCard);
    renderProfileTelegram();

    if(stats){
      if(user.role==='student'){
        var statCard=document.createElement('div');statCard.className='card';statCard.style.marginTop='16px';
        statCard.innerHTML='<h3 style="margin-bottom:16px">Прогресс</h3>';
        var dash=document.createElement('div');dash.className='dash-summary';dash.style.marginBottom='0';
        [['Групп',stats.classesCount,'i-book'],['Сдач',stats.submissionsCount,'i-edit'],
         ['Средний',stats.avgPercent+'%','i-chart'],['Баллы',stats.totalScore+' / '+stats.totalMax,'i-chart'],
         ['Книг',stats.booksCount,'i-book']].forEach(function(it){
          var c=document.createElement('div');c.className='dash-item';
          c.innerHTML='<div class="di-label">'+it[0]+'</div><div class="di-value'+(it[0]==='Средний'?' accent':'')+'">'+it[1]+'</div><div class="di-icon"><svg><use href="#'+it[2]+'"/></svg></div>';
          dash.appendChild(c);
        });
        statCard.appendChild(dash);host.appendChild(statCard);
        if(stats.recent&&stats.recent.length){
          var rc=document.createElement('div');rc.className='card';rc.style.marginTop='16px';
          rc.innerHTML='<h3 style="margin-bottom:14px">Последние сдачи</h3>';
          stats.recent.forEach(function(s){
            var pct=s.max?Math.round(s.score/s.max*100):0;
            var el=document.createElement('div');el.className='stu-row';
            el.innerHTML='<div class="name"><div style="font-weight:600">'+esc(s.testTitle||'—')+'</div><div class="muted">'+fmt(s.at)+'</div></div><div class="score '+(pct>=60?'ok':'err')+'">'+s.score+' / '+s.max+'</div>';
            rc.appendChild(el);
          });
          host.appendChild(rc);
        }
      } else {
        var ts=document.createElement('div');ts.className='card';ts.style.marginTop='16px';
        ts.innerHTML='<h3 style="margin-bottom:16px">Статистика</h3>';
        var dash2=document.createElement('div');dash2.className='dash-summary';dash2.style.marginBottom='0';
        [['Групп',stats.classesCount,'i-book'],['Учеников',stats.studentsCount,'i-users'],
         ['Работ',stats.testsCount,'i-edit'],['Сдач',stats.submissionsCount,'i-chart'],
         ['Средний',stats.avgPercent+'%','i-chart'],['Банк',stats.bankCount||0,'i-layers']].forEach(function(it){
          var c=document.createElement('div');c.className='dash-item';
          c.innerHTML='<div class="di-label">'+it[0]+'</div><div class="di-value'+(it[0]==='Средний'?' accent':'')+'">'+it[1]+'</div><div class="di-icon"><svg><use href="#'+it[2]+'"/></svg></div>';
          dash2.appendChild(c);
        });
        ts.appendChild(dash2);host.appendChild(ts);
      }
    }
  }catch(e){host.innerHTML='<div class="card err">'+esc(e.message)+'</div>';}
}

async function renderProfileTelegram(){
  var box=$('#profTgBox');if(!box)return;
  box.innerHTML='<div class="muted">Проверка…</div>';
  try{
    var me=await api('/auth/me');var user=me.user;
    if(user.telegram){
      box.innerHTML='<div class="ok" style="font-weight:700">✅ Подключен'+(user.telegram.username?' как '+esc(user.telegram.username):'')+'</div>';
      var btn=document.createElement('button');btn.className='ghost small danger';btn.style.marginTop='12px';btn.textContent='Отключить';
      btn.onclick=async function(){try{await api('/telegram/unlink',{method:'POST'});toast('Отключено','ok');renderProfileTelegram();}catch(e){toast(e.message,'err');}};
      box.appendChild(btn);
    } else {
      try{
        var link=await api('/telegram/link');
        box.innerHTML='<div class="muted">Уведомления в Telegram не подключены</div>';
        var a=document.createElement('a');a.className='tg-link';a.href=link.link;a.target='_blank';a.rel='noopener';a.innerHTML='✈️ Подключить Telegram';
        box.appendChild(a);
        var check=document.createElement('button');check.className='ghost small';check.style.marginTop='12px';check.style.display='block';
        check.textContent='Я подключил — проверить';check.onclick=function(){renderProfileTelegram();};box.appendChild(check);
      }catch(e){box.innerHTML='<div class="muted">Telegram не настроен на сервере</div>';}
    }
  }catch(e){box.innerHTML='<div class="err">'+esc(e.message)+'</div>';}
}

async function openEditProfile(){
  if(!currentUser)return;
  show('view-editprofile');
  try{
    var me=await api('/auth/me');var user=me.user;currentUser=user;
    renderAvatar($('#editAvatar'),user,148);
    $('#editName').value=user.name||'';
    $('#editEmail').value=user.email||'';
    $('#editPass').value='';
    $('#editErr').textContent='';
    var av=$('#editAvatar');
    if(user.hasAvatar){
      var bust=null;try{bust=localStorage.getItem('avatar_bust_'+user.id);}catch(e){}
      av.style.backgroundImage="url('/api/users/"+user.id+"/avatar"+(bust?('?v='+bust):'')+"')";
      av.textContent='';
    } else {av.style.backgroundImage='';av.textContent=(user.name?user.name[0]:'?').toUpperCase();}
    var bdel=$('#btnDeleteAvatar');
    if(bdel) bdel.hidden = !user.hasAvatar;
  }catch(e){toast(e.message,'err');}
}

async function saveProfile(){
  var err=$('#editErr');if(err)err.textContent='';
  var name=$('#editName').value.trim();
  var email=$('#editEmail').value.trim();
  var pass=$('#editPass').value;
  if(pass&&pass.length<6){if(err)err.textContent='Пароль от 6 символов';return;}
  var body={};
  if(name)body.name=name;
  if(email)body.email=email;
  if(pass)body.password=pass;
  var btn=$('#btnSaveProfile');btn.disabled=true;
  try{
    var r=await api('/users/me',{method:'PATCH',body:body});
    currentUser=r.user;renderTop();toast('Сохранено','ok');openProfileStats();
  }catch(e){if(err)err.textContent=e.message;toast(e.message,'err');}
  finally{btn.disabled=false;}
}

async function uploadAvatarFile(file){
  if(!file)return;
  if(file.size>5*1024*1024){toast('Файл больше 5 МБ','warn');return;}
  var fd=new FormData();fd.append('avatar',file);
  try{
    await apiForm('/users/me/avatar',fd);
    currentUser.hasAvatar = true;
    try{localStorage.setItem('avatar_bust_'+currentUser.id,String(Date.now()));}catch(e){}
    renderTop();
    renderAvatar($('#editAvatar'),currentUser,148);
    var bdel=$('#btnDeleteAvatar');
    if(bdel) bdel.hidden=false;
    try{
      var me = await api('/auth/me');
      if(me && me.user){
        currentUser = me.user;
        renderTop();
        renderAvatar($('#editAvatar'),currentUser,148);
      }
    }catch(e){ console.warn('sync /auth/me:', e.message); }
    toast('Аватар обновлён','ok');
  }catch(e){toast(e.message,'err');}
}

async function deleteAvatarFile(){
  if(!currentUser)return;
  if(!confirm('Удалить аватар?'))return;
  var btn=$('#btnDeleteAvatar'); if(btn) btn.disabled=true;
  try{
    await api('/users/me/avatar',{method:'DELETE'});
    currentUser.hasAvatar=false;
    try{localStorage.removeItem('avatar_bust_'+currentUser.id);}catch(e){}
    renderTop();
    renderAvatar($('#editAvatar'),currentUser,148);
    var bdel=$('#btnDeleteAvatar');
    if(bdel){ bdel.hidden=true; bdel.disabled=false; }
    toast('Аватар удалён','ok');
  }catch(e){
    toast(e.message,'err');
    if(btn) btn.disabled=false;
  }
}

/* ENTER APP */
function enterApp(user){
  currentUser=user;renderTop();refreshNotifBadge();
  if(notifTimer)clearInterval(notifTimer);
  notifTimer=setInterval(refreshNotifBadge,60000);
  if(user.role==='student') goStudent();
  else if(user.role==='teacher'||user.role==='admin') goTeacher();
  else if(user.role==='librarian') openLibrary();
  else show('view-landing');
}

/* BIND ALL */
function bindAll(){
  $$('#topbarTabs .tt-btn').forEach(function(btn){
    btn.onclick=function(){
      var tab=btn.dataset.tab;
      if(!currentUser){ show('view-landing'); return; }
      if(tab==='home'){
        if(currentUser.role==='student') goStudent();
        else if(currentUser.role==='teacher'||currentUser.role==='admin') goTeacher();
        else openLibrary();
      }
      else if(tab==='bank'){
        openTaskBank();
      }
      else if(tab==='library'){
        openLibrary();
      }
      updateTopbarTabs();
    };
  });

  var br=$('#brandBtn');
  if(br) br.onclick=function(){
    if(!currentUser) return show('view-landing');
    if(currentUser.role==='student') return goStudent();
    if(currentUser.role==='teacher'||currentUser.role==='admin') return goTeacher();
    if(currentUser.role==='librarian') return openLibrary();
    show('view-landing');
  };
  var bn=$('#btnNotif');
  if(bn) bn.onclick=function(e){e.stopPropagation();if(notifOpen){closeNotifPanel();return;}notifOpen=true;var p=$('#notifPanel');if(p)p.hidden=false;loadNotifications();};
  document.addEventListener('click',function(e){
    var p=$('#notifPanel');
    if(p&&!p.hidden&&!p.contains(e.target)&&e.target.id!=='btnNotif'&&!e.target.closest('#btnNotif'))closeNotifPanel();
    var chip=$('#userChip'),menu=$('#userMenu');
    if(menu&&!menu.hidden&&!menu.contains(e.target)&&chip&&!chip.contains(e.target))closeUserMenu();
  });
  var uc=$('#userChip');
  if(uc) uc.onclick=function(e){e.stopPropagation();if(userMenuOpen)closeUserMenu();else openUserMenu();};

  function switchAuthTab(tab){
    $$('.tab[data-tab]').forEach(function(x){x.classList.toggle('active',x.dataset.tab===tab);});
    var lf=$('#loginForm'),rf=$('#regForm');
    if(lf)lf.hidden=(tab!=='login');
    if(rf)rf.hidden=(tab!=='reg');
    var ae=$('#authErr');if(ae)ae.textContent='';
  }
  var ls1=$('#landingStart'),ls2=$('#landingStart2'),ll=$('#landingLogin');
  if(ls1)ls1.onclick=function(){show('view-auth');switchAuthTab('reg');};
  if(ls2)ls2.onclick=function(){show('view-auth');switchAuthTab('reg');};
  if(ll)ll.onclick=function(){show('view-auth');switchAuthTab('login');};
  var lbb=$('#landingBankBtn');
  if(lbb)lbb.onclick=function(){show('view-auth');switchAuthTab('reg');};
  $$('.tab[data-tab]').forEach(function(t){t.onclick=function(){switchAuthTab(t.dataset.tab);};});
  $$('.pass-toggle').forEach(function(b){b.onclick=function(){var inp=$('#'+b.dataset.target);if(inp)inp.type=inp.type==='password'?'text':'password';};});

  var dl=$('#doLogin');
  if(dl)dl.onclick=async function(){
    var ae=$('#authErr');if(ae)ae.textContent='';
    var email=$('#loginEmail').value.trim(),pass=$('#loginPass').value;
    if(!email||!pass){if(ae)ae.textContent='Введите email и пароль';return;}
    dl.disabled=true;
    try{var r=await api('/auth/login',{method:'POST',body:{email:email,password:pass}});setToken(r.token);enterApp(r.user);toast('Вы вошли','ok');}
    catch(e){if(ae)ae.textContent=e.message;toast(e.message,'err');}
    finally{dl.disabled=false;}
  };
  var dr=$('#doRegister');
  if(dr)dr.onclick=async function(){
    var ae=$('#authErr');if(ae)ae.textContent='';
    var name=$('#regName').value.trim(),email=$('#regEmail').value.trim(),pass=$('#regPass').value;
    if(!name||!email||!pass){if(ae)ae.textContent='Заполните все поля';return;}
    if(pass.length<6){if(ae)ae.textContent='Пароль от 6 символов';return;}
    dr.disabled=true;
    try{var r=await api('/auth/register',{method:'POST',body:{name:name,email:email,password:pass}});setToken(r.token);enterApp(r.user);toast('Аккаунт создан','ok');}
    catch(e){if(ae)ae.textContent=e.message;toast(e.message,'err');}
    finally{dr.disabled=false;}
  };

  var bnc=$('#btnNewClass');
  if(bnc)bnc.onclick=async function(){
    var name=prompt('Название группы:');if(!name||!name.trim())return;
    try{await api('/classes',{method:'POST',body:{name:name.trim()}});toast('Группа создана','ok');goTeacher();}
    catch(e){toast(e.message,'err');}
  };
  var bnt=$('#btnNewTest');if(bnt)bnt.onclick=function(){openEditor(null);};

  $$('.tab[data-ttab]').forEach(function(t){t.onclick=function(){
    $$('.tab[data-ttab]').forEach(function(x){x.classList.remove('active');});t.classList.add('active');
    var tab=t.dataset.ttab;$('#tt-tests').hidden=(tab!=='tests');$('#tt-classes').hidden=(tab!=='classes');
  };});
  $$('.tab[data-stab]').forEach(function(t){t.onclick=function(){
    $$('.tab[data-stab]').forEach(function(x){x.classList.remove('active');});t.classList.add('active');
    var tab=t.dataset.stab;$('#st-tests').hidden=(tab!=='tests');$('#st-classes').hidden=(tab!=='classes');
  };});
  $$('.tab[data-admintab]').forEach(function(t){t.onclick=function(){
    $$('.tab[data-admintab]').forEach(function(x){x.classList.remove('active');});t.classList.add('active');
    var tab=t.dataset.admintab;
    $('#admin-users-tab').hidden=(tab!=='users');$('#admin-logs-tab').hidden=(tab!=='logs');$('#admin-backups-tab').hidden=(tab!=='backups');
    if(tab==='logs')loadAdminLogs();if(tab==='backups')loadBackups();
  };});
  $$('.sym-tab').forEach(function(t){
    if(t.dataset.banksymtab){
      t.onclick=function(){
        $$('.sym-tab[data-banksymtab]').forEach(function(x){x.classList.remove('active');});
        t.classList.add('active');
        currentBankSymTab=t.dataset.banksymtab;
        buildBankSymbolBar($('#bankSymbolBar'));
      };
    } else {
      t.onclick=function(){
        $$('.sym-tab:not([data-banksymtab])').forEach(function(x){x.classList.remove('active');});
        t.classList.add('active');
        currentSymTab=t.dataset.symtab;
        buildSymbolBar($('#symbolBar'));
      };
    }
  });

  var backMap={
    'btnBackToTeacher':goTeacher,
    'btnBackFromClass':function(){if(isTeacherLike())goTeacher();else goStudent();},
    'btnBackFromAnalytics':function(){if(currentClassId)openClassView(currentClassId);else goTeacher();},
    'btnBackFromRating':function(){if(currentClassId)openClassView(currentClassId);else goTeacher();},
    'btnBackFromTake':function(){if(!currentTest)return goStudent();if(confirm('Выйти? Черновик сохранится.')){if(timerInterval){clearInterval(timerInterval);timerInterval=null;}goStudent();}},
    'btnBackFromSubs':goTeacher,
    'btnBackFromDashboard':goTeacher,
    'btnBackFromBank':function(){ if(isTeacherLike()) goTeacher(); else goStudent(); },
    'btnBackFromLibrary':function(){if(!currentUser)return show('view-landing');if(currentUser.role==='student')return goStudent();if(currentUser.role==='teacher'||currentUser.role==='admin')return goTeacher();show('view-landing');},
    'btnBackFromAdmin':goTeacher,
    'btnBackFromProfile':function(){if(!currentUser)return show('view-landing');if(currentUser.role==='student')return goStudent();if(currentUser.role==='teacher'||currentUser.role==='admin')return goTeacher();if(currentUser.role==='librarian')return openLibrary();show('view-landing');},
    'btnBackFromEditProfile':openProfileStats,
    'btnResultBack':goStudent,
    'btnReaderBack':function(){if(window.__readerSavePage)window.__readerSavePage();openLibrary();}
  };
  Object.keys(backMap).forEach(function(id){var b=$('#'+id);if(b)b.onclick=backMap[id];});

  var bca=$('#btnClassAnalytics');if(bca)bca.onclick=openClassAnalytics;
  var bcr=$('#btnClassRating');if(bcr)bcr.onclick=openClassRating;

  var bcb=$('#btnCreateBackup');if(bcb)bcb.onclick=createBackupNow;
  var bgt=$('#btnGenerateTasks');
  if(bgt) bgt.onclick=async function(){
    var N = parseInt($('#genTasksN').value) || 30;
    if(N < 1 || N > 200){ toast('Число должно быть от 1 до 200', 'warn'); return; }
    if(!confirm('Сгенерировать по ' + N + ' вариантов каждого типа?\nЭто займёт 20-60 секунд.')) return;
    bgt.disabled = true;
    var old = bgt.innerHTML;
    bgt.innerHTML = 'Генерация… это может занять минуту';
    var res = $('#genTasksResult');
    if(res) res.textContent = '⏳ Работаем…';
    try{
      var r = await api('/admin/generate-tasks', { method:'POST', body:{ n: N } });
      if(res) res.innerHTML = '✅ Добавлено: <b style="color:var(--ok)">' + r.added + '</b> задач'
        + (r.failed ? ' · ошибок: ' + r.failed : '');
      toast('Готово: +' + r.added + ' задач', 'ok');
    }catch(e){
      if(res) res.textContent = '❌ ' + e.message;
      toast(e.message, 'err');
    }finally{
      bgt.disabled = false;
      bgt.innerHTML = old;
    }
  };
  var as=$('#adminSearch');if(as)as.oninput=(function(){var t=null;return function(){clearTimeout(t);t=setTimeout(loadAdminUsers,300);};})();
  var arf=$('#adminRoleFilter');if(arf)arf.onchange=loadAdminUsers;

  var bab=$('#btnAddBook');
  if(bab)bab.onclick=function(){var form=$('#bookUploadForm');form.hidden=!form.hidden;if(!form.hidden){clearBookForm();renderBookClassPicker();}};
  var bsb=$('#btnSaveBook');if(bsb)bsb.onclick=saveBook;
  var bcbk=$('#btnCancelBook');if(bcbk)bcbk.onclick=function(){$('#bookUploadForm').hidden=true;clearBookForm();};
  var bSearch=$('#bookSearch');if(bSearch){var st=null;bSearch.oninput=function(){clearTimeout(st);st=setTimeout(searchBooks,250);};}
  var bcf2=$('#bookClassFilter');if(bcf2)bcf2.onchange=searchBooks;
  var bsort=$('#bookSort');if(bsort)bsort.onchange=searchBooks;
  var bbv=$('#btnBookView');
  if(bbv)bbv.onclick=function(){
    bookView=(bookView==='grid')?'list':'grid';
    bbv.innerHTML=(bookView==='grid')
      ? '<svg><use href="#i-list"/></svg> Список'
      : '<svg><use href="#i-grid"/></svg> Сетка';
    searchBooks();
  };
  bindCoverDrop();bindPdfDrop();

  var brToc=$('#btnReaderToc');
  if(brToc)brToc.onclick=function(){var p=$('#readerTocPanel');p.hidden=!p.hidden;$('#readerBookmarksPanel').hidden=true;};
  var brTocC=$('#btnReaderTocClose');if(brTocC)brTocC.onclick=function(){$('#readerTocPanel').hidden=true;};
  var brBm=$('#btnReaderBookmark');if(brBm)brBm.onclick=addBookmarkFromReader;
  var brBmC=$('#btnReaderBookmarksClose');if(brBmC)brBmC.onclick=function(){$('#readerBookmarksPanel').hidden=true;};
  var brZo=$('#btnReaderZoomOut');if(brZo)brZo.onclick=function(){readerZoom(-0.15);};
  var brZi=$('#btnReaderZoomIn');if(brZi)brZi.onclick=function(){readerZoom(0.15);};
  var brFull=$('#btnReaderFull');
  if(brFull)brFull.onclick=function(){
    var el=document.documentElement;
    if(!document.fullscreenElement){
      if(el.requestFullscreen) el.requestFullscreen();
      var icon=brFull.querySelector('use');
      if(icon) icon.setAttribute('href','#i-minimize');
    } else {
      if(document.exitFullscreen) document.exitFullscreen();
      var ic2=brFull.querySelector('use');
      if(ic2) ic2.setAttribute('href','#i-maximize');
    }
  };
  document.addEventListener('fullscreenchange',function(){
    var ic=brFull&&brFull.querySelector('use');
    if(ic) ic.setAttribute('href', document.fullscreenElement ? '#i-minimize' : '#i-maximize');
  });

  var rp=$('#readerPrev');if(rp)rp.onclick=function(){goToPage(reader.currentPage-readerStep(),'prev');};
  var rn=$('#readerNext');if(rn)rn.onclick=function(){goToPage(reader.currentPage+readerStep(),'next');};

  document.addEventListener('keydown',function(e){
    var v=$('#view-reader');
    if(!v||!v.classList.contains('active'))return;
    if(e.target && /input|textarea|select/i.test(e.target.tagName))return;
    if(e.key==='ArrowLeft'||e.key==='PageUp'){e.preventDefault();goToPage(reader.currentPage-readerStep(),'prev');}
    else if(e.key==='ArrowRight'||e.key==='PageDown'||e.key===' '){e.preventDefault();goToPage(reader.currentPage+readerStep(),'next');}
    else if(e.key==='Home'){e.preventDefault();goToPage(1,'prev');}
    else if(e.key==='End'){e.preventDefault();goToPage(reader.totalPages,'next');}
    else if(e.key==='f'||e.key==='F'){ if(brFull) brFull.click(); }
  });

  (function(){
    var stage=$('#readerStage');
    if(!stage)return;
    var sx=0,sy=0,st=0,swiping=false;
    stage.addEventListener('touchstart',function(e){
      if(e.touches.length!==1)return;
      sx=e.touches[0].clientX;sy=e.touches[0].clientY;st=Date.now();swiping=true;
    },{passive:true});
    stage.addEventListener('touchend',function(e){
      if(!swiping)return;swiping=false;
      if(!e.changedTouches||!e.changedTouches.length)return;
      var dx=e.changedTouches[0].clientX-sx;
      var dy=e.changedTouches[0].clientY-sy;
      var dt=Date.now()-st;
      if(Math.abs(dx)>50 && Math.abs(dy)<70 && dt<600){
        if(dx<0) goToPage(reader.currentPage+readerStep(),'next');
        else goToPage(reader.currentPage-readerStep(),'prev');
        return;
      }
      if(Math.abs(dx)<10 && Math.abs(dy)<10 && dt<300){
        var target=e.changedTouches[0].target;
        if(target.closest('.reader-page-nav,.reader-topbar,.reader-toc-panel,.reader-bookmarks-panel')) return;
        toggleReaderUI();
      }
    },{passive:true});
  })();

  (function(){
    var stage=$('#readerStage');
    if(!stage)return;
    stage.addEventListener('click',function(e){
      if(e.target.closest('.reader-page-nav')) return;
      toggleReaderUI();
    });
  })();

  var bep=$('#btnEditProfile');if(bep)bep.onclick=openEditProfile;
  var bsp=$('#btnSaveProfile');if(bsp)bsp.onclick=saveProfile;
  var bce=$('#btnCancelEdit');if(bce)bce.onclick=openProfileStats;
  var bua=$('#btnUploadAvatar');if(bua)bua.onclick=function(){$('#avatarInput').click();};
  var ain=$('#avatarInput');if(ain)ain.onchange=function(){if(this.files[0])uploadAvatarFile(this.files[0]);};
  var bda=$('#btnDeleteAvatar');if(bda)bda.onclick=deleteAvatarFile;

  var sb=$('#supportBtn');if(sb)sb.onclick=toggleSupport;
  var scl=$('#supportClose');if(scl)scl.onclick=toggleSupport;
  var ss=$('#supportSend');if(ss)ss.onclick=function(){supportSend();};
  var si=$('#supportInput');if(si)si.onkeydown=function(e){if(e.key==='Enter'){e.preventDefault();supportSend();}};
  $$('#supportQuick button').forEach(function(b){b.onclick=function(){supportSend(b.dataset.q);};});

  $$('#mobile-nav button').forEach(function(b){
    b.onclick=function(){
      var k=b.dataset.mnav;
      if(!currentUser){if(k==='profile')show('view-auth');else show('view-landing');return;}
      if(k==='home'){
        if(currentUser.role==='student')goStudent();
        else if(currentUser.role==='teacher'||currentUser.role==='admin')goTeacher();
        else openLibrary();
      }
      else if(k==='bank'){openTaskBank();}
      else if(k==='library')openLibrary();
      else if(k==='profile')openProfileStats();
    };
  });

  var tt=$('#toTop');if(tt)tt.onclick=function(){window.scrollTo({top:0,behavior:'smooth'});};
  window.addEventListener('scroll',function(){var t=$('#toTop');if(!t)return;if(window.scrollY>500)t.classList.add('show');else t.classList.remove('show');});

  initEditorFields();
}

/* BOOTSTRAP */
async function bootstrap(){
  var params=new URLSearchParams(location.search);
  var joinCode=params.get('join');
  try{await loadTelegramInfo();}catch(e){}
  if(getToken()){
    try{
      var r=await api('/auth/me');currentUser=r.user;renderTop();refreshNotifBadge();
      if(notifTimer)clearInterval(notifTimer);
      notifTimer=setInterval(refreshNotifBadge,60000);
      if(joinCode&&currentUser.role==='student'){
        try{var cls=await api('/classes/join',{method:'POST',body:{code:joinCode}});toast('Вы присоединились к группе «'+cls.class.name+'»','ok');}
        catch(e){if(e.status!==400)toast(e.message,'warn');}
        history.replaceState(null,'',location.pathname);
      }
      if(currentUser.role==='student')goStudent();
      else if(currentUser.role==='teacher'||currentUser.role==='admin')goTeacher();
      else if(currentUser.role==='librarian')openLibrary();
      else show('view-landing');
    }catch(e){setToken(null);show('view-landing');}
  } else show('view-landing');
  renderTop();
  initReveal();animateCounters();initGoogleLogin();initTelegramLogin();bindAll();registerSW();
}

if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bootstrap);
else bootstrap();

/* Глобальный обработчик ошибок */
window.addEventListener('error', function(e){
  if (e.filename && e.filename.indexOf('app.js') >= 0) {
    console.error('JS error:', e.message, 'at', e.lineno + ':' + e.colno);
  }
});

})();
