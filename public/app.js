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
function roleLabel(){
  if(!currentUser)return '';
  return {'admin':'администратор','teacher':'учитель','librarian':'библиотекарь','student':'ученик'}[currentUser.role]||currentUser.role;
}
function avatarUrl(id,bust){return '/api/users/'+id+'/avatar'+(bust?('?v='+bust):'');}
function renderAvatar(el,user,size){
  if(!el)return;
  el.style.width=(size||28)+'px';el.style.height=(size||28)+'px';
  el.style.fontSize=Math.round((size||28)*0.45)+'px';
  if(user&&user.hasAvatar){
    var bust=null;try{bust=localStorage.getItem('avatar_bust_'+user.id);}catch(e){}
    el.style.backgroundImage="url('"+avatarUrl(user.id,bust)+"')";
    el.textContent='';
  } else {
    el.style.backgroundImage='';
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
function createMathInput(initial,readonly,onChange){
  var wrap=document.createElement('div');wrap.className='mi-wrap';
  var ta=document.createElement('textarea');ta.className='mi-input';
  ta.rows=2;ta.spellcheck=false;ta.placeholder='Например: sqrt(16), 2^2+3, sin(pi/2)';
  ta.value=initial||'';if(readonly)ta.readOnly=true;
  var prev=document.createElement('div');prev.className='mi-preview';
  wrap.appendChild(ta);wrap.appendChild(prev);
  function render(){
    var tex=textToLatex(ta.value);
    if(window.katex&&tex){try{katex.render(tex,prev,{throwOnError:false});}catch(e){prev.textContent=ta.value;}}
    else prev.textContent=ta.value;
  }
  ta.addEventListener('input',function(){render();if(onChange)onChange(ta.value);});
  ta.addEventListener('focus',function(){lastFocused=api;});
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

/* READER STATE */
var reader = {
  bookId:null, book:null, pdf:null, totalPages:0,
  currentPage:1, zoom:1, baseZoom:1,
  activeSlot:'A',
  animating:false,
  cache:{}, // pageNum -> canvas
  outline:[],
  uiHidden:false,
  hintShown:false
};

function show(id){
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
  else if(id==='view-library'||id==='view-reader'){var l=$('[data-mnav="library"]');if(l)l.classList.add('active');}
  else if(id==='view-dashboard'||id==='view-analytics'||id==='view-rating'){var d=$('[data-mnav="dashboard"]');if(d)d.classList.add('active');}
  else if(id==='view-profile'||id==='view-editprofile'){var p=$('[data-mnav="profile"]');if(p)p.classList.add('active');}
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
  var els=$$('.landing-stat .ls-value[data-count]');
  els.forEach(function(el){
    var raw=el.dataset.count;if(raw==='infinity') return;
    var target=parseInt(raw);if(isNaN(target)) return;
    var suffix=el.textContent.replace(/^[\d\s]+/,'');
    var dur=1400,start=null;
    function tick(ts){if(!start)start=ts;var p=Math.min(1,(ts-start)/dur);var v=Math.round(target*(1-Math.pow(1-p,3)));el.textContent=v+suffix;if(p<1)requestAnimationFrame(tick);}
    requestAnimationFrame(tick);
  });
}

/* TOPBAR */
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
  menu.appendChild(item('i-book','Библиотека','Учебники и пособия',openLibrary));
  if(isTeacherLike()) menu.appendChild(item('i-edit','Мои работы','Работы и классы',goTeacher));
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
  if(!currentUser){if(wrap)wrap.hidden=true;return;}
  if(wrap)wrap.hidden=false;
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
  'как создать класс':'В кабинете учителя нажмите «+ Класс» вверху страницы. После создания вы получите код — отправьте его ученикам.',
  'как пригласить ученика':'Откройте класс и нажмите «Ссылка» — ученик перейдёт по ней и сразу присоединится. Или отправьте 6-значный код.',
  'как добавить книгу':'Библиотека → «Загрузить». Заполните поля, загрузите PDF (до 60 МБ) и, при желании, обложку.',
  'как поставить дедлайн':'В редакторе работы в блоке «Настройки» укажите дату в поле «Сдать до».',
  'как работает автопроверка':'Система сравнивает ответ ученика с правильным: точное совпадение, числовое сравнение с допуском, символьное упрощение через Nerdamer.'
};
function supportAnswer(text){
  var t=text.toLowerCase().trim();
  for(var key in SUPPORT_KB){ if(t.indexOf(key)>=0) return SUPPORT_KB[key]; }
  if(/класс/i.test(t)) return SUPPORT_KB['как создать класс'];
  if(/ученик|приглас|join/i.test(t)) return SUPPORT_KB['как пригласить ученика'];
  if(/книг|библиотек|чита|pdf/i.test(t)) return SUPPORT_KB['как добавить книгу'];
  if(/дедлайн|срок/i.test(t)) return SUPPORT_KB['как поставить дедлайн'];
  if(/проверк|оценк|балл/i.test(t)) return SUPPORT_KB['как работает автопроверка'];
  return 'Спасибо! Сообщение получено. Напишите на support@mathtest.app, если срочно.';
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
    if(box&&!box.dataset.init){box.dataset.init='1';supportAddMessage('Здравствуйте! Я помогу с любым вопросом по MathTest.','bot');}
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
      ['Классов', r.classesCount, 'i-book', false],['Учеников', r.studentsCount, 'i-users', false],
      ['Работ', r.testsCount, 'i-edit', false],['Сдач', r.submissionsCount, 'i-chart', false],
      ['Средний', r.avgPercent+'%', 'i-chart', true],['Книг', r.booksCount, 'i-book', false]
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
      [['Создать класс','i-plus',function(){var b=$('#btnNewClass');if(b)b.click();}],
       ['Создать работу','i-edit',function(){var b=$('#btnNewTest');if(b)b.click();}],
       ['Библиотека','i-book',openLibrary],['Дашборд','i-chart',openDashboard]].forEach(function(b){
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
      list.innerHTML='<div class="card"><div class="empty"><div class="icon">📚</div>У вас ещё нет классов.<br>Нажмите <b>«+ Класс»</b>, чтобы начать.</div></div>';
      return;
    }
    r.classes.forEach(function(c){
      var el=document.createElement('div');el.className='class-card';
      el.innerHTML='<div style="flex:1;min-width:200px"><h4>'+esc(c.name)+'</h4>'+
        '<div class="muted" style="margin-top:4px">Учеников: '+c.studentCount+
        ' · Групп: '+(c.groups||[]).length+
        (c.teacherName&&isAdmin()?' · Учитель: '+esc(c.teacherName):'')+'</div></div>'+
        '<div class="code-box" title="Клик — копировать">'+c.code+'</div>';
      var bV=document.createElement('button');bV.className='small';bV.textContent='Открыть';
      bV.onclick=function(){openClassView(c.id);};
      var bD=document.createElement('button');bD.className='ghost small danger';bD.textContent='Удалить';
      bD.onclick=async function(){
        if(!confirm('Удалить класс «'+c.name+'»?'))return;
        try{await api('/classes/'+c.id,{method:'DELETE'});toast('Класс удалён','ok');goTeacher();}
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
      host.innerHTML='<div class="card"><div class="empty"><div class="icon">📝</div>Работ пока нет.<br>Нажмите <b>«+ Работа»</b>.</div></div>';
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
        '<span class="pill blue">'+((test.classIds||[]).length)+' классов</span>'+
        ((test.groupIds||[]).length?'<span class="pill warn">по группам</span>':'')+
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
    if(!(r.class.groups||[]).length) gr.innerHTML='<div class="empty" style="padding:24px">Групп пока нет</div>';
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
        var del=document.createElement('button');del.className='ghost small danger';del.textContent='Удалить группу';del.style.marginTop='12px';
        del.onclick=async function(){if(!confirm('Удалить группу «'+g.name+'»?'))return;try{await api('/classes/'+id+'/groups/'+g.id,{method:'DELETE'});openClassView(id);}catch(e){toast(e.message,'err');}};
        el.appendChild(del);
      }
      gr.appendChild(el);
    });
    var oldB=$('#btnBroadcast');if(oldB)oldB.remove();
    if(isTeacherLike()){
      var bb=document.createElement('button');
      bb.id='btnBroadcast';bb.className='primary small';bb.textContent='Разослать в Telegram';bb.style.marginTop='14px';
      bb.onclick=async function(){
        var msg=prompt('Сообщение всем ученикам класса в Telegram:');
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
    var ts=$('#classTests');ts.innerHTML='';
    if(!r.tests.length)ts.innerHTML='<div class="empty" style="padding:32px">Этому классу ещё не назначено работ.</div>';
    r.tests.forEach(function(t){
      var el=document.createElement('div');el.className='test-card';
      var gi=t.groupIds&&t.groupIds.length?' · группы: '+t.groupIds.map(function(gid){var g=(r.class.groups||[]).find(function(x){return x.id===gid;});return g?esc(g.name):'?';}).join(', '):'';
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
    var name=prompt('Название группы (например: Подгруппа А)');
    if(!name||!name.trim())return;
    try{await api('/classes/'+currentClassId+'/groups',{method:'POST',body:{name:name.trim()}});toast('Группа создана','ok');openClassView(currentClassId);}catch(e){toast(e.message,'err');}
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
    if(!r.classes.length){host.innerHTML='<div class="muted">У вас нет классов.</div>';return;}
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
      var inner='<div style="margin-bottom:10px;font-weight:700;font-size:13.5px">'+esc(c.name)+' → только для групп:</div>';
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
    [['Классов',r.classesCount,'i-book'],['Сдач',r.submissionsCount,'i-edit'],
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
      host.innerHTML='<div class="card" style="grid-column:1/-1"><div class="empty"><div class="icon">📖</div>Доступных работ нет.<br>Присоединитесь к классу во вкладке «Мои классы».</div></div>';
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
    if(!r.classes.length){host.innerHTML='<div class="empty" style="padding:32px">Вы не в классе.</div>';return;}
    r.classes.forEach(function(c){
      var gH=(c.groups||[]).length?' · группы: '+c.groups.map(function(g){return esc(g.name);}).join(', '):'';
      var el=document.createElement('div');el.className='stu-row';
      el.innerHTML='<div class="avatar">'+esc((c.name[0]||'?').toUpperCase())+'</div>'+
        '<div class="name"><div style="font-weight:600">'+esc(c.name)+'</div>'+
        '<div class="muted">Учитель: '+esc(c.teacherName)+gH+'</div></div>';
      var b=document.createElement('button');b.className='ghost small danger';b.textContent='Покинуть';
      b.onclick=async function(){if(!confirm('Покинуть класс?'))return;try{await api('/classes/'+c.id+'/leave',{method:'POST'});toast('Вы покинули класс','info');renderStudentClasses();renderStudentTests();}catch(e){toast(e.message,'err');}};
      el.appendChild(b);host.appendChild(el);
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
    bNext.onclick=function(){if(confirm('Отправить работу учителю?'))submitTest();};
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
      n.textContent='(Ответ скрыт учителем)';line.appendChild(n);
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
    if(!r.groups.length){body.innerHTML='<div class="card"><div class="empty" style="padding:48px">Не назначено ни одному классу.</div></div>';return;}
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
     
