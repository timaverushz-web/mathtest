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

/* ============ ТЕМА ============ */
var THEME_KEY='mathtest_theme';
function applyTheme(t){
  document.documentElement.setAttribute('data-theme',t);
  var btn=$('#btnTheme');if(btn)btn.textContent = t==='dark' ? '🌙' : '☀️';
  try{localStorage.setItem(THEME_KEY,t);}catch(e){}
}
(function(){
  var saved='dark';
  try{saved=localStorage.getItem(THEME_KEY)||'dark';}catch(e){}
  applyTheme(saved);
})();

/* ============ ТОСТЫ ============ */
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
  if(!r.ok){
    var e=new Error(data.error||'Ошибка');e.status=r.status;
    if(r.status===401){setToken(null);}
    throw e;
  }
  return data;
}

/* ============ ПОЛЯ ФОРМУЛ ============ */
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
    if(window.katex&&tex){
      try{katex.render(tex,prev,{throwOnError:false});}
      catch(e){prev.textContent=ta.value;}
    } else prev.textContent=ta.value;
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
  if(!c)return;
  c.innerHTML='';
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

/* ============ СОСТОЯНИЕ ============ */
var currentUser=null,currentTest=null,answerInputs=[],choicePicks=[];
var editingTestId=null,draftTasks=[],draftClassIds=[],draftGroupIds=[];
var currentClassId=null,currentSubmissionTest=null;
var stmtInput=null,ansInput=null;
var timerInterval=null,testDeadline=null;
var draftTimer=null;
var notifOpen=false;
var notifTimer=null;

function show(id){
  $$('.view').forEach(function(v){v.classList.toggle('active',v.id===id);});
  window.scrollTo(0,0);
}
function skeleton(host,lines){
  if(!host)return;
  lines=lines||3;
  var html='<div class="skeleton">';
  for(var i=0;i<lines;i++)html+='<div class="sk-line w'+(60+((i*17)%40))+'"></div>';
  html+='</div>';
  host.innerHTML=html;
}

/* ============ ШАПКА ============ */
function renderTop(){
  var box=$('#userBox');
  if(!box)return;
  var bn=$('#btnNotif');
  var bp=$('#btnProfile');
  if(!currentUser){
    box.innerHTML='';
    if(bn)bn.style.display='none';
    if(bp)bp.style.display='none';
    return;
  }
  if(bn)bn.style.display='';
  if(bp)bp.style.display='';
  var role=currentUser.role==='teacher'?'учитель':'ученик';
  var initial=(currentUser.name[0]||'?').toUpperCase();
  box.innerHTML='<div class="user-chip"><div class="avatar">'+esc(initial)+'</div>'+
    '<div><div style="font-weight:500;font-size:13.5px">'+esc(currentUser.name)+'</div>'+
    '<div class="role" style="font-size:11.5px;margin-top:-2px">'+role+'</div></div>'+
    '<button class="logout-btn" id="btnLogout">Выйти</button></div>';
  var lo=$('#btnLogout');if(lo)lo.onclick=logout;
}
function logout(){
  setToken(null);currentUser=null;
  if(notifTimer){clearInterval(notifTimer);notifTimer=null;}
  renderTop();show('view-auth');
  toast('Вы вышли','info');
}

/* ============ УВЕДОМЛЕНИЯ ============ */
function closeNotifPanel(){
  notifOpen=false;
  var p=$('#notifPanel');if(p)p.hidden=true;
}

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
      var icon=n.type==='submission'?'📝':(n.type==='new_test'?'📚':'👤');
      el.innerHTML='<div class="ni-icon">'+icon+'</div>'+
        '<div class="ni-body">'+
          '<div class="ni-title">'+esc(n.title)+'</div>'+
          '<div class="ni-text">'+esc(n.text)+'</div>'+
          '<div class="ni-time">'+fmt(n.at)+'</div>'+
        '</div>';
      el.onclick=async function(){
        try{await api('/notifications/'+n.id+'/read',{method:'POST'});}catch(e){}
        el.classList.remove('unread');
        closeNotifPanel();
        if(n.type==='submission'&&n.link&&n.link.testId&&currentUser.role==='teacher'){
          try{
            var rr=await api('/tests');
            var t=rr.tests.find(function(x){return x.id===n.link.testId;});
            if(t)showSubmissions(t);
          }catch(e){}
        } else if(n.type==='new_test'&&currentUser.role==='student'){
          goStudent();
        }
        refreshNotifBadge();
      };
      list.appendChild(el);
    });
  }catch(e){list.innerHTML='<div class="err" style="padding:16px">'+esc(e.message)+'</div>';}
}

/* ============ ПРОФИЛЬ ============ */
async function openProfile(){
  if(!currentUser){toast('Сначала войдите в систему','warn');return;}
  var pm=$('#profileModal');if(!pm)return;
  pm.hidden=false;
  $('#profAvatar').textContent=(currentUser.name[0]||'?').toUpperCase();
  $('#profName').textContent=currentUser.name;
  $('#profRole').textContent=currentUser.role==='teacher'?'Учитель':'Ученик';

  var curTheme=document.documentElement.getAttribute('data-theme');
  $$('.theme-option').forEach(function(b){
    b.classList.toggle('active',b.dataset.themeSet===curTheme);
  });

  $('#tgStatus').textContent='Проверка…';
  $('#tgActions').innerHTML='';
  try{
    var r=await api('/telegram/link');
    if(r.linked){
      $('#tgStatus').innerHTML='<span class="tg-ok">✅ Подключён</span>';
      var unlink=document.createElement('button');
      unlink.className='ghost small danger';
      unlink.textContent='Отключить Telegram';
      unlink.onclick=async function(){
        try{await api('/telegram/unlink',{method:'POST'});
          toast('Telegram отключён','info');openProfile();}
        catch(e){toast(e.message,'err');}
      };
      $('#tgActions').appendChild(unlink);
    }else{
      $('#tgStatus').innerHTML='<span class="tg-no">Не подключён. Получайте уведомления о новых работах и сдачах прямо в Telegram.</span>';
      var a=document.createElement('a');
      a.className='tg-link';a.href=r.link;a.target='_blank';
      a.innerHTML='✈️ Подключить Telegram';
      $('#tgActions').appendChild(a);
      var hint=document.createElement('div');
      hint.className='muted';hint.style.marginTop='8px';
      hint.textContent='После перехода нажмите Start в боте — аккаунт привяжется автоматически.';
      $('#tgActions').appendChild(hint);
    }
  }catch(e){
    $('#tgStatus').innerHTML='<span class="tg-no">Не удалось: '+esc(e.message)+'</span>';
  }
}

/* ============ УЧИТЕЛЬ ============ */
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
      list.innerHTML='<div class="card"><div class="empty"><span class="icon">📚</span>У вас ещё нет классов.<br>Нажмите <b>«+ Класс»</b> — и получите код для учеников.</div></div>';
      return;
    }
    r.classes.forEach(function(c){
      var el=document.createElement('div');el.className='class-card';
      el.innerHTML='<div style="flex:1;min-width:180px"><h4>'+esc(c.name)+'</h4>'+
        '<div class="muted" style="margin-top:2px">Учеников: '+c.studentCount+' · Групп: '+(c.groups||[]).length+'</div></div>'+
        '<div class="code-box" title="Клик — копировать">'+c.code+'</div>';
      var bV=document.createElement('button');bV.className='small';bV.textContent='Открыть';
      bV.onclick=function(){openClassView(c.id);};
      var bD=document.createElement('button');bD.className='ghost small danger';bD.textContent='Удалить';
      bD.onclick=async function(){
        if(!confirm('Удалить класс «'+c.name+'»?'))return;
        try{await api('/classes/'+c.id,{method:'DELETE'});
          toast('Класс удалён','ok');goTeacher();}
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
      host.innerHTML='<div class="card"><div class="empty"><span class="icon">📝</span>Работ пока нет.<br>Нажмите <b>«+ Работа»</b>, чтобы создать первую.</div></div>';
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
      actions.appendChild(bE);actions.appendChild(bR);
      actions.appendChild(bC);actions.appendChild(bD);
      el.appendChild(actions);host.appendChild(el);
    });
  }catch(e){host.innerHTML='<div class="card err">'+esc(e.message)+'</div>';}
}

/* ============ ПРОСМОТР КЛАССА ============ */
async function openClassView(id){
  currentClassId=id;show('view-class');
  skeleton($('#classStudents'),2);
  skeleton($('#classGroups'),2);
  skeleton($('#classTests'),2);
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
      catch(e){toast('Не удалось скопировать','err');}
    };

    var stu=$('#classStudents');stu.innerHTML='';
    $('#classStuCount').textContent=r.students.length;
    if(!r.students.length){
      stu.innerHTML='<div class="empty"><span class="icon">👥</span>Пока нет учеников.<br>Отправьте им код: <b>'+esc(r.class.code)+'</b></div>';
    }
    r.students.forEach(function(u){
      var el=document.createElement('div');el.className='stu-row';
      var groupsHtml=(u.groupIds||[]).map(function(gid){
        var g=(r.class.groups||[]).find(function(x){return x.id===gid;});
        return g?'<span class="pill blue">'+esc(g.name)+'</span>':'';
      }).join('');
      var tgBadge=u.hasTelegram?' <span class="pill green" title="Telegram подключён">✈️</span>':'';
      el.innerHTML='<div class="avatar">'+esc((u.name[0]||'?').toUpperCase())+'</div>'+
        '<div class="name"><div>'+esc(u.name)+' '+groupsHtml+tgBadge+'</div>'+
        '<div class="muted">'+esc(u.email)+'</div></div>';
      var b=document.createElement('button');b.className='ghost small danger';b.textContent='Исключить';
      b.onclick=async function(){
        if(!confirm('Исключить '+u.name+'?'))return;
        try{await api('/classes/'+id+'/students/'+u.id,{method:'DELETE'});
          openClassView(id);}catch(e){toast(e.message,'err');}
      };
      el.appendChild(b);stu.appendChild(el);
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
      var notIn=r.students.filter(function(u){return !(g.studentIds||[]).includes(u.id);});
      if(notIn.length){
        var sel=document.createElement('select');
        sel.style.width='auto';sel.style.padding='4px 8px';
        sel.innerHTML='<option value="">+ добавить...</option>'+
          notIn.map(function(u){return '<option value="'+u.id+'">'+esc(u.name)+'</option>';}).join('');
        sel.onchange=async function(){
          if(!sel.value)return;
          try{await api('/classes/'+id+'/groups/'+g.id+'/students/'+sel.value,{method:'POST'});
            openClassView(id);}catch(e){toast(e.message,'err');}
        };
        chips.appendChild(sel);
      }
      el.appendChild(chips);
      var del=document.createElement('button');del.className='ghost small danger';
      del.textContent='Удалить группу';del.style.marginTop='8px';
      del.onclick=async function(){
        if(!confirm('Удалить группу «'+g.name+'»?'))return;
        try{await api('/classes/'+id+'/groups/'+g.id,{method:'DELETE'});
          openClassView(id);}catch(e){toast(e.message,'err');}
      };
      el.appendChild(del);
      gr.appendChild(el);
    });

    var oldB=$('#btnBroadcast');if(oldB)oldB.remove();
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
        if(res.withoutTelegram){
          text+='\nБез Telegram: '+res.withoutTelegram+
            ' ('+res.withoutTelegramNames.slice(0,3).join(', ')+
            (res.withoutTelegramNames.length>3?'…':'')+')';
        }
        toast(text,'ok');
      }catch(e){toast(e.message,'err');}
    };
    var tgCard=$('#classGroups').parentNode;
    tgCard.appendChild(bb);

    var ts=$('#classTests');ts.innerHTML='';
    if(!r.tests.length)ts.innerHTML='<div class="empty">Этому классу ещё не назначено работ.</div>';
    r.tests.forEach(function(t){
      var el=document.createElement('div');el.className='test-card';
      var groupsInfo=t.groupIds&&t.groupIds.length
        ? ' · группы: '+t.groupIds.map(function(gid){
            var g=(r.class.groups||[]).find(function(x){return x.id===gid;});
            return g?esc(g.name):'?';
          }).join(', ')
        : '';
      el.innerHTML='<div class="row tight"><h4 style="flex:1;margin:0">'+esc(t.title)+'</h4>'+
        (t.unseen?'<span class="badge red">'+t.unseen+'</span>':'')+'</div>'+
        '<div class="meta">Сдали: '+t.submitted+' из '+t.total+groupsInfo+'</div>';
      var b=document.createElement('button');b.className='primary small';b.textContent='Открыть';
      b.onclick=async function(){
        try{var rr=await api('/tests');
          var full=rr.tests.find(function(x){return x.id===t.id;});
          if(full)showSubmissions(full);}catch(e){toast(e.message,'err');}
      };
      el.appendChild(b);ts.appendChild(el);
    });
  }catch(e){toast(e.message,'err');}
}

/* ============ РЕДАКТОР ============ */
function initEditorFields(){
  if(stmtInput)return;
  var sh=$('#statementHost'),ah=$('#answerHost');
  if(!sh||!ah)return;
  stmtInput=createMathInput('',false);
  ansInput=createMathInput('',false);
  sh.appendChild(stmtInput.el);
  ah.appendChild(ansInput.el);
  buildSymbolBar($('#symbolBar'));
  addOption();addOption();

  var tt=$('#taskType');
  if(tt)tt.onchange=function(){
    var i=tt.value==='input';
    $('#inputBlock').hidden=!i;$('#choiceBlock').hidden=i;
  };
  var bao=$('#btnAddOption');
  if(bao)bao.onclick=function(){addOption();};
  var bat=$('#btnAddTask');
  if(bat)bat.onclick=addTask;
  var bst=$('#btnSaveTest');
  if(bst)bst.onclick=saveTest;
  var bng=$('#btnNewGroup');
  if(bng)bng.onclick=async function(){
    var name=prompt('Название группы (например: Подгруппа А)');
    if(!name||!name.trim())return;
    try{await api('/classes/'+currentClassId+'/groups',{method:'POST',body:{name:name.trim()}});
      toast('Группа создана','ok');openClassView(currentClassId);}
    catch(e){toast(e.message,'err');}
  };
  var bjc=$('#btnJoinClass');
  if(bjc)bjc.onclick=joinClass;
  var bst2=$('#btnSubmitTest');
  if(bst2)bst2.onclick=function(){
    if(!confirm('Завершить работу и отправить учителю?'))return;
    submitTest();
  };
  var bec=$('#btnExportCsv');
  if(bec)bec.onclick=exportCsv;
  var bsa=$('#btnShowAnalytics');
  if(bsa)bsa.onclick=showAnalytics;
  var bra=$('#btnReadAll');
  if(bra)bra.onclick=async function(){
    try{await api('/notifications/read-all',{method:'POST'});
      loadNotifications();refreshNotifBadge();toast('Все прочитаны','ok');}
    catch(e){toast(e.message,'err');}
  };
}

function addOption(){
  var ol=$('#optionsList');if(!ol)return;
  var row=document.createElement('div');row.className='option-row';
  var r=document.createElement('input');r.type='radio';r.name='correctOpt';
  var mi=createMathInput('',false);
  var d=document.createElement('button');d.type='button';
  d.className='ghost small';d.textContent='✕';
  d.onclick=function(){row.remove();};
  row.appendChild(r);row.appendChild(mi.el);row.appendChild(d);
  ol.appendChild(row);
}

async function renderClassPicker(){
  var host=$('#classPicker');if(!host)return;
  host.innerHTML='';
  try{
    var r=await api('/classes');
    if(!r.classes.length){
      host.innerHTML='<div class="muted">У вас нет классов. Создайте класс и назначьте работу ему.</div>';
      return;
    }
    r.classes.forEach(function(c){
      var lab=document.createElement('label');lab.className='class-pick';
      var cb=document.createElement('input');cb.type='checkbox';
      cb.checked=draftClassIds.indexOf(c.id)>=0;
      cb.onchange=function(){
        if(cb.checked){if(draftClassIds.indexOf(c.id)<0)draftClassIds.push(c.id);}
        else {draftClassIds=draftClassIds.filter(function(x){return x!==c.id;});}
        renderGroupPicker();
      };
      var s=document.createElement('span');
      s.innerHTML='<b>'+esc(c.name)+'</b> <span class="muted">('+c.studentCount+' учеников)</span>';
      lab.appendChild(cb);lab.appendChild(s);
      host.appendChild(lab);
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
      block.style.flexDirection='column';
      block.style.alignItems='stretch';
      block.style.background='rgba(91,141,255,.05)';
      var inner='<div style="margin-bottom:8px;font-weight:600;font-size:13px">'+esc(c.name)+' → только для групп:</div>';
      c.groups.forEach(function(g){
        var checked=draftGroupIds.indexOf(g.id)>=0?'checked':'';
        inner+='<label style="display:flex;align-items:center;gap:8px;padding:5px 0;margin:0;color:var(--text);font-size:13px">'+
          '<input type="checkbox" data-gid="'+g.id+'" '+checked+
          ' style="width:16px;height:16px;margin:0;accent-color:var(--accent)">'+
          '<span>'+esc(g.name)+' <span class="muted">('+g.count+')</span></span></label>';
      });
      inner+='<div class="muted" style="margin-top:4px;font-size:11.5px">Если ни одна группа не отмечена — работа видна всем</div>';
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
  host.innerHTML='';
  $('#taskCount').textContent=draftTasks.length;
  if(!draftTasks.length){
    host.innerHTML='<div class="empty">Заданий нет. Создайте первое слева.</div>';
    return;
  }
  draftTasks.forEach(function(t,i){
    var d=document.createElement('div');
    d.style.cssText='background:var(--bg-soft);border:1px solid var(--line-soft);border-radius:10px;padding:12px;margin-bottom:8px';
    var h=document.createElement('div');h.className='task-head';
    h.innerHTML='<span class="badge">'+(i+1)+'</span>'+
      '<span class="pill">'+(t.type==='input'?'ввод':'выбор')+'</span>'+
      '<span class="pill">'+t.points+' б.</span>';
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
  if(!statement){toast('Введите условие задания','warn');return;}
  var points=Math.max(1,Number($('#taskPoints').value)||1);
  var task={id:uid(),type:type,statement:statement,points:points};
  if(type==='input'){
    var a=ansInput.getValue().trim();
    if(!a){toast('Введите правильный ответ','warn');return;}
    task.answer=a;task.tolerance=parseFloat($('#taskTol').value)||1e-6;
  }else{
    var rows=$$('#optionsList .option-row');
    if(rows.length<2){toast('Нужно минимум 2 варианта','warn');return;}
    task.options=rows.map(function(r){return{text:r.querySelector('.mi-input').value};});
    task.correctIndex=rows.findIndex(function(r){
      return r.querySelector('input[type=radio]').checked;
    });
    if(task.correctIndex<0){toast('Отметьте правильный вариант','warn');return;}
  }
  draftTasks.push(task);
  stmtInput.setValue('');ansInput.setValue('');
  $('#optionsList').innerHTML='';addOption();addOption();
  renderDraft();toast('Задание добавлено','ok');
}

async function saveTest(){
  var title=$('#testTitle').value.trim()||'Без названия';
  if(!draftTasks.length){toast('Добавьте хотя бы одно задание','warn');return;}
  var settings={
    timeLimit:Math.max(0,parseInt($('#setTimeLimit').value)||0),
    attempts:Math.max(0,parseInt($('#setAttempts').value)||0),
    showAnswers:$('#setShowAnswers').checked
  };
  try{
    if(editingTestId){
      await api('/tests/'+editingTestId,{method:'PUT',body:{
        title:title,tasks:draftTasks,
        classIds:draftClassIds,groupIds:draftGroupIds,settings:settings}});
      toast('Работа обновлена','ok');
    }else{
      await api('/tests',{method:'POST',body:{
        title:title,tasks:draftTasks,
        classIds:draftClassIds,groupIds:draftGroupIds,settings:settings}});
      toast('Работа создана','ok');
    }
    goTeacher();
  }catch(e){toast(e.message,'err');}
}

/* ============ УЧЕНИК ============ */
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
      host.innerHTML='<div class="card" style="grid-column:1/-1"><div class="empty"><span class="icon">📖</span>Доступных работ пока нет.<br>Перейдите на вкладку <b>«Мои классы»</b> и присоединитесь по коду от учителя.</div></div>';
      return;
    }
    r.tests.forEach(function(test){
      var max=test.tasks.reduce(function(s,t){return s+(t.points||1);},0);
      var s=test.settings||{};
      var attemptsUsed=test.attemptsUsed||0;
      var canTry=!(s.attempts>0&&attemptsUsed>=s.attempts);
      var draft=loadDraft(test.id);

      var card=document.createElement('div');card.className='card';card.style.marginBottom='0';
      card.innerHTML='<h3 style="margin-bottom:8px">'+esc(test.title)+'</h3>'+
        '<div style="margin-bottom:12px">'+
          '<span class="pill">'+test.tasks.length+' заданий</span> '+
          '<span class="pill">макс. '+max+' б.</span>'+
          (s.timeLimit>0?' <span class="pill warn">⏱ '+s.timeLimit+' мин</span>':'')+
          (s.attempts>0?' <span class="pill">попыток: '+attemptsUsed+' / '+s.attempts+'</span>':'')+
          (draft?' <span class="pill green">💾 есть черновик</span>':'')+
        '</div>'+
        (test.mySubmission?
          '<div class="ok" style="margin-bottom:12px;font-weight:500">Последний результат: '+
          test.mySubmission.score+' / '+test.mySubmission.max+
          ' <span class="muted">· '+fmt(test.mySubmission.at)+'</span></div>':'');
      var b=document.createElement('button');b.className='primary';b.style.width='100%';
      if(!canTry){b.disabled=true;b.textContent='Попытки исчерпаны';}
      else{b.textContent=test.mySubmission?'Пройти заново':'Начать →';
        b.onclick=function(){openTest(test);};}
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
    if(!r.classes.length){
      host.innerHTML='<div class="empty">Пока вы не в классе. Введите код выше.</div>';
      return;
    }
    r.classes.forEach(function(c){
      var groupsHtml=(c.groups||[]).length
        ?' <span class="muted">· группы: '+
          c.groups.map(function(g){return esc(g.name);}).join(', ')+'</span>':'';
      var el=document.createElement('div');el.className='stu-row';
      el.innerHTML='<div class="avatar">'+esc((c.name[0]||'?').toUpperCase())+'</div>'+
        '<div class="name"><div>'+esc(c.name)+'</div>'+
        '<div class="muted">Учитель: '+esc(c.teacherName)+groupsHtml+'</div></div>';
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
    $('#joinCode').value='';
    toast('Вы присоединились к классу','ok');
    renderStudentClasses();renderStudentTests();
  }catch(e){if(je)je.textContent=e.message;toast(e.message,'err');}
}

/* ============ ЧЕРНОВИКИ ============ */
function draftKey(testId){return 'mathtest_draft_'+currentUser.id+'_'+testId;}
function saveDraft(testId,data){
  try{localStorage.setItem(draftKey(testId),JSON.stringify(data));}catch(e){}
}
function loadDraft(testId){
  try{
    var raw=localStorage.getItem(draftKey(testId));
    return raw?JSON.parse(raw):null;
  }catch(e){return null;}
}
function clearDraft(testId){
  try{localStorage.removeItem(draftKey(testId));}catch(e){}
}
function scheduleDraftSave(){
  if(!currentTest)return;
  clearTimeout(draftTimer);
  draftTimer=setTimeout(function(){
    var answers=currentTest.tasks.map(function(t,i){
      if(t.type==='input'){
        var mi=answerInputs[i];
        return mi?mi.getValue():'';
      }
      return choicePicks[i]===undefined?null:choicePicks[i];
    });
    saveDraft(currentTest.id,{answers:answers,at:Date.now()});
  },600);
}

/* ============ ПРОХОЖДЕНИЕ ============ */
function updateProgress(){
  if(!currentTest)return;
  var total=currentTest.tasks.length,done=0;
  currentTest.tasks.forEach(function(t,i){
    if(t.type==='input'){
      var mi=answerInputs[i];
      if(mi&&mi.getValue().trim())done++;
    }else{
      if(choicePicks[i]!==undefined)done++;
    }
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
    toast('Время вышло! Работа сдаётся автоматически','warn');
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
  if(draft){
    if(dh){dh.hidden=false;dh.textContent='💾 Найден черновик от '+fmt(draft.at)+' — ваши ответы восстановлены';}
  } else {
    if(dh)dh.hidden=true;
  }

  test.tasks.forEach(function(task,i){
    var card=document.createElement('div');card.className='card';
    var h=document.createElement('div');h.className='task-head';
    h.innerHTML='<span class="badge">'+(i+1)+'</span>'+
      '<span class="pill">'+(task.points||1)+' б.</span>';
    card.appendChild(h);
    var s=createMathInput(task.statement,true);card.appendChild(s.el);
    if(task.type==='input'){
      var initial=draft&&draft.answers&&typeof draft.answers[i]==='string'
        ?draft.answers[i]:'';
      var mi=createMathInput(initial,false,function(){
        updateProgress();scheduleDraftSave();
      });
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
        var ob=createMathInput(opt.text,true);
        ob.el.style.flex='1';ob.el.style.margin='0';
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
    updateTimer();
    timerInterval=setInterval(updateTimer,1000);
  }else{
    if(timer)timer.hidden=true;testDeadline=null;
    if(timerInterval){clearInterval(timerInterval);timerInterval=null;}
  }

  show('view-take');
  setTimeout(updateProgress,100);
}

async function submitTest(){
  if(!currentTest)return;
  if(timerInterval){clearInterval(timerInterval);timerInterval=null;}
  var answers=currentTest.tasks.map(function(t,i){
    if(t.type==='input'){
      var mi=answerInputs[i];
      return {text:mi?mi.getValue():''};
    }
    return {index:choicePicks[i]===undefined?-1:choicePicks[i]};
  });
  var started=parseInt(sessionStorage.getItem('test_start_'+currentTest.id))||Date.now();
  try{
    var r=await api('/tests/'+currentTest.id+'/submit',{method:'POST',body:{
      answers:answers,startedAt:started}});
    clearDraft(currentTest.id);
    sessionStorage.removeItem('test_start_'+currentTest.id);
    $('#progressBar').hidden=true;
    $('#draftHint').hidden=true;
    if(r.expired)toast('Работа сдана после истечения времени','warn');
    showResult(currentTest,r);
  }catch(e){toast(e.message,'err');}
}

/* ============ РЕЗУЛЬТАТ ============ */
function showResult(test,r){
  var card=$('#resultCard');
  var score=r.score,max=r.max;
  var pct=max?Math.round(score/max*100):0;
  var gradeClass=pct>=80?'':(pct>=60?'mid':'bad');
  var gradeText=pct>=80?'Отличный результат!':(pct>=60?'Хороший результат':'Стоит повторить');

  card.innerHTML='<h2 style="margin-bottom:20px">'+esc(test.title)+'</h2>'+
    '<div style="display:flex;align-items:center;gap:24px;flex-wrap:wrap;margin-bottom:20px">'+
      '<div class="score-circle" data-grade="'+gradeClass+'" style="--pct:'+pct+'">'+
        '<div class="val">'+score+' / '+max+'</div><div class="lbl">'+pct+'%</div></div>'+
      '<div style="flex:1;min-width:200px">'+
        '<div style="font-size:18px;font-weight:600;margin-bottom:6px">'+gradeText+'</div>'+
        '<div class="muted">Работа отправлена учителю.'+
          (r.durationMs?' <br>Время: '+fmtDur(r.durationMs):'')+
          (r.attempt?' <br>Попытка №'+r.attempt:'')+
        '</div></div>'+
    '</div>';

  test.tasks.forEach(function(task,i){
    var res=r.results[i]||{ok:false};
    var line=document.createElement('div');
    line.className='result-line '+(res.ok?'ok':'err');
    var s=createMathInput(task.statement,true);
    s.el.style.marginBottom='6px';line.appendChild(s.el);
    var info=document.createElement('div');info.style.fontSize='13.5px';
    info.innerHTML=res.ok
      ?'<span class="ok" style="font-weight:600">✓ Верно</span> <span class="muted">· '+(task.points||1)+' б.</span>'
      :'<span class="err" style="font-weight:600">✗ Неверно</span> <span class="muted">· 0 из '+(task.points||1)+' б.</span>';
    line.appendChild(info);
    if(!res.ok&&res.correctAnswer){
      var a=document.createElement('div');a.style.marginTop='10px';
      a.innerHTML='<div class="muted" style="margin-bottom:4px">Правильный ответ:</div>';
      var mf=createMathInput(res.correctAnswer,true);
      a.appendChild(mf.el);line.appendChild(a);
    }
    if(!res.ok&&!res.correctAnswer&&r.settings&&!r.settings.showAnswers){
      var n=document.createElement('div');n.className='muted';n.style.marginTop='6px';
      n.textContent='(Правильный ответ скрыт учителем)';line.appendChild(n);
    }
    if(task.type==='choice'&&res.correctIndex!==undefined){
      var a2=document.createElement('div');a2.style.marginTop='10px';
      a2.innerHTML='<div class="muted" style="margin-bottom:4px">Правильный вариант:</div>';
      var mf2=createMathInput(task.options[res.correctIndex].text,true);
      a2.appendChild(mf2.el);line.appendChild(a2);
    }
    card.appendChild(line);
  });
  show('view-result');
}

/* ============ РЕЗУЛЬТАТЫ УЧИТЕЛЯ ============ */
async function showSubmissions(test){
  currentSubmissionTest=test;
  $('#subsTitle').textContent='Результаты: '+test.title;
  var body=$('#subsBody');skeleton(body,4);
  show('view-submissions');
  try{
    var r=await api('/tests/'+test.id+'/submissions');
    body.innerHTML='';
    if(!r.groups.length){
      body.innerHTML='<div class="card"><div class="empty">Работа не назначена ни одному классу.</div></div>';
      return;
    }
    r.groups.forEach(function(g){
      var card=document.createElement('div');card.className='card';
      var total=g.submitted.length+g.notSubmitted.length;
      var avg=g.submitted.length
        ?Math.round(g.submitted.reduce(function(s,x){
          return s+(x.max?x.score/x.max:0);},0)/g.submitted.length*100):0;
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
            '</div><div class="muted">'+fmt(s.at)+(s.durationMs?' · '+fmtDur(s.durationMs):'')+
              (s.expired?' <span class="pill red" style="font-size:10.5px">просрочено</span>':'')+
            '</div></div>'+
            '<div class="score '+(pct>=60?'ok':'err')+'">'+s.score+' / '+s.max+' ('+pct+'%)</div>';
          var b=document.createElement('button');b.className='ghost small';b.textContent='Работа';
          b.onclick=function(){openSubmissionDetail(s.id,test.id);};
          el.appendChild(b);card.appendChild(el);
        });
      }
      if(g.notSubmitted.length){
        var h2=document.createElement('h4');h2.className='sec';
        h2.textContent='Не сдали ('+g.notSubmitted.length+')';card.appendChild(h2);
        g.notSubmitted.forEach(function(u){
          var el=document.createElement('div');el.className='stu-row';el.style.opacity='.7';
          el.innerHTML='<div class="avatar" style="background:#3a465c">'+
            esc((u.name[0]||'?').toUpperCase())+'</div>'+
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
    var url='/api/tests/'+currentSubmissionTest.id+'/export.csv';
    var res=await fetch(url,{headers:{Authorization:'Bearer '+tk}});
    if(!res.ok)throw new Error('Не удалось скачать');
    var blob=await res.blob();
    var a=document.createElement('a');
    a.href=URL.createObjectURL(blob);
    a.download='results.csv';
    document.body.appendChild(a);a.click();a.remove();
    toast('CSV скачан','ok');
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
      '<div class="muted" style="margin-bottom:14px">Процент учеников, справившихся с каждым заданием.</div>';
    if(!r.analytics||!r.analytics.length){
      card.innerHTML+='<div class="empty">Нет данных</div>';
    }
    r.analytics.forEach(function(a){
      var color=a.pct>=75?'var(--ok)':(a.pct>=40?'var(--warn)':'var(--err)');
      var row=document.createElement('div');row.className='analytics-row';
      row.innerHTML='<div class="num">'+a.index+'</div>'+
        '<div class="body">'+
          '<div style="font-size:13.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+
            esc(a.statement.replace(/[#*_`~]/g,'').slice(0,70))+
          '</div>'+
          '<div class="bar-track"><div class="bar-fill" style="width:'+a.pct+
            '%;background:'+color+'"></div></div>'+
        '</div>'+
        '<div class="pct" style="color:'+color+'">'+a.pct+'%</div>'+
        '<div class="muted" style="font-size:11.5px;min-width:60px;text-align:right">'+
          a.correct+' / '+a.total+'</div>';
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
    var gradeClass=pct>=80?'':(pct>=60?'mid':'bad');
    card.innerHTML='<div style="display:flex;align-items:center;gap:24px;flex-wrap:wrap;margin-bottom:20px">'+
      '<div class="score-circle" data-grade="'+gradeClass+'" style="--pct:'+pct+'">'+
        '<div class="val">'+r.submission.score+' / '+r.submission.max+'</div>'+
        '<div class="lbl">'+pct+'%</div></div>'+
      '<div class="muted" style="flex:1">'+fmt(r.submission.at)+
        (r.submission.durationMs?'<br>Время: '+fmtDur(r.submission.durationMs):'')+
        (r.submission.attempt?'<br>Попытка №'+r.submission.attempt:'')+'</div></div>';
    r.test.tasks.forEach(function(task,i){
      var res=r.submission.results[i]||{ok:false,studentText:''};
      var line=document.createElement('div');
      line.className='result-line '+(res.ok?'ok':'err');
      var s=createMathInput(task.statement,true);
      s.el.style.marginBottom='6px';line.appendChild(s.el);
      var info=document.createElement('div');
      info.innerHTML=res.ok
        ?'<span class="ok" style="font-weight:600">✓ Верно</span> <span class="muted">· '+(task.points||1)+' б.</span>'
        :'<span class="err" style="font-weight:600">✗ Неверно</span> <span class="muted">· '+(task.points||1)+' б.</span>';
      line.appendChild(info);
      if(task.type==='input'){
        var st=document.createElement('div');st.style.marginTop='10px';
        st.innerHTML='<div class="muted" style="margin-bottom:4px">Ответ ученика:</div>';
        var mf=createMathInput(res.studentText||'(пусто)',true);
        st.appendChild(mf.el);line.appendChild(st);
        if(!res.ok){
          var c=document.createElement('div');c.style.marginTop='10px';
          c.innerHTML='<div class="muted" style="margin-bottom:4px">Правильный ответ:</div>';
          var mfc=createMathInput(task.answer,true);
          c.appendChild(mfc.el);line.appendChild(c);
        }
      }else if(!res.ok){
        var c2=document.createElement('div');c2.style.marginTop='10px';
        c2.innerHTML='<div class="muted" style="margin-bottom:4px">Правильный вариант:</div>';
        var mf2=createMathInput(task.options[task.correctIndex].text,true);
        c2.appendChild(mf2.el);line.appendChild(c2);
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

/* ============ СТАРТ ============ */
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

function enterApp(u){
  currentUser=u;renderTop();
  refreshNotifBadge();
  if(notifTimer)clearInterval(notifTimer);
  notifTimer=setInterval(refreshNotifBadge,30000);
  if(u.role==='teacher')goTeacher();else goStudent();
}

async function boot(){
  initEditorFields();

  // Обработчики шапки
  var bt=$('#btnTheme');
  if(bt)bt.onclick=function(){
    var cur=document.documentElement.getAttribute('data-theme');
    applyTheme(cur==='dark'?'light':'dark');
  };
  var bn=$('#btnNotif');
  if(bn)bn.onclick=function(e){
    e.stopPropagation();
    notifOpen=!notifOpen;
    var p=$('#notifPanel');if(p)p.hidden=!notifOpen;
    if(notifOpen)loadNotifications();
  };
  var bprof=$('#btnProfile');
  if(bprof)bprof.onclick=openProfile;

  // Закрытие панели уведомлений по клику снаружи
  document.addEventListener('click',function(e){
    if(!notifOpen)return;
    if(e.target.closest('#notifPanel')||e.target.closest('#btnNotif'))return;
    closeNotifPanel();
  });

  // Профиль — модалка
  var bcp=$('#btnCloseProfile');
  if(bcp)bcp.onclick=function(){$('#profileModal').hidden=true;};
  var pm=$('#profileModal');
  if(pm)pm.addEventListener('click',function(e){
    if(e.target.id==='profileModal')$('#profileModal').hidden=true;
  });
  $$('.theme-option').forEach(function(b){
    b.onclick=function(){
      applyTheme(b.dataset.themeSet);
      $$('.theme-option').forEach(function(x){x.classList.toggle('active',x===b);});
    };
  });

  // Показать пароль
  $$('.pass-toggle').forEach(function(btn){
    btn.onclick=function(){
      var inp=$('#'+btn.dataset.target);if(!inp)return;
      var isPass=inp.type==='password';
      inp.type=isPass?'text':'password';
      btn.textContent=isPass?'🙈':'👁';
    };
  });

  // Enter на формах
  ['loginEmail','loginPass'].forEach(function(id){
    var el=$('#'+id);
    if(el)el.addEventListener('keydown',function(e){if(e.key==='Enter')$('#doLogin').click();});
  });
  ['regName','regEmail','regPass'].forEach(function(id){
    var el=$('#'+id);
    if(el)el.addEventListener('keydown',function(e){if(e.key==='Enter')$('#doRegister').click();});
  });
  var jc=$('#joinCode');
  if(jc)jc.addEventListener('keydown',function(e){if(e.key==='Enter')$('#btnJoinClass').click();});

  // Табы
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
      currentSymTab=t.dataset.symtab;
      buildSymbolBar($('#symbolBar'));
    };
  });

  // Кнопки авторизации
  $('#doLogin').onclick=async function(){
    var ae=$('#authErr');if(ae)ae.textContent='';
    try{
      var r=await api('/auth/login',{method:'POST',body:{
        email:$('#loginEmail').value.trim(),
        password:$('#loginPass').value}});
      setToken(r.token);enterApp(r.user);toast('Добро пожаловать!','ok');
    }catch(e){if(ae)ae.textContent=e.message;toast(e.message,'err');}
  };
  $('#doRegister').onclick=async function(){
    var ae=$('#authErr');if(ae)ae.textContent='';
    try{
      var r=await api('/auth/register',{method:'POST',body:{
        name:$('#regName').value.trim(),
        email:$('#regEmail').value.trim(),
        password:$('#regPass').value,
        role:$('#regRole').value}});
      setToken(r.token);enterApp(r.user);toast('Аккаунт создан','ok');
    }catch(e){if(ae)ae.textContent=e.message;toast(e.message,'err');}
  };

  // Кнопки учителя
  var bnt=$('#btnNewTest');if(bnt)bnt.onclick=function(){openEditor(null);};
  var bnc=$('#btnNewClass');if(bnc)bnc.onclick=async function(){
    var name=prompt('Название класса (например: Математика 101)');
    if(!name||!name.trim())return;
    try{await api('/classes',{method:'POST',body:{name:name.trim()}});
      toast('Класс создан','ok');goTeacher();}
    catch(e){toast(e.message,'err');}
  };
  var bbt=$('#btnBackToTeacher');if(bbt)bbt.onclick=goTeacher;
  var bbfc=$('#btnBackFromClass');if(bbfc)bbfc.onclick=goTeacher;
  var bbft=$('#btnBackFromTake');if(bbft)bbft.onclick=function(){
    if(confirm('Выйти? Черновик сохранён — можно продолжить позже.')){
      if(timerInterval){clearInterval(timerInterval);timerInterval=null;}
      goStudent();
    }
  };
  var bbfs=$('#btnBackFromSubs');if(bbfs)bbfs.onclick=goTeacher;
  var brb=$('#btnResultBack');if(brb)brb.onclick=goStudent;

  // Наверх
  var tt=$('#toTop');
  window.addEventListener('scroll',function(){
    if(tt)tt.classList.toggle('show',window.scrollY>300);
  });
  if(tt)tt.onclick=function(){window.scrollTo({top:0,behavior:'smooth'});};

  // Показываем экран входа до проверки токена
  renderTop();

  if(getToken()){
    try{
      var r=await api('/auth/me');
      enterApp(r.user);
      if(r.user.role==='student')await tryAutoJoin();
      return;
    }catch(e){
      setToken(null);
    }
  }
  show('view-auth');
  setTimeout(function(){var el=$('#loginEmail');if(el)el.focus();},150);
}

document.addEventListener('DOMContentLoaded',boot);
})();
