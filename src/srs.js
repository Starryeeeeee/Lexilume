window.WL = window.WL || {};
(function (WL) {
  'use strict';

  var DAY = 86400000;

  function clamp(x, a, b) { return x < a ? a : (x > b ? b : x); }

  // 遗忘曲线：R = 1 / (1 + t / 9S)
  // 目标记忆率 0.9 时反解得 t = S，因此 due = last + S 天
  function retrievability(s, lastTs, now) {
    if (!s || s <= 0) return 0;
    var t = Math.max(0, (now - lastTs) / DAY);
    return 1 / (1 + t / (9 * s));
  }

  function dueAt(s, lastTs) {
    return lastTs + s * DAY;
  }

  // 初始难度由词形粗略估计，随后由答题历史校准
  function initDifficulty(word) {
    var n = (word.w || '').length;
    if (n <= 4) return 3.4;
    if (n <= 6) return 4.2;
    if (n <= 8) return 5.0;
    if (n <= 10) return 5.8;
    return 6.6;
  }

  // 答对后的稳定度倍增：难度越高增长越慢，但保底 1.3 倍，不会卡死
  function growStability(s, d) {
    var m = Math.max(1.3, 2.6 - 0.16 * d);
    return clamp(s * m, 1, 365 * 3);
  }

  // 答错后缩水但不清零。这是相对 SM-2 的关键修正
  function shrinkStability(s) {
    return Math.max(0.3, s * 0.35);
  }

  function newChannel(word) {
    return {
      s: 1,
      d: initDifficulty(word),
      last: 0,
      due: 0,
      n: 0
    };
  }

  function newState(word, now) {
    return {
      ch: { r: newChannel(word), p: newChannel(word) },
      seen: 0,
      reps: 0,
      lapses: 0,
      born: now
    };
  }

  // 单次作答结算。channel: 'r' 认词通道 | 'p' 产出通道
  function review(state, channel, correct, now) {
    var c = state.ch[channel];
    if (!c) return state;

    if (correct) {
      c.s = growStability(c.s || 1, c.d);
      var drop = 0.6 / (1 + Math.log2(1 + c.s));
      c.d = clamp(c.d - drop, 2.2, 10);
      state.reps++;
    } else {
      c.s = shrinkStability(c.s || 1);
      c.d = clamp(c.d + 1.2, 1, 10);
      state.lapses++;
    }

    c.last = now;
    c.due = dueAt(c.s, now);
    c.n++;
    return state;
  }

  // 取激活通道里更弱的那条出题
  function weakestChannel(state, now, channels) {
    channels = channels || ['r'];
    var best = null, bestR = 2;
    for (var i = 0; i < channels.length; i++) {
      var c = state.ch[channels[i]];
      if (!c) continue;
      if (c.n === 0) return channels[i];
      var r = retrievability(c.s, c.last, now);
      if (r < bestR) { bestR = r; best = channels[i]; }
    }
    return best || channels[0];
  }

  function healthOf(state, now, channels) {
    channels = channels || ['r', 'p'];
    if (!state) return 'new';
    var minR = 1, minS = Infinity;
    for (var i = 0; i < channels.length; i++) {
      var c = state.ch[channels[i]];
      if (!c || c.n === 0) continue;
      var r = retrievability(c.s, c.last, now);
      if (r < minR) minR = r;
      if (c.s < minS) minS = c.s;
    }
    if (minS === Infinity) return 'learning';
    if (minR < 0.75) return 'risk';
    if (minS < 21) return 'learning';
    if (minS < 180) return 'familiar';
    return 'mastered';
  }

  function dueNow(state, now, channels) {
    channels = channels || ['r', 'p'];
    for (var i = 0; i < channels.length; i++) {
      var c = state.ch[channels[i]];
      if (c && c.n > 0 && c.due && c.due <= now) return true;
    }
    return false;
  }

  // 超期天数：按已激活通道里「最早到期」的那个算（多通道下另一个通道没到期不影响排序）
  function overdueDays(state, now, channels) {
    channels = channels || ['r', 'p'];
    var min = Infinity;
    for (var i = 0; i < channels.length; i++) {
      var c = state.ch[channels[i]];
      if (c && c.n > 0 && c.due && c.due < min) min = c.due;
    }
    if (min === Infinity) return 0;
    return (now - min) / DAY;
  }

  // 复习量预测：未来 n 天每天到期的卡片数（已斩的词不计入）
  function forecast(states, now, days, channels) {
    channels = channels || ['r', 'p'];
    var out = [];
    for (var i = 0; i < days; i++) out.push(0);
    for (var k in states) {
      var st = states[k];
      if (st.cut) continue;
      for (var j = 0; j < channels.length; j++) {
        var c = st.ch[channels[j]];
        if (!c || c.n === 0 || !c.due) continue;
        var idx = Math.floor((c.due - now) / DAY);
        if (idx < 0) idx = 0;
        if (idx < days) out[idx]++;
      }
    }
    return out;
  }

  WL.srs = {
    DAY: DAY,
    clamp: clamp,
    retrievability: retrievability,
    dueAt: dueAt,
    newState: newState,
    review: review,
    weakestChannel: weakestChannel,
    healthOf: healthOf,
    dueNow: dueNow,
    overdueDays: overdueDays,
    forecast: forecast
  };
})(window.WL);
