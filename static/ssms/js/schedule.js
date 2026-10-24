/*** * 전산근무표 자동 편성 * ***/
(() => {
  // 근무 칸: 월~목은 오전/오후, 금요일은 구분 없이 한 명(종일)
  const SLOTS = ["AM", "PM", "DAY"];
  const SLOT_LABEL = { AM: "오전", PM: "오후", DAY: "종일" };
  const SLOT_BADGE = { AM: "bg-light-primary", PM: "bg-light-point", DAY: "bg-light-success" };
  const SINGLE_SHIFT_WEEKDAYS = [5];
  // 무작위 편성을 여러 번 시도해 가장 공평한 결과를 고른다
  const TRY_COUNT = 300;

  const pad = (n) => String(n).padStart(2, "0");

  const weekdayOf = (dateKey) => {
    const [year, month, day] = dateKey.split("-").map(Number);
    return new Date(year, month - 1, day).getDay();
  };

  const slotsOf = (dateKey) => (SINGLE_SHIFT_WEEKDAYS.includes(weekdayOf(dateKey)) ? ["DAY"] : ["AM", "PM"]);

  const shuffle = (list) => {
    const arr = [...list];
    for (let i = arr.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  };

  const pickRandom = (list) => list[Math.floor(Math.random() * list.length)];

  // 주말, 공휴일을 제외한 근무일 목록 (YYYY-MM-DD)
  const getWorkdays = (year, month, holidays) => {
    const holidaySet = new Set(holidays);
    const lastDay = new Date(year, month, 0).getDate();
    const days = [];
    for (let day = 1; day <= lastDay; day += 1) {
      const date = `${year}-${pad(month)}-${pad(day)}`;
      const weekday = new Date(year, month - 1, day).getDay();
      if (weekday !== 0 && weekday !== 6 && !holidaySet.has(date)) days.push(date);
    }
    return days;
  };

  const countEmpty = (day) => Object.values(day).filter((name) => !name).length;

  /**
   * 1회 편성
   * - 후보가 적은(불가 인원이 많은) 칸부터 채운다
   * - 총 근무 수 → 같은 종류(오전/오후/종일) 근무 수 → 연속 근무일 순으로 적은 사람을 고른다
   * - 같은 날 오전, 오후를 한 사람이 모두 맡지 않는다
   * - 종일(금요일)은 오전, 오후 중 하나라도 불가인 사람을 제외한다
   */
  const assignOnce = (workdays, members, unavailable) => {
    const blocked = new Set();
    members.forEach((name) => (unavailable[name] || []).forEach((slot) => blocked.add(`${name}|${slot}`)));
    const isBlocked = (name, date, slot) =>
      (slot === "DAY" ? SLOTS : [slot]).some((s) => blocked.has(`${name}|${date}_${s}`));

    const slots = [];
    workdays.forEach((date, dayIndex) => {
      slotsOf(date).forEach((slot) => {
        const candidates = members.filter((name) => !isBlocked(name, date, slot));
        slots.push({ dayIndex, slot, candidates });
      });
    });
    // sort는 안정 정렬이므로 섞은 순서가 동점 칸 사이에서 유지된다
    const order = shuffle(slots).sort((a, b) => a.candidates.length - b.candidates.length);

    const stats = Object.fromEntries(members.map((name) => [name, { total: 0, AM: 0, PM: 0, DAY: 0 }]));
    const days = workdays.map((date) => Object.fromEntries(slotsOf(date).map((slot) => [slot, null])));
    const worksOn = (dayIndex, name) => !!days[dayIndex] && Object.values(days[dayIndex]).includes(name);

    order.forEach(({ dayIndex, slot, candidates }) => {
      const pool = candidates.filter((name) => !worksOn(dayIndex, name));
      if (!pool.length) return;

      const cost = (name) => {
        const adjacent = Number(worksOn(dayIndex - 1, name)) + Number(worksOn(dayIndex + 1, name));
        return stats[name].total * 100 + stats[name][slot] * 10 + adjacent;
      };
      const minCost = Math.min(...pool.map(cost));
      const name = pickRandom(pool.filter((n) => cost(n) === minCost));

      days[dayIndex][slot] = name;
      stats[name].total += 1;
      stats[name][slot] += 1;
    });

    return { days, stats };
  };

  // 낮을수록 좋음: 미배정 > 총 근무 수 편차 > 종일(금요일) 편차 > 오전/오후 편중 > 연속 근무
  const scoreOf = ({ days, stats }, members) => {
    const rangeOf = (key) => {
      const values = members.map((name) => stats[name][key]);
      return Math.max(...values) - Math.min(...values);
    };
    const unassigned = days.reduce((sum, day) => sum + countEmpty(day), 0);
    const halfGap = members.reduce((sum, name) => sum + Math.abs(stats[name].AM - stats[name].PM), 0);
    const streak = days.reduce((sum, day, i) => {
      if (!i) return sum;
      const prev = Object.values(days[i - 1]);
      return sum + Object.values(day).filter((name) => name && prev.includes(name)).length;
    }, 0);
    return unassigned * 1e6 + rangeOf("total") * 1e4 + rangeOf("DAY") * 1e3 + halfGap * 1e2 + streak;
  };

  /**
   * 근무 자동 편성
   * @param {{ workdays: string[], members: string[], unavailable: Object<string, string[]> }} input
   *   unavailable: { 이름: ["YYYY-MM-DD_AM", "YYYY-MM-DD_PM", ...] }
   * @returns {{ days: Object<string, string|null>[], stats: Object }} workdays와 같은 순서
   *   days[i]: 월~목 { AM, PM }, 금요일 { DAY }
   */
  const assignDuties = ({ workdays, members, unavailable }) => {
    let best = null;
    let bestScore = Infinity;
    for (let i = 0; i < TRY_COUNT; i += 1) {
      const result = assignOnce(workdays, members, unavailable);
      const score = scoreOf(result, members);
      if (score < bestScore) {
        best = result;
        bestScore = score;
      }
    }
    return best;
  };

  /* 화면 연동 */
  const dataElement = document.getElementById("schedule_data");
  if (!dataElement) return;
  /*
   * 로컬 저장 (localStorage)
   * - #schedule_data는 처음 실행할 때의 초기값이고, 이후에는 저장된 값을 우선한다
   */
  const STORAGE_KEY = "ssms.schedule";
  const STORAGE_VERSION = 1;
  const seed = JSON.parse(dataElement.textContent);

  const loadStored = () => {
    try {
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY));
      return stored && stored.version === STORAGE_VERSION ? stored : null;
    } catch (error) {
      return null;
    }
  };

  const stored = loadStored();
  const today = new Date();
  const state = {
    year: today.getFullYear(),
    month: today.getMonth() + 1,
    members: stored?.members || seed.members || [],
    holidays: stored?.holidays || seed.holidays || {},
    unavailable: stored?.unavailable || seed.unavailable || {},
    schedule: stored?.schedule || seed.schedule || {},
  };

  // 예전 데이터 보정: 금요일에 오전/오후로 저장된 근무는 종일 한 명으로 바꾼다
  Object.entries(state.schedule).forEach(([key, duty]) => {
    if (slotsOf(key)[0] === "DAY" && !("DAY" in duty)) state.schedule[key] = { DAY: duty.AM || duty.PM || null };
  });

  let saveFailed = false;
  const save = () => {
    try {
      const { members, holidays, unavailable, schedule } = state;
      const data = { version: STORAGE_VERSION, savedAt: new Date().toISOString(), members, holidays, unavailable, schedule };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      saveFailed = false;
    } catch (error) {
      saveFailed = true;
    }
  };

  const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];
  const $ = (id) => document.getElementById(id);
  const toKey = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const escapeHtml = (value) =>
    String(value).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
  const currentWorkdays = () => getWorkdays(state.year, state.month, Object.keys(state.holidays));

  /* 달력 */
  const renderDutyList = (dateKey) => {
    const duty = state.schedule[dateKey];
    if (!duty) return "";
    const items = slotsOf(dateKey)
      .map((slot) => {
        const name = duty[slot];
        const badge = name ? SLOT_BADGE[slot] : "bg-light-danger";
        return `<li class="ssms-calendar__item"><span class="krds-badge ${badge}">${SLOT_LABEL[slot]}</span> ${name ? escapeHtml(name) : "미배정"}</li>`;
      })
      .join("");
    return `<ul class="ssms-calendar__list">${items}</ul>`;
  };

  const renderCell = (date) => {
    const key = toKey(date);
    const isOtherMonth = date.getMonth() + 1 !== state.month;
    const holiday = state.holidays[key];
    const weekday = date.getDay();
    const isToday = key === toKey(new Date());
    const isWorkday = !isOtherMonth && weekday !== 0 && weekday !== 6 && !holiday;

    const modifiers = [];
    if (isOtherMonth) modifiers.push("other-month");
    if (weekday === 0 || holiday) modifiers.push("holiday");
    else if (weekday === 6) modifiers.push("saturday");
    if (isToday) modifiers.push("today");
    if (isWorkday) modifiers.push("editable");
    const className = ["ssms-calendar__cell", ...modifiers.map((m) => `ssms-calendar__cell--${m}`)].join(" ");

    const head = [
      isOtherMonth
        ? `<span class="ssms-calendar__date"><span class="sr-only">${date.getMonth() + 1}월 </span>${date.getDate()}</span>`
        : isWorkday
          ? `<button type="button" class="ssms-calendar__date ssms-calendar__date--button" data-edit-date="${key}" aria-label="${formatDate(key)} 근무 수정">${date.getDate()}</button>`
          : `<span class="ssms-calendar__date">${date.getDate()}</span>`,
      isToday ? `<span class="krds-badge bg-primary">오늘</span>` : "",
      holiday ? `<span class="ssms-calendar__holiday">${escapeHtml(holiday)}</span>` : "",
    ].join("");

    return `<td class="${className}"${isOtherMonth ? "" : ` data-date="${key}"`}${isToday ? ` aria-current="date"` : ""}>
      <div class="ssms-calendar__head">${head}</div>
      ${isWorkday ? renderDutyList(key) : ""}
    </td>`;
  };

  const renderCalendar = () => {
    const first = new Date(state.year, state.month - 1, 1);
    const last = new Date(state.year, state.month, 0);
    const start = new Date(first);
    start.setDate(1 - first.getDay());
    const end = new Date(last);
    end.setDate(last.getDate() + (6 - last.getDay()));

    const rows = [];
    for (const day = new Date(start); day <= end; ) {
      const cells = [];
      for (let i = 0; i < 7; i += 1) {
        cells.push(renderCell(day));
        day.setDate(day.getDate() + 1);
      }
      rows.push(`<tr>${cells.join("")}</tr>`);
    }

    const title = `${state.year}년 ${state.month}월`;
    $("schedule_month").textContent = title;
    $("calendar_caption").textContent = `${title} 전산근무표로 ${WEEKDAYS[0]}요일부터 ${WEEKDAYS[6]}요일까지 날짜별 근무 유형과 근무자로 구성되어 있습니다.`;
    $("calendar_body").innerHTML = rows.join("");
  };

  /* 투입 인원 (표시 중인 달의 근무 횟수) */
  const renderMembers = () => {
    const counts = Object.fromEntries(state.members.map((name) => [name, { AM: 0, PM: 0, DAY: 0 }]));
    currentWorkdays().forEach((key) => {
      const duty = state.schedule[key] || {};
      slotsOf(key).forEach((slot) => {
        if (counts[duty[slot]]) counts[duty[slot]][slot] += 1;
      });
    });

    $("member_count").textContent = `${state.members.length}명`;
    $("members_caption").textContent = `${state.year}년 ${state.month}월 전산근무 투입 인원으로 이름, 오전 근무 횟수, 오후 근무 횟수, 종일(금요일) 근무 횟수로 구성되어 있습니다.`;
    $("members_body").innerHTML = state.members.length
      ? state.members
          .map(
            (name) => `<tr>
              <th scope="row">${escapeHtml(name)}</th>
              <td>${counts[name].AM}</td>
              <td>${counts[name].PM}</td>
              <td>${counts[name].DAY}</td>
            </tr>`
          )
          .join("")
      : `<tr><td colspan="4">등록된 투입 인원이 없습니다.</td></tr>`;
  };

  /* 공휴일 설정 (표시 중인 달의 공휴일 목록) */
  const holidayList = $("holiday_list");
  const formatDate = (key) => {
    const [year, month, day] = key.split("-").map(Number);
    return `${month}월 ${day}일 (${WEEKDAYS[new Date(year, month - 1, day).getDay()]})`;
  };

  const renderHolidayList = () => {
    if (!holidayList) return;
    const prefix = `${state.year}-${pad(state.month)}-`;
    const keys = Object.keys(state.holidays)
      .filter((key) => key.startsWith(prefix))
      .sort();

    $("holiday_list_title").textContent = `${state.year}년 ${state.month}월 공휴일`;
    holidayList.innerHTML = keys.length
      ? keys
          .map((key) => {
            const label = `${formatDate(key)} ${escapeHtml(state.holidays[key])}`;
            return `<li class="ssms-holiday__item">
              <span>${label}</span>
              <button type="button" class="krds-btn xsmall tertiary" data-holiday="${key}" aria-label="${label} 삭제">삭제</button>
            </li>`;
          })
          .join("")
      : `<li class="ssms-holiday__item">등록된 공휴일이 없습니다.</li>`;
  };

  const render = () => {
    renderCalendar();
    renderMembers();
    renderHolidayList();
    renderMemberOptions();
    renderMemberEditor();
  };

  const moveMonth = (offset) => {
    const target = new Date(state.year, state.month - 1 + offset, 1);
    state.year = target.getFullYear();
    state.month = target.getMonth() + 1;
    render();
  };

  $("btn_prev_month")?.addEventListener("click", () => moveMonth(-1));
  $("btn_next_month")?.addEventListener("click", () => moveMonth(1));
  $("btn_today")?.addEventListener("click", () => {
    const today = new Date();
    state.year = today.getFullYear();
    state.month = today.getMonth() + 1;
    render();
  });

  const status = $("schedule_status");
  const announce = (message) => {
    if (status) status.textContent = saveFailed ? `${message} 브라우저 저장소에 저장하지 못해 새로고침하면 변경 내용이 사라집니다.` : message;
  };

  // KRDS 입력 필드 상태: form-conts.is-error + form-hint-invalid
  const setFieldError = (input, message, defaultHint) => {
    const group = input.closest(".form-group");
    const hint = group.querySelector("[id$='_hint']");
    group.querySelector(".form-conts").classList.toggle("is-error", !!message);
    hint.className = message ? "form-hint-invalid" : "form-hint";
    hint.textContent = message || defaultHint;
    input.setAttribute("aria-invalid", message ? "true" : "false");
  };

  const parseDateKey = (value) => {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
    if (!match) return null;
    const [year, month, day] = match.slice(1).map(Number);
    const date = new Date(year, month - 1, day);
    return date.getMonth() === month - 1 && date.getDate() === day ? toKey(date) : null;
  };

  const holidayForm = $("holiday_form");
  const holidayDate = $("holiday_date");
  const holidayName = $("holiday_name");
  const DATE_HINT = "예: 2026-10-05";
  const NAME_HINT = "예: 임시공휴일 (20자 이내)";

  /*
   * KRDS 달력(날짜 선택) 컴포넌트
   * - KRDS 마크업과 CSS를 그대로 쓰고, 날짜 생성·월 이동·선택 동작은 여기서 구현한다
   *   (ui-script.js의 krds_calendar는 정적 예시용이라 날짜를 만들지 않고 YYYY.MM.DD로 입력하므로 사용하지 않음)
   * - 달력은 열 때 렌더링하므로 페이지 로드 시점에 krds_calendar가 이 요소에 이벤트를 걸지 않는다
   */
  const createDatePicker = ({ conts, input, button, disabledReason = () => "", defaultView = () => new Date() }) => {
    let area = null;
    let view = null; // { year, month }
    let selected = null; // YYYY-MM-DD
    let openList = null; // "year" | "month" | null

    const isOpen = () => !!area && area.classList.contains("active");
    const dateLabel = (key) => {
      const [y, m, d] = key.split("-").map(Number);
      return `${y}년 ${m}월 ${d}일 ${WEEKDAYS[new Date(y, m - 1, d).getDay()]}요일`;
    };

    const renderList = (type) => {
      const items =
        type === "year"
          ? Array.from({ length: 11 }, (_, i) => view.year - 5 + i).map((y) => [y, `${y}년`, y === view.year])
          : Array.from({ length: 12 }, (_, i) => i + 1).map((m) => [m, `${pad(m)}월`, m === view.month]);
      return items
        .map(([value, label, active]) => `<li role="none"><button type="button" role="option" data-${type}="${value}" aria-selected="${active}"${active ? ' class="active"' : ""}>${label}</button></li>`)
        .join("");
    };

    const renderDays = () => {
      const first = new Date(view.year, view.month - 1, 1);
      const day = new Date(first);
      day.setDate(1 - first.getDay());
      const todayKey = toKey(new Date());
      const rows = [];
      for (let w = 0; w < 6; w += 1) {
        const cells = [];
        for (let i = 0; i < 7; i += 1) {
          const key = toKey(day);
          const other = day.getMonth() + 1 !== view.month;
          const reason = other ? "" : disabledReason(key);
          const cls = [
            other ? (day < first ? "old" : "new") : "",
            day.getDay() === 0 || state.holidays[key] ? "day-off" : "",
            reason ? "disabled" : "",
            key === todayKey ? "today" : "",
            key === selected && !other ? "period start end" : "",
          ].filter(Boolean).join(" ");
          const label = `${dateLabel(key)}${key === todayKey ? " 오늘" : ""}${reason ? ` ${reason}` : ""}`;
          cells.push(`<td${cls ? ` class="${cls}"` : ""}><button type="button" class="btn-set-date" data-date="${key}" aria-label="${escapeHtml(label)}"${other || reason ? " disabled" : ""}${key === selected && !other ? ' aria-pressed="true"' : ""}><span>${day.getDate()}</span></button></td>`);
          day.setDate(day.getDate() + 1);
        }
        rows.push(`<tr>${cells.join("")}</tr>`);
        if (day.getMonth() + 1 !== view.month && day > first) break;
      }
      return rows.join("");
    };

    const render = (focusKey) => {
      area.innerHTML = `
        <div class="calendar-wrap single" role="dialog" aria-label="날짜 선택 달력" tabindex="-1">
          <div class="calendar-head">
            <button type="button" class="btn-cal-move prev" data-move="-1"><span class="sr-only">이전 달</span></button>
            <div class="calendar-switch-wrap">
              ${["year", "month"]
                .map(
                  (type) => `<div class="calendar-drop-down">
                    <button type="button" class="btn-cal-switch ${type}" data-switch="${type}" aria-label="${type === "year" ? "연도" : "월"} 선택" aria-haspopup="listbox" aria-expanded="${openList === type}">${type === "year" ? `${view.year}년` : `${pad(view.month)}월`}</button>
                    <div class="calendar-select calendar-${type === "year" ? "year" : "mon"}-wrap${openList === type ? " active" : ""}">
                      <ul class="sel ${type}" role="listbox" aria-label="${type === "year" ? "연도" : "월"}">${renderList(type)}</ul>
                    </div>
                  </div>`
                )
                .join("")}
            </div>
            <button type="button" class="btn-cal-move next" data-move="1"><span class="sr-only">다음 달</span></button>
          </div>
          <div class="calendar-body">
            <div class="calendar-table-wrap">
              <table class="calendar-tbl">
                <caption>${view.year}년 ${view.month}월</caption>
                <thead><tr>${WEEKDAYS.map((w) => `<th scope="col">${w}</th>`).join("")}</tr></thead>
                <tbody>${renderDays()}</tbody>
              </table>
            </div>
          </div>
          <div class="calendar-footer">
            <div class="calendar-btn-wrap">
              <button type="button" class="krds-btn small text" data-action="today">오늘</button>
              <button type="button" class="krds-btn small tertiary" data-action="cancel">취소</button>
              <button type="button" class="krds-btn small primary" data-action="confirm">확인</button>
            </div>
          </div>
        </div>`;
      if (focusKey) area.querySelector(`.btn-set-date[data-date="${focusKey}"]:not(:disabled)`)?.focus();
    };

    const close = (returnFocus = true) => {
      if (!isOpen()) return;
      area.classList.remove("active");
      openList = null;
      button.setAttribute("aria-expanded", "false");
      if (returnFocus) button.focus();
    };

    const open = () => {
      const typed = parseDateKey(input.value);
      selected = typed;
      const base = typed ? new Date(typed.replace(/-/g, "/")) : defaultView();
      view = { year: base.getFullYear(), month: base.getMonth() + 1 };
      openList = null;
      if (!area) {
        area = document.createElement("div");
        area.className = "krds-calendar-area";
        area.id = `${input.id}_calendar`;
        conts.append(area);
        button.setAttribute("aria-controls", area.id);
        bindArea();
      }
      render();
      area.classList.add("active");
      button.setAttribute("aria-expanded", "true");
      const target = area.querySelector(".btn-set-date[aria-pressed='true']") || area.querySelector("td.today .btn-set-date:not(:disabled)");
      setTimeout(() => (target || area.querySelector(".calendar-wrap")).focus(), 50);
    };

    const moveView = (offset, focusKey) => {
      const next = new Date(view.year, view.month - 1 + offset, 1);
      view = { year: next.getFullYear(), month: next.getMonth() + 1 };
      openList = null;
      render(focusKey);
    };

    const bindArea = () => {
      area.addEventListener("click", (event) => {
        const target = event.target.closest("button");
        if (!target) return;
        if (target.dataset.move) {
          moveView(Number(target.dataset.move));
          area.querySelector(`.btn-cal-move.${Number(target.dataset.move) < 0 ? "prev" : "next"}`).focus();
        } else if (target.dataset.switch) {
          const type = target.dataset.switch;
          openList = openList === type ? null : type;
          render();
          area.querySelector(openList ? `.calendar-select.active button.active` : `[data-switch="${type}"]`)?.focus();
        } else if (target.dataset.year || target.dataset.month) {
          if (target.dataset.year) view.year = Number(target.dataset.year);
          if (target.dataset.month) view.month = Number(target.dataset.month);
          const type = target.dataset.year ? "year" : "month";
          openList = null;
          render();
          area.querySelector(`[data-switch="${type}"]`).focus();
        } else if (target.dataset.date) {
          selected = target.dataset.date;
          render(selected);
        } else if (target.dataset.action === "today") {
          const today = new Date();
          view = { year: today.getFullYear(), month: today.getMonth() + 1 };
          const key = toKey(today);
          if (!disabledReason(key)) selected = key;
          render(key);
          if (disabledReason(key)) area.querySelector('[data-action="today"]').focus();
        } else if (target.dataset.action === "cancel") {
          close();
        } else if (target.dataset.action === "confirm") {
          if (selected) {
            input.value = selected;
            input.dispatchEvent(new Event("input", { bubbles: true }));
          }
          close();
        }
      });

      area.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          if (openList) {
            const type = openList;
            openList = null;
            render();
            area.querySelector(`[data-switch="${type}"]`).focus();
          } else {
            close();
          }
          return;
        }
        // 날짜 이동: ←→ 하루, ↑↓ 일주일 (다른 달로 넘어가면 달력도 이동)
        const dateButton = event.target.closest(".btn-set-date");
        const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[event.key];
        if (dateButton && step) {
          event.preventDefault();
          const [y, m, d] = dateButton.dataset.date.split("-").map(Number);
          const next = new Date(y, m - 1, d + step);
          const key = toKey(next);
          if (next.getMonth() + 1 !== view.month || next.getFullYear() !== view.year) {
            view = { year: next.getFullYear(), month: next.getMonth() + 1 };
            render();
          }
          const nextButton = area.querySelector(`.btn-set-date[data-date="${key}"]`);
          if (nextButton && !nextButton.disabled) nextButton.focus();
          else area.querySelector(`.btn-set-date[data-date="${dateButton.dataset.date}"]`)?.focus();
          return;
        }
        // 초점 가두기 (렌더링마다 요소가 바뀌므로 매번 다시 찾는다)
        if (event.key === "Tab") {
          const focusables = [...area.querySelectorAll("button:not(:disabled)")].filter((el) => el.offsetParent !== null);
          const first = focusables[0];
          const last = focusables[focusables.length - 1];
          if (event.shiftKey && (document.activeElement === first || document.activeElement === area.querySelector(".calendar-wrap"))) {
            event.preventDefault();
            last.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
          }
        }
      });
    };

    button.addEventListener("click", () => (isOpen() ? close() : open()));
    // 날짜를 누르면 달력을 다시 그리므로 event.target 대신 클릭 당시의 경로로 바깥 클릭을 판단한다
    document.addEventListener("click", (event) => {
      if (isOpen() && !event.composedPath().includes(conts)) close(false);
    });
  };

  if (holidayDate && $("btn_holiday_calendar")) {
    createDatePicker({
      conts: $("holiday_date_conts"),
      input: holidayDate,
      button: $("btn_holiday_calendar"),
      disabledReason: (key) => (state.holidays[key] ? `이미 등록된 공휴일 ${state.holidays[key]}` : ""),
      defaultView: () => new Date(state.year, state.month - 1, 1),
    });
  }

  holidayForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    const key = parseDateKey(holidayDate.value);
    const name = holidayName.value.trim();

    let dateError = "";
    if (!holidayDate.value.trim()) dateError = "날짜를 입력해 주세요.";
    else if (!key) dateError = "날짜를 YYYY-MM-DD 형식의 올바른 날짜로 입력해 주세요. 예: 2026-10-05";
    else if (state.holidays[key]) dateError = `이미 등록된 공휴일입니다. (${formatDate(key)} ${state.holidays[key]})`;
    const nameError = name ? "" : "공휴일명을 입력해 주세요.";

    setFieldError(holidayDate, dateError, DATE_HINT);
    setFieldError(holidayName, nameError, NAME_HINT);
    if (dateError || nameError) {
      (dateError ? holidayDate : holidayName).focus();
      return;
    }

    state.holidays[key] = name;
    delete state.schedule[key];
    save();
    // 추가한 공휴일이 보이도록 해당 달로 이동
    const [year, month] = key.split("-").map(Number);
    state.year = year;
    state.month = month;
    render();

    holidayForm.reset();
    holidayDate.focus();
    announce(`공휴일을 추가했습니다. ${year}년 ${formatDate(key)} ${name}`);
  });

  holidayList?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-holiday]");
    if (!button) return;
    const key = button.dataset.holiday;
    const name = state.holidays[key];
    const prevKey = button.closest("li").previousElementSibling?.querySelector("[data-holiday]")?.dataset.holiday;

    delete state.holidays[key];
    save();
    render();

    // 삭제 후 이전 항목, 없으면 목록으로 초점 이동
    (holidayList.querySelector(`[data-holiday="${prevKey}"]`) || holidayList.querySelector("[data-holiday]") || holidayList).focus();
    announce(`공휴일을 삭제했습니다. ${formatDate(key)} ${name}. 이 날짜의 근무는 자동 편성으로 채울 수 있습니다.`);
  });

  /* 자동 편성 */
  $("btn_auto_assign")?.addEventListener("click", () => {
    const workdays = currentWorkdays();
    const { days } = assignDuties({ workdays, members: state.members, unavailable: state.unavailable });
    workdays.forEach((key, i) => {
      state.schedule[key] = { ...days[i] };
    });
    save();
    render();

    const unassigned = days.reduce((sum, day) => sum + countEmpty(day), 0);
    announce(`${state.year}년 ${state.month}월 근무를 자동 편성했습니다.${unassigned ? ` 미배정 ${unassigned}건이 있습니다.` : ""}`);
  });

  /* 근무 불가일 등록 모달: 표시 중인 달 기준, 저장 전까지는 draft에서만 변경 */
  const memberSelect = $("unavailable_member");
  const unavailableList = $("unavailable_list");
  let draft = {};

  const renderUnavailableList = () => {
    $("unavailable_legend").textContent = `${state.year}년 ${state.month}월 근무 불가 시간 선택`;
    const selected = new Set(draft[memberSelect.value] || []);
    unavailableList.innerHTML = currentWorkdays()
      .map((key) => {
        const [, month, day] = key.split("-").map(Number);
        const weekday = WEEKDAYS[new Date(state.year, month - 1, day).getDay()];
        const id = key.replace(/-/g, "");
        const chips = slotsOf(key)
          .map((slot) => {
            const value = `${key}_${slot}`;
            const inputId = `chk_unavailable_${id}_${slot.toLowerCase()}`;
            // 종일은 예전에 오전/오후로 저장한 불가일도 선택된 것으로 본다
            const checked = (slot === "DAY" ? SLOTS : [slot]).some((s) => selected.has(`${key}_${s}`));
            return `<div class="krds-form-chip small">
              <input type="checkbox" class="checkbox" id="${inputId}" name="unavailable" value="${value}"${checked ? " checked" : ""}>
              <label class="krds-form-chip-outline" for="${inputId}">${SLOT_LABEL[slot]}</label>
            </div>`;
          })
          .join("");
        return `<div class="ssms-unavailable__row" role="group" aria-labelledby="unavailable_date_${id}">
          <span class="ssms-unavailable__date" id="unavailable_date_${id}">${month}월 ${day}일 (${weekday})</span>
          <div class="krds-check-area">${chips}</div>
        </div>`;
      })
      .join("");
  };

  function renderMemberOptions() {
    if (!memberSelect) return;
    const selected = memberSelect.value;
    memberSelect.innerHTML = state.members.map((name) => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join("");
    if (state.members.includes(selected)) memberSelect.value = selected;
  }

  if (memberSelect && unavailableList) {

    // 모달은 ui-script.js(krds_modal)가 열고, 여기서는 내용만 채운다
    document.querySelectorAll('.open-modal[data-target="modal_unavailable"]').forEach((button) => {
      button.addEventListener("click", () => {
        draft = JSON.parse(JSON.stringify(state.unavailable));
        renderUnavailableList();
      });
    });
    memberSelect.addEventListener("change", renderUnavailableList);
    unavailableList.addEventListener("change", (event) => {
      if (event.target.name !== "unavailable") return;
      const prefix = `${state.year}-${pad(state.month)}-`;
      const otherMonths = (draft[memberSelect.value] || []).filter((value) => !value.startsWith(prefix));
      const checked = [...unavailableList.querySelectorAll('input[name="unavailable"]:checked')].map((c) => c.value);
      draft[memberSelect.value] = [...otherMonths, ...checked];
    });
    $("btn_unavailable_save")?.addEventListener("click", () => {
      state.unavailable = draft;
      save();
      announce(`${memberSelect.value}의 근무 불가일을 저장했습니다.`);
    });
  }

  /* 투입 인원 수정: 추가, 이름 수정(목록에서 바로 편집), 삭제(확인 모달) */
  const memberForm = $("member_form");
  const memberName = $("member_name");
  const memberList = $("member_list");
  const MEMBER_HINT = "20자 이내로 입력해 주세요.";
  let editingMember = null;
  let pendingDelete = null;

  const validateMemberName = (name, current) => {
    if (!name) return "이름을 입력해 주세요.";
    if (name !== current && state.members.includes(name)) return "이미 등록된 이름입니다.";
    return "";
  };

  function renderMemberEditor() {
    if (!memberList) return;
    memberList.innerHTML = state.members.length
      ? state.members
          .map((name) => {
            const safe = escapeHtml(name);
            if (name === editingMember) {
              return `<li class="ssms-member__item ssms-member__item--editing">
                <div class="form-group">
                  <label class="sr-only" for="member_edit">${safe} 이름 수정</label>
                  <div class="form-conts">
                    <input type="text" id="member_edit" class="krds-input small" value="${safe}" maxlength="20" autocomplete="off" aria-describedby="member_edit_hint">
                  </div>
                  <p class="form-hint" id="member_edit_hint">${MEMBER_HINT}</p>
                </div>
                <div class="ssms-member__actions">
                  <button type="button" class="krds-btn xsmall tertiary" data-action="cancel">취소</button>
                  <button type="button" class="krds-btn xsmall primary" data-action="save">저장</button>
                </div>
              </li>`;
            }
            return `<li class="ssms-member__item">
              <span>${safe}</span>
              <div class="ssms-member__actions">
                <button type="button" class="krds-btn xsmall tertiary" data-action="edit" data-member="${safe}" aria-label="${safe} 이름 수정">수정</button>
                <button type="button" class="krds-btn xsmall tertiary" data-action="delete" data-member="${safe}" aria-label="${safe} 삭제">삭제</button>
              </div>
            </li>`;
          })
          .join("")
      : `<li class="ssms-member__item">등록된 투입 인원이 없습니다.</li>`;
  }

  const focusMemberButton = (name, action) => {
    const button = [...memberList.querySelectorAll(`[data-action="${action}"]`)].find((b) => b.dataset.member === name);
    (button || memberList).focus();
  };

  const renameMember = (from, to) => {
    state.members = state.members.map((name) => (name === from ? to : name));
    if (state.unavailable[from]) {
      state.unavailable[to] = state.unavailable[from];
      delete state.unavailable[from];
    }
    Object.values(state.schedule).forEach((duty) => {
      SLOTS.forEach((slot) => {
        if (duty[slot] === from) duty[slot] = to;
      });
    });
  };

  const saveEdit = () => {
    const input = $("member_edit");
    const from = editingMember;
    const to = input.value.trim();
    const error = validateMemberName(to, from);
    setFieldError(input, error, MEMBER_HINT);
    if (error) {
      input.focus();
      return;
    }
    editingMember = null;
    if (to !== from) {
      renameMember(from, to);
      save();
    }
    render();
    focusMemberButton(to, "edit");
    announce(to === from ? "이름이 변경되지 않았습니다." : `투입 인원 이름을 변경했습니다. ${from}에서 ${to}`);
  };

  const cancelEdit = () => {
    const name = editingMember;
    editingMember = null;
    renderMemberEditor();
    focusMemberButton(name, "edit");
  };

  memberForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    const name = memberName.value.trim();
    const error = validateMemberName(name);
    setFieldError(memberName, error, MEMBER_HINT);
    if (error) {
      memberName.focus();
      return;
    }
    state.members = [...state.members, name];
    save();
    render();
    memberForm.reset();
    memberName.focus();
    announce(`투입 인원을 추가했습니다. ${name}`);
  });

  memberList?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-action]");
    if (!button) return;
    const { action, member } = button.dataset;

    if (action === "edit") {
      editingMember = member;
      renderMemberEditor();
      const input = $("member_edit");
      input.focus();
      input.select();
    } else if (action === "save") {
      saveEdit();
    } else if (action === "cancel") {
      cancelEdit();
    } else if (action === "delete" && typeof krds_modal !== "undefined") {
      pendingDelete = member;
      $("member_delete_message").textContent = `'${member}' 인원을 삭제합니다. 등록된 불가일도 함께 삭제되며, 이미 편성된 근무는 그대로 남습니다.`;
      // krds_modal이 닫힐 때 초점을 돌려줄 수 있도록 트리거 표시 (ui-script.js의 open-modal 처리와 동일)
      button.classList.add("modal-opened");
      button.setAttribute("data-modal-id", "modal_member_delete");
      krds_modal.openModal("modal_member_delete");
    }
  });

  memberList?.addEventListener("keydown", (event) => {
    if (event.target.id !== "member_edit") return;
    if (event.key === "Enter") {
      event.preventDefault();
      saveEdit();
    } else if (event.key === "Escape") {
      cancelEdit();
    }
  });

  $("btn_member_delete")?.addEventListener("click", () => {
    const name = pendingDelete;
    if (!name) return;
    const index = state.members.indexOf(name);
    const prev = state.members[index - 1];
    pendingDelete = null;

    state.members = state.members.filter((n) => n !== name);
    delete state.unavailable[name];
    save();
    render();
    announce(`투입 인원을 삭제했습니다. ${name}. 이미 편성된 근무는 근무 자동 편성으로 다시 짤 수 있습니다.`);
    // 모달이 닫힌 뒤 이전 인원, 없으면 목록으로 초점 이동
    setTimeout(() => focusMemberButton(prev || state.members[0], "delete"), 400);
  });

  /*
   * 근무 직접 수정: 달력의 근무일을 누르면 그날의 근무 수정 모달을 연다
   * - KRDS 입력폼 패턴: 입력 5개 이내의 수정은 모달, 저장 버튼은 오른쪽 아래
   * - 불가 시간이거나 같은 사람이 오전/오후를 모두 맡으면 막지 않고 칸 아래에 안내한다
   */
  const dutySlots = $("duty_slots");
  let editingDate = null;

  const renderDutyNotices = () => {
    const selects = [...dutySlots.querySelectorAll("select[data-slot]")];
    const chosen = selects.map((select) => select.value).filter(Boolean);
    selects.forEach((select) => {
      const name = select.value;
      const slot = select.dataset.slot;
      const notices = [];
      if (name && (slot === "DAY" ? SLOTS : [slot]).some((s) => (state.unavailable[name] || []).includes(`${editingDate}_${s}`))) {
        notices.push(`${name}의 근무 불가 시간으로 등록되어 있습니다.`);
      }
      if (name && chosen.filter((n) => n === name).length > 1) notices.push("같은 사람이 오전과 오후를 모두 맡습니다.");

      const hint = $(`${select.id}_hint`);
      select.closest(".form-conts").classList.toggle("is-information", notices.length > 0);
      // KRDS 안내 문구 클래스는 display를 지정하므로 hidden 대신 클래스를 뺀다
      hint.className = notices.length ? "form-hint-information" : "";
      hint.textContent = notices.join(" ");
    });
  };

  const renderDutySlots = () => {
    const duty = state.schedule[editingDate] || {};
    dutySlots.innerHTML = slotsOf(editingDate)
      .map((slot) => {
        const id = `duty_slot_${slot.toLowerCase()}`;
        const current = duty[slot] || "";
        // 삭제된 인원이 배정되어 있으면 선택지에 남겨 둔다
        const names = current && !state.members.includes(current) ? [...state.members, current] : state.members;
        const options = [`<option value="">미배정</option>`]
          .concat(names.map((name) => `<option value="${escapeHtml(name)}"${name === current ? " selected" : ""}>${escapeHtml(name)}</option>`))
          .join("");
        return `<div class="form-group">
          <div class="form-tit"><label for="${id}">${SLOT_LABEL[slot]}</label></div>
          <div class="form-conts">
            <select id="${id}" class="krds-form-select" data-slot="${slot}" aria-describedby="${id}_hint">${options}</select>
          </div>
          <p id="${id}_hint"></p>
        </div>`;
      })
      .join("");
    renderDutyNotices();
  };

  const focusDateButton = (date) => {
    document.querySelector(`[data-edit-date="${date}"]`)?.focus();
  };

  const openDutyEdit = (date, trigger) => {
    if (typeof krds_modal === "undefined") return;
    editingDate = date;
    $("tit_modal_duty_edit").textContent = `${formatDate(date)} 근무 수정`;
    renderDutySlots();
    // krds_modal이 닫힐 때 초점을 돌려줄 수 있도록 트리거 표시 (ui-script.js의 open-modal 처리와 동일)
    trigger.classList.add("modal-opened");
    trigger.setAttribute("data-modal-id", "modal_duty_edit");
    krds_modal.openModal("modal_duty_edit");
  };

  if (dutySlots) {
    // 날짜 버튼(키보드)과 근무일 칸 어디를 눌러도(마우스) 같은 모달을 연다
    $("calendar_body").addEventListener("click", (event) => {
      const cell = event.target.closest(".ssms-calendar__cell--editable");
      if (!cell) return;
      const button = cell.querySelector("[data-edit-date]");
      openDutyEdit(button.dataset.editDate, button);
    });
    dutySlots.addEventListener("change", renderDutyNotices);

    $("btn_duty_save")?.addEventListener("click", () => {
      const date = editingDate;
      if (!date) return;
      state.schedule[date] = Object.fromEntries(
        [...dutySlots.querySelectorAll("select[data-slot]")].map((select) => [select.dataset.slot, select.value || null])
      );
      save();
      render();
      announce(`${formatDate(date)} 근무를 수정했습니다.`);
      // 달력을 다시 그려 트리거가 바뀌었으므로, 모달이 닫힌 뒤 같은 날짜 버튼으로 초점 이동
      setTimeout(() => focusDateButton(date), 400);
    });
  }

  render();
})();
