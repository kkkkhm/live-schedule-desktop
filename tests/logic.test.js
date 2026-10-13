const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Logic = require("../logic.js");

function test(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

test("returns Monday as start of week", () => {
  assert.equal(Logic.toIsoDate(Logic.startOfWeek("2026-10-09")), "2026-10-05");
});

test("builds Monday through Sunday", () => {
  const dates = Logic.getWeekDates("2026-10-05").map(Logic.toIsoDate);
  assert.deepEqual(dates, ["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09", "2026-10-10", "2026-10-11"]);
});

test("calculates ordinary and overnight hours", () => {
  assert.equal(Logic.durationHours("08:00", "13:00"), 5);
  assert.equal(Logic.durationHours("23:00", "01:30"), 2.5);
  assert.equal(Logic.durationHours("08:00", "08:00"), 0);
});

test("adds fractional hours across midnight", () => {
  assert.equal(Logic.addHoursToTime("12:30", 1.5), "14:00");
  assert.equal(Logic.addHoursToTime("23:30", 1.5), "01:00");
});

test("derives one of the three attendance windows from live start time", () => {
  assert.deepEqual(Logic.attendanceWindowForTime("08:00"), { start: "08:00", end: "16:00" });
  assert.deepEqual(Logic.attendanceWindowForTime("10:59"), { start: "08:00", end: "16:00" });
  assert.deepEqual(Logic.attendanceWindowForTime("11:00"), { start: "11:00", end: "19:00" });
  assert.deepEqual(Logic.attendanceWindowForTime("15:59"), { start: "11:00", end: "19:00" });
  assert.deepEqual(Logic.attendanceWindowForTime("16:00"), { start: "16:00", end: "23:30" });
  assert.deepEqual(Logic.attendanceWindowForTime("23:00"), { start: "16:00", end: "23:30" });
  assert.equal(Logic.attendanceWindowForTime("24:00"), null);
});

test("validates live time entirely inside its derived attendance window", () => {
  assert.deepEqual(Logic.validateLiveTimeRange("08:00", "12:30"), { valid: true, code: "", attendance: { start: "08:00", end: "16:00" } });
  assert.equal(Logic.validateLiveTimeRange("07:59", "12:30").code, "outside-attendance");
  assert.equal(Logic.validateLiveTimeRange("10:30", "16:01").code, "outside-attendance");
  assert.equal(Logic.validateLiveTimeRange("13:00", "19:01").code, "outside-attendance");
  assert.equal(Logic.validateLiveTimeRange("18:30", "23:31").code, "outside-attendance");
  assert.equal(Logic.validateLiveTimeRange("23:00", "01:00").code, "invalid-order");
  assert.equal(Logic.validateLiveTimeRange("", "12:30").code, "missing-time");
});

test("lets the fixed part-time group select all active role-capable people regardless of employment type", () => {
  const people = [
    { id: "formal-host", employmentType: "formal", canHost: true, canCoHost: false, active: true },
    { id: "part-host", employmentType: "partTime", canHost: true, canCoHost: false, active: true },
    { id: "formal-cohost", employmentType: "formal", canHost: false, canCoHost: true, active: true },
    { id: "disabled-host", employmentType: "formal", canHost: true, canCoHost: false, active: false }
  ];
  assert.deepEqual(Logic.eligiblePeopleForRole(people, "host").map((person) => person.id), ["formal-host", "part-host"]);
  assert.deepEqual(Logic.eligiblePeopleForRole(people, "coHost").map((person) => person.id), ["formal-cohost"]);
  assert.deepEqual(Logic.eligiblePeopleForRole(people, "host", ["disabled-host"]).map((person) => person.id), ["formal-host", "part-host", "disabled-host"]);
});

test("validates performance amounts with at most two decimals", () => {
  assert.deepEqual(Logic.parsePerformanceAmount(""), { valid: true, value: null });
  assert.deepEqual(Logic.parsePerformanceAmount("10000.50"), { valid: true, value: 10000.5 });
  assert.equal(Logic.parsePerformanceAmount("-1").valid, false);
  assert.equal(Logic.parsePerformanceAmount("1.234").valid, false);
  assert.equal(Logic.parsePerformanceAmount("abc").valid, false);
});

test("builds current, thirty-day, three-month and all performance ranges", () => {
  assert.deepEqual(Logic.performanceRangeBounds("current", "2026-10-01", "2026-10-07", "2026-10-11"), { start: "2026-10-01", end: "2026-10-07" });
  assert.deepEqual(Logic.performanceRangeBounds("30d", "", "", "2026-10-11"), { start: "2026-09-12", end: "2026-10-11" });
  assert.deepEqual(Logic.performanceRangeBounds("3m", "", "", "2026-10-11"), { start: "2026-07-11", end: "2026-10-11" });
  assert.deepEqual(Logic.performanceRangeBounds("all", "", "", "2026-10-11"), { start: "", end: "" });
});

test("credits full performance to separate host and co-host rankings", () => {
  const days = {
    "2026-10-01": { morning: { hostId: "h1", hostNameSnapshot: "主播甲", coHostId: "c1", coHostNameSnapshot: "副播甲", performanceAmount: 10000 } },
    "2026-10-02": { morning: { hostId: "h1", coHostId: "c2", coHostNameSnapshot: "副播乙", performanceAmount: 0 }, afternoon: { hostId: "h2", hostNameSnapshot: "主播乙", coHostId: "c1", performanceAmount: 10000 } },
    "2026-09-01": { morning: { hostId: "outside", coHostId: "outside-c", performanceAmount: 99999 } }
  };
  const people = [{ id: "h1", name: "主播甲" }, { id: "c1", name: "副播甲" }];
  const result = Logic.calculatePerformanceRankings(days, people, ["morning", "afternoon"], { start: "2026-10-01", end: "2026-10-31" });
  assert.deepEqual(result.hosts.map((row) => [row.name, row.rank, row.total, row.sessionCount, row.average]), [["主播甲", 1, 10000, 2, 5000], ["主播乙", 1, 10000, 1, 10000]]);
  assert.deepEqual(result.coHosts.map((row) => [row.name, row.rank, row.total, row.sessionCount]), [["副播甲", 1, 20000, 2], ["副播乙", 2, 0, 1]]);
});

test("uses competition ranking for equal performance totals", () => {
  const days = { "2026-10-01": {
    morning: { hostId: "a", performanceAmount: 300 },
    afternoon: { hostId: "b", performanceAmount: 200 },
    evening: { hostId: "c", performanceAmount: 200 },
    secondary: { hostId: "d", performanceAmount: 100 }
  } };
  assert.deepEqual(Logic.calculatePerformanceRankings(days, [], ["morning", "afternoon", "evening", "secondary"]).hosts.map((row) => row.rank), [1, 2, 2, 4]);
});

test("uses a date-column performance matrix with ranking-only range controls", () => {
  const root = path.join(__dirname, "..");
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
  const styles = fs.readFileSync(path.join(root, "styles.css"), "utf8");
  assert.match(html, /id="performanceTableHead"/);
  assert.match(html, /id="performanceEntryRangeLabel"/);
  assert.match(html, />排名范围</);
  assert.match(app, /function renderPerformanceMatrix\(\)/);
  assert.match(app, /saveState\(\); renderPerformanceSummary\(\);/);
  assert.match(styles, /\.performance-table \.performance-shift-label \{ position: sticky;/);
});

test("classifies live time above the normal limit as overtime without distinguishing roles", () => {
  const people = [{ id: "a", name: "甲" }, { id: "b", name: "乙" }];
  const week = { monday: { morning: { hostId: "a", coHostId: "b", startTime: "08:00", endTime: "13:00" } } };
  const result = Logic.calculateStatistics(week, people);
  assert.equal(result.sessionCount, 1);
  assert.equal(result.totalPersonHours, 10);
  const byName = Object.fromEntries(result.rows.map((row) => [row.name, row]));
  assert.deepEqual([byName["甲"].liveHours, byName["甲"].overtimeHours, byName["甲"].totalHours], [4.5, 0.5, 5]);
  assert.deepEqual([byName["乙"].liveHours, byName["乙"].overtimeHours, byName["乙"].totalHours], [4.5, 0.5, 5]);
});

test("separates overtime and counts the same person only once per slot", () => {
  const people = [{ id: "a", name: "甲" }];
  const week = { monday: {
    morning: { hostId: "a", coHostId: "a", startTime: "08:00", endTime: "13:00" },
    overtimeMorning: { hostId: "a", coHostId: "", startTime: "13:00", endTime: "15:00" }
  } };
  const result = Logic.calculateStatistics(week, people);
  assert.deepEqual([result.rows[0].liveHours, result.rows[0].overtimeHours, result.rows[0].totalHours], [4.5, 2.5, 7]);
  assert.equal(result.totalPersonHours, 7);
});

test("counts embedded overtime separately without adding a live session", () => {
  const people = [{ id: "a", name: "甲" }, { id: "b", name: "乙" }];
  const week = { monday: { morning: { hostId: "a", coHostId: "b", startTime: "08:00", endTime: "12:30", overtimeStartTime: "12:30", overtimeEndTime: "14:00" } } };
  const result = Logic.calculateStatistics(week, people);
  assert.equal(result.sessionCount, 1);
  assert.deepEqual([result.rows[0].liveHours, result.rows[0].overtimeHours], [4.5, 1.5]);
});

test("plans four, three and two-group days from leave conflicts", () => {
  const templates = [
    { id: "g1", hostId: "h1", coHostId: "c1", shiftKey: "morning" },
    { id: "g2", hostId: "h2", coHostId: "c2", shiftKey: "afternoon" },
    { id: "g3", hostId: "h3", coHostId: "c3", shiftKey: "evening" },
    { id: "g4", hostId: "h4", coHostId: "c4", shiftKey: "secondary" }
  ];
  assert.equal(Logic.planDayFromTemplates(templates, []).scenario, "four");
  const partTime = { id: "pt", hostId: "ph", coHostId: "pc" };
  const three = Logic.planDayFromTemplates(templates, ["h1"], partTime);
  assert.deepEqual([three.scenario, three.needsPartTime, three.missingShiftKeys], ["three", true, []]);
  assert.equal(three.assignments.find((item) => item.groupType === "partTime").shiftKey, "morning");
  const two = Logic.planDayFromTemplates(templates, ["h1", "h2"], partTime);
  assert.equal(two.scenario, "two");
  assert.deepEqual(two.assignments.map((item) => item.shiftKey), ["morning", "afternoon", "evening"]);
  assert.deepEqual(two.assignments.slice(0, 2).map((item) => [item.overtimeStartTime, item.overtimeEndTime]), [["12:30", "14:00"], ["17:30", "19:00"]]);
  assert.equal(two.missingShiftKeys.length, 0);
  assert.deepEqual(two.requiredOvertimeGroupIds.sort(), ["g3", "g4"]);
});

test("does not use the fixed part-time group when either member is on leave", () => {
  const templates = [
    { id: "g1", hostId: "h1", coHostId: "c1", shiftKey: "morning" },
    { id: "g2", hostId: "h2", coHostId: "c2", shiftKey: "afternoon" },
    { id: "g3", hostId: "h3", coHostId: "c3", shiftKey: "evening" },
    { id: "g4", hostId: "h4", coHostId: "c4", shiftKey: "secondary" }
  ];
  const plan = Logic.planDayFromTemplates(templates, ["h1", "ph"], { id: "pt", hostId: "ph", coHostId: "pc" });
  assert.equal(plan.partTimeConflict, true);
  assert.equal(plan.assignments.some((item) => item.groupType === "partTime"), false);
  assert.deepEqual(plan.missingShiftKeys, ["morning"]);
});

test("plans configurable shifts, fills one part-time shift, then adds overtime by priority", () => {
  const shifts = [
    { key: "a", label: "A", startTime: "08:00", endTime: "12:00", active: true, allowOvertime: true, overtimePriority: 2, order: 1 },
    { key: "b", label: "B", startTime: "13:00", endTime: "17:00", active: true, allowOvertime: true, overtimePriority: 1, order: 2 },
    { key: "c", label: "C", startTime: "18:00", endTime: "22:00", active: true, allowOvertime: false, overtimePriority: 3, order: 3 }
  ];
  const groups = [
    { id: "g1", hostId: "h1", coHostId: "c1", defaultShiftId: "a", active: true, order: 1 },
    { id: "g2", hostId: "h2", coHostId: "c2", defaultShiftId: "b", active: true, order: 2 },
    { id: "g3", hostId: "h3", coHostId: "c3", defaultShiftId: "c", active: true, order: 3 }
  ];
  const plan = Logic.planDayFromConfiguration(groups, shifts, { minimumShiftCount: 3, minimumTotalHours: 13.25, defaultOvertimeHours: 1.5 }, ["h3"], { id: "pt", hostId: "ph", coHostId: "pc" });
  assert.equal(plan.completeCount, 3);
  assert.equal(plan.partTimeUsed, true);
  assert.equal(plan.totalHours, 13.25);
  assert.equal(plan.needsManual, false);
  const priorityOvertime = plan.assignments.find((item) => item.shiftKey === "b");
  assert.deepEqual([priorityOvertime.overtimeStartTime, priorityOvertime.overtimeEndTime, priorityOvertime.overtimeHours], ["17:00", "18:15", 1.25]);
});

test("fills the highest-priority shifts when only three groups are available", () => {
  const shifts = [
    { key: "a", startTime: "08:00", endTime: "12:30", active: true, order: 1 },
    { key: "b", startTime: "13:00", endTime: "17:30", active: true, order: 2 },
    { key: "c", startTime: "19:00", endTime: "23:30", active: true, order: 3 },
    { key: "d", startTime: "13:30", endTime: "18:00", active: true, order: 4 }
  ];
  const groups = [
    { id: "g2", hostId: "h2", coHostId: "c2", defaultShiftId: "b", active: true, order: 2 },
    { id: "g3", hostId: "h3", coHostId: "c3", defaultShiftId: "c", active: true, order: 3 },
    { id: "g4", hostId: "h4", coHostId: "c4", defaultShiftId: "d", active: true, order: 4 }
  ];
  const plan = Logic.planDayFromConfiguration(groups, shifts, { minimumShiftCount: 4, minimumTotalHours: 13.5, defaultNormalHours: 4.5, defaultOvertimeHours: 1.5, maximumOvertimeHours: 1.5 }, [], null);
  assert.deepEqual(plan.assignments.map((item) => item.shiftKey).sort(), ["a", "b", "c"]);
  assert.equal(plan.missingShiftCount, 1);
});

test("prefers post-overtime and falls back to pre-overtime at attendance boundary", () => {
  const group = [{ id: "g1", hostId: "h1", coHostId: "c1", defaultShiftId: "a", active: true }];
  const targets = { minimumShiftCount: 1, minimumTotalHours: 5.5, defaultNormalHours: 4.5, defaultOvertimeHours: 1.5, maximumOvertimeHours: 2 };
  const post = Logic.planDayFromConfiguration(group, [{ key: "a", startTime: "13:00", endTime: "17:30", active: true, allowOvertime: true }], targets, [], null);
  assert.deepEqual([post.assignments[0].overtimePlacement, post.assignments[0].overtimeStartTime, post.assignments[0].overtimeEndTime], ["after", "17:30", "18:30"]);
  const pre = Logic.planDayFromConfiguration(group, [{ key: "a", startTime: "19:00", endTime: "23:30", active: true, allowOvertime: true }], targets, [], null);
  assert.deepEqual([pre.assignments[0].overtimePlacement, pre.assignments[0].overtimeStartTime, pre.assignments[0].overtimeEndTime], ["before", "18:00", "19:00"]);
  assert.deepEqual(Logic.combinedLiveRange({ startTime: "19:00", endTime: "23:30", overtimeStartTime: "18:00", overtimeEndTime: "19:00" }), { startTime: "18:00", endTime: "23:30", placement: "before" });
});

test("caps each shift overtime and classifies excess live time as overtime", () => {
  const shifts = [{ key: "a", startTime: "13:00", endTime: "17:30", active: true, allowOvertime: true }];
  const groups = [{ id: "g1", hostId: "h1", coHostId: "c1", defaultShiftId: "a", active: true }];
  const targets = { minimumShiftCount: 1, minimumTotalHours: 8, defaultNormalHours: 4.5, defaultOvertimeHours: 1.5, maximumOvertimeHours: 1.5 };
  const plan = Logic.planDayFromConfiguration(groups, shifts, targets, [], null);
  assert.deepEqual([plan.baseHours, plan.overtimeHours, plan.totalHours, plan.missingHours], [4.5, 1.5, 6, 2]);
  const evaluated = Logic.evaluateDayTargets({ a: { hostId: "h1", coHostId: "c1", startTime: "13:00", endTime: "18:00" } }, shifts, targets);
  assert.deepEqual([evaluated.baseHours, evaluated.overtimeHours, evaluated.totalHours], [4.5, 0.5, 5]);
});

test("reports manual shortages when shifts or overtime capacity cannot reach targets", () => {
  const shifts = [{ key: "a", startTime: "08:00", endTime: "12:00", active: true, allowOvertime: true, overtimePriority: 1, order: 1 }, { key: "b", startTime: "13:00", endTime: "17:00", active: true, allowOvertime: false, order: 2 }];
  const groups = [{ id: "g1", hostId: "h1", coHostId: "c1", defaultShiftId: "a", active: true }];
  const plan = Logic.planDayFromConfiguration(groups, shifts, { minimumShiftCount: 2, minimumTotalHours: 10, defaultOvertimeHours: 1.5 }, [], null);
  assert.equal(plan.missingShiftCount, 1);
  assert.equal(plan.missingHours, 4.5);
  assert.equal(plan.needsManual, true);
});

test("re-evaluates configurable minimum counts and total hours", () => {
  const shifts = [{ key: "a", active: true }, { key: "b", active: true }];
  const day = { leavePeople: [], a: { hostId: "h1", coHostId: "c1", startTime: "08:00", endTime: "12:00", overtimeStartTime: "12:00", overtimeEndTime: "13:00" } };
  const result = Logic.evaluateDayTargets(day, shifts, { minimumShiftCount: 2, minimumTotalHours: 6 });
  assert.deepEqual([result.completeCount, result.totalHours, result.missingShiftCount, result.missingHours], [1, 5, 1, 1]);
});

test("re-evaluates guidance from the current schedule instead of stale generation metadata", () => {
  const day = {
    leavePeople: [{ personId: "old-part-time" }],
    autoSchedule: { scenario: "three", partTimeConflict: true },
    morning: { hostId: "h1", coHostId: "c1", startTime: "08:00", endTime: "12:30" },
    afternoon: { hostId: "h2", coHostId: "c2", startTime: "13:00", endTime: "17:30" },
    evening: { hostId: "h3", coHostId: "c3", startTime: "19:00", endTime: "23:30" },
    secondary: { hostId: "replacement-host", coHostId: "replacement-cohost", startTime: "13:30", endTime: "18:00" }
  };
  const result = Logic.evaluateDaySchedule(day);
  assert.equal(result.completeCount, 4);
  assert.equal(result.hasLeaveConflict, false);
});

test("detects overlapping assignments", () => {
  const people = [{ id: "a", name: "甲" }, { id: "b", name: "乙" }, { id: "c", name: "丙" }];
  const week = { monday: {
    morning: { hostId: "a", coHostId: "b", startTime: "08:00", endTime: "13:00" },
    afternoon: { hostId: "a", coHostId: "c", startTime: "12:30", endTime: "18:00" }
  } };
  const conflicts = Logic.findConflicts(week, people);
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].type, "overlap");
  assert.equal(conflicts[0].personName, "甲");
});

test("detects same person in both roles", () => {
  const people = [{ id: "a", name: "甲" }];
  const week = { monday: { morning: { hostId: "a", coHostId: "a", startTime: "08:00", endTime: "13:00" } } };
  assert.equal(Logic.findConflicts(week, people)[0].type, "same-role-person");
});

test("warns when a person on leave is scheduled", () => {
  const people = [{ id: "a", name: "甲" }];
  const week = { monday: {
    morning: { hostId: "a", coHostId: "", startTime: "08:00", endTime: "13:00" },
    leavePeople: [{ personId: "a", personNameSnapshot: "甲" }]
  } };
  assert.equal(Logic.findConflicts(week, people).some((item) => item.type === "leave-scheduled"), true);
});

test("migrates V1 data to unassigned V5 without losing schedules", () => {
  const v1 = { version: 1, people: [{ id: "a", name: "甲", active: true }], schedules: { "2026-10-05": { monday: { morning: { hostId: "a" } } } } };
  const result = Logic.migrateState(v1);
  assert.equal(result.version, 5);
  assert.deepEqual(result.rooms, []);
  assert.equal(result.people[0].employmentType, "formal");
  assert.deepEqual(result.schedules.unassigned.days["2026-10-05"].leavePeople, []);
  assert.equal(result.schedules.unassigned.days["2026-10-05"].morning.hostId, "a");
  assert.equal(result.schedules.unassigned.roomNameSnapshot, "未指定直播间");
  assert.equal(result.settings.shiftDefinitions.length, 4);
  assert.deepEqual(result.settings.scheduleTargets, { minimumShiftCount: 4, minimumTotalHours: 18, defaultNormalHours: 4.5, defaultOvertimeHours: 1.5, maximumOvertimeHours: 1.5 });
  assert.deepEqual(result.channelSummaryRecords, {});
});

test("migrates a single-room V2 week into that room", () => {
  const v2 = { version: 2, rooms: [{ id: "r1", name: "一号间", account: "room-1", active: true }], people: [], schedules: {
    "2026-10-05": { monday: { morning: { roomId: "r1", roomNameSnapshot: "一号间", roomAccountSnapshot: "room-1", hostId: "a", startTime: "08:00", endTime: "13:00" }, leavePeople: [] } }
  } };
  const result = Logic.migrateState(v2);
  assert.equal(result.version, 5);
  assert.equal(result.schedules.r1.roomId, "r1");
  assert.equal(result.schedules.r1.days["2026-10-05"].morning.roomId, undefined);
});

test("keeps mixed-room V2 weeks unassigned", () => {
  const v2 = { version: 2, rooms: [], people: [], schedules: { "2026-10-05": { monday: {
    morning: { roomId: "r1", hostId: "a" }, afternoon: { roomId: "r2", hostId: "b" }, leavePeople: []
  } } } };
  assert.ok(Logic.migrateState(v2).schedules.unassigned.days["2026-10-05"]);
});

test("returns non-empty history from the last three months and every saved future date", () => {
  const filled = { morning: { hostId: "a", startTime: "08:00", endTime: "13:00" }, leavePeople: [], leaveNote: "" };
  const state = { schedules: { r1: { days: {
    "2027-06-01": filled,
    "2026-10-12": {},
    "2026-10-09": filled,
    "2026-10-05": filled,
    "2026-07-09": filled,
    "2026-07-08": filled
  } } } };
  const records = Logic.historyRecords(state, "2026-10-09");
  assert.deepEqual(records.map((item) => item.dateKey), ["2027-06-01", "2026-10-09", "2026-10-05", "2026-07-09"]);
});

test("clears only selected schedule days while preserving leave information", () => {
  const roomSchedule = { days: {
    "2026-10-01": { morning: { hostId: "a" }, overtimeMorning: { hostId: "b" }, autoSchedule: { scenario: "two" }, leavePeople: [{ personId: "c" }], leaveNote: "年假", updatedAt: "old" },
    "2026-10-02": { afternoon: { hostId: "d" }, leavePeople: [], leaveNote: "" },
    "2026-10-03": { evening: { hostId: "e" }, leavePeople: [], leaveNote: "区间外" }
  } };
  const cleared = Logic.clearScheduleDays(roomSchedule, ["2026-10-01", "2026-10-02"], ["morning", "afternoon", "evening", "overtimeMorning"], "new-time");
  assert.equal(cleared, 2);
  assert.deepEqual(roomSchedule.days["2026-10-01"].leavePeople, [{ personId: "c" }]);
  assert.equal(roomSchedule.days["2026-10-01"].leaveNote, "年假");
  assert.equal(roomSchedule.days["2026-10-01"].morning, undefined);
  assert.equal(roomSchedule.days["2026-10-01"].overtimeMorning, undefined);
  assert.equal(roomSchedule.days["2026-10-01"].autoSchedule, undefined);
  assert.equal(roomSchedule.days["2026-10-01"].updatedAt, "new-time");
  assert.equal(roomSchedule.days["2026-10-02"].afternoon, undefined);
  assert.equal(roomSchedule.days["2026-10-03"].evening.hostId, "e");
});

test("builds flexible date ranges across week boundaries", () => {
  assert.deepEqual(Logic.dateRange("2026-10-03", "2026-10-06").map(Logic.toIsoDate), ["2026-10-03", "2026-10-04", "2026-10-05", "2026-10-06"]);
});

test("accepts one and fourteen day ranges", () => {
  assert.equal(Logic.dateRange("2026-10-01", "2026-10-01").length, 1);
  assert.equal(Logic.dateRange("2026-10-01", "2026-10-14").length, 14);
});

test("rejects reversed and overlong ranges", () => {
  assert.throws(() => Logic.dateRange("2026-10-02", "2026-10-01"));
  assert.throws(() => Logic.dateRange("2026-10-01", "2026-10-15"));
});

test("selects a hotel-style date range in two steps", () => {
  assert.deepEqual(Logic.chooseRangeDate("", "2026-10-05"), { start: "2026-10-05", end: "", complete: false });
  assert.deepEqual(Logic.chooseRangeDate("2026-10-05", "2026-10-11"), { start: "2026-10-05", end: "2026-10-11", complete: true });
});

test("restarts the range when an earlier date is clicked and rejects day fifteen", () => {
  assert.deepEqual(Logic.chooseRangeDate("2026-10-05", "2026-10-03"), { start: "2026-10-03", end: "", complete: false });
  assert.throws(() => Logic.chooseRangeDate("2026-10-01", "2026-10-15"), /最多支持14天/);
});

test("migrates V3 leave notes to concrete dates", () => {
  const v3 = { version: 3, people: [], rooms: [], settings: {}, schedules: { r1: { "2026-10-05": { roomId: "r1", roomNameSnapshot: "一号间", days: { monday: { leavePeople: [], leaveNote: "周本休" } } } } } };
  const result = Logic.migrateState(v3);
  assert.equal(result.schedules.r1.days["2026-10-05"].leaveNote, "周本休");
});

console.log("All logic tests passed.");
