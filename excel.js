(function (root, factory) {
  const api = factory(typeof module === "object" && module.exports ? require("./logic.js") : root.ScheduleLogic);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.ScheduleExcel = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (Logic) {
  "use strict";

  const TEMPLATE_VERSION = 1;

  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function byId(a, b) { return String(a.id || a.key).localeCompare(String(b.id || b.key)); }

  function stableStringify(value) {
    if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
    if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
    return JSON.stringify(value);
  }

  function hashText(text) {
    let hash = 2166136261;
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return `v${TEMPLATE_VERSION}-${(hash >>> 0).toString(16).padStart(8, "0")}`;
  }

  function activeConfiguration(state) {
    const groups = (state?.settings?.formalGroups || []).filter((item) => item && item.active !== false).map((item) => ({ id: item.id, name: item.name, hostId: item.hostId, coHostId: item.coHostId, defaultShiftId: item.defaultShiftId })).sort(byId);
    const partTime = state?.settings?.partTimeGroup;
    if (partTime?.hostId && partTime?.coHostId) groups.push({ id: partTime.id || "part-time-group", name: partTime.name || "固定兼职班组", hostId: partTime.hostId, coHostId: partTime.coHostId, defaultShiftId: partTime.defaultShiftId || "" });
    return {
      people: (state?.people || []).filter((item) => item && item.active !== false).map((item) => ({ id: item.id, name: item.name, canHost: Boolean(item.canHost), canCoHost: Boolean(item.canCoHost) })).sort(byId),
      rooms: (state?.rooms || []).filter((item) => item && item.active !== false).map((item) => ({ id: item.id, name: item.name, account: item.account })).sort(byId),
      shifts: (state?.settings?.shiftDefinitions || []).filter((item) => item && item.active !== false && !item.deleted).map((item) => ({ id: item.key, name: item.label, roomId: item.roomId, startTime: item.startTime, endTime: item.endTime })).sort(byId),
      groups: groups.sort(byId)
    };
  }

  function configurationFingerprint(state) { return hashText(stableStringify(activeConfiguration(state))); }
  function personName(state, id) { return (state.people || []).find((item) => item.id === id)?.name || ""; }

  function findGroupSlot(state, group, dateKey) {
    const candidates = [];
    Object.entries(state.schedules || {}).forEach(([scheduleRoomId, schedule]) => {
      const day = schedule?.days?.[dateKey];
      Object.entries(day || {}).forEach(([shiftId, slot]) => {
        if (!slot || typeof slot !== "object" || (!slot.hostId && !slot.coHostId)) return;
        if (slot.templateGroupId === group.id || (!slot.templateGroupId && slot.hostId === group.hostId && slot.coHostId === group.coHostId)) candidates.push({ shiftId, scheduleRoomId, slot });
      });
    });
    return candidates[0] || null;
  }

  function dayModel(state, group, dateKey, prefill) {
    if (!prefill) return { shiftId: "", hostStatus: "", coHostStatus: "", roomId: "", liveTime: "", overtimeTime: "", attendanceTime: "", note: "" };
    const found = findGroupSlot(state, group, dateKey);
    if (!found) return { shiftId: "", hostStatus: "", coHostStatus: "", roomId: "", liveTime: "", overtimeTime: "", attendanceTime: "", note: "" };
    const slot = found.slot;
    const attendance = Logic.attendanceWindowForTime(slot.startTime);
    return {
      shiftId: found.shiftId,
      hostStatus: "正常",
      coHostStatus: "正常",
      roomId: slot.roomId || found.scheduleRoomId,
      liveTime: slot.startTime && slot.endTime ? `${slot.startTime}-${slot.endTime}` : "",
      overtimeTime: slot.overtimeStartTime && slot.overtimeEndTime ? `${slot.overtimeStartTime}-${slot.overtimeEndTime}` : "",
      attendanceTime: attendance ? `${attendance.start}-${attendance.end}` : "",
      note: slot.note || ""
    };
  }

  function buildScheduleTemplateModel(state, startDate, endDate, prefill = false) {
    const dates = Logic.dateRange(startDate, endDate, 14).map(Logic.toIsoDate);
    if (!dates.length) throw new Error("日期区间必须为 1 至 14 天");
    const config = activeConfiguration(state);
    const groups = config.groups.map((group) => ({
      ...clone(group),
      hostName: personName(state, group.hostId),
      coHostName: personName(state, group.coHostId),
      days: Object.fromEntries(dates.map((dateKey) => [dateKey, dayModel(state, group, dateKey, prefill)]))
    }));
    return { templateVersion: TEMPLATE_VERSION, fingerprint: configurationFingerprint(state), startDate, endDate, dates, rooms: clone(config.rooms), shifts: clone(config.shifts), groups };
  }

  function dateLabel(dateKey) {
    const date = Logic.parseLocalDate(dateKey);
    const weekdays = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
    return `${weekdays[date.getDay()]}\n${date.getMonth() + 1}.${date.getDate()}`;
  }

  function attendanceFormula(roomCells) {
    const picked = roomCells.reduceRight((fallback, address) => `IF(${address}<>"",${address},${fallback})`, '""');
    return `IF(${picked}="","",IF(TIMEVALUE(LEFT(${picked},5))<TIME(11,0,0),"08:00-16:00",IF(TIMEVALUE(LEFT(${picked},5))<TIME(16,0,0),"11:00-19:00","16:00-23:30")))`;
  }

  function sheetLayoutFingerprint(sheet) {
    const values = [];
    for (let column = 1; column <= sheet.columnCount; column += 1) values.push([sheet.getCell(2, column).address, cellText(sheet.getCell(2, column))]);
    for (let row = 3; row <= sheet.rowCount; row += 1) for (let column = 1; column <= 3; column += 1) values.push([sheet.getCell(row, column).address, cellText(sheet.getCell(row, column))]);
    return hashText(stableStringify(values));
  }

  async function createScheduleTemplateWorkbook(ExcelJS, state, startDate, endDate, prefill = false) {
    if (!ExcelJS?.Workbook) throw new Error("ExcelJS 不可用");
    const model = buildScheduleTemplateModel(state, startDate, endDate, prefill);
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "直播排班工具";
    workbook.created = new Date();
    const sheet = workbook.addWorksheet("排班填写表", { views: [{ state: "frozen", xSplit: 3, ySplit: 3 }] });
    const instructions = workbook.addWorksheet("填写说明");
    const config = workbook.addWorksheet("模板配置", { state: "hidden" });
    const options = workbook.addWorksheet("可选项", { state: "hidden" });
    config.state = "hidden";
    options.state = "hidden";

    const firstDateColumn = 4;
    const lastColumn = firstDateColumn + model.dates.length - 1;
    sheet.mergeCells(1, 1, 1, lastColumn);
    const title = sheet.getCell(1, 1);
    title.value = `直播排班填写表（${startDate} 至 ${endDate}）`;
    title.font = { name: "微软雅黑", size: 16, bold: true, color: { argb: "FFFFFFFF" } };
    title.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF2F5597" } };
    title.alignment = { horizontal: "center", vertical: "middle" };
    sheet.getRow(1).height = 30;
    sheet.getRow(2).values = ["班组", "项目", "人员 / 直播间", ...model.dates.map(dateLabel)];
    sheet.getRow(2).height = 36;
    sheet.getRow(2).eachCell((cell) => {
      cell.font = { name: "微软雅黑", bold: true, color: { argb: "FF17365D" } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD9E7F5" } };
      cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    });

    options.addRow(["班次", "人员状态"]);
    model.shifts.forEach((shift, index) => { options.getCell(index + 2, 1).value = shift.name; });
    ["本休", "调休", "未排班"].forEach((status, index) => { options.getCell(model.shifts.length + index + 2, 1).value = status; });
    ["正常", "本休", "调休"].forEach((status, index) => { options.getCell(index + 2, 2).value = status; });
    const shiftRange = `'可选项'!$A$2:$A$${model.shifts.length + 4}`;
    const statusRange = "'可选项'!$B$2:$B$4";
    const mappingRows = [];
    let rowIndex = 3;
    model.groups.forEach((group, groupIndex) => {
      const rows = {
        attendance: rowIndex,
        shift: rowIndex + 1,
        hostStatus: rowIndex + 2,
        coHostStatus: rowIndex + 3,
        rooms: model.rooms.map((_room, index) => rowIndex + 4 + index),
        overtime: rowIndex + 4 + model.rooms.length,
        note: rowIndex + 5 + model.rooms.length
      };
      const endRow = rows.note;
      sheet.mergeCells(rowIndex, 1, endRow, 1);
      const groupCell = sheet.getCell(rowIndex, 1);
      groupCell.value = group.name;
      groupCell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
      groupCell.font = { name: "微软雅黑", bold: true, color: { argb: "FF17365D" } };
      groupCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: groupIndex % 2 ? "FFE2F0D9" : "FFEAF2F8" } };
      sheet.getCell(rows.attendance, 2).value = "班组出勤时间";
      sheet.getCell(rows.shift, 2).value = "班次";
      sheet.getCell(rows.hostStatus, 2).value = "主播状态";
      sheet.getCell(rows.coHostStatus, 2).value = "副播状态";
      sheet.getCell(rows.hostStatus, 3).value = group.hostName;
      sheet.getCell(rows.coHostStatus, 3).value = group.coHostName;
      model.rooms.forEach((room, index) => {
        sheet.getCell(rows.rooms[index], 2).value = "直播时间";
        sheet.getCell(rows.rooms[index], 3).value = `${room.name}${room.account ? `（${room.account}）` : ""}`;
      });
      sheet.getCell(rows.overtime, 2).value = "加班时间";
      sheet.getCell(rows.note, 2).value = "备注";

      model.dates.forEach((dateKey, dateIndex) => {
        const column = firstDateColumn + dateIndex;
        const day = group.days[dateKey];
        const roomCells = rows.rooms.map((roomRow) => sheet.getCell(roomRow, column).address);
        sheet.getCell(rows.attendance, column).value = { formula: attendanceFormula(roomCells), result: day.attendanceTime || "" };
        const shiftCell = sheet.getCell(rows.shift, column);
        shiftCell.value = model.shifts.find((item) => item.id === day.shiftId)?.name || "";
        shiftCell.dataValidation = { type: "list", allowBlank: true, formulae: [shiftRange] };
        const hostCell = sheet.getCell(rows.hostStatus, column);
        hostCell.value = day.hostStatus;
        hostCell.dataValidation = { type: "list", allowBlank: true, formulae: [statusRange] };
        const coHostCell = sheet.getCell(rows.coHostStatus, column);
        coHostCell.value = day.coHostStatus;
        coHostCell.dataValidation = { type: "list", allowBlank: true, formulae: [statusRange] };
        mappingRows.push([shiftCell.address, dateKey, group.id, "shift", "", ""]);
        mappingRows.push([hostCell.address, dateKey, group.id, "hostStatus", "", group.hostId]);
        mappingRows.push([coHostCell.address, dateKey, group.id, "coHostStatus", "", group.coHostId]);
        model.rooms.forEach((room, roomIndex) => {
          const cell = sheet.getCell(rows.rooms[roomIndex], column);
          cell.value = day.roomId === room.id ? day.liveTime : "";
          mappingRows.push([cell.address, dateKey, group.id, "liveTime", room.id, ""]);
        });
        const overtimeCell = sheet.getCell(rows.overtime, column);
        overtimeCell.value = day.overtimeTime;
        mappingRows.push([overtimeCell.address, dateKey, group.id, "overtimeTime", day.roomId || "", ""]);
        const noteCell = sheet.getCell(rows.note, column);
        noteCell.value = day.note;
        mappingRows.push([noteCell.address, dateKey, group.id, "note", "", ""]);
        [shiftCell, hostCell, coHostCell, ...rows.rooms.map((roomRow) => sheet.getCell(roomRow, column)), overtimeCell, noteCell].forEach((cell) => {
          cell.protection = { locked: false };
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFFDF2" } };
        });
      });
      for (let row = rowIndex; row <= endRow; row += 1) {
        sheet.getRow(row).height = row === rows.note ? 34 : 24;
        for (let column = 1; column <= lastColumn; column += 1) {
          const cell = sheet.getCell(row, column);
          cell.font = cell.font || { name: "微软雅黑", size: 10 };
          cell.alignment = { vertical: "middle", wrapText: true, ...(cell.alignment || {}) };
          cell.border = { top: { style: "thin", color: { argb: "FFB4C6E7" } }, left: { style: "thin", color: { argb: "FFB4C6E7" } }, bottom: { style: "thin", color: { argb: "FFB4C6E7" } }, right: { style: "thin", color: { argb: "FFB4C6E7" } } };
        }
      }
      rowIndex = endRow + 1;
    });

    sheet.getColumn(1).width = 14;
    sheet.getColumn(2).width = 16;
    sheet.getColumn(3).width = 24;
    for (let column = firstDateColumn; column <= lastColumn; column += 1) sheet.getColumn(column).width = 18;
    sheet.autoFilter = { from: { row: 2, column: 1 }, to: { row: 2, column: lastColumn } };
    await sheet.protect("", { selectLockedCells: true, selectUnlockedCells: true });

    instructions.addRows([
      ["直播排班模板填写说明"],
      ["1. 黄色单元格可以填写，系统字段请勿移动或改名。"],
      ["2. 时间格式为 HH:MM-HH:MM；同一班组同一天只能填写一个直播间。"],
      ["3. 本休、调休或未排班时不得填写直播与加班时间。"],
      ["4. 导入前软件会重新校验出勤时间、人员冲突和模板配置。"]
    ]);
    instructions.getColumn(1).width = 90;
    instructions.getCell("A1").font = { name: "微软雅黑", size: 15, bold: true };

    config.addRow(["templateType", "schedule"]);
    config.addRow(["templateVersion", TEMPLATE_VERSION]);
    config.addRow(["fingerprint", model.fingerprint]);
    config.addRow(["startDate", startDate]);
    config.addRow(["endDate", endDate]);
    config.addRow(["layoutFingerprint", sheetLayoutFingerprint(sheet)]);
    config.addRow(["cell", "date", "groupId", "field", "roomId", "personId"]);
    mappingRows.forEach((row) => config.addRow(row));
    return workbook;
  }

  function cellText(cell) {
    const value = cell?.value;
    if (value === null || value === undefined) return "";
    if (typeof value === "object") return String(value.result ?? value.text ?? "").trim();
    return String(value).trim();
  }

  function parseTimeRange(value) {
    const match = /^(\d{2}:\d{2})\s*[-–—]\s*(\d{2}:\d{2})$/.exec(String(value || "").trim());
    if (!match) return null;
    return { start: match[1], end: match[2] };
  }

  function parseScheduleTemplateWorkbook(workbook, state) {
    const errors = [];
    const warnings = [];
    const sheet = workbook?.getWorksheet?.("排班填写表");
    const config = workbook?.getWorksheet?.("模板配置");
    if (!sheet || !config) return { entries: [], errors: [{ code: "missing-sheet", message: "缺少排班填写表或模板配置" }], warnings };
    const metadata = new Map();
    for (let row = 1; row <= 6; row += 1) metadata.set(cellText(config.getCell(row, 1)), cellText(config.getCell(row, 2)));
    if (metadata.get("templateType") !== "schedule") errors.push({ code: "wrong-template", message: "不是排班模板" });
    if (Number(metadata.get("templateVersion")) !== TEMPLATE_VERSION) errors.push({ code: "version-mismatch", message: "模板版本不兼容" });
    if (metadata.get("fingerprint") !== configurationFingerprint(state)) errors.push({ code: "configuration-changed", message: "班组、人员、班次或直播间配置已变化" });
    if (metadata.get("layoutFingerprint") !== sheetLayoutFingerprint(sheet)) errors.push({ code: "layout-changed", message: "日期、班组、人员或直播间等系统字段已被修改" });
    const configById = activeConfiguration(state);
    const groups = new Map(configById.groups.map((item) => [item.id, item]));
    const shiftsByName = new Map(configById.shifts.map((item) => [item.name, item]));
    const rooms = new Map(configById.rooms.map((item) => [item.id, item]));
    const buckets = new Map();
    const mappingKeys = new Set();
    for (let row = 8; row <= config.rowCount; row += 1) {
      const address = cellText(config.getCell(row, 1));
      const dateKey = cellText(config.getCell(row, 2));
      const groupId = cellText(config.getCell(row, 3));
      const field = cellText(config.getCell(row, 4));
      const roomId = cellText(config.getCell(row, 5));
      const personId = cellText(config.getCell(row, 6));
      if (!address && !dateKey && !groupId && !field) continue;
      if (!address || !Logic.parseLocalDate(dateKey) || !groups.has(groupId) || !field || !sheet.getCell(address)) {
        errors.push({ code: "invalid-mapping", cell: address, message: `模板映射无效：${address || `第${row}行`}` });
        continue;
      }
      const key = `${dateKey}:${groupId}`;
      const mappingKey = `${dateKey}:${groupId}:${field}:${roomId}:${personId}`;
      if (mappingKeys.has(mappingKey)) { errors.push({ code: "duplicate-mapping", cell: address, message: `模板映射重复：${address}` }); continue; }
      mappingKeys.add(mappingKey);
      if (!buckets.has(key)) buckets.set(key, { dateKey, groupId, group: groups.get(groupId), liveRanges: [] });
      const bucket = buckets.get(key);
      const value = cellText(sheet.getCell(address));
      if (field === "liveTime" && value) bucket.liveRanges.push({ roomId, value, cell: address });
      else if (field === "hostStatus") { bucket.hostStatus = value; bucket.hostId = personId; }
      else if (field === "coHostStatus") { bucket.coHostStatus = value; bucket.coHostId = personId; }
      else bucket[field] = value;
    }

    const entries = [];
    const restValues = new Set(["本休", "调休"]);
    buckets.forEach((bucket) => {
      if (bucket.liveRanges.length > 1) errors.push({ code: "multiple-rooms", dateKey: bucket.dateKey, groupId: bucket.groupId, message: `${bucket.dateKey} ${bucket.group.name} 同时填写了多个直播间` });
      const live = bucket.liveRanges[0];
      const shiftIsRest = ["本休", "调休", "未排班"].includes(bucket.shift);
      if ((shiftIsRest || restValues.has(bucket.hostStatus) || restValues.has(bucket.coHostStatus)) && (live || bucket.overtimeTime)) {
        errors.push({ code: "leave-live-conflict", dateKey: bucket.dateKey, groupId: bucket.groupId, message: `${bucket.dateKey} ${bucket.group.name} 休假状态与直播时间冲突` });
      }
      const shift = bucket.shift ? shiftsByName.get(bucket.shift) : null;
      if (bucket.shift && !shift && !shiftIsRest) errors.push({ code: "unknown-shift", dateKey: bucket.dateKey, groupId: bucket.groupId, message: `不存在班次：${bucket.shift}` });
      let range = null;
      let attendanceTime = "";
      if (live) {
        if (!rooms.has(live.roomId)) errors.push({ code: "unknown-room", message: `不存在直播间：${live.roomId}` });
        range = parseTimeRange(live.value);
        if (!range) errors.push({ code: "invalid-live-time", cell: live.cell, message: `直播时间格式无效：${live.value}` });
        else {
          const validation = Logic.validateLiveTimeRange(range.start, range.end);
          if (!validation.valid) errors.push({ code: validation.code, cell: live.cell, message: `直播时间不在允许的出勤区间：${live.value}` });
          else attendanceTime = `${validation.attendance.start}-${validation.attendance.end}`;
        }
      }
      const overtime = bucket.overtimeTime ? parseTimeRange(bucket.overtimeTime) : null;
      if (bucket.overtimeTime && (!overtime || Logic.timeToMinutes(overtime.end) <= Logic.timeToMinutes(overtime.start))) errors.push({ code: "invalid-overtime", message: `加班时间无效：${bucket.overtimeTime}` });
      if (bucket.shift || live || bucket.overtimeTime || bucket.note || bucket.hostStatus || bucket.coHostStatus) entries.push({
        dateKey: bucket.dateKey, groupId: bucket.groupId, shiftId: shift?.id || "", shiftStatus: shiftIsRest ? bucket.shift : "", hostId: bucket.hostId || bucket.group.hostId, coHostId: bucket.coHostId || bucket.group.coHostId, hostStatus: bucket.hostStatus || "", coHostStatus: bucket.coHostStatus || "", roomId: live?.roomId || "", startTime: range?.start || "", endTime: range?.end || "", overtimeStartTime: overtime?.start || "", overtimeEndTime: overtime?.end || "", attendanceTime, note: bucket.note || ""
      });
    });
    return { entries, errors, warnings, metadata: Object.fromEntries(metadata) };
  }

  function locateGroupSlot(state, entry) {
    for (const [rootId, schedule] of Object.entries(state.schedules || {})) {
      const day = schedule?.days?.[entry.dateKey];
      for (const [shiftId, slot] of Object.entries(day || {})) {
        if (!slot || typeof slot !== "object") continue;
        if (slot.templateGroupId === entry.groupId || (!slot.templateGroupId && slot.hostId === entry.hostId && slot.coHostId === entry.coHostId)) return { rootId, schedule, day, shiftId, slot };
      }
    }
    return null;
  }

  function ensureImportDay(state, rootId, dateKey) {
    if (!state.schedules) state.schedules = {};
    if (!state.schedules[rootId]) {
      const room = (state.rooms || []).find((item) => item.id === rootId);
      state.schedules[rootId] = { roomId: rootId, roomNameSnapshot: room?.name || "", roomAccountSnapshot: room?.account || "", days: {} };
    }
    if (!state.schedules[rootId].days) state.schedules[rootId].days = {};
    if (!state.schedules[rootId].days[dateKey]) state.schedules[rootId].days[dateKey] = { leavePeople: [], leaveNote: "" };
    const day = state.schedules[rootId].days[dateKey];
    if (!Array.isArray(day.leavePeople)) day.leavePeople = [];
    return day;
  }

  function updateLeaveStatus(day, state, personId, status) {
    if (!personId || !status) return false;
    const index = day.leavePeople.findIndex((item) => item.personId === personId);
    if (status === "正常") {
      if (index < 0) return false;
      day.leavePeople.splice(index, 1);
      return true;
    }
    if (status !== "本休" && status !== "调休") return false;
    const person = (state.people || []).find((item) => item.id === personId);
    const next = { personId, personNameSnapshot: person?.name || "", status };
    if (index >= 0 && day.leavePeople[index].status === status) return false;
    if (index >= 0) day.leavePeople[index] = next;
    else day.leavePeople.push(next);
    return true;
  }

  function prepareScheduleImport(state, parsed, mode = "merge") {
    const counts = { added: 0, updated: 0, skipped: 0 };
    const errors = [...(parsed?.errors || [])];
    const warnings = [...(parsed?.warnings || [])];
    if (errors.length) return { nextState: null, counts, errors, warnings, changes: [] };
    const nextState = clone(state);
    const shifts = new Map(activeConfiguration(nextState).shifts.map((item) => [item.id, item]));
    const groups = new Map(activeConfiguration(nextState).groups.map((item) => [item.id, item]));
    const defaultRootId = nextState.settings?.lastRoomKey || (nextState.rooms || []).find((item) => item.active !== false)?.id || Object.keys(nextState.schedules || {})[0] || "unassigned";
    const changes = [];
    (parsed.entries || []).forEach((entry) => {
      const group = groups.get(entry.groupId);
      const shift = shifts.get(entry.shiftId);
      if (!group) { errors.push({ code: "unknown-group", message: `不存在班组：${entry.groupId}` }); return; }
      const existing = locateGroupSlot(nextState, entry);
      const rootId = existing?.rootId || defaultRootId;
      const day = ensureImportDay(nextState, rootId, entry.dateKey);
      let changed = updateLeaveStatus(day, nextState, entry.hostId || group.hostId, entry.hostStatus);
      changed = updateLeaveStatus(day, nextState, entry.coHostId || group.coHostId, entry.coHostStatus) || changed;
      const rest = entry.shiftStatus || [entry.hostStatus, entry.coHostStatus].some((value) => value === "本休" || value === "调休");
      if (rest || (mode === "replace" && !entry.startTime && !entry.endTime)) {
        if (existing) { delete existing.day[existing.shiftId]; changed = true; }
        counts[changed ? "updated" : "skipped"] += 1;
        if (changed) changes.push({ type: "updated", dateKey: entry.dateKey, groupId: entry.groupId });
        return;
      }
      if (!entry.startTime || !entry.endTime || !entry.shiftId) {
        counts[changed ? "updated" : "skipped"] += 1;
        if (changed) changes.push({ type: "updated", dateKey: entry.dateKey, groupId: entry.groupId });
        return;
      }
      const host = (nextState.people || []).find((item) => item.id === (entry.hostId || group.hostId));
      const coHost = (nextState.people || []).find((item) => item.id === (entry.coHostId || group.coHostId));
      const room = (nextState.rooms || []).find((item) => item.id === entry.roomId);
      const base = existing ? clone(existing.slot) : {};
      const assign = (key, value) => { if (mode === "replace" || value !== "") base[key] = value; };
      assign("startTime", entry.startTime || "");
      assign("endTime", entry.endTime || "");
      assign("overtimeStartTime", entry.overtimeStartTime || "");
      assign("overtimeEndTime", entry.overtimeEndTime || "");
      assign("note", entry.note || "");
      Object.assign(base, { templateGroupId: entry.groupId, shiftLabelSnapshot: shift?.name || "", hostId: entry.hostId || group.hostId, coHostId: entry.coHostId || group.coHostId, hostNameSnapshot: host?.name || "", coHostNameSnapshot: coHost?.name || "", roomId: entry.roomId, roomNameSnapshot: room?.name || "", roomAccountSnapshot: room?.account || "" });
      const before = existing ? JSON.stringify(existing.slot) : "";
      if (existing && (existing.shiftId !== entry.shiftId || existing.day !== day)) delete existing.day[existing.shiftId];
      day[entry.shiftId] = base;
      const type = existing ? (before === JSON.stringify(base) && !changed ? "skipped" : "updated") : "added";
      counts[type] += 1;
      if (type !== "skipped") changes.push({ type, dateKey: entry.dateKey, groupId: entry.groupId, shiftId: entry.shiftId });
    });
    if (errors.length) return { nextState: null, counts: { added: 0, updated: 0, skipped: 0 }, errors, warnings, changes: [] };
    Object.values(nextState.schedules || {}).forEach((schedule) => {
      Logic.findConflicts(schedule?.days || {}, nextState.people || []).forEach((conflict) => warnings.push({ code: conflict.type, dateKey: conflict.dayKey, message: `${conflict.dayKey} 存在排班冲突` }));
    });
    return { nextState, counts, errors, warnings, changes };
  }

  function performanceRecords(state, startDate, endDate) {
    const shifts = new Map((state.settings?.shiftDefinitions || []).map((item) => [item.key, item]));
    const people = new Map((state.people || []).map((item) => [item.id, item]));
    const rooms = new Map((state.rooms || []).map((item) => [item.id, item]));
    const records = [];
    Object.entries(state.schedules || {}).forEach(([rootId, schedule]) => {
      Object.entries(schedule?.days || {}).forEach(([dateKey, day]) => {
        if ((startDate && dateKey < startDate) || (endDate && dateKey > endDate)) return;
        Object.entries(day || {}).forEach(([shiftId, slot]) => {
          if (!slot || typeof slot !== "object" || !slot.hostId || !slot.coHostId || !slot.startTime || !slot.endTime) return;
          const room = rooms.get(slot.roomId || rootId);
          records.push({ id: `${rootId}|${dateKey}|${shiftId}`, rootId, dateKey, shiftId, roomName: room?.name || slot.roomNameSnapshot || "", roomAccount: room?.account || slot.roomAccountSnapshot || "", shiftName: shifts.get(shiftId)?.label || slot.shiftLabelSnapshot || shiftId, hostName: people.get(slot.hostId)?.name || slot.hostNameSnapshot || "", coHostName: people.get(slot.coHostId)?.name || slot.coHostNameSnapshot || "", amount: typeof slot.performanceAmount === "number" ? slot.performanceAmount : null });
        });
      });
    });
    return records.sort((a, b) => a.dateKey.localeCompare(b.dateKey) || a.shiftName.localeCompare(b.shiftName));
  }

  function createPerformanceWorkbook(ExcelJS, state, startDate = "", endDate = "") {
    if (!ExcelJS?.Workbook) throw new Error("ExcelJS 不可用");
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "直播排班工具";
    const instructions = workbook.addWorksheet("填写说明");
    const sheet = workbook.addWorksheet("业绩数据", { views: [{ state: "frozen", ySplit: 1 }] });
    const options = workbook.addWorksheet("可选项", { state: "hidden" });
    options.state = "hidden";
    instructions.addRows([["业绩表填写说明"], ["只填写或修改业绩金额；主播、副播及排班信息用于核对，不会被业绩导入修改。"], ["金额必须为非负数，最多两位小数。"]]);
    instructions.getColumn(1).width = 100;
    instructions.getCell("A1").font = { name: "微软雅黑", size: 15, bold: true };
    sheet.addRow(["日期", "直播间名称", "直播间账号", "班次", "主播", "副播", "业绩金额", "系统记录标识"]);
    const header = sheet.getRow(1);
    header.eachCell((cell) => { cell.font = { name: "微软雅黑", bold: true, color: { argb: "FFFFFFFF" } }; cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF2F5597" } }; cell.alignment = { horizontal: "center", vertical: "middle" }; });
    performanceRecords(state, startDate, endDate).forEach((record) => {
      const row = sheet.addRow([record.dateKey, record.roomName, record.roomAccount, record.shiftName, record.hostName, record.coHostName, record.amount, record.id]);
      row.getCell(7).numFmt = '¥#,##0.00';
      row.getCell(7).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFFDF2" } };
    });
    [14, 18, 18, 18, 16, 16, 16, 24].forEach((width, index) => { sheet.getColumn(index + 1).width = width; });
    sheet.getColumn(8).hidden = true;
    options.addRow(["templateType", "performance"]);
    options.addRow(["templateVersion", TEMPLATE_VERSION]);
    options.addRow(["fingerprint", configurationFingerprint(state)]);
    return workbook;
  }

  function locatePerformanceRecord(state, id) {
    const [rootId, dateKey, shiftId] = String(id || "").split("|");
    const slot = state.schedules?.[rootId]?.days?.[dateKey]?.[shiftId];
    return slot ? { rootId, dateKey, shiftId, slot } : null;
  }

  function parsePerformanceWorkbook(workbook, state) {
    const errors = [];
    const sheet = workbook?.getWorksheet?.("业绩数据");
    const options = workbook?.getWorksheet?.("可选项");
    if (!sheet || !options) return { entries: [], errors: [{ code: "missing-sheet", message: "缺少业绩数据或可选项" }], warnings: [] };
    if (cellText(options.getCell("B1")) !== "performance") errors.push({ code: "wrong-template", message: "不是业绩模板" });
    if (Number(cellText(options.getCell("B2"))) !== TEMPLATE_VERSION) errors.push({ code: "version-mismatch", message: "模板版本不兼容" });
    if (cellText(options.getCell("B3")) !== configurationFingerprint(state)) errors.push({ code: "configuration-changed", message: "当前配置已变化" });
    const entries = [];
    for (let row = 2; row <= sheet.rowCount; row += 1) {
      const id = cellText(sheet.getCell(row, 8));
      const amountText = cellText(sheet.getCell(row, 7));
      if (!id && !amountText) continue;
      const found = locatePerformanceRecord(state, id);
      if (!found) { errors.push({ code: "unknown-record", row, message: `第 ${row} 行排班记录不存在` }); continue; }
      const hostName = cellText(sheet.getCell(row, 5));
      const coHostName = cellText(sheet.getCell(row, 6));
      const host = (state.people || []).find((item) => item.id === found.slot.hostId)?.name || found.slot.hostNameSnapshot || "";
      const coHost = (state.people || []).find((item) => item.id === found.slot.coHostId)?.name || found.slot.coHostNameSnapshot || "";
      if (hostName !== host || coHostName !== coHost) { errors.push({ code: "people-mismatch", row, message: `第 ${row} 行主播或副播与当前排班不一致` }); continue; }
      const parsed = Logic.parsePerformanceAmount(amountText);
      if (!parsed.valid) { errors.push({ code: "invalid-amount", row, message: `第 ${row} 行业绩金额无效` }); continue; }
      if (parsed.value !== null) entries.push({ id, amount: parsed.value });
    }
    return { entries, errors, warnings: [] };
  }

  function preparePerformanceImport(state, parsed) {
    const counts = { added: 0, updated: 0, skipped: 0 };
    const errors = [...(parsed?.errors || [])];
    if (errors.length) return { nextState: null, counts, errors, warnings: parsed?.warnings || [] };
    const nextState = clone(state);
    (parsed.entries || []).forEach((entry) => {
      const found = locatePerformanceRecord(nextState, entry.id);
      if (!found) { errors.push({ code: "unknown-record", message: `排班记录不存在：${entry.id}` }); return; }
      if (found.slot.performanceAmount === entry.amount) counts.skipped += 1;
      else { found.slot.performanceAmount = entry.amount; found.slot.performanceUpdatedAt = new Date().toISOString(); counts.updated += 1; }
    });
    if (errors.length) return { nextState: null, counts: { added: 0, updated: 0, skipped: 0 }, errors, warnings: parsed?.warnings || [] };
    return { nextState, counts, errors, warnings: parsed?.warnings || [] };
  }

  function createDisplayScheduleWorkbook(ExcelJS, state, startDate, endDate) {
    if (!ExcelJS?.Workbook) throw new Error("ExcelJS 不可用");
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "直播排班工具";
    const sheet = workbook.addWorksheet("展示版排班表", { views: [{ state: "frozen", ySplit: 3 }] });
    sheet.mergeCells("A1:G1");
    sheet.getCell("A1").value = `直播排班表（${startDate} 至 ${endDate}）`;
    sheet.getCell("A1").font = { name: "微软雅黑", size: 16, bold: true, color: { argb: "FFFFFFFF" } };
    sheet.getCell("A1").fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF2F5597" } };
    sheet.getCell("A1").alignment = { horizontal: "center", vertical: "middle" };
    sheet.mergeCells("A2:G2");
    sheet.getCell("A2").value = "出勤时间由直播时间自动计算";
    sheet.getCell("A2").alignment = { horizontal: "center" };
    sheet.getCell("A2").font = { name: "微软雅黑", color: { argb: "FF405069" } };
    sheet.addRow(["日期", "账号", "班次", "班组", "直播时间", "出勤时间", "直播时长"]);
    sheet.getRow(3).eachCell((cell) => { cell.font = { name: "微软雅黑", bold: true, color: { argb: "FFFFFFFF" } }; cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF4472C4" } }; cell.alignment = { horizontal: "center", vertical: "middle" }; });

    const shiftMap = new Map((state.settings?.shiftDefinitions || []).map((item) => [item.key, item]));
    const peopleMap = new Map((state.people || []).map((item) => [item.id, item]));
    const roomMap = new Map((state.rooms || []).map((item) => [item.id, item]));
    const dateRows = new Map();
    Object.entries(state.schedules || {}).forEach(([rootId, schedule]) => {
      Object.entries(schedule?.days || {}).forEach(([dateKey, day]) => {
        if (dateKey < startDate || dateKey > endDate) return;
        if (!dateRows.has(dateKey)) dateRows.set(dateKey, []);
        const rows = dateRows.get(dateKey);
        Object.entries(day || {}).forEach(([shiftId, slot]) => {
          if (!slot || typeof slot !== "object" || !slot.startTime || !slot.endTime || (!slot.hostId && !slot.coHostId)) return;
          const room = roomMap.get(slot.roomId || rootId);
          const host = peopleMap.get(slot.hostId)?.name || slot.hostNameSnapshot || "";
          const coHost = peopleMap.get(slot.coHostId)?.name || slot.coHostNameSnapshot || "";
          const attendance = Logic.attendanceWindowForTime(slot.startTime);
          const hasOvertime = Boolean(slot.overtimeStartTime && slot.overtimeEndTime);
          const overtimeHours = hasOvertime ? Logic.durationHours(slot.overtimeStartTime, slot.overtimeEndTime) : 0;
          const totalHours = Math.round((Logic.durationHours(slot.startTime, slot.endTime) + overtimeHours) * 100) / 100;
          const overtimeText = hasOvertime ? `；加班${slot.overtimeStartTime}-${slot.overtimeEndTime}` : "";
          rows.push({ type: "schedule", account: room?.account || slot.roomAccountSnapshot || "", shift: shiftMap.get(shiftId)?.label || slot.shiftLabelSnapshot || shiftId, group: [host, coHost].filter(Boolean).join("&"), liveTime: `${slot.startTime}-${slot.endTime}${overtimeText}`, attendance: attendance ? `${attendance.start}-${attendance.end}` : "", duration: `${totalHours}h`, order: Number(shiftMap.get(shiftId)?.order) || 999 });
        });
        const leaveNames = (day.leavePeople || []).map((item) => peopleMap.get(item.personId)?.name || item.personNameSnapshot || "").filter(Boolean);
        if (leaveNames.length) rows.push({ type: "leave", account: "", shift: "休假", group: leaveNames.join("、"), liveTime: "", attendance: "", duration: "", order: 1000 });
        if (day.leaveNote) rows.push({ type: "note", note: day.leaveNote, order: 1001 });
      });
    });

    [...dateRows.keys()].sort().forEach((dateKey) => {
      const descriptors = dateRows.get(dateKey).sort((a, b) => a.order - b.order);
      const firstRow = sheet.rowCount + 1;
      descriptors.forEach((item) => {
        if (item.type === "note") {
          const row = sheet.addRow([dateKey, item.note, "", "", "", "", ""]);
          sheet.mergeCells(row.number, 2, row.number, 7);
          row.eachCell((cell) => { cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE4DFEC" } }; cell.font = { name: "微软雅黑", bold: true, color: { argb: "FF5F497A" } }; cell.alignment = { horizontal: "center", vertical: "middle" }; });
        } else {
          const row = sheet.addRow([dateKey, item.account, item.shift, item.group, item.liveTime, item.attendance, item.duration]);
          if (item.type === "leave") row.eachCell((cell) => { cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFE699" } }; cell.font = { name: "微软雅黑", bold: true, color: { argb: "FF7F6000" } }; });
        }
      });
      const lastRow = sheet.rowCount;
      if (lastRow > firstRow) sheet.mergeCells(firstRow, 1, lastRow, 1);
      sheet.getCell(firstRow, 1).alignment = { horizontal: "center", vertical: "middle", wrapText: true };
      let accountStart = firstRow;
      for (let row = firstRow + 1; row <= lastRow + 1; row += 1) {
        const previous = cellText(sheet.getCell(row - 1, 2));
        const current = row <= lastRow ? cellText(sheet.getCell(row, 2)) : null;
        if (current !== previous) {
          if (previous && row - 1 > accountStart) sheet.mergeCells(accountStart, 2, row - 1, 2);
          accountStart = row;
        }
      }
    });

    [14, 18, 20, 24, 18, 18, 14].forEach((width, index) => { sheet.getColumn(index + 1).width = width; });
    for (let row = 3; row <= sheet.rowCount; row += 1) for (let column = 1; column <= 7; column += 1) {
      const cell = sheet.getCell(row, column);
      cell.border = { top: { style: "thin", color: { argb: "FFB4C6E7" } }, left: { style: "thin", color: { argb: "FFB4C6E7" } }, bottom: { style: "thin", color: { argb: "FFB4C6E7" } }, right: { style: "thin", color: { argb: "FFB4C6E7" } } };
      cell.alignment = { vertical: "middle", wrapText: true, ...(cell.alignment || {}) };
      if (!cell.font) cell.font = { name: "微软雅黑", size: 10 };
    }
    sheet.pageSetup = { orientation: "landscape", paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
    sheet.pageSetup.printArea = `A1:G${sheet.rowCount}`;
    sheet.headerFooter.oddFooter = "第 &P / &N 页";
    return workbook;
  }

  return { TEMPLATE_VERSION, activeConfiguration, buildScheduleTemplateModel, configurationFingerprint, createDisplayScheduleWorkbook, createPerformanceWorkbook, createScheduleTemplateWorkbook, parsePerformanceWorkbook, parseScheduleTemplateWorkbook, preparePerformanceImport, prepareScheduleImport, stableStringify };
});
