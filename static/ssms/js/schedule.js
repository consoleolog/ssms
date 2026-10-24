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
  const EXCELJS_URL = new URL("../lib/exceljs/exceljs.min.js", document.currentScript?.src || window.location.href).href;
  const dataElement = document.getElementById("schedule_data");
  if (!dataElement) return;
  /*
   * 로컬 저장 (localStorage)
   * - #schedule_data는 처음 실행할 때의 초기값이고, 이후에는 저장된 값을 우선한다
   * - 투입 인원(members)은 아직 화면에서 관리하지 않으므로 초기값을 그대로 쓴다
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
    members: seed.members,
    holidays: stored?.holidays || seed.holidays || {},
    unavailable: stored?.unavailable || seed.unavailable || {},
    schedule: stored?.schedule || seed.schedule || {},
    filter: "",
  };

  let saveFailed = false;
  const save = () => {
    try {
      const { holidays, unavailable, schedule } = state;
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: STORAGE_VERSION, savedAt: new Date().toISOString(), holidays, unavailable, schedule }));
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
    const isWorkday = !isOtherMonth && weekday !== 0 && weekday !== 6 && !holiday;

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

    const unassigned = days.reduce((sum, day) => sum + HALVES.filter((half) => !day[half]).length, 0);
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
      save();
      announce(`${memberSelect.value}의 근무 불가일을 저장했습니다.`);
    });
  }

  /*
   * 엑셀 내보내기 (표시 중인 달)
   * - ExcelJS는 용량이 커서 버튼을 처음 누를 때 불러온다 (static/ssms/lib/exceljs, MIT)
   * - 시트: 달력 / 근무 목록 / 인원별 집계
   */
  let excelJsLoading = null;
  const loadExcelJs = () => {
    if (window.ExcelJS) return Promise.resolve(window.ExcelJS);
    excelJsLoading =
      excelJsLoading ||
      new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = EXCELJS_URL;
        script.onload = () => resolve(window.ExcelJS);
        script.onerror = () => {
          excelJsLoading = null;
          reject(new Error("ExcelJS load failed"));
        };
        document.head.append(script);
      });
    return excelJsLoading;
  };

  const XL = {
    border: { style: "thin", color: { argb: "FFCDD1D5" } },
    headFill: { type: "pattern", pattern: "solid", fgColor: { argb: "FFEEF2F7" } },
    todayFill: { type: "pattern", pattern: "solid", fgColor: { argb: "FFECF2FE" } },
    red: { argb: "FFD63D4A" },
    blue: { argb: "FF0B78CB" },
    gray: { argb: "FF8A949E" },
  };
  const allBorders = { top: XL.border, left: XL.border, bottom: XL.border, right: XL.border };

  const styleHeaderRow = (row) => {
    row.eachCell((cell) => {
      cell.font = { bold: true };
      cell.fill = XL.headFill;
      cell.border = allBorders;
      cell.alignment = { vertical: "middle", horizontal: "center" };
    });
  };

  const addCalendarSheet = (workbook, title) => {
    const sheet = workbook.addWorksheet("달력", {
      pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 },
    });
    sheet.columns = WEEKDAYS.map(() => ({ width: 18 }));
    sheet.mergeCells(1, 1, 1, 7);
    sheet.getCell(1, 1).value = `${title} 전산근무표`;
    sheet.getCell(1, 1).font = { bold: true, size: 16 };
    sheet.getRow(1).height = 30;

    const head = sheet.addRow(WEEKDAYS);
    styleHeaderRow(head);
    head.getCell(1).font = { bold: true, color: XL.red };
    head.getCell(7).font = { bold: true, color: XL.blue };

    const first = new Date(state.year, state.month - 1, 1);
    const day = new Date(first);
    day.setDate(1 - first.getDay());
    const todayKey = toKey(new Date());

    while (day.getMonth() + 1 === state.month || day < first) {
      const row = sheet.addRow([]);
      row.height = 62;
      for (let col = 1; col <= 7; col += 1) {
        const cell = row.getCell(col);
        const key = toKey(day);
        cell.border = allBorders;
        cell.alignment = { vertical: "top", horizontal: "left", wrapText: true };

        if (day.getMonth() + 1 === state.month) {
          const weekday = day.getDay();
          const holiday = state.holidays[key];
          const dateColor = weekday === 0 || holiday ? XL.red : weekday === 6 ? XL.blue : undefined;
          const runs = [{ text: `${day.getDate()}${holiday ? ` ${holiday}` : ""}`, font: { bold: true, color: dateColor } }];
          const duty = state.schedule[key];
          if (duty && weekday !== 0 && weekday !== 6 && !holiday) {
            HALVES.forEach((half) => runs.push({ text: `\n${HALF_LABEL[half]} ${duty[half] || "미배정"}`, font: duty[half] ? {} : { color: XL.red } }));
          }
          cell.value = { richText: runs };
          if (key === todayKey) cell.fill = XL.todayFill;
        }
        day.setDate(day.getDate() + 1);
      }
    }
  };

  const addListSheet = (workbook) => {
    const sheet = workbook.addWorksheet("근무 목록");
    sheet.columns = [{ width: 14 }, { width: 8 }, { width: 14 }, { width: 14 }];
    styleHeaderRow(sheet.addRow(["날짜", "요일", "오전", "오후"]));
    currentWorkdays().forEach((key) => {
      const [year, month, date] = key.split("-").map(Number);
      const duty = state.schedule[key] || {};
      const row = sheet.addRow([key, WEEKDAYS[new Date(year, month - 1, date).getDay()], duty.AM || "미배정", duty.PM || "미배정"]);
      row.eachCell((cell) => {
        cell.border = allBorders;
        cell.alignment = { horizontal: "center" };
        if (cell.value === "미배정") cell.font = { color: XL.red };
      });
    });
    sheet.views = [{ state: "frozen", ySplit: 1 }];
  };

  const addMemberSheet = (workbook) => {
    const sheet = workbook.addWorksheet("인원별 집계");
    sheet.columns = [{ width: 14 }, { width: 10 }, { width: 10 }, { width: 10 }];
    styleHeaderRow(sheet.addRow(["이름", "오전", "오후", "합계"]));
    const counts = Object.fromEntries(state.members.map((name) => [name, { AM: 0, PM: 0 }]));
    currentWorkdays().forEach((key) => {
      const duty = state.schedule[key] || {};
      HALVES.forEach((half) => {
        if (counts[duty[half]]) counts[duty[half]][half] += 1;
      });
    });
    state.members.forEach((name) => {
      const { AM, PM } = counts[name];
      sheet.addRow([name, AM, PM, AM + PM]).eachCell((cell) => {
        cell.border = allBorders;
        cell.alignment = { horizontal: "center" };
      });
    });
  };

  const downloadBlob = (blob, fileName) => {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const exportButton = $("btn_export_excel");
  exportButton?.addEventListener("click", async () => {
    const title = `${state.year}년 ${state.month}월`;
    exportButton.disabled = true;
    try {
      const ExcelJS = await loadExcelJs();
      const workbook = new ExcelJS.Workbook();
      workbook.creator = "SSMS";
      workbook.created = new Date();
      addCalendarSheet(workbook, title);
      addListSheet(workbook);
      addMemberSheet(workbook);

      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      downloadBlob(blob, `전산근무표_${state.year}-${pad(state.month)}.xlsx`);
      announce(`${title} 근무표를 엑셀 파일로 내보냈습니다.`);
    } catch (error) {
      announce("엑셀 파일을 만들지 못했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      exportButton.disabled = false;
    }
  });

  render();
})();
