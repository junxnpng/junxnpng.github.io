// Fills the progress summary on the home page from what this browser has saved, and from Dropbox when connected:
// the cards app leaves its counts here, and the IPA and listening pages already store their progress.
(function () {
  var root = document.querySelector('[data-home-progress]');
  if (!root) return;
  var q = function (name) { return root.querySelector('[data-home-' + name + ']'); };
  var read = function (key) { try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch (e) { return null; } };
  var connected = function () { try { return Boolean(localStorage.getItem('saymore.dropbox.auth.v1')); } catch (e) { return false; } };
  var bar = function (name, share) { q(name).style.width = Math.round(Math.max(0, Math.min(1, share)) * 100) + '%'; };

  function fill(ipaOverride) {

  // What is left to do: every card never seen (`fresh`) plus every seen card whose review has come due.
  // There is no daily limit on new cards; a `limit` saved by an older copy of the cards page is ignored.
  var left = function (part, now) { return (Number(part.fresh) || 0) + part.due.filter(function (at) { return at <= now; }).length; };
  // Cards: the due dates were saved when the cards page was last open, so the count is right for now.
  var cards = read('saymore.home.cards.v1');
  // The counts may come from another device through Dropbox; anything malformed is left out.
  if (cards && (!Array.isArray(cards.due) || !isFinite(new Date(cards.at)))) cards = null;
  if (cards && Array.isArray(cards.due)) {
    var now = Date.now();
    q('due').textContent = left(cards, now);
    var when = new Intl.DateTimeFormat('ko-KR', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(cards.at));
    q('cards-note').textContent = '안 본 카드 ' + cards.fresh + ' · 복습할 카드 ' + (left(cards, now) - cards.fresh) + ' · 전체 ' + cards.total + ' · ' + when + ' 기준';
  }

  // The word-form and word-order tabs: what is due now, from the same saved counts.
  var rows = document.querySelectorAll('[data-home-section]');
  for (var i = 0; i < rows.length; i++) {
    var part = cards && cards.sections && cards.sections[rows[i].getAttribute('data-home-section')];
    if (!part || !part.total || !Array.isArray(part.due)) continue;
    var waiting = left(part, Date.now());
    rows[i].textContent = '지금 볼 카드 ' + waiting + ' · 전체 ' + part.total;
  }

  var ipa = ipaOverride || read('saymore.ipa.progress.v1'), total = Number(read('saymore.ipa.total')) || Number(root.dataset.ipaTotal) || 0, known = 0;
  if (ipa && ipa.items) for (var id in ipa.items) if (ipa.items[id] && ipa.items[id].mastered === true) known++;
  q('ipa').textContent = known; q('ipa-total').textContent = total;
  bar('ipa-bar', total ? known / total : 0);

  // This browser's own answers plus those of every other browser, as last read from Dropbox.
  var listen = read('saymore.listen.v1'), others = connected() ? read('saymore.listen.others.v1') : null, attempts = 0, correct = 0;
  var add = function (sets) { if (sets) for (var set in sets) { attempts += sets[set].attempts || 0; correct += sets[set].correct || 0; } };
  add(listen && listen.sets); add(others);
  if (attempts) {
    q('listen').textContent = Math.round(correct / attempts * 100);
    q('listen-note').textContent = attempts + '문제 풂';
    bar('listen-bar', correct / attempts);
  }
  }
  fill();
  // What other devices did is in Dropbox, not in this browser. When this browser is connected, the small files
  // are read: the IPA record is merged into the one kept here (as the IPA page would), the shared settings
  // bring the newest card counts, and the listening counts of other browsers are added.
  // Nothing on this page changes them, so the IPA and listening records are only read here.
  function fromCloud() {
    try { if (!localStorage.getItem('saymore.dropbox.auth.v1')) return; } catch (e) { return; }
    var cloud, sync;
    Promise.all([import('/saymore/shared/dropbox.mjs?v=8'), import('/saymore/shared/sync.mjs?v=3')]).then(function (m) {
      sync = m[1];
      return m[0].openDropbox();
    }).then(function (c) {
      cloud = c;
      if (!cloud.connected) return;
      var own = read('saymore.listen.v1');
      return Promise.all([
        ipaFromCloud(cloud).catch(function () { return null; }),
        sync.syncSettings(cloud).catch(function () { return null; }),
        sync.syncListen(cloud, own && own.sets, { write: false }).catch(function () { return null; })
      ]).then(function (done) { fill(done[0] || undefined); });
    }).catch(function () { /* The numbers saved in this browser stay on screen. */ });
  }
  function ipaFromCloud(cloud) {
    var core = window.SayMoreProgress;
    if (!core) return Promise.resolve(null);
    return cloud.download('/ipa-progress.json').then(function (file) { return file ? file.text() : null; }).then(function (text) {
      if (!text) return null;
      var local = core.empty();
      try { var raw = localStorage.getItem('saymore.ipa.progress.v1'); if (raw) local = core.parse(raw); } catch (e) { /* An unreadable local record is left to the IPA page. */ return null; }
      var merged = core.merge(local, core.parse(text));
      try { localStorage.setItem('saymore.ipa.progress.v1', core.serialize(merged)); } catch (e) { /* Shown once, not kept. */ }
      return merged;
    });
  }
  fromCloud();
  // Going back to this page restores it as it was; the numbers may have moved since.
  window.addEventListener('pageshow', function (event) { if (event.persisted) fill(); });
})();
