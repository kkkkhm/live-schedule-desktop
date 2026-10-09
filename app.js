(function () {
  "use strict";

  const Logic = window.ScheduleLogic;
  const STORAGE_KEY = "weekly-live-scheduler-v1";
  const VERSION = 1;
  const weekdays = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
  const dayKeys = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
  const shifts = [
    { key: "morning", label: "早班", startTime: "08:00", endTime: "13:00" },
    { key: "afternoon", label: "中班", startTime: "13:00", endTime: "18:00" },
    { key: "evening", label: "晚班", startTime: "18:30", endTime: "23:30" }
  ];

  const defaultPeople = [
    ["程程", true, false], ["胖金", false, true], ["塔塔", true, false], ["阿怪", false, true],
    ["妍妍", true, false], ["江江", false, true], ["小珂", true, false], ["文慧", false, true]
  ].map(([name, canHost, canCoHost], index) => ({ id: `seed-${index + 1}`, name, canHost, canCoHost, active: true }));

  const elements = {};
  let state = loadState();
  let selectedWeekKey = Logic.toIsoDate(Logic.startOfWeek(new Date()));
  let toastTimer;

  document.addEventListener("DOMContentLoaded", initialize);

  function initialize() {
    Object.assign(elements, {
      weekDateInput: byId("weekDateInput"), weekRangeLabel: byId("weekRangeLabel"), statsRangeLabel: byId("statsRangeLabel"),
      saveStatus: byId("saveStatus"), scheduleHead: byId("scheduleHead"), scheduleBody: byId("scheduleBody"),
      previousWeekBtn: byId("previousWeekBtn"), nextWeekBtn: byId("nextWeekBtn"), todayWeekBtn: byId("todayWeekBtn"),
      personForm: byId("personForm"), personIdInput: byId("personIdInput"), personNameInput: byId("personNameInput"),
      canHostInput: byId("canHostInput"), canCoHostInput: byId("canCoHostInput"), savePersonBtn: byId("savePersonBtn"),
      cancelPersonEditBtn: byId("cancelPersonEditBtn"), personFormError: byId("personFormError"), peopleTableBody: byId("peopleTableBody"),
      statsTableBody: byId("statsTableBody"), sessionCount: byId("sessionCount"), totalPersonHours: byId("totalPersonHours"), conflictList: byId("conflictList"),
      exportJsonBtn: byId("exportJsonBtn"), importJsonBtn: byId("importJsonBtn"), importFileInput: byId("importFileInput"),
      exportScheduleCsvBtn: byId("exportScheduleCsvBtn"), exportStatsCsvBtn: byId("exportStatsCsvBtn"), toast: byId("toast")
    });

    elements.weekDateInput.value = selectedWeekKey;
    bindEvents();
    renderAll();
  }

  function byId(id) { return document.getElementById(id); }

  function createId() {
    if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
    return `person-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function emptyState() { return { version: VERSION, people: structuredCloneSafe(defaultPeople), schedules: {}, settings: {} }; }
  function structuredCloneSafe(value) { return JSON.parse(JSON.stringify(value)); }

  function loadState() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (!saved) return emptyState();
      const parsed = JSON.parse(saved);
      if (!isValidState(parsed)) throw new Error("数据格式无效");
      return parsed;
    } catch (error) {
      setTimeout(() => showToast("本地数据读取失败，已使用初始数据。请及时导出备份。", true), 0);
      return emptyState();
    }
  }

  function isValidState(value) {
    return Boolean(value && value.version === VERSION && Array.isArray(value.people) && value.schedules && typeof value.schedules === "object");
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      elements.saveStatus.textContent = `已自动保存 ${new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}`;
    } catch (error) {
      elements.saveStatus.textContent = "自动保存失败";
      showToast("浏览器无法保存数据，请导出 JSON 备份。", true);
    }
  }

  function bindEvents() {
    elements.previousWeekBtn.addEventListener("click", () => changeWeek(-7));
    elements.nextWeekBtn.addEventListener("click", () => changeWeek(7));
    elements.todayWeekBtn.addEventListener("click", () => selectWeek(new Date()));
    elements.weekDateInput.addEventListener("change", () => selectWeek(elements.weekDateInput.value));
    document.querySelectorAll(".tab").forEach((tab) => tab.addEventListener("click", () => activateTab(tab.dataset.tab)));
    elements.personForm.addEventListener("submit", savePerson);
    elements.cancelPersonEditBtn.addEventListener("click", resetPersonForm);
    elements.exportJsonBtn.addEventListener("click", exportJson);
    elements.importJsonBtn.addEventListener("click", () => elements.importFileInput.click());
    elements.importFileInput.addEventListener("change", importJson);
    elements.exportScheduleCsvBtn.addEventListener("click", exportScheduleCsv);
    elements.exportStatsCsvBtn.addEventListener("click", exportStatsCsv);
  }

  function activateTab(name) {
    document.querySelectorAll(".tab").forEach((tab) => tab.classList.toggle("active", tab.dataset.tab === name));
    document.querySelectorAll("[data-panel]").forEach((panel) => {
      const active = panel.dataset.panel === name;
      panel.hidden = !active;
      panel.classList.toggle("active", active);
    });
    if (name === "stats") renderStats();
  }

  function changeWeek(days) {
    const monday = Logic.parseLocalDate(selectedWeekKey);
    selectWeek(Logic.addDays(monday, days));
  }

  function selectWeek(value) {
    const monday = Logic.startOfWeek(value instanceof Date ? value : value);
    if (!monday) return;
    selectedWeekKey = Logic.toIsoDate(monday);
    elements.weekDateInput.value = selectedWeekKey;
    renderAll();
  }

  function getWeek(create = true) {
    if (!state.schedules[selectedWeekKey] && create) state.schedules[selectedWeekKey] = {};
    return state.schedules[selectedWeekKey] || {};
  }

  function getSlot(dayKey, shift, create = true) {
    const week = getWeek(create);
    if (!week[dayKey] && create) week[dayKey] = {};
    if (!week[dayKey]) return null;
    if (!week[dayKey][shift.key] && create) {
      week[dayKey][shift.key] = { hostId: "", coHostId: "", hostNameSnapshot: "", coHostNameSnapshot: "", startTime: shift.startTime, endTime: shift.endTime, note: "" };
    }
    return week[dayKey][shift.key] || null;
  }

  function renderAll() {
    renderWeekLabel();
    renderSchedule();
    renderPeople();
    renderStats();
  }

  function renderWeekLabel() {
    const dates = Logic.getWeekDates(selectedWeekKey);
    const start = formatFullDate(dates[0]);
    const end = formatFullDate(dates[6]);
    const label = `${start} — ${end}`;
    elements.weekRangeLabel.textContent = label;
    elements.statsRangeLabel.textContent = `统计周期：${label}`;
  }

  function renderSchedule() {
    const dates = Logic.getWeekDates(selectedWeekKey);
    const todayKey = Logic.toIsoDate(new Date());
    const conflicts = Logic.findConflicts(getWeek(false), state.people);
    const conflictKeys = new Set(conflicts.flatMap((item) => item.shifts.map((shiftKey) => `${item.dayKey}:${shiftKey}`)));

    elements.scheduleHead.replaceChildren();
    const headerRow = document.createElement("tr");
    const corner = document.createElement("th");
    corner.textContent = "班次 / 日期";
    headerRow.appendChild(corner);
    dates.forEach((date, index) => {
      const th = document.createElement("th");
      if (Logic.toIsoDate(date) === todayKey) th.classList.add("today-header");
      const dayName = document.createElement("span");
      dayName.className = "day-name";
      dayName.textContent = weekdays[index];
      const dateText = document.createElement("span");
      dateText.className = "day-date";
      dateText.textContent = `${date.getMonth() + 1}.${date.getDate()}`;
      th.append(dayName, dateText);
      headerRow.appendChild(th);
    });
    elements.scheduleHead.appendChild(headerRow);

    elements.scheduleBody.replaceChildren();
    shifts.forEach((shift) => {
      const row = document.createElement("tr");
      const label = document.createElement("td");
      label.className = "shift-label";
      label.textContent = shift.label;
      row.appendChild(label);
      dayKeys.forEach((dayKey) => {
        const cell = document.createElement("td");
        cell.className = "schedule-cell";
        const slot = getSlot(dayKey, shift);
        if (conflictKeys.has(`${dayKey}:${shift.key}`)) cell.classList.add("has-conflict");
        if ((slot.hostId || slot.coHostId) && Logic.durationHours(slot.startTime, slot.endTime) === 0) cell.classList.add("has-error");
        cell.appendChild(buildSlotEditor(dayKey, shift, slot));
        row.appendChild(cell);
      });
      elements.scheduleBody.appendChild(row);
    });
  }

  function buildSlotEditor(dayKey, shift, slot) {
    const wrapper = document.createElement("div");
    const hostRow = buildPersonSelect("主播", "hostId", slot.hostId, state.people.filter((person) => person.canHost), slot.hostNameSnapshot);
    const coHostRow = buildPersonSelect("副播", "coHostId", slot.coHostId, state.people.filter((person) => person.canCoHost), slot.coHostNameSnapshot);
    hostRow.select.addEventListener("change", () => updateSlotPerson(dayKey, shift, "host", hostRow.select.value));
    coHostRow.select.addEventListener("change", () => updateSlotPerson(dayKey, shift, "coHost", coHostRow.select.value));

    const timeRow = document.createElement("div");
    timeRow.className = "time-row";
    const start = document.createElement("input"); start.type = "time"; start.value = slot.startTime || ""; start.ariaLabel = `${shift.label}开始时间`;
    const separator = document.createElement("span"); separator.textContent = "—";
    const end = document.createElement("input"); end.type = "time"; end.value = slot.endTime || ""; end.ariaLabel = `${shift.label}结束时间`;
    [start, end].forEach((input) => input.addEventListener("change", () => {
      const target = getSlot(dayKey, shift);
      target.startTime = start.value;
      target.endTime = end.value;
      persistAndRender();
    }));
    timeRow.append(start, separator, end);

    const duration = document.createElement("div");
    duration.className = "duration";
    const durationLabel = document.createElement("span"); durationLabel.textContent = "直播时长";
    const durationValue = document.createElement("strong"); durationValue.textContent = `${formatHours(Logic.durationHours(slot.startTime, slot.endTime))}h`;
    duration.append(durationLabel, durationValue);

    const note = document.createElement("input");
    note.className = "note-input";
    note.type = "text";
    note.maxLength = 80;
    note.placeholder = "备注（可选）";
    note.value = slot.note || "";
    note.addEventListener("change", () => { getSlot(dayKey, shift).note = note.value.trim(); saveState(); });

    wrapper.append(hostRow.element, coHostRow.element, timeRow, duration, note);
    return wrapper;
  }

  function buildPersonSelect(labelText, field, selectedId, candidates, snapshot) {
    const row = document.createElement("div");
    row.className = "field-row";
    const label = document.createElement("label"); label.textContent = labelText;
    const select = document.createElement("select"); select.dataset.field = field;
    const empty = document.createElement("option"); empty.value = ""; empty.textContent = "未安排"; select.appendChild(empty);
    const selectedExists = candidates.some((person) => person.id === selectedId);
    if (selectedId && !selectedExists) {
      const historic = document.createElement("option"); historic.value = selectedId; historic.textContent = `${snapshot || "历史人员"}（停用）`; select.appendChild(historic);
    }
    candidates.filter((person) => person.active || person.id === selectedId).sort((a, b) => a.name.localeCompare(b.name, "zh-CN")).forEach((person) => {
      const option = document.createElement("option"); option.value = person.id; option.textContent = person.active ? person.name : `${person.name}（停用）`; select.appendChild(option);
    });
    select.value = selectedId || "";
    row.append(label, select);
    return { element: row, select };
  }

  function updateSlotPerson(dayKey, shift, role, personId) {
    const slot = getSlot(dayKey, shift);
    const person = state.people.find((item) => item.id === personId);
    if (role === "host") {
      slot.hostId = personId;
      slot.hostNameSnapshot = person ? person.name : slot.hostNameSnapshot;
    } else {
      slot.coHostId = personId;
      slot.coHostNameSnapshot = person ? person.name : slot.coHostNameSnapshot;
    }
    persistAndRender();
  }

  function persistAndRender() {
    saveState();
    renderSchedule();
    renderStats();
  }

  function renderPeople() {
    elements.peopleTableBody.replaceChildren();
    state.people.slice().sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name, "zh-CN")).forEach((person) => {
      const row = document.createElement("tr");
      row.append(textCell(person.name), textCell([person.canHost ? "主播" : "", person.canCoHost ? "副播" : ""].filter(Boolean).join("、") || "未设置"));
      const statusCell = document.createElement("td");
      const badge = document.createElement("span"); badge.className = `status-badge${person.active ? "" : " inactive"}`; badge.textContent = person.active ? "启用" : "停用"; statusCell.appendChild(badge); row.appendChild(statusCell);
      const actions = document.createElement("td"); actions.className = "row-actions";
      const edit = actionButton("编辑", () => editPerson(person.id));
      const toggle = actionButton(person.active ? "停用" : "启用", () => togglePerson(person.id), person.active ? "danger" : "");
      actions.append(edit, toggle); row.appendChild(actions);
      elements.peopleTableBody.appendChild(row);
    });
  }

  function savePerson(event) {
    event.preventDefault();
    const id = elements.personIdInput.value;
    const name = elements.personNameInput.value.trim();
    const canHost = elements.canHostInput.checked;
    const canCoHost = elements.canCoHostInput.checked;
    elements.personFormError.textContent = "";
    if (!name) return showPersonError("请输入姓名。");
    if (!canHost && !canCoHost) return showPersonError("请至少选择一个角色。");
    if (state.people.some((person) => person.name.toLocaleLowerCase("zh-CN") === name.toLocaleLowerCase("zh-CN") && person.id !== id)) return showPersonError("该姓名已存在。");
    if (id) {
      const person = state.people.find((item) => item.id === id);
      if (!person) return showPersonError("未找到要编辑的人员。");
      Object.assign(person, { name, canHost, canCoHost });
      showToast("人员信息已更新");
    } else {
      state.people.push({ id: createId(), name, canHost, canCoHost, active: true });
      showToast("人员已新增");
    }
    saveState(); resetPersonForm(); renderAll();
  }

  function showPersonError(message) { elements.personFormError.textContent = message; }

  function editPerson(id) {
    const person = state.people.find((item) => item.id === id);
    if (!person) return;
    elements.personIdInput.value = person.id;
    elements.personNameInput.value = person.name;
    elements.canHostInput.checked = person.canHost;
    elements.canCoHostInput.checked = person.canCoHost;
    elements.savePersonBtn.textContent = "保存修改";
    elements.cancelPersonEditBtn.hidden = false;
    elements.personNameInput.focus();
  }

  function resetPersonForm() {
    elements.personForm.reset();
    elements.personIdInput.value = "";
    elements.personFormError.textContent = "";
    elements.savePersonBtn.textContent = "新增人员";
    elements.cancelPersonEditBtn.hidden = true;
  }

  function togglePerson(id) {
    const person = state.people.find((item) => item.id === id);
    if (!person) return;
    person.active = !person.active;
    saveState(); renderAll();
    showToast(`${person.name}已${person.active ? "启用" : "停用"}`);
  }

  function renderStats() {
    const week = getWeek(false);
    const stats = Logic.calculateStatistics(week, state.people);
    const conflicts = Logic.findConflicts(week, state.people);
    elements.sessionCount.textContent = String(stats.sessionCount);
    elements.totalPersonHours.textContent = `${formatHours(stats.totalPersonHours)}h`;
    elements.statsTableBody.replaceChildren();
    if (!stats.rows.length) {
      const row = document.createElement("tr"); const cell = document.createElement("td"); cell.colSpan = 4; cell.textContent = "本周暂无有效排班"; row.appendChild(cell); elements.statsTableBody.appendChild(row);
    } else {
      stats.rows.forEach((item) => {
        const row = document.createElement("tr");
        row.append(textCell(item.name), textCell(`${formatHours(item.hostHours)}h`), textCell(`${formatHours(item.coHostHours)}h`), textCell(`${formatHours(item.totalHours)}h`));
        elements.statsTableBody.appendChild(row);
      });
    }
    elements.conflictList.replaceChildren();
    if (!conflicts.length) {
      const ok = document.createElement("p"); ok.className = "check-ok"; ok.textContent = "未发现人员冲突或时间错误。"; elements.conflictList.appendChild(ok);
    } else {
      conflicts.forEach((conflict) => {
        const item = document.createElement("p"); item.className = "conflict-item"; item.textContent = conflictText(conflict); elements.conflictList.appendChild(item);
      });
    }
  }

  function conflictText(conflict) {
    const dayIndex = dayKeys.indexOf(conflict.dayKey);
    const shiftNames = conflict.shifts.map((key) => shifts.find((shift) => shift.key === key)?.label || key).join("、");
    if (conflict.type === "overlap") return `${weekdays[dayIndex]}：${conflict.personName}在${shiftNames}时间重叠。`;
    if (conflict.type === "same-role-person") return `${weekdays[dayIndex]}${shiftNames}：主播和副播不能是同一人。`;
    return `${weekdays[dayIndex]}${shiftNames}：已安排人员，但直播时间无效。`;
  }

  function exportJson() {
    downloadFile(`直播排班备份-${todayStamp()}.json`, JSON.stringify(state, null, 2), "application/json;charset=utf-8");
    showToast("JSON 备份已导出");
  }

  async function importJson(event) {
    const file = event.target.files && event.target.files[0];
    event.target.value = "";
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      if (!isValidState(parsed)) throw new Error("备份格式或版本不正确");
      if (!window.confirm("导入会覆盖当前人员和全部排班数据。是否继续？")) return;
      state = parsed;
      saveState(); resetPersonForm(); renderAll(); showToast("备份已导入");
    } catch (error) {
      showToast(`导入失败：${error.message}`, true);
    }
  }

  function exportScheduleCsv() {
    const rows = [["日期", "星期", "班次", "主播", "副播", "开始时间", "结束时间", "直播时长", "备注"]];
    const dates = Logic.getWeekDates(selectedWeekKey);
    const week = getWeek(false);
    dayKeys.forEach((dayKey, dayIndex) => shifts.forEach((shift) => {
      const slot = week[dayKey]?.[shift.key];
      if (!slot || (!slot.hostId && !slot.coHostId && !slot.note)) return;
      const host = state.people.find((person) => person.id === slot.hostId)?.name || slot.hostNameSnapshot || "";
      const coHost = state.people.find((person) => person.id === slot.coHostId)?.name || slot.coHostNameSnapshot || "";
      rows.push([Logic.toIsoDate(dates[dayIndex]), weekdays[dayIndex], shift.label, host, coHost, slot.startTime || "", slot.endTime || "", formatHours(Logic.durationHours(slot.startTime, slot.endTime)), slot.note || ""]);
    }));
    downloadCsv(`周排班-${selectedWeekKey}.csv`, rows);
  }

  function exportStatsCsv() {
    const stats = Logic.calculateStatistics(getWeek(false), state.people);
    const rows = [["人员", "主播时长", "副播时长", "总时长"], ...stats.rows.map((row) => [row.name, formatHours(row.hostHours), formatHours(row.coHostHours), formatHours(row.totalHours)])];
    downloadCsv(`时长统计-${selectedWeekKey}.csv`, rows);
  }

  function downloadCsv(name, rows) {
    const csv = rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
    downloadFile(name, `\uFEFF${csv}`, "text/csv;charset=utf-8");
    showToast("CSV 已导出");
  }

  function csvCell(value) { return `"${String(value ?? "").replace(/"/g, '""')}"`; }

  function downloadFile(name, content, type) {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const link = document.createElement("a"); link.href = url; link.download = name; document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url);
  }

  function textCell(value) { const cell = document.createElement("td"); cell.textContent = value; return cell; }
  function actionButton(label, handler, extraClass = "") { const button = document.createElement("button"); button.type = "button"; button.className = `button small ${extraClass}`.trim(); button.textContent = label; button.addEventListener("click", handler); return button; }
  function formatHours(value) { return Number.isInteger(value) ? String(value) : Number(value.toFixed(2)).toString(); }
  function formatFullDate(date) { return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`; }
  function todayStamp() { return Logic.toIsoDate(new Date()); }

  function showToast(message, error = false) {
    if (!elements.toast) return;
    clearTimeout(toastTimer);
    elements.toast.textContent = message;
    elements.toast.className = `toast show${error ? " error" : ""}`;
    toastTimer = setTimeout(() => { elements.toast.className = "toast"; }, 2800);
  }
})();
