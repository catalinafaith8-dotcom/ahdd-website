/* ──────────────────────────────────────────────────────────
   AHDD — 2026-04-19 revisions enhancement script
   Loaded on every page after inline content.
   Provides:
     1. Services dropdown in desktop nav + mobile submenu
     2. Chatbot: close → minimize, 4 quick-pick buttons, auto-greeting
     3. Technology page: swap Before/After visuals
     4. Mobile: touch-friendly dropdown open/close
     5. Chatbot escalation: "Talk to a human" → collect name, phone,
        best time, reason → POST to /api/callback (proxies to GHL).
        Added 2026-05-26 — feature/chatbot-callback-handoff.
   ────────────────────────────────────────────────────────── */
(function(){
  'use strict';

  var SERVICES = [
    { label:'Dental Implants',        href:'/dental-implants' },
    { label:'Porcelain Veneers',      href:'/veneers' },
    { label:'Teeth Whitening',        href:'/teeth-whitening' },
    { label:'Dental Bonding',         href:'/dental-bonding-agoura-hills' },
    { label:'Invisalign',             href:'/invisalign' },
    { label:'Restorative Dentistry',  href:'/restorative-dentistry' },
    { label:'Root Canals',            href:'/root-canal-treatment-agoura-hills' },
    { label:'Wisdom Teeth Removal',   href:'/wisdom-teeth-removal-agoura-hills' },
    { label:'Sedation Dentistry',     href:'/sedation-dentistry' },
    { label:'Emergency Dentistry',    href:'/emergency-dentistry' },
    { label:'All-on-4 Dental Implants', href:'/all-on-4-dental-implants-agoura-hills' }
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
        if (svcLi && svcLi.tagName === 'LI') {
          // Remove ANY existing dropdown (inline markup OR previously injected)
          // so we never end up with duplicates. This makes JS the single source of truth.
          var existingDropdowns = svcLi.querySelectorAll('.nav-dropdown');
          existingDropdowns.forEach(function(el){ el.remove(); });
          svcLi.classList.add('has-dropdown');
          svcLink.setAttribute('href','/#services');
          svcLink.setAttribute('aria-haspopup','true');
          svcLink.setAttribute('aria-expanded','false');
          // Detect current page once so we can mark the matching item active
          var currentPath = window.location.pathname.replace(/\/$/, '') || '/';
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
            // Mark active if current page matches this service URL (bare or .html variant)
            var hrefPath = s.href.replace(/\/$/, '');
            if (currentPath === hrefPath || currentPath === hrefPath + '.html') {
              a.classList.add('dd-active');
            }
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
          if (!inp || !snd) return;
          // Intercept "Talk to a human" — start the callback escalation
          // flow locally instead of round-tripping to the LLM.
          if (q.label === 'Talk to a human') {
            qp.style.display = 'none';
            startEscalation({ seedFromQuickPick: true });
            return;
          }
          inp.value = q.text;
          // hide quick picks after first use
          qp.style.display='none';
          snd.click();
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

    /* ── ESCALATION: Talk-to-a-human → Callback Request ──── */
    bindEscalationInterceptors(inp, snd);
  }

  /* ──────────────────────────────────────────────────────────
     CHATBOT ESCALATION FLOW — Callback Request Handoff
     Triggers: "Talk to a human" quick pick, or free-text intent.
     Collects: first name → phone → best time → reason (optional) →
     POSTs to /api/callback which proxies to a GHL inbound webhook.
     ────────────────────────────────────────────────────────── */

  var ESC = {
    active: false,
    step: null,            // 'name' | 'phone' | 'time' | 'specific_time' | 'reason' | 'submitting' | 'done'
    firstName: '',
    phone: '',             // E.164
    bestTimeToCall: '',
    reasonForCall: '',
    startedFromQuickPick: false
  };

  // Free-text patterns that mean "I want to talk to a real person."
  // Kept tight to avoid stealing legitimate chatbot Q's like "do you talk
  // to insurance companies?". Caller must match at least one.
  var ESC_PATTERNS = [
    /\b(talk|speak|chat)\s+(to|with)\s+(an?\s+)?(real\s+)?(human|person|someone|team\s*member|representative|rep|agent|live\s+(person|agent))\b/i,
    /\b(talk|speak)\s+to\s+a\s+human\b/i,
    /\bcan\s+i\s+talk\s+to\s+(a\s+)?(team\s*member|human|person|someone|real)\b/i,
    /\b(call\s+me|callback|call\s+back)\b/i,
    /\b(have|can)\s+(someone|a\s+team\s*member|a\s+human)\s+(call|reach\s*out|contact)\s+me\b/i,
    /\b(i\s+want\s+to\s+talk\s+to|i\s+(would|wanna|wanted)\s+to\s+talk\s+to)\s+(a\s+)?(human|person|someone|real|team)\b/i,
    /\bhuman\s+please\b/i,
    /\bjust\s+have\s+(someone|a\s+human|a\s+person)\s+call\b/i
  ];

  function looksLikeEscalation(text) {
    if (!text) return false;
    var t = String(text).trim();
    if (!t) return false;
    return ESC_PATTERNS.some(function(re){ return re.test(t); });
  }

  function bindEscalationInterceptors(inp, snd) {
    if (!inp || !snd || inp.dataset.ahddEscBound === '1') return;
    inp.dataset.ahddEscBound = '1';
    snd.dataset.ahddEscBound = '1';

    // Capture-phase listeners run BEFORE the inline chatbot's send() handler,
    // so we can swallow the event with stopImmediatePropagation() and route
    // the text into the escalation state machine instead of OpenAI.
    snd.addEventListener('click', function(e){
      if (ESC.active) {
        e.preventDefault();
        e.stopImmediatePropagation();
        handleEscalationInput(inp.value);
        return;
      }
      if (looksLikeEscalation(inp.value)) {
        e.preventDefault();
        e.stopImmediatePropagation();
        var seed = inp.value.trim();
        inp.value = '';
        var qpEl = document.getElementById('ahdd-qp');
        if (qpEl) qpEl.style.display = 'none';
        addUserMsg(seed);
        startEscalation({ seedFromQuickPick: false });
      }
    }, true);

    inp.addEventListener('keypress', function(e){
      if (e.key !== 'Enter') return;
      if (ESC.active) {
        e.preventDefault();
        e.stopImmediatePropagation();
        handleEscalationInput(inp.value);
        return;
      }
      if (looksLikeEscalation(inp.value)) {
        e.preventDefault();
        e.stopImmediatePropagation();
        var seed = inp.value.trim();
        inp.value = '';
        var qpEl = document.getElementById('ahdd-qp');
        if (qpEl) qpEl.style.display = 'none';
        addUserMsg(seed);
        startEscalation({ seedFromQuickPick: false });
      }
    }, true);
  }

  // ─── DOM helpers (mirror inline chatbot's structure) ──────
  function chatMsgs() { return document.getElementById('chat-msgs'); }
  function chatInp() { return document.getElementById('chat-inp'); }
  function chatSend() { return document.getElementById('chat-send'); }

  function addBotMsg(text){
    var m = chatMsgs(); if (!m) return;
    var d = document.createElement('div');
    d.className = 'c-msg bot';
    d.textContent = text;
    m.appendChild(d);
    m.scrollTop = m.scrollHeight;
  }
  function addUserMsg(text){
    var m = chatMsgs(); if (!m) return;
    var d = document.createElement('div');
    d.className = 'c-msg user';
    d.textContent = text;
    m.appendChild(d);
    m.scrollTop = m.scrollHeight;
  }
  function showTyping(){
    var m = chatMsgs(); if (!m) return;
    if (document.getElementById('escTyping')) return;
    var d = document.createElement('div');
    d.className = 'c-msg bot c-typing';
    d.id = 'escTyping';
    d.innerHTML = '<span></span><span></span><span></span>';
    m.appendChild(d);
    m.scrollTop = m.scrollHeight;
  }
  function hideTyping(){
    var t = document.getElementById('escTyping');
    if (t) t.remove();
  }

  // Render an inline row of quick-pick buttons inside the message stream.
  // labels: array of strings. onPick(label) is called once and the row
  // is locked (buttons disabled) so the user can't double-tap.
  function addInlineQuickPicks(labels, onPick){
    var m = chatMsgs(); if (!m) return null;
    var row = document.createElement('div');
    row.className = 'ahdd-esc-qp';
    row.style.cssText = [
      'display:flex','flex-wrap:wrap','gap:6px',
      'align-self:flex-start','max-width:100%','margin:-4px 0 0'
    ].join(';');
    labels.forEach(function(label){
      var b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.style.cssText = [
        'font-family:inherit','font-size:13px','font-weight:500',
        'min-height:44px','padding:10px 14px','border-radius:100px',
        'background:#fff','border:1px solid rgba(29,62,92,.18)',
        'color:#1D3E5C','cursor:pointer','transition:all .18s',
        'line-height:1.2','touch-action:manipulation'
      ].join(';');
      b.addEventListener('mouseenter', function(){
        b.style.background='#1D3E5C'; b.style.color='#fff'; b.style.borderColor='#1D3E5C';
      });
      b.addEventListener('mouseleave', function(){
        b.style.background='#fff'; b.style.color='#1D3E5C'; b.style.borderColor='rgba(29,62,92,.18)';
      });
      b.addEventListener('click', function(){
        // Lock the row
        Array.prototype.forEach.call(row.querySelectorAll('button'), function(btn){
          btn.disabled = true;
          btn.style.opacity = '.5';
          btn.style.cursor = 'default';
        });
        onPick(label);
      });
      row.appendChild(b);
    });
    m.appendChild(row);
    m.scrollTop = m.scrollHeight;
    return row;
  }

  // Validate + normalize a US phone. Returns E.164 string or null.
  function normalizeUsPhone(raw){
    if (!raw) return null;
    var digits = String(raw).replace(/\D+/g, '');
    if (digits.length === 11 && digits.charAt(0) === '1') digits = digits.substring(1);
    if (digits.length !== 10) return null;
    // Reject obviously fake (all same digit, or starting with 0/1)
    if (/^(\d)\1{9}$/.test(digits)) return null;
    if (/^[01]/.test(digits)) return null;
    return '+1' + digits;
  }

  function prettyPhone(e164){
    if (!e164 || e164.length !== 12) return e164 || '';
    var d = e164.substring(2);
    return '(' + d.substring(0,3) + ') ' + d.substring(3,6) + '-' + d.substring(6);
  }

  // Bot pacing: brief, natural delay before each message.
  function botSay(text, opts){
    opts = opts || {};
    var delay = typeof opts.delay === 'number' ? opts.delay : 380;
    showTyping();
    setTimeout(function(){
      hideTyping();
      addBotMsg(text);
      if (typeof opts.then === 'function') opts.then();
    }, delay);
  }

  function setPlaceholder(text){
    var inp = chatInp(); if (inp) inp.setAttribute('placeholder', text);
  }

  function startEscalation(opts){
    if (ESC.active) return;
    opts = opts || {};
    ESC.active = true;
    ESC.startedFromQuickPick = !!opts.seedFromQuickPick;
    ESC.step = 'ack';
    ESC.firstName = '';
    ESC.phone = '';
    ESC.bestTimeToCall = '';
    ESC.reasonForCall = '';

    botSay("Of course — happy to connect you with a team member. I just need a few quick details so we can call at the right time.", {
      delay: 220,
      then: function(){
        ESC.step = 'name';
        setPlaceholder('First name…');
        botSay("First, what's your first name?", { delay: 520, then: function(){
          var inp = chatInp(); if (inp) inp.focus();
        }});
      }
    });
  }

  function handleEscalationInput(raw){
    var inp = chatInp();
    var text = (raw || '').trim();
    if (!text && ESC.step !== 'reason') return; // ignore empty unless reason (handled via skip btn)

    if (ESC.step === 'name') {
      if (text.length < 2) {
        addUserMsg(text);
        if (inp) inp.value = '';
        botSay("Just so I have it right — what's your first name?", { delay: 280 });
        return;
      }
      ESC.firstName = text.replace(/\s+/g, ' ').split(' ')[0].slice(0, 40);
      // Capitalize first letter
      ESC.firstName = ESC.firstName.charAt(0).toUpperCase() + ESC.firstName.slice(1);
      addUserMsg(text);
      if (inp) inp.value = '';
      ESC.step = 'phone';
      setPlaceholder('e.g. (818) 555-1234');
      botSay("Thanks, " + ESC.firstName + ". What's the best phone number to call you back at?", { delay: 360 });
      return;
    }

    if (ESC.step === 'phone') {
      addUserMsg(text);
      if (inp) inp.value = '';
      var e164 = normalizeUsPhone(text);
      if (!e164) {
        botSay("Hmm — that doesn't look like a valid US phone number. Could you double-check and send it again? (10 digits, e.g. 818-555-1234)", { delay: 320 });
        return;
      }
      ESC.phone = e164;
      ESC.step = 'time';
      setPlaceholder('Or type a specific time…');
      botSay("Got it. What's the best time of day to reach you?", { delay: 360, then: function(){
        addInlineQuickPicks(
          ['Morning (9am–12pm)', 'Afternoon (12pm–4pm)', 'Late afternoon (4pm–6pm)', 'Anytime today', 'Specific time'],
          function(label){ handleTimePick(label); }
        );
      }});
      return;
    }

    if (ESC.step === 'time') {
      // User typed free text instead of tapping a chip — treat as specific time
      addUserMsg(text);
      if (inp) inp.value = '';
      ESC.bestTimeToCall = text.slice(0, 120);
      moveToReason();
      return;
    }

    if (ESC.step === 'specific_time') {
      if (text.length < 2) {
        addUserMsg(text);
        if (inp) inp.value = '';
        botSay("When works best? You can be as specific as you'd like (e.g. \"around 3pm today\" or \"tomorrow morning\").", { delay: 280 });
        return;
      }
      addUserMsg(text);
      if (inp) inp.value = '';
      ESC.bestTimeToCall = text.slice(0, 120);
      moveToReason();
      return;
    }

    if (ESC.step === 'reason') {
      addUserMsg(text);
      if (inp) inp.value = '';
      ESC.reasonForCall = text.slice(0, 600);
      submitCallback();
      return;
    }
  }

  function handleTimePick(label) {
    var inp = chatInp();
    addUserMsg(label);
    if (label === 'Specific time') {
      ESC.step = 'specific_time';
      setPlaceholder('When works best?');
      botSay("When works best? Type a time and I'll pass it along.", { delay: 280, then: function(){
        if (inp) inp.focus();
      }});
      return;
    }
    // Normalize label to the payload shape
    if (/^Morning/.test(label)) ESC.bestTimeToCall = 'Morning';
    else if (/^Afternoon/.test(label)) ESC.bestTimeToCall = 'Afternoon';
    else if (/^Late afternoon/.test(label)) ESC.bestTimeToCall = 'Late afternoon';
    else if (/^Anytime/.test(label)) ESC.bestTimeToCall = 'Anytime today';
    else ESC.bestTimeToCall = label;
    moveToReason();
  }

  function moveToReason() {
    ESC.step = 'reason';
    setPlaceholder('Optional — anything we should know?');
    botSay("Last thing — anything specific we should know before calling? (Optional)", { delay: 340, then: function(){
      addInlineQuickPicks(['Skip this'], function(){
        ESC.reasonForCall = '';
        addUserMsg('Skip this');
        submitCallback();
      });
      var inp = chatInp(); if (inp) inp.focus();
    }});
  }

  function submitCallback() {
    ESC.step = 'submitting';
    setPlaceholder('Sending…');
    var inp = chatInp(); if (inp) inp.disabled = true;
    var snd = chatSend(); if (snd) snd.disabled = true;
    showTyping();

    var payload = {
      firstName: ESC.firstName,
      phone: ESC.phone,
      bestTimeToCall: ESC.bestTimeToCall,
      reasonForCall: ESC.reasonForCall || '',
      sourcePage: (window.location && window.location.pathname) || '/',
      requestedAt: new Date().toISOString(),
      tags: ['callback_requested']
    };

    // Static site is on Cloudflare Pages; the /api/* endpoints live on a
    // separate Vercel deployment (same project that hosts api/chatbot.js).
    // Hit the absolute Vercel origin so the call doesn't 404 against Cloudflare.
    fetch('https://ahdd-website-yee1.vercel.app/api/callback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).then(function(r){
      if (!r.ok) throw new Error('http_' + r.status);
      return r.json().catch(function(){ return {}; });
    }).then(function(){
      hideTyping();
      ESC.step = 'done';
      var pretty = prettyPhone(ESC.phone);
      var when = ESC.bestTimeToCall ? (' during ' + ESC.bestTimeToCall.toLowerCase()) : '';
      // Slight pause so the message lands warmly
      setTimeout(function(){
        addBotMsg("Got it — someone from our team will call you at " + pretty + when + ". If anything comes up before then, you can reach us at (818) 706-6077. Talk soon.");
        if (inp) { inp.disabled = false; setPlaceholder('Ask me anything…'); }
        if (snd) snd.disabled = false;
        ESC.active = false;
      }, 280);
    }).catch(function(err){
      hideTyping();
      console && console.warn && console.warn('[ahdd] callback submit failed:', err && err.message);
      ESC.step = 'error';
      addBotMsg("Hmm, something went wrong on our end — please call us directly at (818) 706-6077 and we'll take care of you.");
      if (inp) { inp.disabled = false; setPlaceholder('Ask me anything…'); }
      if (snd) snd.disabled = false;
      ESC.active = false;
    });
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
