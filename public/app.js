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
var fmtDate=function(t){
  return new Date(t).toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',year:'2-digit',hour:'2-digit',minute:'2-digit'});
};

/* ============ THEME ============ */
var THEME_KEY='mathtest_theme';
function applyTheme(t){
  document.documentElement.setAttribute('data-theme',t);
  var b=$('#btnTheme');if(b)b.textContent=t==='dark'?'🌙':'☀️';
  try{localStorage.setItem(THEME_KEY,t);}catch(e){}
}
(function(){var s='dark';try{s=localStorage.getItem(THEME_KEY)||'dark';}catch(e){}applyTheme(s);})();

/* ============ PALETTE ============ */
var PALETTE_KEY='mathtest_palette';
function applyPalette(p){
  document.documentElement.setAttribute('data-palette',p);
  try{localStorage.setItem(PALETTE_KEY,p);}catch(e){}
}
(function(){var s='blue';try{s=localStorage.getItem(PALETTE_KEY)||'blue';}catch(e){}applyPalette(s);})();

/* ============ PWA ============ */
function registerSW(){
  if(!('serviceWorker' in navigator)) return;
  if(location.protocol !== 'https:' && location.hostname !== 'localhost') return;
  navigator.serviceWorker.register('/sw.js').then(function(reg){
    setInterval(function(){ reg.update(); }, 30*60*1000);
  }).catch(function(e){ console.warn('SW:', e.message); });
}

/* ============ TOASTS ============ */
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

/* ============ API ============ */
var TOKEN_KEY='mathtest_token';
var getToken=function(){return localStorage.getItem(TOKEN_KEY);};
var setToken=function(t){t?localStorage.setItem(TOKEN_KEY,t):localStorage.removeItem(TOKEN_KEY);};

async function api(path,opts){
  opts=opts||{};
  var headers={'Content-Type':'application/json'};
  var tk=getToken();if(tk)headers.Authorization='Bearer '+tk;
  if(opts.headers)Object.assign(headers,opts.headers);
  var r=await fetch('/api'+path,{method:opts.method||'GET',headers:headers,
    body:opts.body?JSON.stringify(opts.body):undefined});
  var data=await r.json().catch(function(){return {};});
  if(!r.ok){var e=new Error(data.error||'Ошибка');e.status=r.status;
    if(r.status===401)setToken(null);throw e;}
  return data;
}
async function apiForm(path,fd,method){
  var tk=getToken();
  var r=await fetch('/api'+path,{method:method||'POST',
    headers:tk?{Authorization:'Bearer '+tk}:{},body:fd});
  var data=await r.json().catch(function(){return {};});
  if(!r.ok){var e=new Error(data.error||'Ошибка');e.status=r.status;throw e;}
  return data;
}

/* ============ HELPERS ============ */
function isTeacherLike(){return currentUser&&(currentUser.role==='teacher'||currentUser.role==='admin');}
function isAdmin(){return currentUser&&currentUser.role==='admin';}
function canUploadBooks(){return currentUser&&['teacher','admin','librarian'].includes(currentUser.role);}
function roleLabel(){
  if(!currentUser)return '';
  return {'admin':'администратор','teacher':'учитель','librarian':'библиотекарь','student':'ученик'}[currentUser.role]||currentUser.role;
}
function avatarUrl(id){return '/api/users/'+id+'/avatar';}
function renderAvatar(el,user,size){
  if(!el)return;
  el.style.width=(size||26)+'px';el.style.height=(size||26)+'px';
  el.style.fontSize=Math.round((size||26)*0.45)+'px';
  if(user&&user.hasAvatar){
    el.style.backgroundImage="url('"+avatarUrl(user.id)+"')";
    el.textContent='';
  } else {
    el.style.backgroundImage='';
    el.textContent=(user&&user.name?user.name[0]:'?').toUpperCase();
  }
}

/* ============ FORMULA INPUTS ============ */
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
  ta.rows=2;ta.spellcheck=false;
  ta.placeholder='Например: sqrt(16), 2^2+3, sin(pi/2)';
  ta.value=initial||'';if(readonly)ta.readOnly=true;
  var prev=document.createElement('div');prev.className='mi-preview';
  wrap.appendChild(ta);wrap.appendChild(prev);
  function render(){
    var tex=textToLatex(ta.value);
    if(window.katex&&tex){try{katex.render(tex,prev,{throwOnError:false});}
      catch(e){prev.textContent=ta.value;}}
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
      var pos=s+before.length+sel.length;
      ta.selectionStart=ta.selectionEnd=pos;ta.focus();render();
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

/* ============ STATE ============ */
var currentUser=null,currentTest=null,answerInputs=[],choicePicks=[];
var editingTestId=null,draftTasks=[],draftClassIds=[],draftGroupIds=[];
var currentClassId=null,currentSubmissionTest=null;
var stmtInput=null,ansInput=null;
var timerInterval=null,testDeadline=null,draftTimer=null;
var notifOpen=false,notifTimer=null;
var bookView='grid';
var chatPollTimer=null,lastChatTime=0;
var lastCsvResult=null;

function show(id){
  $$('.view').forEach(function(v){v.classList.toggle('active',v.id===id);});
  window.scrollTo(0,0);
  if(id!=='view-class'&&chatPollTimer){clearInterval(chatPollTimer);chatPollTimer=null;}
}
function skeleton(host,lines){
  if(!host)return;lines=lines||3;
  var html='<div class="skeleton">';
  for(var i=0;i<lines;i++)html+='<div class="sk-line w'+(60+((i*17)%40))+'"></div>';
  html+='</div>';host.innerHTML=html;
}

/* ============ TOPBAR ============ */
function renderTop(){
  var box=$('#userBox');if(!box)return;
  var bn=$('#btnNotif'),bp=$('#btnProfile'),ba=$('#btnAdmin'),bl=$('#btnLibrary'),bd=$('#btnDashboard');
  if(!currentUser){
    box.innerHTML='';
    [bn,bp,ba,bl,bd].forEach(function(el){ if(el) el.setAttribute('hidden',''); });
    return;
  }
  [bn,bp,bl].forEach(function(el){ if(el) el.removeAttribute('hidden'); });
  if(ba){
    if(isAdmin()) ba.removeAttribute('hidden');
    else ba.setAttribute('hidden','');
  }
  if(bd){
    if(isTeacherLike()) bd.removeAttribute('hidden');
    else bd.setAttribute('hidden','');
  }
  box.innerHTML='<div class="user-chip">'+
    '<div class="avatar" id="topAvatar"></div>'+
    '<div><div style="font-weight:500;font-size:13.5px">'+esc(currentUser.name)+'</div>'+
    '<div class="role" style="font-size:11.5px;margin-top:-2px">'+roleLabel()+'</div></div>'+
    '<button class="logout-btn" id="btnLogout">Выйти</button></div>';
  renderAvatar($('#topAvatar'),currentUser,30);
  $('#btnLogout').onclick=logout;
}
function logout(){
  setToken(null);currentUser=null;
  if(notifTimer){clearInterval(notifTimer);notifTimer=null;}
  if(chatPollTimer){clearInterval(chatPollTimer);chatPollTimer=null;}
  renderTop();show('view-auth');toast('Вы вышли','info');
}

/* ============ NOTIFICATIONS ============ */
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
    if(!r.notifications.length){
      list.innerHTML='<div class="empty" style="padding:30px 20px">Пока нет уведомлений</div>';
      return;
    }
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
          try{var rr=await api('/tests');
            var t=rr.tests.find(function(x){return x.id===n.link.testId;});
            if(t)showSubmissions(t);}catch(e){}
        } else if(n.type==='new_test'&&currentUser.role==='student'){
          goStudent();
        } else if(n.type==='new_book'){ openLibrary(); }
        refreshNotifBadge();
      };
      list.appendChild(el);
    });
  }catch(e){list.innerHTML='<div class="err" style="padding:16px">'+esc(e.message)+'</div>';}
}

/* ============ PROFILE MODAL ============ */
function openPalettePicker(){
  if(!currentUser){toast('Сначала войдите','warn');return;}
  var pm=$('#profileModal');if(!pm)return;
  pm.hidden=false;
  renderAvatar($('#profAvatar'),currentUser,48);
  $('#profName').textContent=currentUser.name;
  $('#profRole').textContent=roleLabel();

  var oldCab=document.getElementById('btnGoCabinet');
  if(oldCab)oldCab.remove();
  var cab=document.createElement('button');
  cab.id='btnGoCabinet';cab.className='primary';
  cab.style.cssText='width:100%;margin-top:12px';
  cab.textContent='📊 Открыть личный кабинет';
  cab.onclick=function(){$('#profileModal').hidden=true;openProfileStats();};
  var pb=$('#profileBody');
  var firstSec=pb.querySelector('h4.sec');
  if(firstSec)pb.insertBefore(cab,firstSec);

  var curTheme=document.documentElement.getAttribute('data-theme');
  $$('.theme-option').forEach(function(b){
    b.classList.toggle('active',b.dataset.themeSet===curTheme);
  });

  if(!document.getElementById('paletteBlock')){
    var cur=document.documentElement.getAttribute('data-palette')||'blue';
    var block=document.createElement('div');
    block.id='paletteBlock';
    block.innerHTML='<h4 class="sec">Цветовая схема</h4>'+
      '<div class="palette-picker">'+
        '<div class="palette-option'+(cur==='blue'?' active':'')+'" data-pal="blue" title="Синий"></div>'+
        '<div class="palette-option'+(cur==='green'?' active':'')+'" data-pal="green" title="Зелёный"></div>'+
        '<div class="palette-option'+(cur==='purple'?' active':'')+'" data-pal="purple" title="Фиолетовый"></div>'+
        '<div class="palette-option'+(cur==='orange'?' active':'')+'" data-pal="orange" title="Оранжевый"></div>'+
      '</div>';
    block.querySelectorAll('.palette-option').forEach(function(el){
      el.onclick=function(){
        applyPalette(el.dataset.pal);
        block.querySelectorAll('.palette-option').forEach(function(x){x.classList.remove('active');});
        el.classList.add('active');toast('Цвет изменён','ok');
      };
    });
    pb.appendChild(block);
  }

  $('#tgStatus').textContent='Проверка…';
  $('#tgActions').innerHTML='';
  api('/telegram/link').then(function(r){
    if(r.linked){
      $('#tgStatus').innerHTML='<span style="color:var(--ok);font-weight:600">✅ Подключён</span>';
      var unlink=document.createElement('button');
      unlink.className='ghost small danger';unlink.textContent='Отключить Telegram';
      unlink.onclick=async function(){
        try{await api('/telegram/unlink',{method:'POST'});toast('Отключено','info');openPalettePicker();}
        catch(e){toast(e.message,'err');}
      };
      $('#tgActions').appendChild(unlink);
    }else{
      $('#tgStatus').innerHTML='<span style="color:var(--muted)">Не подключён</span>';
      var a=document.createElement('a');
      a.className='tg-link';a.href=r.link;a.target='_blank';
      a.innerHTML='✈️ Подключить Telegram';
      $('#tgActions').appendChild(a);
    }
  }).catch(function(e){
    $('#tgStatus').innerHTML='<span style="color:var(--muted)">'+esc(e.message)+'</span>';
  });
}
async function openProfile(){ openPalettePicker(); }

/* ============ GOOGLE + TELEGRAM LOGIN ============ */
var GOOGLE_CLIENT_ID='279103327474-sp6osb2jhb92puqqvh9fmdkiv73prgk7.apps.googleusercontent.com';
function initGoogleLogin(){
  if(!GOOGLE_CLIENT_ID||window.__googleReady)return;
  window.__googleReady=true;
  window.handleGoogleLogin=async function(response){
    var errEl=$('#googleLoginErr');if(errEl)errEl.textContent='';
    try{
      var r=await api('/auth/google',{method:'POST',body:{credential:response.credential}});
      setToken(r.token);enterApp(r.user);toast('Вы вошли через Google','ok');
    }catch(e){if(errEl)errEl.textContent=e.message;toast(e.message,'err');}
  };
  function tryRender(){
    if(!window.google||!window.google.accounts||!window.google.accounts.id){setTimeout(tryRender,200);return;}
    google.accounts.id.initialize({client_id:GOOGLE_CLIENT_ID,callback:window.handleGoogleLogin});
    var box=document.getElementById('googleBtnBox');if(!box)return;
    box.innerHTML='';
    google.accounts.id.renderButton(box,{type:'standard',theme:'outline',size:'large',text:'signin_with',shape:'rectangular',logo_alignment:'left',width:240});
  }
  if(!document.getElementById('gsi-script')){
    var s=document.createElement('script');s.id='gsi-script';
    s.src='https://accounts.google.com/gsi/client';s.async=true;s.defer=true;
    s.onload=tryRender;document.head.appendChild(s);
  } else tryRender();
}
function initTelegramLogin(){
  var wrap=document.getElementById('tgLoginWrap');
  if(!wrap||!window.TELEGRAM_BOT_USERNAME||wrap.dataset.ready)return;
  wrap.dataset.ready='1';
  window.onTelegramAuth=async function(user){
    var errEl=$('#tgLoginErr');if(errEl)errEl.textContent='';
    try{
      var r=await api('/auth/telegram',{method:'POST',body:user});
      setToken(r.token);enterApp(r.user);toast('Вы вошли через Telegram','ok');
    }catch(e){if(errEl)errEl.textContent=e.message;toast(e.message,'err');}
  };
  var script=document.createElement('script');script.async=true;
  script.src='https://telegram.org/js/telegram-widget.js?22';
  script.setAttribute('data-telegram-login',window.TELEGRAM_BOT_USERNAME);
  script.setAttribute('data-size','large');
  script.setAttribute('data-radius','10');
  script.setAttribute('data-userpic','false');
  script.setAttribute('data-color','white');
  script.setAttribute('data-onauth','onTelegramAuth(user)');
  script.setAttribute('data-request-access','write');
  wrap.appendChild(script);
}

/* ============ TEACHER ============ */
async function goTeacher(){
  show('view-teacher');
  await Promise.all([renderTeacherClasses(),renderTeacherTests()]);
}
async function renderTeacherClasses(){
  var list=$('#classList');if(!list)return;
  skeleton(list,2);
  try{
    var r=await api('/classes');
    list.innerHTML='';
    if(!r.classes.length){
      list.innerHTML='<div class="card"><div class="empty"><span class="icon">📚</span>У вас ещё нет классов.<br>Нажмите <b>«+ Класс»</b>.</div></div>';
      return;
    }
    r.classes.forEach(function(c){
      var el=document.createElement('div');el.className='class-card';
      el.innerHTML='<div style="flex:1;min-width:180px"><h4>'+esc(c.name)+'</h4>'+
        '<div class="muted" style="margin-top:2px">Учеников: '+c.studentCount+
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
        try{navigator.clipboard.writeText(c.code);
          var old=cb.textContent;cb.textContent='✓ Скопировано';
          toast('Код скопирован','ok');
          setTimeout(function(){cb.textContent=old;},900);
        }catch(e){}
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
      host.innerHTML='<div class="card"><div class="empty"><span class="icon">📝</span>Работ пока нет.<br>Нажмите <b>«+ Работа»</b>.</div></div>';
      return;
    }
    r.tests.forEach(function(test){
      var max=test.tasks.reduce(function(s,t){return s+(t.points||1);},0);
      var s=test.settings||{};
      var el=document.createElement('div');el.className='test-card';
      el.innerHTML='<div class="row tight"><h4 style="flex:1;margin:0">'+esc(test.title)+'</h4>'+
        (test.unseen?'<span class="badge red" title="Новые сдачи">'+test.unseen+' новых</span>':'')+'</div>'+
        '<div class="meta">'+
          '<span class="pill">'+test.tasks.length+' заданий</span>'+
          '<span class="pill">'+max+' баллов</span>'+
          '<span class="pill blue">'+((test.classIds||[]).length)+' классов</span>'+
          ((test.groupIds||[]).length?'<span class="pill warn">по группам</span>':'')+
          (s.timeLimit>0?'<span class="pill warn">⏱ '+s.timeLimit+' мин</span>':'')+
          (s.attempts>1?'<span class="pill">🎯 '+s.attempts+' попыток</span>':'')+
        '</div>';
      var actions=document.createElement('div');actions.className='actions';
      var bE=document.createElement('button');bE.className='small';bE.textContent='Редактировать';
      bE.onclick=async function(){
        try{var rr=await api('/tests');
          var full=rr.tests.find(function(x){return x.id===test.id;});
          openEditor(full);}catch(e){toast(e.message,'err');}
      };
      var bR=document.createElement('button');bR.className='primary small';bR.textContent='Результаты';
      bR.onclick=function(){showSubmissions(test);};
      var bC=document.createElement('button');bC.className='ghost small';bC.textContent='Дублировать';
      bC.onclick=async function(){
        try{await api('/tests/'+test.id+'/duplicate',{method:'POST'});
          toast('Копия создана','ok');goTeacher();}
        catch(e){toast(e.message,'err');}
      };
      var bD=document.createElement('button');bD.className='ghost small danger';bD.textContent='Удалить';
      bD.onclick=async function(){
        if(!confirm('Удалить работу «'+test.title+'»?'))return;
        try{await api('/tests/'+test.id,{method:'DELETE'});
          toast('Работа удалена','ok');goTeacher();}
        catch(e){toast(e.message,'err');}
      };
      actions.appendChild(bE);actions.appendChild(bR);actions.appendChild(bC);actions.appendChild(bD);
      el.appendChild(actions);host.appendChild(el);
    });
  }catch(e){host.innerHTML='<div class="card err">'+esc(e.message)+'</div>';}
}

/* ============ CLASS VIEW ============ */
async function openClassView(id){
  currentClassId=id;show('view-class');
  skeleton($('#classStudents'),2);skeleton($('#classGroups'),2);skeleton($('#classTests'),2);
  var cb=$('#chatBox');if(cb)cb.style.display='none';
  $('#csvResultBox').hidden=true;
  var bic=$('#btnImportCsv');if(bic) bic.hidden=!isTeacherLike();
  try{
    var r=await api('/classes/'+id);
    $('#classTitle').textContent='Класс: '+r.class.name;
    $('#classCodeBig').textContent=r.class.code;
    $('#classCodeBig').onclick=function(){
      try{navigator.clipboard.writeText(r.class.code);
        var old=$('#classCodeBig').textContent;
        $('#classCodeBig').textContent='✓ Скопировано';
        toast('Код скопирован','ok');
        setTimeout(function(){$('#classCodeBig').textContent=old;},900);
      }catch(e){}
    };
    var bci=$('#btnCopyInvite');if(bci)bci.onclick=function(){
      var url=location.origin+location.pathname+'?join='+r.class.code;
      try{navigator.clipboard.writeText(url);toast('Ссылка скопирована','ok');}
      catch(e){toast('Не удалось','err');}
    };

    var stu=$('#classStudents');stu.innerHTML='';
    $('#classStuCount').textContent=r.students.length;
    if(!r.students.length){
      stu.innerHTML='<div class="empty"><span class="icon">👥</span>Пока нет учеников.<br>Код: <b>'+esc(r.class.code)+'</b></div>';
    }
    r.students.forEach(function(u){
      var el=document.createElement('div');el.className='stu-row';
      var groupsHtml=(u.groupIds||[]).map(function(gid){
        var g=(r.class.groups||[]).find(function(x){return x.id===gid;});
        return g?'<span class="pill blue">'+esc(g.name)+'</span>':'';
      }).join('');
      var tg=u.hasTelegram?' <span class="pill green" title="Telegram">✈️</span>':'';
      el.innerHTML='<div class="avatar"></div>'+
        '<div class="name"><div>'+esc(u.name)+' '+groupsHtml+tg+'</div>'+
        '<div class="muted">'+esc(u.email)+'</div></div>';
      renderAvatar(el.querySelector('.avatar'),u,32);
      var b=document.createElement('button');b.className='ghost small danger';b.textContent='Исключить';
      b.onclick=async function(){
        if(!confirm('Исключить '+u.name+'?'))return;
        try{await api('/classes/'+id+'/students/'+u.id,{method:'DELETE'});
          openClassView(id);}catch(e){toast(e.message,'err');}
      };
      if(isTeacherLike())el.appendChild(b);
      stu.appendChild(el);
    });

    var gr=$('#classGroups');gr.innerHTML='';
    if(!(r.class.groups||[]).length){
      gr.innerHTML='<div class="empty" style="padding:16px">Групп пока нет</div>';
    }
    (r.class.groups||[]).forEach(function(g){
      var el=document.createElement('div');el.className='group-card';
      el.innerHTML='<div class="gc-head"><h5>'+esc(g.name)+'</h5>'+
        '<span class="pill">'+(g.studentIds||[]).length+'</span></div>';
      var chips=document.createElement('div');chips.className='gc-students';
      (g.studentIds||[]).forEach(function(sid){
        var u=r.students.find(function(x){return x.id===sid;});
        if(!u)return;
        var chip=document.createElement('span');chip.className='group-chip';
        chip.innerHTML=esc(u.name)+' <button title="Убрать">✕</button>';
        chip.querySelector('button').onclick=async function(){
          try{await api('/classes/'+id+'/groups/'+g.id+'/students/'+sid,{method:'DELETE'});
            openClassView(id);}catch(e){toast(e.message,'err');}
        };
        chips.appendChild(chip);
      });
      if(isTeacherLike()){
        var notIn=r.students.filter(function(u){return !(g.studentIds||[]).includes(u.id);});
        if(notIn.length){
          var sel=document.createElement('select');
          sel.style.cssText='width:auto;padding:4px 8px';
          sel.innerHTML='<option value="">+ добавить...</option>'+
            notIn.map(function(u){return '<option value="'+u.id+'">'+esc(u.name)+'</option>';}).join('');
          sel.onchange=async function(){
            if(!sel.value)return;
            try{await api('/classes/'+id+'/groups/'+g.id+'/students/'+sel.value,{method:'POST'});
              openClassView(id);}catch(e){toast(e.message,'err');}
          };
          chips.appendChild(sel);
        }
      }
      el.appendChild(chips);
      if(isTeacherLike()){
        var del=document.createElement('button');del.className='ghost small danger';
        del.textContent='Удалить группу';del.style.marginTop='8px';
        del.onclick=async function(){
          if(!confirm('Удалить группу «'+g.name+'»?'))return;
          try{await api('/classes/'+id+'/groups/'+g.id,{method:'DELETE'});
            openClassView(id);}catch(e){toast(e.message,'err');}
        };
        el.appendChild(del);
      }
      gr.appendChild(el);
    });

    var oldB=$('#btnBroadcast');if(oldB)oldB.remove();
    if(isTeacherLike()){
      var bb=document.createElement('button');
      bb.id='btnBroadcast';bb.className='primary small';
      bb.textContent='✈️ Разослать в Telegram';
      bb.style.marginTop='10px';
      bb.onclick=async function(){
        var msg=prompt('Сообщение всем ученикам класса в Telegram:');
        if(!msg||!msg.trim())return;
        try{
          var res=await api('/classes/'+id+'/broadcast',{method:'POST',body:{message:msg.trim()}});
          var text='Отправлено: '+res.sent;
          if(res.failed)text+=' · ошибок: '+res.failed;
          if(res.withoutTelegram)text+=' · без Telegram: '+res.withoutTelegram;
          toast(text,'ok');
        }catch(e){toast(e.message,'err');}
      };
      var tgCard=$('#classGroups').parentNode;
      tgCard.appendChild(bb);
    }

    var ts=$('#classTests');ts.innerHTML='';
    if(!r.tests.length)ts.innerHTML='<div class="empty">Этому классу ещё не назначено работ.</div>';
    r.tests.forEach(function(t){
      var el=document.createElement('div');el.className='test-card';
      var gi=t.groupIds&&t.groupIds.length?' · группы: '+t.groupIds.map(function(gid){
        var g=(r.class.groups||[]).find(function(x){return x.id===gid;});return g?esc(g.name):'?';
      }).join(', '):'';
      el.innerHTML='<div class="row tight"><h4 style="flex:1;margin:0">'+esc(t.title)+'</h4>'+
        (t.unseen?'<span class="badge red">'+t.unseen+'</span>':'')+'</div>'+
        '<div class="meta">Сдали: '+t.submitted+' из '+t.total+gi+'</div>';
      var b=document.createElement('button');b.className='primary small';b.textContent='Открыть';
      b.onclick=async function(){
        try{var rr=await api('/tests');
          var full=rr.tests.find(function(x){return x.id===t.id;});
          if(full)showSubmissions(full);}catch(e){toast(e.message,'err');}
      };
      el.appendChild(b);ts.appendChild(el);
    });

    if(cb){
      cb.style.display='';
      lastChatTime=0;
      await loadChatMessages(id, true);
      if(chatPollTimer)clearInterval(chatPollTimer);
      chatPollTimer=setInterval(function(){loadChatMessages(id,false);},4000);
    }
  }catch(e){toast(e.message,'err');}
}

/* ============ CHAT ============ */
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
          (m.hasFile?'<div class="chat-msg-file" onclick="downloadChatFile(\''+m.id+'\')">'+
            '📎 '+esc(m.fileName||'файл')+' · '+fmtSize(m.fileSize)+'</div>':'')+
          (m.own?'<button class="chat-msg-del" title="Удалить" data-del="'+m.id+'">✕</button>':'')+
        '</div>';
      renderAvatar(el.querySelector('.avatar'),{id:m.userId,name:m.userName,hasAvatar:m.hasAvatar},32);
      if(m.own){
        var db=el.querySelector('[data-del]');
        if(db)db.onclick=async function(){
          if(!confirm('Удалить сообщение?'))return;
          try{await api('/messages/'+m.id,{method:'DELETE'});
            el.remove();}catch(e){toast(e.message,'err');}
        };
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
  var fileInput=$('#chatFileInput');
  var file=fileInput.files[0];
  if(!text&&!file)return;
  var fd=new FormData();
  if(text)fd.append('text',text);
  if(file)fd.append('file',file);
  try{
    await apiForm('/classes/'+currentClassId+'/messages',fd);
    $('#chatText').value='';fileInput.value='';$('#chatFileName').textContent='';
    await loadChatMessages(currentClassId,false);
  }catch(e){toast(e.message,'err');}
}

/* ============ CSV IMPORT ============ */
function openCsvPicker(){
  if(!currentClassId)return;
  $('#csvFileInput').click();
}
async function uploadCsv(file){
  if(!file||!currentClassId)return;
  var fd=new FormData();fd.append('file',file);
  try{
    toast('Импорт...','info');
    var r=await apiForm('/classes/'+currentClassId+'/import-csv',fd);
    lastCsvResult=r;
    showCsvResult(r);
    openClassView(currentClassId);
  }catch(e){toast(e.message,'err');}
}
function showCsvResult(r){
  var box=$('#csvResultBox');if(!box)return;
  box.hidden=false;
  var host=$('#csvResult');host.innerHTML='';
  var block=document.createElement('div');block.className='csv-result-block';
  block.innerHTML='<h4>✅ Добавлено новых учеников: '+r.added.length+'</h4>';
  if(r.added.length){
    r.added.forEach(function(u){
      var el=document.createElement('div');el.className='stu-row';
      el.innerHTML='<div class="avatar">'+esc((u.name[0]||'?').toUpperCase())+'</div>'+
        '<div class="name"><div>'+esc(u.name)+'</div>'+
        '<div class="muted">'+esc(u.email)+'</div></div>'+
        '<div class="pill green" style="font-family:monospace">'+esc(u.password||'')+'</div>';
      block.appendChild(el);
    });
  }
  host.appendChild(block);

  if(r.existing.length){
    var b2=document.createElement('div');b2.className='csv-result-block';
    b2.innerHTML='<h4>👤 Уже существовали: '+r.existing.length+'</h4>';
    r.existing.slice(0,20).forEach(function(u){
      var el=document.createElement('div');el.className='stu-row';el.style.opacity='.7';
      el.innerHTML='<div class="avatar" style="background:#3a465c">'+esc((u.name[0]||'?').toUpperCase())+'</div>'+
        '<div class="name"><div>'+esc(u.name)+'</div><div class="muted">'+esc(u.email)+'</div></div>'+
        (u.note?'<span class="pill">'+esc(u.note)+'</span>':'');
      b2.appendChild(el);
    });
    host.appendChild(b2);
  }

  if(r.failed.length){
    var b3=document.createElement('div');b3.className='csv-result-block';
    b3.innerHTML='<h4>⚠️ Ошибок: '+r.failed.length+'</h4>';
    r.failed.forEach(function(f){
      var el=document.createElement('div');el.className='stu-row';el.style.opacity='.7';
      el.innerHTML='<div class="muted">'+esc(f.line)+'</div>'+
        '<span class="pill red">'+esc(f.reason)+'</span>';
      b3.appendChild(el);
    });
    host.appendChild(b3);
  }
}
function downloadPasswords(){
  if(!lastCsvResult||!lastCsvResult.added||!lastCsvResult.added.length){
    toast('Нет новых паролей','warn');return;
  }
  var rows=[['Имя','Email','Пароль']];
  lastCsvResult.added.forEach(function(u){
    rows.push([u.name,u.email,u.password]);
  });
  var csv=rows.map(function(r){return r.map(function(v){
    v=String(v==null?'':v);
    if(v.includes(',')||v.includes('"'))return '"'+v.replace(/"/g,'""')+'"';
    return v;
  }).join(',');}).join('\r\n');
  var blob=new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8'});
  var a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='passwords.csv';
  document.body.appendChild(a);a.click();a.remove();
}

/* ============ EDITOR ============ */
function initEditorFields(){
  if(stmtInput)return;
  var sh=$('#statementHost'),ah=$('#answerHost');if(!sh||!ah)return;
  stmtInput=createMathInput('',false);
  ansInput=createMathInput('',false);
  sh.appendChild(stmtInput.el);ah.appendChild(ansInput.el);
  buildSymbolBar($('#symbolBar'));
  addOption();addOption();
  var tt=$('#taskType');
  if(tt)tt.onchange=function(){
    var i=tt.value==='input';
    $('#inputBlock').hidden=!i;$('#choiceBlock').hidden=i;
  };
  var bao=$('#btnAddOption');if(bao)bao.onclick=function(){addOption();};
  var bat=$('#btnAddTask');if(bat)bat.onclick=addTask;
  var bst=$('#btnSaveTest');if(bst)bst.onclick=saveTest;
  var bng=$('#btnNewGroup');if(bng)bng.onclick=async function(){
    var name=prompt('Название группы (например: Подгруппа А)');
    if(!name||!name.trim())return;
    try{await api('/classes/'+currentClassId+'/groups',{method:'POST',body:{name:name.trim()}});
      toast('Группа создана','ok');openClassView(currentClassId);}
    catch(e){toast(e.message,'err');}
  };
  var bjc=$('#btnJoinClass');if(bjc)bjc.onclick=joinClass;
  var bst2=$('#btnSubmitTest');if(bst2)bst2.onclick=function(){
    if(!confirm('Завершить работу?'))return;submitTest();
  };
  var bec=$('#btnExportCsv');if(bec)bec.onclick=exportCsv;
  var bsa=$('#btnShowAnalytics');if(bsa)bsa.onclick=showAnalytics;
  var bra=$('#btnReadAll');if(bra)bra.onclick=async function(){
    try{await api('/notifications/read-all',{method:'POST'});
      loadNotifications();refreshNotifBadge();toast('Все прочитаны','ok');}
    catch(e){toast(e.message,'err');}
  };
  var bic=$('#btnImportCsv');if(bic)bic.onclick=openCsvPicker;
  var cfi=$('#csvFileInput');if(cfi)cfi.onchange=function(){if(this.files[0])uploadCsv(this.files[0]);};
  var bdp=$('#btnDownloadPasswords');if(bdp)bdp.onclick=downloadPasswords;
  var bcc=$('#btnCloseCsvResult');if(bcc)bcc.onclick=function(){$('#csvResultBox').hidden=true;};
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
      block.style.cssText='flex-direction:column;align-items:stretch;background:rgba(91,141,255,.05)';
      var inner='<div style="margin-bottom:8px;font-weight:600;font-size:13px">'+esc(c.name)+' → только для групп:</div>';
      c.groups.forEach(function(g){
        var checked=draftGroupIds.indexOf(g.id)>=0?'checked':'';
        inner+='<label style="display:flex;align-items:center;gap:8px;padding:5px 0;margin:0;color:var(--text);font-size:13px">'+
          '<input type="checkbox" data-gid="'+g.id+'" '+checked+
          ' style="width:16px;height:16px;margin:0;accent-color:var(--accent)">'+
          '<span>'+esc(g.name)+' <span class="muted">('+g.count+')</span></span></label>';
      });
      inner+='<div class="muted" style="margin-top:4px;font-size:11.5px">Пусто — работа видна всем</div>';
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
  if(!draftTasks.length){host.innerHTML='<div class="empty">Заданий нет.</div>';return;}
  draftTasks.forEach(function(t,i){
    var d=document.createElement('div');
    d.style.cssText='background:var(--bg-soft);border:1px solid var(--line-soft);border-radius:10px;padding:12px;margin-bottom:8px';
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
  try{
    if(editingTestId){
      await api('/tests/'+editingTestId,{method:'PUT',body:{title:title,tasks:draftTasks,classIds:draftClassIds,groupIds:draftGroupIds,settings:settings}});
      toast('Работа обновлена','ok');
    }else{
      await api('/tests',{method:'POST',body:{title:title,tasks:draftTasks,classIds:draftClassIds,groupIds:draftGroupIds,settings:settings}});
      toast('Работа создана','ok');
    }
    goTeacher();
  }catch(e){toast(e.message,'err');}
}

/* ============ STUDENT ============ */
async function goStudent(){
  show('view-student');
  await Promise.all([renderStudentTests(),renderStudentClasses()]);
}
async function renderStudentTests(){
  var host=$('#studentList');if(!host)return;
  skeleton(host,3);
  try{
    var r=await api('/tests');
    host.innerHTML='';
    if(!r.tests.length){
      host.innerHTML='<div class="card" style="grid-column:1/-1"><div class="empty"><span class="icon">📖</span>Доступных работ нет.<br>Присоединитесь к классу.</div></div>';
      return;
    }
    r.tests.forEach(function(test){
      var max=test.tasks.reduce(function(s,t){return s+(t.points||1);},0);
      var s=test.settings||{};
      var used=test.attemptsUsed||0;
      var can=!(s.attempts>0&&used>=s.attempts);
      var draft=loadDraft(test.id);
      var card=document.createElement('div');card.className='card';card.style.marginBottom='0';
      card.innerHTML='<h3 style="margin-bottom:8px">'+esc(test.title)+'</h3>'+
        '<div style="margin-bottom:12px">'+
          '<span class="pill">'+test.tasks.length+' заданий</span> '+
          '<span class="pill">макс. '+max+' б.</span>'+
          (s.timeLimit>0?' <span class="pill warn">⏱ '+s.timeLimit+' мин</span>':'')+
          (s.attempts>0?' <span class="pill">попыток: '+used+' / '+s.attempts+'</span>':'')+
          (draft?' <span class="pill green">💾 черновик</span>':'')+
        '</div>'+
        (test.mySubmission?'<div class="ok" style="margin-bottom:12px;font-weight:500">'+
          'Последний: '+test.mySubmission.score+' / '+test.mySubmission.max+
          ' <span class="muted">· '+fmt(test.mySubmission.at)+'</span></div>':'');
      var b=document.createElement('button');b.className='primary';b.style.width='100%';
      if(!can){b.disabled=true;b.textContent='Попытки исчерпаны';}
      else{b.textContent=test.mySubmission?'Пройти заново':'Начать →';b.onclick=function(){openTest(test);};}
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
    if(!r.classes.length){host.innerHTML='<div class="empty">Вы не в классе.</div>';return;}
    r.classes.forEach(function(c){
      var gH=(c.groups||[]).length?' · группы: '+c.groups.map(function(g){return esc(g.name);}).join(', '):'';
      var el=document.createElement('div');el.className='stu-row';
      el.innerHTML='<div class="avatar">'+esc((c.name[0]||'?').toUpperCase())+'</div>'+
        '<div class="name"><div>'+esc(c.name)+'</div>'+
        '<div class="muted">Учитель: '+esc(c.teacherName)+gH+'</div></div>';
      var b=document.createElement('button');b.className='ghost small danger';b.textContent='Покинуть';
      b.onclick=async function(){
        if(!confirm('Покинуть класс?'))return;
        try{await api('/classes/'+c.id+'/leave',{method:'POST'});
          toast('Вы покинули класс','info');
          renderStudentClasses();renderStudentTests();}
        catch(e){toast(e.message,'err');}
      };
      el.appendChild(b);host.appendChild(el);
    });
  }catch(e){host.innerHTML='<div class="err">'+esc(e.message)+'</div>';}
}
async function joinClass(){
  var je=$('#joinErr');if(je)je.textContent='';
  var c=$('#joinCode').value.trim().toUpperCase();
  if(!c){if(je)je.textContent='Введите код';return;}
  try{
    await api('/classes/join',{method:'POST',body:{code:c}});
    $('#joinCode').value='';toast('Вы присоединились','ok');
    renderStudentClasses();renderStudentTests();
  }catch(e){if(je)je.textContent=e.message;toast(e.message,'err');}
}

/* ============ DRAFTS ============ */
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

/* ============ TEST TAKING ============ */
function updateProgress(){
  if(!currentTest)return;
  var total=currentTest.tasks.length,done=0;
  currentTest.tasks.forEach(function(t,i){
    if(t.type==='input'){var mi=answerInputs[i];if(mi&&mi.getValue().trim())done++;}
    else{if(choicePicks[i]!==undefined)done++;}
  });
  var pct=total?Math.round(done/total*100):0;
  var pf=$('#progressFill');if(pf)pf.style.width=pct+'%';
  var pt=$('#progressText');if(pt)pt.textContent='Заполнено: '+done+' из '+total;
  var pp=$('#progressPct');if(pp)pp.textContent=pct+'%';
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
  if(left<=0){
    clearInterval(timerInterval);timerInterval=null;
    toast('Время вышло','warn');
    setTimeout(function(){submitTest();},500);
  }
}
function openTest(test){
  currentTest=test;answerInputs=[];choicePicks=[];
  $('#takeTitle').textContent=test.title;
  var host=$('#takeBody');host.innerHTML='';
  var pb=$('#progressBar');if(pb)pb.hidden=false;
  var draft=loadDraft(test.id);
  var dh=$('#draftHint');
  if(draft){if(dh){dh.hidden=false;dh.textContent='💾 Черновик от '+fmt(draft.at);}}
  else{if(dh)dh.hidden=true;}
  test.tasks.forEach(function(task,i){
    var card=document.createElement('div');card.className='card';
    var h=document.createElement('div');h.className='task-head';
    h.innerHTML='<span class="badge">'+(i+1)+'</span><span class="pill">'+(task.points||1)+' б.</span>';
    card.appendChild(h);
    var s=createMathInput(task.statement,true);card.appendChild(s.el);
    if(task.type==='input'){
      var initial=draft&&draft.answers&&typeof draft.answers[i]==='string'?draft.answers[i]:'';
      var mi=createMathInput(initial,false,function(){updateProgress();scheduleDraftSave();});
      card.appendChild(mi.el);answerInputs[i]=mi;
    }else{
      var w=document.createElement('div');w.style.marginTop='6px';
      var picked=draft&&draft.answers&&draft.answers[i];
      if(picked!==null&&picked!==undefined)choicePicks[i]=picked;
      task.options.forEach(function(opt,j){
        var lab=document.createElement('label');
        lab.style.cssText='display:flex;align-items:center;gap:10px;background:var(--bg-soft);border:1px solid var(--line-soft);border-radius:10px;padding:10px 14px;margin:6px 0;cursor:pointer;transition:.15s';
        lab.addEventListener('mouseenter',function(){lab.style.borderColor='var(--accent)';});
        lab.addEventListener('mouseleave',function(){lab.style.borderColor='';});
        var rd=document.createElement('input');rd.type='radio';rd.name='q'+i;
        rd.checked=(picked===j);
        rd.onchange=function(){choicePicks[i]=j;updateProgress();scheduleDraftSave();};
        var ob=createMathInput(opt.text,true);ob.el.style.flex='1';ob.el.style.margin='0';
        lab.appendChild(rd);lab.appendChild(ob.el);w.appendChild(lab);
      });
      card.appendChild(w);
    }
    host.appendChild(card);
  });
  updateProgress();
  var timer=$('#timerDisplay');
  if(test.settings&&test.settings.timeLimit>0){
    var key='test_start_'+test.id;
    var started=parseInt(sessionStorage.getItem(key));
    if(!started||isNaN(started)){started=Date.now();sessionStorage.setItem(key,started);}
    testDeadline=started+test.settings.timeLimit*60000;
    if(timer)timer.hidden=false;
    if(timerInterval)clearInterval(timerInterval);
    updateTimer();timerInterval=setInterval(updateTimer,1000);
  }else{
    if(timer)timer.hidden=true;testDeadline=null;
    if(timerInterval){clearInterval(timerInterval);timerInterval=null;}
  }
  show('view-take');setTimeout(updateProgress,100);
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
    clearDraft(currentTest.id);sessionStorage.removeItem('test_start_'+currentTest.id);
    $('#progressBar').hidden=true;$('#draftHint').hidden=true;
    if(r.expired)toast('Работа сдана с опозданием','warn');
    showResult(currentTest,r);
  }catch(e){toast(e.message,'err');}
}

/* ============ RESULT ============ */
function showResult(test,r){
  var card=$('#resultCard');
  var score=r.score,max=r.max;
  var pct=max?Math.round(score/max*100):0;
  var gc=pct>=80?'':(pct>=60?'mid':'bad');
  var gt=pct>=80?'Отличный результат!':(pct>=60?'Хороший результат':'Стоит повторить');
  card.innerHTML='<h2 style="margin-bottom:20px">'+esc(test.title)+'</h2>'+
    '<div style="display:flex;align-items:center;gap:24px;flex-wrap:wrap;margin-bottom:20px">'+
      '<div class="score-circle" data-grade="'+gc+'" style="--pct:'+pct+'">'+
        '<div class="val">'+score+' / '+max+'</div><div class="lbl">'+pct+'%</div></div>'+
      '<div style="flex:1;min-width:200px">'+
        '<div style="font-size:18px;font-weight:600;margin-bottom:6px">'+gt+'</div>'+
        '<div class="muted">'+(r.durationMs?'Время: '+fmtDur(r.durationMs)+'<br>':'')+
          (r.attempt?'Попытка №'+r.attempt:'')+'</div></div>'+
    '</div>';
  test.tasks.forEach(function(task,i){
    var res=r.results[i]||{ok:false};
    var line=document.createElement('div');line.className='result-line '+(res.ok?'ok':'err');
    var s=createMathInput(task.statement,true);s.el.style.marginBottom='6px';line.appendChild(s.el);
    var info=document.createElement('div');info.style.fontSize='13.5px';
    info.innerHTML=res.ok
      ?'<span class="ok" style="font-weight:600">✓ Верно</span> <span class="muted">· '+(task.points||1)+' б.</span>'
      :'<span class="err" style="font-weight:600">✗ Неверно</span> <span class="muted">· 0 из '+(task.points||1)+' б.</span>';
    line.appendChild(info);
    if(!res.ok&&res.correctAnswer){
      var a=document.createElement('div');a.style.marginTop='10px';
      a.innerHTML='<div class="muted" style="margin-bottom:4px">Правильный ответ:</div>';
      var mf=createMathInput(res.correctAnswer,true);a.appendChild(mf.el);line.appendChild(a);
    }
    if(!res.ok&&!res.correctAnswer&&r.settings&&!r.settings.showAnswers){
      var n=document.createElement('div');n.className='muted';n.style.marginTop='6px';
      n.textContent='(Ответ скрыт учителем)';line.appendChild(n);
    }
    if(task.type==='choice'&&res.correctIndex!==undefined){
      var a2=document.createElement('div');a2.style.marginTop='10px';
      a2.innerHTML='<div class="muted" style="margin-bottom:4px">Правильный вариант:</div>';
      var mf2=createMathInput(task.options[res.correctIndex].text,true);a2.appendChild(mf2.el);line.appendChild(a2);
    }
    card.appendChild(line);
  });
  show('view-result');
}

/* ============ TEACHER SUBMISSIONS ============ */
async function showSubmissions(test){
  currentSubmissionTest=test;
  $('#subsTitle').textContent='Результаты: '+test.title;
  var body=$('#subsBody');skeleton(body,4);show('view-submissions');
  try{
    var r=await api('/tests/'+test.id+'/submissions');
    body.innerHTML='';
    if(!r.groups.length){body.innerHTML='<div class="card"><div class="empty">Не назначено ни одному классу.</div></div>';return;}
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
            '<div class="name"><div>'+esc(s.studentName)+
              (s.attempt>1?' <span class="pill" style="font-size:10.5px">попытка '+s.attempt+'</span>':'')+
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
          var el=document.createElement('div');el.className='stu-row';el.style.opacity='.7';
          el.innerHTML='<div class="avatar" style="background:#3a465c">'+esc((u.name[0]||'?').toUpperCase())+'</div>'+
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
  $('#subsTitle').textContent='Аналитика: '+currentSubmissionTest.title;
  var body=$('#subsBody');skeleton(body,4);
  try{
    var r=await api('/tests/'+currentSubmissionTest.id+'/submissions');
    body.innerHTML='';
    var card=document.createElement('div');card.className='card';
    card.innerHTML='<h3>📊 Успешность по заданиям</h3>'+
      '<div class="muted" style="margin-bottom:14px">Процент учеников, справившихся с заданием.</div>';
    if(!r.analytics||!r.analytics.length)card.innerHTML+='<div class="empty">Нет данных</div>';
    r.analytics.forEach(function(a){
      var color=a.pct>=75?'var(--ok)':(a.pct>=40?'var(--warn)':'var(--err)');
      var row=document.createElement('div');row.className='analytics-row';
      row.innerHTML='<div class="num">'+a.index+'</div>'+
        '<div class="body"><div style="font-size:13.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+
          esc(a.statement.replace(/[#*_`~]/g,'').slice(0,70))+'</div>'+
          '<div class="bar-track"><div class="bar-fill" style="width:'+a.pct+'%;background:'+color+'"></div></div></div>'+
        '<div class="pct" style="color:'+color+'">'+a.pct+'%</div>'+
        '<div class="muted" style="font-size:11.5px;min-width:60px;text-align:right">'+a.correct+' / '+a.total+'</div>';
      card.appendChild(row);
    });
    body.appendChild(card);
    var back=document.createElement('button');back.className='primary';back.textContent='← К результатам';
    back.onclick=function(){showSubmissions(currentSubmissionTest);};
    body.appendChild(back);
  }catch(e){body.innerHTML='<div class="card err">'+esc(e.message)+'</div>';}
}
async function openSubmissionDetail(subId,testId){
  try{
    var r=await api('/submissions/'+subId);
    var body=$('#subsBody');
    $('#subsTitle').textContent='Работа: '+r.test.title;
    body.innerHTML='';
    var card=document.createElement('div');card.className='card';
    var pct=r.submission.max?Math.round(r.submission.score/r.submission.max*100):0;
    var gc=pct>=80?'':(pct>=60?'mid':'bad');
    card.innerHTML='<div style="display:flex;align-items:center;gap:24px;flex-wrap:wrap;margin-bottom:20px">'+
      '<div class="score-circle" data-grade="'+gc+'" style="--pct:'+pct+'">'+
        '<div class="val">'+r.submission.score+' / '+r.submission.max+'</div>'+
        '<div class="lbl">'+pct+'%</div></div>'+
      '<div class="muted" style="flex:1">'+fmt(r.submission.at)+
        (r.submission.durationMs?'<br>Время: '+fmtDur(r.submission.durationMs):'')+
        (r.submission.attempt?'<br>Попытка №'+r.submission.attempt:'')+'</div></div>';
    r.test.tasks.forEach(function(task,i){
      var res=r.submission.results[i]||{ok:false,studentText:''};
      var line=document.createElement('div');line.className='result-line '+(res.ok?'ok':'err');
      var s=createMathInput(task.statement,true);s.el.style.marginBottom='6px';line.appendChild(s.el);
      var info=document.createElement('div');
      info.innerHTML=res.ok
        ?'<span class="ok" style="font-weight:600">✓ Верно</span> <span class="muted">· '+(task.points||1)+' б.</span>'
        :'<span class="err" style="font-weight:600">✗ Неверно</span> <span class="muted">· '+(task.points||1)+' б.</span>';
      line.appendChild(info);
      if(task.type==='input'){
        var st=document.createElement('div');st.style.marginTop='10px';
        st.innerHTML='<div class="muted" style="margin-bottom:4px">Ответ ученика:</div>';
        var mf=createMathInput(res.studentText||'(пусто)',true);st.appendChild(mf.el);line.appendChild(st);
        if(!res.ok){
          var c=document.createElement('div');c.style.marginTop='10px';
          c.innerHTML='<div class="muted" style="margin-bottom:4px">Правильный ответ:</div>';
          var mfc=createMathInput(task.answer,true);c.appendChild(mfc.el);line.appendChild(c);
        }
      } else if(!res.ok){
        var c2=document.createElement('div');c2.style.marginTop='10px';
        c2.innerHTML='<div class="muted" style="margin-bottom:4px">Правильный вариант:</div>';
        var mf2=createMathInput(task.options[task.correctIndex].text,true);c2.appendChild(mf2.el);line.appendChild(c2);
      }
      card.appendChild(line);
    });
    var b=document.createElement('button');b.className='primary';b.textContent='← К результатам';
    b.onclick=function(){
      var t=currentSubmissionTest||{};
      if(t.id===testId)showSubmissions(t);else goTeacher();
    };
    card.appendChild(b);body.appendChild(card);
  }catch(e){toast(e.message,'err');}
}

/* ============ DASHBOARD ============ */
async function openDashboard(){
  if(!isTeacherLike())return;
  show('view-dashboard');
  var host=$('#dashboardBody');skeleton(host,6);
  try{
    var r=await api('/teacher/dashboard');
    host.innerHTML='';

    // Общая статистика
    var top=document.createElement('div');top.className='grid';
    [
      ['📚','Классов',r.total.classes],
      ['📥','Всего сдач',r.total.submissions],
      ['⭐','Средний балл',r.total.avgPercent+'%']
    ].forEach(function(s){
      var c=document.createElement('div');c.className='stat-card';
      c.innerHTML='<div class="stat-icon">'+s[0]+'</div><div class="stat-value">'+s[2]+'</div><div class="stat-label">'+s[1]+'</div>';
      top.appendChild(c);
    });
    host.appendChild(top);

    // Динамика по неделям
    var wCard=document.createElement('div');wCard.className='card';wCard.style.marginTop='16px';
    wCard.innerHTML='<h3>📈 Динамика по неделям</h3>';
    var wrap=document.createElement('div');wrap.className='chart-wrap';
    var bars=document.createElement('div');bars.className='chart-bars';
    r.weeks.forEach(function(w){
      var b=document.createElement('div');b.className='chart-bar';
      var color=w.avgPercent>=80?'var(--ok)':(w.avgPercent>=60?'var(--warn)':(w.avgPercent>0?'var(--err)':'var(--line)'));
      b.style.cssText='height:'+Math.max(4,w.avgPercent)+'%;background:'+color;
      b.title=w.label+' — '+w.count+' сдач, средний '+w.avgPercent+'%';
      b.dataset.label=w.label;
      bars.appendChild(b);
    });
    wrap.appendChild(bars);wCard.appendChild(wrap);
    host.appendChild(wCard);

    // Средний балл по классам
    var cCard=document.createElement('div');cCard.className='card';
    cCard.innerHTML='<h3>📚 Средний балл по классам</h3>';
    if(!r.perClass.length){cCard.innerHTML+='<div class="empty">Классов нет</div>';}
    r.perClass.forEach(function(c){
      var color=c.avgPercent>=80?'var(--ok)':(c.avgPercent>=60?'var(--warn)':'var(--err)');
      var row=document.createElement('div');row.className='analytics-row';
      row.innerHTML='<div class="body"><div style="font-size:13.5px">'+esc(c.name)+' <span class="muted">('+c.submissions+' сдач)</span></div>'+
        '<div class="bar-track"><div class="bar-fill" style="width:'+c.avgPercent+'%;background:'+color+'"></div></div></div>'+
        '<div class="pct" style="color:'+color+'">'+c.avgPercent+'%</div>';
      cCard.appendChild(row);
    });
    host.appendChild(cCard);

    // Топ-5 лучших и отстающих — в две колонки
    var twoCol=document.createElement('div');twoCol.className='two-col';
    var topCard=document.createElement('div');topCard.className='card';
    topCard.innerHTML='<h3>🏆 Лучшие ученики</h3>';
    if(!r.top.length)topCard.innerHTML+='<div class="empty">Нет данных</div>';
    r.top.forEach(function(u,i){
      var el=document.createElement('div');el.className='stu-row';
      el.innerHTML='<span class="badge green" style="background:'+(i===0?'#ffb547':(i===1?'#c0c0c0':'#cd7f32'))+'">'+(i+1)+'</span>'+
        '<div class="name"><div>'+esc(u.name)+'</div><div class="muted">'+u.submissions+' сдач</div></div>'+
        '<div class="score ok">'+u.avgPercent+'%</div>';
      topCard.appendChild(el);
    });
    twoCol.appendChild(topCard);

    var bottomCard=document.createElement('div');bottomCard.className='card';
    bottomCard.innerHTML='<h3>⚠️ Требуют внимания</h3>';
    if(!r.bottom.length)bottomCard.innerHTML+='<div class="empty">Нет данных</div>';
    r.bottom.forEach(function(u,i){
      var el=document.createElement('div');el.className='stu-row';
      el.innerHTML='<span class="badge red">'+(i+1)+'</span>'+
        '<div class="name"><div>'+esc(u.name)+'</div><div class="muted">'+u.submissions+' сдач</div></div>'+
        '<div class="score err">'+u.avgPercent+'%</div>';
      bottomCard.appendChild(el);
    });
    twoCol.appendChild(bottomCard);
    host.appendChild(twoCol);
  }catch(e){host.innerHTML='<div class="card err">'+esc(e.message)+'</div>';}
}

/* ============ LIBRARY ============ */
async function openLibrary(){
  show('view-library');
  var host=$('#bookList');skeleton(host,4);
  var bab=$('#btnAddBook');
  if(bab)bab.hidden=!canUploadBooks();
  if(!canUploadBooks())$('#bookUploadForm').hidden=true;
  try{
    var cr=await api('/classes');
    var sel=$('#bookClassFilter');
    if(sel)sel.innerHTML='<option value="">Все классы</option>'+
      cr.classes.map(function(c){return '<option value="'+c.id+'">'+esc(c.name)+'</option>';}).join('');
  }catch(e){}
  await searchBooks();
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
      host.innerHTML='<div class="card"><div class="empty"><span class="icon">📚</span>'+(q||cid?'Ничего не найдено':'Книг пока нет')+'</div></div>';
      return;
    }
    if(bookView==='grid'){
      var grid=document.createElement('div');grid.className='grid';
      r.books.forEach(function(b){grid.appendChild(renderBookCard(b));});
      host.appendChild(grid);
    } else {
      r.books.forEach(function(b){host.appendChild(renderBookRow(b));});
    }
  }catch(e){host.innerHTML='<div class="card err">'+esc(e.message)+'</div>';}
}
function renderBookCard(b){
  var card=document.createElement('div');card.className='book-card';
  card.innerHTML='<div class="book-cover"><span>📖</span></div>'+
    '<div class="book-title">'+esc(b.title)+'</div>'+
    (b.author?'<div class="book-author">'+esc(b.author)+'</div>':'')+
    '<div class="book-meta">'+
      (b.subject?'<span class="pill">'+esc(b.subject)+'</span>':'')+
      (b.fileSize?'<span class="pill">'+fmtSize(b.fileSize)+'</span>':'')+
      (b.ownerName?'<span class="pill">'+esc(b.ownerName)+'</span>':'')+
    '</div>'+
    (b.description?'<div class="book-desc">'+esc(b.description)+'</div>':'');
  var actions=document.createElement('div');actions.className='book-actions';
  if(b.fileName){
    var d=document.createElement('button');d.className='primary small';d.textContent='📖 Открыть';
    d.onclick=function(){downloadBook(b.id,false);};actions.appendChild(d);
    var dn=document.createElement('button');dn.className='ghost small';dn.textContent='⬇ Скачать';
    dn.onclick=function(){downloadBook(b.id,true);};actions.appendChild(dn);
  }
  if(isAdmin()||(isTeacherLike()&&b.ownerId===currentUser.id)){
    var del=document.createElement('button');del.className='ghost small danger';del.textContent='Удалить';
    del.onclick=async function(){
      if(!confirm('Удалить «'+b.title+'»?'))return;
      try{await api('/books/'+b.id,{method:'DELETE'});toast('Удалено','ok');searchBooks();}
      catch(e){toast(e.message,'err');}
    };
    actions.appendChild(del);
  }
  card.appendChild(actions);
  return card;
}
function renderBookRow(b){
  var el=document.createElement('div');el.className='book-list-row';
  el.innerHTML='<div class="bicon">📖</div>'+
    '<div class="binfo"><div class="btitle">'+esc(b.title)+'</div>'+
    '<div class="bauthor">'+esc(b.author||'—')+(b.subject?' · '+esc(b.subject):'')+
      (b.fileSize?' · '+fmtSize(b.fileSize):'')+(b.ownerName?' · '+esc(b.ownerName):'')+'</div></div>';
  var actions=document.createElement('div');actions.style.cssText='display:flex;gap:6px';
  if(b.fileName){
    var d=document.createElement('button');d.className='primary small';d.textContent='📖';
    d.onclick=function(){downloadBook(b.id,false);};actions.appendChild(d);
    var dn=document.createElement('button');dn.className='ghost small';dn.textContent='⬇';
    dn.onclick=function(){downloadBook(b.id,true);};actions.appendChild(dn);
  }
  if(isAdmin()||(isTeacherLike()&&b.ownerId===currentUser.id)){
    var del=document.createElement('button');del.className='ghost small danger';del.textContent='✕';
    del.onclick=async function(){
      if(!confirm('Удалить?'))return;
      try{await api('/books/'+b.id,{method:'DELETE'});toast('Удалено','ok');searchBooks();}
      catch(e){toast(e.message,'err');}
    };
    actions.appendChild(del);
  }
  el.appendChild(actions);
  return el;
}
function downloadBook(id, saveAs){
  var tk=getToken();
  fetch('/api/books/'+id+'/download',{headers:{Authorization:'Bearer '+tk}})
    .then(function(r){if(!r.ok)throw new Error('Ошибка');return r.blob();})
    .then(function(blob){
      var url=URL.createObjectURL(blob);
      if(saveAs){var a=document.createElement('a');a.href=url;a.download='book';document.body.appendChild(a);a.click();a.remove();}
      else window.open(url,'_blank');
      setTimeout(function(){URL.revokeObjectURL(url);},60000);
    })
    .catch(function(e){toast(e.message,'err');});
}
async function renderBookClassPicker(){
  var host=$('#bookClassPicker');if(!host)return;
  try{
    var r=await api('/classes');
    host.innerHTML='';window.__bookClassIds=[];
    if(!r.classes.length){host.innerHTML='<div class="muted">Нет классов — книга видна всем.</div>';return;}
    r.classes.forEach(function(c){
      var lab=document.createElement('label');lab.className='class-pick';
      var cb=document.createElement('input');cb.type='checkbox';
      cb.onchange=function(){
        if(cb.checked)window.__bookClassIds.push(c.id);
        else window.__bookClassIds=window.__bookClassIds.filter(function(x){return x!==c.id;});
      };
      var s=document.createElement('span');
      s.innerHTML='<b>'+esc(c.name)+'</b> <span class="muted">('+c.studentCount+')</span>';
      lab.appendChild(cb);lab.appendChild(s);host.appendChild(lab);
    });
  }catch(e){}
}
async function saveBook(){
  var err=$('#bookErr');if(err)err.textContent='';
  var title=$('#bookTitle').value.trim();
  if(!title){if(err)err.textContent='Введите название';return;}
  var fd=new FormData();
  fd.append('title',title);
  fd.append('author',$('#bookAuthor').value.trim());
  fd.append('subject',$('#bookSubject').value.trim());
  fd.append('description',$('#bookDescription').value.trim());
  fd.append('classIds',JSON.stringify(window.__bookClassIds||[]));
  var f=$('#bookFile').files[0];
  if(f){
    if(f.size>25*1024*1024){if(err)err.textContent='Файл больше 25 МБ';return;}
    fd.append('file',f);
  }
  var btn=$('#btnSaveBook');btn.disabled=true;btn.textContent='Загрузка...';
  try{
    await apiForm('/books',fd);
    toast('Книга загружена','ok');
    ['bookTitle','bookAuthor','bookSubject','bookDescription','bookFile'].forEach(function(id){$('#'+id).value='';});
    $('#bookUploadForm').hidden=true;window.__bookClassIds=[];
    searchBooks();
  }catch(e){if(err)err.textContent=e.message;toast(e.message,'err');}
  finally{btn.disabled=false;btn.textContent='Загрузить';}
}

/* ============ ADMIN ============ */
async function openAdmin(){
  if(!isAdmin())return;
  show('view-admin');
  var statsHost=$('#adminStats');skeleton(statsHost,3);
  var listHost=$('#adminUsersList');skeleton(listHost,4);
  await loadAdminUsers();
}
async function loadAdminLogs(){
  var host=$('#adminLogsList'); if(!host) return;
  skeleton(host,5);
  try{
    var r=await api('/admin/logs?limit=200');
    host.innerHTML='';
    if(!r.logs.length){host.innerHTML='<div class="empty">Пока нет записей</div>';return;}
    r.logs.forEach(function(l){
      var el=document.createElement('div'); el.className='log-row';
      el.innerHTML='<div class="log-time">'+fmtDate(l.at)+'</div>'+
        '<div class="log-who">'+esc(l.userName)+'</div>'+
        '<div class="log-action">'+esc(l.action)+
        (l.details?'<div class="log-details">'+esc(l.details)+'</div>':'')+'</div>';
      host.appendChild(el);
    });
  }catch(e){host.innerHTML='<div class="err">'+esc(e.message)+'</div>';}
}
async function loadBackups(){
  var host=$('#adminBackupsList');if(!host)return;
  skeleton(host,3);
  try{
    var r=await api('/admin/backups');
    host.innerHTML='';
    if(!r.backups.length){host.innerHTML='<div class="empty">Пока нет бэкапов</div>';return;}
    r.backups.forEach(function(b){
      var el=document.createElement('div');el.className='backup-row';
      var date=new Date(b.createdAt).toLocaleString('ru-RU');
      el.innerHTML='<div class="bi-info"><b>'+(b.auto?'🤖 Авто':'💾 Ручной')+'</b>'+
        '<div class="muted">'+date+' · '+fmtSize(b.size)+'</div></div>';
      var dl=document.createElement('button');dl.className='primary small';dl.textContent='📥 Скачать';
      dl.onclick=async function(){
        try{
          var tk=getToken();
          var res=await fetch('/api/admin/backups/'+b.id+'/download',{headers:{Authorization:'Bearer '+tk}});
          if(!res.ok)throw new Error('Не удалось');
          var blob=await res.blob();
          var a=document.createElement('a');a.href=URL.createObjectURL(blob);
          a.download=b.key.split('/').pop();
          document.body.appendChild(a);a.click();a.remove();
        }catch(e){toast(e.message,'err');}
      };
      var del=document.createElement('button');del.className='ghost small danger';del.textContent='✕';
      del.onclick=async function(){
        if(!confirm('Удалить бэкап?'))return;
        try{await api('/admin/backups/'+b.id,{method:'DELETE'});toast('Удалён','ok');loadBackups();}
        catch(e){toast(e.message,'err');}
      };
      el.appendChild(dl);el.appendChild(del);
      host.appendChild(el);
    });
  }catch(e){host.innerHTML='<div class="err">'+esc(e.message)+'</div>';}
}
async function createBackupNow(){
  var btn=$('#btnCreateBackup');if(!btn)return;
  btn.disabled=true;btn.textContent='Создание...';
  try{
    await api('/admin/backups/create',{method:'POST'});
    toast('Бэкап создан','ok');loadBackups();
  }catch(e){toast(e.message,'err');}
  finally{btn.disabled=false;btn.textContent='+ Создать сейчас';}
}
async function loadAdminUsers(){
  try{
    var q=$('#adminSearch').value.trim();
    var role=$('#adminRoleFilter').value;
    var r=await api('/admin/users?q='+encodeURIComponent(q)+'&role='+encodeURIComponent(role));
    var sh=$('#adminStats');sh.innerHTML='';
    [
      ['👥','Всего',r.stats.total],
      ['👑','Админов',r.stats.admin],
      ['🏫','Учителей',r.stats.teacher],
      ['📚','Библиотекарей',r.stats.librarian],
      ['🎓','Учеников',r.stats.student],
      ['📝','Работ',r.stats.tests],
      ['📖','Книг',r.stats.books]
    ].forEach(function(s){
      var c=document.createElement('div');c.className='stat-card';
      c.innerHTML='<div class="stat-icon">'+s[0]+'</div><div class="stat-value">'+s[2]+'</div><div class="stat-label">'+s[1]+'</div>';
      sh.appendChild(c);
    });
    var host=$('#adminUsersList');host.innerHTML='';
    if(!r.users.length){host.innerHTML='<div class="empty">Никого не найдено</div>';return;}
    r.users.forEach(function(u){
      var el=document.createElement('div');el.className='admin-row';
      el.innerHTML='<div class="avatar"></div>'+
        '<div class="info"><b>'+esc(u.name)+'</b>'+
        '<div class="muted">'+esc(u.email)+' · '+fmtDate(u.createdAt)+'</div>'+
        '<div class="muted" style="font-size:11.5px;margin-top:2px">'+
          'Классов: '+u.stats.classes_created+' · В классах: '+u.stats.classes_joined+
          ' · Сдач: '+u.stats.submissions+' · Книг: '+u.stats.books+'</div></div>';
      renderAvatar(el.querySelector('.avatar'),u,36);
      var sel=document.createElement('select');
      ['admin','teacher','librarian','student'].forEach(function(rl){
        var o=document.createElement('option');o.value=rl;
        o.textContent={'admin':'👑 Админ','teacher':'🏫 Учитель','librarian':'📚 Библиотекарь','student':'🎓 Ученик'}[rl];
        if(rl===u.role)o.selected=true;
        sel.appendChild(o);
      });
      sel.disabled=(u.id===currentUser.id);
      sel.onchange=async function(){
        try{await api('/admin/users/'+u.id+'/role',{method:'POST',body:{role:sel.value}});
          toast('Роль изменена','ok');loadAdminUsers();}
        catch(e){toast(e.message,'err');loadAdminUsers();}
      };
      el.appendChild(sel);
      var rp=document.createElement('button');rp.className='ghost small';rp.textContent='🔑';
      rp.title='Сбросить пароль';
      rp.onclick=async function(){
        if(!confirm('Сбросить пароль для '+u.name+'?'))return;
        try{var res=await api('/admin/users/'+u.id+'/reset-password',{method:'POST'});
          prompt('Новый пароль:',res.password);toast('Пароль сброшен','ok');
        }catch(e){toast(e.message,'err');}
      };
      el.appendChild(rp);
      var del=document.createElement('button');del.className='ghost small danger';del.textContent='✕';
      del.disabled=(u.id===currentUser.id);
      del.onclick=async function(){
        if(!confirm('Удалить пользователя '+u.name+'?'))return;
        try{await api('/admin/users/'+u.id,{method:'DELETE'});
          toast('Удалён','ok');loadAdminUsers();}
        catch(e){toast(e.message,'err');}
      };
      el.appendChild(del);
      host.appendChild(el);
    });
  }catch(e){$('#adminUsersList').innerHTML='<div class="err">'+esc(e.message)+'</div>';}
}

/* ============ PROFILE STATS ============ */
async function openProfileStats(){
  show('view-profile');
  var host=$('#profileStats');skeleton(host,4);
  try{
    var url=isTeacherLike()?'/profile/teacher':'/profile/student';
    var r=await api(url);
    host.innerHTML='';
    var hello=document.createElement('div');hello.className='card';hello.style.overflow='hidden';
    var av=document.createElement('div');av.className='avatar';av.style.cssText='width:56px;height:56px;font-size:22px;float:left;margin-right:14px';
    hello.appendChild(av);
    var info=document.createElement('div');
    info.innerHTML='<h2 style="margin-bottom:4px">'+esc(currentUser.name)+'</h2>'+
      '<div class="muted">'+roleLabel()+'</div>';
    hello.appendChild(info);
    host.appendChild(hello);
    renderAvatar(av,currentUser,56);
    var statGrid=document.createElement('div');statGrid.className='grid';
    var stats=isTeacherLike()
      ?[['📚','Классов',r.classesCount],['👥','Учеников',r.studentsCount],
        ['📝','Работ',r.testsCount],['📖','Книг',r.booksCount],
        ['📥','Сдач',r.submissionsCount],['⭐','Средний балл',r.avgPercent+'%']]
      :[['📚','Классов',r.classesCount],['📝','Сдач',r.submissionsCount],
        ['⭐','Средний балл',r.avgPercent+'%'],
        ['🏆','Всего баллов',r.totalScore+' / '+r.totalMax],
        ['📖','Книг доступно',r.booksCount]];
    stats.forEach(function(s){
      var c=document.createElement('div');c.className='stat-card';
      c.innerHTML='<div class="stat-icon">'+s[0]+'</div><div class="stat-value">'+s[2]+'</div><div class="stat-label">'+s[1]+'</div>';
      statGrid.appendChild(c);
    });
    host.appendChild(statGrid);
    if(!isTeacherLike()&&r.all&&r.all.length){
      var prog=document.createElement('div');prog.className='card';prog.style.marginTop='16px';
      prog.innerHTML='<h3>📊 Динамика среднего балла</h3>';
      var chartWrap=document.createElement('div');chartWrap.className='chart-wrap';
      var chart=document.createElement('div');chart.className='chart-bars';
      var sorted=r.all.slice().sort(function(a,b){return a.at-b.at;});
      sorted.forEach(function(s){
        var bar=document.createElement('div');bar.className='chart-bar';
        var color=s.pct>=80?'var(--ok)':(s.pct>=60?'var(--warn)':'var(--err)');
        bar.style.cssText='height:'+Math.max(4,s.pct)+'%;background:'+color;
        bar.title=s.testTitle+' — '+s.pct+'%';
        bar.dataset.label=new Date(s.at).toLocaleDateString('ru-RU',{day:'2-digit',month:'2-digit'});
        chart.appendChild(bar);
      });
      chartWrap.appendChild(chart);prog.appendChild(chartWrap);
      prog.innerHTML+='<h3 style="margin-top:16px">📈 Баллы по работам</h3>';
      var cw2=document.createElement('div');cw2.className='chart-wrap';
      var c2=document.createElement('div');c2.className='chart-bars';
      var recent=r.all.slice(0,20).reverse();
      recent.forEach(function(s){
        var bar=document.createElement('div');bar.className='chart-bar';
        var color=s.pct>=80?'var(--ok)':(s.pct>=60?'var(--warn)':'var(--err)');
        bar.style.cssText='height:'+Math.max(4,s.pct)+'%;background:'+color;
        bar.title=s.testTitle+' — '+s.score+'/'+s.max+' ('+s.pct+'%)';
        bar.dataset.label=s.pct+'%';
        c2.appendChild(bar);
      });
      cw2.appendChild(c2);prog.appendChild(cw2);
      if(r.classStats&&r.classStats.length){
        prog.innerHTML+='<h3 style="margin-top:20px">📚 По классам</h3>';
        r.classStats.forEach(function(c){
          var row=document.createElement('div');row.className='analytics-row';
          var color=c.avgPct>=80?'var(--ok)':(c.avgPct>=60?'var(--warn)':'var(--err)');
          row.innerHTML='<div class="body"><div style="font-size:13.5px">'+esc(c.name)+' <span class="muted">('+c.count+' сдач)</span></div>'+
            '<div class="bar-track"><div class="bar-fill" style="width:'+c.avgPct+'%;background:'+color+'"></div></div></div>'+
            '<div class="pct" style="color:'+color+'">'+c.avgPct+'%</div>';
          prog.appendChild(row);
        });
      }
      prog.innerHTML+='<h3 style="margin-top:20px">📋 Все результаты</h3>';
      var table=document.createElement('table');table.className='progress-table';
      table.innerHTML='<thead><tr><th>Работа</th><th>Класс</th><th>Дата</th><th>Балл</th><th>%</th></tr></thead>';
      var tbody=document.createElement('tbody');
      r.all.forEach(function(s){
        var tr=document.createElement('tr');
        var color=s.pct>=80?'var(--ok)':(s.pct>=60?'var(--warn)':'var(--err)');
        tr.innerHTML='<td>'+esc(s.testTitle)+'</td><td>'+esc(s.className)+'</td>'+
          '<td>'+fmtDate(s.at)+'</td><td>'+s.score+' / '+s.max+'</td>'+
          '<td style="color:'+color+';font-weight:600">'+s.pct+'%</td>';
        tbody.appendChild(tr);
      });
      table.appendChild(tbody);prog.appendChild(table);
      var exp=document.createElement('button');exp.className='ghost small';exp.style.marginTop='12px';
      exp.textContent='📥 Скачать мои результаты (CSV)';
      exp.onclick=function(){
        var rows=[['Работа','Класс','Дата','Балл','Макс','%']];
        r.all.forEach(function(s){rows.push([s.testTitle,s.className,new Date(s.at).toLocaleString('ru-RU'),s.score,s.max,s.pct+'%']);});
        var csv=rows.map(function(r){return r.map(function(v){
          v=String(v==null?'':v);
          if(v.includes(',')||v.includes('"'))return '"'+v.replace(/"/g,'""')+'"';
          return v;
        }).join(',');}).join('\r\n');
        var blob=new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8'});
        var a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='my_results.csv';
        document.body.appendChild(a);a.click();a.remove();
      };
      prog.appendChild(exp);
      host.appendChild(prog);
    }
    if(r.recent&&r.recent.length){
      var rec=document.createElement('div');rec.className='card';rec.style.marginTop='16px';
      rec.innerHTML='<h3>Последние сдачи</h3>';
      r.recent.forEach(function(s){
        var pct=s.max?Math.round(s.score/s.max*100):0;
        var el=document.createElement('div');el.className='stu-row';
        el.innerHTML='<div class="avatar">'+(isTeacherLike()?esc((s.studentName[0]||'?').toUpperCase()):'📝')+'</div>'+
          '<div class="name"><div>'+esc(s.testTitle)+(isTeacherLike()&&s.studentName?' · '+esc(s.studentName):'')+
          '</div><div class="muted">'+fmt(s.at)+'</div></div>'+
          '<div class="score '+(pct>=60?'ok':'err')+'">'+s.score+' / '+s.max+'</div>';
        rec.appendChild(el);
      });
      host.appendChild(rec);
    }
  }catch(e){host.innerHTML='<div class="card err">'+esc(e.message)+'</div>';}
}
function openEditProfile(){
  if(!currentUser)return;
  show('view-editprofile');
  renderAvatar($('#editAvatar'),currentUser,80);
  $('#editName').value=currentUser.name||'';
  $('#editEmail').value=currentUser.email||'';
  $('#editPass').value='';
  $('#editErr').textContent='';
}
async function saveEditProfile(){
  var err=$('#editErr');if(err)err.textContent='';
  var body={};
  var n=$('#editName').value.trim();
  var e=$('#editEmail').value.trim();
  var p=$('#editPass').value;
  if(n)body.name=n;
  if(e)body.email=e;
  if(p){if(p.length<6){if(err)err.textContent='Пароль от 6 символов';return;}body.password=p;}
  try{
    var r=await api('/users/me',{method:'PATCH',body:body});
    currentUser=r.user;renderTop();
    toast('Профиль обновлён','ok');openProfileStats();
  }catch(e){if(err)err.textContent=e.message;toast(e.message,'err');}
}
async function uploadAvatar(file){
  if(!file)return;
  if(file.size>5*1024*1024){toast('Файл больше 5 МБ','err');return;}
  var fd=new FormData();fd.append('avatar',file);
  try{
    await apiForm('/users/me/avatar',fd);
    var me=await api('/auth/me');
    currentUser=me.user;renderTop();
    renderAvatar($('#editAvatar'),currentUser,80);
    toast('Аватар обновлён','ok');
  }catch(e){toast(e.message,'err');}
}
async function tryAutoJoin(){
  var p=new URLSearchParams(location.search).get('join');
  if(!p)return;
  history.replaceState(null,'',location.pathname);
  if(!currentUser||currentUser.role!=='student')return;
  try{
    await api('/classes/join',{method:'POST',body:{code:p.toUpperCase()}});
    toast('Вы присоединились к классу по ссылке','ok');
    renderStudentClasses();renderStudentTests();
  }catch(e){toast(e.message,'err');}
}

/* ============ ENTER APP ============ */
function enterApp(u){
  currentUser=u;renderTop();
  refreshNotifBadge();
  if(notifTimer)clearInterval(notifTimer);
  notifTimer=setInterval(refreshNotifBadge,30000);
  if(isTeacherLike())goTeacher();
  else if(u.role==='librarian')openLibrary();
  else goStudent();
}

/* ============ BOOT ============ */
async function boot(){
  try{
    var tgInfo=await fetch('/api/telegram/bot-info').then(function(r){return r.json();});
    if(tgInfo&&tgInfo.username)window.TELEGRAM_BOT_USERNAME=tgInfo.username;
  }catch(e){}
  initEditorFields();
  var bt=$('#btnTheme');if(bt)bt.onclick=function(){
    var cur=document.documentElement.getAttribute('data-theme');
    applyTheme(cur==='dark'?'light':'dark');
  };
  var bn=$('#btnNotif');if(bn)bn.onclick=function(e){
    e.stopPropagation();notifOpen=!notifOpen;
    var p=$('#notifPanel');if(p)p.hidden=!notifOpen;
    if(notifOpen)loadNotifications();
  };
  document.addEventListener('click',function(e){
    if(!notifOpen)return;
    if(e.target.closest('#notifPanel')||e.target.closest('#btnNotif'))return;
    closeNotifPanel();
  });
  var bp=$('#btnProfile');if(bp)bp.onclick=openPalettePicker;
  var bpal=$('#btnPalette');if(bpal)bpal.onclick=openPalettePicker;
  var bcp=$('#btnCloseProfile');if(bcp)bcp.onclick=function(){$('#profileModal').hidden=true;};
  var pm=$('#profileModal');if(pm)pm.addEventListener('click',function(e){
    if(e.target.id==='profileModal')$('#profileModal').hidden=true;
  });
  $$('.theme-option').forEach(function(b){
    b.onclick=function(){
      applyTheme(b.dataset.themeSet);
      $$('.theme-option').forEach(function(x){x.classList.toggle('active',x===b);});
    };
  });
  var blib=$('#btnLibrary');if(blib)blib.onclick=openLibrary;
  var bdsh=$('#btnDashboard');if(bdsh)bdsh.onclick=openDashboard;
  var bbfl=$('#btnBackFromLibrary');if(bbfl)bbfl.onclick=function(){
    if(isTeacherLike())goTeacher();else if(currentUser.role==='librarian')goTeacher();else goStudent();
  };
  var bbfd=$('#btnBackFromDashboard');if(bbfd)bbfd.onclick=goTeacher;
  var bab=$('#btnAddBook');if(bab)bab.onclick=function(){$('#bookUploadForm').hidden=false;renderBookClassPicker();};
  var bcb=$('#btnCancelBook');if(bcb)bcb.onclick=function(){$('#bookUploadForm').hidden=true;$('#bookErr').textContent='';};
  var bsb=$('#btnSaveBook');if(bsb)bsb.onclick=saveBook;
  var bs=$('#bookSearch');if(bs){var tmr;bs.addEventListener('input',function(){clearTimeout(tmr);tmr=setTimeout(searchBooks,250);});}
  var bcf=$('#bookClassFilter');if(bcf)bcf.onchange=searchBooks;
  var bsort=$('#bookSort');if(bsort)bsort.onchange=searchBooks;
  var bbv=$('#btnBookView');if(bbv)bbv.onclick=function(){
    bookView=bookView==='grid'?'list':'grid';
    bbv.textContent=bookView==='grid'?'📋 Список':'▦ Плитки';
    searchBooks();
  };
  var badm=$('#btnAdmin');if(badm)badm.onclick=openAdmin;
  var bbfa=$('#btnBackFromAdmin');if(bbfa)bbfa.onclick=function(){
    if(isTeacherLike())goTeacher();else goStudent();
  };
  var as=$('#adminSearch');if(as){var t2;as.addEventListener('input',function(){clearTimeout(t2);t2=setTimeout(loadAdminUsers,250);});}
  var arf=$('#adminRoleFilter');if(arf)arf.onchange=loadAdminUsers;
  $$('[data-admintab]').forEach(function(t){
    t.onclick=function(){
      $$('[data-admintab]').forEach(function(x){x.classList.toggle('active',x===t);});
      var tab=t.dataset.admintab;
      var ut=$('#admin-users-tab'),lt=$('#admin-logs-tab'),bt2=$('#admin-backups-tab');
      if(ut)ut.hidden = tab!=='users';
      if(lt)lt.hidden = tab!=='logs';
      if(bt2)bt2.hidden = tab!=='backups';
      if(tab==='logs') loadAdminLogs();
      if(tab==='backups') loadBackups();
    };
  });
  var bcr=$('#btnCreateBackup');if(bcr)bcr.onclick=createBackupNow;
  var bbfp=$('#btnBackFromProfile');if(bbfp)bbfp.onclick=function(){
    if(isTeacherLike())goTeacher();else goStudent();
  };
  var bep=$('#btnEditProfile');if(bep)bep.onclick=openEditProfile;
  var bbfep=$('#btnBackFromEditProfile');if(bbfep)bbfep.onclick=openProfileStats;
  var bsp=$('#btnSaveProfile');if(bsp)bsp.onclick=saveEditProfile;
  var bce=$('#btnCancelEdit');if(bce)bce.onclick=openProfileStats;
  var bua=$('#btnUploadAvatar');if(bua)bua.onclick=function(){$('#avatarInput').click();};
  var ai=$('#avatarInput');if(ai)ai.onchange=function(){if(this.files[0])uploadAvatar(this.files[0]);};
  var bcf2=$('#btnChatFile');if(bcf2)bcf2.onclick=function(){$('#chatFileInput').click();};
  var cfi=$('#chatFileInput');if(cfi)cfi.onchange=function(){
    var f=this.files[0];if(!f)return;
    if(f.size>5*1024*1024){toast('Файл больше 5 МБ','err');this.value='';return;}
    $('#chatFileName').textContent='📎 '+f.name+' ('+fmtSize(f.size)+')';
  };
  var bcs=$('#btnChatSend');if(bcs)bcs.onclick=sendChatMessage;
  var ct=$('#chatText');if(ct)ct.addEventListener('keydown',function(e){
    if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendChatMessage();}
  });
  $$('.tab').forEach(function(t){
    if(!t.dataset.tab)return;
    t.onclick=function(){
      $$('.tab').forEach(function(x){if(x.dataset.tab)x.classList.toggle('active',x===t);});
      var isL=t.dataset.tab==='login';
      $('#loginForm').hidden=!isL;$('#regForm').hidden=isL;
      var ae=$('#authErr');if(ae)ae.textContent='';
      setTimeout(function(){(isL?$('#loginEmail'):$('#regName')).focus();},50);
    };
  });
  $$('[data-ttab]').forEach(function(t){t.onclick=function(){
    $$('[data-ttab]').forEach(function(x){x.classList.toggle('active',x===t);});
    $('#tt-tests').hidden=t.dataset.ttab!=='tests';
    $('#tt-classes').hidden=t.dataset.ttab!=='classes';
  };});
  $$('[data-stab]').forEach(function(t){t.onclick=function(){
    $$('[data-stab]').forEach(function(x){x.classList.toggle('active',x===t);});
    $('#st-tests').hidden=t.dataset.stab!=='tests';
    $('#st-classes').hidden=t.dataset.stab!=='classes';
  };});
  $$('.sym-tab').forEach(function(t){
    t.onclick=function(){
      $$('.sym-tab').forEach(function(x){x.classList.toggle('active',x===t);});
      currentSymTab=t.dataset.symtab;buildSymbolBar($('#symbolBar'));
    };
  });
  $('#doLogin').onclick=async function(){
    var ae=$('#authErr');if(ae)ae.textContent='';
    try{
      var r=await api('/auth/login',{method:'POST',body:{email:$('#loginEmail').value.trim(),password:$('#loginPass').value}});
      setToken(r.token);enterApp(r.user);toast('Добро пожаловать!','ok');
    }catch(e){if(ae)ae.textContent=e.message;toast(e.message,'err');}
  };
  $('#doRegister').onclick=async function(){
    var ae=$('#authErr');if(ae)ae.textContent='';
    try{
      var r=await api('/auth/register',{method:'POST',body:{name:$('#regName').value.trim(),email:$('#regEmail').value.trim(),password:$('#regPass').value,role:$('#regRole').value}});
      setToken(r.token);enterApp(r.user);toast('Аккаунт создан','ok');
    }catch(e){if(ae)ae.textContent=e.message;toast(e.message,'err');}
  };
  ['loginEmail','loginPass'].forEach(function(id){var el=$('#'+id);if(el)el.addEventListener('keydown',function(e){if(e.key==='Enter')$('#doLogin').click();});});
  ['regName','regEmail','regPass'].forEach(function(id){var el=$('#'+id);if(el)el.addEventListener('keydown',function(e){if(e.key==='Enter')$('#doRegister').click();});});
  var jc=$('#joinCode');if(jc)jc.addEventListener('keydown',function(e){if(e.key==='Enter')$('#btnJoinClass').click();});
  $$('.pass-toggle').forEach(function(btn){
    btn.onclick=function(){
      var inp=$('#'+btn.dataset.target);if(!inp)return;
      var p=inp.type==='password';
      inp.type=p?'text':'password';btn.textContent=p?'🙈':'👁';
    };
  });
  var bnt=$('#btnNewTest');if(bnt)bnt.onclick=function(){openEditor(null);};
  var bnc=$('#btnNewClass');if(bnc)bnc.onclick=async function(){
    var name=prompt('Название класса (например: Математика 101)');
    if(!name||!name.trim())return;
    try{await api('/classes',{method:'POST',body:{name:name.trim()}});toast('Класс создан','ok');goTeacher();}
    catch(e){toast(e.message,'err');}
  };
  var bbt=$('#btnBackToTeacher');if(bbt)bbt.onclick=goTeacher;
  var bbfc=$('#btnBackFromClass');if(bbfc)bbfc.onclick=function(){
    if(chatPollTimer){clearInterval(chatPollTimer);chatPollTimer=null;}
    if(isTeacherLike())goTeacher();else goStudent();
  };
  var bbft=$('#btnBackFromTake');if(bbft)bbft.onclick=function(){
    if(confirm('Выйти? Черновик сохранён.')){if(timerInterval){clearInterval(timerInterval);timerInterval=null;}goStudent();}
  };
  var bbfs=$('#btnBackFromSubs');if(bbfs)bbfs.onclick=goTeacher;
  var brb=$('#btnResultBack');if(brb)brb.onclick=goStudent;
  var tt=$('#toTop');
  window.addEventListener('scroll',function(){if(tt)tt.classList.toggle('show',window.scrollY>300);});
  if(tt)tt.onclick=function(){window.scrollTo({top:0,behavior:'smooth'});};
  renderTop();
  if(getToken()){
    try{
      var r=await api('/auth/me');
      enterApp(r.user);
      if(r.user.role==='student')await tryAutoJoin();
      return;
    }catch(e){setToken(null);}
  }
  initGoogleLogin();
  initTelegramLogin();
  show('view-auth');
  setTimeout(function(){var el=$('#loginEmail');if(el)el.focus();},150);
}
document.addEventListener('DOMContentLoaded',function(){registerSW();boot();});
})();
