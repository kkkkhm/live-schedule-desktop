const assert = require("node:assert/strict");
const Excel = require("../excel.js");
const ExcelJS = require("../vendor/exceljs.min.js");

function test(name, fn) {
  try { fn(); console.log(`PASS ${name}`); }
  catch (error) { console.error(`FAIL ${name}`); throw error; }
}

function sampleState() {
  return {
    people: [
      { id: "h1", name: "主播甲", active: true, canHost: true },
      { id: "c1", name: "副播甲", active: true, canCoHost: true },
      { id: "h2", name: "主播乙", active: true, canHost: true },
      { id: "c2", name: "副播乙", active: true, canCoHost: true }
    ],
    rooms: [
      { id: "r1", name: "主直播间", account: "main", active: true },
      { id: "r2", name: "副直播间", account: "sub", active: true }
    ],
    settings: {
      shiftDefinitions: [
        { key: "s1", label: "早班", roomId: "r1", startTime: "08:00", endTime: "12:30", active: true, order: 1 },
        { key: "s2", label: "中班", roomId: "r2", startTime: "13:00", endTime: "17:30", active: true, order: 2 }
      ],
      formalGroups: [
        { id: "g1", name: "一组", hostId: "h1", coHostId: "c1", defaultShiftId: "s1", active: true, order: 1 },
        { id: "g2", name: "二组", hostId: "h2", coHostId: "c2", defaultShiftId: "s2", active: true, order: 2 }
      ],
      partTimeGroup: { id: "pt", name: "补班组", hostId: "h2", coHostId: "c1" }
    },
    schedules: {
      r1: { days: { "2026-10-01": { s1: { templateGroupId: "g1", hostId: "h1", coHostId: "c1", roomId: "r1", startTime: "08:00", endTime: "12:30", overtimeStartTime: "12:30", overtimeEndTime: "14:00", note: "测试" } } } },
      r2: { days: {} }
    }
  };
}

test("builds a stable configuration fingerprint independent of array order", () => {
  const first = sampleState();
  const second = sampleState();
  second.rooms.reverse();
  second.people.reverse();
  second.settings.shiftDefinitions.reverse();
  second.settings.formalGroups.reverse();
  assert.equal(Excel.configurationFingerprint(first), Excel.configurationFingerprint(second));
  second.rooms[0].name = "已修改";
  assert.notEqual(Excel.configurationFingerprint(first), Excel.configurationFingerprint(second));
});

test("builds one to fourteen horizontal template dates and active groups", () => {
  const state = sampleState();
  const model = Excel.buildScheduleTemplateModel(state, "2026-10-01", "2026-10-14", false);
  assert.equal(model.dates.length, 14);
  assert.deepEqual(model.rooms.map((room) => room.id), ["r1", "r2"]);
  assert.deepEqual(model.groups.map((group) => group.id), ["g1", "g2", "pt"]);
  assert.throws(() => Excel.buildScheduleTemplateModel(state, "2026-10-01", "2026-10-15", false), /14天/);
});

test("prefills a group day from its saved template group id", () => {
  const model = Excel.buildScheduleTemplateModel(sampleState(), "2026-10-01", "2026-10-01", true);
  const day = model.groups.find((group) => group.id === "g1").days["2026-10-01"];
  assert.equal(day.shiftId, "s1");
  assert.equal(day.roomId, "r1");
  assert.equal(day.liveTime, "08:00-12:30");
  assert.equal(day.overtimeTime, "12:30-14:00");
  assert.equal(day.attendanceTime, "08:00-16:00");
  assert.equal(day.note, "测试");
});

(async () => {
  const workbook = await Excel.createScheduleTemplateWorkbook(ExcelJS, sampleState(), "2026-10-01", "2026-10-07", true);
  const buffer = await workbook.xlsx.writeBuffer();
  const reopened = new ExcelJS.Workbook();
  await reopened.xlsx.load(buffer);
  const fill = reopened.getWorksheet("排班填写表");
  const config = reopened.getWorksheet("模板配置");
  const options = reopened.getWorksheet("可选项");
  assert.ok(fill && reopened.getWorksheet("填写说明") && config && options);
  assert.equal(config.state, "hidden");
  assert.equal(options.state, "hidden");
  assert.equal(fill.views[0].xSplit, 3);
  assert.equal(fill.views[0].ySplit, 3);
  assert.equal(fill.getRow(2).cellCount, 10);
  assert.equal(fill.getCell("D4").dataValidation.type, "list");
  assert.equal(fill.getCell("D5").dataValidation.type, "list");
  assert.equal(fill.getCell("D7").value, "08:00-12:30");
  assert.equal(fill.getCell("D9").value, "12:30-14:00");
  assert.equal(fill.getCell("D10").value, "测试");
  assert.equal(fill.getCell("D7").protection.locked, false);
  assert.ok(config.rowCount > 20);
  console.log("PASS creates a protected four-sheet horizontal schedule workbook");

  fill.getCell("D4").value = "早班";
  fill.getCell("D5").value = "正常";
  fill.getCell("D6").value = "正常";
  fill.getCell("D7").value = "08:00-12:30";
  const parsed = Excel.parseScheduleTemplateWorkbook(reopened, sampleState());
  assert.deepEqual(parsed.errors, []);
  assert.equal(parsed.entries[0].dateKey, "2026-10-01");
  assert.equal(parsed.entries[0].groupId, "g1");
  assert.equal(parsed.entries[0].shiftId, "s1");
  assert.equal(parsed.entries[0].roomId, "r1");
  assert.equal(parsed.entries[0].startTime, "08:00");
  assert.equal(parsed.entries[0].attendanceTime, "08:00-16:00");
  console.log("PASS parses mapped schedule entries from the workbook");

  fill.getCell("D8").value = "13:00-17:30";
  const multipleRooms = Excel.parseScheduleTemplateWorkbook(reopened, sampleState());
  assert.ok(multipleRooms.errors.some((item) => item.code === "multiple-rooms"));
  fill.getCell("D8").value = "";
  fill.getCell("D5").value = "本休";
  const leaveConflict = Excel.parseScheduleTemplateWorkbook(reopened, sampleState());
  assert.ok(leaveConflict.errors.some((item) => item.code === "leave-live-conflict"));
  console.log("PASS blocks multiple rooms and leave-live contradictions");

  const importState = sampleState();
  importState.settings.lastRoomKey = "r1";
  importState.schedules.r1.days["2026-10-01"].s1.performanceAmount = 10000;
  const parsedImport = {
    errors: [], warnings: [], entries: [
      { dateKey: "2026-10-01", groupId: "g1", shiftId: "s1", hostId: "h1", coHostId: "c1", hostStatus: "正常", coHostStatus: "正常", roomId: "r1", startTime: "08:30", endTime: "12:30", overtimeStartTime: "", overtimeEndTime: "", note: "已修改" },
      { dateKey: "2026-10-02", groupId: "g2", shiftId: "s2", hostId: "h2", coHostId: "c2", hostStatus: "正常", coHostStatus: "正常", roomId: "r2", startTime: "13:00", endTime: "17:30", overtimeStartTime: "", overtimeEndTime: "", note: "新增" }
    ]
  };
  const preview = Excel.prepareScheduleImport(importState, parsedImport, "merge");
  assert.deepEqual(preview.counts, { added: 1, updated: 1, skipped: 0 });
  assert.equal(importState.schedules.r1.days["2026-10-01"].s1.startTime, "08:00");
  assert.equal(preview.nextState.schedules.r1.days["2026-10-01"].s1.startTime, "08:30");
  assert.equal(preview.nextState.schedules.r1.days["2026-10-01"].s1.performanceAmount, 10000);
  assert.equal(preview.nextState.schedules.r1.days["2026-10-02"].s2.roomId, "r2");
  console.log("PASS prepares schedule imports transactionally and preserves performance");

  const blankEditableFields = { errors: [], warnings: [], entries: [{ ...parsedImport.entries[0], note: "", overtimeStartTime: "", overtimeEndTime: "" }] };
  const merged = Excel.prepareScheduleImport(importState, blankEditableFields, "merge");
  const replaced = Excel.prepareScheduleImport(importState, blankEditableFields, "replace");
  assert.equal(merged.nextState.schedules.r1.days["2026-10-01"].s1.note, "测试");
  assert.equal(merged.nextState.schedules.r1.days["2026-10-01"].s1.overtimeStartTime, "12:30");
  assert.equal(replaced.nextState.schedules.r1.days["2026-10-01"].s1.note, "");
  assert.equal(replaced.nextState.schedules.r1.days["2026-10-01"].s1.overtimeStartTime, "");
  console.log("PASS applies merge and complete replacement modes independently");

  const blocked = Excel.prepareScheduleImport(importState, { entries: [], errors: [{ code: "blocked", message: "错误" }], warnings: [] }, "merge");
  assert.equal(blocked.nextState, null);
  assert.equal(blocked.counts.added, 0);
  console.log("PASS refuses to prepare a partial state when blocking errors exist");

  const performanceBook = Excel.createPerformanceWorkbook(ExcelJS, importState, "2026-10-01", "2026-10-07");
  const performanceBuffer = await performanceBook.xlsx.writeBuffer();
  const reopenedPerformance = new ExcelJS.Workbook();
  await reopenedPerformance.xlsx.load(performanceBuffer);
  const performanceSheet = reopenedPerformance.getWorksheet("业绩数据");
  assert.deepEqual(performanceSheet.getRow(1).values.slice(1), ["日期", "直播间名称", "直播间账号", "班次", "主播", "副播", "业绩金额", "系统记录标识"]);
  performanceSheet.getCell("G2").value = 12000;
  const parsedPerformance = Excel.parsePerformanceWorkbook(reopenedPerformance, importState);
  assert.deepEqual(parsedPerformance.errors, []);
  assert.equal(parsedPerformance.entries[0].amount, 12000);
  const performancePreview = Excel.preparePerformanceImport(importState, parsedPerformance);
  assert.equal(performancePreview.counts.updated, 1);
  assert.equal(performancePreview.nextState.schedules.r1.days["2026-10-01"].s1.performanceAmount, 12000);
  assert.equal(performancePreview.nextState.schedules.r1.days["2026-10-01"].s1.startTime, "08:00");
  console.log("PASS round-trips performance without changing schedule fields");
  console.log("All Excel domain tests passed.");
})().catch((error) => { console.error("FAIL creates horizontal schedule workbook"); throw error; });
