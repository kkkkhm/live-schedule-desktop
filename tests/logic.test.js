const assert = require("node:assert/strict");
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

test("calculates host and co-host statistics", () => {
  const people = [{ id: "a", name: "甲" }, { id: "b", name: "乙" }];
  const week = { monday: { morning: { hostId: "a", coHostId: "b", startTime: "08:00", endTime: "13:00" } } };
  const result = Logic.calculateStatistics(week, people);
  assert.equal(result.sessionCount, 1);
  assert.equal(result.totalPersonHours, 10);
  const byName = Object.fromEntries(result.rows.map((row) => [row.name, row]));
  assert.deepEqual([byName["甲"].hostHours, byName["甲"].coHostHours, byName["甲"].totalHours], [5, 0, 5]);
  assert.deepEqual([byName["乙"].hostHours, byName["乙"].coHostHours, byName["乙"].totalHours], [0, 5, 5]);
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

console.log("All logic tests passed.");
