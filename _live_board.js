// ═══════════════════════════════════════════════════════════════════════
//  מצב לייב — לוח תוצאות "יורוויזיון" בזמן אמת + הזנת נקודות מהירה
//  מודול עצמאי: מתחבר ישירות ל-Firebase (window.__db) ולא תלוי ב-runtime של האפליקציה.
// ═══════════════════════════════════════════════════════════════════════
(function(){
  if (window.__liveBoardInit) return;
  window.__liveBoardInit = true;

  var GROUP_COLORS = ['#7C6BF0','#0FB5A5','#F0913B','#EC6A9C','#4FA8F5','#9B7BF0','#E0C341'];
  var db = null, latest = null, open = false, controlsOn = true;
  var rowEls = {};          // groupIndex -> row element
  var prevRects = {};       // groupIndex -> DOMRect (for FLIP)
  var shownScore = {};      // groupIndex -> currently displayed (animating) score
  var prevRank = {};        // groupIndex -> previous rank
  var undoStack = [];       // { i, prevBonus }
  var selected = 0;

  // ── חישוב ניקוד — משוכפל במדויק מ-calc() של האפליקציה ──
  function num(x){ var v = Number(x); return isNaN(v) ? 0 : v; }
  function tier(v){ v = num(v); return v>=20000?80 : v>=5000?40 : v>0?20 : 0; }
  function scoreOf(g){
    if(!g) return { final:0, auto:0, judge:0, votes:0 };
    var reviews = g.reviews||{}, leads = g.leads||{}, rec = g.rec||{};
    var revApproved = Math.max(0, num(reviews.withDetail) - num(reviews.rejected));
    var reviewsPts = revApproved*10;
    var leadsClosed = Math.max(0, num(leads.closed) - num(leads.rejected));
    var leadsPts = leadsClosed*10;
    var recApproved = Math.max(0, num(rec.count) - num(rec.rejected));
    var recPts = recApproved*15;
    var resonancePts = (g.resonance||[]).reduce(function(a,v){ return a + tier(v&&v.views); }, 0);
    var salesPts = (g.sales||[]).reduce(function(a,c){ return a + num(c&&c.tier); }, 0);
    var opsPts = (g.ops||[]).reduce(function(a,c){ return a + num(c&&c.score); }, 0);
    var flagPts = num(g.flagship && g.flagship.score);
    var auto = reviewsPts+leadsPts+recPts+resonancePts;
    var judge = salesPts+opsPts+flagPts+num(g.bonus);
    return { final: auto+judge, auto: auto, judge: judge, votes: num(g.votes) };
  }
  function fmt(x){ return Math.round(x).toLocaleString('en-US'); }

  // ── סגנונות עזר ──
  function css(el, s){ for(var k in s) el.style[k] = s[k]; return el; }
  function make(tag, s, txt){ var el = document.createElement(tag); if(s) css(el, s); if(txt!=null) el.textContent = txt; return el; }

  // ════════════════════ בניית ה-DOM ════════════════════
  var launchBtn, overlay, rowsWrap, controlBar, groupBtns = [], amountInput;

  function buildLaunchButton(){
    launchBtn = make('button', {
      position:'fixed', insetInlineStart:'20px', bottom:'20px', zIndex:'90000',
      display:'inline-flex', alignItems:'center', gap:'9px',
      background:'linear-gradient(135deg,#E23B54,#B4243A)', color:'#fff',
      border:'none', borderRadius:'999px', padding:'12px 20px',
      fontFamily:"'Rubik','Assistant',sans-serif", fontWeight:'800', fontSize:'15px',
      cursor:'pointer', boxShadow:'0 12px 28px -10px rgba(226,59,84,.75)',
      direction:'rtl'
    });
    launchBtn.innerHTML = '<span style="width:11px;height:11px;border-radius:50%;background:#fff;box-shadow:0 0 0 0 rgba(255,255,255,.7);animation:lbPulse 1.6s infinite;"></span> מצב לייב';
    launchBtn.onclick = openBoard;
    document.body.appendChild(launchBtn);

    var st = make('style'); st.textContent =
      '@keyframes lbPulse{0%{box-shadow:0 0 0 0 rgba(255,255,255,.6)}70%{box-shadow:0 0 0 10px rgba(255,255,255,0)}100%{box-shadow:0 0 0 0 rgba(255,255,255,0)}}'+
      '@keyframes lbRise{0%{opacity:0;transform:translateY(6px) scale(.9)}15%{opacity:1;transform:translateY(0) scale(1.05)}100%{opacity:0;transform:translateY(-34px) scale(1)}}'+
      '@keyframes lbGlow{0%,100%{box-shadow:0 0 0 0 rgba(245,197,66,0)}50%{box-shadow:0 0 34px 4px rgba(245,197,66,.55)}}'+
      '@keyframes lbLive{0%,100%{opacity:1}50%{opacity:.35}}';
    document.head.appendChild(st);
  }

  function buildOverlay(){
    overlay = make('div', {
      position:'fixed', inset:'0', zIndex:'99999', display:'none',
      flexDirection:'column', direction:'rtl',
      background:'radial-gradient(1200px 600px at 50% -10%, #2A2065 0%, #15103C 45%, #0A0720 100%)',
      fontFamily:"'Assistant',sans-serif", color:'#fff', overflow:'hidden'
    });

    // ── כותרת ──
    var header = make('div', { display:'flex', alignItems:'center', gap:'16px', padding:'22px 34px 10px' });
    var title = make('div', {});
    title.innerHTML =
      '<div style="display:flex;align-items:center;gap:12px;">'+
        '<span style="display:inline-flex;align-items:center;gap:7px;background:#E23B54;color:#fff;font-family:Rubik;font-weight:800;font-size:14px;padding:5px 12px;border-radius:999px;letter-spacing:1px;animation:lbLive 1.4s infinite;"><span style="width:9px;height:9px;border-radius:50%;background:#fff;"></span>LIVE</span>'+
        '<span style="font-family:Rubik;font-weight:800;font-size:34px;line-height:1;">לוח תוצאות חי</span>'+
      '</div>'+
      '<div style="font-size:15px;color:#B9B4E6;margin-top:7px;font-weight:600;">הדירוג מתעדכן בזמן אמת בכל המסכים</div>';
    header.appendChild(title);

    var headerBtns = make('div', { marginInlineStart:'auto', display:'flex', gap:'10px' });
    var toggleBtn = make('button', hdrBtnStyle(), 'הסתר בקרה');
    toggleBtn.onclick = function(){ controlsOn = !controlsOn; controlBar.style.display = controlsOn ? 'flex' : 'none'; toggleBtn.textContent = controlsOn ? 'הסתר בקרה' : 'הצג בקרה'; requestRender(); };
    var fsBtn = make('button', hdrBtnStyle(), 'מסך מלא');
    fsBtn.onclick = function(){ if(document.fullscreenElement){ document.exitFullscreen(); } else { (overlay.requestFullscreen||overlay.webkitRequestFullscreen||function(){}).call(overlay); } };
    var closeBtn = make('button', hdrBtnStyle('#E23B54'), '✕ סגור');
    closeBtn.onclick = closeBoard;
    headerBtns.appendChild(toggleBtn); headerBtns.appendChild(fsBtn); headerBtns.appendChild(closeBtn);
    header.appendChild(headerBtns);
    overlay.appendChild(header);

    // ── אזור השורות ──
    var scroll = make('div', { flex:'1', overflow:'auto', padding:'14px 34px 24px' });
    rowsWrap = make('div', { position:'relative', display:'flex', flexDirection:'column', gap:'14px', maxWidth:'1100px', margin:'0 auto' });
    scroll.appendChild(rowsWrap);
    overlay.appendChild(scroll);

    // ── סרגל בקרה תחתון ──
    controlBar = make('div', {
      display:'flex', alignItems:'center', gap:'16px', flexWrap:'wrap',
      padding:'16px 34px', background:'rgba(10,7,32,.72)', backdropFilter:'blur(10px)',
      borderTop:'1px solid rgba(255,255,255,.1)'
    });
    var cbLabel = make('div', { fontFamily:'Rubik', fontWeight:'700', fontSize:'15px', color:'#CFCAF2' }, 'הזנת נקודות:');
    controlBar.appendChild(cbLabel);

    var groupWrap = make('div', { display:'flex', gap:'8px', flexWrap:'wrap' });
    groupWrap.id = 'lb-group-btns';
    controlBar.appendChild(groupWrap);

    var quickWrap = make('div', { display:'flex', alignItems:'center', gap:'8px', marginInlineStart:'auto' });
    [1,5,10,50].forEach(function(v){
      var b = make('button', quickBtnStyle(), '+'+v);
      b.onclick = function(){ addPoints(selected, v); };
      quickWrap.appendChild(b);
    });
    amountInput = make('input', {
      width:'92px', textAlign:'center', fontFamily:'Rubik', fontWeight:'700', fontSize:'16px',
      color:'#fff', background:'rgba(255,255,255,.1)', border:'1px solid rgba(255,255,255,.22)',
      borderRadius:'10px', padding:'9px 8px', outline:'none'
    });
    amountInput.type = 'number'; amountInput.placeholder = 'סכום';
    amountInput.onkeydown = function(e){ if(e.key==='Enter'){ applyCustom(); } };
    quickWrap.appendChild(amountInput);
    var addBtn = make('button', { fontFamily:'Rubik', fontWeight:'800', fontSize:'15px', color:'#fff', background:'linear-gradient(135deg,#5A4BD4,#7C6BF0)', border:'none', borderRadius:'10px', padding:'10px 18px', cursor:'pointer' }, 'הוסף ▲');
    addBtn.onclick = applyCustom;
    quickWrap.appendChild(addBtn);
    var subBtn = make('button', quickBtnStyle('rgba(226,59,84,.22)','#FFB3BE'), '−');
    subBtn.title = 'הורד את הסכום שבתיבה';
    subBtn.onclick = function(){ var v = Number(amountInput.value)||0; if(v>0) addPoints(selected, -v); };
    quickWrap.appendChild(subBtn);
    var undoBtn = make('button', quickBtnStyle(), '↩︎ בטל');
    undoBtn.onclick = undo;
    quickWrap.appendChild(undoBtn);
    controlBar.appendChild(quickWrap);

    overlay.appendChild(controlBar);
    document.body.appendChild(overlay);

    document.addEventListener('keydown', function(e){
      if(!open) return;
      if(e.key==='Escape') closeBoard();
      else if(e.key==='c'||e.key==='C'){ toggleBtn.click(); }
    });
  }

  function hdrBtnStyle(accent){
    return { fontFamily:'Assistant', fontWeight:'700', fontSize:'14px', color:'#fff',
      background: accent||'rgba(255,255,255,.12)', border:'1px solid rgba(255,255,255,.2)',
      borderRadius:'10px', padding:'9px 15px', cursor:'pointer' };
  }
  function quickBtnStyle(bg, col){
    return { fontFamily:'Rubik', fontWeight:'800', fontSize:'15px', color: col||'#fff',
      background: bg||'rgba(255,255,255,.12)', border:'1px solid rgba(255,255,255,.2)',
      borderRadius:'10px', padding:'9px 14px', cursor:'pointer', minWidth:'46px' };
  }

  function buildGroupButtons(){
    var wrap = document.getElementById('lb-group-btns');
    if(!wrap || !latest || !latest.groups) return;
    wrap.innerHTML = ''; groupBtns = [];
    latest.groups.forEach(function(g, i){
      var b = make('button', {
        fontFamily:'Assistant', fontWeight:'700', fontSize:'14px', cursor:'pointer',
        borderRadius:'10px', padding:'9px 14px', border:'2px solid transparent',
        color:'#fff', background:'rgba(255,255,255,.1)', display:'flex', alignItems:'center', gap:'7px'
      });
      b.innerHTML = '<span style="width:10px;height:10px;border-radius:50%;background:'+GROUP_COLORS[i%GROUP_COLORS.length]+';"></span>'+ (g.name||('קבוצה '+(i+1)));
      b.onclick = function(){ selected = i; syncGroupButtons(); };
      wrap.appendChild(b); groupBtns.push(b);
    });
    syncGroupButtons();
  }
  function syncGroupButtons(){
    groupBtns.forEach(function(b, i){
      if(i===selected){ b.style.background = 'rgba(124,107,240,.4)'; b.style.borderColor = '#7C6BF0'; }
      else { b.style.background = 'rgba(255,255,255,.1)'; b.style.borderColor = 'transparent'; }
    });
  }

  // ════════════════════ כתיבת נקודות (בטוח מפני התנגשויות) ════════════════════
  function addPoints(i, delta){
    if(!db || !latest || !latest.groups || !latest.groups[i]) return;
    delta = Number(delta)||0; if(!delta) return;
    var prevBonus = num(latest.groups[i].bonus);
    undoStack.push({ i: i, prevBonus: prevBonus });
    // טרנזקציה על שדה הבונוס בלבד — לא דורסת נתונים אחרים ובטוחה מריצות מקבילות
    db.ref('comp_scoring_data/groups/'+i+'/bonus').transaction(function(cur){
      return num(cur) + delta;
    });
    flashPlus(i, delta);
  }
  function applyCustom(){
    var v = Number(amountInput.value)||0;
    if(v){ addPoints(selected, v); amountInput.value=''; }
  }
  function undo(){
    var last = undoStack.pop();
    if(!last || !db) return;
    db.ref('comp_scoring_data/groups/'+last.i+'/bonus').set(last.prevBonus);
  }

  // ════════════════════ Firebase ════════════════════
  function connect(){
    db = window.__db;
    if(!db){ return false; }
    db.ref('comp_scoring_data').on('value', function(snap){
      var d = snap.val();
      if(d && d.groups){ latest = d; if(open){ buildGroupButtons(); requestRender(); } }
    });
    return true;
  }

  // ════════════════════ רינדור + אנימציית FLIP ════════════════════
  var renderQueued = false, firstRender = true;
  // חשוב: הרינדור עצמו לא תלוי ב-requestAnimationFrame (שמושהה בטאבים ברקע) —
  // התוכן תמיד מוצג; rAF משמש רק לאנימציה, עם רשת-ביטחון של setTimeout.
  function requestRender(){ if(renderQueued) return; renderQueued = true; setTimeout(function(){ renderQueued = false; render(); }, 0); }
  function nextFrame(fn){ requestAnimationFrame(fn); setTimeout(fn, 70); } // rAF + fallback אם מושהה

  function render(){
    if(!latest || !latest.groups || !open) return;
    var groups = latest.groups.map(function(g, i){ var s = scoreOf(g); return { i:i, name: g.name||('קבוצה '+(i+1)), final:s.final, auto:s.auto, judge:s.judge, votes:s.votes }; });
    var sorted = groups.slice().sort(function(a,b){ return b.final - a.final || b.votes - a.votes; });
    var maxF = Math.max(1, sorted[0] ? sorted[0].final : 1);
    var medals = ['🥇','🥈','🥉'];

    // FIRST — מיקומי השורות לפני השינוי
    prevRects = {};
    Object.keys(rowEls).forEach(function(k){ prevRects[k] = rowEls[k].getBoundingClientRect(); });

    // ודא שכל שורה קיימת + עדכן תוכן, וסדר מחדש לפי הדירוג
    sorted.forEach(function(x, rank){
      var el = rowEls[x.i] || createRow(x.i);
      rowsWrap.appendChild(el); // סידור מחדש לפי הסדר החדש
      updateRowContent(el, x, rank, maxF, medals);
    });

    // LAST — מיקומים חדשים → הפעל אנימציית החלקה
    if(!firstRender){
      sorted.forEach(function(x){
        var el = rowEls[x.i]; var first = prevRects[x.i]; if(!first) return;
        var last = el.getBoundingClientRect();
        var dy = first.top - last.top;
        if(Math.abs(dy) > 1){
          el.style.transition = 'none';
          el.style.transform = 'translateY('+dy+'px)';
          el.getBoundingClientRect(); // reflow
          nextFrame(function(){
            el.style.transition = 'transform .85s cubic-bezier(.22,.9,.28,1)';
            el.style.transform = '';
          });
        }
      });
    }
    // הדגשת מי שעלה בדירוג
    sorted.forEach(function(x, rank){
      if(!firstRender && prevRank[x.i]!=null && rank < prevRank[x.i]){ glowRow(rowEls[x.i]); }
      prevRank[x.i] = rank;
    });
    firstRender = false;
  }

  function createRow(i){
    var el = make('div', {
      display:'flex', alignItems:'center', gap:'22px', padding:'20px 26px',
      background:'rgba(255,255,255,.055)', border:'1px solid rgba(255,255,255,.1)',
      borderRadius:'20px', backdropFilter:'blur(4px)', willChange:'transform', position:'relative'
    });
    el.innerHTML =
      '<div class="lb-rank" style="flex-shrink:0;width:70px;height:70px;border-radius:18px;display:flex;align-items:center;justify-content:center;font-family:Rubik;font-weight:800;"></div>'+
      '<div style="flex:1;min-width:0;">'+
        '<div style="display:flex;align-items:baseline;gap:12px;">'+
          '<span class="lb-name" style="font-family:Rubik;font-weight:700;font-size:26px;color:#fff;"></span>'+
          '<span class="lb-sub" style="font-size:14px;color:#A9A4D8;font-weight:600;"></span>'+
        '</div>'+
        '<div style="height:14px;background:rgba(255,255,255,.09);border-radius:999px;overflow:hidden;margin-top:11px;">'+
          '<div class="lb-bar" style="height:100%;width:0;border-radius:999px;transition:width .85s cubic-bezier(.22,.9,.28,1);"></div>'+
        '</div>'+
      '</div>'+
      '<div style="text-align:center;flex-shrink:0;min-width:130px;position:relative;">'+
        '<div class="lb-score" style="font-family:Rubik;font-weight:800;font-size:44px;line-height:1;color:#fff;">0</div>'+
        '<div style="font-size:13px;color:#9A95CE;font-weight:600;margin-top:3px;">נק׳ סה״כ</div>'+
        '<div class="lb-plus" style="position:absolute;top:-6px;inset-inline-start:50%;transform:translateX(50%);font-family:Rubik;font-weight:800;font-size:22px;color:#F5C542;pointer-events:none;opacity:0;"></div>'+
      '</div>';
    rowEls[i] = el;
    return el;
  }

  function updateRowContent(el, x, rank, maxF, medals){
    var top = rank===0;
    var rankBg = rank===0?'linear-gradient(135deg,#F5C542,#E0A21E)':rank===1?'linear-gradient(135deg,#D8DEEC,#AEB6CC)':rank===2?'linear-gradient(135deg,#E0913B,#C2701E)':'rgba(255,255,255,.1)';
    var rankCol = rank<3?'#3A2E00':'#CFCAF2';
    var barCol = rank===0?'linear-gradient(90deg,#F5C542,#F7D96E)':rank===1?'#C8CEDD':rank===2?'#E0913B':GROUP_COLORS[x.i%GROUP_COLORS.length];

    var rankEl = el.querySelector('.lb-rank');
    rankEl.style.background = rankBg; rankEl.style.color = rankCol;
    rankEl.style.fontSize = rank<3?'34px':'28px';
    rankEl.textContent = rank<3 ? medals[rank] : String(rank+1);

    el.querySelector('.lb-name').textContent = x.name;
    el.querySelector('.lb-sub').textContent = 'אוטומטי '+fmt(x.auto)+' · שופטים '+fmt(x.judge)+' · 🗳️ '+fmt(x.votes);
    el.querySelector('.lb-bar').style.width = (x.final/maxF*100)+'%';
    el.querySelector('.lb-bar').style.background = barCol;

    el.style.border = top ? '1px solid rgba(245,197,66,.6)' : '1px solid rgba(255,255,255,.1)';
    el.style.background = top ? 'rgba(245,197,66,.1)' : 'rgba(255,255,255,.055)';
    el.style.boxShadow = top ? '0 18px 44px -20px rgba(245,197,66,.6)' : 'none';

    animateScore(el.querySelector('.lb-score'), x.i, x.final);
  }

  function animateScore(node, i, target){
    var start = shownScore[i]!=null ? shownScore[i] : target;
    if(start === target){ node.textContent = fmt(target); shownScore[i]=target; return; }
    var t0 = null, dur = 700;
    function step(ts){
      if(shownScore[i] === target){ return; } // כבר הושלם (למשל ע"י רשת-הביטחון)
      if(t0==null) t0 = ts;
      var p = Math.min(1, (ts - t0)/dur);
      var ease = 1 - Math.pow(1-p, 3);
      var val = start + (target - start)*ease;
      node.textContent = fmt(val);
      if(p<1) requestAnimationFrame(step); else { shownScore[i] = target; }
    }
    requestAnimationFrame(step);
    // רשת-ביטחון: אם rAF מושהה, ודא שהערך הסופי מוצג
    setTimeout(function(){ if(shownScore[i] !== target){ node.textContent = fmt(target); shownScore[i] = target; } }, dur + 120);
  }

  function flashPlus(i, delta){
    var el = rowEls[i]; if(!el) return;
    var p = el.querySelector('.lb-plus');
    p.textContent = (delta>0?'+':'') + delta;
    p.style.color = delta>0 ? '#F5C542' : '#FF8A9B';
    p.style.animation = 'none'; p.getBoundingClientRect();
    p.style.animation = 'lbRise 1.1s ease-out';
  }
  function glowRow(el){ if(!el) return; el.style.animation = 'none'; el.getBoundingClientRect(); el.style.animation = 'lbGlow 1.1s ease-out'; }

  // ════════════════════ פתיחה/סגירה ════════════════════
  function openBoard(){
    open = true;
    overlay.style.display = 'flex';
    controlBar.style.display = controlsOn ? 'flex' : 'none';
    firstRender = true; prevRank = {}; shownScore = {};
    buildGroupButtons();
    requestRender();
  }
  function closeBoard(){
    open = false;
    if(document.fullscreenElement){ try{ document.exitFullscreen(); }catch(e){} }
    overlay.style.display = 'none';
  }

  // ════════════════════ אתחול ════════════════════
  function init(){
    if(!document.body){ return setTimeout(init, 50); }
    buildLaunchButton();
    buildOverlay();
    var tries = 0;
    (function waitDb(){
      if(connect()) return;
      if(tries++ > 200) return;
      setTimeout(waitDb, 100);
    })();
  }
  init();
})();
