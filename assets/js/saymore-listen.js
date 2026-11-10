(() => {
  "use strict";
  const root = document.querySelector("[data-listen]");
  const core = globalThis.SayMoreListen;
  if (!root || !core) return;
  const KEY = "saymore.listen.v1";
  const ROUND = 10;
  const sets = JSON.parse(document.getElementById("listen-data").textContent).sets;
  const $ = name => root.querySelector(`[data-listen-${name}]`);
  const choices = [...root.querySelectorAll("[data-listen-choice]")];
  let state = core.parse(readStore());
  let voice = null, trial = null, answered = false, done = 0, score = 0, speaking = 0;

  function readStore() { try { return localStorage.getItem(KEY) || ""; } catch { return ""; } }
  function writeStore() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* private mode: keep this round in memory */ } }
  const status = message => { $("status").textContent = message; };

  async function loadVoice() {
    const synth = window.speechSynthesis;
    if (!synth || !window.SpeechSynthesisUtterance) return null;
    const { usVoice } = await import("/saymore/cards/speech.mjs?v=2");
    if (!usVoice(synth.getVoices())) {
      await new Promise(resolve => {
        const finish = () => { clearTimeout(timer); resolve(); };
        const timer = setTimeout(finish, 1500);
        synth.addEventListener("voiceschanged", finish, { once: true });
      });
    }
    return usVoice(synth.getVoices());
  }

  function say(word) {
    const ticket = ++speaking;
    return new Promise(resolve => {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(word);
      utterance.voice = voice; utterance.lang = "en-US"; utterance.rate = 0.8;
      utterance.onend = utterance.onerror = () => resolve(ticket === speaking);
      window.speechSynthesis.speak(utterance);
    });
  }
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

  function renderStats() {
    for (const set of sets) {
      const row = root.querySelector(`[data-listen-row="${set.id}"]`);
      const item = state.sets[set.id];
      row.querySelector("[data-listen-attempts]").textContent = item?.attempts || 0;
      row.querySelector("[data-listen-accuracy]").textContent = item?.attempts ? `${Math.round(100 * item.correct / item.attempts)}%` : "–";
      row.classList.toggle("is-weak", Boolean(item && item.attempts >= 5 && item.correct / item.attempts < 0.8));
    }
  }

  function activeSets() {
    const id = $("set").value;
    return id === "all" ? sets : sets.filter(set => set.id === id);
  }

  function showTrial() {
    trial = core.nextTrial(activeSets(), state, trial);
    answered = false;
    $("progress").textContent = `${done + 1} / ${ROUND}`;
    $("score").textContent = `맞힌 문제 ${score}`;
    $("contrast").textContent = `/${trial.set.sounds[0].symbol}/ ↔ /${trial.set.sounds[1].symbol}/`;
    choices.forEach((button, index) => {
      button.disabled = false;
      button.className = "";
      button.querySelector(".sm-listen-word").textContent = trial.pair[index].word;
      button.querySelector(".sm-listen-ipa").textContent = trial.pair[index].ipa;
    });
    $("feedback").hidden = true;
    $("replay").focus({ preventScroll: true });
    say(trial.pair[trial.answer].word);
  }

  function answer(index) {
    if (!trial || answered) return;
    answered = true;
    const correct = index === trial.answer;
    done++; if (correct) score++;
    state = core.record(state, trial.set.id, correct);
    writeStore(); renderStats();
    choices.forEach((button, i) => {
      button.disabled = true;
      button.classList.toggle("is-correct", i === trial.answer);
      button.classList.toggle("is-wrong", i === index && !correct);
    });
    const heard = trial.pair[trial.answer];
    $("result").textContent = correct ? `맞았어요. ${heard.word} ${heard.ipa}` : `아니에요. 들은 단어는 ${heard.word} ${heard.ipa} 입니다.`;
    $("result").className = correct ? "is-correct" : "is-wrong";
    $("tip").textContent = trial.set.tip;
    $("score").textContent = `맞힌 문제 ${score}`;
    $("next").textContent = done >= ROUND ? "결과 보기" : "다음 문제 →";
    $("feedback").hidden = false;
    if (correct) $("next").focus({ preventScroll: true });
    else compare();
  }

  async function compare() {
    if (!trial) return;
    const order = [trial.answer, 1 - trial.answer, trial.answer];
    for (const index of order) {
      choices.forEach((button, i) => button.classList.toggle("is-speaking", i === index));
      if (!await say(trial.pair[index].word)) break;
      await pause(350);
    }
    choices.forEach(button => button.classList.remove("is-speaking"));
  }

  function finish() {
    window.speechSynthesis.cancel();
    $("trial").hidden = true;
    $("summary").hidden = false;
    $("summary-title").textContent = `${ROUND}문제 중 ${score}문제를 맞혔어요.`;
    $("summary-text").textContent = score === ROUND ? "모두 구별했어요. 다른 소리도 연습해 보세요." : "틀린 소리는 아래 표의 발음 설명에서 입 모양을 확인하고 다시 들어 보세요.";
    $("again").focus({ preventScroll: true });
  }

  async function start() {
    $("start").disabled = true;
    if (!voice) voice = await loadVoice();
    $("start").disabled = false;
    if (!voice) { status("미국식 영어 음성을 찾지 못했어요. 기기 설정에서 영어(미국) 음성을 설치한 뒤 다시 시도해 주세요."); return; }
    status(`음성: ${voice.name} · 기기 합성 음성`);
    done = 0; score = 0; trial = null;
    $("summary").hidden = true;
    $("trial").hidden = false;
    showTrial();
  }

  $("start").addEventListener("click", start);
  $("again").addEventListener("click", start);
  $("replay").addEventListener("click", () => trial && say(trial.pair[trial.answer].word));
  $("compare").addEventListener("click", compare);
  $("next").addEventListener("click", () => (done >= ROUND ? finish() : showTrial()));
  choices.forEach((button, index) => button.addEventListener("click", () => answer(index)));
  $("set").addEventListener("change", () => { if (!$("trial").hidden) start(); });
  document.addEventListener("keydown", event => {
    if ($("trial").hidden || event.metaKey || event.ctrlKey || event.altKey || event.target?.matches?.("select, input, textarea")) return;
    if (event.key === "1" || event.key === "2") { event.preventDefault(); answer(Number(event.key) - 1); }
    else if (event.key === " ") { event.preventDefault(); trial && say(trial.pair[trial.answer].word); }
    else if (event.key === "Enter" && answered) { event.preventDefault(); $("next").click(); }
  });
  window.addEventListener("pagehide", () => window.speechSynthesis?.cancel());
  renderStats();
})();
