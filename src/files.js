(() => {
  const P = globalThis.XinyunPlanner;
  const { media } = P;
  const H = {
    id: ['资源ID', '媒体ID', '资源编码', '媒体编码', '点位编号', '地铁编号', 'id'],
    name: ['线路/点位', '线路名称', '线路名', '线路', '公交线路', '地铁点位', '地铁名称', '站点名称', '站点', '点位名称', '媒体名称', 'name'],
    type: ['媒体', '媒体库', '大类', '媒体类别', '覆盖媒体类型', 'type'],
    grade: ['等级', '线路等级', '点位等级', '媒体等级', '级别', 'grade'],
    format: ['形式', '媒体形式', '车型', '媒体类型', 'format'],
    operator: ['运营公司', '行车公司', '公交公司', '所属公司', 'operator'],
    free: ['空车数', '空位数', '可售数量', '空闲数量', '空闲资源', 'free'],
    area: ['面积㎡', '面积', '点位面积', '媒体面积', '面积(m2)', 'area'],
    start: ['查询开始', '查询开始日期', '查询起', 'start'],
    end: ['查询结束', '查询结束日期', '查询止', 'end'],
    checked: ['导出日期', '核验日期', '快照日期', 'checked'],
    exit: ['出入口号', '出口号', '出口编号', 'exit'],
    anchor: ['圈选中心', '覆盖中心点', '地标', '圈选ID', '门店', 'anchor'],
    radius: ['半径米', '半径', '圈选半径', '覆盖半径', 'radius'],
    distance: ['距离米', '距离', '最近距离', 'distance'],
    footfall: ['历史人流', '人次', '日均人次', '人流量', 'footfall'],
    month: ['人流月份', '历史月份', '数据月份', 'month'],
    metric: ['人流口径', '统计口径', '指标', 'metric'],
    ai: ['AI线路链接', '地图链接', 'ai'],
  };
  const headers = {
    inventory: ['媒体', '资源ID', '线路/点位', '等级', '形式', '运营公司', '空车数', '面积㎡', '查询开始', '查询结束', '导出日期'],
    coverage: ['媒体', '资源ID', '线路/点位', '形式', '运营公司', '圈选中心', '半径米', '距离米', '历史人流', '人流月份', '人流口径', 'AI线路链接'],
  };
  const normalized = value => P.identity(value).toLowerCase().replace(/[（）()]/g, '');
  const clean = value => String(value ?? '').trim();
  const names = Object.values(H).flat().map(normalized);
  const typeOf = value => ({ bus: 'bus', metro: 'metro', 公交: 'bus', 公交车: 'bus', 公交线路: 'bus', 公交车身: 'bus', 公交媒体库: 'bus',
    地铁: 'metro', 地铁出入口: 'metro', 地铁媒体库: 'metro' })[clean(value)];

  function date(value) {
    if (value instanceof Date) return P.ISO(value);
    if (typeof value === 'number') {
      const serial = XLSX.SSF.parse_date_code(value);
      if (serial) return [serial.y, serial.m, serial.d].map((n, i) => String(n).padStart(i === 0 ? 4 : 2, '0')).join('-');
    }
    return clean(value).replace(/\//g, '-').replace(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/,
      (_, y, m, d) => y + '-' + m.padStart(2, '0') + '-' + d.padStart(2, '0'));
  }

  function numeric(value) {
    const text = clean(value).replace(/[,，]/g, '').replace(/\s*(?:㎡|平方米|m²|m2|米|辆|个|人次)$/i, '');
    return text && /^\d+(?:\.\d+)?$/.test(text) ? Number(text) : null;
  }

  function usableLink(value) {
    try {
      const url = new URL(value);
      return (url.protocol === 'https:' || url.protocol === 'http:') && url.hostname === 'flairmedia.com.cn'
        && !url.username && !url.password ? url.href : '';
    } catch { return ''; }
  }

  function readRecords(bytes, kind, defaults, source) {
    const zip = new Uint8Array(bytes);
    const isCsv = /\.csv$/i.test(source);
    let input = bytes;
    if (isCsv) {
      try { input = new TextDecoder('utf-8', { fatal: true }).decode(zip); }
      catch { input = new TextDecoder('gb18030').decode(zip); }
    }
    const book = XLSX.read(input, { type: isCsv ? 'string' : 'array', cellDates: true, raw: isCsv, sheetRows: 12000 });
    const parsed = [];
    const errors = [];
    let recognized = false;
    for (const sheetName of book.SheetNames) {
      const sheet = XLSX.utils.sheet_to_json(book.Sheets[sheetName], { header: 1, defval: '', blankrows: false });
      const headerIndex = sheet.slice(0, 12).findIndex(row => {
        const columns = row.map(normalized);
        return columns.some(item => (kind === 'inventory' ? H.free : [...H.id, ...H.name]).map(normalized).includes(item))
          && columns.some(item => H.name.map(normalized).includes(item)) && columns.filter(item => names.includes(item)).length >= 2;
      });
      if (headerIndex < 0) continue;
      recognized = true;
      const columns = sheet[headerIndex].map(normalized);
      const indices = Object.fromEntries(Object.entries(H).map(([key, aliases]) => [key, aliases.map(normalized)
        .map(alias => columns.indexOf(alias)).find(index => index >= 0) ?? -1]));
      for (let index = headerIndex + 1; index < sheet.length; index++) {
        const raw = sheet[index];
        const col = key => raw[indices[key]] ?? '';
        let name = clean(col('name'));
        const id = clean(col('id'));
        if ((!name && !id) || /^(合计|总计|小计|说明)$/.test(name)) continue;
        const format = clean(col('format'));
        const rowType = clean(col('type')) || (kind === 'coverage' && typeOf(format) ? format : '');
        const type = rowType ? typeOf(rowType) : defaults.type;
        const exit = clean(col('exit'));
        if (type === 'metro' && exit && name && !name.endsWith(exit)) name += exit;
        const common = { id, name, type, format: rowType === format ? '' : format, operator: clean(col('operator')), source };
        try {
          if (!type || !name) throw new Error('缺少媒体类型或线路/点位名称');
          if (kind === 'inventory') {
            const start = date(col('start') || defaults.start);
            const end = date(col('end') || defaults.end);
            const checked = date(col('checked') || defaults.checked);
            const grade = P.identity(col('grade')).toUpperCase();
            const free = numeric(col('free'));
            if (!P.rangeOK(start, end) || !P.validDay(checked)) throw new Error('缺少有效的查询起止日期或导出日期');
            if (!Number.isSafeInteger(free) || free > 10000) throw new Error('需要整数空车数');
            parsed.push({ ...common, start, end, checked, grade, free, area: numeric(col('area')) });
          } else {
            const { locations, locationAliases } = globalThis.XinyunCatalog;
            const centers = clean(col('anchor') || defaults.anchor).split(/[、;；,，\n]+/).map(P.identity).filter(Boolean);
            const anchors = [...new Set(centers.map(value => locations[value] || locations[locationAliases[value]]
              || Object.values(locations).find(zone => P.identity(zone.name) === value)).filter(Boolean))];
            const radius = numeric(col('radius') || defaults.radius);
            const distance = numeric(col('distance'));
            if (!anchors.length || !radius || (distance !== null && distance > radius)) throw new Error('请选择有效圈选中心和半径，距离不得超过半径');
            if (centers.length > anchors.length) errors.push(sheetName + ' 行 ' + (index + 1) + ' · 部分圈选中心未匹配');
            const rawMonth = date(col('month')).replace(/^(2023)年(\d{1,2})月$/, '$1-$2');
            const month = /^2023-(0?[1-9]|1[0-2])(?:-\d{2})?$/.test(rawMonth) ? '2023-' + rawMonth.split('-')[1].padStart(2, '0') : '';
            const metric = clean(col('metric'));
            const footfall = month && metric ? numeric(col('footfall')) : null;
            const stationLevel = type === 'metro' && !(/^(?:SHDT-)/i.test(id) || /\d[A-Za-z]?号(?:口|出入口)|出口[A-Za-z0-9]/.test(name));
            for (const anchor of anchors) parsed.push({ ...common, anchor: anchor.id, radius, distance: centers.length === 1 ? distance : null,
              footfall, month, metric, stationLevel, ai: usableLink(col('ai')) });
          }
        } catch (error) { errors.push(sheetName + ' 行 ' + (index + 1) + ' · ' + error.message); }
      }
    }
    if (!recognized) throw new Error('找不到兼容的表头。请下载导入模板，然后填写或映射导出列。');
    if (!parsed.length) throw new Error(errors[0] || '工作表里没有可导入的资源。');
    return { parsed, errors };
  }

  function mergeRows(existing, incoming, kind) {
    const key = kind === 'inventory'
      ? row => [P.resourceKey(row), row.start, row.end].join('|')
      : row => [row.anchor, row.radius, P.resourceKey(row)].join('|');
    const rows = new Map(existing.map(row => [key(row), row]));
    const conflicts = new Set();
    const batch = new Map();
    for (const row of incoming) {
      const id = key(row);
      const previous = batch.get(id);
      if (previous && JSON.stringify(previous) !== JSON.stringify(row)) conflicts.add(id);
      batch.set(id, row);
    }
    if (conflicts.size) throw new Error('文件内有 ' + conflicts.size + ' 组重复资源且数据不同。请补充唯一资源 ID 或检查重复行。');
    for (const [id, row] of batch) {
      const previous = rows.get(id);
      if (kind === 'inventory' && previous && previous.checked > row.checked) continue;
      rows.set(id, row);
    }
    return [...rows.values()];
  }

  function planRows(plan) {
    const { locations } = globalThis.XinyunCatalog;
    const { options, brief, rows } = plan;
    return [
      ['客户', '行业', '媒体', '线路/点位', '等级', '形式', '媒体单位', '数量', '开始日期', '结束日期', '计费月',
        '刊例低位/单位月', '刊例高位/单位月', '刊例测算/单位月', '折扣%', '制作费/单位', '发布费小计', '制作费小计',
        '报价小计', '区间低位', '区间高位', '数量依据', '圈选地标', '覆盖来源', '库存来源', '库存快照日期', '计价来源',
        '资源ID', '地铁面积㎡', '库存查询开始', '库存查询结束', '资源状态', '地铁面积依据', '预算模块'],
      ...rows.map(row => {
        const q = row.quantity;
        const c = row.cost;
        return [brief.name, brief.industry, media[row.type], P.textName(row), row.grade, row.format, row.type === 'bus' ? '辆' : '处',
          q, options.start, options.end, plan.months, c.monthlyLow, c.monthlyHigh, c.rateAt, options.discount, c.make, q * c.release,
          q * c.make, q * c.total, q * c.low, q * c.high,
          row.inventoryOK ? row.free : '待核验',
          row.zoneIds.map(id => locations[id].name).join(' / '),
          row.evidence.length ? [...new Set(row.evidence.map(item => item.source + (item.stationLevel ? ' · 站级覆盖' : '')))].join(' / ') : '策略圈选 · 待平台核验',
          row.source, row.checked, c.label, row.id || '', row.area || '', row.start || '', row.end || '',
          row.inventoryOK && P.hasExactCoverage(row) && !row.areaAssumed ? '档期与覆盖已匹配'
            : row.inventoryOK ? '档期有快照 · 覆盖或计价待核' : '待核验',
          row.area ? (row.areaAssumed ? '测算假设' : '导入的点位面积') : '',
          Object.entries(row.modules).map(([label, count]) => label + ' ' + count).join(' / ')];
      }),
    ];
  }

  function csv(matrices) {
    const cell = value => {
      let text = value instanceof Date ? P.ISO(value) : String(value ?? '');
      if (typeof value === 'string' && /^\s*[=+\-@]/.test(text)) text = "'" + text;
      return '"' + text.replace(/"/g, '""') + '"';
    };
    return '\uFEFF' + matrices.map(row => row.map(cell).join(',')).join('\r\n') + '\r\n';
  }

  function xlsx(plan) {
    const { options, brief, rows, timeline, breakdown } = plan;
    const sheet = (matrix, cols) => {
      const result = XLSX.utils.aoa_to_sheet(matrix, { cellDates: true, dateNF: 'yyyy-mm-dd' });
      result['!cols'] = cols.map(wch => ({ wch }));
      return result;
    };
    const file = XLSX.utils.book_new();
    const source = rows.length && plan.verified === rows.length ? '所列资源均已匹配档期快照与覆盖' : '包含待核验资源或当前无匹配';
    const summary = [
      ['项目', '值'],
      ['客户', brief.name], ['行业', brief.industry], ['主题', brief.title], ['预算（元）', options.budget],
      ['投放起', new Date(options.start)], ['投放止', new Date(options.end)], ['计费月', plan.months],
      ['媒体', options.types.map(type => media[type]).join(' + ')], ['折扣（仅发布费）%', options.discount],
      ['计价情景', ({ low: '低位', mid: '中值', high: '高位' })[options.priceMode]],
      ['公交数量（辆）', breakdown.bus.count], ['地铁数量（处）', breakdown.metro.count],
      ['发布及制作合计（元）', plan.total], ['预算可用余量（元）', options.budget - plan.total - plan.reserve],
      ['全案低位（元）', plan.low], ['全案高位（元）', plan.high],
      ['档期状态', source], ['生意目标', plan.strategy.business], ['Campaign 主目标', plan.strategy.goal], ['策略', brief.idea],
      ['受众', brief.audience], ['承接动作', brief.action], ['效果监测', plan.strategy.measure],
      ['执行预留（元）', plan.reserve], ['计价范围', '发布、制作与执行预留按本方案口径列示，税费及实际施工费用以最终确认口径为准'],
      ['公交参考', '01 公交媒体台账（2026-11-13 单日）'], ['刊例口径', '07 媒体刊例价（脱敏区间）'],
    ];
    XLSX.utils.book_append_sheet(file, sheet(summary, [30, 79]), '方案摘要');
    const details = planRows(plan).map((row, index) => index ? row.map((value, col) => [8, 9, 25, 29, 30].includes(col) && value ? new Date(value) : value) : row);
    const detailSheet = sheet(details, details[0].map((_, index) => [3, 22, 23, 24, 26, 31].includes(index) ? 30 : 18));
    detailSheet['!autofilter'] = { ref: detailSheet['!ref'] };
    XLSX.utils.book_append_sheet(file, detailSheet, '媒介明细');
    XLSX.utils.book_append_sheet(file, sheet([['阶段', '建议日期', '工作与交付'],
      ...timeline.map(([step, day, note]) => [step, new Date(day), note]),
      ...plan.execution.install.map(item => ['上刊批次', new Date(item.day), media[item.type] + ' ' + item.count + (item.type === 'bus' ? ' 辆' : ' 处')])],
      [24, 18, 86]), '排期与监测');
    XLSX.utils.book_append_sheet(file, sheet([
      ['圈选中心', '位置', '建议半径（米）', '场景', '关联资源数', '已匹配核验资源数'],
      ...plan.zones.map(zone => [zone.name, zone.address, zone.radius, zone.purpose,
        rows.filter(row => row.zoneIds.includes(zone.id)).length,
        rows.filter(row => row.evidence.some(item => item.anchor === zone.id && !item.stationLevel) && row.inventoryOK && !row.areaAssumed).length]),
    ], [29, 39, 24, 30, 21, 23]), '圈选与覆盖');
    return XLSX.write(file, { type: 'array', bookType: 'xlsx', compression: true });
  }

  function download(content, fileName, mime) {
    const url = URL.createObjectURL(new Blob([content], { type: mime }));
    const link = Object.assign(document.createElement('a'), { href: url, download: fileName });
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  globalThis.XinyunFiles = { headers, readRecords, mergeRows, planRows, csv, xlsx, download };
})();
