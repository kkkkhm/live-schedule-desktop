(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.ScheduleLogic = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const DAY_MS = 24 * 60 * 60 * 1000;

  function parseLocalDate(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || "");
    if (!match) return null;
    return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  }

  function toIsoDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function startOfWeek(value) {
    const date = value instanceof Date
      ? new Date(value.getFullYear(), value.getMonth(), value.getDate())
      : parseLocalDate(value);
    if (!date || Number.isNaN(date.getTime())) return null;
    const mondayOffset = (date.getDay() + 6) % 7;
    date.setDate(date.getDate() - mondayOffset);
    return date;
  }

  function addDays(date, count) {
    const result = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    result.setDate(result.getDate() + count);
    return result;
  }

  function getWeekDates(weekKey) {
    const monday = startOfWeek(weekKey);
    if (!monday) return [];
    return Array.from({ length: 7 }, (_, index) => addDays(monday, index));
  }

  function timeToMinutes(value) {
    const match = /^(\d{2}):(\d{2})$/.exec(value || "");
    if (!match) return null;
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    if (hours > 23 || minutes > 59) return null;
    return hours * 60 + minutes;
  }

  function durationHours(startTime, endTime) {
    const start = timeToMinutes(startTime);
    let end = timeToMinutes(endTime);
    if (start === null || end === null || start === end) return 0;
    if (end < start) end += 24 * 60;
    return (end - start) / 60;
  }

  function addHoursToTime(value, hours) {
    const start = timeToMinutes(value);
    if (start === null || !Number.isFinite(hours)) return "";
    const minutes = ((start + Math.round(hours * 60)) % (24 * 60) + 24 * 60) % (24 * 60);
    return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
  }

  function eligiblePeopleForRole(people, role, selectedIds = []) {
    const selected = new Set(selectedIds || []);
    const capability = role === "host" ? "canHost" : "canCoHost";
    return (people || []).filter((person) => person
      && person[capability]
      && (person.active !== false || selected.has(person.id)));
  }

  function parsePerformanceAmount(value) {
    const text = String(value ?? "").trim();
    if (!text) return { valid: true, value: null };
    if (!/^\d+(?:\.\d{1,2})?$/.test(text)) return { valid: false, value: null };
    const amount = Number(text);
    if (!Number.isFinite(amount) || amount < 0) return { valid: false, value: null };
    return { valid: true, value: Math.round(amount * 100) / 100 };
  }

  function addMonthsClamped(date, count) {
    const lastDay = new Date(date.getFullYear(), date.getMonth() + count + 1, 0).getDate();
    return new Date(date.getFullYear(), date.getMonth() + count, Math.min(date.getDate(), lastDay));
  }

  function performanceRangeBounds(mode, currentStart, currentEnd, todayValue = new Date()) {
    if (mode === "all") return { start: "", end: "" };
    if (mode === "current") {
      if (!parseLocalDate(currentStart) || !parseLocalDate(currentEnd)) throw new Error("当前日期区间无效");
      return { start: currentStart, end: currentEnd };
    }
    const today = todayValue instanceof Date ? new Date(todayValue.getFullYear(), todayValue.getMonth(), todayValue.getDate()) : parseLocalDate(todayValue);
    if (!today) throw new Error("统计日期无效");
    if (mode === "30d") return { start: toIsoDate(addDays(today, -29)), end: toIsoDate(today) };
    if (mode === "3m") return { start: toIsoDate(addMonthsClamped(today, -3)), end: toIsoDate(today) };
    throw new Error("不支持的业绩统计范围");
  }

  function calculatePerformanceRankings(days, people, shiftKeys, bounds = {}) {
    const peopleById = new Map((people || []).map((person) => [person.id, person]));
    const hostRows = new Map();
    const coHostRows = new Map();
    const addResult = (target, personId, snapshot, amount) => {
      if (!personId) return;
      if (!target.has(personId)) target.set(personId, { id: personId, name: peopleById.get(personId)?.name || snapshot || "未知人员", cents: 0, sessionCount: 0 });
      const row = target.get(personId);
      row.cents += Math.round(amount * 100);
      row.sessionCount += 1;
    };
    Object.entries(days || {}).forEach(([dateKey, day]) => {
      if ((bounds.start && dateKey < bounds.start) || (bounds.end && dateKey > bounds.end)) return;
      (shiftKeys || []).forEach((shiftKey) => {
        const slot = day?.[shiftKey];
        const amount = slot?.performanceAmount;
        if (typeof amount !== "number" || !Number.isFinite(amount) || amount < 0) return;
        addResult(hostRows, slot.hostId, slot.hostNameSnapshot, amount);
        addResult(coHostRows, slot.coHostId, slot.coHostNameSnapshot, amount);
      });
    });
    const rank = (rows) => {
      const sorted = [...rows.values()].sort((a, b) => b.cents - a.cents || a.name.localeCompare(b.name, "zh-CN"));
      let previousCents = null;
      let previousRank = 0;
      return sorted.map((row, index) => {
        const currentRank = previousCents === row.cents ? previousRank : index + 1;
        previousCents = row.cents;
        previousRank = currentRank;
        return { id: row.id, name: row.name, rank: currentRank, total: row.cents / 100, sessionCount: row.sessionCount, average: row.cents / 100 / row.sessionCount };
      });
    };
    return { hosts: rank(hostRows), coHosts: rank(coHostRows) };
  }

  function intervalForSlot(slot) {
    const start = timeToMinutes(slot.startTime);
    let end = timeToMinutes(slot.endTime);
    if (start === null || end === null || start === end) return null;
    if (end < start) end += 24 * 60;
    return { start, end };
  }

  function intervalForTimes(startTime, endTime) {
    return intervalForSlot({ startTime, endTime });
  }

  function intervalsOverlap(first, second) {
    return first.start < second.end && second.start < first.end;
  }

  function hasAssignment(slot) {
    return Boolean(slot && (slot.hostId || slot.coHostId));
  }

  function getPersonName(personId, people, snapshot) {
    const person = people.find((item) => item.id === personId);
    return person ? person.name : (snapshot || "未知人员");
  }

  function isOvertimeShift(shiftKey) {
    return /^overtime/.test(shiftKey || "");
  }

  function collectWeekEntries(week, people) {
    const entries = [];
    Object.entries(week || {}).forEach(([dayKey, shifts]) => {
      Object.entries(shifts || {}).forEach(([shiftKey, slot]) => {
        if (!hasAssignment(slot)) return;
        const hours = durationHours(slot.startTime, slot.endTime);
        entries.push({
          dayKey,
          shiftKey,
          isOvertime: isOvertimeShift(shiftKey),
          slot,
          hours,
          interval: intervalForSlot(slot),
          hostName: slot.hostId ? getPersonName(slot.hostId, people, slot.hostNameSnapshot) : "",
          coHostName: slot.coHostId ? getPersonName(slot.coHostId, people, slot.coHostNameSnapshot) : ""
        });
        if (!isOvertimeShift(shiftKey) && (slot.overtimeStartTime || slot.overtimeEndTime)) {
          entries.push({
            dayKey,
            shiftKey,
            entryKind: "embedded-overtime",
            isOvertime: true,
            slot,
            hours: durationHours(slot.overtimeStartTime, slot.overtimeEndTime),
            interval: intervalForTimes(slot.overtimeStartTime, slot.overtimeEndTime),
            hostName: slot.hostId ? getPersonName(slot.hostId, people, slot.hostNameSnapshot) : "",
            coHostName: slot.coHostId ? getPersonName(slot.coHostId, people, slot.coHostNameSnapshot) : ""
          });
        }
      });
    });
    return entries;
  }

  function calculateStatistics(week, people) {
    const rows = new Map();
    people.forEach((person) => rows.set(person.id, {
      id: person.id,
      name: person.name,
      liveHours: 0,
      overtimeHours: 0,
      totalHours: 0
    }));

    const entries = collectWeekEntries(week, people);
    entries.forEach(({ slot, hours, isOvertime }) => {
      if (!hours) return;
      const assignedPeople = [...new Set([slot.hostId, slot.coHostId].filter(Boolean))];
      assignedPeople.forEach((personId) => {
        const snapshot = personId === slot.hostId ? slot.hostNameSnapshot : slot.coHostNameSnapshot;
        if (!rows.has(personId)) rows.set(personId, { id: personId, name: snapshot || "未知人员", liveHours: 0, overtimeHours: 0, totalHours: 0 });
        const row = rows.get(personId);
        if (isOvertime) row.overtimeHours += hours;
        else row.liveHours += hours;
        row.totalHours += hours;
      });
    });

    return {
      sessionCount: entries.filter((entry) => entry.hours > 0 && entry.entryKind !== "embedded-overtime").length,
      totalPersonHours: Array.from(rows.values()).reduce((sum, row) => sum + row.totalHours, 0),
      rows: Array.from(rows.values()).filter((row) => row.totalHours > 0).sort((a, b) => b.totalHours - a.totalHours || a.name.localeCompare(b.name, "zh-CN"))
    };
  }

  function findConflicts(week, people) {
    const conflicts = [];
    const entries = collectWeekEntries(week, people);

    entries.forEach((entry) => {
      const { slot } = entry;
      if (entry.entryKind !== "embedded-overtime" && slot.hostId && slot.coHostId && slot.hostId === slot.coHostId) {
        conflicts.push({
          type: "same-role-person",
          dayKey: entry.dayKey,
          shifts: [entry.shiftKey],
          personId: slot.hostId,
          personName: entry.hostName
        });
      }
      if (hasAssignment(slot) && !entry.interval) {
        conflicts.push({
          type: "invalid-time",
          dayKey: entry.dayKey,
          shifts: [entry.shiftKey]
        });
      }
    });

    const byDay = new Map();
    entries.filter((entry) => entry.interval).forEach((entry) => {
      if (!byDay.has(entry.dayKey)) byDay.set(entry.dayKey, []);
      byDay.get(entry.dayKey).push(entry);
    });

    byDay.forEach((dayEntries, dayKey) => {
      for (let i = 0; i < dayEntries.length; i += 1) {
        for (let j = i + 1; j < dayEntries.length; j += 1) {
          const first = dayEntries[i];
          const second = dayEntries[j];
          if (!intervalsOverlap(first.interval, second.interval)) continue;
          const firstPeople = [first.slot.hostId, first.slot.coHostId].filter(Boolean);
          const secondPeople = [second.slot.hostId, second.slot.coHostId].filter(Boolean);
          const duplicates = [...new Set(firstPeople.filter((id) => secondPeople.includes(id)))];
          duplicates.forEach((personId) => {
            conflicts.push({
              type: "overlap",
              dayKey,
              shifts: [first.shiftKey, second.shiftKey],
              personId,
              personName: getPersonName(personId, people, "未知人员")
            });
          });
        }
      }
    });

    Object.entries(week || {}).forEach(([dayKey, day]) => {
      const leavePeople = Array.isArray(day?.leavePeople) ? day.leavePeople : [];
      leavePeople.forEach((leave) => {
        const scheduledShifts = entries
          .filter((entry) => entry.dayKey === dayKey && (entry.slot.hostId === leave.personId || entry.slot.coHostId === leave.personId))
          .map((entry) => entry.shiftKey);
        if (scheduledShifts.length) {
          conflicts.push({
            type: "leave-scheduled",
            dayKey,
            shifts: [...new Set(scheduledShifts)],
            personId: leave.personId,
            personName: getPersonName(leave.personId, people, leave.personNameSnapshot)
          });
        }
      });
    });

    return conflicts;
  }

  function hasDayContent(day) {
    if (!day || typeof day !== "object") return false;
    if ((Array.isArray(day.leavePeople) && day.leavePeople.length) || day.leaveNote) return true;
    return Object.entries(day).some(([key, slot]) => !["leavePeople", "leaveNote", "updatedAt", "autoSchedule"].includes(key) && slot && typeof slot === "object" &&
      (slot.hostId || slot.coHostId || slot.note || slot.overtimeStartTime || slot.overtimeEndTime || (slot.startTime && slot.endTime && isOvertimeShift(key))));
  }

  function planDayFromTemplates(templates, leavePersonIds, partTimeGroup) {
    const leave = new Set(leavePersonIds || []);
    const active = (templates || []).filter((group) => group && group.hostId && group.coHostId && !leave.has(group.hostId) && !leave.has(group.coHostId)).map((group) => ({ ...group }));
    const mainKeys = ["morning", "afternoon", "evening"];
    const formalGroupCount = active.length;
    let assignments = active.map((group) => ({ ...group, groupType: "formal" }));
    let scenario = formalGroupCount >= 4 ? "four" : formalGroupCount === 3 ? "three" : formalGroupCount === 2 ? "two" : "critical";
    let needsPartTime = formalGroupCount === 2 || formalGroupCount === 3;
    const partTimeReady = Boolean(partTimeGroup?.hostId && partTimeGroup?.coHostId);
    const partTimeConflict = needsPartTime && partTimeReady && (leave.has(partTimeGroup.hostId) || leave.has(partTimeGroup.coHostId));
    const canUsePartTime = needsPartTime && partTimeReady && !partTimeConflict;
    let requiredOvertimeGroupIds = [];
    if (formalGroupCount === 3 && canUsePartTime) {
      const occupied = new Set(assignments.map((group) => group.shiftKey));
      const missing = [...mainKeys, "secondary"].find((key) => !occupied.has(key));
      if (missing) assignments.push({ ...partTimeGroup, id: partTimeGroup.id || "part-time-group", groupType: "partTime", shiftKey: missing });
    }
    if (formalGroupCount === 2) {
      assignments = active.map((group, index) => ({ ...group, groupType: "formal", movedFromShiftKey: group.shiftKey, shiftKey: index === 0 ? "morning" : "afternoon", overtimeStartTime: index === 0 ? "12:30" : "17:30", overtimeEndTime: index === 0 ? "14:00" : "19:00" }));
      requiredOvertimeGroupIds = active.map((group) => group.id);
      if (canUsePartTime) assignments.push({ ...partTimeGroup, id: partTimeGroup.id || "part-time-group", groupType: "partTime", shiftKey: "evening" });
    }
    const occupied = new Set(assignments.map((group) => group.shiftKey));
    const targetKeys = formalGroupCount === 2 ? mainKeys : [...mainKeys, "secondary"];
    return {
      formalGroupCount,
      scenario,
      assignments,
      missingShiftKeys: targetKeys.filter((key) => !occupied.has(key)),
      needsPartTime,
      requiredOvertimeGroupIds,
      partTimeConflict
    };
  }

  function planDayFromConfiguration(groups, shiftDefinitions, targets, leavePersonIds, partTimeGroup) {
    const leave = new Set(leavePersonIds || []);
    const shifts = (shiftDefinitions || []).filter((shift) => shift && shift.active !== false).slice().sort((a, b) => (a.order || 0) - (b.order || 0));
    const activeGroups = (groups || []).filter((group) => group && group.active !== false && group.hostId && group.coHostId && !leave.has(group.hostId) && !leave.has(group.coHostId)).slice().sort((a, b) => (a.order || 0) - (b.order || 0));
    const occupied = new Set();
    const assignments = [];
    activeGroups.forEach((group) => {
      const preferred = shifts.find((shift) => shift.key === group.defaultShiftId && !occupied.has(shift.key));
      const shift = preferred || shifts.find((item) => !occupied.has(item.key));
      if (!shift) return;
      occupied.add(shift.key);
      assignments.push({ ...group, groupType: "formal", shiftKey: shift.key });
    });
    const minimumShiftCount = Math.max(1, Math.min(Number(targets?.minimumShiftCount) || 1, shifts.length || 1));
    const partTimeReady = Boolean(partTimeGroup?.hostId && partTimeGroup?.coHostId);
    const partTimeConflict = partTimeReady && (leave.has(partTimeGroup.hostId) || leave.has(partTimeGroup.coHostId));
    if (assignments.length < minimumShiftCount && partTimeReady && !partTimeConflict) {
      const shift = shifts.find((item) => !occupied.has(item.key));
      if (shift) {
        occupied.add(shift.key);
        assignments.push({ ...partTimeGroup, id: partTimeGroup.id || "part-time-group", name: partTimeGroup.name || "固定兼职班组", active: true, groupType: "partTime", shiftKey: shift.key });
      }
    }
    const byKey = new Map(shifts.map((shift) => [shift.key, shift]));
    let baseHours = assignments.reduce((sum, group) => { const shift = byKey.get(group.shiftKey); return sum + durationHours(shift?.startTime, shift?.endTime); }, 0);
    const minimumTotalHours = Math.max(0, Number(targets?.minimumTotalHours) || 0);
    const defaultOvertimeHours = Math.max(0, Number(targets?.defaultOvertimeHours) || 0);
    let remainingHours = Math.max(0, minimumTotalHours - baseHours);
    const overtimeCandidates = assignments.filter((group) => byKey.get(group.shiftKey)?.allowOvertime).sort((a, b) => {
      const first = byKey.get(a.shiftKey); const second = byKey.get(b.shiftKey);
      return (first.overtimePriority || 999) - (second.overtimePriority || 999) || (first.order || 0) - (second.order || 0);
    });
    overtimeCandidates.forEach((group) => {
      if (remainingHours <= 0 || defaultOvertimeHours <= 0) return;
      const shift = byKey.get(group.shiftKey); const overtimeHours = Math.min(defaultOvertimeHours, remainingHours);
      group.overtimeStartTime = shift.endTime;
      group.overtimeEndTime = addHoursToTime(shift.endTime, overtimeHours);
      group.overtimeHours = overtimeHours;
      remainingHours = Math.max(0, remainingHours - overtimeHours);
    });
    const overtimeHours = assignments.reduce((sum, group) => sum + (group.overtimeHours || 0), 0);
    const missingShiftCount = Math.max(0, minimumShiftCount - assignments.length);
    return {
      assignments,
      availableFormalGroupCount: activeGroups.length,
      completeCount: assignments.length,
      minimumShiftCount,
      baseHours,
      overtimeHours,
      totalHours: baseHours + overtimeHours,
      minimumTotalHours,
      missingShiftCount,
      missingHours: remainingHours,
      partTimeUsed: assignments.some((group) => group.groupType === "partTime"),
      partTimeConflict,
      needsManual: missingShiftCount > 0 || remainingHours > 0
    };
  }

  function evaluateDayTargets(day, shiftDefinitions, targets) {
    const record = day && typeof day === "object" ? day : {};
    const shifts = (shiftDefinitions || []).filter((shift) => shift && shift.active !== false);
    const complete = shifts.filter((shift) => {
      const slot = record[shift.key];
      return Boolean(slot?.hostId && slot?.coHostId && durationHours(slot.startTime, slot.endTime));
    });
    const leaveIds = new Set((record.leavePeople || []).map((item) => item.personId));
    const leaveConflictKeys = complete.filter((shift) => leaveIds.has(record[shift.key].hostId) || leaveIds.has(record[shift.key].coHostId)).map((shift) => shift.key);
    const baseHours = complete.reduce((sum, shift) => sum + durationHours(record[shift.key].startTime, record[shift.key].endTime), 0);
    const overtimeHours = complete.reduce((sum, shift) => sum + durationHours(record[shift.key].overtimeStartTime, record[shift.key].overtimeEndTime), 0);
    const minimumShiftCount = Math.max(1, Number(targets?.minimumShiftCount) || 1);
    const minimumTotalHours = Math.max(0, Number(targets?.minimumTotalHours) || 0);
    return {
      completeKeys: complete.map((shift) => shift.key),
      completeCount: complete.length,
      baseHours,
      overtimeHours,
      totalHours: baseHours + overtimeHours,
      minimumShiftCount,
      minimumTotalHours,
      missingShiftCount: Math.max(0, minimumShiftCount - complete.length),
      missingHours: Math.max(0, minimumTotalHours - baseHours - overtimeHours),
      leaveConflictKeys,
      hasLeaveConflict: leaveConflictKeys.length > 0
    };
  }

  function evaluateDaySchedule(day, shiftKeys = ["morning", "afternoon", "evening", "secondary"]) {
    const record = day && typeof day === "object" ? day : {};
    const isComplete = (slot) => Boolean(slot?.hostId && slot?.coHostId && durationHours(slot.startTime, slot.endTime));
    const completeKeys = shiftKeys.filter((key) => isComplete(record[key]));
    const leaveIds = new Set((record.leavePeople || []).map((item) => item.personId));
    const leaveConflictKeys = completeKeys.filter((key) => leaveIds.has(record[key].hostId) || leaveIds.has(record[key].coHostId));
    const mainReady = ["morning", "afternoon", "evening"].every((key) => isComplete(record[key])) && !isComplete(record.secondary);
    const overtimeReady = [
      ["morning", "12:30", "14:00"],
      ["afternoon", "17:30", "19:00"]
    ].every(([key, start, end]) => record[key]?.overtimeStartTime === start && record[key]?.overtimeEndTime === end);
    return { completeKeys, completeCount: completeKeys.length, leaveConflictKeys, hasLeaveConflict: leaveConflictKeys.length > 0, mainReady, overtimeReady };
  }

  function clearScheduleDays(roomSchedule, dateKeys, shiftKeys, timestamp = new Date().toISOString()) {
    if (!roomSchedule?.days || !Array.isArray(dateKeys) || !Array.isArray(shiftKeys)) return 0;
    let cleared = 0;
    dateKeys.forEach((dateKey) => {
      const day = roomSchedule.days[dateKey];
      if (!day || typeof day !== "object") return;
      let changed = false;
      shiftKeys.forEach((shiftKey) => {
        if (Object.prototype.hasOwnProperty.call(day, shiftKey)) { delete day[shiftKey]; changed = true; }
      });
      if (Object.prototype.hasOwnProperty.call(day, "autoSchedule")) { delete day.autoSchedule; changed = true; }
      if (changed) { day.updatedAt = timestamp; cleared += 1; }
    });
    return cleared;
  }

  function hasWeekContent(weekRecord) {
    const days = weekRecord?.days || weekRecord || {};
    return Object.values(days).some(hasDayContent);
  }

  function dateRange(startValue, endValue, maxDays = 14) {
    const start = startValue instanceof Date ? startValue : parseLocalDate(startValue);
    const end = endValue instanceof Date ? endValue : parseLocalDate(endValue);
    if (!start || !end) throw new Error("请选择开始日期和结束日期");
    const count = Math.round((end - start) / DAY_MS) + 1;
    if (count < 1) throw new Error("结束日期不能早于开始日期");
    if (count > maxDays) throw new Error(`日期区间最多支持${maxDays}天`);
    return Array.from({ length: count }, (_, index) => addDays(start, index));
  }

  function chooseRangeDate(startValue, clickedValue, maxDays = 14) {
    const clicked = clickedValue instanceof Date ? clickedValue : parseLocalDate(clickedValue);
    if (!clicked) throw new Error("请选择有效日期");
    const clickedKey = toIsoDate(clicked);
    const start = startValue instanceof Date ? startValue : parseLocalDate(startValue);
    if (!start || clicked < start) return { start: clickedKey, end: "", complete: false };
    dateRange(start, clicked, maxDays);
    return { start: toIsoDate(start), end: clickedKey, complete: true };
  }

  function historyRecords(state, todayValue) {
    const today = todayValue instanceof Date ? new Date(todayValue) : parseLocalDate(todayValue);
    if (!today || Number.isNaN(today.getTime())) return [];
    const threshold = new Date(today.getFullYear(), today.getMonth() - 3, today.getDate());
    const records = [];
    Object.entries(state?.schedules || {}).forEach(([roomKey, roomSchedule]) => {
      Object.entries(roomSchedule?.days || {}).forEach(([dateKey, day]) => {
        const date = parseLocalDate(dateKey);
        if (!date || date < threshold || !hasDayContent(day)) return;
        records.push({ roomKey, dateKey, day, roomSchedule });
      });
    });
    return records.sort((a, b) => b.dateKey.localeCompare(a.dateKey) || a.roomKey.localeCompare(b.roomKey));
  }

  function targetWeekAvailable(existing) {
    return !existing || !hasWeekContent(existing);
  }

  function copyWeekRecord(source, clearContent, timestamp) {
    if (!source || !source.days || typeof source.days !== "object") throw new Error("历史周表格式无效");
    const time = timestamp || new Date().toISOString();
    return {
      roomId: source.roomId || "",
      roomNameSnapshot: source.roomNameSnapshot || "",
      roomAccountSnapshot: source.roomAccountSnapshot || "",
      days: clearContent ? {} : JSON.parse(JSON.stringify(source.days)),
      createdAt: time,
      updatedAt: time
    };
  }

  function defaultShiftDefinitions(primaryRoomId = "", secondaryRoomId = "") {
    return [
      { key: "morning", label: "主号早班", roomId: primaryRoomId, startTime: "08:00", endTime: "12:30", active: true, allowOvertime: true, overtimePriority: 1, order: 1 },
      { key: "afternoon", label: "主号中班", roomId: primaryRoomId, startTime: "13:00", endTime: "17:30", active: true, allowOvertime: true, overtimePriority: 2, order: 2 },
      { key: "evening", label: "主号晚班", roomId: primaryRoomId, startTime: "19:00", endTime: "23:30", active: true, allowOvertime: false, overtimePriority: 3, order: 3 },
      { key: "secondary", label: "副直播间班次", roomId: secondaryRoomId || primaryRoomId, startTime: "13:30", endTime: "18:00", active: true, allowOvertime: false, overtimePriority: 4, order: 4 }
    ];
  }

  function upgradeToV5(output) {
    output.settings = output.settings && typeof output.settings === "object" ? output.settings : {};
    const activeRooms = (output.rooms || []).filter((room) => room.active !== false);
    const primaryRoomId = output.settings.lastRoomKey || activeRooms[0]?.id || Object.keys(output.schedules || {})[0] || "";
    const secondaryRoomId = activeRooms.find((room) => room.id !== primaryRoomId)?.id || primaryRoomId;
    if (!Array.isArray(output.settings.shiftDefinitions) || !output.settings.shiftDefinitions.length) output.settings.shiftDefinitions = defaultShiftDefinitions(primaryRoomId, secondaryRoomId);
    else output.settings.shiftDefinitions = output.settings.shiftDefinitions.slice(0, 12).map((shift, index) => ({ ...shift, key: shift.key || `shift-${index + 1}`, label: shift.label || `班次 ${index + 1}`, roomId: shift.roomId || primaryRoomId, active: shift.active !== false, allowOvertime: Boolean(shift.allowOvertime), overtimePriority: Number(shift.overtimePriority) || index + 1, order: Number(shift.order) || index + 1 }));
    if (!Array.isArray(output.settings.formalGroups)) {
      const storedTemplates = output.settings.groupTemplates && typeof output.settings.groupTemplates === "object" ? output.settings.groupTemplates : {};
      const source = storedTemplates[primaryRoomId] || Object.values(storedTemplates)[0] || [];
      output.settings.formalGroups = source.slice(0, 12).map((group, index) => ({ id: group.id || `group-${index + 1}`, name: group.name || `班组 ${index + 1}`, hostId: group.hostId || "", coHostId: group.coHostId || "", defaultShiftId: group.shiftKey || output.settings.shiftDefinitions[index]?.key || output.settings.shiftDefinitions[0]?.key || "", active: true, order: index + 1 }));
    }
    if (!output.settings.formalGroups.length) output.settings.formalGroups = output.settings.shiftDefinitions.slice(0, 4).map((shift, index) => ({ id: `group-${index + 1}`, name: `班组 ${index + 1}`, hostId: "", coHostId: "", defaultShiftId: shift.key, active: true, order: index + 1 }));
    else output.settings.formalGroups = output.settings.formalGroups.slice(0, 12).map((group, index) => ({ ...group, id: group.id || `group-${index + 1}`, name: group.name || `班组 ${index + 1}`, defaultShiftId: group.defaultShiftId || group.shiftKey || output.settings.shiftDefinitions[index]?.key || "", active: group.active !== false, order: Number(group.order) || index + 1 }));
    if (!output.settings.partTimeGroup || typeof output.settings.partTimeGroup !== "object") {
      const stored = output.settings.partTimeGroupTemplates && typeof output.settings.partTimeGroupTemplates === "object" ? output.settings.partTimeGroupTemplates : {};
      const source = stored[primaryRoomId] || Object.values(stored)[0] || {};
      output.settings.partTimeGroup = { id: source.id || "part-time-group", name: "固定兼职班组", hostId: source.hostId || "", coHostId: source.coHostId || "" };
    }
    output.settings.scheduleTargets = { minimumShiftCount: 4, minimumTotalHours: 18, defaultOvertimeHours: 1.5, ...(output.settings.scheduleTargets || {}) };
    output.version = 5;
    return output;
  }

  function migrateState(input) {
    if (!input || !Array.isArray(input.people) || !input.schedules || typeof input.schedules !== "object") {
      throw new Error("数据格式无效");
    }
    if (![1, 2, 3, 4, 5].includes(input.version)) throw new Error("不支持的数据版本");
    const output = JSON.parse(JSON.stringify(input));
    output.rooms = Array.isArray(output.rooms) ? output.rooms : [];
    output.settings = output.settings && typeof output.settings === "object" ? output.settings : {};
    output.people = output.people.map((person) => ({
      ...person,
      employmentType: person.employmentType === "partTime" ? "partTime" : "formal"
    }));
    if (output.version >= 4) {
      Object.values(output.schedules).forEach((roomSchedule) => Object.values(roomSchedule?.days || {}).forEach((day) => {
        day.leavePeople = Array.isArray(day.leavePeople) ? day.leavePeople : [];
        day.leaveNote = day.leaveNote || "";
      }));
      return upgradeToV5(output);
    }

    if (output.version < 3) Object.values(output.schedules).forEach((week) => {
      Object.values(week || {}).forEach((day) => {
        if (!day || typeof day !== "object") return;
        day.leavePeople = Array.isArray(day.leavePeople) ? day.leavePeople : [];
        Object.entries(day).forEach(([key, slot]) => {
          if (key === "leavePeople" || !slot || typeof slot !== "object" || Array.isArray(slot)) return;
          slot.roomId = slot.roomId || "";
          slot.roomNameSnapshot = slot.roomNameSnapshot || "";
          slot.roomAccountSnapshot = slot.roomAccountSnapshot || "";
        });
      });
    });

    if (output.version < 3) {
      const v3Schedules = {};
      Object.entries(output.schedules).forEach(([weekKey, days]) => {
      const roomIds = new Set();
      let snapshotName = "";
      let snapshotAccount = "";
      Object.values(days || {}).forEach((day) => {
        Object.entries(day || {}).forEach(([key, slot]) => {
          if (key === "leavePeople" || !slot || typeof slot !== "object") return;
          if ((slot.hostId || slot.coHostId) && slot.roomId) roomIds.add(slot.roomId);
          if (!snapshotName && slot.roomNameSnapshot) snapshotName = slot.roomNameSnapshot;
          if (!snapshotAccount && slot.roomAccountSnapshot) snapshotAccount = slot.roomAccountSnapshot;
          delete slot.roomId;
          delete slot.roomNameSnapshot;
          delete slot.roomAccountSnapshot;
        });
      });
      const roomKey = roomIds.size === 1 ? [...roomIds][0] : "unassigned";
      const room = output.rooms.find((item) => item.id === roomKey);
      if (!v3Schedules[roomKey]) v3Schedules[roomKey] = {};
      v3Schedules[roomKey][weekKey] = {
        roomId: roomKey === "unassigned" ? "" : roomKey,
        roomNameSnapshot: room?.name || snapshotName || (roomKey === "unassigned" ? "未指定直播间" : "历史直播间"),
        roomAccountSnapshot: room?.account || snapshotAccount || "",
        days,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      });
      output.version = 3;
      output.schedules = v3Schedules;
    }

    const weekdayKeys = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
    const v4Schedules = {};
    Object.entries(output.schedules).forEach(([roomKey, weeks]) => {
      const firstRecord = Object.values(weeks || {})[0] || {};
      v4Schedules[roomKey] = {
        roomId: firstRecord.roomId || (roomKey === "unassigned" ? "" : roomKey),
        roomNameSnapshot: firstRecord.roomNameSnapshot || (roomKey === "unassigned" ? "未指定直播间" : "历史直播间"),
        roomAccountSnapshot: firstRecord.roomAccountSnapshot || "",
        days: {}
      };
      Object.entries(weeks || {}).forEach(([weekKey, record]) => {
        const monday = parseLocalDate(weekKey);
        if (!monday || !record?.days) return;
        weekdayKeys.forEach((dayKey, index) => {
          const day = record.days[dayKey];
          if (!day) return;
          const dateKey = toIsoDate(addDays(monday, index));
          const migratedDay = { ...day, leavePeople: Array.isArray(day.leavePeople) ? day.leavePeople : [], leaveNote: day.leaveNote || "", updatedAt: record.updatedAt || new Date().toISOString() };
          const existing = v4Schedules[roomKey].days[dateKey];
          if (!existing || !hasDayContent(existing) || String(migratedDay.updatedAt) >= String(existing.updatedAt || "")) v4Schedules[roomKey].days[dateKey] = migratedDay;
        });
      });
    });
    output.version = 4;
    output.schedules = v4Schedules;
    return upgradeToV5(output);
  }

  return {
    DAY_MS,
    parseLocalDate,
    toIsoDate,
    startOfWeek,
    addDays,
    getWeekDates,
    timeToMinutes,
    durationHours,
    addHoursToTime,
    eligiblePeopleForRole,
    parsePerformanceAmount,
    performanceRangeBounds,
    calculatePerformanceRankings,
    intervalsOverlap,
    isOvertimeShift,
    calculateStatistics,
    findConflicts,
    hasDayContent,
    hasWeekContent,
    dateRange,
    chooseRangeDate,
    historyRecords,
    targetWeekAvailable,
    copyWeekRecord,
    planDayFromTemplates,
    planDayFromConfiguration,
    evaluateDaySchedule,
    evaluateDayTargets,
    clearScheduleDays,
    migrateState
  };
});
