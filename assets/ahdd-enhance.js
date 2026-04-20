/* ──────────────────────────────────────────────────────────
   AHDD — 2026-04-19 revisions enhancement script
   Loaded on every page after inline content.
   Provides:
     1. Services dropdown in desktop nav + mobile submenu
     2. Chatbot: close → minimize, 4 quick-pick buttons, auto-greeting
     3. Technology page: swap Before/After visuals
     4. Mobile: touch-friendly dropdown open/close
   ────────────────────────────────────────────────────────── */
(function(){
  'use strict';

  var SERVICES = [
    { label:'Dental Implants',        href:'/services/dental-implants' },
    { label:'Porcelain Veneers',      href:'/services/veneers' },
    { label:'Teeth Whitening',        href:'/services/teeth-whitening' },
    { label:'Invisalign',             href:'/services/invisalign' },
    { label:'Restorative Dentistry',  href:'/services/restorative-dentistry' },
    { label:'Sedation Dentistry',     href:'/services/sedation-dentistry' },
    { label:'Emergency Dentistry',    href:'/services/emergency-dentistry' }
  ];

  /* ── 1. NAV: inject Services dropdown + mobile submenu ─── */
  function enhanceNav(){
    var desktopNav = document.querySelector('.nav-links');
    if (desktopNav) {
      // Find the existing Services link/li
      var svcLink = Array.prototype.find
        ? Array.prototype.find.call(desktopNav.querySelectorAll('a'), function(a){
            return /services/i.test((a.getAttribute('href')||'')) || /^services$/i.test(a.textContent.trim());
          })
        : null;
      if (svcLink) {
        var svcLi = svcLink.parentElement;
        if (svcLi && svcLi.tagName === 'LI' && !svcLi.classList.contains('has-dropdown')) {
          svcLi.classList.add('has-dropdown');
          svcLink.setAttribute('href','/#services');
          svcLink.setAttribute('aria-haspopup','true');
          svcLink.setAttribute('aria-expanded','false');
          var ul = document.createElement('ul');
          ul.className = 'nav-dropdown';
          ul.setAttribute('role','menu');
          SERVICES.forEach(function(s){
            var li = document.createElement('li');
            li.setAttribute('role','none');
            var a = document.createElement('a');
            a.setAttribute('role','menuitem');
            a.href = s.href;
            a.textContent = s.label;
            li.appendChild(a);
            ul.appendChild(li);
          });
          svcLi.appendChild(ul);

          // Touch: first tap opens; second tap follows link
          svcLink.addEventListener('click', function(e){
            if (window.matchMedia('(hover:none)').matches && !svcLi.classList.contains('open')) {
              e.preventDefault();
              document.querySelectorAll('.nav-links li.has-dropdown.open').forEach(function(l){ l.classList.remove('open'); });
              svcLi.classList.add('open');
              svcLink.setAttribute('aria-expanded','true');
            }
          });
          document.addEventListener('click', function(e){
            if (!svcLi.contains(e.target)) {
              svcLi.classList.remove('open');
              svcLink.setAttribute('aria-expanded','false');
            }
          });
        }
      }
    }

    // Mobile nav submenu
    var mob = document.getElementById('mobile-nav');
    if (mob) {
      var mobLinks = mob.querySelectorAll('a');
      mobLinks.forEach(function(a){
        if (/^\/?#?services$/i.test((a.getAttribute('href')||'').replace(/^https?:\/\/[^/]+/,'')) ||
            /^\/#services$/.test(a.getAttribute('href')||'') ||
            /services/i.test(a.textContent.trim()) && a.textContent.trim().length < 12) {
          // Replace with toggle + submenu
          if (a.dataset.ahddServices === '1') return;
          a.dataset.ahddServices = '1';
          var btn = document.createElement('button');
          btn.className = 'mob-sub-toggle';
          btn.type = 'button';
          btn.textContent = 'Services';
          btn.setAttribute('aria-expanded','false');
          var sub = document.createElement('div');
          sub.className = 'mob-sub';
          SERVICES.forEach(function(s){
            var link = document.createElement('a');
            link.href = s.href;
            link.textContent = s.label;
            sub.appendChild(link);
          });
          var parent = a.parentNode;
          parent.insertBefore(btn, a);
          parent.insertBefore(sub, a);
          parent.removeChild(a);
          btn.addEventListener('click', function(){
            var open = btn.classList.toggle('open');
            sub.classList.toggle('open', open);
            btn.setAttribute('aria-expanded', open ? 'true' : 'false');
          });
        }
      });
    }
  }

  /* ── 2. CHATBOT: minimize, quick picks, auto-greeting ──── */
  var CHAT_GREETING = "Hi! I'm your virtual patient concierge at Agoura Hills Dental Designs. I can answer a wide range of questions about our services, doctors, and visits. If there's something outside my wheelhouse, I'll connect you with a team member who can help.";
  var QUICK_PICKS = [
    { label:'Book an appointment', text:"I'd like to book an appointment." },
    { label:'Check my insurance',   text:'Can you help me check if my insurance is accepted?' },
    { label:'See pricing & financing', text:'What are your pricing and financing options?' },
    { label:'Talk to a human',      text:'Can I talk to a team member?' }
  ];

  function enhanceChatbot(){
    var win = document.getElementById('chat-win');
    var tog = document.getElementById('chat-tog');
    var cls = document.getElementById('chat-cls');
    var msgs = document.getElementById('chat-msgs');
    var inp = document.getElementById('chat-inp');
    var snd = document.getElementById('chat-send');
    if (!win || !tog || !cls || !msgs) return;

    // Replace the X (close) glyph with a dash (minimize) — existing inline
    // handler on #chat-cls toggles the window closed AND swaps the launcher
    // icon, so we keep that intact and just change the visible glyph + a11y.
    cls.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="white" stroke-width="2.2" stroke-linecap="round"><path d="M6 12h12"/></svg>';
    cls.setAttribute('title','Minimize');
    cls.setAttribute('aria-label','Minimize chat');

    // Inject quick-pick bar (once)
    var qp = document.getElementById('ahdd-qp');
    if (!qp) {
      qp = document.createElement('div');
      qp.id = 'ahdd-qp';
      qp.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;padding:8px 12px 0;background:var(--cloud,#F5F6F7);';
      QUICK_PICKS.forEach(function(q){
        var b = document.createElement('button');
        b.type='button';
        b.className='ahdd-qp-btn';
        b.textContent = q.label;
        b.style.cssText = [
          'font-family:inherit','font-size:12px','font-weight:500',
          'padding:7px 12px','border-radius:100px','background:#fff',
          'border:1px solid rgba(29,62,92,.16)','color:#1D3E5C',
          'cursor:pointer','transition:all .18s','line-height:1.2'
        ].join(';');
        b.addEventListener('mouseenter', function(){ b.style.background='#1D3E5C'; b.style.color='#fff'; b.style.borderColor='#1D3E5C'; });
        b.addEventListener('mouseleave', function(){ b.style.background='#fff'; b.style.color='#1D3E5C'; b.style.borderColor='rgba(29,62,92,.16)'; });
        b.addEventListener('click', function(){
          if (inp && snd) {
            inp.value = q.text;
            // hide quick picks after first use
            qp.style.display='none';
            snd.click();
          }
        });
        qp.appendChild(b);
      });
      // Insert just above the input area
      var inpArea = document.getElementById('chat-inp-area');
      if (inpArea && inpArea.parentNode) {
        inpArea.parentNode.insertBefore(qp, inpArea);
      } else {
        win.appendChild(qp);
      }
    }

    // Auto-send greeting on first open
    var greeted = false;
    function greet(){
      if (greeted) return;
      greeted = true;
      var d = document.createElement('div');
      d.className = 'c-msg bot';
      d.textContent = CHAT_GREETING;
      msgs.appendChild(d);
      msgs.scrollTop = msgs.scrollHeight;
    }

    // Hook open: observe class change on #chat-win
    var mo = new MutationObserver(function(){
      if (win.classList.contains('open')) {
        greet();
        if (qp) qp.style.display = msgs.querySelectorAll('.c-msg.user').length === 0 ? 'flex' : 'none';
      }
    });
    mo.observe(win, { attributes:true, attributeFilter:['class'] });

    // If already open at load (rare), greet now
    if (win.classList.contains('open')) greet();
  }

  /* ── 3. TECHNOLOGY: Before/After swap ──────────────────── */
  function swapBeforeAfter(){
    var wrap = document.getElementById('baWrap');
    if (!wrap) return;
    var beforeDiv = wrap.querySelector('.ba-before');
    var afterDiv  = wrap.querySelector('.ba-after');
    if (!beforeDiv || !afterDiv) return;
    // Swap image srcs so the BEFORE image is on the left/under,
    // AFTER image on the right/over — matching what the user sees.
    var beforeImg = beforeDiv.querySelector('img,video');
    var afterImg  = afterDiv.querySelector('img,video');
    if (!beforeImg || !afterImg) return;
    if (wrap.dataset.ahddSwapped === '1') return;
    wrap.dataset.ahddSwapped = '1';
    var bSrc = beforeImg.getAttribute('src');
    var aSrc = afterImg.getAttribute('src');
    var bAlt = beforeImg.getAttribute('alt') || '';
    var aAlt = afterImg.getAttribute('alt') || '';
    beforeImg.setAttribute('src', aSrc);
    beforeImg.setAttribute('alt', aAlt);
    afterImg.setAttribute('src', bSrc);
    afterImg.setAttribute('alt', bAlt);
  }

  // 2026-04-20: tag the Paperless Forms tech-row so CSS fallback can
  // target it in browsers that don't support :has() (older iOS).
  function tagPaperlessCard(){
    var rows = document.querySelectorAll('article.tech-row');
    for (var i = 0; i < rows.length; i++){
      var row = rows[i];
      var vid = row.querySelector('video');
      var src = vid && (vid.currentSrc || '');
      if (!src){
        var s = row.querySelector('video source');
        src = s && s.getAttribute('src') || '';
      }
      if (/Paperless/i.test(src) || /paperless\s*office/i.test(row.textContent || '')){
        row.classList.add('paperless');
      }
    }
  }

  function init(){
    try { enhanceNav(); } catch(e){ console && console.warn && console.warn('[ahdd] nav', e); }
    try { enhanceChatbot(); } catch(e){ console && console.warn && console.warn('[ahdd] chat', e); }
    try { swapBeforeAfter(); } catch(e){ console && console.warn && console.warn('[ahdd] ba', e); }
    try { tagPaperlessCard(); } catch(e){ console && console.warn && console.warn('[ahdd] paperless', e); }
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
