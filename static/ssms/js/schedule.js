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

  const createDutyItem = (half, name) => {
    const item = document.createElement("li");
    item.className = "ssms-calendar__item";
    const badge = document.createElement("span");
    badge.className = `krds-badge ${name ? HALF_BADGE[half] : "bg-light-danger"}`;
    badge.textContent = HALF_LABEL[half];
    item.append(badge, ` ${name || "미배정"}`);
    return item;
  };

  const renderSchedule = (workdays, { days, stats }) => {
    workdays.forEach((date, i) => {
      const cell = document.querySelector(`.ssms-calendar__cell[data-date="${date}"]`);
      if (!cell) return;
      let list = cell.querySelector(".ssms-calendar__list");
      if (!list) {
        list = document.createElement("ul");
        list.className = "ssms-calendar__list";
        cell.append(list);
      }
      list.replaceChildren(...HALVES.map((half) => createDutyItem(half, days[i][half])));
    });

    state.members.forEach((name) => {
      const row = document.querySelector(`.ssms-members tr[data-member="${name}"]`);
      if (!row) return;
      HALVES.forEach((half) => {
        row.querySelector(`[data-count="${half.toLowerCase()}"]`).textContent = stats[name][half];
      });
    });
  };

  const status = document.getElementById("schedule_status");
  document.getElementById("btn_auto_assign")?.addEventListener("click", () => {
    const workdays = getWorkdays(state.year, state.month, state.holidays);
    const result = assignDuties({ workdays, members: state.members, unavailable: state.unavailable });
    renderSchedule(workdays, result);

    const unassigned = result.days.reduce((sum, day) => sum + HALVES.filter((half) => !day[half]).length, 0);
    if (status) {
      status.textContent = `${state.year}년 ${state.month}월 근무를 자동 편성했습니다.${unassigned ? ` 미배정 ${unassigned}건이 있습니다.` : ""}`;
    }
  });

  /* 근무 불가일 등록 모달: 저장 전까지는 draft에서만 변경 */
  const memberSelect = document.getElementById("unavailable_member");
  const checkboxes = [...document.querySelectorAll('input[name="unavailable"]')];
  let draft = {};

  const syncCheckboxes = () => {
    const selected = new Set(draft[memberSelect.value] || []);
    checkboxes.forEach((checkbox) => {
      checkbox.checked = selected.has(checkbox.value);
    });
  };

  document.querySelectorAll('.open-modal[data-target="modal_unavailable"]').forEach((button) => {
    button.addEventListener("click", () => {
      draft = JSON.parse(JSON.stringify(state.unavailable));
      syncCheckboxes();
    });
  });
  memberSelect?.addEventListener("change", syncCheckboxes);
  checkboxes.forEach((checkbox) => {
    checkbox.addEventListener("change", () => {
      draft[memberSelect.value] = checkboxes.filter((c) => c.checked).map((c) => c.value);
    });
  });
  document.getElementById("btn_unavailable_save")?.addEventListener("click", () => {
    state.unavailable = draft;
  });
})();
