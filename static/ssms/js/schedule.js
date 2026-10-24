/* 전산근무표 - 데이터는 브라우저 localStorage("ssms")에 저장한다 */
(() => {
  const $ = (id) => document.getElementById(id);
  const esc = (v) => String(v).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const pad = (n) => String(n).padStart(2, "0");
  const toKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const toDate = (k) => new Date(k.slice(0, 4), k.slice(5, 7) - 1, k.slice(8, 10));
  const WD = "일월화수목금토";
  const fmt = (k) => `${+k.slice(5, 7)}월 ${+k.slice(8, 10)}일 (${WD[toDate(k).getDay()]})`;
  const LABEL = { AM: "오전", PM: "오후", DAY: "종일" };
  const COLOR = { AM: "primary", PM: "point", DAY: "success" };
  const slotsOf = (k) => (toDate(k).getDay() === 5 ? ["DAY"] : ["AM", "PM"]); // 금요일은 종일 한 명
  const say = (msg) => ($("status").textContent = msg);
  const clone = (o) => JSON.parse(JSON.stringify(o));

  let S = {};
  try { S = JSON.parse(localStorage.getItem("ssms")) || {}; } catch (e) { /* 손상된 데이터는 무시 */ }
  S = { members: [], holidays: {}, unavailable: {}, schedule: {}, ...S };
  const save = () => localStorage.setItem("ssms", JSON.stringify(S));
  let Y = new Date().getFullYear(), M = new Date().getMonth() + 1;
  let draft = clone(S.unavailable); // 불가일 등록에서 저장 전 변경 내용

  const isOff = (n, k, s) => (S.unavailable[n] || []).includes(`${k}_${s}`);
  const workdays = () => {
    const days = [];
    for (const d = new Date(Y, M - 1, 1); d.getMonth() === M - 1; d.setDate(d.getDate() + 1)) {
      if (d.getDay() % 6 && !S.holidays[toKey(d)]) days.push(toKey(d));
    }
    return days;
  };
  const newCount = () => Object.fromEntries(S.members.map((n) => [n, { all: 0, AM: 0, PM: 0, DAY: 0 }]));

  /* 자동 편성: 무작위 편성을 300번 해서 가장 공평한 결과를 고른다
     - 불가 시간은 제외하고, 하루에 한 사람은 한 칸만 맡는다
     - 후보가 적은 칸부터 채우고, 근무 수 → 같은 칸 근무 수 → 앞뒤 날 근무가 적은 사람을 고른다
     - 평가: 미배정 > 총 근무 편차 > 종일 편차 > 오전/오후 쏠림 */
  const assign = (days) => {
    let best, bestScore = Infinity;
    for (let t = 0; t < 300; t++) {
      const res = days.map(() => ({}));
      const c = newCount();
      const works = (i, n) => !!res[i] && Object.values(res[i]).includes(n);
      days
        .flatMap((k, i) => slotsOf(k).map((s) => ({ i, s, pool: S.members.filter((n) => !isOff(n, k, s)), r: Math.random() })))
        .sort((a, b) => a.pool.length - b.pool.length || a.r - b.r)
        .forEach(({ i, s, pool }) => {
          const n = pool
            .filter((n) => !works(i, n))
            .map((n) => [c[n].all * 100 + c[n][s] * 10 + works(i - 1, n) + works(i + 1, n) + Math.random(), n])
            .sort((a, b) => a[0] - b[0])[0]?.[1];
          if (n) { res[i][s] = n; c[n].all++; c[n][s]++; }
        });
      const gap = (f) => Math.max(...S.members.map((n) => c[n][f])) - Math.min(...S.members.map((n) => c[n][f]));
      const empty = days.reduce((a, k, i) => a + slotsOf(k).filter((s) => !res[i][s]).length, 0);
      const score = empty * 1e6 + gap("all") * 1e4 + gap("DAY") * 1e3 + S.members.reduce((a, n) => a + Math.abs(c[n].AM - c[n].PM), 0) * 100;
      if (score < bestScore) [best, bestScore] = [res, score];
    }
    return best;
  };

  /* 화면 */
  const renderUnavail = () => {
    const n = $("unavail_member").value, picked = draft[n] || [];
    $("unavail_legend").textContent = `${Y}년 ${M}월 ${n} 근무 불가 시간`;
    $("unavail_list").innerHTML = !n ? "" : workdays().map((k) => `<div role="group" aria-label="${fmt(k)}">${fmt(k)}<span class="krds-check-area">${slotsOf(k).map((s) =>
      `<span class="krds-form-chip small"><input type="checkbox" class="checkbox" id="u_${k}_${s}" value="${k}_${s}"${picked.includes(`${k}_${s}`) ? " checked" : ""}><label class="krds-form-chip-outline" for="u_${k}_${s}">${LABEL[s]}</label></span>`).join("")}</span></div>`).join("");
  };

  const render = () => {
    const title = `${Y}년 ${M}월`, today = toKey(new Date()), c = newCount();
    workdays().forEach((k) => slotsOf(k).forEach((s) => { const n = (S.schedule[k] || {})[s]; if (c[n]) { c[n].all++; c[n][s]++; } }));
    $("month").textContent = title;
    $("cal_caption").textContent = `${title} 전산근무표`;

    let rows = "";
    const d = new Date(Y, M - 1, 1), last = new Date(Y, M, 0);
    d.setDate(1 - d.getDay());
    while (d <= last) {
      rows += "<tr>";
      for (let w = 0; w < 7; w++, d.setDate(d.getDate() + 1)) {
        const k = toKey(d), hol = S.holidays[k], other = d.getMonth() !== M - 1, work = !other && w % 6 && !hol, duty = S.schedule[k];
        const mods = [other && "other", (!w || hol) && "holiday", w === 6 && "saturday", k === today && "today", work && "edit"].filter(Boolean);
        rows += `<td class="ssms-calendar__cell${mods.map((m) => ` ssms-calendar__cell--${m}`).join("")}"${k === today ? ' aria-current="date"' : ""}><div class="ssms-calendar__head">`
          + (work ? `<button type="button" class="ssms-calendar__date" data-date="${k}" aria-label="${fmt(k)} 근무 수정">${d.getDate()}</button>` : `<span class="ssms-calendar__date">${d.getDate()}</span>`)
          + (k === today ? '<span class="krds-badge bg-primary">오늘</span>' : "") + (hol ? `<span class="ssms-calendar__holiday">${esc(hol)}</span>` : "") + "</div>"
          + (!work ? "" : !duty ? "<p>-</p>" : slotsOf(k).map((s) => `<p class="ssms-calendar__item"><span class="krds-badge bg-light-${COLOR[s]}">${LABEL[s]}</span>${duty[s] ? esc(duty[s]) : '<span class="ssms-calendar__none">미배정</span>'}</p>`).join(""))
          + "</td>";
      }
      rows += "</tr>";
    }
    $("cal_body").innerHTML = rows;

    $("member_count").textContent = `${S.members.length}명`;
    $("member_body").innerHTML = S.members.map((n) => `<tr><th scope="row">${esc(n)}</th><td>${c[n].AM}</td><td>${c[n].PM}</td><td>${c[n].DAY}</td></tr>`).join("") || '<tr><td colspan="4">-</td></tr>';
    $("member_list").innerHTML = S.members.map((n) => `<li>${esc(n)}<span class="ssms__buttons">`
      + `<button type="button" class="krds-btn xsmall tertiary" data-edit="${esc(n)}">수정<span class="sr-only"> ${esc(n)}</span></button>`
      + `<button type="button" class="krds-btn xsmall tertiary" data-del="${esc(n)}">삭제<span class="sr-only"> ${esc(n)}</span></button></span></li>`).join("");
    $("holiday_title").textContent = `${title} 공휴일`;
    $("holiday_list").innerHTML = Object.keys(S.holidays).filter((k) => k.startsWith(`${Y}-${pad(M)}`)).sort()
      .map((k) => `<li>${fmt(k)} ${esc(S.holidays[k])}<button type="button" class="krds-btn xsmall tertiary" data-del="${k}">삭제<span class="sr-only"> ${fmt(k)}</span></button></li>`).join("") || "<li>등록된 공휴일이 없습니다.</li>";

    const sel = $("unavail_member"), cur = sel.value;
    sel.innerHTML = S.members.map((n) => `<option>${esc(n)}</option>`).join("");
    if (S.members.includes(cur)) sel.value = cur;
    renderUnavail();
  };

  const move = (d) => { [Y, M] = [d.getFullYear(), d.getMonth() + 1]; render(); };
  $("btn_prev").onclick = () => move(new Date(Y, M - 2, 1));
  $("btn_next").onclick = () => move(new Date(Y, M, 1));
  $("btn_today").onclick = () => move(new Date());
  $("btn_print").onclick = () => print(); // 인쇄용 CSS(@media print)로 달력만 출력

  /* KRDS 모달: 스크립트로 열고, 닫힐 때 trigger로 초점이 돌아가도록 ui-script.js와 같은 표시를 붙인다 */
  const openModal = (id, trigger) => { trigger.classList.add("modal-opened"); trigger.dataset.modalId = id; krds_modal.openModal(id); };
  // krds_modal은 정적인 .open-modal 버튼이 없으면 닫기 버튼을 연결하지 않으므로 직접 연결한다
  document.addEventListener("DOMContentLoaded", () => {
    krds_modal.modalOpenTriggers = [];
    krds_modal.modalCloseTriggers = document.querySelectorAll(".close-modal");
    krds_modal.setupTriggers();
  });
  let onConfirm;
  const confirmModal = (title, msg, ok, trigger, fn) => {
    $("confirm_title").textContent = title;
    $("confirm_msg").textContent = msg;
    $("confirm_ok").textContent = ok;
    onConfirm = fn;
    openModal("modal_confirm", trigger);
  };
  $("confirm_ok").onclick = () => onConfirm();

  /* 자동 편성 (이미 편성된 달은 KRDS 확인 패턴으로 덮어쓰기 전에 확인) */
  const runAuto = () => {
    if (!S.members.length) return say("투입 인원을 먼저 등록해 주세요.");
    const days = workdays(), res = assign(days);
    days.forEach((k, i) => (S.schedule[k] = res[i]));
    save(); render(); say(""); // 이전 안내 문구가 남지 않도록 비운다
  };
  $("btn_auto").onclick = (e) => (workdays().some((k) => S.schedule[k])
    ? confirmModal("근무 자동 편성", `${Y}년 ${M}월에 이미 편성된 근무가 있습니다. 다시 편성하면 직접 수정한 근무를 포함해 모두 바뀌며 되돌릴 수 없습니다.`, "다시 편성", e.currentTarget, runAuto)
    : runAuto());

  /* 근무 수정: 근무일 칸을 누르면 모달로 수정 (불가 시간, 같은 사람 중복은 막지 않고 안내만 한다) */
  let editing;
  const dutyNotes = () => {
    const sels = [...$("duty_slots").querySelectorAll("select")];
    sels.forEach((sel) => {
      const n = sel.value, p = $(`${sel.id}_hint`);
      p.textContent = [n && isOff(n, editing, sel.dataset.slot) && `${n}의 근무 불가 시간입니다.`,
        n && sels.filter((x) => x.value === n).length > 1 && "같은 사람이 오전과 오후를 모두 맡습니다."].filter(Boolean).join(" ");
      p.className = p.textContent ? "form-hint-information" : "";
      sel.parentNode.classList.toggle("is-information", !!p.textContent);
    });
  };
  $("cal_body").onclick = (e) => {
    const b = e.target.closest(".ssms-calendar__cell--edit")?.querySelector("[data-date]");
    if (!b) return;
    editing = b.dataset.date;
    const duty = S.schedule[editing] || {};
    $("duty_title").textContent = `${fmt(editing)} 근무 수정`;
    $("duty_slots").innerHTML = slotsOf(editing).map((s) => `<div class="form-group"><div class="form-tit"><label for="duty_${s}">${LABEL[s]}</label></div>`
      + `<div class="form-conts"><select id="duty_${s}" class="krds-form-select" data-slot="${s}" aria-describedby="duty_${s}_hint"><option value="">미배정</option>`
      + [...new Set([...S.members, duty[s]].filter(Boolean))].map((n) => `<option${n === duty[s] ? " selected" : ""}>${esc(n)}</option>`).join("")
      + `</select></div><p id="duty_${s}_hint"></p></div>`).join("");
    dutyNotes();
    openModal("modal_duty", b);
  };
  $("duty_slots").onchange = dutyNotes;
  $("duty_save").onclick = () => {
    S.schedule[editing] = Object.fromEntries([...$("duty_slots").querySelectorAll("select")].map((s) => [s.dataset.slot, s.value || null]));
    save(); render();
    say(`${fmt(editing)} 근무를 수정했습니다.`);
    setTimeout(() => document.querySelector(`[data-date="${editing}"]`)?.focus(), 400); // 다시 그린 날짜 버튼으로 초점
  };

  /* 입력 오류 표시 (KRDS: form-conts.is-error + form-hint-invalid) */
  const setError = (input, msg, hint) => {
    const p = $(`${input.id}_hint`);
    input.closest(".form-conts").classList.toggle("is-error", !!msg);
    p.className = msg ? "form-hint-invalid" : "form-hint";
    p.textContent = msg || hint;
    input.setAttribute("aria-invalid", !!msg);
    return msg;
  };

  /* 공휴일 설정 */
  const hDate = $("holiday_date"), hName = $("holiday_name");
  const DATE_HINT = "예: 2026-10-05", NAME_HINT = "예: 임시공휴일 (20자 이내)";
  const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v) && toKey(toDate(v)) === v;
  const dateError = (v) => (!v ? "날짜를 입력해 주세요."
    : !isDate(v) ? "날짜를 YYYY-MM-DD 형식으로 입력해 주세요."
    : S.holidays[v] ? `이미 등록된 공휴일입니다. (${S.holidays[v]})` : "");
  // KRDS 입력폼: 날짜는 포커스를 벗어날 때 검증 (달력 버튼으로 가는 경우는 제외)
  hDate.onblur = (e) => hDate.value && e.relatedTarget?.id !== "holiday_cal" && setError(hDate, dateError(hDate.value.trim()), DATE_HINT);
  $("holiday_form").onsubmit = (e) => {
    e.preventDefault();
    const k = hDate.value.trim(), name = hName.value.trim();
    const bad = [setError(hDate, dateError(k), DATE_HINT) && hDate, setError(hName, name ? "" : "공휴일명을 입력해 주세요.", NAME_HINT) && hName].find(Boolean);
    if (bad) return bad.focus(); // KRDS 입력폼: 첫 번째 오류 항목으로 초점
    S.holidays[k] = name;
    delete S.schedule[k];
    save(); move(toDate(k)); // 추가한 공휴일이 보이도록 그 달로 이동
    e.target.reset(); hDate.focus();
    say(`공휴일을 추가했습니다. ${fmt(k)} ${name}`);
  };
  $("holiday_list").onclick = (e) => {
    const k = e.target.closest("[data-del]")?.dataset.del;
    if (!k) return;
    say(`공휴일을 삭제했습니다. ${fmt(k)} ${S.holidays[k]}`);
    delete S.holidays[k];
    save(); render(); $("holiday_list").focus();
  };

  /* KRDS 달력: 마크업과 CSS는 KRDS를 쓰고 동작은 여기서 구현한다
     (ui-script.js의 krds_calendar는 날짜를 만들지 않는 정적 예시라서 쓰지 않는다) */
  const conts = $("holiday_conts"), calBtn = $("holiday_cal");
  let cal, cv, picked;
  const calDays = () => {
    const d = new Date(cv), today = toKey(new Date());
    d.setDate(1 - d.getDay());
    let html = "";
    for (let w = 0; w < 6; w++) {
      html += "<tr>";
      for (let i = 0; i < 7; i++, d.setDate(d.getDate() + 1)) {
        const k = toKey(d), other = d.getMonth() !== cv.getMonth(), hol = S.holidays[k];
        html += `<td class="${[other && "old", (!i || hol) && "day-off", hol && "disabled", k === today && "today", k === picked && "period start end"].filter(Boolean).join(" ")}">`
          + `<button type="button" class="btn-set-date" data-day="${k}" aria-label="${fmt(k)}${hol ? " 등록된 공휴일" : ""}"${other || hol ? " disabled" : ""}><span>${d.getDate()}</span></button></td>`;
      }
      html += "</tr>";
    }
    cal.querySelector("tbody").innerHTML = html;
    cal.querySelector("caption").textContent = cal.querySelector(".calendar-switch-wrap").textContent = `${cv.getFullYear()}년 ${cv.getMonth() + 1}월`;
  };
  const closeCal = (focus) => {
    cal.classList.remove("active");
    calBtn.setAttribute("aria-expanded", false);
    if (focus) calBtn.focus();
  };
  calBtn.onclick = () => {
    if (cal?.classList.contains("active")) return closeCal(true);
    if (!cal) {
      conts.insertAdjacentHTML("beforeend", `<div class="krds-calendar-area"><div class="calendar-wrap single" role="dialog" aria-label="날짜 선택" tabindex="-1">`
        + `<div class="calendar-head"><button type="button" class="btn-cal-move prev" data-move="-1"><span class="sr-only">이전 달</span></button><div class="calendar-switch-wrap"></div>`
        + `<button type="button" class="btn-cal-move next" data-move="1"><span class="sr-only">다음 달</span></button></div>`
        + `<div class="calendar-body"><div class="calendar-table-wrap"><table class="calendar-tbl"><caption></caption><thead><tr>${[...WD].map((w) => `<th>${w}</th>`).join("")}</tr></thead><tbody></tbody></table></div></div>`
        + `<div class="calendar-footer"><div class="calendar-btn-wrap"><button type="button" class="krds-btn small text" data-act="today">오늘</button>`
        + `<button type="button" class="krds-btn small tertiary" data-act="cancel">취소</button><button type="button" class="krds-btn small primary" data-act="ok">확인</button></div></div></div></div>`);
      cal = conts.lastElementChild;
      cal.onkeydown = (e) => e.key === "Escape" && closeCal(true);
      cal.onclick = (e) => {
        const b = e.target.closest("button");
        if (!b) return;
        if (b.dataset.move) { cv.setMonth(cv.getMonth() + +b.dataset.move); calDays(); }
        else if (b.dataset.day) { picked = b.dataset.day; calDays(); cal.querySelector(`[data-day="${picked}"]`).focus(); }
        else if (b.dataset.act === "today") { cv = new Date(); cv.setDate(1); picked = S.holidays[toKey(new Date())] ? picked : toKey(new Date()); calDays(); }
        else {
          if (b.dataset.act === "ok" && picked) { hDate.value = picked; setError(hDate, "", DATE_HINT); }
          closeCal(true);
        }
      };
    }
    picked = isDate(hDate.value) ? hDate.value : null;
    cv = picked ? toDate(picked) : new Date(Y, M - 1, 1);
    cv.setDate(1);
    calDays();
    cal.classList.add("active");
    calBtn.setAttribute("aria-expanded", true);
    setTimeout(() => (cal.querySelector(".period button, .today button:enabled") || cal.firstElementChild).focus(), 50);
  };
  // 날짜를 누르면 달력을 다시 그리므로 클릭 당시의 경로로 바깥 클릭을 판단한다
  document.addEventListener("click", (e) => cal?.classList.contains("active") && !e.composedPath().includes(conts) && closeCal());

  /* 근무 불가일 등록 (저장 전까지는 draft만 바꾼다) */
  $("unavail_member").onchange = renderUnavail;
  $("unavail_list").onchange = (e) => {
    const n = $("unavail_member").value, v = e.target.value;
    draft[n] = (draft[n] || []).filter((x) => x !== v).concat(e.target.checked ? [v] : []);
  };
  $("unavail_form").onsubmit = (e) => {
    e.preventDefault();
    S.unavailable = clone(draft);
    save();
    say("근무 불가일을 저장했습니다. 이미 편성된 근무는 바뀌지 않습니다.");
  };
  $("unavail_cancel").onclick = () => { draft = clone(S.unavailable); renderUnavail(); say("저장하지 않은 변경 내용을 취소했습니다."); };

  /* 투입 인원 수정: 같은 입력폼으로 추가와 이름 변경을 한다 */
  const mInput = $("member_name"), M_HINT = "20자 이내로 입력해 주세요.";
  let editingMember = null;
  const memberMode = (n) => {
    editingMember = n;
    mInput.value = n || "";
    $("member_submit").textContent = n ? "변경" : "추가";
    $("member_cancel").parentNode.hidden = !n;
    setError(mInput, "", M_HINT);
    mInput.focus();
  };
  $("member_form").onsubmit = (e) => {
    e.preventDefault();
    const n = mInput.value.trim(), from = editingMember;
    if (setError(mInput, !n ? "이름을 입력해 주세요." : n !== from && S.members.includes(n) ? "이미 등록된 이름입니다." : "", M_HINT)) return mInput.focus();
    if (from) { // 이름 변경: 불가일과 편성된 근무도 새 이름으로 옮긴다
      S.members = S.members.map((x) => (x === from ? n : x));
      [S.unavailable, draft].forEach((u) => { if (u[from]) { u[n] = u[from]; delete u[from]; } });
      Object.values(S.schedule).forEach((d) => Object.keys(d).forEach((s) => d[s] === from && (d[s] = n)));
      say(`이름을 변경했습니다. ${from} → ${n}`);
    } else {
      S.members.push(n);
      say(`투입 인원을 추가했습니다. ${n}`);
    }
    save(); render(); memberMode(null);
  };
  $("member_cancel").onclick = () => memberMode(null);
  $("member_list").onclick = (e) => {
    const b = e.target.closest("button");
    if (b?.dataset.edit) return memberMode(b.dataset.edit);
    if (!b?.dataset.del) return;
    const n = b.dataset.del;
    confirmModal("투입 인원 삭제", `'${n}' 인원을 삭제합니다. 등록된 불가일도 함께 삭제되며, 이미 편성된 근무는 그대로 남습니다.`, "삭제", b, () => {
      S.members = S.members.filter((x) => x !== n);
      delete S.unavailable[n];
      delete draft[n];
      save(); render();
      say(`투입 인원을 삭제했습니다. ${n}`);
      setTimeout(() => $("member_list").focus(), 400);
    });
  };

  render();
})();
