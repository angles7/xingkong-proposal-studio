(() => {
  const catalog = globalThis.XinyunCatalog;
  const media = { bus: '公交车身', metro: '地铁出入口' };
  const dayMs = 86400000;
  const ISO = value => new Date(value).toISOString().slice(0, 10);
  const validDay = value => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && ISO(value) === value;
  const shiftDay = (value, days) => ISO(Date.parse(value) + days * dayMs);
  const rangeOK = (start, end) => [start, end].every(value => validDay(value) && value.startsWith('2027-')) && start <= end;
  const identity = value => String(value ?? '').normalize('NFKC').replace(/\s+/g, '').trim();
  const mediaName = (type, value) => {
    const name = identity(value).replace(/地铁(?=\d+号口)/, '').replace(/(?:出入口|出口)(?=\d+号口)/, '');
    return type === 'bus' && /^\d+路$/.test(name) ? name.slice(0, -1) : name;
  };
  const resourceKey = row => [row.type, row.id ? 'id:' + identity(row.id) : [mediaName(row.type, row.name), identity(row.format), identity(row.operator)].join('|')].join(':');
  const sameRange = (row, options) => row.start === options.start && row.end === options.end;
  const hasExactCoverage = row => row.evidence.some(item => !item.stationLevel);
  const textName = row => row.type === 'bus' && /^\d+$/.test(row.name) ? row.name + '路' : row.name;
  const mean = (a, b) => (a + b) / 2;
  const ledger = catalog.ledger.map(([name, operator, grade, format, capacity, free]) => ({ type: 'bus', name, operator, grade, format, capacity, free }));

  function billingMonths(start, end) {
    const [year, month, day] = start.split('-').map(Number);
    let count = (Number(end.slice(5, 7)) - month) + 1;
    const boundary = Date.UTC(year, month + count - 2, Math.min(day, new Date(Date.UTC(year, month + count - 1, 0)).getUTCDate()));
    if (Date.parse(end) < boundary) count--;
    return Math.max(1, count);
  }

  function getRate(row) {
    const name = mediaName(row.type, row.name).replace(/站(?=\d+号口)/, '');
    if (row.type === 'metro' && /静安寺.*8号口.*灯箱/.test(name)) return null;
    const special = row.type === 'metro' && catalog.specials[name];
    const ordinary = catalog.rates[row.type + ':' + row.grade];
    if (special) return { values: special, byArea: false, label: '07 媒体刊例价 · 指定出入口' };
    if (!ordinary || /灯箱|套装|双层|全色|观光/.test(row.format)) return null;
    return { values: ordinary, byArea: row.type === 'metro', label: '07 媒体刊例价 · ' + row.grade };
  }

  function quote(row, months, discount, priceMode) {
    const rate = getRate(row);
    if (!rate || (rate.byArea && !(row.area > 0))) return null;
    const [monthlyLow, monthlyHigh, makeLow, makeHigh] = rate.values;
    const area = rate.byArea ? row.area : 1;
    const choose = priceMode === 'high' ? (_, high) => high : priceMode === 'low' ? low => low : mean;
    const rateAt = choose(monthlyLow, monthlyHigh);
    const make = Math.round(choose(makeLow, makeHigh) * area);
    const release = Math.round(rateAt * months * discount / 100);
    return {
      monthlyLow, monthlyHigh, rateAt, make, release, total: release + make, label: rate.label,
      low: Math.round(monthlyLow * months * discount / 100) + Math.round(makeLow * area),
      high: Math.round(monthlyHigh * months * discount / 100) + Math.round(makeHigh * area),
    };
  }

  function snapshots(rows, options) {
    // A newer export for the same date window supersedes earlier records, including zero availability.
    const current = new Map();
    for (const row of rows.filter(row => sameRange(row, options) && options.types.includes(row.type))) {
      current.set(resourceKey(row), row);
    }
    return [...current.values()];
  }

  const lookupName = row => row.type + ':' + mediaName(row.type, row.name);

  function indexEvidence(rows, evidence) {
    const byId = new Map();
    const byName = new Map();
    const matched = new Map();
    for (const row of rows) {
      const name = lookupName(row);
      if (!byName.has(name)) byName.set(name, []);
      byName.get(name).push(row);
      if (row.id) byId.set(resourceKey(row), row);
    }
    for (const item of evidence) {
      const candidates = item.id ? [byId.get(resourceKey(item))].filter(Boolean)
        : (byName.get(lookupName(item)) || []).filter(peer =>
          (!item.format || identity(peer.format) === identity(item.format))
          && (!item.operator || identity(peer.operator) === identity(item.operator)));
      if (candidates.length !== 1) continue;
      const [row] = candidates;
      if (!matched.has(row)) matched.set(row, []);
      matched.get(row).push(item);
    }
    return matched;
  }

  function candidatePool(options, data, zones) {
    const dated = snapshots(data.inventory, options);
    const evidence = data.coverage.filter(item => zones.some(zone => zone.id === item.anchor) && options.types.includes(item.type));
    const realCoverage = indexEvidence(dated, evidence);
    const datedPool = dated.map(row => {
      const matched = realCoverage.get(row) || [];
      return { ...row, key: resourceKey(row), cap: row.free, inventoryOK: true, evidence: matched,
        zoneIds: [...new Set(matched.map(item => item.anchor))] };
    });
    if (options.mode === 'verified') return { candidates: datedPool.filter(row => hasExactCoverage(row)), evidence, dated };
    const resolved = new Set(evidence.map(item => item.anchor + ':' + item.type));
    const datedNames = new Set(dated.map(lookupName));
    const legacyCoverage = indexEvidence(ledger, evidence);
    const bus = ledger.flatMap(row => {
      if (!options.types.includes('bus')) return [];
      const matched = legacyCoverage.get(row) || [];
      const zoneIds = [...new Set([...matched.map(item => item.anchor),
        ...zones.filter(zone => !resolved.has(zone.id + ':bus') && zone.lines.includes(mediaName('bus', row.name))).map(zone => zone.id)])];
      if (!zoneIds.length || datedNames.has(lookupName(row))) return [];
      return [{ ...row, key: 'ledger:' + resourceKey(row), cap: row.free, inventoryOK: false, evidence: matched, zoneIds,
        source: '01 公交媒体台账', checked: catalog.snapshotDate }];
    });
    const metro = options.types.includes('metro') ? zones.flatMap((zone, index) => {
      if (datedPool.some(row => row.type === 'metro' && (row.zoneIds.includes(zone.id) || mediaName('metro', row.name).startsWith(mediaName('metro', zone.station))))) return [];
      return [{ key: 'model:' + zone.id, type: 'metro', name: zone.station + '站 · 出口待定位', format: '出入口',
        grade: index % 2 ? 'A+' : 'A++', area: 60, areaAssumed: true, cap: 1, inventoryOK: false, evidence: [], zoneIds: [zone.id],
        source: '站点候选 · 级别与面积为测算假设', checked: '' }];
    }) : [];
    const enriched = datedPool.map(row => {
      const planned = row.type === 'metro' && !row.area && getRate(row)?.byArea ? { ...row, area: 60, areaAssumed: true } : row;
      if (row.zoneIds.length) return planned;
      const zoneIds = zones.filter(zone => !resolved.has(zone.id + ':' + row.type) && (row.type === 'bus'
        ? zone.lines.includes(mediaName('bus', row.name))
        : mediaName('metro', row.name).startsWith(mediaName('metro', zone.station)))).map(zone => zone.id);
      return { ...planned, zoneIds };
    });
    return { candidates: [...enriched, ...bus, ...metro], evidence, dated };
  }

  function allocate(candidates, options, zones, subwayShare, reservePercent) {
    const remaining = new Map(candidates.map(row => [row.key, row.cap]));
    const assigned = new Map();
    const byStage = new Map();
    const frequency = new Map(zones.map(zone => [zone.id, 0]));
    const zoneWeights = new Map(zones.map(zone => [zone.id, zone.weight]));
    const spent = { bus: 0, metro: 0 };
    const score = row => {
      const quantity = assigned.get(row.key) || 0;
      const coverage = row.zoneIds.reduce((sum, id) => sum + zoneWeights.get(id) / Math.sqrt(1 + frequency.get(id)), 0);
      const proof = row.inventoryOK && hasExactCoverage(row) ? 1.3 : row.evidence.length ? 1.12 : 1;
      const grade = ({ S: 1.11, 'A++': 1.06 })[row.grade] || 1;
      return coverage * proof * grade / ((1 + quantity * .34) * Math.sqrt(row.cost.total / 50000));
    };
    const stages = [1000000, 2000000, 5000000].filter(budget => budget < options.budget).concat(options.budget);
    for (const tier of stages) {
      const cap = tier - Math.round(tier * reservePercent / 100);
      const subwayCap = options.types.length === 2 ? Math.round(cap * subwayShare) : cap;
      const caps = { bus: options.types.length === 2 ? cap - subwayCap : cap, metro: subwayCap };
      const module = tier <= 1000000 ? '核心' : tier <= 2000000 ? '补频' : '扩展';
      for (const split of [true, false]) {
        for (;;) {
          const available = cap - spent.bus - spent.metro;
          const eligible = candidates.filter(row => remaining.get(row.key) > 0 && row.cost.total <= available
            && (!split || row.cost.total <= caps[row.type] - spent[row.type]));
          const winner = eligible.sort((a, b) => score(b) - score(a) || a.key.localeCompare(b.key, 'zh-CN'))[0];
          if (!winner) break;
          spent[winner.type] += winner.cost.total;
          remaining.set(winner.key, remaining.get(winner.key) - 1);
          assigned.set(winner.key, (assigned.get(winner.key) || 0) + 1);
          if (!byStage.has(winner.key)) byStage.set(winner.key, {});
          const placement = byStage.get(winner.key);
          placement[module] = (placement[module] || 0) + 1;
          for (const id of winner.zoneIds) frequency.set(id, frequency.get(id) + 1);
        }
      }
    }
    const ordered = new Map(candidates.map(row => [row.key, row]));
    return [...assigned].map(([key, quantity]) => ({ ...ordered.get(key), quantity, modules: byStage.get(key) }));
  }

  function schedule(options, breakdown) {
    const busPerNight = options.busPerNight ?? 12;
    const metroPerNight = options.metroPerNight ?? 4;
    const buffer = options.weatherNights ?? 2;
    if (![busPerNight, metroPerNight, buffer].every(value => Number.isSafeInteger(value) && value > 0 && value <= 30)) {
      throw new Error('夜间施工容量和天气缓冲需为 1–30 的整数。');
    }
    const bus = Math.ceil(breakdown.bus.count / busPerNight);
    const metro = Math.ceil(breakdown.metro.count / metroPerNight);
    const nights = bus + metro;
    const dates = Array.from({ length: nights }, (_, index) => shiftDay(options.start, -buffer - nights + index));
    const install = dates.map((day, index) => {
      const type = index < bus ? 'bus' : 'metro';
      const sequence = type === 'bus' ? index : index - bus;
      const capacity = type === 'bus' ? busPerNight : metroPerNight;
      return { day, type, count: Math.min(capacity, breakdown[type].count - sequence * capacity) };
    });
    const first = dates[0] || options.start;
    const monitoring = '逐车、逐点匹配上刊照片与发布时间；下刊复拍并在结案报告附差异和补刊记录。';
    return { bus, metro, buffer, install, busPerNight, metroPerNight, monitoring,
      timeline: [
        ['定稿与内容审核', shiftDay(first, -10), '确认分圈素材和二维码，完成客户及行业审核'],
        ['制作与进场确认', shiftDay(first, -5), '复核车型、点位面积与夜间进场条件，协调施工班组'],
        ['分批上刊', first, nights ? '至 ' + dates.at(-1) + '，按夜分批施工。雨天停工，预留 ' + buffer + ' 个机动夜' : '施工窗口随媒体组合确定'],
        ['发布与监测', options.start, '按资源编码核对画面、位置和发布起日，提交上刊照片'],
        ['分批下刊与结案', shiftDay(options.end, 1), '从末刊次夜起按班组窗口拆批，提交下刊照片、结案报告与补刊记录'],
      ] };
  }

  function build(options, data) {
    if (!rangeOK(options.start, options.end)) throw new Error('请输入 2027 年内有效的起止日期。');
    if (!Number.isInteger(options.budget) || options.budget < 1000000 || options.budget > 5000000) throw new Error('预算须在 100–500 万元之间。');
    if (!options.types.length) throw new Error('请至少选一种媒体。');
    if (!(options.discount > 0 && options.discount <= 100)) throw new Error('折扣须大于 0 且不超过 100%。');
    const reservePercent = options.reservePercent ?? 0;
    if (!(reservePercent >= 0 && reservePercent <= 20)) throw new Error('执行预留比例须在 0–20% 之间。');
    const brief = catalog.briefs.find(item => item.id === options.brief);
    if (!brief) throw new Error('请选择行业。');
    const strategy = globalThis.XinyunCampaign.strategy(brief, options.goal);
    const zones = brief.zones.map(id => {
      const zone = catalog.locations[id];
      return { ...zone, weight: zone.weight * (strategy.contexts.test(zone.purpose) ? 1.2 : 1) };
    });
    const share = Math.min(.75, Math.max(.2, brief.subwayShare + strategy.media));
    const months = billingMonths(options.start, options.end);
    const { candidates, evidence, dated } = candidatePool(options, data, zones);
    const excluded = new Set(options.excluded || []);
    const missingPrice = [];
    const priced = [];
    for (const row of candidates) {
      if (!row.zoneIds.length || row.cap <= 0) continue;
      const cost = quote(row, months, options.discount, options.priceMode);
      if (!cost) {
        missingPrice.push(row);
        continue;
      }
      priced.push({ ...row, cost });
    }
    const eligible = priced.filter(row => !excluded.has(row.key));
    const rows = allocate(eligible, options, zones, share, reservePercent);
    const breakdown = Object.fromEntries(Object.keys(media).map(type => {
      const items = rows.filter(row => row.type === type);
      return [type, { count: items.reduce((n, row) => n + row.quantity, 0),
        release: items.reduce((n, row) => n + row.quantity * row.cost.release, 0),
        make: items.reduce((n, row) => n + row.quantity * row.cost.make, 0),
        cost: items.reduce((n, row) => n + row.quantity * row.cost.total, 0) }];
    }));
    const total = breakdown.bus.cost + breakdown.metro.cost;
    const covered = new Set(rows.flatMap(row => row.zoneIds));
    const verified = rows.filter(row => row.inventoryOK && hasExactCoverage(row) && !row.areaAssumed).length;
    const used = new Set(rows.map(row => row.key));
    const alternatives = eligible.filter(row => !used.has(row.key))
      .sort((a, b) => Number(Boolean(b.evidence.length)) - Number(Boolean(a.evidence.length))
        || b.zoneIds.length - a.zoneIds.length || a.cost.total - b.cost.total);
    const execution = schedule(options, breakdown);
    const reserve = Math.round(options.budget * reservePercent / 100);
    const days = Math.round((Date.parse(options.end) - Date.parse(options.start)) / dayMs) + 1;
    const crossMedia = zones.filter(zone => options.types.every(type => rows.some(row => row.type === type && row.zoneIds.includes(zone.id)))).map(zone => zone.id);
    const withinStock = rows.every(row => row.quantity <= row.cap && row.cap > 0);
    const fullyChecked = rows.length > 0 && verified === rows.length;
    return { options, brief, strategy, zones, months, rows, breakdown, total, covered, verified, alternatives, share,
      reserve, execution, days, crossMedia,
      audit: { withinStock, withinBudget: total + reserve <= options.budget, fullyChecked, priced: rows.every(row => row.cost.total > 0) },
      low: rows.reduce((n, row) => n + row.quantity * row.cost.low, 0),
      high: rows.reduce((n, row) => n + row.quantity * row.cost.high, 0),
      counts: { dated: dated.length, evidence: evidence.length, joined: candidates.filter(row => row.inventoryOK && hasExactCoverage(row)).length,
        missingPrice: missingPrice.length, available: eligible.length },
      missingPrice,
      timeline: execution.timeline,
    };
  }

  globalThis.XinyunPlanner = { build, media, ISO, validDay, rangeOK, identity, mediaName, resourceKey, textName, billingMonths, hasExactCoverage };
})();
