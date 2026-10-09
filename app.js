(function () {
  "use strict";

  const Logic = window.ScheduleLogic;
  const STORAGE_KEY = "weekly-live-scheduler-v1";
  const PRE_V3_BACKUP_KEY = "weekly-live-scheduler-v2-pre-v3-backup";
  const VERSION = 3;
  const weekdays = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
  const dayKeys = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
  const shifts = [
    { key: "morning", label: "早班", startTime: "08:00", endTime: "13:00", isOvertime: false },
    { key: "overtimeMorning", label: "加班", startTime: "", endTime: "", isOvertime: true },
    { key: "afternoon", label: "中班", startTime: "13:00", endTime: "18:00", isOvertime: false },
    { key: "overtimeAfternoon", label: "加班", startTime: "", endTime: "", isOvertime: true },
    { key: "evening", label: "晚班", startTime: "18:30", endTime: "23:30", isOvertime: false },
    { key: "overtimeEvening", label: "加班", startTime: "", endTime: "", isOvertime: true }
  ];
  const defaultPeople = [
    ["程程", true, false], ["胖金", false, true], ["塔塔", true, false], ["阿怪", false, true],
    ["妍妍", true, false], ["江江", false, true], ["小珂", true, false], ["文慧", false, true]
  ].map(([name, canHost, canCoHost], index) => ({ id: `seed-${index + 1}`, name, canHost, canCoHost, employmentType: "formal", active: true }));

  const elements = {};
  let state = loadState();
  let selectedWeekKey = Logic.toIsoDate(Logic.startOfWeek(new Date()));
  let selectedRoomKey = state.settings?.lastRoomKey || "";
  let toastTimer;
  document.addEventListener("DOMContentLoaded", initialize);

  function initialize() {
    Object.assign(elements, {
      weekDateInput: byId("weekDateInput"), weekRangeLabel: byId("weekRangeLabel"), statsRangeLabel: byId("statsRangeLabel"), saveStatus: byId("saveStatus"),
      scheduleHead: byId("scheduleHead"), scheduleBody: byId("scheduleBody"), scheduleRoomSelect: byId("scheduleRoomSelect"), scheduleHint: byId("scheduleHint"),
      scheduleEmptyState: byId("scheduleEmptyState"), scheduleScroll: document.querySelector(".schedule-scroll"), previousWeekBtn: byId("previousWeekBtn"),
      nextWeekBtn: byId("nextWeekBtn"), todayWeekBtn: byId("todayWeekBtn"), historyRoomFilter: byId("historyRoomFilter"), historyTableBody: byId("historyTableBody"),
      roomForm: byId("roomForm"), roomIdInput: byId("roomIdInput"), roomNameInput: byId("roomNameInput"), roomAccountInput: byId("roomAccountInput"),
      saveRoomBtn: byId("saveRoomBtn"), cancelRoomEditBtn: byId("cancelRoomEditBtn"), roomFormError: byId("roomFormError"), roomsTableBody: byId("roomsTableBody"),
      personForm: byId("personForm"), personIdInput: byId("personIdInput"), personNameInput: byId("personNameInput"), canHostInput: byId("canHostInput"),
      canCoHostInput: byId("canCoHostInput"), employmentTypeInput: byId("employmentTypeInput"), savePersonBtn: byId("savePersonBtn"), cancelPersonEditBtn: byId("cancelPersonEditBtn"),
      personFormError: byId("personFormError"), peopleTableBody: byId("peopleTableBody"), statsTableBody: byId("statsTableBody"), sessionCount: byId("sessionCount"),
      totalPersonHours: byId("totalPersonHours"), conflictList: byId("conflictList"), exportJsonBtn: byId("exportJsonBtn"), importJsonBtn: byId("importJsonBtn"),
      importFileInput: byId("importFileInput"), exportScheduleCsvBtn: byId("exportScheduleCsvBtn"), exportStatsCsvBtn: byId("exportStatsCsvBtn"), toast: byId("toast")
    });
    if (!roomKeyExists(selectedRoomKey)) selectedRoomKey = "";
    elements.weekDateInput.value = selectedWeekKey;
    bindEvents();
    renderAll();
  }

  function byId(id) { return document.getElementById(id); }
  function createId(prefix = "item") { return window.crypto?.randomUUID ? window.crypto.randomUUID() : `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`; }
  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function nowIso() { return new Date().toISOString(); }
  function emptyState() { return { version: VERSION, people: clone(defaultPeople), rooms: [], schedules: {}, settings: {} }; }
  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return emptyState();
      const parsed = JSON.parse(raw);
      const migrated = Logic.migrateState(parsed);
      if (parsed.version !== VERSION) {
        if (!localStorage.getItem(PRE_V3_BACKUP_KEY)) localStorage.setItem(PRE_V3_BACKUP_KEY, raw);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
      }
      return migrated;
    } catch (error) {
      setTimeout(() => showToast("本地数据读取或升级失败，原备份未被覆盖。", true), 0);
      return emptyState();
    }
  }
  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      if (elements.saveStatus) elements.saveStatus.textContent = `已自动保存 ${new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}`;
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
    elements.scheduleRoomSelect.addEventListener("change", () => selectRoom(elements.scheduleRoomSelect.value));
    elements.historyRoomFilter.addEventListener("change", renderHistory);
    document.querySelectorAll(".tab").forEach((tab) => tab.addEventListener("click", () => activateTab(tab.dataset.tab)));
    elements.roomForm.addEventListener("submit", saveRoom);
    elements.cancelRoomEditBtn.addEventListener("click", resetRoomForm);
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
    document.querySelectorAll("[data-panel]").forEach((panel) => { const active = panel.dataset.panel === name; panel.hidden = !active; panel.classList.toggle("active", active); });
    if (name === "history") renderHistory();
    if (name === "stats") renderStats();
  }
  function changeWeek(days) { selectWeek(Logic.addDays(Logic.parseLocalDate(selectedWeekKey), days)); }
  function selectWeek(value) { const monday = Logic.startOfWeek(value); if (!monday) return; selectedWeekKey = Logic.toIsoDate(monday); elements.weekDateInput.value = selectedWeekKey; renderAll(); }
  function selectRoom(roomKey) { selectedRoomKey = roomKey; state.settings.lastRoomKey = roomKey; saveState(); renderAll(); }
  function roomKeyExists(key) { return Boolean(key && (key === "unassigned" ? state.schedules.unassigned : state.rooms.some((room) => room.id === key) || state.schedules[key])); }
  function roomInfo(roomKey, record) {
    const room = state.rooms.find((item) => item.id === roomKey);
    return { name: room?.name || record?.roomNameSnapshot || (roomKey === "unassigned" ? "未指定直播间" : "历史直播间"), account: room?.account || record?.roomAccountSnapshot || "" };
  }
  function getWeekRecord(create = true) {
    if (!selectedRoomKey) return null;
    if (!state.schedules[selectedRoomKey] && create) state.schedules[selectedRoomKey] = {};
    if (!state.schedules[selectedRoomKey]) return null;
    if (!state.schedules[selectedRoomKey][selectedWeekKey] && create) {
      const info = roomInfo(selectedRoomKey);
      state.schedules[selectedRoomKey][selectedWeekKey] = { roomId: selectedRoomKey === "unassigned" ? "" : selectedRoomKey, roomNameSnapshot: info.name, roomAccountSnapshot: info.account, days: {}, createdAt: nowIso(), updatedAt: nowIso() };
    }
    return state.schedules[selectedRoomKey][selectedWeekKey] || null;
  }
  function getWeek(create = true) { return getWeekRecord(create)?.days || {}; }
  function getDay(dayKey, create = true) {
    const record = getWeekRecord(create); if (!record) return null;
    if (!record.days[dayKey] && create) record.days[dayKey] = { leavePeople: [] };
    if (record.days[dayKey] && !Array.isArray(record.days[dayKey].leavePeople)) record.days[dayKey].leavePeople = [];
    return record.days[dayKey] || null;
  }
  function blankSlot(shift) { return { hostId: "", coHostId: "", hostNameSnapshot: "", coHostNameSnapshot: "", startTime: shift.startTime, endTime: shift.endTime, note: "" }; }
  function getSlot(dayKey, shift, create = true) {
    const day = getDay(dayKey, create); if (!day) return blankSlot(shift);
    if (!day[shift.key] && create) day[shift.key] = blankSlot(shift);
    return day[shift.key] || blankSlot(shift);
  }
  function touchWeek() { const record = getWeekRecord(false); if (record) record.updatedAt = nowIso(); }

  function renderAll() { renderWeekLabel(); renderRoomSelectors(); renderSchedule(); renderHistory(); renderRooms(); renderPeople(); renderStats(); }
  function renderWeekLabel() {
    const dates = Logic.getWeekDates(selectedWeekKey); const label = `${formatFullDate(dates[0])} — ${formatFullDate(dates[6])}`;
    elements.weekRangeLabel.textContent = label;
    const room = selectedRoomKey ? roomInfo(selectedRoomKey, getWeekRecord(false)) : null;
    elements.statsRangeLabel.textContent = `统计周期：${label}${room ? ` · ${room.name}` : " · 未选择直播间"}`;
  }
  function renderRoomSelectors() {
    const currentFilter = elements.historyRoomFilter.value;
    elements.scheduleRoomSelect.replaceChildren(new Option("请选择直播间", ""));
    const activeRooms = state.rooms.filter((room) => room.active || room.id === selectedRoomKey).sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
    activeRooms.forEach((room) => elements.scheduleRoomSelect.add(new Option(`${room.name}（${room.account}）${room.active ? "" : " · 停用"}`, room.id)));
    if (state.schedules.unassigned && (selectedRoomKey === "unassigned" || Object.values(state.schedules.unassigned).some(Logic.hasWeekContent))) elements.scheduleRoomSelect.add(new Option("未指定直播间（历史兼容）", "unassigned"));
    if (selectedRoomKey && ![...elements.scheduleRoomSelect.options].some((option) => option.value === selectedRoomKey)) {
      const info = roomInfo(selectedRoomKey, getWeekRecord(false)); elements.scheduleRoomSelect.add(new Option(`${info.name}${info.account ? `（${info.account}）` : ""} · 历史`, selectedRoomKey));
    }
    elements.scheduleRoomSelect.value = selectedRoomKey;
    elements.historyRoomFilter.replaceChildren(new Option("全部直播间", ""));
    const keys = new Set([...state.rooms.map((room) => room.id), ...Object.keys(state.schedules)]);
    [...keys].forEach((key) => { const weeks = state.schedules[key] || {}; const info = roomInfo(key, Object.values(weeks)[0]); elements.historyRoomFilter.add(new Option(`${info.name}${info.account ? `（${info.account}）` : ""}`, key)); });
    elements.historyRoomFilter.value = [...elements.historyRoomFilter.options].some((option) => option.value === currentFilter) ? currentFilter : "";
  }

  function renderSchedule() {
    const dates = Logic.getWeekDates(selectedWeekKey); const week = getWeek(Boolean(selectedRoomKey)); const conflicts = selectedRoomKey ? Logic.findConflicts(week, state.people) : [];
    const conflictKeys = new Set(conflicts.flatMap((item) => (item.shifts || []).map((key) => `${item.dayKey}:${key}`)));
    const leaveConflictDays = new Set(conflicts.filter((item) => item.type === "leave-scheduled").map((item) => item.dayKey));
    elements.scheduleHint.textContent = selectedRoomKey ? `当前周表统一属于：${roomInfo(selectedRoomKey, getWeekRecord(false)).name}。加班时长单独统计。` : "请选择直播间，再为该直播间安排主播、副播和直播时间。";
    elements.scheduleEmptyState.hidden = Boolean(selectedRoomKey);
    elements.scheduleScroll.classList.toggle("is-disabled", !selectedRoomKey);
    elements.scheduleHead.replaceChildren();
    const headerRow = document.createElement("tr"); const corner = document.createElement("th"); corner.textContent = "班次 / 日期"; headerRow.appendChild(corner);
    dates.forEach((date, index) => { const th = document.createElement("th"); if (Logic.toIsoDate(date) === Logic.toIsoDate(new Date())) th.classList.add("today-header"); const dayName = document.createElement("span"); dayName.className = "day-name"; dayName.textContent = weekdays[index]; const dateText = document.createElement("span"); dateText.className = "day-date"; dateText.textContent = `${date.getMonth() + 1}.${date.getDate()}`; th.append(dayName, dateText); headerRow.appendChild(th); });
    elements.scheduleHead.appendChild(headerRow); elements.scheduleBody.replaceChildren();
    shifts.forEach((shift) => {
      const row = document.createElement("tr"); const label = document.createElement("td"); label.className = `shift-label${shift.isOvertime ? " overtime" : ""}`; label.textContent = shift.label; row.appendChild(label);
      dayKeys.forEach((dayKey) => { const cell = document.createElement("td"); cell.className = `schedule-cell${shift.isOvertime ? " overtime-cell" : ""}`; const slot = selectedRoomKey ? getSlot(dayKey, shift) : blankSlot(shift); if (conflictKeys.has(`${dayKey}:${shift.key}`)) cell.classList.add("has-conflict"); if ((slot.hostId || slot.coHostId) && Logic.durationHours(slot.startTime, slot.endTime) === 0) cell.classList.add("has-error"); cell.appendChild(buildSlotEditor(dayKey, shift, slot)); row.appendChild(cell); });
      elements.scheduleBody.appendChild(row);
    });
    const leaveRow = document.createElement("tr"); const leaveLabel = document.createElement("td"); leaveLabel.className = "shift-label leave-label"; leaveLabel.textContent = "休假人员"; leaveRow.appendChild(leaveLabel);
    dayKeys.forEach((dayKey) => { const cell = document.createElement("td"); cell.className = "leave-cell"; if (leaveConflictDays.has(dayKey)) cell.classList.add("has-conflict"); cell.appendChild(buildLeavePicker(dayKey)); leaveRow.appendChild(cell); });
    elements.scheduleBody.appendChild(leaveRow);
  }
  function buildSlotEditor(dayKey, shift, slot) {
    const wrapper = document.createElement("div"); const hostRow = buildPersonSelect("主播", "hostId", slot.hostId, state.people.filter((p) => p.canHost), slot.hostNameSnapshot); const coHostRow = buildPersonSelect("副播", "coHostId", slot.coHostId, state.people.filter((p) => p.canCoHost), slot.coHostNameSnapshot);
    hostRow.select.disabled = !selectedRoomKey; coHostRow.select.disabled = !selectedRoomKey;
    hostRow.select.addEventListener("change", () => updateSlotPerson(dayKey, shift, "host", hostRow.select.value)); coHostRow.select.addEventListener("change", () => updateSlotPerson(dayKey, shift, "coHost", coHostRow.select.value));
    const timeRow = document.createElement("div"); timeRow.className = "time-row"; const start = document.createElement("input"); start.type = "time"; start.value = slot.startTime || ""; start.disabled = !selectedRoomKey; start.ariaLabel = `${shift.label}开始时间`; const separator = document.createElement("span"); separator.textContent = "—"; const end = document.createElement("input"); end.type = "time"; end.value = slot.endTime || ""; end.disabled = !selectedRoomKey; end.ariaLabel = `${shift.label}结束时间`;
    [start, end].forEach((input) => input.addEventListener("change", () => { const target = getSlot(dayKey, shift); target.startTime = start.value; target.endTime = end.value; persistAndRender(); })); timeRow.append(start, separator, end);
    const duration = document.createElement("div"); duration.className = "duration"; const durationLabel = document.createElement("span"); durationLabel.textContent = shift.isOvertime ? "加班时长" : "直播时长"; const durationValue = document.createElement("strong"); durationValue.textContent = `${formatHours(Logic.durationHours(slot.startTime, slot.endTime))}h`; duration.append(durationLabel, durationValue);
    const note = document.createElement("input"); note.className = "note-input"; note.type = "text"; note.maxLength = 80; note.placeholder = "备注（可选）"; note.value = slot.note || ""; note.disabled = !selectedRoomKey; note.addEventListener("change", () => { getSlot(dayKey, shift).note = note.value.trim(); touchWeek(); saveState(); renderHistory(); });
    wrapper.append(hostRow.element, coHostRow.element, timeRow, duration, note); return wrapper;
  }
  function buildPersonSelect(labelText, field, selectedId, candidates, snapshot) {
    const row = document.createElement("div"); row.className = "field-row"; const label = document.createElement("label"); label.textContent = labelText; const select = document.createElement("select"); select.dataset.field = field; select.add(new Option("未安排", ""));
    if (selectedId && !candidates.some((p) => p.id === selectedId)) select.add(new Option(`${snapshot || "历史人员"}（历史）`, selectedId));
    candidates.filter((p) => p.active || p.id === selectedId).sort((a, b) => a.name.localeCompare(b.name, "zh-CN")).forEach((p) => select.add(new Option(p.active ? p.name : `${p.name}（停用）`, p.id)));
    select.value = selectedId || ""; row.append(label, select); return { element: row, select };
  }
  function buildLeavePicker(dayKey) {
    const day = selectedRoomKey ? getDay(dayKey) : { leavePeople: [] }; const details = document.createElement("details"); details.className = "leave-picker"; const summary = document.createElement("summary");
    const selectedNames = day.leavePeople.map((item) => state.people.find((p) => p.id === item.personId)?.name || item.personNameSnapshot).filter(Boolean); summary.textContent = selectedNames.length ? selectedNames.join("、") : "选择休假人员";
    const options = document.createElement("div"); options.className = "leave-options"; const pool = state.people.filter((p) => p.active || day.leavePeople.some((item) => item.personId === p.id)); day.leavePeople.filter((item) => !pool.some((p) => p.id === item.personId)).forEach((item) => pool.push({ id: item.personId, name: item.personNameSnapshot || "历史人员", active: false }));
    pool.sort((a, b) => a.name.localeCompare(b.name, "zh-CN")).forEach((person) => { const label = document.createElement("label"); const checkbox = document.createElement("input"); checkbox.type = "checkbox"; checkbox.disabled = !selectedRoomKey; checkbox.checked = day.leavePeople.some((item) => item.personId === person.id); checkbox.addEventListener("change", () => { if (checkbox.checked) day.leavePeople.push({ personId: person.id, personNameSnapshot: person.name }); else day.leavePeople = day.leavePeople.filter((item) => item.personId !== person.id); persistAndRender(); }); label.append(checkbox, document.createTextNode(`${person.name}${person.active === false ? "（历史）" : ""}`)); options.appendChild(label); });
    details.append(summary, options); return details;
  }
  function updateSlotPerson(dayKey, shift, role, personId) { if (!selectedRoomKey) return; const slot = getSlot(dayKey, shift); const person = state.people.find((item) => item.id === personId); if (role === "host") { slot.hostId = personId; slot.hostNameSnapshot = person ? person.name : personId ? slot.hostNameSnapshot : ""; } else { slot.coHostId = personId; slot.coHostNameSnapshot = person ? person.name : personId ? slot.coHostNameSnapshot : ""; } persistAndRender(); }
  function persistAndRender() { touchWeek(); saveState(); renderSchedule(); renderHistory(); renderStats(); }

  function renderHistory() {
    if (!elements.historyTableBody) return;
    const filter = elements.historyRoomFilter.value; const records = Logic.historyRecords(state, new Date()).filter((item) => !filter || item.roomKey === filter); elements.historyTableBody.replaceChildren();
    if (!records.length) { const row = document.createElement("tr"); const cell = document.createElement("td"); cell.colSpan = 5; cell.textContent = "近 3 个月暂无排班历史"; row.appendChild(cell); elements.historyTableBody.appendChild(row); return; }
    records.forEach((item) => {
      const row = document.createElement("tr"); const info = roomInfo(item.roomKey, item.week); const dates = Logic.getWeekDates(item.weekKey); const stats = Logic.calculateStatistics(item.week.days || {}, state.people);
      row.append(textCell(`${info.name}${info.account ? `（${info.account}）` : ""}`), textCell(`${formatShortDate(dates[0])} — ${formatShortDate(dates[6])}`), textCell(String(stats.sessionCount)), textCell(formatDateTime(item.week.updatedAt)));
      const actions = document.createElement("td"); const actionRow = document.createElement("div"); actionRow.className = "row-actions"; actionRow.append(actionButton("查看", () => viewHistory(item)), actionButton("复制到新日期", () => showCopyControls(actions, item), "primary")); actions.appendChild(actionRow); row.appendChild(actions); elements.historyTableBody.appendChild(row);
    });
  }
  function viewHistory(item) { selectedRoomKey = item.roomKey; selectedWeekKey = item.weekKey; state.settings.lastRoomKey = selectedRoomKey; saveState(); elements.weekDateInput.value = selectedWeekKey; activateTab("schedule"); renderAll(); }
  function showCopyControls(cell, item) {
    cell.querySelector(".copy-controls")?.remove(); const controls = document.createElement("div"); controls.className = "copy-controls"; const date = document.createElement("input"); date.type = "date"; date.min = Logic.toIsoDate(new Date());
    const clearLabel = document.createElement("label"); clearLabel.className = "check-label"; const clear = document.createElement("input"); clear.type = "checkbox"; clearLabel.append(clear, document.createTextNode("清空排班内容"));
    const confirm = actionButton("确认复制", () => copyHistory(item, date.value, clear.checked), "primary"); const cancel = actionButton("取消", () => controls.remove(), "ghost"); controls.append(date, clearLabel, confirm, cancel); cell.appendChild(controls); date.focus();
  }
  function copyHistory(item, targetDate, clearContent) {
    const monday = Logic.startOfWeek(targetDate); if (!monday) return showToast("请选择目标日期。", true); const targetWeekKey = Logic.toIsoDate(monday); const existing = state.schedules[item.roomKey]?.[targetWeekKey];
    if (!Logic.targetWeekAvailable(existing)) return showToast("目标直播间在该周已有排班，不能覆盖。请改选空白周。", true);
    if (!state.schedules[item.roomKey]) state.schedules[item.roomKey] = {};
    state.schedules[item.roomKey][targetWeekKey] = Logic.copyWeekRecord(item.week, clearContent, nowIso());
    selectedRoomKey = item.roomKey; selectedWeekKey = targetWeekKey; state.settings.lastRoomKey = selectedRoomKey; saveState(); elements.weekDateInput.value = selectedWeekKey; activateTab("schedule"); renderAll(); showToast(clearContent ? "已创建空白周表" : "历史排班已复制，可继续编辑");
  }

  function renderRooms() {
    elements.roomsTableBody.replaceChildren(); if (!state.rooms.length) { const row = document.createElement("tr"); const cell = document.createElement("td"); cell.colSpan = 4; cell.textContent = "暂无直播间，请先新增。"; row.appendChild(cell); elements.roomsTableBody.appendChild(row); return; }
    state.rooms.slice().sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name, "zh-CN")).forEach((room) => { const row = document.createElement("tr"); row.append(textCell(room.name), textCell(room.account)); const status = document.createElement("td"); status.append(statusBadge(room.active)); row.appendChild(status); const actions = document.createElement("td"); actions.className = "row-actions"; actions.append(actionButton("编辑", () => editRoom(room.id)), actionButton(room.active ? "停用" : "启用", () => toggleRoom(room.id), room.active ? "danger" : ""), actionButton("删除", () => deleteRoom(room.id), "danger")); row.appendChild(actions); elements.roomsTableBody.appendChild(row); });
  }
  function saveRoom(event) {
    event.preventDefault(); const id = elements.roomIdInput.value; const name = elements.roomNameInput.value.trim(); const account = elements.roomAccountInput.value.trim(); elements.roomFormError.textContent = "";
    if (!name || !account) return showRoomError("请填写直播间名称和账号。"); if (state.rooms.some((room) => room.account.toLocaleLowerCase() === account.toLocaleLowerCase() && room.id !== id)) return showRoomError("该直播间账号已存在。");
    if (id) { const room = state.rooms.find((item) => item.id === id); if (!room) return showRoomError("未找到要编辑的直播间。"); Object.assign(room, { name, account }); showToast("直播间信息已更新"); }
    else { const room = { id: createId("room"), name, account, active: true }; state.rooms.push(room); selectedRoomKey = room.id; state.settings.lastRoomKey = room.id; showToast("直播间已新增并设为当前直播间"); }
    saveState(); resetRoomForm(); renderAll();
  }
  function showRoomError(message) { elements.roomFormError.textContent = message; }
  function editRoom(id) { const room = state.rooms.find((item) => item.id === id); if (!room) return; elements.roomIdInput.value = room.id; elements.roomNameInput.value = room.name; elements.roomAccountInput.value = room.account; elements.saveRoomBtn.textContent = "保存修改"; elements.cancelRoomEditBtn.hidden = false; elements.roomNameInput.focus(); }
  function resetRoomForm() { elements.roomForm.reset(); elements.roomIdInput.value = ""; elements.roomFormError.textContent = ""; elements.saveRoomBtn.textContent = "新增直播间"; elements.cancelRoomEditBtn.hidden = true; }
  function toggleRoom(id) { const room = state.rooms.find((item) => item.id === id); if (!room) return; room.active = !room.active; saveState(); renderAll(); showToast(`${room.name}已${room.active ? "启用" : "停用"}`); }
  function deleteRoom(id) { const room = state.rooms.find((item) => item.id === id); if (!room || !window.confirm(`确认删除直播间“${room.name}”？历史周表会保留名称和账号。`)) return; state.rooms = state.rooms.filter((item) => item.id !== id); saveState(); resetRoomForm(); renderAll(); showToast("直播间已删除，历史记录已保留"); }

  function renderPeople() {
    elements.peopleTableBody.replaceChildren(); state.people.slice().sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name, "zh-CN")).forEach((person) => { const row = document.createElement("tr"); row.append(textCell(person.name), textCell([person.canHost ? "主播" : "", person.canCoHost ? "副播" : ""].filter(Boolean).join("、") || "未设置"), textCell(person.employmentType === "partTime" ? "兼职" : "正式员工")); const status = document.createElement("td"); status.append(statusBadge(person.active)); row.appendChild(status); const actions = document.createElement("td"); actions.className = "row-actions"; actions.append(actionButton("编辑", () => editPerson(person.id)), actionButton(person.active ? "停用" : "启用", () => togglePerson(person.id), person.active ? "danger" : ""), actionButton("删除", () => deletePerson(person.id), "danger")); row.appendChild(actions); elements.peopleTableBody.appendChild(row); });
  }
  function savePerson(event) {
    event.preventDefault(); const id = elements.personIdInput.value; const name = elements.personNameInput.value.trim(); const canHost = elements.canHostInput.checked; const canCoHost = elements.canCoHostInput.checked; const employmentType = elements.employmentTypeInput.value; elements.personFormError.textContent = "";
    if (!name) return showPersonError("请输入姓名。"); if (!canHost && !canCoHost) return showPersonError("请至少选择一个角色。"); if (state.people.some((person) => person.name.toLocaleLowerCase() === name.toLocaleLowerCase() && person.id !== id)) return showPersonError("该姓名已存在。");
    if (id) { const person = state.people.find((item) => item.id === id); if (!person) return showPersonError("未找到要编辑的人员。"); Object.assign(person, { name, canHost, canCoHost, employmentType }); showToast("人员信息已更新"); }
    else { state.people.push({ id: createId("person"), name, canHost, canCoHost, employmentType, active: true }); showToast("人员已新增"); }
    saveState(); resetPersonForm(); renderAll();
  }
  function showPersonError(message) { elements.personFormError.textContent = message; }
  function editPerson(id) { const person = state.people.find((item) => item.id === id); if (!person) return; elements.personIdInput.value = person.id; elements.personNameInput.value = person.name; elements.canHostInput.checked = person.canHost; elements.canCoHostInput.checked = person.canCoHost; elements.employmentTypeInput.value = person.employmentType || "formal"; elements.savePersonBtn.textContent = "保存修改"; elements.cancelPersonEditBtn.hidden = false; elements.personNameInput.focus(); }
  function resetPersonForm() { elements.personForm.reset(); elements.personIdInput.value = ""; elements.personFormError.textContent = ""; elements.employmentTypeInput.value = "formal"; elements.savePersonBtn.textContent = "新增人员"; elements.cancelPersonEditBtn.hidden = true; }
  function togglePerson(id) { const person = state.people.find((item) => item.id === id); if (!person) return; person.active = !person.active; saveState(); renderAll(); showToast(`${person.name}已${person.active ? "启用" : "停用"}`); }
  function deletePerson(id) { const person = state.people.find((item) => item.id === id); if (!person || !window.confirm(`确认删除人员“${person.name}”？历史排班记录会保留姓名。`)) return; state.people = state.people.filter((item) => item.id !== id); saveState(); resetPersonForm(); renderAll(); showToast("人员已删除，历史记录已保留"); }

  function renderStats() {
    const week = selectedRoomKey ? getWeek(false) : {}; const stats = Logic.calculateStatistics(week, state.people); const conflicts = Logic.findConflicts(week, state.people); elements.sessionCount.textContent = String(stats.sessionCount); elements.totalPersonHours.textContent = `${formatHours(stats.totalPersonHours)}h`; elements.statsTableBody.replaceChildren();
    if (!stats.rows.length) { const row = document.createElement("tr"); const cell = document.createElement("td"); cell.colSpan = 4; cell.textContent = selectedRoomKey ? "当前直播间本周暂无有效排班" : "请先在周排班中选择直播间"; row.appendChild(cell); elements.statsTableBody.appendChild(row); }
    else stats.rows.forEach((item) => { const row = document.createElement("tr"); row.append(textCell(item.name), textCell(`${formatHours(item.liveHours)}h`), textCell(`${formatHours(item.overtimeHours)}h`), textCell(`${formatHours(item.totalHours)}h`)); elements.statsTableBody.appendChild(row); });
    elements.conflictList.replaceChildren(); if (!conflicts.length) { const ok = document.createElement("p"); ok.className = "check-ok"; ok.textContent = "未发现人员冲突或时间错误。"; elements.conflictList.appendChild(ok); } else conflicts.forEach((conflict) => { const item = document.createElement("p"); item.className = "conflict-item"; item.textContent = conflictText(conflict); elements.conflictList.appendChild(item); });
  }
  function conflictText(conflict) { const dayIndex = dayKeys.indexOf(conflict.dayKey); const names = (conflict.shifts || []).map((key) => shifts.find((shift) => shift.key === key)?.label || key).join("、"); if (conflict.type === "overlap") return `${weekdays[dayIndex]}：${conflict.personName}在${names}时间重叠。`; if (conflict.type === "same-role-person") return `${weekdays[dayIndex]}${names}：主播和副播不能是同一人（统计仅计一次）。`; if (conflict.type === "leave-scheduled") return `${weekdays[dayIndex]}：${conflict.personName}已休假，但仍安排在${names}。`; return `${weekdays[dayIndex]}${names}：已安排人员，但直播时间无效。`; }

  function exportJson() { downloadFile(`直播排班备份-${todayStamp()}.json`, JSON.stringify(state, null, 2), "application/json;charset=utf-8"); showToast("JSON 备份已导出"); }
  async function importJson(event) { const file = event.target.files?.[0]; event.target.value = ""; if (!file) return; try { const migrated = Logic.migrateState(JSON.parse(await file.text())); if (!window.confirm("导入会覆盖当前直播间、人员和全部排班数据。是否继续？")) return; state = migrated; selectedRoomKey = state.settings.lastRoomKey || ""; if (!roomKeyExists(selectedRoomKey)) selectedRoomKey = ""; saveState(); resetRoomForm(); resetPersonForm(); renderAll(); showToast("备份已导入并升级为 V3"); } catch (error) { showToast(`导入失败：${error.message}`, true); } }
  function exportScheduleCsv() {
    if (!selectedRoomKey) return showToast("请先选择直播间。", true); const record = getWeekRecord(false); const info = roomInfo(selectedRoomKey, record); const rows = [["日期", "星期", "班次", "排班类型", "直播间名称", "账号", "主播", "主播用工类型", "副播", "副播用工类型", "开始时间", "结束时间", "时长", "备注", "休假人员"]]; const dates = Logic.getWeekDates(selectedWeekKey); const week = record?.days || {};
    dayKeys.forEach((dayKey, dayIndex) => shifts.forEach((shift) => { const slot = week[dayKey]?.[shift.key]; if (!slot || (!slot.hostId && !slot.coHostId && !slot.note)) return; const host = state.people.find((p) => p.id === slot.hostId); const coHost = state.people.find((p) => p.id === slot.coHostId); rows.push([Logic.toIsoDate(dates[dayIndex]), weekdays[dayIndex], shift.label, shift.isOvertime ? "加班" : "普通班", info.name, info.account, host?.name || slot.hostNameSnapshot || "", employmentLabel(host), coHost?.name || slot.coHostNameSnapshot || "", employmentLabel(coHost), slot.startTime || "", slot.endTime || "", formatHours(Logic.durationHours(slot.startTime, slot.endTime)), slot.note || "", (week[dayKey]?.leavePeople || []).map((item) => state.people.find((p) => p.id === item.personId)?.name || item.personNameSnapshot).join("、")]); })); downloadCsv(`周排班-${info.name}-${selectedWeekKey}.csv`, rows);
  }
  function exportStatsCsv() { if (!selectedRoomKey) return showToast("请先选择直播间。", true); const stats = Logic.calculateStatistics(getWeek(false), state.people); downloadCsv(`时长统计-${roomInfo(selectedRoomKey, getWeekRecord(false)).name}-${selectedWeekKey}.csv`, [["人员", "直播时长", "加班时长", "总时长"], ...stats.rows.map((row) => [row.name, formatHours(row.liveHours), formatHours(row.overtimeHours), formatHours(row.totalHours)])]); }
  function employmentLabel(person) { return person ? (person.employmentType === "partTime" ? "兼职" : "正式员工") : ""; }
  function downloadCsv(name, rows) { downloadFile(name, `\uFEFF${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}`, "text/csv;charset=utf-8"); showToast("CSV 已导出"); }
  function csvCell(value) { return `"${String(value ?? "").replace(/"/g, '""')}"`; }
  function downloadFile(name, content, type) { const url = URL.createObjectURL(new Blob([content], { type })); const link = document.createElement("a"); link.href = url; link.download = name; document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url); }
  function statusBadge(active) { const badge = document.createElement("span"); badge.className = `status-badge${active ? "" : " inactive"}`; badge.textContent = active ? "启用" : "停用"; return badge; }
  function textCell(value) { const cell = document.createElement("td"); cell.textContent = value; return cell; }
  function actionButton(label, handler, extraClass = "") { const button = document.createElement("button"); button.type = "button"; button.className = `button small ${extraClass}`.trim(); button.textContent = label; button.addEventListener("click", handler); return button; }
  function formatHours(value) { return Number.isInteger(value) ? String(value) : Number(value.toFixed(2)).toString(); }
  function formatFullDate(date) { return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`; }
  function formatShortDate(date) { return `${date.getFullYear()}.${date.getMonth() + 1}.${date.getDate()}`; }
  function formatDateTime(value) { const date = new Date(value); return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }); }
  function todayStamp() { return Logic.toIsoDate(new Date()); }
  function showToast(message, error = false) { if (!elements.toast) return; clearTimeout(toastTimer); elements.toast.textContent = message; elements.toast.className = `toast show${error ? " error" : ""}`; toastTimer = setTimeout(() => { elements.toast.className = "toast"; }, 2800); }
})();
