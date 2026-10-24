/*** * 전산근무표 자동 편성 * ***/
(() => {
  const HALVES = ["AM", "PM"];
  const HALF_LABEL = { AM: "오전", PM: "오후" };
  const HALF_BADGE = { AM: "bg-light-primary", PM: "bg-light-point" };
  // 무작위 편성을 여러 번 시도해 가장 공평한 결과를 고른다
  const TRY_COUNT = 300;

  const pad = (n) => String(n).padStart(2, "0");

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

  /**
   * 1회 편성
   * - 후보가 적은(불가 인원이 많은) 칸부터 채운다
   * - 총 근무 수 → 해당 시간대(오전/오후) 근무 수 → 연속 근무일 순으로 적은 사람을 고른다
   * - 같은 날 오전, 오후를 한 사람이 모두 맡지 않는다
   */
  const assignOnce = (workdays, members, unavailable) => {
    const blocked = new Set();
    members.forEach((name) => (unavailable[name] || []).forEach((slot) => blocked.add(`${name}|${slot}`)));

    const slots = [];
    workdays.forEach((date, dayIndex) => {
      HALVES.forEach((half) => {
        const candidates = members.filter((name) => !blocked.has(`${name}|${date}_${half}`));
        slots.push({ dayIndex, half, candidates });
      });
    });
    // sort는 안정 정렬이므로 섞은 순서가 동점 칸 사이에서 유지된다
    const order = shuffle(slots).sort((a, b) => a.candidates.length - b.candidates.length);

    const stats = Object.fromEntries(members.map((name) => [name, { total: 0, AM: 0, PM: 0 }]));
    const days = workdays.map(() => ({ AM: null, PM: null }));
    const worksOn = (dayIndex, name) => !!days[dayIndex] && (days[dayIndex].AM === name || days[dayIndex].PM === name);

    order.forEach(({ dayIndex, half, candidates }) => {
      const otherHalf = half === "AM" ? "PM" : "AM";
      const pool = candidates.filter((name) => days[dayIndex][otherHalf] !== name);
      if (!pool.length) return;

      const cost = (name) => {
        const adjacent = Number(worksOn(dayIndex - 1, name)) + Number(worksOn(dayIndex + 1, name));
        return stats[name].total * 100 + stats[name][half] * 10 + adjacent;
      };
      const minCost = Math.min(...pool.map(cost));
      const name = pickRandom(pool.filter((n) => cost(n) === minCost));

      days[dayIndex][half] = name;
      stats[name].total += 1;
      stats[name][half] += 1;
    });

    return { days, stats };
  };

  // 낮을수록 좋음: 미배정 > 총 근무 수 편차 > 오전/오후 편중 > 연속 근무
  const scoreOf = ({ days, stats }, members) => {
    const totals = members.map((name) => stats[name].total);
    const unassigned = days.reduce((sum, day) => sum + HALVES.filter((half) => !day[half]).length, 0);
    const range = Math.max(...totals) - Math.min(...totals);
    const halfGap = members.reduce((sum, name) => sum + Math.abs(stats[name].AM - stats[name].PM), 0);
    const streak = days.reduce((sum, day, i) => {
      if (!i) return sum;
      const prev = days[i - 1];
      return sum + HALVES.filter((half) => day[half] && (day[half] === prev.AM || day[half] === prev.PM)).length;
    }, 0);
    return unassigned * 1e6 + range * 1e4 + halfGap * 1e2 + streak;
  };

  /**
   * 근무 자동 편성
   * @param {{ workdays: string[], members: string[], unavailable: Object<string, string[]> }} input
   *   unavailable: { 이름: ["YYYY-MM-DD_AM", "YYYY-MM-DD_PM", ...] }
   * @returns {{ days: {AM: string|null, PM: string|null}[], stats: Object }} workdays와 같은 순서
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
  const state = JSON.parse(dataElement.textContent);
  state.schedule = state.schedule || {};
  state.filter = "";

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
    const halves = HALVES.filter((half) => !state.filter || half === state.filter);
    const items = halves
      .map((half) => {
        const name = duty[half];
        const badge = name ? HALF_BADGE[half] : "bg-light-danger";
        return `<li class="ssms-calendar__item"><span class="krds-badge ${badge}">${HALF_LABEL[half]}</span> ${name ? escapeHtml(name) : "미배정"}</li>`;
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

    const modifiers = [];
    if (isOtherMonth) modifiers.push("other-month");
    if (weekday === 0 || holiday) modifiers.push("holiday");
    else if (weekday === 6) modifiers.push("saturday");
    if (isToday) modifiers.push("today");
    const className = ["ssms-calendar__cell", ...modifiers.map((m) => `ssms-calendar__cell--${m}`)].join(" ");

    const head = [
      isOtherMonth
        ? `<span class="ssms-calendar__date"><span class="sr-only">${date.getMonth() + 1}월 </span>${date.getDate()}</span>`
        : `<span class="ssms-calendar__date">${date.getDate()}</span>`,
      isToday ? `<span class="krds-badge bg-primary">오늘</span>` : "",
      holiday ? `<span class="ssms-calendar__holiday">${escapeHtml(holiday)}</span>` : "",
    ].join("");

    return `<td class="${className}"${isOtherMonth ? "" : ` data-date="${key}"`}${isToday ? ` aria-current="date"` : ""}>
      <div class="ssms-calendar__head">${head}</div>
      ${isOtherMonth ? "" : renderDutyList(key)}
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
    const counts = Object.fromEntries(state.members.map((name) => [name, { AM: 0, PM: 0 }]));
    currentWorkdays().forEach((key) => {
      const duty = state.schedule[key] || {};
      HALVES.forEach((half) => {
        if (counts[duty[half]]) counts[duty[half]][half] += 1;
      });
    });

    $("member_count").textContent = `${state.members.length}명`;
    $("members_caption").textContent = `${state.year}년 ${state.month}월 전산근무 투입 인원으로 이름, 오전 근무 횟수, 오후 근무 횟수로 구성되어 있습니다.`;
    $("members_body").innerHTML = state.members
      .map(
        (name) => `<tr>
          <th scope="row">${escapeHtml(name)}</th>
          <td>${counts[name].AM}</td>
          <td>${counts[name].PM}</td>
        </tr>`
      )
      .join("");
  };

  const render = () => {
    renderCalendar();
    renderMembers();
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
  $("schedule_filter")?.addEventListener("change", (event) => {
    state.filter = event.target.value;
    renderCalendar();
  });

  /* 자동 편성 */
  const status = $("schedule_status");
  $("btn_auto_assign")?.addEventListener("click", () => {
    const workdays = currentWorkdays();
    const { days } = assignDuties({ workdays, members: state.members, unavailable: state.unavailable });
    workdays.forEach((key, i) => {
      state.schedule[key] = { ...days[i] };
    });
    render();

    const unassigned = days.reduce((sum, day) => sum + HALVES.filter((half) => !day[half]).length, 0);
    if (status) {
      status.textContent = `${state.year}년 ${state.month}월 근무를 자동 편성했습니다.${unassigned ? ` 미배정 ${unassigned}건이 있습니다.` : ""}`;
    }
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
        const chips = HALVES.map((half) => {
          const value = `${key}_${half}`;
          const inputId = `chk_unavailable_${id}_${half.toLowerCase()}`;
          return `<div class="krds-form-chip small">
            <input type="checkbox" class="checkbox" id="${inputId}" name="unavailable" value="${value}"${selected.has(value) ? " checked" : ""}>
            <label class="krds-form-chip-outline" for="${inputId}">${HALF_LABEL[half]}</label>
          </div>`;
        }).join("");
        return `<div class="ssms-unavailable__row" role="group" aria-labelledby="unavailable_date_${id}">
          <span class="ssms-unavailable__date" id="unavailable_date_${id}">${month}월 ${day}일 (${weekday})</span>
          <div class="krds-check-area">${chips}</div>
        </div>`;
      })
      .join("");
  };

  if (memberSelect && unavailableList) {
    memberSelect.innerHTML = state.members.map((name) => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join("");

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
    });
  }

  render();
})();
