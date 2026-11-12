// Fills the progress summary on the home page from what this browser has saved:
// the cards app leaves its counts here, and the IPA and listening pages already store their progress.
(function () {
  var root = document.querySelector('[data-home-progress]');
  if (!root) return;
  var q = function (name) { return root.querySelector('[data-home-' + name + ']'); };
  var read = function (key) { try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch (e) { return null; } };
  var bar = function (name, share) { q(name).style.width = Math.round(Math.max(0, Math.min(1, share)) * 100) + '%'; };

  // Cards: the due dates were saved when the cards page was last open, so the count is right for now.
  var cards = read('saymore.home.cards.v1');
  if (cards && Array.isArray(cards.due)) {
    var now = Date.now();
    q('due').textContent = cards.due.filter(function (at) { return at <= now; }).length;
    var when = new Intl.DateTimeFormat('ko-KR', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(cards.at));
    q('cards-note').textContent = '새 카드 ' + cards.fresh + ' · 전체 ' + cards.total + ' · ' + when + ' 기준';
  }

  var ipa = read('saymore.ipa.progress.v1'), total = Number(read('saymore.ipa.total')) || Number(root.dataset.ipaTotal) || 0, known = 0;
  if (ipa && ipa.items) for (var id in ipa.items) if (ipa.items[id] && ipa.items[id].mastered === true) known++;
  q('ipa').textContent = known; q('ipa-total').textContent = total;
  bar('ipa-bar', total ? known / total : 0);

  var listen = read('saymore.listen.v1'), attempts = 0, correct = 0;
  if (listen && listen.sets) for (var set in listen.sets) { attempts += listen.sets[set].attempts || 0; correct += listen.sets[set].correct || 0; }
  if (attempts) {
    q('listen').textContent = Math.round(correct / attempts * 100);
    q('listen-note').textContent = attempts + '문제 풂';
    bar('listen-bar', correct / attempts);
  }
})();
