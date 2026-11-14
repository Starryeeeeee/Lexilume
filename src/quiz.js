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

  // 返回干扰项的词对象数组（保留来源，供答对后展示对比释义）
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
      bucket.push(w);
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

  // 该词是否适合拼写环节（与 build('spell') 的前提保持一致）
  function spellable(word) {
    return /^[a-z]+$/i.test(word.w) && word.w.length <= 20;
  }

  // 返回题目结构；若该词不适合该题型则返回 null
  // 选项额外携带 src（来源单词）与 meaning（该词的中文释义），答对后用于对比展示
  function build(word, type, pool) {
    var answer, raw = [], prompt, sub = '', hint = '';

    if (type === 'en2cn') {
      answer = firstSense(word.tr);
      prompt = word.w;
      sub = word.ph || '';
      raw = [{ src: word, text: answer }].concat(pickDistractors(word, pool, 3, 'tr').map(function (w) {
        return { src: w, text: firstSense(w.tr) };
      }));
    } else if (type === 'cn2en') {
      answer = word.w;
      prompt = firstSense(word.tr);
      sub = word.pos ? '(' + word.pos + ')' : '';
      raw = [{ src: word, text: answer }].concat(pickDistractors(word, pool, 3, 'w').map(function (w) {
        return { src: w, text: w.w };
      }));
    } else if (type === 'audio2cn') {
      answer = firstSense(word.tr);
      prompt = '听发音，选出释义';
      sub = '';
      raw = [{ src: word, text: answer }].concat(pickDistractors(word, pool, 3, 'tr').map(function (w) {
        return { src: w, text: firstSense(w.tr) };
      }));
    } else if (type === 'cloze') {
      if (!word.ex) return null;
      var blanked = blankOut(word.ex, word.w);
      if (!blanked) return null;
      answer = word.w;
      prompt = blanked;
      sub = word.exCn || '';
      raw = [{ src: word, text: answer }].concat(pickDistractors(word, pool, 3, 'w').map(function (w) {
        return { src: w, text: w.w };
      }));
    } else if (type === 'spell') {
      if (!spellable(word)) return null;
      answer = word.w;
      prompt = firstSense(word.tr);
      sub = word.pos ? '(' + word.pos + ')' : '';
      hint = word.w[0] + new Array(word.w.length).join(' _');
    } else {
      return null;
    }

    // 拼写题没有选项，靠输入作答，跳过选项检查
    var opts = [];
    if (type !== 'spell') {
      opts = shuffle(raw).map(function (t) {
        return { text: t.text, ok: t.text === answer, src: t.src.w, meaning: firstSense(t.src.tr) };
      });
      if (opts.length < 2) return null;
    }

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
    blankOut: blankOut,
    spellable: spellable
  };
})(window.WL);
