(function () {
  "use strict";
  const Logic = window.ScheduleLogic;
  const Spreadsheet = window.ScheduleExcel;
  const STORAGE_KEY = "weekly-live-scheduler-v1";
  const PRE_V4_BACKUP_KEY = "weekly-live-scheduler-v3-pre-v4-backup";
  const VERSION = 5;
  const weekdays = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
  const DEFAULT_SHIFT_DEFINITIONS = [
    { key: "morning", label: "主号早班", roomId: "", startTime: "08:00", endTime: "12:30", active: true, allowOvertime: true, overtimePriority: 1, order: 1 },
    { key: "afternoon", label: "主号中班", roomId: "", startTime: "13:00", endTime: "17:30", active: true, allowOvertime: true, overtimePriority: 2, order: 2 },
    { key: "evening", label: "主号晚班", roomId: "", startTime: "19:00", endTime: "23:30", active: true, allowOvertime: false, overtimePriority: 3, order: 3 },
    { key: "secondary", label: "副直播间班次", roomId: "", startTime: "13:30", endTime: "18:00", active: true, allowOvertime: false, overtimePriority: 4, order: 4 }
  ];
  const legacyOvertimeShifts = [
    { key: "overtimeMorning", label: "历史加班（早）", isOvertime: true },
    { key: "overtimeAfternoon", label: "历史加班（中）", isOvertime: true },
    { key: "overtimeEvening", label: "历史加班（晚）", isOvertime: true }
  ];
  const defaultPeople = [
    ["程程", true, false], ["胖金", false, true], ["塔塔", true, false], ["阿怪", false, true],
    ["妍妍", true, false], ["江江", false, true], ["小珂", true, false], ["文慧", false, true]
  ].map(([name, canHost, canCoHost], index) => ({ id: `seed-${index + 1}`, name, canHost, canCoHost, employmentType: "formal", active: true }));

  const elements = {};
  let state = loadState();
  let shifts = activeShiftDefinitions();
  const today = new Date();
  let selectedStart = validDateKey(state.settings?.rangeStart) ? state.settings.rangeStart : Logic.toIsoDate(today);
  let selectedEnd = validDateKey(state.settings?.rangeEnd) ? state.settings.rangeEnd : Logic.toIsoDate(Logic.addDays(today, 6));
  let selectedRoomKey = state.settings?.lastRoomKey || "";
  let calendarMonth = firstOfMonth(Logic.parseLocalDate(selectedStart) || today);
  let pendingRangeStart = "";
  let hoverRangeEnd = "";
  let openLeaveDateKey = "";
  let performanceRangeMode = ["current", "30d", "3m", "all"].includes(state.settings?.performanceRangeMode) ? state.settings.performanceRangeMode : "current";
  let pendingExcelImport = null;
  let toastTimer;
  document.addEventListener("DOMContentLoaded", initialize);

  function initialize() {
    Object.assign(elements, {
      rangePickerBtn: byId("rangePickerBtn"), rangePickerText: byId("rangePickerText"), rangePickerPanel: byId("rangePickerPanel"), calendarMonths: byId("calendarMonths"), calendarPrompt: byId("calendarPrompt"), calendarSelectionSummary: byId("calendarSelectionSummary"), previousMonthBtn: byId("previousMonthBtn"), nextMonthBtn: byId("nextMonthBtn"), closeRangePickerBtn: byId("closeRangePickerBtn"), weekRangeLabel: byId("weekRangeLabel"), statsRangeLabel: byId("statsRangeLabel"), saveStatus: byId("saveStatus"),
      scheduleHead: byId("scheduleHead"), scheduleBody: byId("scheduleBody"), scheduleRoomSelect: byId("scheduleRoomSelect"), saveScheduleBtn: byId("saveScheduleBtn"), clearScheduleBtn: byId("clearScheduleBtn"), scheduleHint: byId("scheduleHint"), scheduleEmptyState: byId("scheduleEmptyState"), scheduleScroll: document.querySelector(".schedule-scroll"), autoScheduler: byId("autoScheduler"), groupTemplateGrid: byId("groupTemplateGrid"), generateScheduleBtn: byId("generateScheduleBtn"), refreshGuidanceBtn: byId("refreshGuidanceBtn"), openScheduleSettingsBtn: byId("openScheduleSettingsBtn"), autoScheduleStatus: byId("autoScheduleStatus"),
      previousWeekBtn: byId("previousWeekBtn"), nextWeekBtn: byId("nextWeekBtn"), todayWeekBtn: byId("todayWeekBtn"), historyStartInput: byId("historyStartInput"), historyEndInput: byId("historyEndInput"), historyRoomFilter: byId("historyRoomFilter"), openHistoryRangeBtn: byId("openHistoryRangeBtn"), refreshOverviewBtn: byId("refreshOverviewBtn"), overviewTableBody: byId("overviewTableBody"),
      performanceEntryRangeLabel: byId("performanceEntryRangeLabel"), performanceRangeLabel: byId("performanceRangeLabel"), performanceTableHead: byId("performanceTableHead"), performanceTableBody: byId("performanceTableBody"), hostRankingBody: byId("hostRankingBody"), coHostRankingBody: byId("coHostRankingBody"),
      scheduleTargetsForm: byId("scheduleTargetsForm"), minimumShiftCountInput: byId("minimumShiftCountInput"), minimumTotalHoursInput: byId("minimumTotalHoursInput"), defaultOvertimeHoursInput: byId("defaultOvertimeHoursInput"), scheduleTargetsError: byId("scheduleTargetsError"), shiftDefinitionForm: byId("shiftDefinitionForm"), shiftDefinitionIdInput: byId("shiftDefinitionIdInput"), shiftDefinitionNameInput: byId("shiftDefinitionNameInput"), shiftDefinitionRoomInput: byId("shiftDefinitionRoomInput"), shiftDefinitionStartInput: byId("shiftDefinitionStartInput"), shiftDefinitionEndInput: byId("shiftDefinitionEndInput"), shiftDefinitionOvertimeInput: byId("shiftDefinitionOvertimeInput"), shiftDefinitionPriorityInput: byId("shiftDefinitionPriorityInput"), saveShiftDefinitionBtn: byId("saveShiftDefinitionBtn"), cancelShiftDefinitionBtn: byId("cancelShiftDefinitionBtn"), shiftDefinitionError: byId("shiftDefinitionError"), shiftDefinitionsTableBody: byId("shiftDefinitionsTableBody"), formalGroupForm: byId("formalGroupForm"), formalGroupIdInput: byId("formalGroupIdInput"), formalGroupNameInput: byId("formalGroupNameInput"), formalGroupHostInput: byId("formalGroupHostInput"), formalGroupCoHostInput: byId("formalGroupCoHostInput"), formalGroupShiftInput: byId("formalGroupShiftInput"), saveFormalGroupBtn: byId("saveFormalGroupBtn"), cancelFormalGroupBtn: byId("cancelFormalGroupBtn"), formalGroupError: byId("formalGroupError"), formalGroupsTableBody: byId("formalGroupsTableBody"), partTimeGroupForm: byId("partTimeGroupForm"), partTimeGroupHostInput: byId("partTimeGroupHostInput"), partTimeGroupCoHostInput: byId("partTimeGroupCoHostInput"), partTimeGroupError: byId("partTimeGroupError"),
      roomForm: byId("roomForm"), roomIdInput: byId("roomIdInput"), roomNameInput: byId("roomNameInput"), roomAccountInput: byId("roomAccountInput"), saveRoomBtn: byId("saveRoomBtn"), cancelRoomEditBtn: byId("cancelRoomEditBtn"), roomFormError: byId("roomFormError"), roomsTableBody: byId("roomsTableBody"),
      personForm: byId("personForm"), personIdInput: byId("personIdInput"), personNameInput: byId("personNameInput"), canHostInput: byId("canHostInput"), canCoHostInput: byId("canCoHostInput"), employmentTypeInput: byId("employmentTypeInput"), savePersonBtn: byId("savePersonBtn"), cancelPersonEditBtn: byId("cancelPersonEditBtn"), personFormError: byId("personFormError"), peopleTableBody: byId("peopleTableBody"),
      statsTableBody: byId("statsTableBody"), sessionCount: byId("sessionCount"), totalPersonHours: byId("totalPersonHours"), conflictList: byId("conflictList"), importFileInput: byId("importFileInput"), scheduleExcelInput: byId("scheduleExcelInput"), performanceExcelInput: byId("performanceExcelInput"), excelImportDialog: byId("excelImportDialog"), excelImportTitle: byId("excelImportTitle"), excelImportFileName: byId("excelImportFileName"), excelImportCounts: byId("excelImportCounts"), excelImportMode: byId("excelImportMode"), excelImportErrors: byId("excelImportErrors"), excelImportWarnings: byId("excelImportWarnings"), confirmExcelImportBtn: byId("confirmExcelImportBtn"), toast: byId("toast")
    });
    if (!roomKeyExists(selectedRoomKey)) selectedRoomKey = state.rooms.find((room) => room.active)?.id || Object.keys(state.schedules)[0] || "";
    if (selectedRoomKey) state.settings.lastRoomKey = selectedRoomKey;
    renderRangePickerButton();
    elements.historyStartInput.value = selectedStart; elements.historyEndInput.value = selectedEnd;
    bindEvents(); renderAll(); renderOverview();
  }
  function byId(id) { return document.getElementById(id); }
  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function createId(prefix = "item") { return window.crypto?.randomUUID ? window.crypto.randomUUID() : `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`; }
  function nowIso() { return new Date().toISOString(); }
  function validDateKey(value) { return Boolean(Logic.parseLocalDate(value)); }
  function defaultSettings() { return { shiftDefinitions: clone(DEFAULT_SHIFT_DEFINITIONS), formalGroups: DEFAULT_SHIFT_DEFINITIONS.map((shift, index) => ({ id: `group-${index + 1}`, name: `班组 ${index + 1}`, hostId: defaultPeople[index * 2]?.id || "", coHostId: defaultPeople[index * 2 + 1]?.id || "", defaultShiftId: shift.key, active: true, order: index + 1 })), partTimeGroup: { id: "part-time-group", name: "固定兼职班组", hostId: "", coHostId: "" }, scheduleTargets: { minimumShiftCount: 4, minimumTotalHours: 18, defaultOvertimeHours: 1.5 } }; }
  function emptyState() { return { version: VERSION, people: clone(defaultPeople), rooms: [], schedules: {}, settings: defaultSettings() }; }
  function allShiftDefinitions() { return (state.settings.shiftDefinitions || []).slice().sort((a, b) => (a.order || 0) - (b.order || 0)); }
  function configurableShiftDefinitions() { return allShiftDefinitions().filter((shift) => !shift.deleted); }
  function activeShiftDefinitions() { return allShiftDefinitions().filter((shift) => shift.active !== false); }
  function syncActiveShifts() { shifts = activeShiftDefinitions(); }
  function scheduleTargets() { return state.settings.scheduleTargets || { minimumShiftCount: Math.min(4, shifts.length), minimumTotalHours: 18, defaultOvertimeHours: 1.5 }; }
  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY); if (!raw) return emptyState(); const parsed = JSON.parse(raw); const migrated = Logic.migrateState(parsed);
      if (parsed.version !== VERSION) { if (!localStorage.getItem(PRE_V4_BACKUP_KEY)) localStorage.setItem(PRE_V4_BACKUP_KEY, raw); localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated)); }
      return migrated;
    } catch (error) { setTimeout(() => showToast("本地数据读取或升级失败，原备份未被覆盖。", true), 0); return emptyState(); }
  }
  function saveState() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); if (elements.saveStatus) elements.saveStatus.textContent = `已自动保存 ${new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}`; return true; }
    catch (error) { elements.saveStatus.textContent = "自动保存失败"; showToast("浏览器无法保存数据，请导出 JSON 备份。", true); return false; }
  }
  function bindEvents() {
    elements.previousWeekBtn.addEventListener("click", () => shiftRange(-1)); elements.nextWeekBtn.addEventListener("click", () => shiftRange(1)); elements.todayWeekBtn.addEventListener("click", resetRangeToday);
    elements.rangePickerBtn.addEventListener("click", toggleRangePicker); elements.previousMonthBtn.addEventListener("click", () => changeCalendarMonth(-1)); elements.nextMonthBtn.addEventListener("click", () => changeCalendarMonth(1)); elements.closeRangePickerBtn.addEventListener("click", closeRangePicker); elements.scheduleRoomSelect.addEventListener("change", () => selectRoom(elements.scheduleRoomSelect.value)); elements.saveScheduleBtn.addEventListener("click", saveScheduleNow); elements.clearScheduleBtn.addEventListener("click", clearCurrentSchedule); elements.generateScheduleBtn.addEventListener("click", generateRangeSchedule); elements.refreshGuidanceBtn.addEventListener("click", refreshScheduleGuidance);
    elements.openScheduleSettingsBtn.addEventListener("click", () => activateTab("settings")); elements.scheduleTargetsForm.addEventListener("submit", saveScheduleTargets); elements.shiftDefinitionForm.addEventListener("submit", saveShiftDefinition); elements.cancelShiftDefinitionBtn.addEventListener("click", resetShiftDefinitionForm); elements.formalGroupForm.addEventListener("submit", saveFormalGroup); elements.cancelFormalGroupBtn.addEventListener("click", resetFormalGroupForm); elements.partTimeGroupForm.addEventListener("submit", savePartTimeGroup);
    elements.openHistoryRangeBtn.addEventListener("click", openHistoryRange); elements.refreshOverviewBtn.addEventListener("click", () => { renderOverview(); showToast("排班总览已更新"); }); elements.historyRoomFilter.addEventListener("change", renderOverview);
    document.querySelectorAll("[data-performance-range]").forEach((button) => button.addEventListener("click", () => { performanceRangeMode = button.dataset.performanceRange; state.settings.performanceRangeMode = performanceRangeMode; saveState(); renderPerformanceSummary(); }));
    document.querySelectorAll(".tab").forEach((tab) => tab.addEventListener("click", () => activateTab(tab.dataset.tab)));
    elements.roomForm.addEventListener("submit", saveRoom); elements.cancelRoomEditBtn.addEventListener("click", resetRoomForm); elements.personForm.addEventListener("submit", savePerson); elements.cancelPersonEditBtn.addEventListener("click", resetPersonForm);
    elements.importFileInput.addEventListener("change", importJson);
    elements.scheduleExcelInput.addEventListener("change", (event) => importExcelFile(event, "schedule"));
    elements.performanceExcelInput.addEventListener("change", (event) => importExcelFile(event, "performance"));
    elements.excelImportMode.addEventListener("change", renderExcelImportPreview);
    elements.confirmExcelImportBtn.addEventListener("click", confirmExcelImport);
    elements.excelImportDialog.addEventListener("close", () => { pendingExcelImport = null; });
    window.desktopMenu?.onCommand(handleDesktopMenuCommand);
    document.addEventListener("click", (event) => { if (!(event.target instanceof Element)) return; if (!elements.rangePickerPanel.hidden && !event.target.closest(".range-picker-wrap")) closeRangePicker(); if (!event.target.closest(".leave-picker")) { openLeaveDateKey = ""; document.querySelectorAll(".leave-picker[open]").forEach((picker) => { picker.open = false; }); } });
    document.addEventListener("keydown", (event) => { if (event.key === "Escape" && !elements.rangePickerPanel.hidden) closeRangePicker(); });
  }
  function handleDesktopMenuCommand(command) {
    const actions = {
      "import-backup": () => elements.importFileInput.click(),
      "export-backup": exportJson,
      "import-schedule-template": () => elements.scheduleExcelInput.click(),
      "export-editable-schedule-template": () => exportScheduleTemplate(true),
      "download-blank-schedule-template": () => exportScheduleTemplate(false),
      "export-display-schedule-xlsx": exportScheduleXlsx,
      "import-performance-template": () => elements.performanceExcelInput.click(),
      "export-performance-template": () => exportPerformanceTemplate(false),
      "download-blank-performance-template": () => exportPerformanceTemplate(true),
      "export-schedule-csv": exportScheduleCsv,
      "export-stats-csv": exportStatsCsv,
      "check-update": () => checkDesktopUpdate(true)
    };
    actions[command]?.();
  }
  function activateTab(name) { document.querySelectorAll(".tab").forEach((tab) => tab.classList.toggle("active", tab.dataset.tab === name)); document.querySelectorAll("[data-panel]").forEach((panel) => { const active = panel.dataset.panel === name; panel.hidden = !active; panel.classList.toggle("active", active); }); if (name === "history") renderOverview(); if (name === "performance") renderPerformance(); if (name === "settings") renderScheduleSettings(); if (name === "stats") renderStats(); }
  async function checkDesktopUpdate() {
    const bridge = window.desktopUpdates;
    if (!bridge) return showToast("仅桌面版支持检查更新", true);
    showToast("正在检查 GitHub 最新版本…");
    try {
      const result = await bridge.check();
      if (result.status === "up-to-date") return showToast(`当前已是最新版 v${result.currentVersion}`);
      if (result.status === "no-release") return showToast("GitHub 尚未发布可用版本", true);
      if (result.status === "error") return showToast(result.message || "暂时无法检查更新", true);
      const targetUrl = result.status === "update-available" ? result.downloadUrl : result.releaseUrl;
      const message = result.status === "update-available"
        ? `发现新版本 v${result.latestVersion}，是否前往下载？`
        : `发现新版本 v${result.latestVersion}，当前系统的文件尚未上传。是否查看发布页？`;
      if (!targetUrl || !window.confirm(message)) return;
      const opened = await bridge.openExternal(targetUrl);
      if (!opened?.ok) showToast(opened?.message || "无法打开下载页面", true);
    } catch (_error) {
      showToast("检查更新失败，请稍后重试", true);
    }
  }
  function currentDates() { try { return Logic.dateRange(selectedStart, selectedEnd, 14); } catch (error) { return []; } }
  function renderRangePickerButton() { if (elements.rangePickerText) elements.rangePickerText.textContent = `${formatShortDate(selectedStart)} — ${formatShortDate(selectedEnd)}`; }
  function setRange(start, end, notify = true) {
    try { Logic.dateRange(start, end, 14); selectedStart = start; selectedEnd = end; state.settings.rangeStart = start; state.settings.rangeEnd = end; saveState(); renderRangePickerButton(); renderAll(); }
    catch (error) { renderRangePickerButton(); if (notify) showToast(error.message, true); }
  }
  function shiftRange(direction) { const dates = currentDates(); if (!dates.length) return; const count = dates.length; const start = Logic.addDays(dates[0], direction * count); setRange(Logic.toIsoDate(start), Logic.toIsoDate(Logic.addDays(start, count - 1))); }
  function resetRangeToday() { const start = new Date(); setRange(Logic.toIsoDate(start), Logic.toIsoDate(Logic.addDays(start, 6))); }
  function firstOfMonth(date) { return new Date(date.getFullYear(), date.getMonth(), 1); }
  function changeCalendarMonth(offset) { calendarMonth = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + offset, 1); renderCalendars(); }
  function toggleRangePicker() { elements.rangePickerPanel.hidden ? openRangePicker() : closeRangePicker(); }
  function openRangePicker() {
    pendingRangeStart = ""; hoverRangeEnd = ""; calendarMonth = firstOfMonth(Logic.parseLocalDate(selectedStart) || today);
    elements.calendarPrompt.textContent = "请先选择开始日期"; elements.rangePickerPanel.hidden = false; elements.rangePickerBtn.setAttribute("aria-expanded", "true"); renderCalendars();
  }
  function closeRangePicker() { pendingRangeStart = ""; hoverRangeEnd = ""; elements.rangePickerPanel.hidden = true; elements.rangePickerBtn.setAttribute("aria-expanded", "false"); }
  function selectCalendarDate(dateKey) {
    try {
      const selection = Logic.chooseRangeDate(pendingRangeStart, dateKey, 14);
      if (!selection.complete) { pendingRangeStart = selection.start; hoverRangeEnd = ""; elements.calendarPrompt.textContent = "请选择结束日期"; renderCalendars(); return; }
      setRange(selection.start, selection.end); closeRangePicker(); showToast(`已选择 ${formatShortDate(selection.start)} — ${formatShortDate(selection.end)}`);
    } catch (error) { elements.calendarPrompt.textContent = "区间最长 14 天，请重新选择结束日期"; showToast(error.message, true); }
  }
  function previewCalendarDate(dateKey) {
    if (!pendingRangeStart) return;
    if (dateKey < pendingRangeStart) { if (hoverRangeEnd) { hoverRangeEnd = ""; renderCalendars(); } return; }
    try { Logic.dateRange(pendingRangeStart, dateKey, 14); if (hoverRangeEnd === dateKey) return; hoverRangeEnd = dateKey; renderCalendars(); } catch (error) { if (!hoverRangeEnd) return; hoverRangeEnd = ""; renderCalendars(); }
  }
  function renderCalendars() {
    elements.calendarMonths.replaceChildren();
    const activeStart = pendingRangeStart || selectedStart; const activeEnd = pendingRangeStart ? hoverRangeEnd : selectedEnd;
    [0, 1].forEach((offset) => {
      const month = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + offset, 1); const section = document.createElement("section"); section.className = "calendar-month";
      const title = document.createElement("div"); title.className = "calendar-month-title"; title.textContent = `${month.getFullYear()}年${month.getMonth() + 1}月`;
      const weekRow = document.createElement("div"); weekRow.className = "calendar-weekdays"; ["日", "一", "二", "三", "四", "五", "六"].forEach((name) => { const item = document.createElement("span"); item.textContent = name; weekRow.appendChild(item); });
      const grid = document.createElement("div"); grid.className = "calendar-grid"; const gridStart = Logic.addDays(month, -month.getDay());
      for (let index = 0; index < 42; index += 1) {
        const date = Logic.addDays(gridStart, index); const key = Logic.toIsoDate(date); const button = document.createElement("button"); button.type = "button"; button.className = "calendar-day"; button.textContent = String(date.getDate()); button.ariaLabel = `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
        if (date.getMonth() !== month.getMonth()) button.classList.add("outside"); if (key === Logic.toIsoDate(today)) button.classList.add("today");
        if (activeStart && key === activeStart) button.classList.add("range-start"); if (activeEnd && key === activeEnd) button.classList.add("range-end"); if (activeStart && activeEnd && key > activeStart && key < activeEnd) button.classList.add("in-range");
        if (pendingRangeStart) { const max = Logic.toIsoDate(Logic.addDays(Logic.parseLocalDate(pendingRangeStart), 13)); if (key > max) button.classList.add("unavailable"); }
        button.addEventListener("click", (event) => { event.stopPropagation(); selectCalendarDate(key); }); button.addEventListener("mouseenter", () => previewCalendarDate(key)); grid.appendChild(button);
      }
      section.append(title, weekRow, grid); elements.calendarMonths.appendChild(section);
    });
    elements.calendarSelectionSummary.textContent = pendingRangeStart ? `${formatShortDate(pendingRangeStart)} 起` : `${formatShortDate(selectedStart)} — ${formatShortDate(selectedEnd)}`;
  }
  function saveScheduleNow() {
    if (!selectedRoomKey) return showToast("请先选择直播间。", true);
    const schedule = getRoomSchedule(false); const timestamp = nowIso(); currentDates().forEach((date) => { const day = schedule?.days?.[Logic.toIsoDate(date)]; if (day && Logic.hasDayContent(day)) day.updatedAt = timestamp; });
    if (!saveState()) return; renderOverview(); const time = new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }); elements.saveStatus.textContent = `排班已保存，历史记录已同步 ${time}`; showToast("排班已保存，历史记录已同步");
  }
  function selectRoom(key) { selectedRoomKey = key; state.settings.lastRoomKey = key; saveState(); renderAll(); }
  function roomKeyExists(key) { return Boolean(key && (key === "unassigned" ? state.schedules.unassigned : state.rooms.some((room) => room.id === key) || state.schedules[key])); }
  function roomInfo(key, schedule) { const room = state.rooms.find((item) => item.id === key); return { name: room?.name || schedule?.roomNameSnapshot || (key === "unassigned" ? "未指定直播间" : "历史直播间"), account: room?.account || schedule?.roomAccountSnapshot || "" }; }
  function getRoomSchedule(create = true) {
    if (!selectedRoomKey) return null;
    if (!state.schedules[selectedRoomKey] && create) { const info = roomInfo(selectedRoomKey); state.schedules[selectedRoomKey] = { roomId: selectedRoomKey === "unassigned" ? "" : selectedRoomKey, roomNameSnapshot: info.name, roomAccountSnapshot: info.account, days: {} }; }
    return state.schedules[selectedRoomKey] || null;
  }
  function getDay(dateKey, create = true) { const schedule = getRoomSchedule(create); if (!schedule) return null; if (!schedule.days[dateKey] && create) schedule.days[dateKey] = { leavePeople: [], leaveNote: "", updatedAt: nowIso() }; const day = schedule.days[dateKey]; if (day) { day.leavePeople = Array.isArray(day.leavePeople) ? day.leavePeople : []; day.leaveNote = day.leaveNote || ""; } return day || null; }
  function blankSlot(shift) { return { shiftLabelSnapshot: shift.label || "班次", hostId: "", coHostId: "", hostNameSnapshot: "", coHostNameSnapshot: "", roomId: shift.roomId || selectedRoomKey, roomNameSnapshot: "", roomAccountSnapshot: "", groupType: "formal", startTime: shift.startTime, endTime: shift.endTime, overtimeStartTime: "", overtimeEndTime: "", note: "" }; }
  function getSlot(dateKey, shift, create = true) { const day = getDay(dateKey, create); if (!day) return blankSlot(shift); if (!day[shift.key] && create) day[shift.key] = blankSlot(shift); return day[shift.key] || blankSlot(shift); }
  function touchDay(dateKey) { const day = getDay(dateKey, false); if (day) day.updatedAt = nowIso(); }
  function selectedDaysObject() { const schedule = getRoomSchedule(false); return Object.fromEntries(currentDates().map((date) => Logic.toIsoDate(date)).map((key) => [key, schedule?.days?.[key]]).filter(([, day]) => day)); }
  function displayShiftDefinitions() { const active = activeShiftDefinitions(); const keys = new Set(active.map((shift) => shift.key)); const days = selectedDaysObject(); allShiftDefinitions().forEach((shift) => { if (!keys.has(shift.key) && Object.values(days).some((day) => day?.[shift.key])) { active.push(shift); keys.add(shift.key); } }); return active; }
  function renderAll() { syncActiveShifts(); renderRangeLabel(); renderRoomSelectors(); renderScheduleSettings(); renderGroupTemplates(); renderSchedule(); renderPerformance(); renderRooms(); renderPeople(); renderStats(); }
  function renderRangeLabel() { const dates = currentDates(); const label = dates.length ? `${formatFullDate(dates[0])} — ${formatFullDate(dates.at(-1))}` : "无效日期区间"; elements.weekRangeLabel.textContent = label; const info = selectedRoomKey ? roomInfo(selectedRoomKey, getRoomSchedule(false)) : null; elements.statsRangeLabel.textContent = `统计区间：${label}${info ? ` · ${info.name}` : " · 未选择直播间"}`; }
  function renderRoomSelectors() {
    const currentFilter = elements.historyRoomFilter.value; elements.scheduleRoomSelect.replaceChildren(new Option("请选择直播间", ""));
    state.rooms.filter((room) => room.active || room.id === selectedRoomKey).sort((a, b) => a.name.localeCompare(b.name, "zh-CN")).forEach((room) => elements.scheduleRoomSelect.add(new Option(`${room.name}（${room.account}）${room.active ? "" : " · 停用"}`, room.id)));
    if (state.schedules.unassigned) elements.scheduleRoomSelect.add(new Option("未指定直播间（历史兼容）", "unassigned"));
    if (selectedRoomKey && ![...elements.scheduleRoomSelect.options].some((option) => option.value === selectedRoomKey)) { const info = roomInfo(selectedRoomKey, getRoomSchedule(false)); elements.scheduleRoomSelect.add(new Option(`${info.name} · 历史`, selectedRoomKey)); }
    elements.scheduleRoomSelect.value = selectedRoomKey; elements.historyRoomFilter.replaceChildren(new Option("请选择直播间", "")); const keys = new Set([...state.rooms.map((room) => room.id), ...Object.keys(state.schedules)]); [...keys].forEach((key) => { const info = roomInfo(key, state.schedules[key]); elements.historyRoomFilter.add(new Option(`${info.name}${info.account ? `（${info.account}）` : ""}`, key)); }); const keepCurrentFilter = Boolean(currentFilter) && [...elements.historyRoomFilter.options].some((option) => option.value === currentFilter); elements.historyRoomFilter.value = keepCurrentFilter ? currentFilter : selectedRoomKey;
  }
  function getGroupTemplates() { return state.settings.formalGroups || []; }
  function getPartTimeGroup() { return state.settings.partTimeGroup || { id: "part-time-group", name: "固定兼职班组", hostId: "", coHostId: "" }; }
  function renderGroupTemplates() {
    elements.groupTemplateGrid.replaceChildren(); elements.autoScheduler.classList.toggle("is-disabled", !selectedRoomKey); elements.generateScheduleBtn.disabled = !selectedRoomKey;
    if (!selectedRoomKey) { elements.autoScheduleStatus.textContent = "选择主直播间后即可生成排班。"; return; }
    getGroupTemplates().filter((group) => group.active !== false).forEach((group) => {
      const card = document.createElement("section"); card.className = "group-template-card"; const title = document.createElement("h3"); title.textContent = group.name; const shift = shifts.find((item) => item.key === group.defaultShiftId); const host = state.people.find((person) => person.id === group.hostId); const coHost = state.people.find((person) => person.id === group.coHostId); const room = state.rooms.find((item) => item.id === shift?.roomId); const detail = document.createElement("p"); detail.className = "template-summary"; detail.textContent = `主播：${host?.name || "未设置"}\n副播：${coHost?.name || "未设置"}\n默认班次：${shift?.label || "未设置"}\n直播间：${room?.name || "未设置"}`; card.append(title, detail); elements.groupTemplateGrid.appendChild(card);
    });
    const targets = scheduleTargets(); const partTime = getPartTimeGroup(); const card = document.createElement("section"); card.className = "group-template-card part-time-template"; const title = document.createElement("h3"); title.textContent = "智能补班规则"; const description = document.createElement("p"); description.textContent = `最低 ${targets.minimumShiftCount} 班 / ${formatHours(Number(targets.minimumTotalHours))}h\n固定兼职：${performancePersonName(partTime.hostId, "未设置")}＋${performancePersonName(partTime.coHostId, "未设置")}\n单班最多加班 ${formatHours(Number(targets.defaultOvertimeHours))}h`; card.append(title, description); elements.groupTemplateGrid.appendChild(card);
    elements.autoScheduleStatus.textContent = "配置请在“排班设置”中维护；生成时保留休假信息与同班次业绩。";
  }
  function templateSelect(labelText, value, items, onChange, getLabel = (item) => item.name) { const label = document.createElement("label"); label.className = "template-field"; const span = document.createElement("span"); span.textContent = labelText; const select = document.createElement("select"); select.add(new Option("请选择", "")); items.filter((item) => item.active !== false || item.id === value).forEach((item) => select.add(new Option(getLabel(item), item.id || item.key))); select.value = value || ""; select.addEventListener("change", () => onChange(select.value)); label.append(span, select); return label; }
  function validateGroupTemplates(templates, partTime) {
    const activeGroups = templates.filter((group) => group.active !== false);
    if (!shifts.length) return "请至少启用一个班次。";
    if (!activeGroups.length || activeGroups.some((g) => !g.hostId || !g.coHostId || !g.defaultShiftId)) return "请完整配置启用班组的主播、副播和默认班次。";
    if (activeGroups.some((g) => g.hostId === g.coHostId)) return "同一班组的主播和副播不能是同一人。";
    if (activeGroups.some((group) => !state.people.find((person) => person.id === group.hostId && person.active) || !state.people.find((person) => person.id === group.coHostId && person.active))) return "启用班组包含已停用或已删除人员，请先修复班组配置。";
    if (shifts.some((shift) => !shift.roomId || !Logic.durationHours(shift.startTime, shift.endTime))) return "请完整设置启用班次的直播间和有效时间。";
    if (Number(scheduleTargets().minimumShiftCount) > shifts.length) return "最小班次数不能超过启用班次数。";
    if (partTime?.hostId && partTime?.coHostId && partTime.hostId === partTime.coHostId) return "兼职班组的主播和副播不能是同一人。";
    return "";
  }
  function generateRangeSchedule() {
    if (!selectedRoomKey) return showToast("请先选择主直播间。", true);
    const templates = getGroupTemplates(); const partTime = getPartTimeGroup(); const error = validateGroupTemplates(templates, partTime); if (error) return showToast(error, true);
    const dates = currentDates(); const knownShifts = [...allShiftDefinitions(), ...legacyOvertimeShifts]; const hasExisting = dates.some((date) => { const day = getDay(Logic.toIsoDate(date), false); return day && knownShifts.some((shift) => { const slot = day[shift.key]; return slot && (slot.hostId || slot.coHostId || slot.note || slot.overtimeStartTime); }); });
    if (hasExisting && !window.confirm("所选区间已有排班。是否覆盖班次内容？休假信息会保留；仍存在的同日期、同班次业绩也会保留。")) return;
    const summary = { ready: 0, manual: 0 };
    dates.forEach((date) => {
      const dateKey = Logic.toIsoDate(date); const day = getDay(dateKey); const performanceByShift = new Map();
      allShiftDefinitions().forEach((shift) => { const oldSlot = day[shift.key]; if (typeof oldSlot?.performanceAmount === "number") performanceByShift.set(shift.key, { performanceAmount: oldSlot.performanceAmount, performanceUpdatedAt: oldSlot.performanceUpdatedAt || "" }); });
      knownShifts.forEach((shift) => { delete day[shift.key]; });
      const plan = Logic.planDayFromConfiguration(templates, shifts, scheduleTargets(), day.leavePeople.map((item) => item.personId), partTime); summary[plan.needsManual ? "manual" : "ready"] += 1;
      plan.assignments.forEach((group) => {
        const shift = shifts.find((item) => item.key === group.shiftKey); const slot = blankSlot(shift); const host = state.people.find((p) => p.id === group.hostId); const coHost = state.people.find((p) => p.id === group.coHostId); const roomId = shift.roomId || selectedRoomKey; const room = state.rooms.find((item) => item.id === roomId); const notes = [];
        if (group.groupType === "partTime") notes.push("系统自动补入固定兼职班组");
        if (group.overtimeHours) notes.push(`系统自动加班 ${formatHours(group.overtimeHours)} 小时`);
        Object.assign(slot, { shiftLabelSnapshot: shift.label, hostId: group.hostId, coHostId: group.coHostId, hostNameSnapshot: host?.name || "", coHostNameSnapshot: coHost?.name || "", roomId, roomNameSnapshot: room?.name || "", roomAccountSnapshot: room?.account || "", groupType: group.groupType || "formal", templateGroupId: group.id, startTime: shift.startTime, endTime: shift.endTime, overtimeStartTime: group.overtimeStartTime || "", overtimeEndTime: group.overtimeEndTime || "", note: notes.join("；") }, performanceByShift.get(group.shiftKey) || {});
        day[group.shiftKey] = slot;
      });
      day.autoSchedule = { mode: "targets-v1", completeCount: plan.completeCount, minimumShiftCount: plan.minimumShiftCount, totalHours: plan.totalHours, minimumTotalHours: plan.minimumTotalHours, missingShiftCount: plan.missingShiftCount, missingHours: plan.missingHours, partTimeUsed: plan.partTimeUsed, partTimeConflict: plan.partTimeConflict, needsManual: plan.needsManual, generatedAt: nowIso() }; day.updatedAt = nowIso();
    });
    saveState(); renderAll(); renderOverview(); elements.autoScheduleStatus.textContent = `已生成：达标 ${summary.ready} 天、需人工处理 ${summary.manual} 天。`; showToast("区间排班已生成，历史记录已同步");
  }
  function renderSchedule() {
    const dates = currentDates(); const dayData = selectedRoomKey ? selectedDaysObject() : {}; const conflicts = selectedRoomKey ? Logic.findConflicts(dayData, state.people) : [];
    const conflictKeys = new Set(conflicts.flatMap((item) => (item.shifts || []).map((key) => `${item.dayKey}:${key}`))); const leaveConflictDays = new Set(conflicts.filter((item) => item.type === "leave-scheduled").map((item) => item.dayKey));
    elements.scheduleHint.textContent = selectedRoomKey ? `当前区间统一属于：${roomInfo(selectedRoomKey, getRoomSchedule(false)).name}。日期列可在顶部自由调整。` : "请选择直播间，再为该直播间安排主播、副播和直播时间。"; elements.scheduleEmptyState.hidden = Boolean(selectedRoomKey); elements.scheduleScroll.classList.toggle("is-disabled", !selectedRoomKey); elements.clearScheduleBtn.disabled = !selectedRoomKey;
    const table = elements.scheduleHead.closest("table"); table.style.minWidth = `${Math.max(700, 90 + dates.length * 195)}px`;
    elements.scheduleHead.replaceChildren(); const headerRow = document.createElement("tr"); const corner = document.createElement("th"); corner.textContent = "班次 / 日期"; headerRow.appendChild(corner);
    dates.forEach((date) => { const th = document.createElement("th"); if (Logic.toIsoDate(date) === Logic.toIsoDate(new Date())) th.classList.add("today-header"); const dayName = document.createElement("span"); dayName.className = "day-name"; dayName.textContent = weekdays[date.getDay()]; const dateText = document.createElement("span"); dateText.className = "day-date"; dateText.textContent = `${date.getMonth() + 1}.${date.getDate()}`; th.append(dayName, dateText); headerRow.appendChild(th); }); elements.scheduleHead.appendChild(headerRow);
    elements.scheduleBody.replaceChildren(); const guideRow = document.createElement("tr"); const guideLabel = document.createElement("td"); guideLabel.className = "shift-label guide-label"; guideLabel.textContent = "排班提示"; guideRow.appendChild(guideLabel); dates.forEach((date) => { const cell = document.createElement("td"); cell.className = "guidance-cell"; cell.appendChild(buildDayGuidance(Logic.toIsoDate(date))); guideRow.appendChild(cell); }); elements.scheduleBody.appendChild(guideRow);
    displayShiftDefinitions().forEach((shift) => { const row = document.createElement("tr"); const label = document.createElement("td"); label.className = "shift-label"; label.textContent = shift.label; row.appendChild(label); dates.forEach((date) => { const dateKey = Logic.toIsoDate(date); const cell = document.createElement("td"); cell.className = "schedule-cell"; const slot = selectedRoomKey ? getSlot(dateKey, shift, shift.active !== false) : blankSlot(shift); if (conflictKeys.has(`${dateKey}:${shift.key}`)) cell.classList.add("has-conflict"); if ((slot.hostId || slot.coHostId) && Logic.durationHours(slot.startTime, slot.endTime) === 0) cell.classList.add("has-error"); cell.appendChild(buildSlotEditor(dateKey, shift, slot)); row.appendChild(cell); }); elements.scheduleBody.appendChild(row); });
    const leaveRow = document.createElement("tr"); const leaveLabel = document.createElement("td"); leaveLabel.className = "shift-label leave-label"; leaveLabel.textContent = "休假人员"; leaveRow.appendChild(leaveLabel); dates.forEach((date) => { const dateKey = Logic.toIsoDate(date); const cell = document.createElement("td"); cell.className = "leave-cell"; if (leaveConflictDays.has(dateKey)) cell.classList.add("has-conflict"); cell.appendChild(buildLeavePicker(dateKey)); leaveRow.appendChild(cell); }); elements.scheduleBody.appendChild(leaveRow);
  }
  function buildDayGuidance(dateKey) {
    const box = document.createElement("div"); box.className = "day-guidance"; const day = selectedRoomKey ? getDay(dateKey) : null; const meta = day?.autoSchedule;
    if (!meta) { box.classList.add("muted"); box.textContent = "尚未生成"; return box; }
    const evaluation = Logic.evaluateDayTargets(day, shifts, scheduleTargets());
    if (evaluation.hasLeaveConflict) { box.classList.add("danger"); box.textContent = "当前排班与休假人员冲突 · 请重新调整"; }
    else if (!evaluation.missingShiftCount && !evaluation.missingHours) { box.classList.add("ok"); box.textContent = `已排${evaluation.completeCount}班 · 总时长${formatHours(evaluation.totalHours)}h · 已达标`; }
    else { box.classList.add("warning"); box.textContent = `已排${evaluation.completeCount}班/最低${evaluation.minimumShiftCount}班；总时长${formatHours(evaluation.totalHours)}h/最低${formatHours(evaluation.minimumTotalHours)}h`; }
    return box;
  }
  function refreshScheduleGuidance() {
    if (!selectedRoomKey) return showToast("请先选择直播间。", true);
    currentDates().forEach((date) => { const day = getDay(Logic.toIsoDate(date), false); if (day) day.autoSchedule = { ...(day.autoSchedule || {}), mode: "targets-v1", refreshedAt: nowIso() }; });
    saveState(); renderSchedule(); renderStats(); elements.autoScheduleStatus.textContent = `排班提示已刷新 ${new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}，未修改任何排班内容。`; showToast("排班提示已刷新");
  }
  function clearCurrentSchedule() {
    if (!selectedRoomKey) return showToast("请先选择直播间。", true);
    if (!window.confirm(`确定清空 ${selectedStart} 至 ${selectedEnd} 的当前排班吗？\n\n将清空主播、副播、直播时间、加班、班次备注和已录入业绩；休假人员与休假备注会保留。`)) return;
    Logic.clearScheduleDays(getRoomSchedule(false), currentDates().map(Logic.toIsoDate), [...allShiftDefinitions(), ...legacyOvertimeShifts].map((shift) => shift.key), nowIso());
    openLeaveDateKey = "";
    saveState(); renderSchedule(); renderStats(); renderOverview();
    elements.autoScheduleStatus.textContent = "当前日期区间的排班已清空；休假人员和休假备注已保留。";
    showToast("当前排班和业绩已清空，休假信息已保留");
  }
  function buildSlotEditor(dateKey, shift, slot) {
    const wrapper = document.createElement("div"); wrapper.className = "slot-editor";
    const employment = slot.groupType || "formal"; const pool = employment === "partTime" ? state.people : state.people.filter((p) => p.employmentType !== "partTime"); const hostRow = buildPersonSelect("主播", "hostId", slot.hostId, pool.filter((p) => p.canHost), slot.hostNameSnapshot); const coHostRow = buildPersonSelect("副播", "coHostId", slot.coHostId, pool.filter((p) => p.canCoHost), slot.coHostNameSnapshot); hostRow.select.disabled = !selectedRoomKey; coHostRow.select.disabled = !selectedRoomKey; hostRow.select.addEventListener("change", () => updateSlotPerson(dateKey, shift, "host", hostRow.select.value)); coHostRow.select.addEventListener("change", () => updateSlotPerson(dateKey, shift, "coHost", coHostRow.select.value));
    const timeRow = document.createElement("div"); timeRow.className = "time-row"; const start = document.createElement("input"); start.type = "time"; start.value = slot.startTime || ""; start.disabled = !selectedRoomKey; start.ariaLabel = `${shift.label}开始时间`; const sep = document.createElement("span"); sep.textContent = "—"; const end = document.createElement("input"); end.type = "time"; end.value = slot.endTime || ""; end.disabled = !selectedRoomKey; end.ariaLabel = `${shift.label}结束时间`; [start, end].forEach((input) => input.addEventListener("change", () => { const target = getSlot(dateKey, shift); target.startTime = start.value; target.endTime = end.value; persistAndRender(dateKey); })); timeRow.append(start, sep, end);
    const duration = document.createElement("div"); duration.className = "duration"; const dlabel = document.createElement("span"); dlabel.textContent = "直播时长"; const dvalue = document.createElement("strong"); dvalue.textContent = `${formatHours(Logic.durationHours(slot.startTime, slot.endTime))}h`; duration.append(dlabel, dvalue);
    const overtime = document.createElement("details"); overtime.className = "embedded-overtime"; if (slot.overtimeStartTime || slot.overtimeEndTime) overtime.open = true; const overtimeSummary = document.createElement("summary"); const overtimeHours = Logic.durationHours(slot.overtimeStartTime, slot.overtimeEndTime); overtimeSummary.textContent = overtimeHours ? `加班 ${formatHours(overtimeHours)}小时` : "添加加班时段"; const overtimeTimes = document.createElement("div"); overtimeTimes.className = "time-row"; const overtimeStart = document.createElement("input"); overtimeStart.type = "time"; overtimeStart.value = slot.overtimeStartTime || ""; const overtimeEnd = document.createElement("input"); overtimeEnd.type = "time"; overtimeEnd.value = slot.overtimeEndTime || ""; [overtimeStart, overtimeEnd].forEach((input) => input.addEventListener("change", () => { const target = getSlot(dateKey, shift); target.overtimeStartTime = overtimeStart.value; target.overtimeEndTime = overtimeEnd.value; persistAndRender(dateKey); })); overtimeTimes.append(overtimeStart, document.createTextNode("—"), overtimeEnd); const overtimeHint = document.createElement("small"); overtimeHint.className = overtimeHours === 1.5 ? "overtime-ok" : overtimeHours ? "overtime-warning" : ""; overtimeHint.textContent = overtimeHours ? (overtimeHours === 1.5 ? "加班1.5小时" : `当前加班${formatHours(overtimeHours)}小时`) : "仅在需要时填写"; overtime.append(overtimeSummary, overtimeTimes, overtimeHint);
    const note = document.createElement("input"); note.className = "note-input"; note.type = "text"; note.maxLength = 80; note.placeholder = "备注（可选）"; note.value = slot.note || ""; note.disabled = !selectedRoomKey; note.addEventListener("change", () => { getSlot(dateKey, shift).note = note.value.trim(); persistAndRender(dateKey, false); }); wrapper.append(hostRow.element, coHostRow.element, timeRow, duration, overtime, note); return wrapper;
  }
  function buildPersonSelect(labelText, field, selectedId, candidates, snapshot) { const row = document.createElement("div"); row.className = "field-row"; const label = document.createElement("label"); label.textContent = labelText; const select = document.createElement("select"); select.dataset.field = field; select.add(new Option("未安排", "")); if (selectedId && !candidates.some((p) => p.id === selectedId)) select.add(new Option(`${snapshot || "历史人员"}（历史）`, selectedId)); candidates.filter((p) => p.active || p.id === selectedId).sort((a, b) => a.name.localeCompare(b.name, "zh-CN")).forEach((p) => select.add(new Option(p.active ? p.name : `${p.name}（停用）`, p.id))); select.value = selectedId || ""; row.append(label, select); return { element: row, select }; }
  function buildLeavePicker(dateKey) {
    const day = selectedRoomKey ? getDay(dateKey) : { leavePeople: [], leaveNote: "" }; const wrapper = document.createElement("div"); const details = document.createElement("details"); details.className = "leave-picker"; details.open = openLeaveDateKey === dateKey; details.addEventListener("toggle", () => { if (details.open) openLeaveDateKey = dateKey; else if (openLeaveDateKey === dateKey) openLeaveDateKey = ""; }); const summary = document.createElement("summary"); const names = day.leavePeople.map((item) => state.people.find((p) => p.id === item.personId)?.name || item.personNameSnapshot).filter(Boolean); summary.textContent = names.length ? names.join("、") : "选择休假人员"; const options = document.createElement("div"); options.className = "leave-options"; const pool = state.people.filter((p) => p.active || day.leavePeople.some((item) => item.personId === p.id)); day.leavePeople.filter((item) => !pool.some((p) => p.id === item.personId)).forEach((item) => pool.push({ id: item.personId, name: item.personNameSnapshot || "历史人员", active: false })); pool.sort((a, b) => a.name.localeCompare(b.name, "zh-CN")).forEach((person) => { const label = document.createElement("label"); const checkbox = document.createElement("input"); checkbox.type = "checkbox"; checkbox.disabled = !selectedRoomKey; checkbox.checked = day.leavePeople.some((item) => item.personId === person.id); checkbox.addEventListener("change", () => { if (checkbox.checked) day.leavePeople.push({ personId: person.id, personNameSnapshot: person.name }); else day.leavePeople = day.leavePeople.filter((item) => item.personId !== person.id); openLeaveDateKey = dateKey; persistAndRender(dateKey); }); label.append(checkbox, document.createTextNode(`${person.name}${person.active === false ? "（历史）" : ""}`)); options.appendChild(label); }); details.append(summary, options); const note = document.createElement("input"); note.className = "leave-note"; note.type = "text"; note.maxLength = 100; note.placeholder = "休假备注（可选）"; note.value = day.leaveNote || ""; note.disabled = !selectedRoomKey; note.addEventListener("change", () => { getDay(dateKey).leaveNote = note.value.trim(); persistAndRender(dateKey, false); }); wrapper.append(details, note); return wrapper;
  }
  function updateSlotPerson(dateKey, shift, role, personId) { if (!selectedRoomKey) return; const slot = getSlot(dateKey, shift); const person = state.people.find((item) => item.id === personId); if (role === "host") { slot.hostId = personId; slot.hostNameSnapshot = person ? person.name : personId ? slot.hostNameSnapshot : ""; } else { slot.coHostId = personId; slot.coHostNameSnapshot = person ? person.name : personId ? slot.coHostNameSnapshot : ""; } persistAndRender(dateKey); }
  function persistAndRender(dateKey, rerender = true) { touchDay(dateKey); saveState(); if (rerender) renderSchedule(); renderStats(); }

  function renderOverview() {
    if (!elements.overviewTableBody) return; const filter = elements.historyRoomFilter.value; const records = Logic.historyRecords(state, new Date()).filter((item) => !filter || item.roomKey === filter); elements.overviewTableBody.replaceChildren();
    records.forEach((item) => { const info = roomInfo(item.roomKey, item.roomSchedule); const leaveNames = (item.day.leavePeople || []).map((leave) => state.people.find((p) => p.id === leave.personId)?.name || leave.personNameSnapshot).join("、"); let added = false; [...allShiftDefinitions(), ...legacyOvertimeShifts].forEach((shift) => { const slot = item.day[shift.key]; if (!slot || (!slot.hostId && !slot.coHostId && !slot.note)) return; const hours = Logic.durationHours(slot.startTime, slot.endTime); const overtimeHours = shift.isOvertime ? hours : Logic.durationHours(slot.overtimeStartTime, slot.overtimeEndTime); const host = state.people.find((p) => p.id === slot.hostId)?.name || slot.hostNameSnapshot || ""; const coHost = state.people.find((p) => p.id === slot.coHostId)?.name || slot.coHostNameSnapshot || ""; const timeText = [slot.startTime && slot.endTime ? `${slot.startTime}–${slot.endTime}` : "", !shift.isOvertime && slot.overtimeStartTime && slot.overtimeEndTime ? `加班 ${slot.overtimeStartTime}–${slot.overtimeEndTime}` : ""].filter(Boolean).join("；"); const row = document.createElement("tr"); row.append(textCell(item.dateKey), textCell(slot.roomNameSnapshot || info.name), textCell(slot.shiftLabelSnapshot || shift.label), textCell(host), textCell(coHost), textCell(timeText), textCell(shift.isOvertime ? "" : `${formatHours(hours)}h`), textCell(overtimeHours ? `${formatHours(overtimeHours)}h` : ""), textCell(leaveNames), textCell(item.day.leaveNote || "")); elements.overviewTableBody.appendChild(row); added = true; }); if (!added && (leaveNames || item.day.leaveNote)) { const row = document.createElement("tr"); row.append(textCell(item.dateKey), textCell(info.name), textCell("休假"), textCell(""), textCell(""), textCell(""), textCell(""), textCell(""), textCell(leaveNames), textCell(item.day.leaveNote || "")); elements.overviewTableBody.appendChild(row); } });
    if (!elements.overviewTableBody.children.length) { const row = document.createElement("tr"); const cell = document.createElement("td"); cell.colSpan = 10; cell.textContent = "过去三个月及未来暂无排班记录"; row.appendChild(cell); elements.overviewTableBody.appendChild(row); }
  }
  function openHistoryRange() { const roomKey = elements.historyRoomFilter.value; if (!roomKey) return showToast("请选择直播间。", true); try { Logic.dateRange(elements.historyStartInput.value, elements.historyEndInput.value, 14); selectedRoomKey = roomKey; state.settings.lastRoomKey = roomKey; setRange(elements.historyStartInput.value, elements.historyEndInput.value, false); activateTab("schedule"); } catch (error) { showToast(error.message, true); } }

  function performanceBounds() { return Logic.performanceRangeBounds(performanceRangeMode, selectedStart, selectedEnd, new Date()); }
  function renderPerformance() {
    if (!elements.performanceTableHead || !elements.performanceTableBody) return;
    renderPerformanceMatrix();
    renderPerformanceSummary();
  }
  function renderPerformanceMatrix() {
    const dates = currentDates(); const schedule = selectedRoomKey ? getRoomSchedule(false) : null; const fallback = selectedRoomKey ? roomInfo(selectedRoomKey, schedule) : null;
    elements.performanceEntryRangeLabel.textContent = `${formatShortDate(selectedStart)} — ${formatShortDate(selectedEnd)}${fallback ? ` · ${fallback.name}` : " · 未选择直播间"}`;
    elements.performanceTableHead.replaceChildren(); elements.performanceTableBody.replaceChildren();
    const headRow = document.createElement("tr"); const corner = document.createElement("th"); corner.className = "performance-corner"; corner.scope = "col"; corner.textContent = "班次 / 日期"; headRow.appendChild(corner);
    dates.forEach((date) => { const dateKey = Logic.toIsoDate(date); const cell = document.createElement("th"); cell.scope = "col"; const weekday = document.createElement("strong"); weekday.textContent = weekdays[date.getDay()]; const shortDate = document.createElement("span"); shortDate.textContent = `${date.getMonth() + 1}.${date.getDate()}`; cell.append(weekday, shortDate); if (dateKey === todayStamp()) cell.classList.add("is-today"); headRow.appendChild(cell); });
    elements.performanceTableHead.appendChild(headRow); elements.performanceTableHead.closest("table").style.minWidth = `${150 + dates.length * 205}px`;
    displayShiftDefinitions().forEach((shift) => {
      const row = document.createElement("tr"); const label = document.createElement("th"); label.scope = "row"; label.className = `performance-shift-label${shift.key === "secondary" ? " secondary" : ""}`; label.textContent = shift.label; row.appendChild(label);
      dates.forEach((date) => {
        const dateKey = Logic.toIsoDate(date); const day = schedule?.days?.[dateKey]; const slot = day?.[shift.key]; const cell = document.createElement("td"); cell.className = "performance-matrix-cell";
        if (!selectedRoomKey || !slot || (!slot.hostId && !slot.coHostId)) { const empty = document.createElement("span"); empty.className = "performance-empty"; empty.textContent = selectedRoomKey ? "未排班" : "未选择直播间"; cell.appendChild(empty); }
        else cell.appendChild(buildPerformanceEditor({ dateKey, day, shift, slot, roomName: performanceRoomName(slot, fallback), hostName: performancePersonName(slot.hostId, slot.hostNameSnapshot), coHostName: performancePersonName(slot.coHostId, slot.coHostNameSnapshot) }));
        row.appendChild(cell);
      });
      elements.performanceTableBody.appendChild(row);
    });
  }
  function performanceRoomName(slot, fallback) { return state.rooms.find((item) => item.id === slot.roomId)?.name || slot.roomNameSnapshot || fallback?.name || "未指定直播间"; }
  function performancePersonName(id, snapshot) { return state.people.find((person) => person.id === id)?.name || snapshot || "未安排"; }
  function buildPerformanceEditor(entry) {
    const editor = document.createElement("div"); editor.className = "performance-editor";
    const room = document.createElement("div"); room.className = "performance-room"; room.textContent = entry.roomName;
    const people = document.createElement("div"); people.className = "performance-people"; const host = document.createElement("span"); host.textContent = `主播：${entry.hostName}`; if (!entry.slot.hostId) host.classList.add("missing-person"); const coHost = document.createElement("span"); coHost.textContent = `副播：${entry.coHostName}`; if (!entry.slot.coHostId) coHost.classList.add("missing-person"); people.append(host, coHost);
    const amountRow = document.createElement("div"); amountRow.className = "performance-amount-row"; const currency = document.createElement("span"); currency.textContent = "¥"; const input = document.createElement("input"); input.type = "number"; input.min = "0"; input.step = "0.01"; input.inputMode = "decimal"; input.placeholder = "输入业绩"; input.ariaLabel = `${entry.dateKey}${entry.shift.label}业绩金额`; input.value = typeof entry.slot.performanceAmount === "number" ? String(entry.slot.performanceAmount) : ""; amountRow.append(currency, input);
    const feedback = document.createElement("div"); feedback.className = "performance-feedback"; const error = document.createElement("small"); error.className = "performance-error"; const status = document.createElement("span"); status.className = `performance-status${typeof entry.slot.performanceAmount === "number" ? " saved" : ""}`; status.textContent = typeof entry.slot.performanceAmount === "number" ? "已保存" : "未录入"; feedback.append(error, status); input.addEventListener("input", () => validatePerformanceInput(input, error)); input.addEventListener("change", () => savePerformanceAmount(entry, input, error, status));
    editor.append(room, people, amountRow, feedback); return editor;
  }
  function renderPerformanceSummary() {
    document.querySelectorAll("[data-performance-range]").forEach((button) => button.classList.toggle("active", button.dataset.performanceRange === performanceRangeMode));
    let bounds; try { bounds = performanceBounds(); } catch (error) { elements.performanceRangeLabel.textContent = error.message; return; }
    const rangeNames = { current: "当前区间", "30d": "近30天", "3m": "近3个月", all: "全部日期" }; const rangeText = bounds.start ? `${formatShortDate(bounds.start)} — ${formatShortDate(bounds.end)}` : "全部已保存日期";
    elements.performanceRangeLabel.textContent = `${rangeNames[performanceRangeMode]}：${rangeText}`; renderPerformanceRankings(bounds);
  }
  function validatePerformanceInput(input, error) { const parsed = Logic.parsePerformanceAmount(input.value); input.classList.toggle("is-invalid", !parsed.valid); error.textContent = parsed.valid ? "" : "请输入非负金额，最多两位小数"; return parsed; }
  function savePerformanceAmount(entry, input, error, status) {
    const parsed = validatePerformanceInput(input, error); if (!parsed.valid) { status.className = "performance-status warning"; status.textContent = "未保存"; return; }
    entry.slot.performanceAmount = parsed.value; entry.slot.performanceUpdatedAt = parsed.value === null ? "" : nowIso(); touchDay(entry.dateKey);
    if (!saveState()) { status.className = "performance-status warning"; status.textContent = "保存失败"; return; }
    status.className = `performance-status${parsed.value === null ? "" : " saved"}`; status.textContent = parsed.value === null ? "未录入" : "已保存"; renderPerformanceRankings(performanceBounds()); showToast(parsed.value === null ? "业绩已清除" : "业绩已保存");
  }
  function renderPerformanceRankings(bounds) {
    const schedule = getRoomSchedule(false); const rankings = Logic.calculatePerformanceRankings(schedule?.days || {}, state.people, allShiftDefinitions().map((shift) => shift.key), bounds); renderRankingBody(elements.hostRankingBody, rankings.hosts, "暂无主播业绩"); renderRankingBody(elements.coHostRankingBody, rankings.coHosts, "暂无副播业绩");
  }
  function renderRankingBody(body, rows, emptyText) {
    body.replaceChildren(); if (!rows.length) { const row = document.createElement("tr"); const cell = document.createElement("td"); cell.colSpan = 5; cell.textContent = emptyText; row.appendChild(cell); body.appendChild(row); return; }
    rows.forEach((item) => { const row = document.createElement("tr"); const rankCell = document.createElement("td"); const rank = document.createElement("span"); rank.className = `rank-number${item.rank <= 3 ? " top" : ""}`; rank.textContent = String(item.rank); rankCell.appendChild(rank); row.append(rankCell, textCell(item.name), textCell(formatCurrency(item.total)), textCell(String(item.sessionCount)), textCell(formatCurrency(item.average))); body.appendChild(row); });
  }

  function replaceSelectOptions(select, items, value, getLabel = (item) => item.name, includeEmpty = true) { const current = value ?? select.value; select.replaceChildren(); if (includeEmpty) select.add(new Option("请选择", "")); items.forEach((item) => select.add(new Option(getLabel(item), item.id || item.key))); select.value = current || ""; }
  function renderScheduleSettings() {
    if (!elements.scheduleTargetsForm) return;
    const targets = scheduleTargets(); elements.minimumShiftCountInput.value = targets.minimumShiftCount; elements.minimumTotalHoursInput.value = targets.minimumTotalHours; elements.defaultOvertimeHoursInput.value = targets.defaultOvertimeHours;
    replaceSelectOptions(elements.shiftDefinitionRoomInput, state.rooms.filter((room) => room.active || room.id === elements.shiftDefinitionRoomInput.value), elements.shiftDefinitionRoomInput.value, (room) => `${room.name}（${room.account}）`);
    const formalPeople = state.people.filter((person) => person.employmentType !== "partTime" && (person.active || [elements.formalGroupHostInput.value, elements.formalGroupCoHostInput.value].includes(person.id)));
    replaceSelectOptions(elements.formalGroupHostInput, formalPeople.filter((person) => person.canHost), elements.formalGroupHostInput.value);
    replaceSelectOptions(elements.formalGroupCoHostInput, formalPeople.filter((person) => person.canCoHost), elements.formalGroupCoHostInput.value);
    replaceSelectOptions(elements.formalGroupShiftInput, shifts, elements.formalGroupShiftInput.value, (shift) => shift.label);
    const partTime = getPartTimeGroup(); const selectedPartTimeIds = [partTime.hostId, partTime.coHostId];
    replaceSelectOptions(elements.partTimeGroupHostInput, Logic.eligiblePeopleForRole(state.people, "host", selectedPartTimeIds), partTime.hostId);
    replaceSelectOptions(elements.partTimeGroupCoHostInput, Logic.eligiblePeopleForRole(state.people, "coHost", selectedPartTimeIds), partTime.coHostId);
    renderShiftDefinitionsTable(); renderFormalGroupsTable();
  }
  function saveScheduleTargets(event) { event.preventDefault(); const minimumShiftCount = Number(elements.minimumShiftCountInput.value); const minimumTotalHours = Number(elements.minimumTotalHoursInput.value); const defaultOvertimeHours = Number(elements.defaultOvertimeHoursInput.value); elements.scheduleTargetsError.textContent = ""; if (!Number.isInteger(minimumShiftCount) || minimumShiftCount < 1 || minimumShiftCount > shifts.length) return elements.scheduleTargetsError.textContent = `最小班次数必须是1至${Math.max(shifts.length, 1)}之间的整数。`; if (!Number.isFinite(minimumTotalHours) || minimumTotalHours < 0) return elements.scheduleTargetsError.textContent = "最小直播总时长不能小于0。"; if (!Number.isFinite(defaultOvertimeHours) || defaultOvertimeHours <= 0) return elements.scheduleTargetsError.textContent = "默认自动加班时长必须大于0。"; state.settings.scheduleTargets = { minimumShiftCount, minimumTotalHours, defaultOvertimeHours }; saveState(); renderAll(); showToast("最低目标已保存"); }
  function saveShiftDefinition(event) {
    event.preventDefault(); const id = elements.shiftDefinitionIdInput.value; const label = elements.shiftDefinitionNameInput.value.trim(); const roomId = elements.shiftDefinitionRoomInput.value; const startTime = elements.shiftDefinitionStartInput.value; const endTime = elements.shiftDefinitionEndInput.value; const allowOvertime = elements.shiftDefinitionOvertimeInput.checked; const overtimePriority = Number(elements.shiftDefinitionPriorityInput.value) || 1; const definitions = state.settings.shiftDefinitions; elements.shiftDefinitionError.textContent = "";
    if (!label || !roomId || !Logic.durationHours(startTime, endTime)) return elements.shiftDefinitionError.textContent = "请填写名称、直播间和有效起止时间。";
    if (definitions.some((item) => !item.deleted && item.label.toLocaleLowerCase() === label.toLocaleLowerCase() && item.key !== id)) return elements.shiftDefinitionError.textContent = "班次名称不能重复。";
    if (!id && configurableShiftDefinitions().length >= 12) return elements.shiftDefinitionError.textContent = "最多只能创建12个班次。";
    if (id) { const shift = definitions.find((item) => item.key === id); if (!shift) return; Object.assign(shift, { label, roomId, startTime, endTime, allowOvertime, overtimePriority }); }
    else definitions.push({ key: createId("shift"), label, roomId, startTime, endTime, active: true, allowOvertime, overtimePriority, order: definitions.length + 1 });
    syncActiveShifts(); saveState(); resetShiftDefinitionForm(); renderAll(); showToast(id ? "班次已更新" : "班次已新增");
  }
  function renderShiftDefinitionsTable() { elements.shiftDefinitionsTableBody.replaceChildren(); const list = configurableShiftDefinitions(); list.forEach((shift, index) => { const room = state.rooms.find((item) => item.id === shift.roomId); const row = document.createElement("tr"); row.append(textCell(String(index + 1)), textCell(shift.label), textCell(room?.name || "未设置"), textCell(`${shift.startTime || "--:--"}–${shift.endTime || "--:--"}`), textCell(shift.allowOvertime ? `允许 · 优先级${shift.overtimePriority}` : "不允许")); const status = document.createElement("td"); status.append(statusBadge(shift.active !== false)); row.appendChild(status); const actions = document.createElement("td"); actions.className = "row-actions settings-actions"; actions.append(actionButton("编辑", () => editShiftDefinition(shift.key)), actionButton("上移", () => moveConfiguredItem(list, shift.key, -1), "", index === 0), actionButton("下移", () => moveConfiguredItem(list, shift.key, 1), "", index === list.length - 1), actionButton(shift.active === false ? "启用" : "停用", () => toggleShiftDefinition(shift.key), shift.active === false ? "" : "danger"), actionButton("删除", () => deleteShiftDefinition(shift.key), "danger")); row.appendChild(actions); elements.shiftDefinitionsTableBody.appendChild(row); }); }
  function editShiftDefinition(id) { const shift = state.settings.shiftDefinitions.find((item) => item.key === id); if (!shift) return; elements.shiftDefinitionIdInput.value = shift.key; elements.shiftDefinitionNameInput.value = shift.label; elements.shiftDefinitionRoomInput.value = shift.roomId || ""; elements.shiftDefinitionStartInput.value = shift.startTime || ""; elements.shiftDefinitionEndInput.value = shift.endTime || ""; elements.shiftDefinitionOvertimeInput.checked = Boolean(shift.allowOvertime); elements.shiftDefinitionPriorityInput.value = shift.overtimePriority || 1; elements.saveShiftDefinitionBtn.textContent = "保存修改"; elements.cancelShiftDefinitionBtn.hidden = false; }
  function resetShiftDefinitionForm() { elements.shiftDefinitionForm.reset(); elements.shiftDefinitionIdInput.value = ""; elements.shiftDefinitionPriorityInput.value = "1"; elements.shiftDefinitionError.textContent = ""; elements.saveShiftDefinitionBtn.textContent = "新增班次"; elements.cancelShiftDefinitionBtn.hidden = true; renderScheduleSettings(); }
  function toggleShiftDefinition(id) { const shift = state.settings.shiftDefinitions.find((item) => item.key === id); if (!shift) return; if (shift.active !== false && shifts.length - 1 < Number(scheduleTargets().minimumShiftCount)) return showToast("停用后启用班次数将小于每日最小班次数。", true); shift.active = shift.active === false; syncActiveShifts(); saveState(); renderAll(); showToast(`${shift.label}已${shift.active ? "启用" : "停用"}`); }
  function deleteShiftDefinition(id) { const shift = state.settings.shiftDefinitions.find((item) => item.key === id); if (!shift) return; if (state.settings.formalGroups.some((group) => group.defaultShiftId === id)) return showToast("仍有班组使用此默认班次，请先修改班组。", true); const remainingActive = shifts.length - (shift.active === false ? 0 : 1); if (remainingActive < Number(scheduleTargets().minimumShiftCount)) return showToast("删除后启用班次数将小于每日最小班次数。", true); if (!window.confirm(`确认删除班次“${shift.label}”？历史排班仍会保留。`)) return; shift.active = false; shift.deleted = true; syncActiveShifts(); saveState(); resetShiftDefinitionForm(); renderAll(); showToast("班次已删除，历史排班已保留"); }
  function moveConfiguredItem(items, id, direction) { const ordered = items.slice().sort((a, b) => (a.order || 0) - (b.order || 0)); const index = ordered.findIndex((item) => (item.id || item.key) === id); const target = index + direction; if (index < 0 || target < 0 || target >= ordered.length) return; [ordered[index], ordered[target]] = [ordered[target], ordered[index]]; ordered.forEach((item, itemIndex) => { item.order = itemIndex + 1; }); saveState(); renderAll(); }
  function saveFormalGroup(event) { event.preventDefault(); const id = elements.formalGroupIdInput.value; const name = elements.formalGroupNameInput.value.trim(); const hostId = elements.formalGroupHostInput.value; const coHostId = elements.formalGroupCoHostInput.value; const defaultShiftId = elements.formalGroupShiftInput.value; const groups = state.settings.formalGroups; elements.formalGroupError.textContent = ""; if (!name || !hostId || !coHostId || !defaultShiftId) return elements.formalGroupError.textContent = "请完整填写班组名称、人员和默认班次。"; if (hostId === coHostId) return elements.formalGroupError.textContent = "主播和副播不能是同一人。"; if (groups.some((group) => group.name.toLocaleLowerCase() === name.toLocaleLowerCase() && group.id !== id)) return elements.formalGroupError.textContent = "班组名称不能重复。"; if (!id && groups.length >= 12) return elements.formalGroupError.textContent = "最多只能创建12个正式班组。"; if (id) Object.assign(groups.find((group) => group.id === id), { name, hostId, coHostId, defaultShiftId }); else groups.push({ id: createId("group"), name, hostId, coHostId, defaultShiftId, active: true, order: groups.length + 1 }); saveState(); resetFormalGroupForm(); renderAll(); showToast(id ? "班组已更新" : "班组已新增"); }
  function renderFormalGroupsTable() { elements.formalGroupsTableBody.replaceChildren(); const groups = getGroupTemplates().slice().sort((a, b) => (a.order || 0) - (b.order || 0)); groups.forEach((group, index) => { const host = state.people.find((item) => item.id === group.hostId); const coHost = state.people.find((item) => item.id === group.coHostId); const shift = allShiftDefinitions().find((item) => item.key === group.defaultShiftId); const row = document.createElement("tr"); row.append(textCell(String(index + 1)), textCell(group.name), textCell(host?.name || "未设置"), textCell(coHost?.name || "未设置"), textCell(shift?.label || "未设置")); const status = document.createElement("td"); status.append(statusBadge(group.active !== false)); row.appendChild(status); const actions = document.createElement("td"); actions.className = "row-actions settings-actions"; actions.append(actionButton("编辑", () => editFormalGroup(group.id)), actionButton("上移", () => moveConfiguredItem(state.settings.formalGroups, group.id, -1)), actionButton("下移", () => moveConfiguredItem(state.settings.formalGroups, group.id, 1)), actionButton(group.active === false ? "启用" : "停用", () => toggleFormalGroup(group.id), group.active === false ? "" : "danger"), actionButton("删除", () => deleteFormalGroup(group.id), "danger")); row.appendChild(actions); elements.formalGroupsTableBody.appendChild(row); }); }
  function editFormalGroup(id) { const group = state.settings.formalGroups.find((item) => item.id === id); if (!group) return; elements.formalGroupIdInput.value = group.id; elements.formalGroupNameInput.value = group.name; elements.formalGroupHostInput.value = group.hostId || ""; elements.formalGroupCoHostInput.value = group.coHostId || ""; elements.formalGroupShiftInput.value = group.defaultShiftId || ""; elements.saveFormalGroupBtn.textContent = "保存修改"; elements.cancelFormalGroupBtn.hidden = false; }
  function resetFormalGroupForm() { elements.formalGroupForm.reset(); elements.formalGroupIdInput.value = ""; elements.formalGroupError.textContent = ""; elements.saveFormalGroupBtn.textContent = "新增班组"; elements.cancelFormalGroupBtn.hidden = true; renderScheduleSettings(); }
  function toggleFormalGroup(id) { const group = state.settings.formalGroups.find((item) => item.id === id); if (!group) return; group.active = group.active === false; saveState(); renderAll(); showToast(`${group.name}已${group.active ? "启用" : "停用"}`); }
  function deleteFormalGroup(id) { const group = state.settings.formalGroups.find((item) => item.id === id); if (!group || !window.confirm(`确认删除班组“${group.name}”？历史排班仍会保留。`)) return; state.settings.formalGroups = state.settings.formalGroups.filter((item) => item.id !== id); saveState(); resetFormalGroupForm(); renderAll(); showToast("班组已删除，历史排班已保留"); }
  function savePartTimeGroup(event) { event.preventDefault(); const hostId = elements.partTimeGroupHostInput.value; const coHostId = elements.partTimeGroupCoHostInput.value; elements.partTimeGroupError.textContent = ""; if (!hostId || !coHostId) return elements.partTimeGroupError.textContent = "请选择兼职主播和副播。"; if (hostId === coHostId) return elements.partTimeGroupError.textContent = "兼职主播和副播不能是同一人。"; state.settings.partTimeGroup = { ...getPartTimeGroup(), hostId, coHostId }; saveState(); renderAll(); showToast("固定兼职班组已保存"); }

  function renderRooms() { elements.roomsTableBody.replaceChildren(); if (!state.rooms.length) { const row = document.createElement("tr"); const cell = document.createElement("td"); cell.colSpan = 4; cell.textContent = "暂无直播间，请先新增。"; row.appendChild(cell); elements.roomsTableBody.appendChild(row); return; } state.rooms.slice().sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name, "zh-CN")).forEach((room) => { const row = document.createElement("tr"); row.append(textCell(room.name), textCell(room.account)); const status = document.createElement("td"); status.append(statusBadge(room.active)); row.appendChild(status); const actions = document.createElement("td"); actions.className = "row-actions"; actions.append(actionButton("编辑", () => editRoom(room.id)), actionButton(room.active ? "停用" : "启用", () => toggleRoom(room.id), room.active ? "danger" : ""), actionButton("删除", () => deleteRoom(room.id), "danger")); row.appendChild(actions); elements.roomsTableBody.appendChild(row); }); }
  function saveRoom(event) { event.preventDefault(); const id = elements.roomIdInput.value; const name = elements.roomNameInput.value.trim(); const account = elements.roomAccountInput.value.trim(); elements.roomFormError.textContent = ""; if (!name || !account) return showRoomError("请填写直播间名称和账号。"); if (state.rooms.some((room) => room.account.toLocaleLowerCase() === account.toLocaleLowerCase() && room.id !== id)) return showRoomError("该直播间账号已存在。"); if (id) { const room = state.rooms.find((item) => item.id === id); if (!room) return showRoomError("未找到要编辑的直播间。"); Object.assign(room, { name, account }); const schedule = state.schedules[id]; if (schedule) { schedule.roomNameSnapshot = name; schedule.roomAccountSnapshot = account; } showToast("直播间信息已更新"); } else { const room = { id: createId("room"), name, account, active: true }; state.rooms.push(room); selectedRoomKey = room.id; state.settings.lastRoomKey = room.id; state.settings.shiftDefinitions.forEach((shift) => { if (!shift.roomId) shift.roomId = room.id; }); showToast("直播间已新增并设为当前直播间"); } saveState(); resetRoomForm(); renderAll(); }
  function showRoomError(message) { elements.roomFormError.textContent = message; }
  function editRoom(id) { const room = state.rooms.find((item) => item.id === id); if (!room) return; elements.roomIdInput.value = room.id; elements.roomNameInput.value = room.name; elements.roomAccountInput.value = room.account; elements.saveRoomBtn.textContent = "保存修改"; elements.cancelRoomEditBtn.hidden = false; elements.roomNameInput.focus(); }
  function resetRoomForm() { elements.roomForm.reset(); elements.roomIdInput.value = ""; elements.roomFormError.textContent = ""; elements.saveRoomBtn.textContent = "新增直播间"; elements.cancelRoomEditBtn.hidden = true; }
  function toggleRoom(id) { const room = state.rooms.find((item) => item.id === id); if (!room) return; room.active = !room.active; saveState(); renderAll(); showToast(`${room.name}已${room.active ? "启用" : "停用"}`); }
  function deleteRoom(id) { const room = state.rooms.find((item) => item.id === id); if (!room || !window.confirm(`确认删除直播间“${room.name}”？历史记录会保留名称和账号。`)) return; state.rooms = state.rooms.filter((item) => item.id !== id); saveState(); resetRoomForm(); renderAll(); showToast("直播间已删除，历史记录已保留"); }
  function renderPeople() { elements.peopleTableBody.replaceChildren(); state.people.slice().sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name, "zh-CN")).forEach((person) => { const row = document.createElement("tr"); row.append(textCell(person.name), textCell([person.canHost ? "主播" : "", person.canCoHost ? "副播" : ""].filter(Boolean).join("、") || "未设置"), textCell(person.employmentType === "partTime" ? "兼职" : "正式员工")); const status = document.createElement("td"); status.append(statusBadge(person.active)); row.appendChild(status); const actions = document.createElement("td"); actions.className = "row-actions"; actions.append(actionButton("编辑", () => editPerson(person.id)), actionButton(person.active ? "停用" : "启用", () => togglePerson(person.id), person.active ? "danger" : ""), actionButton("删除", () => deletePerson(person.id), "danger")); row.appendChild(actions); elements.peopleTableBody.appendChild(row); }); }
  function savePerson(event) { event.preventDefault(); const id = elements.personIdInput.value; const name = elements.personNameInput.value.trim(); const canHost = elements.canHostInput.checked; const canCoHost = elements.canCoHostInput.checked; const employmentType = elements.employmentTypeInput.value; elements.personFormError.textContent = ""; if (!name) return showPersonError("请输入姓名。"); if (!canHost && !canCoHost) return showPersonError("请至少选择一个角色。"); if (state.people.some((person) => person.name.toLocaleLowerCase() === name.toLocaleLowerCase() && person.id !== id)) return showPersonError("该姓名已存在。"); if (id) { const person = state.people.find((item) => item.id === id); if (!person) return showPersonError("未找到要编辑的人员。"); Object.assign(person, { name, canHost, canCoHost, employmentType }); showToast("人员信息已更新"); } else { state.people.push({ id: createId("person"), name, canHost, canCoHost, employmentType, active: true }); showToast("人员已新增"); } saveState(); resetPersonForm(); renderAll(); }
  function showPersonError(message) { elements.personFormError.textContent = message; }
  function editPerson(id) { const person = state.people.find((item) => item.id === id); if (!person) return; elements.personIdInput.value = person.id; elements.personNameInput.value = person.name; elements.canHostInput.checked = person.canHost; elements.canCoHostInput.checked = person.canCoHost; elements.employmentTypeInput.value = person.employmentType || "formal"; elements.savePersonBtn.textContent = "保存修改"; elements.cancelPersonEditBtn.hidden = false; elements.personNameInput.focus(); }
  function resetPersonForm() { elements.personForm.reset(); elements.personIdInput.value = ""; elements.personFormError.textContent = ""; elements.employmentTypeInput.value = "formal"; elements.savePersonBtn.textContent = "新增人员"; elements.cancelPersonEditBtn.hidden = true; }
  function togglePerson(id) { const person = state.people.find((item) => item.id === id); if (!person) return; person.active = !person.active; saveState(); renderAll(); showToast(`${person.name}已${person.active ? "启用" : "停用"}`); }
  function deletePerson(id) { const person = state.people.find((item) => item.id === id); if (!person || !window.confirm(`确认删除人员“${person.name}”？历史排班记录会保留姓名。`)) return; state.people = state.people.filter((item) => item.id !== id); saveState(); resetPersonForm(); renderAll(); showToast("人员已删除，历史记录已保留"); }

  function renderStats() { const days = selectedRoomKey ? selectedDaysObject() : {}; const stats = Logic.calculateStatistics(days, state.people); const conflicts = Logic.findConflicts(days, state.people); elements.sessionCount.textContent = String(stats.sessionCount); elements.totalPersonHours.textContent = `${formatHours(stats.totalPersonHours)}h`; elements.statsTableBody.replaceChildren(); if (!stats.rows.length) { const row = document.createElement("tr"); const cell = document.createElement("td"); cell.colSpan = 4; cell.textContent = selectedRoomKey ? "当前直播间在此区间暂无有效排班" : "请先选择直播间"; row.appendChild(cell); elements.statsTableBody.appendChild(row); } else stats.rows.forEach((item) => { const row = document.createElement("tr"); row.append(textCell(item.name), textCell(`${formatHours(item.liveHours)}h`), textCell(`${formatHours(item.overtimeHours)}h`), textCell(`${formatHours(item.totalHours)}h`)); elements.statsTableBody.appendChild(row); }); elements.conflictList.replaceChildren(); if (!conflicts.length) { const ok = document.createElement("p"); ok.className = "check-ok"; ok.textContent = "未发现人员冲突或时间错误。"; elements.conflictList.appendChild(ok); } else conflicts.forEach((conflict) => { const item = document.createElement("p"); item.className = "conflict-item"; item.textContent = conflictText(conflict); elements.conflictList.appendChild(item); }); }
  function conflictText(conflict) { const date = Logic.parseLocalDate(conflict.dayKey); const prefix = date ? `${conflict.dayKey}（${weekdays[date.getDay()]}）` : conflict.dayKey; const names = (conflict.shifts || []).map((key) => [...allShiftDefinitions(), ...legacyOvertimeShifts].find((shift) => shift.key === key)?.label || key).join("、"); if (conflict.type === "overlap") return `${prefix}：${conflict.personName}在${names}时间重叠。`; if (conflict.type === "same-role-person") return `${prefix}${names}：主播和副播不能是同一人（统计仅计一次）。`; if (conflict.type === "leave-scheduled") return `${prefix}：${conflict.personName}已休假，但仍安排在${names}。`; return `${prefix}${names}：已安排人员，但直播时间无效。`; }
  function exportJson() { downloadFile(`直播排班备份-${todayStamp()}.json`, JSON.stringify(state, null, 2), "application/json;charset=utf-8"); showToast("JSON 备份已导出"); }
  async function importJson(event) { const file = event.target.files?.[0]; event.target.value = ""; if (!file) return; try { const migrated = Logic.migrateState(JSON.parse(await file.text())); if (!window.confirm("导入会覆盖当前直播间、人员和全部排班数据。是否继续？")) return; state = migrated; syncActiveShifts(); selectedRoomKey = state.settings.lastRoomKey || ""; selectedStart = validDateKey(state.settings.rangeStart) ? state.settings.rangeStart : Logic.toIsoDate(new Date()); selectedEnd = validDateKey(state.settings.rangeEnd) ? state.settings.rangeEnd : Logic.toIsoDate(Logic.addDays(new Date(), 6)); saveState(); resetRoomForm(); resetPersonForm(); resetShiftDefinitionForm(); resetFormalGroupForm(); renderRangePickerButton(); renderAll(); renderOverview(); showToast("备份已导入并升级为 V5"); } catch (error) { showToast(`导入失败：${error.message}`, true); } }

  async function exportScheduleTemplate(prefill) {
    if (!Spreadsheet || !window.ExcelJS) return showToast("Excel 组件未加载，请重启应用后重试。", true);
    try {
      showToast("正在生成排班模板…");
      const workbook = await Spreadsheet.createScheduleTemplateWorkbook(window.ExcelJS, state, selectedStart, selectedEnd, prefill);
      const buffer = await workbook.xlsx.writeBuffer();
      downloadFile(`${prefill ? "可编辑排班模板" : "空白排班模板"}-${selectedStart}-${selectedEnd}.xlsx`, buffer, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      showToast(prefill ? "可编辑排班模板已导出" : "空白排班模板已下载");
    } catch (error) { console.error(error); showToast(`排班模板生成失败：${error.message}`, true); }
  }

  function stateWithoutPerformance() {
    const output = clone(state);
    Object.values(output.schedules || {}).forEach((schedule) => Object.values(schedule?.days || {}).forEach((day) => Object.values(day || {}).forEach((slot) => { if (slot && typeof slot === "object") { delete slot.performanceAmount; delete slot.performanceUpdatedAt; } })));
    return output;
  }

  async function exportPerformanceTemplate(blank) {
    if (!Spreadsheet || !window.ExcelJS) return showToast("Excel 组件未加载，请重启应用后重试。", true);
    try {
      const workbook = Spreadsheet.createPerformanceWorkbook(window.ExcelJS, blank ? stateWithoutPerformance() : state, selectedStart, selectedEnd);
      const buffer = await workbook.xlsx.writeBuffer();
      downloadFile(`${blank ? "空白业绩模板" : "业绩表"}-${selectedStart}-${selectedEnd}.xlsx`, buffer, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      showToast(blank ? "空白业绩模板已下载" : "业绩表已导出");
    } catch (error) { console.error(error); showToast(`业绩表生成失败：${error.message}`, true); }
  }

  async function importExcelFile(event, kind) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!Spreadsheet || !window.ExcelJS) return showToast("Excel 组件未加载，请重启应用后重试。", true);
    try {
      showToast("正在读取 Excel 文件…");
      const workbook = new window.ExcelJS.Workbook();
      await workbook.xlsx.load(await file.arrayBuffer());
      const parsed = kind === "schedule" ? Spreadsheet.parseScheduleTemplateWorkbook(workbook, state) : Spreadsheet.parsePerformanceWorkbook(workbook, state);
      pendingExcelImport = { kind, fileName: file.name, parsed, preview: null };
      elements.excelImportMode.value = "merge";
      elements.excelImportMode.disabled = kind === "performance";
      renderExcelImportPreview();
      elements.excelImportDialog.showModal();
    } catch (error) { console.error(error); showToast(`Excel 导入失败：${error.message}`, true); }
  }

  function renderMessageList(container, items, className, emptyText) {
    container.replaceChildren();
    if (!items.length) { const text = document.createElement("span"); text.textContent = emptyText; container.appendChild(text); return; }
    items.forEach((item) => { const row = document.createElement("div"); row.className = className; row.textContent = item.message || item.code || "未知问题"; container.appendChild(row); });
  }

  function renderExcelImportPreview() {
    if (!pendingExcelImport) return;
    const mode = elements.excelImportMode.value;
    const preview = pendingExcelImport.kind === "schedule" ? Spreadsheet.prepareScheduleImport(state, pendingExcelImport.parsed, mode) : Spreadsheet.preparePerformanceImport(state, pendingExcelImport.parsed);
    pendingExcelImport.preview = preview;
    elements.excelImportTitle.textContent = pendingExcelImport.kind === "schedule" ? "排班模板导入预览" : "业绩表导入预览";
    elements.excelImportFileName.textContent = pendingExcelImport.fileName;
    elements.excelImportCounts.replaceChildren(...[["新增", preview.counts.added], ["更新", preview.counts.updated], ["跳过", preview.counts.skipped]].map(([label, value]) => { const box = document.createElement("div"); const strong = document.createElement("strong"); strong.textContent = value; const span = document.createElement("span"); span.textContent = label; box.append(strong, span); return box; }));
    renderMessageList(elements.excelImportErrors, preview.errors, "error", "无阻断错误");
    renderMessageList(elements.excelImportWarnings, preview.warnings, "warning", "无业务警告");
    elements.confirmExcelImportBtn.disabled = Boolean(preview.errors.length || !preview.nextState);
  }

  function confirmExcelImport() {
    const preview = pendingExcelImport?.preview;
    if (!preview?.nextState || preview.errors.length) return;
    state = preview.nextState;
    syncActiveShifts();
    saveState();
    renderAll();
    renderOverview();
    elements.excelImportDialog.close();
    showToast(`导入完成：新增 ${preview.counts.added}、更新 ${preview.counts.updated}、跳过 ${preview.counts.skipped}`);
  }

  function exportScheduleCsv() { if (!selectedRoomKey) return showToast("请先选择直播间。", true); const schedule = getRoomSchedule(false); const info = roomInfo(selectedRoomKey, schedule); const rows = [["日期", "星期", "班次", "班组类型", "直播间名称", "账号", "主播", "主播用工类型", "副播", "副播用工类型", "开始时间", "结束时间", "直播时长", "加班开始", "加班结束", "加班时长", "备注", "休假人员", "休假备注"]]; currentDates().forEach((date) => { const dateKey = Logic.toIsoDate(date); const day = schedule?.days?.[dateKey]; if (!day) return; let added = false; [...allShiftDefinitions(), ...legacyOvertimeShifts].forEach((shift) => { const slot = day[shift.key]; if (!slot || (!slot.hostId && !slot.coHostId && !slot.note)) return; const host = state.people.find((p) => p.id === slot.hostId); const coHost = state.people.find((p) => p.id === slot.coHostId); const slotRoom = state.rooms.find((r) => r.id === slot.roomId); rows.push([dateKey, weekdays[date.getDay()], slot.shiftLabelSnapshot || shift.label, slot.groupType === "partTime" ? "兼职" : "正式", slotRoom?.name || slot.roomNameSnapshot || info.name, slotRoom?.account || slot.roomAccountSnapshot || info.account, host?.name || slot.hostNameSnapshot || "", employmentLabel(host), coHost?.name || slot.coHostNameSnapshot || "", employmentLabel(coHost), slot.startTime || "", slot.endTime || "", shift.isOvertime ? "" : formatHours(Logic.durationHours(slot.startTime, slot.endTime)), shift.isOvertime ? slot.startTime || "" : slot.overtimeStartTime || "", shift.isOvertime ? slot.endTime || "" : slot.overtimeEndTime || "", formatHours(shift.isOvertime ? Logic.durationHours(slot.startTime, slot.endTime) : Logic.durationHours(slot.overtimeStartTime, slot.overtimeEndTime)), slot.note || "", leaveNames(day), day.leaveNote || ""]); added = true; }); if (!added && (day.leavePeople?.length || day.leaveNote)) rows.push([dateKey, weekdays[date.getDay()], "休假", "", info.name, info.account, "", "", "", "", "", "", "", "", "", "", "", leaveNames(day), day.leaveNote || ""]); }); downloadCsv(`排班-${info.name}-${selectedStart}-${selectedEnd}.csv`, rows); }

  function scheduleCellText(day, shift) {
    const slot = day?.[shift.key];
    if (!slot) return "未安排";
    const host = state.people.find((person) => person.id === slot.hostId)?.name || slot.hostNameSnapshot || "未安排";
    const coHost = state.people.find((person) => person.id === slot.coHostId)?.name || slot.coHostNameSnapshot || "未安排";
    const lines = [`主播：${host}`, `副播：${coHost}`];
    if (slot.startTime || slot.endTime) lines.push(`直播：${slot.startTime || "--:--"}–${slot.endTime || "--:--"}`);
    if (slot.overtimeStartTime || slot.overtimeEndTime) lines.push(`加班：${slot.overtimeStartTime || "--:--"}–${slot.overtimeEndTime || "--:--"}`);
    if (slot.note) lines.push(`备注：${slot.note}`);
    return lines.join("\n");
  }

  async function exportScheduleXlsx() {
    if (!selectedRoomKey) return showToast("请先在直播间管理中新增直播间。", true);
    if (!window.ExcelJS) return showToast("Excel 导出组件未加载，请刷新页面后重试。", true);
    const dates = currentDates();
    if (!dates.length) return showToast("当前日期区间无效。", true);
    const schedule = getRoomSchedule(false);
    const workbook = new window.ExcelJS.Workbook();
    workbook.creator = "直播排班工具";
    workbook.created = new Date();
    const worksheet = workbook.addWorksheet("排班表", { views: [{ state: "frozen", xSplit: 1, ySplit: 2 }] });
    const columnCount = dates.length + 1;
    worksheet.mergeCells(1, 1, 1, columnCount);
    const title = worksheet.getCell(1, 1);
    title.value = `直播排班表（${selectedStart} 至 ${selectedEnd}）`;
    title.font = { name: "微软雅黑", size: 16, bold: true, color: { argb: "FFFFFFFF" } };
    title.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF2F5597" } };
    title.alignment = { horizontal: "center", vertical: "middle" };
    worksheet.getRow(1).height = 30;
    const headers = ["班次 / 日期", ...dates.map((date) => `${weekdays[date.getDay()]}\n${date.getMonth() + 1}.${date.getDate()}`)];
    worksheet.addRow(headers);
    const headerRow = worksheet.getRow(2);
    headerRow.height = 34;
    headerRow.eachCell((cell) => {
      cell.font = { name: "微软雅黑", bold: true, color: { argb: "FF17365D" } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD9E7F5" } };
      cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    });
    displayShiftDefinitions().forEach((shift) => {
      const row = worksheet.addRow([shift.label, ...dates.map((date) => scheduleCellText(schedule?.days?.[Logic.toIsoDate(date)], shift))]);
      row.height = 88;
      row.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: shift.roomId && shift.roomId !== selectedRoomKey ? "FFFFF2CC" : "FFEAF2F8" } };
      row.getCell(1).font = { name: "微软雅黑", bold: true, color: { argb: "FF17365D" } };
      row.getCell(1).alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    });
    const leaveRow = worksheet.addRow(["休假人员", ...dates.map((date) => {
      const day = schedule?.days?.[Logic.toIsoDate(date)];
      const names = day ? leaveNames(day) : "";
      return [names ? `人员：${names}` : "无", day?.leaveNote ? `备注：${day.leaveNote}` : ""].filter(Boolean).join("\n");
    })]);
    leaveRow.height = 52;
    leaveRow.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFCE4D6" } };
    leaveRow.getCell(1).font = { name: "微软雅黑", bold: true, color: { argb: "FF843C0C" } };
    leaveRow.getCell(1).alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    worksheet.getColumn(1).width = 16;
    for (let index = 2; index <= columnCount; index += 1) worksheet.getColumn(index).width = 27;
    for (let rowIndex = 2; rowIndex <= worksheet.rowCount; rowIndex += 1) {
      for (let columnIndex = 1; columnIndex <= columnCount; columnIndex += 1) {
        const cell = worksheet.getCell(rowIndex, columnIndex);
        cell.border = { top: { style: "thin", color: { argb: "FFB4C6E7" } }, left: { style: "thin", color: { argb: "FFB4C6E7" } }, bottom: { style: "thin", color: { argb: "FFB4C6E7" } }, right: { style: "thin", color: { argb: "FFB4C6E7" } } };
        if (rowIndex > 2 && columnIndex > 1) { cell.font = { name: "微软雅黑", size: 10, color: { argb: "FF1F2937" } }; cell.alignment = { vertical: "top", wrapText: true }; }
      }
    }
    worksheet.pageSetup = { orientation: "landscape", paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.25, right: 0.25, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 } };
    worksheet.pageSetup.printArea = `A1:${worksheet.getColumn(columnCount).letter}${worksheet.rowCount}`;
    worksheet.headerFooter.oddFooter = "第 &P / &N 页";
    showToast("正在生成 Excel 排班表…");
    try {
      const buffer = await workbook.xlsx.writeBuffer();
      downloadFile(`排班表-${selectedStart}-${selectedEnd}.xlsx`, buffer, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      showToast("Excel 排班表已导出");
    } catch (error) {
      console.error(error);
      showToast("Excel 导出失败，请刷新页面后重试。", true);
    }
  }
  function exportStatsCsv() { if (!selectedRoomKey) return showToast("请先选择直播间。", true); const stats = Logic.calculateStatistics(selectedDaysObject(), state.people); downloadCsv(`时长统计-${roomInfo(selectedRoomKey, getRoomSchedule(false)).name}-${selectedStart}-${selectedEnd}.csv`, [["人员", "直播时长", "加班时长", "总时长"], ...stats.rows.map((row) => [row.name, formatHours(row.liveHours), formatHours(row.overtimeHours), formatHours(row.totalHours)])]); }
  function leaveNames(day) { return (day.leavePeople || []).map((item) => state.people.find((p) => p.id === item.personId)?.name || item.personNameSnapshot).join("、"); }
  function employmentLabel(person) { return person ? (person.employmentType === "partTime" ? "兼职" : "正式员工") : ""; }
  function downloadCsv(name, rows) { downloadFile(name, `\uFEFF${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}`, "text/csv;charset=utf-8"); showToast("CSV 已导出"); }
  function csvCell(value) { return `"${String(value ?? "").replace(/"/g, '""')}"`; }
  function downloadFile(name, content, type) { const url = URL.createObjectURL(new Blob([content], { type })); const link = document.createElement("a"); link.href = url; link.download = name; document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url); }
  function statusBadge(active) { const badge = document.createElement("span"); badge.className = `status-badge${active ? "" : " inactive"}`; badge.textContent = active ? "启用" : "停用"; return badge; }
  function textCell(value) { const cell = document.createElement("td"); cell.textContent = value; return cell; }
  function actionButton(label, handler, extraClass = "", disabled = false) { const button = document.createElement("button"); button.type = "button"; button.className = `button small ${extraClass}`.trim(); button.textContent = label; button.disabled = disabled; button.addEventListener("click", handler); return button; }
  function formatHours(value) { return Number.isInteger(value) ? String(value) : Number(value.toFixed(2)).toString(); }
  function formatCurrency(value) { return new Intl.NumberFormat("zh-CN", { style: "currency", currency: "CNY", minimumFractionDigits: 2 }).format(value || 0); }
  function formatShortDate(value) { const date = value instanceof Date ? value : Logic.parseLocalDate(value); return date ? `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, "0")}/${String(date.getDate()).padStart(2, "0")}` : "未选择"; }
  function formatFullDate(date) { return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`; }
  function todayStamp() { return Logic.toIsoDate(new Date()); }
  function showToast(message, error = false) { if (!elements.toast) return; clearTimeout(toastTimer); elements.toast.textContent = message; elements.toast.className = `toast show${error ? " error" : ""}`; toastTimer = setTimeout(() => { elements.toast.className = "toast"; }, 2800); }
})();
