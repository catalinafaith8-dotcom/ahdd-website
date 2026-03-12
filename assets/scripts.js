
  const words = ['Healthy','Happy','Radiant','Beautiful'];
  let wordIdx = 0;
  const el = document.getElementById('heroWord');

  function typeWord(word, callback) {
    el.textContent = '';
    el.classList.remove('cursor-off');
    let i = 0;
    const typeInterval = setInterval(() => {
      el.textContent += word[i];
      i++;
      if (i === word.length) {
        clearInterval(typeInterval);
        setTimeout(() => eraseWord(callback), 1800);
      }
    }, 80);
  }

  function eraseWord(callback) {
    let text = el.textContent;
    const eraseInterval = setInterval(() => {
      text = text.slice(0, -1);
      el.textContent = text;
      if (text.length === 0) {
        clearInterval(eraseInterval);
        el.classList.add('cursor-off');
        setTimeout(callback, 300);
      }
    }, 50);
  }

  function cycleWords() {
    wordIdx = (wordIdx + 1) % words.length;
    typeWord(words[wordIdx], cycleWords);
  }

  typeWord(words[wordIdx], cycleWords);

  window.addEventListener('load', () => {
    document.querySelectorAll('.trust-pill').forEach((p, i) => {
      setTimeout(() => p.classList.add('visible'), 500 + i * 110);
    });
  });

  function countUp(el) {
    const max = parseInt(el.dataset.target);
    const sfx = el.dataset.suffix || '';
    let v = 0;
    const step = max / (900 / 16);
    const t = setInterval(() => {
      v += step;
      if (v >= max) { el.textContent = max + sfx; clearInterval(t); }
      else el.textContent = Math.floor(v) + sfx;
    }, 16);
  }
  const io = new IntersectionObserver(entries => {
    if (!entries[0].isIntersecting) return;
    document.querySelectorAll('.stat-item').forEach((el, i) => {
      setTimeout(() => el.classList.add('visible'), i * 80);
    });
    document.querySelectorAll('[data-target]').forEach(countUp);
    io.disconnect();
  }, { threshold: 0.4 });
  io.observe(document.getElementById('statBar'));



  // Services card reveal on scroll
  const svcObserver = new IntersectionObserver(entries => {
    if (!entries[0].isIntersecting) return;
    document.querySelectorAll('.svc-card').forEach((card, i) => {
      setTimeout(() => card.classList.add('visible'), i * 70);
    });
    svcObserver.disconnect();
  }, { threshold: 0.1 });
  const svcGrid = document.getElementById('svcGrid');
  if (svcGrid) svcObserver.observe(svcGrid);



  (function() {
    const track = document.getElementById('reviewsTrack');
    if (track) {
      // Duplicate all cards for seamless infinite loop
      track.innerHTML += track.innerHTML;
    }
  })();
