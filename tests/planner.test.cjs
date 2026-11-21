const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
globalThis.XLSX = require('../vendor/xlsx.full.min.js');
globalThis.XinyunLedger = require('../data/ledger.json');
require('../src/catalog.js');
require('../src/campaign.js');
require('../src/planner.js');
require('../src/files.js');

const C = globalThis.XinyunCatalog;
const P = globalThis.XinyunPlanner;
const F = globalThis.XinyunFiles;
const noData = { inventory: [], coverage: [] };
const options = { brief: 'food', budget: 2000000, types: ['bus', 'metro'], start: '2027-06-01', end: '2027-06-30',
  discount: 100, priceMode: 'mid', mode: 'draft' };
const full = { ...options, mode: 'verified' };
const red = { type: 'bus', name: '136', id: 'sample-bus', grade: 'S', format: '大三侧', free: 3,
  start: full.start, end: full.end, checked: '2026-11-21', source: '测试数据' };
const geo = { type: 'bus', name: '136路', id: red.id, anchor: 'roastery', radius: 500, distance: 130,
  footfall: 2500, month: '2023-05', metric: '日均人次', source: '测试数据' };

test('all three budgets produce a bounded plan for each industry and media choice', () => {
  for (const brief of C.briefs) {
    for (const types of [['bus'], ['metro'], ['bus', 'metro']]) {
      let previous = new Map();
      for (const budget of [1000000, 2000000, 5000000]) {
        const plan = P.build({ ...options, brief: brief.id, budget, types, reservePercent: 5 }, noData);
        assert.ok(plan.rows.length, JSON.stringify({ brief: brief.id, types, budget }));
        assert.ok(plan.total + plan.reserve <= budget);
        const next = new Map(plan.rows.map(row => [row.key, row.quantity]));
        for (const [key, quantity] of previous) assert.ok(next.get(key) >= quantity, 'higher tier keeps earlier placements');
        previous = next;
        assert.ok(plan.low <= plan.total && plan.total <= plan.high);
        assert.ok(plan.rows.every(row => row.quantity <= row.cap && row.quantity > 0 && types.includes(row.type)));
        assert.equal(plan.verified, 0);
        assert.equal(plan.execution.install.reduce((sum, batch) => sum + batch.count, 0),
          plan.breakdown.bus.count + plan.breakdown.metro.count);
      }
    }
  }
});

test('brief classification extracts explicit inputs and leaves ambiguous fields for review', () => {
  const brief = XinyunCampaign.fromText('咖啡新品要做旗舰到店引流，200万，公交和地铁，2027年6月1日至2027年6月30日');
  assert.equal(brief.brief, 'food');
  assert.equal(brief.goal, '到店');
  assert.equal(brief.budget, 2000000);
  assert.deepEqual(brief.types, ['bus', 'metro']);
  assert.deepEqual(brief.period, ['2027-06-01', '2027-06-30']);
  assert.equal(XinyunCampaign.fromText('星巴克，主目标到店').brief, 'food');
  assert.equal(XinyunCampaign.fromText('比较星巴克或招行').brief, undefined);
  const ambiguous = XinyunCampaign.fromText('100万或500万，公交不投，日期2027-02-29至2027-03-01');
  assert.equal(ambiguous.budget, undefined);
  assert.deepEqual(ambiguous.types, []);
  assert.equal(ambiguous.period, null);
});

test('historical and partial evidence cannot verify a later booking', () => {
  assert.equal(P.build(full, noData).rows.length, 0);
  assert.equal(P.build(full, { inventory: [red], coverage: [] }).rows.length, 0);
  assert.equal(P.build({ ...full, end: '2027-06-29' }, { inventory: [red], coverage: [geo] }).rows.length, 0);
  const exact = P.build(full, { inventory: [red], coverage: [geo] });
  assert.equal(exact.verified, 1);
  assert.equal(exact.rows[0].quantity, 3);
  assert.equal(exact.total, 202500);
  assert.equal(P.build(full, { inventory: [red, { ...red, free: 0 }], coverage: [geo] }).rows.length, 0);
});

test('ID-less ambiguous coverage is not assigned to two resources', () => {
  const duplicate = { ...red, id: 'sample-bus-2', format: '车身三侧' };
  assert.equal(P.build(full, { inventory: [red, duplicate], coverage: [{ ...geo, id: '' }] }).rows.length, 0);
  assert.equal(P.build(full, { inventory: [red, duplicate], coverage: [{ ...geo, id: '', format: red.format }] }).rows.length, 1);
});

test('unknown metro production area is surfaced and excluded in verification mode', () => {
  const metro = { ...red, type: 'metro', name: '南京西路站5号口', id: 'sample-metro', grade: 'A+' };
  const coverage = [{ ...geo, type: 'metro', id: metro.id, name: metro.name }];
  const unknown = P.build(full, { inventory: [metro], coverage });
  assert.equal(unknown.rows.length, 0);
  assert.equal(unknown.counts.missingPrice, 1);
  const known = P.build(full, { inventory: [{ ...metro, area: 80, free: 1 }], coverage });
  assert.equal(known.total, 208000);
});

test('station-level metro evidence and assumed area remain planning evidence', () => {
  const metro = { ...red, type: 'metro', name: '南京西路4号口', id: 'sample-metro', grade: 'A++', free: 1 };
  const coverage = [{ ...geo, type: 'metro', id: metro.id, name: metro.name, stationLevel: true }];
  const real = { inventory: [metro], coverage };
  const draft = P.build({ ...options, types: ['metro'] }, real);
  assert.equal(draft.rows.find(row => row.id === metro.id).areaAssumed, true);
  assert.equal(draft.verified, 0);
  assert.equal(P.build(full, real).rows.length, 0);
  assert.equal(P.build(full, { ...real, inventory: [{ ...metro, area: 60 }] }).rows.length, 0);
});

test('calendar month billing and caps are applied to every row', () => {
  assert.equal(P.billingMonths('2027-01-01', '2027-01-31'), 1);
  assert.equal(P.billingMonths('2027-01-31', '2027-02-28'), 2);
  assert.equal(P.billingMonths('2027-06-16', '2027-07-15'), 1);
  assert.equal(P.billingMonths('2027-06-16', '2027-07-16'), 2);
  assert.throws(() => P.build({ ...options, start: '2027-02-29' }, noData));
  const first = P.build(options, noData);
  const next = P.build({ ...options, excluded: [first.rows[0].key] }, noData);
  assert.ok(next.rows.every(row => row.key !== first.rows[0].key));
});

test('CSV and XLSX imports accept two source shapes and retain snapshot provenance', () => {
  const csv = F.csv([F.headers.inventory, ['公交', 'sample-bus', '136', 'S', '大三侧', '公交公司', 3, '', '', '', '']]);
  const defaults = { type: 'bus', start: red.start, end: red.end, checked: red.checked };
  const parsed = F.readRecords(Buffer.from(csv), 'inventory', defaults, '红豆.csv');
  assert.equal(parsed.parsed[0].free, 3);
  assert.equal(parsed.parsed[0].source, '红豆.csv');
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([
    F.headers.coverage, ['bus', 'sample-bus', '136路', '', '', 'roastery', 500, 130, 2500, '2023-05', '日均人次', ''],
  ]), '覆盖分析');
  const coverage = F.readRecords(XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }), 'coverage', {}, '覆盖.xlsx');
  assert.equal(coverage.parsed[0].footfall, 2500);
  const actual = P.build(full, { inventory: parsed.parsed, coverage: coverage.parsed });
  assert.equal(actual.verified, 1);
  assert.equal(actual.rows[0].evidence[0].distance, 130);
  assert.equal(F.mergeRows([red], [{ ...red, free: 0, checked: '2026-11-20' }], 'inventory')[0].free, 3);
  assert.throws(() => F.mergeRows([], [red, { ...red, free: 2 }], 'inventory'), /重复/);
});

test('platform coverage import expands multiple centers without reusing an aggregate distance', () => {
  const csv = F.csv([
    ['线路名称', '媒体类型', '覆盖中心点', '覆盖半径', '最近距离'],
    ['95路', '公交线路', '上海新天地、南京西路789号', '500米', '273米'],
    ['地铁13号线 - 南京西路', '地铁出入口', '南京西路789号', '500米', '189米'],
  ]);
  const { parsed, errors } = F.readRecords(Buffer.from(csv), 'coverage', {}, '平台测试.csv');
  assert.deepEqual(errors, []);
  assert.deepEqual(parsed.map(row => [row.type, row.anchor, row.distance, row.stationLevel]),
    [['bus', 'xintiandi', null, false], ['bus', 'roastery', null, false], ['metro', 'roastery', 189, true]]);
});

test('workbook and CSV totals agree with the displayed proposal', () => {
  const plan = P.build(options, noData);
  const bytes = F.xlsx(plan);
  const book = XLSX.read(bytes, { type: 'array', cellDates: true });
  assert.deepEqual(book.SheetNames, ['方案摘要', '媒介明细', '排期与监测', '圈选与覆盖']);
  const rows = XLSX.utils.sheet_to_json(book.Sheets['媒介明细'], { header: 1 });
  assert.equal(rows.slice(1).reduce((sum, row) => sum + row[18], 0), plan.total);
  assert.ok(rows[1][8] instanceof Date);
  const csv = F.csv(F.planRows(plan));
  assert.ok(csv.startsWith('\uFEFF'));
  assert.ok(csv.includes('"待核验"'));
  if (process.env.XINYUN_TEST_EXPORTS === '1') {
    const output = path.join(root, 'test-output');
    fs.mkdirSync(output, { recursive: true });
    fs.writeFileSync(path.join(output, '报价测试.xlsx'), Buffer.from(bytes));
    fs.writeFileSync(path.join(output, '报价测试.csv'), csv);
  }
});
