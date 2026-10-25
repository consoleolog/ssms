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
  try {
    S = JSON.parse(localStorage.getItem("ssms")) || {};
  } catch (e) {
    // 손상된 데이터는 무시하고 새로 시작한다
  }
  S = { members: [], holidays: {}, unavailable: {}, schedule: {}, ...S };
  const save = () => localStorage.setItem("ssms", JSON.stringify(S));
  let Y = new Date().getFullYear();
  let M = new Date().getMonth() + 1;
  let draft = clone(S.unavailable); // 불가일 등록에서 저장 전 변경 내용

  const isOff = (n, k, s) => (S.unavailable[n] || []).includes(`${k}_${s}`);
  const workdays = () => {
    const days = [];
    for (const d = new Date(Y, M - 1, 1); d.getMonth() === M - 1; d.setDate(d.getDate() + 1)) {
      if (d.getDay() % 6 && !S.holidays[toKey(d)]) days.push(toKey(d));
    }
    return days;
  };
  const newCount = () =>
    Object.fromEntries(S.members.map((n) => [n, { all: 0, AM: 0, PM: 0, DAY: 0 }]));

  /* 자동 편성: 무작위 편성을 300번 해서 가장 공평한 결과를 고른다
     - 불가 시간은 제외하고, 하루에 한 사람은 한 칸만 맡는다
     - 후보가 적은 칸부터 채우고, 근무 수 → 같은 칸 근무 수 → 앞뒤 날 근무가 적은 사람을 고른다
     - 평가: 미배정 > 총 근무 편차 > 종일 편차 > 오전/오후 쏠림 */
  const assign = (days) => {
    let best;
    let bestScore = Infinity;
    for (let t = 0; t < 300; t++) {
      const res = days.map(() => ({}));
      const c = newCount();
      const works = (i, n) => !!res[i] && Object.values(res[i]).includes(n);
      const slots = days.flatMap((k, i) =>
        slotsOf(k).map((s) => ({
          i,
          s,
          pool: S.members.filter((n) => !isOff(n, k, s)),
          r: Math.random(),
        })),
      );
      slots
        .sort((a, b) => a.pool.length - b.pool.length || a.r - b.r)
        .forEach(({ i, s, pool }) => {
          const cost = (n) =>
            c[n].all * 100 + c[n][s] * 10 + works(i - 1, n) + works(i + 1, n) + Math.random();
          const n = pool
            .filter((n) => !works(i, n))
            .map((n) => [cost(n), n])
            .sort((a, b) => a[0] - b[0])[0]?.[1];
          if (n) {
            res[i][s] = n;
            c[n].all++;
            c[n][s]++;
          }
        });
      const gap = (f) => {
        const values = S.members.map((n) => c[n][f]);
        return Math.max(...values) - Math.min(...values);
      };
      const empty = days.reduce((a, k, i) => a + slotsOf(k).filter((s) => !res[i][s]).length, 0);
      const halfGap = S.members.reduce((a, n) => a + Math.abs(c[n].AM - c[n].PM), 0);
      const score = empty * 1e6 + gap("all") * 1e4 + gap("DAY") * 1e3 + halfGap * 100;
      if (score < bestScore) [best, bestScore] = [res, score];
    }
    return best;
  };

  /* 화면 */
  // 근무 한 줄: 오전/오후/종일 뱃지 + 근무자
  const dutyItem = (s, name) => {
    const who = name ? esc(name) : '<span class="ssms-calendar__none">미배정</span>';
    return `
      <p class="ssms-calendar__item">
        <span class="krds-badge bg-light-${COLOR[s]}">${LABEL[s]}</span>
        ${who}
      </p>`;
  };

  // 달력 하루 칸
  const dayCell = (d, w, today) => {
    const k = toKey(d);
    const day = d.getDate();
    const hol = S.holidays[k];
    const other = d.getMonth() !== M - 1;
    const work = !other && w % 6 && !hol; // 근무일: 이번 달의 평일이고 공휴일이 아닌 날
    const isToday = k === today;
    const duty = S.schedule[k];

    const mods = [
      other && "other",
      (!w || hol) && "holiday",
      w === 6 && "saturday",
      isToday && "today",
      work && "edit",
    ].filter(Boolean);
    const cls = ["ssms-calendar__cell", ...mods.map((m) => `ssms-calendar__cell--${m}`)].join(" ");
    const current = isToday ? 'aria-current="date"' : "";

    let date = `<span class="ssms-calendar__date">${day}</span>`;
    if (work) {
      date = `
        <button type="button" class="ssms-calendar__date" data-date="${k}" aria-label="${fmt(k)} 근무 수정">
          ${day}
        </button>`;
    }
    const todayBadge = isToday ? '<span class="krds-badge bg-primary">오늘</span>' : "";
    const holidayName = hol ? `<span class="ssms-calendar__holiday">${esc(hol)}</span>` : "";

    let items = "";
    if (work && duty) {
      items = slotsOf(k)
        .map((s) => dutyItem(s, duty[s]))
        .join("");
    } else if (work) {
      items = "<p>-</p>"; // 아직 편성 전
    }

    return `
      <td class="${cls}" ${current}>
        <div class="ssms-calendar__head">
          ${date}
          ${todayBadge}
          ${holidayName}
        </div>
        ${items}
      </td>`;
  };

  // 근무 불가일: 날짜 한 줄 + 오전/오후(금요일은 종일) 체크박스 칩
  const unavailChip = (k, s, picked) => {
    const id = `u_${k}_${s}`;
    const value = `${k}_${s}`;
    const checked = picked.includes(value) ? "checked" : "";
    return `
      <span class="krds-form-chip small">
        <input type="checkbox" class="checkbox" id="${id}" value="${value}" ${checked}>
        <label class="krds-form-chip-outline" for="${id}">${LABEL[s]}</label>
      </span>`;
  };
  const unavailRow = (k, picked) => {
    const chips = slotsOf(k)
      .map((s) => unavailChip(k, s, picked))
      .join("");
    return `
      <div role="group" aria-label="${fmt(k)}">
        ${fmt(k)}
        <span class="krds-check-area">
          ${chips}
        </span>
      </div>`;
  };

  // 투입 인원 표의 한 행 (이번 달 근무 횟수)
  const memberRow = (n, count) => `
    <tr>
      <th scope="row">${esc(n)}</th>
      <td>${count.AM}</td>
      <td>${count.PM}</td>
      <td>${count.DAY}</td>
    </tr>`;

  // 투입 인원 수정 목록의 한 줄
  const memberItem = (n) => {
    const name = esc(n);
    return `
      <li>
        ${name}
        <span class="ssms__buttons">
          <button type="button" class="krds-btn xsmall tertiary" data-edit="${name}">
            수정<span class="sr-only"> ${name}</span>
          </button>
          <button type="button" class="krds-btn xsmall tertiary" data-del="${name}">
            삭제<span class="sr-only"> ${name}</span>
          </button>
        </span>
      </li>`;
  };

  // 공휴일 목록의 한 줄
  const holidayItem = (k) => `
    <li>
      ${fmt(k)} ${esc(S.holidays[k])}
      <button type="button" class="krds-btn xsmall tertiary" data-del="${k}">
        삭제<span class="sr-only"> ${fmt(k)}</span>
      </button>
    </li>`;

  const renderUnavail = () => {
    const n = $("unavail_member").value;
    const picked = draft[n] || [];
    $("unavail_legend").textContent = `${Y}년 ${M}월 ${n} 근무 불가 시간`;
    $("unavail_list").innerHTML = n
      ? workdays()
          .map((k) => unavailRow(k, picked))
          .join("")
      : "";
  };

  const render = () => {
    const title = `${Y}년 ${M}월`;
    const today = toKey(new Date());
    const c = newCount();
    workdays().forEach((k) =>
      slotsOf(k).forEach((s) => {
        const n = (S.schedule[k] || {})[s];
        if (c[n]) {
          c[n].all++;
          c[n][s]++;
        }
      }),
    );
    $("month").textContent = title;
    $("cal_caption").textContent = `${title} 전산근무표`;

    // 달력: 첫 주 일요일부터 마지막 날이 있는 주의 토요일까지
    let rows = "";
    const d = new Date(Y, M - 1, 1);
    const last = new Date(Y, M, 0);
    d.setDate(1 - d.getDay());
    while (d <= last) {
      rows += "<tr>";
      for (let w = 0; w < 7; w++, d.setDate(d.getDate() + 1)) rows += dayCell(d, w, today);
      rows += "</tr>";
    }
    $("cal_body").innerHTML = rows;

    const memberRows = S.members.map((n) => memberRow(n, c[n])).join("");
    $("member_count").textContent = `${S.members.length}명`;
    $("member_body").innerHTML = memberRows || '<tr><td colspan="4">-</td></tr>';
    $("member_list").innerHTML = S.members.map((n) => memberItem(n)).join("");

    const holidays = Object.keys(S.holidays)
      .filter((k) => k.startsWith(`${Y}-${pad(M)}`))
      .sort();
    $("holiday_title").textContent = `${title} 공휴일`;
    $("holiday_list").innerHTML =
      holidays.map((k) => holidayItem(k)).join("") || "<li>등록된 공휴일이 없습니다.</li>";

    const sel = $("unavail_member");
    const cur = sel.value;
    sel.innerHTML = S.members.map((n) => `<option>${esc(n)}</option>`).join("");
    if (S.members.includes(cur)) sel.value = cur;
    renderUnavail();
  };

  const move = (d) => {
    Y = d.getFullYear();
    M = d.getMonth() + 1;
    render();
  };
  $("btn_prev").onclick = () => move(new Date(Y, M - 2, 1));
  $("btn_next").onclick = () => move(new Date(Y, M, 1));
  $("btn_today").onclick = () => move(new Date());
  $("btn_print").onclick = () => print(); // 인쇄용 CSS(@media print)로 달력만 출력

  /* KRDS 모달: 스크립트로 열고, 닫힐 때 trigger로 초점이 돌아가도록 ui-script.js와 같은 표시를 붙인다 */
  const openModal = (id, trigger) => {
    trigger.classList.add("modal-opened");
    trigger.dataset.modalId = id;
    krds_modal.openModal(id);
  };
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
    const days = workdays();
    const res = assign(days);
    days.forEach((k, i) => (S.schedule[k] = res[i]));
    save();
    render();
    say(""); // 이전 안내 문구가 남지 않도록 비운다
  };
  $("btn_auto").onclick = (e) => {
    if (!workdays().some((k) => S.schedule[k])) return runAuto();
    confirmModal(
      "근무 자동 편성",
      `${Y}년 ${M}월에 이미 편성된 근무가 있습니다. 다시 편성하면 직접 수정한 근무를 포함해 모두 바뀌며 되돌릴 수 없습니다.`,
      "다시 편성",
      e.currentTarget,
      runAuto,
    );
  };

  /* 근무 수정: 근무일 칸을 누르면 모달로 수정 (불가 시간, 같은 사람 중복은 막지 않고 안내만 한다) */
  let editing;
  const dutyNotes = () => {
    const sels = [...$("duty_slots").querySelectorAll("select")];
    sels.forEach((sel) => {
      const n = sel.value;
      const p = $(`${sel.id}_hint`);
      const twice = sels.filter((x) => x.value === n).length > 1;
      const notes = [];
      if (n && isOff(n, editing, sel.dataset.slot)) notes.push(`${n}의 근무 불가 시간입니다.`);
      if (n && twice) notes.push("같은 사람이 오전과 오후를 모두 맡습니다.");
      p.textContent = notes.join(" ");
      p.className = p.textContent ? "form-hint-information" : "";
      sel.parentNode.classList.toggle("is-information", !!p.textContent);
    });
  };
  // 근무 수정 모달의 선택 칸 하나 (오전, 오후 또는 종일)
  const dutyOption = (n, current) => {
    const selected = n === current ? "selected" : "";
    return `<option ${selected}>${esc(n)}</option>`;
  };
  const dutySlot = (s, duty) => {
    const id = `duty_${s}`;
    const names = [...new Set([...S.members, duty[s]].filter(Boolean))]; // 삭제된 인원도 남겨 둔다
    const options = names.map((n) => dutyOption(n, duty[s])).join("");
    return `
      <div class="form-group">
        <div class="form-tit"><label for="${id}">${LABEL[s]}</label></div>
        <div class="form-conts">
          <select id="${id}" class="krds-form-select" data-slot="${s}" aria-describedby="${id}_hint">
            <option value="">미배정</option>
            ${options}
          </select>
        </div>
        <p id="${id}_hint"></p>
      </div>`;
  };
  $("cal_body").onclick = (e) => {
    const b = e.target.closest(".ssms-calendar__cell--edit")?.querySelector("[data-date]");
    if (!b) return;
    editing = b.dataset.date;
    const duty = S.schedule[editing] || {};
    $("duty_title").textContent = `${fmt(editing)} 근무 수정`;
    $("duty_slots").innerHTML = slotsOf(editing)
      .map((s) => dutySlot(s, duty))
      .join("");
    dutyNotes();
    openModal("modal_duty", b);
  };
  $("duty_slots").onchange = dutyNotes;
  $("duty_save").onclick = () => {
    const sels = [...$("duty_slots").querySelectorAll("select")];
    S.schedule[editing] = Object.fromEntries(sels.map((s) => [s.dataset.slot, s.value || null]));
    save();
    render();
    say(`${fmt(editing)} 근무를 수정했습니다.`);
    // 달력을 다시 그렸으므로 모달이 닫힌 뒤 같은 날짜 버튼으로 초점
    setTimeout(() => document.querySelector(`[data-date="${editing}"]`)?.focus(), 400);
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
  const hDate = $("holiday_date");
  const hName = $("holiday_name");
  const DATE_HINT = "예: 2026-10-05";
  const NAME_HINT = "예: 임시공휴일 (20자 이내)";
  const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v) && toKey(toDate(v)) === v;
  const dateError = (v) => {
    if (!v) return "날짜를 입력해 주세요.";
    if (!isDate(v)) return "날짜를 YYYY-MM-DD 형식으로 입력해 주세요.";
    if (S.holidays[v]) return `이미 등록된 공휴일입니다. (${S.holidays[v]})`;
    return "";
  };
  // KRDS 입력폼: 날짜는 포커스를 벗어날 때 검증 (달력 버튼으로 가는 경우는 제외)
  hDate.onblur = (e) => {
    if (hDate.value && e.relatedTarget?.id !== "holiday_cal") {
      setError(hDate, dateError(hDate.value.trim()), DATE_HINT);
    }
  };
  $("holiday_form").onsubmit = (e) => {
    e.preventDefault();
    const k = hDate.value.trim();
    const name = hName.value.trim();
    const dateBad = setError(hDate, dateError(k), DATE_HINT);
    const nameBad = setError(hName, name ? "" : "공휴일명을 입력해 주세요.", NAME_HINT);
    if (dateBad || nameBad) return (dateBad ? hDate : hName).focus(); // 첫 번째 오류 항목으로 초점
    S.holidays[k] = name;
    delete S.schedule[k];
    save();
    move(toDate(k)); // 추가한 공휴일이 보이도록 그 달로 이동
    e.target.reset();
    hDate.focus();
    say(`공휴일을 추가했습니다. ${fmt(k)} ${name}`);
  };
  $("holiday_list").onclick = (e) => {
    const k = e.target.closest("[data-del]")?.dataset.del;
    if (!k) return;
    say(`공휴일을 삭제했습니다. ${fmt(k)} ${S.holidays[k]}`);
    delete S.holidays[k];
    save();
    render();
    $("holiday_list").focus();
  };

  /* KRDS 달력: 마크업과 CSS는 KRDS를 쓰고 동작은 여기서 구현한다
     (ui-script.js의 krds_calendar는 날짜를 만들지 않는 정적 예시라서 쓰지 않는다) */
  const CALENDAR = `
    <div class="krds-calendar-area">
      <div class="calendar-wrap single" role="dialog" aria-label="날짜 선택" tabindex="-1">
        <div class="calendar-head">
          <button type="button" class="btn-cal-move prev" data-move="-1">
            <span class="sr-only">이전 달</span>
          </button>
          <div class="calendar-switch-wrap"></div>
          <button type="button" class="btn-cal-move next" data-move="1">
            <span class="sr-only">다음 달</span>
          </button>
        </div>
        <div class="calendar-body">
          <div class="calendar-table-wrap">
            <table class="calendar-tbl">
              <caption></caption>
              <thead>
                <tr>
                  <th>일</th>
                  <th>월</th>
                  <th>화</th>
                  <th>수</th>
                  <th>목</th>
                  <th>금</th>
                  <th>토</th>
                </tr>
              </thead>
              <tbody></tbody>
            </table>
          </div>
        </div>
        <div class="calendar-footer">
          <div class="calendar-btn-wrap">
            <button type="button" class="krds-btn small text" data-act="today">오늘</button>
            <button type="button" class="krds-btn small tertiary" data-act="cancel">취소</button>
            <button type="button" class="krds-btn small primary" data-act="ok">확인</button>
          </div>
        </div>
      </div>
    </div>`;
  const conts = $("holiday_conts");
  const calBtn = $("holiday_cal");
  let cal; // 달력 요소 (처음 열 때 만든다)
  let cv; // 달력에 보이는 달 (1일)
  let picked; // 선택한 날짜 (YYYY-MM-DD)
  // 달력 날짜 한 칸 (다른 달의 날짜와 등록된 공휴일은 고를 수 없다)
  const calCell = (d, i, today) => {
    const k = toKey(d);
    const other = d.getMonth() !== cv.getMonth();
    const hol = S.holidays[k];
    const cls = [
      other && "old",
      (!i || hol) && "day-off",
      hol && "disabled",
      k === today && "today",
      k === picked && "period start end",
    ].filter(Boolean);
    const label = hol ? `${fmt(k)} 등록된 공휴일` : fmt(k);
    const disabled = other || hol ? "disabled" : "";
    return `
      <td class="${cls.join(" ")}">
        <button type="button" class="btn-set-date" data-day="${k}" aria-label="${label}" ${disabled}>
          <span>${d.getDate()}</span>
        </button>
      </td>`;
  };
  const calDays = () => {
    const d = new Date(cv);
    const today = toKey(new Date());
    d.setDate(1 - d.getDay());
    let html = "";
    for (let w = 0; w < 6; w++) {
      html += "<tr>";
      for (let i = 0; i < 7; i++, d.setDate(d.getDate() + 1)) html += calCell(d, i, today);
      html += "</tr>";
    }
    const title = `${cv.getFullYear()}년 ${cv.getMonth() + 1}월`;
    cal.querySelector("tbody").innerHTML = html;
    cal.querySelector("caption").textContent = title;
    cal.querySelector(".calendar-switch-wrap").textContent = title;
  };
  const closeCal = (focus) => {
    cal.classList.remove("active");
    calBtn.setAttribute("aria-expanded", false);
    if (focus) calBtn.focus();
  };
  const onCalClick = (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.dataset.move) {
      cv.setMonth(cv.getMonth() + Number(b.dataset.move));
      calDays();
    } else if (b.dataset.day) {
      picked = b.dataset.day;
      calDays();
      cal.querySelector(`[data-day="${picked}"]`).focus();
    } else if (b.dataset.act === "today") {
      const today = toKey(new Date());
      cv = new Date();
      cv.setDate(1);
      if (!S.holidays[today]) picked = today;
      calDays();
    } else {
      if (b.dataset.act === "ok" && picked) {
        hDate.value = picked;
        setError(hDate, "", DATE_HINT);
      }
      closeCal(true);
    }
  };
  calBtn.onclick = () => {
    if (cal?.classList.contains("active")) return closeCal(true);
    if (!cal) {
      conts.insertAdjacentHTML("beforeend", CALENDAR);
      cal = conts.lastElementChild;
      cal.onclick = onCalClick;
      cal.onkeydown = (e) => e.key === "Escape" && closeCal(true);
    }
    picked = isDate(hDate.value) ? hDate.value : null;
    cv = picked ? toDate(picked) : new Date(Y, M - 1, 1);
    cv.setDate(1);
    calDays();
    cal.classList.add("active");
    calBtn.setAttribute("aria-expanded", true);
    const first =
      cal.querySelector(".period button, .today button:enabled") || cal.firstElementChild;
    setTimeout(() => first.focus(), 50);
  };
  // 날짜를 누르면 달력을 다시 그리므로 클릭 당시의 경로로 바깥 클릭을 판단한다
  document.addEventListener("click", (e) => {
    if (cal?.classList.contains("active") && !e.composedPath().includes(conts)) closeCal();
  });

  /* 근무 불가일 등록 (저장 전까지는 draft만 바꾼다) */
  $("unavail_member").onchange = renderUnavail;
  $("unavail_list").onchange = (e) => {
    const n = $("unavail_member").value;
    const v = e.target.value;
    draft[n] = (draft[n] || []).filter((x) => x !== v).concat(e.target.checked ? [v] : []);
  };
  $("unavail_form").onsubmit = (e) => {
    e.preventDefault();
    S.unavailable = clone(draft);
    save();
    say("근무 불가일을 저장했습니다. 이미 편성된 근무는 바뀌지 않습니다.");
  };
  $("unavail_cancel").onclick = () => {
    draft = clone(S.unavailable);
    renderUnavail();
    say("저장하지 않은 변경 내용을 취소했습니다.");
  };

  /* 투입 인원 수정: 같은 입력폼으로 추가와 이름 변경을 한다 */
  const mInput = $("member_name");
  const M_HINT = "20자 이내로 입력해 주세요.";
  let editingMember = null;
  const memberMode = (n) => {
    editingMember = n;
    mInput.value = n || "";
    $("member_submit").textContent = n ? "변경" : "추가";
    $("member_cancel").parentNode.hidden = !n;
    setError(mInput, "", M_HINT);
    mInput.focus();
  };
  const renameMember = (from, to) => {
    S.members = S.members.map((x) => (x === from ? to : x));
    [S.unavailable, draft].forEach((u) => {
      if (u[from]) {
        u[to] = u[from];
        delete u[from];
      }
    });
    // 이미 편성된 근무도 새 이름으로 바꾼다
    Object.values(S.schedule).forEach((day) =>
      Object.keys(day).forEach((s) => {
        if (day[s] === from) day[s] = to;
      }),
    );
  };
  $("member_form").onsubmit = (e) => {
    e.preventDefault();
    const n = mInput.value.trim();
    const from = editingMember;
    let error = "";
    if (!n) error = "이름을 입력해 주세요.";
    else if (n !== from && S.members.includes(n)) error = "이미 등록된 이름입니다.";
    if (setError(mInput, error, M_HINT)) return mInput.focus();
    if (from) {
      renameMember(from, n);
      say(`이름을 변경했습니다. ${from} → ${n}`);
    } else {
      S.members.push(n);
      say(`투입 인원을 추가했습니다. ${n}`);
    }
    save();
    render();
    memberMode(null);
  };
  $("member_cancel").onclick = () => memberMode(null);
  $("member_list").onclick = (e) => {
    const b = e.target.closest("button");
    if (b?.dataset.edit) return memberMode(b.dataset.edit);
    if (!b?.dataset.del) return;
    const n = b.dataset.del;
    confirmModal(
      "투입 인원 삭제",
      `'${n}' 인원을 삭제합니다. 등록된 불가일도 함께 삭제되며, 이미 편성된 근무는 그대로 남습니다.`,
      "삭제",
      b,
      () => {
        S.members = S.members.filter((x) => x !== n);
        delete S.unavailable[n];
        delete draft[n];
        save();
        render();
        say(`투입 인원을 삭제했습니다. ${n}`);
        setTimeout(() => $("member_list").focus(), 400);
      },
    );
  };

  render();
})();
