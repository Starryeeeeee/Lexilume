window.WL = window.WL || {};
(function (WL) {
  'use strict';

  var CHANNEL = {
    en2cn: 'r',
    audio2cn: 'r',
    cn2en: 'p',
    spell: 'p',
    cloze: 'p'
  };

  var LABEL = {
    en2cn: '看词选义',
    cn2en: '看义选词',
    audio2cn: '听音辨义',
    spell: '拼写',
    cloze: '语境填词'
  };

  function shuffle(arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  function firstSense(tr) {
    if (!tr) return '';
    return String(tr).split(/[；;]/)[0].trim();
  }

  function keyOf(word, field) {
    return field === 'tr' ? firstSense(word.tr) : word.w;
  }

  function pickDistractors(target, pool, n, field) {
    var seen = {};
    seen[keyOf(target, field)] = 1;
    var same = [];
    var other = [];
    for (var i = 0; i < pool.length; i++) {
      var w = pool[i];
      if (w.id === target.id) continue;
      var key = keyOf(w, field);
      if (!key || seen[key]) continue;
      seen[key] = 1;
      var bucket = (target.pos && w.pos === target.pos) ? same : other;
      bucket.push(key);
    }
    var out = shuffle(same).slice(0, n);
    if (out.length < n) {
      out = out.concat(shuffle(other).slice(0, n - out.length));
    }
    return out;
  }

  function blankOut(sentence, word) {
    var re = new RegExp('\\b' + word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i');
    if (!re.test(sentence)) return null;
    return sentence.replace(re, '____');
  }

  // 返回题目结构；若该词不适合该题型则返回 null
  function build(word, type, pool) {
    var answer, options = [], prompt, sub = '', hint = '';

    if (type === 'en2cn') {
      answer = firstSense(word.tr);
      prompt = word.w;
      sub = word.ph || '';
      options = [answer].concat(pickDistractors(word, pool, 3, 'tr'));
    } else if (type === 'cn2en') {
      answer = word.w;
      prompt = firstSense(word.tr);
      sub = word.pos ? '(' + word.pos + ')' : '';
      options = [answer].concat(pickDistractors(word, pool, 3, 'w'));
    } else if (type === 'audio2cn') {
      answer = firstSense(word.tr);
      prompt = '听发音，选出释义';
      sub = '';
      options = [answer].concat(pickDistractors(word, pool, 3, 'tr'));
    } else if (type === 'cloze') {
      if (!word.ex) return null;
      var blanked = blankOut(word.ex, word.w);
      if (!blanked) return null;
      answer = word.w;
      prompt = blanked;
      sub = word.exCn || '';
      options = [answer].concat(pickDistractors(word, pool, 3, 'w'));
    } else if (type === 'spell') {
      if (!/^[a-z]+$/i.test(word.w) || word.w.length > 20) return null;
      answer = word.w;
      prompt = firstSense(word.tr);
      sub = word.pos ? '(' + word.pos + ')' : '';
      hint = word.w[0] + new Array(word.w.length).join(' _');
    } else {
      return null;
    }

    var opts = shuffle(options).map(function (t) {
      return { text: t, ok: t === answer };
    });

    if (opts.length < 2) return null;

    return {
      type: type,
      label: LABEL[type],
      channel: CHANNEL[type],
      word: word,
      prompt: prompt,
      sub: sub,
      hint: hint,
      answer: answer,
      options: opts
    };
  }

  function chooseType(word, channel, allowed) {
    var fits = allowed.filter(function (t) {
      if (CHANNEL[t] !== channel) return false;
      if (t === 'cloze') return !!blankOut(word.ex || '', word.w);
      if (t === 'spell') return /^[a-z]+$/i.test(word.w) && word.w.length <= 20;
      return true;
    });
    if (!fits.length) return channel === 'p' ? 'cn2en' : 'en2cn';
    if (channel === 'p' && fits.indexOf('spell') >= 0 && Math.random() < 0.45) return 'spell';
    if (channel === 'p' && fits.indexOf('cloze') >= 0 && Math.random() < 0.3) return 'cloze';
    return fits[Math.floor(Math.random() * fits.length)];
  }

  function speak(text, enabled) {
    if (!enabled || !window.speechSynthesis) return;
    try {
      window.speechSynthesis.cancel();
      var u = new SpeechSynthesisUtterance(text);
      u.lang = 'en-US';
      u.rate = 0.9;
      window.speechSynthesis.speak(u);
    } catch (e) { /* 静默失败 */ }
  }

  function normalize(s) {
    return String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
  }

  WL.quiz = {
    CHANNEL: CHANNEL,
    LABEL: LABEL,
    build: build,
    chooseType: chooseType,
    speak: speak,
    normalize: normalize,
    shuffle: shuffle,
    blankOut: blankOut
  };
})(window.WL);
