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

  return { TEMPLATE_VERSION, activeConfiguration, buildScheduleTemplateModel, configurationFingerprint, stableStringify };
});
