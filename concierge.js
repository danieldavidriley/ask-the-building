/* "Ask the building" concept: a buyer concierge for a preconstruction project that answers only
   from the developer's approved documents. The project, people and documents are invented.
   No network calls; everything runs in the page. */
(function () {
  'use strict';
  var root = document.querySelector('[data-ab]');
  if (!root) return;
  var app = root.querySelector('[data-app]');
  var ruleEl = root.querySelector('[data-rule]');
  var live = root.querySelector('[data-live]');
  var tabs = Array.prototype.slice.call(root.querySelectorAll('[role="tab"]'));
  var playBtn = root.querySelector('[data-play]');
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var DOCS = {
    ff: { name: 'Fast facts', v: 'v4', date: 'Jun 12' },
    sa: { name: 'Features and finishes', v: 'v3', date: 'May 30' },
    fp: { name: 'Floor plans', v: 'v2', date: 'Jun 12' },
    br: { name: 'Sales brochure', v: 'v1', date: 'printed Mar 3' },
    ng: { name: 'Neighbourhood guide', v: 'v1', date: 'Apr 8' }
  };
  var FACTS = {
    ceiling: { q: 'What are the ceiling heights?', a: 'Ceilings are 9 ft on floors one to three and 10 ft on the penthouse floor.', src: 'ff', ex: 'Ceiling heights: 9′ on floors 1–3; 10′ on the penthouse floor.' },
    parking: { q: 'Is parking included?', a: 'Each residence includes one underground parking space, with EV charging roughed in.', src: 'ff', ex: 'Parking: one underground space per residence. EV charging roughed in for every space.' },
    occupancy: { q: 'When can I move in?', a: 'Tentative occupancy is the third quarter of 2028. The date can move during construction; the sales team confirms it in writing.', src: 'ff', ex: 'Tentative occupancy: Q3 2028.' },
    kitchen: { q: 'What comes in the kitchen?', a: 'Kitchens include an integrated appliance package (induction cooktop, wall oven, panelled fridge and dishwasher) with quartz counters.', src: 'sa', ex: 'Kitchen: integrated appliance package (induction cooktop, wall oven, panelled refrigerator, dishwasher). Quartz counters and backsplash.' },
    fireplace: { a: 'The standard is a linear gas fireplace in the great room.', src: 'sa', ex: 'Great room: 48″ linear gas fireplace.' },
    count: { a: 'The Wren has 9 residences on four floors.', src: 'ff', ex: 'Residences: 9, on four floors.' }
  };
  var Q = {
    handoff: 'Is suite 302 still available, and what’s the price?',
    unknown: 'Can I switch to a wood-burning fireplace?',
    conflict: 'How many residences are in the building?'
  };
  var RULES = {
    ready: 'Rule: before the first question, say what the assistant has read and what it will not answer.',
    answered: 'Rule: answer only from approved documents, and show the source and its version with every answer.',
    handoff: 'Rule: price, availability and incentives go to a person. Pass the context on, with the buyer’s consent, so nobody asks twice.',
    unknown: 'Rule: when the documents don’t cover it, answer the part they do, say so, and send the rest to someone who knows.',
    conflict: 'Rule: when two approved documents disagree, don’t pick one. Tell the buyer it’s being checked and alert the team.',
    resolved: 'Rule: the team decides which source is current. Record who decided and why, retire the old version, and update the buyers who asked.'
  };

  var S, timers = [];
  function reset() {
    S = { state: 'ready', msgs: [], typing: false, open: null, handoff: 'none', consent: false, contact: 'Email',
      unknown: 'open', faq: '', leadQ: '', conflict: 'none', pick: null, retired: false, inbox: [], audit: [], toast: '' };
  }
  function clearTimers() { timers.forEach(clearTimeout); timers = []; }
  function later(fn, ms) { timers.push(setTimeout(fn, reduce ? Math.min(ms, 60) : ms)); }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function docLabel(id) { var d = DOCS[id]; return d.name + ' ' + d.v + ' · ' + d.date; }

  /* ---------- Message builders ---------- */
  function buyer(text) { return { who: 'buyer', text: text }; }
  function answer(key, extra) { var f = FACTS[key]; return { who: 'bot', kind: 'answer', id: key + S.msgs.length, text: f.a + (extra || ''), src: f.src, ex: f.ex }; }
  function suiteOf(q) { var m = /suite\s*(\d{3})/i.exec(q || ''); return m ? m[1] : null; }
  function botHandoff(q) { var s = suiteOf(q); S.leadQ = q; return { who: 'bot', kind: 'handoff', text: 'Prices and availability change daily, so I don’t quote them here. Someone on the sales team can confirm ' + (s ? 'both for suite ' + s : 'that') + ' today.' }; }
  function botUnknown(q) {
    if (/fireplace|wood/i.test(q)) {
      return { who: 'bot', kind: 'unknown', id: 'fp' + S.msgs.length, text: FACTS.fireplace.a + ' The documents don’t say whether a wood-burning one is possible, so I won’t guess. I’ve sent your question to the team and will email you their answer.', src: 'sa', ex: FACTS.fireplace.ex };
    }
    return { who: 'bot', kind: 'unknown', text: 'The approved documents don’t cover that, so I won’t guess. I’ve sent your question to the team and will email you their answer.' };
  }
  function botConflict() { return { who: 'bot', kind: 'conflict', text: 'Two of our documents give different numbers: the June fast facts and the brochure printed in March. I’ve asked the team to confirm before I answer. You’ll get the confirmed number by email.' }; }

  /* ---------- Inbox items ---------- */
  function leadItem() { return { type: 'lead', t: 'Just now' }; }
  function unknownItem(q) { return { type: 'unknown', q: q, t: 'Just now' }; }
  function conflictItem(t) { return { type: 'conflict', t: t || 'Just now' }; }
  function askedBefore() {
    var out = [];
    S.msgs.forEach(function (m, i) { if (m.who === 'bot' && m.kind === 'answer' && S.msgs[i - 1]) out.push('“' + S.msgs[i - 1].text + '” (answered from ' + DOCS[m.src].name + ' ' + DOCS[m.src].v + ')'); });
    return out.length ? out.join('; ') : 'Nothing else yet';
  }
  function hasItem(type) { return S.inbox.some(function (i) { return i.type === type; }); }

  /* ---------- Rendering: buyer pane ---------- */
  function srcChip(m) {
    if (!m.src) return '';
    var open = S.open === m.id;
    return '<div class="ab-src"><span class="ab-src-k">Source</span><span class="ab-chip">' + esc(docLabel(m.src)) + '</span>' +
      (m.ex ? '<button type="button" class="ab-link" data-src="' + m.id + '" aria-expanded="' + open + '">' + (open ? 'Hide the line' : 'Show the line') + '</button>' : '') + '</div>' +
      (open ? '<blockquote class="ab-quote">“' + esc(m.ex) + '”</blockquote>' : '');
  }
  function msgHtml(m) {
    if (m.who === 'buyer') return '<li class="ab-msg ab-msg--buyer"><span class="ab-sr">You:</span><p>' + esc(m.text) + '</p></li>';
    var cls = 'ab-msg ab-msg--bot' + (m.kind ? ' ab-msg--' + m.kind : '');
    var head = { conflict: 'Being checked', unknown: 'Sent to the team', update: 'Confirmed by the sales team', faq: 'Answer from the team' }[m.kind];
    var html = '<li class="' + cls + '"><span class="ab-sr">Concierge:</span>' + (head ? '<span class="ab-flag">' + head + '</span>' : '') + '<p>' + esc(m.text) + '</p>' + srcChip(m);
    if (m.kind === 'handoff') html += handoffCard();
    return html + '</li>';
  }
  function handoffCard() {
    if (S.handoff === 'sent') {
      return '<div class="ab-card ab-card--done" role="status"><b>Sent to the sales team.</b> Ana R. will reply by ' + esc(S.contact.toLowerCase()) + ' today.' + (S.consent ? ' She can see this conversation, so you won’t need to repeat yourself.' : '') + '</div>';
    }
    return '<form class="ab-card" data-handoff-form><b class="ab-card-h">Ask the sales team' + (suiteOf(S.leadQ) ? ' about suite ' + suiteOf(S.leadQ) : '') + '</b>' +
      '<label class="ab-check"><input type="checkbox" name="consent"' + (S.consent ? ' checked' : '') + '> Share this conversation with them, so you don’t have to repeat yourself</label>' +
      '<fieldset class="ab-radio"><legend>Reply by</legend>' + ['Email', 'Text'].map(function (c) {
        return '<label><input type="radio" name="contact" value="' + c + '"' + (S.contact === c ? ' checked' : '') + '> ' + c + '</label>';
      }).join('') + '</fieldset>' +
      '<button type="submit" class="ab-btn ab-btn--gold">Ask the sales team</button></form>';
  }
  function buyerPane() {
    var html = '<section class="ab-buyer" aria-label="Buyer view: concierge on the project website">' +
      '<div class="ab-bhead"><div class="ab-mark" aria-hidden="true">W</div><div><b>The Wren</b><span>Ask the building</span></div><span class="ab-pill">Buyer view</span></div>' +
      '<div class="ab-bbody" id="ab-bbody" tabindex="0" role="region" aria-label="Conversation area">';
    if (!S.msgs.length) {
      html += '<div class="ab-welcome"><h3>Questions about The Wren?</h3><p>I answer from the developer’s approved documents and show where each answer comes from. For prices, availability and incentives, I’ll connect you with the sales team.</p></div>' +
        '<div class="ab-read"><span class="ab-read-k">What I’ve read</span><ul>' +
        ['ff', 'sa', 'fp', 'br', 'ng'].map(function (k) { return '<li' + (S.retired && k === 'br' ? ' class="is-retired"' : '') + '>' + esc(DOCS[k].name) + ' <small>' + esc(DOCS[k].v + ' · ' + DOCS[k].date) + (S.retired && k === 'br' ? ' · retired' : '') + '</small></li>'; }).join('') +
        '</ul></div>';
    } else {
      html += '<ol class="ab-thread" aria-label="Conversation">' + S.msgs.map(msgHtml).join('') +
        (S.typing ? '<li class="ab-msg ab-msg--bot ab-typing"><span class="ab-sr">Concierge is answering</span><i></i><i></i><i></i></li>' : '') + '</ol>';
    }
    html += '<div class="ab-chips" aria-label="Suggested questions">' +
      '<button type="button" class="ab-qchip" data-ask="ceiling">' + esc(FACTS.ceiling.q) + '</button>' +
      '<button type="button" class="ab-qchip" data-ask="handoff">' + esc(Q.handoff) + '</button>' +
      '<button type="button" class="ab-qchip" data-ask="unknown">' + esc(Q.unknown) + '</button>' +
      '<button type="button" class="ab-qchip" data-ask="conflict">' + esc(Q.conflict) + '</button></div>';
    if (S.inbox.length) html += '<a class="ab-jump" href="#ab-team">Team view updated <span aria-hidden="true">↓</span></a>';
    html += '</div><form class="ab-composer" data-composer><label class="ab-sr" for="ab-input">Ask about The Wren</label><input id="ab-input" name="q" autocomplete="off" placeholder="Ask about The Wren…"' + (S.typing ? ' disabled' : '') + '><button type="submit"' + (S.typing ? ' disabled' : '') + '>Ask</button></form></section>';
    return html;
  }

  /* ---------- Rendering: team pane ---------- */
  function itemHtml(i) {
    if (i.type === 'lead') {
      return '<li class="ab-item"><div class="ab-item-h"><span class="ab-tag ab-tag--lead">New lead</span><span>' + esc(i.t) + '</span></div>' +
        '<p><b>Asked: “' + esc(S.leadQ || Q.handoff) + '”</b></p>' +
        '<dl class="ab-dl"><dt>Asked before</dt><dd>' + esc(askedBefore()) + '</dd>' + (suiteOf(S.leadQ) ? '<dt>Looked at</dt><dd>Floor plan ' + suiteOf(S.leadQ) + '</dd>' : '') + '<dt>Reply by</dt><dd>' + esc(S.contact) + '</dd><dt>Conversation</dt><dd>' + (S.consent ? 'Shared by the buyer' : 'Not shared') + '</dd></dl>' +
        '<p class="ab-meta">Assigned to Ana R. · Reply today</p></li>';
    }
    if (i.type === 'unknown') {
      var body = '<li class="ab-item"><div class="ab-item-h"><span class="ab-tag ab-tag--q">Not in documents</span><span>' + esc(i.t) + '</span></div><p><b>“' + esc(i.q) + '”</b></p>';
      if (S.unknown === 'answered') return body + '<p class="ab-meta ab-meta--ok">Answered and added to the approved FAQ. Buyer emailed.</p></li>';
      if (S.unknown === 'writing') {
        return body + '<form class="ab-form" data-faq-form><label for="ab-faq">Answer for the buyer and the approved FAQ</label><textarea id="ab-faq" name="faq" rows="3" required placeholder="e.g. Not in this building. Gas only, for venting and insurance reasons."></textarea>' +
          '<span class="ab-row"><button type="submit" class="ab-btn ab-btn--dark">Send and add to FAQ</button><button type="button" class="ab-btn" data-cancel>Cancel</button></span></form></li>';
      }
      return body + '<p class="ab-meta">Answer once and the concierge can use it for the next buyer.</p><span class="ab-row"><button type="button" class="ab-btn ab-btn--dark" data-write>Write the answer</button></span></li>';
    }
    if (i.type === 'conflict') {
      var h = '<li class="ab-item ab-item--conflict"><div class="ab-item-h"><span class="ab-tag ab-tag--conflict">Sources disagree</span><span>' + esc(i.t) + '</span></div>' +
        '<p><b>Residence count.</b> The concierge paused this answer for 2 buyers.</p>' +
        '<div class="ab-compare"><div' + (S.pick === 'ff' ? ' class="is-picked"' : '') + '><span>' + esc(docLabel('ff')) + '</span><q>Residences: 9, on four floors.</q></div>' +
        '<div' + (S.pick === 'br' ? ' class="is-picked"' : '') + (S.retired ? ' data-retired' : '') + '><span>' + esc(docLabel('br')) + '</span><q>Only 10 residences on four floors.</q></div></div>';
      if (S.conflict === 'resolved') return h + '<p class="ab-meta ab-meta--ok">Resolved by Ana R.: Fast facts v4 is current. Sales brochure v1 retired.</p></li>';
      if (S.conflict === 'deciding') {
        return h + '<form class="ab-form" data-resolve-form><p class="ab-meta">You picked <b>' + esc(docLabel(S.pick)) + '</b> as current.</p>' +
          '<label for="ab-reason">Why? Buyers won’t see this; the team and auditors will.</label><input id="ab-reason" name="reason" required placeholder="e.g. Suites 401 and 402 combined in the June redesign">' +
          '<label class="ab-check ab-check--ink"><input type="checkbox" name="retire" checked> Retire the other document from the concierge</label>' +
          '<span class="ab-row"><button type="submit" class="ab-btn ab-btn--dark">Confirm and update buyers</button><button type="button" class="ab-btn" data-cancel>Cancel</button></span></form></li>';
      }
      return h + '<p class="ab-meta">Which one is current?</p><span class="ab-row"><button type="button" class="ab-btn ab-btn--dark" data-pick="ff">Fast facts v4</button><button type="button" class="ab-btn" data-pick="br">Sales brochure v1</button></span></li>';
    }
    return '';
  }
  function teamPane() {
    var html = '<section class="ab-team" id="ab-team" aria-label="Sales team view"><div class="ab-thead"><b>Sales team</b><span>The Wren · Ashgrove Developments</span><span class="ab-pill ab-pill--ink">Team view</span></div><div class="ab-tbody" id="ab-tbody" tabindex="0" role="region" aria-label="Team view content">';
    html += '<div class="ab-block"><h3 class="ab-bh">Inbox</h3>' + (S.inbox.length ? '<ol class="ab-inbox">' + S.inbox.map(itemHtml).join('') + '</ol>' : '<p class="ab-empty">Nothing needs you. The concierge is answering from approved documents.</p>') + '</div>';
    if (S.audit.length) html += '<div class="ab-block"><h3 class="ab-bh">Audit trail</h3><ol class="ab-audit">' + S.audit.map(function (a) { return '<li><span>' + esc(a.t) + '</span><div>' + a.html + '</div></li>'; }).join('') + '</ol></div>';
    html += '<div class="ab-block"><h3 class="ab-bh">Approved documents</h3><ul class="ab-lib">' + ['ff', 'sa', 'fp', 'br', 'ng'].map(function (k) {
      var st = (S.retired && k === 'br') ? '<span class="ab-st ab-st--off">Retired</span>' : (S.conflict !== 'none' && S.conflict !== 'resolved' && (k === 'ff' || k === 'br')) ? '<span class="ab-st ab-st--warn">In conflict</span>' : '<span class="ab-st">In use</span>';
      return '<li><span>' + esc(DOCS[k].name) + ' <small>' + esc(DOCS[k].v + ' · ' + DOCS[k].date) + '</small></span>' + st + '</li>';
    }).join('') + (S.unknown === 'answered' ? '<li><span>Approved FAQ <small>v1 · today</small></span><span class="ab-st ab-st--new">New</span></li>' : '') + '</ul></div>';
    return html + '</div></section>';
  }

  function focusKey() {
    var a = document.activeElement;
    if (!a || !app.contains(a)) return null;
    var attrs = ['data-ask', 'data-src', 'data-pick', 'data-write', 'data-cancel'];
    for (var i = 0; i < attrs.length; i++) if (a.hasAttribute(attrs[i])) { var v = a.getAttribute(attrs[i]); return '[' + attrs[i] + (v ? '="' + v + '"' : '') + ']'; }
    return a.id ? '#' + a.id : null;
  }
  function announce(msg) { if (live && msg && live.textContent !== msg) live.textContent = msg; }
  function render(msg) {
    var key = focusKey();
    app.innerHTML = '<div class="ab-grid">' + buyerPane() + teamPane() + '</div>' + (S.toast ? '<div class="ab-toast" role="status">' + esc(S.toast) + '</div>' : '');
    if (key) { var el = app.querySelector(key); (el || app).focus(); }
    var thread = app.querySelector('.ab-bbody'); if (thread && S.msgs.length) thread.scrollTop = thread.scrollHeight;
    announce(msg || S.toast);
    ruleEl.textContent = RULES[S.state];
    tabs.forEach(function (t) {
      var on = t.getAttribute('data-state') === S.state;
      t.setAttribute('aria-selected', on ? 'true' : 'false');
      t.tabIndex = on ? 0 : -1;
    });
  }

  /* ---------- Conversation flow ---------- */
  function reply(state, q, botMsg, after) {
    S.state = state; S.msgs.push(buyer(q)); S.typing = true; S.toast = ''; render('Concierge is answering.');
    later(function () {
      S.typing = false; S.msgs.push(botMsg); if (after) after();
      render('Concierge: ' + botMsg.text);
    }, 900);
  }
  function classify(q) {
    if (/price|cost|availab|incentive|deposit|discount|sold/i.test(q)) return 'handoff';
    if (/how many|number of|residences|units|suites in/i.test(q)) return 'conflict';
    if (/ceiling|height/i.test(q)) return 'ceiling';
    if (/park|\bev\b|charg|garage/i.test(q)) return 'parking';
    if (/occup|move in|completion|finish date|ready/i.test(q)) return 'occupancy';
    if (/kitchen|applian|fridge|oven|cooktop|counter/i.test(q)) return 'kitchen';
    return 'unknown';
  }
  function ask(kind, text) {
    clearTimers();
    if (kind === 'handoff') { S.handoff = 'none'; reply('handoff', text || Q.handoff, botHandoff(text || Q.handoff)); return; }
    if (kind === 'unknown') {
      var q = text || Q.unknown;
      reply('unknown', q, botUnknown(q), function () {
        S.unknown = 'open'; S.inbox = S.inbox.filter(function (i) { return i.type !== 'unknown'; }); S.inbox.unshift(unknownItem(q));
      });
      return;
    }
    if (kind === 'conflict') {
      if (S.conflict === 'resolved') { reply('resolved', text || Q.conflict, answer('count')); return; }
      reply('conflict', text || Q.conflict, botConflict(), function () {
        S.conflict = 'open'; if (!hasItem('conflict')) S.inbox.unshift(conflictItem());
        if (!S.audit.some(function (a) { return a.html.indexOf('Conflict found') === 0; })) S.audit.push({ t: 'Just now', html: 'Conflict found: residence count. <b>Fast facts v4</b> says 9; <b>Sales brochure v1</b> says 10. Answer paused.' });
      });
      return;
    }
    reply('answered', text || FACTS[kind].q, answer(kind));
  }

  /* ---------- Preset states (tabs) ---------- */
  function go(state) {
    clearTimers(); reset(); S.state = state;
    if (state === 'answered') S.msgs = [buyer(FACTS.ceiling.q), answer('ceiling')], S.open = S.msgs[1].id;
    if (state === 'handoff') S.msgs = [buyer(FACTS.ceiling.q), answer('ceiling'), buyer(Q.handoff), botHandoff(Q.handoff)];
    if (state === 'unknown') { S.msgs = [buyer(Q.unknown)]; S.msgs.push(botUnknown(Q.unknown)); S.inbox = [unknownItem(Q.unknown)]; }
    if (state === 'conflict' || state === 'resolved') {
      S.msgs = [buyer(Q.conflict), botConflict()]; S.conflict = 'open'; S.inbox = [conflictItem('Jun 14 09:12')];
      S.audit = [{ t: 'Jun 14 09:12', html: 'Conflict found: residence count. <b>Fast facts v4</b> says 9; <b>Sales brochure v1</b> says 10. Answer paused.' }];
    }
    if (state === 'resolved') resolve('ff', 'Suites 401 and 402 combined into one penthouse in the June redesign.', true, true);
    render({ ready: 'Ready. Ask a question or pick one.', answered: 'Answered with its source.', handoff: 'Price question handed to the sales team.', unknown: 'Question not covered by the documents. Sent to the team.', conflict: 'Sources disagree. Answer paused and the team alerted.', resolved: 'Team resolved the conflict. Buyers updated.' }[state]);
  }
  function resolve(pick, reason, retire, preset) {
    S.pick = pick; S.conflict = 'resolved'; S.retired = !!retire && pick === 'ff'; S.state = 'resolved';
    var other = pick === 'ff' ? 'br' : 'ff';
    var t = preset ? 'Jun 14 10:05' : 'Just now';
    S.audit.push({ t: t, html: 'Ana R. confirmed <b>' + esc(docLabel(pick)) + '</b> as current. Reason: “' + esc(reason) + '”' });
    if (retire) S.audit.push({ t: t, html: '<b>' + esc(DOCS[other].name + ' ' + DOCS[other].v) + '</b> retired from the concierge. Reprint flagged to marketing.' });
    S.audit.push({ t: t, html: '2 buyers who asked were emailed the confirmed answer.' });
    var f = pick === 'ff' ? FACTS.count : { a: 'The Wren has 10 residences on four floors.', src: 'br', ex: 'Only 10 residences on four floors.' };
    S.msgs.push({ who: 'bot', kind: 'update', id: 'upd', text: f.a, src: f.src, ex: f.ex });
  }

  /* ---------- Events ---------- */
  app.addEventListener('click', function (e) {
    var b = e.target.closest('button');
    if (!b || b.type === 'submit') return;
    S.toast = '';
    if (b.hasAttribute('data-ask')) { stopPlay(); ask(b.getAttribute('data-ask')); return; }
    if (b.hasAttribute('data-src')) { var id = b.getAttribute('data-src'); S.open = S.open === id ? null : id; render(); return; }
    if (b.hasAttribute('data-write')) { S.unknown = 'writing'; render(); var ta = app.querySelector('#ab-faq'); if (ta) ta.focus(); return; }
    if (b.hasAttribute('data-pick')) { S.pick = b.getAttribute('data-pick'); S.conflict = 'deciding'; render(); var r = app.querySelector('#ab-reason'); if (r) r.focus(); return; }
    if (b.hasAttribute('data-cancel')) { if (S.unknown === 'writing') S.unknown = 'open'; if (S.conflict === 'deciding') { S.conflict = 'open'; S.pick = null; } render(); return; }
  });
  app.addEventListener('change', function (e) {
    var t = e.target;
    if (t.name === 'consent') S.consent = t.checked;
    if (t.name === 'contact') S.contact = t.value;
  });
  app.addEventListener('submit', function (e) {
    e.preventDefault();
    var f = e.target;
    if (f.hasAttribute('data-composer')) {
      var q = (f.q.value || '').trim();
      if (!q) { f.q.focus(); return; }
      stopPlay(); ask(classify(q), q);
      var inp = app.querySelector('#ab-input'); if (inp) inp.focus();
      return;
    }
    if (f.hasAttribute('data-handoff-form')) {
      S.handoff = 'sent';
      if (!hasItem('lead')) S.inbox.unshift(leadItem());
      render('Sent to the sales team. Ana R. will reply today.');
      return;
    }
    if (f.hasAttribute('data-faq-form')) {
      var a = (f.faq.value || '').trim();
      if (!a) { f.faq.focus(); return; }
      S.unknown = 'answered';
      S.audit.push({ t: 'Just now', html: 'Answer added to <b>Approved FAQ v1</b>: “' + esc(a) + '” Buyer emailed.' });
      S.msgs.push({ who: 'bot', kind: 'faq', text: a, src: null });
      render('Answer sent to the buyer and added to the approved FAQ.');
      return;
    }
    if (f.hasAttribute('data-resolve-form')) {
      var reason = (f.reason.value || '').trim();
      if (!reason) { f.reason.focus(); return; }
      resolve(S.pick, reason, f.retire.checked, false);
      render('Conflict resolved. Buyers who asked were updated.');
    }
  });

  tabs.forEach(function (t, i) {
    t.addEventListener('click', function () { stopPlay(); go(t.getAttribute('data-state')); });
    t.addEventListener('keydown', function (e) {
      var n = null;
      if (e.key === 'ArrowRight') n = (i + 1) % tabs.length;
      if (e.key === 'ArrowLeft') n = (i - 1 + tabs.length) % tabs.length;
      if (e.key === 'Home') n = 0;
      if (e.key === 'End') n = tabs.length - 1;
      if (n !== null) { e.preventDefault(); tabs[n].focus(); stopPlay(); go(tabs[n].getAttribute('data-state')); }
    });
  });

  /* ---------- Play the full flow ---------- */
  var playing = false, playTimers = [];
  function stopPlay() { if (!playing) return; playing = false; playTimers.forEach(clearTimeout); playTimers = []; playBtn.textContent = 'Play the full flow'; playBtn.setAttribute('aria-pressed', 'false'); }
  function at(fn, ms) { playTimers.push(setTimeout(fn, ms)); }
  playBtn.addEventListener('click', function () {
    if (playing) { stopPlay(); return; }
    go('ready');
    playing = true; playBtn.textContent = 'Stop playing'; playBtn.setAttribute('aria-pressed', 'true');
    at(function () { ask('ceiling'); }, 1800);
    at(function () { S.open = S.msgs[1] && S.msgs[1].id; render(); }, 3400);
    at(function () { ask('handoff'); }, 5200);
    at(function () { S.consent = true; render(); }, 7200);
    at(function () { S.handoff = 'sent'; if (!hasItem('lead')) S.inbox.unshift(leadItem()); render('Sent to the sales team.'); }, 8200);
    at(function () { ask('unknown'); }, 10200);
    at(function () { ask('conflict'); }, 13400);
    at(function () { S.pick = 'ff'; S.conflict = 'deciding'; render(); }, 16400);
    at(function () { resolve('ff', 'Suites 401 and 402 combined into one penthouse in the June redesign.', true, false); render('Conflict resolved. Buyers updated.'); }, 18600);
    at(function () { stopPlay(); }, 19200);
  });

  reset();
  render();
})();
