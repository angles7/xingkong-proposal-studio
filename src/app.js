(() => {
  const C = globalThis.XinyunCatalog;
  const P = globalThis.XinyunPlanner;
  const F = globalThis.XinyunFiles;
  const $ = id => document.getElementById(id);
  const budgets = [1000000, 2000000, 5000000];
  const int = new Intl.NumberFormat('zh-CN');
  const wan = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 });
  const money = n => wan.format(n / 10000) + ' 万元';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  const isVerified = row => row.inventoryOK && P.hasExactCoverage(row) && !row.areaAssumed;
  const rowStatus = row => {
    if (isVerified(row)) return '档期与覆盖已匹配';
    if (row.inventoryOK && row.evidence.some(item => item.stationLevel)) return '档期有快照 · 站级覆盖';
    return row.inventoryOK ? '档期有快照 · 待补证据' : '待核验';
  };
  const outName = plan => plan.brief.name + '_上海户外投放_' + plan.options.start;
  const storageKey = 'xinyun-imports-v1';
  const stored = () => {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey));
      if (Array.isArray(saved?.inventory) && Array.isArray(saved?.coverage)) return saved;
    } catch { /* Local file mode may restrict browser storage. */ }
    return { inventory: [], coverage: [] };
  };
  const data = stored();
  const seed = globalThis.XinyunSeed;
  if (seed?.inventory?.length) data.inventory = F.mergeRows(seed.inventory, data.inventory, 'inventory');
  if (seed?.coverage?.length) data.coverage = F.mergeRows(seed.coverage, data.coverage, 'coverage');
  const view = { type: 'all', zone: '', excluded: new Set(), plan: null };
  let toastTimer;

  function toast(text) {
    $('toast').textContent = text;
    $('toast').hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { $('toast').hidden = true; }, 3400);
  }

  const selected = name => document.querySelector('input[name="' + name + '"]:checked')?.value;
  function inputs() {
    return { brief: $('industry').value, start: $('start').value, end: $('end').value,
      budget: Number(selected('budget')), mode: selected('mode'), discount: Number($('discount').value),
      types: [...document.querySelectorAll('input[name="type"]:checked')].map(el => el.value),
      priceMode: $('price-mode').value, excluded: [...view.excluded] };
  }

  function setBrief(id) {
    $('industry').value = id;
    $('search').value = '';
    view.zone = '';
    view.type = 'all';
    view.excluded.clear();
  }

  function renderOverview(plan) {
    const { brief, options, rows, breakdown, covered, counts, verified } = plan;
    const ready = rows.length && verified === rows.length;
    $('plan-status').classList.toggle('good', Boolean(ready));
    $('plan-status').textContent = ready ? '已匹配档期与覆盖' : options.mode === 'verified' ? '核验模式'
      : verified ? '策略测算 · 部分核验' : '策略测算 · 待核验';
    $('hero-date').textContent = options.start + ' 至 ' + options.end;
    $('hero-kicker').textContent = brief.english;
    $('hero-title').innerHTML = brief.titleParts ? brief.titleParts.map(part => '<span>' + esc(part) + '</span>').join('<wbr>') : esc(brief.title);
    $('hero-lede').textContent = brief.idea;
    $('hero-brand').textContent = brief.name;
    $('hero-season').textContent = brief.season;
    const cards = [
      ['投放预算', money(options.budget), '发布与制作测算'],
      ['方案估算', rows.length ? money(plan.total) : '待配案', rows.length ? '预算余量 ' + money(options.budget - plan.total) : '导入本档期数据后重算'],
      ['建议用量', breakdown.bus.count + ' 辆 / ' + breakdown.metro.count + ' 处', '公交车身 / 地铁出入口'],
      ['关联圈选', covered.size + ' / ' + plan.zones.length, verified + ' 条资源匹配完整证据'],
    ];
    $('stats').innerHTML = cards.map(([label, value, caption]) => '<article class="stat"><span class="label">' + label + '</span><strong>' + value
      + '</strong><span class="caption">' + caption + '</span></article>').join('');
    $('data-notice').classList.toggle('good', Boolean(ready));
    const scope = '本档期红豆快照 ' + counts.dated + ' 条 · 覆盖分析 ' + counts.evidence + ' 条 · 成功匹配 ' + counts.joined + ' 条。';
    const unfilled = options.types.filter(type => !breakdown[type].count).map(type => P.media[type]);
    const track = unfilled.length ? ' 本次未排入' + unfilled.join('、') + '。' : '';
    $('data-notice').textContent = scope + (ready ? ' 所列资源均匹配档期和资源级覆盖，锁档前需用红豆复查。'
      : options.mode === 'verified' ? ' 仅纳入同档期有空位且覆盖、计价可匹配的资源。'
        : verified ? ' 地铁站级覆盖只能定位到车站。出口位置和计价面积须复核。'
          : ' 公交静态台账来自 2026-11-13 单日查询。地铁候选的等级、面积及出口须复核。') + track;
  }

  function paintMap() {
    const canvas = $('map-canvas');
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (!width || !height) return;
    const scale = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = width * scale;
    canvas.height = height * scale;
    const ctx = canvas.getContext('2d');
    ctx.scale(scale * width / 800, scale * height / 460);
    const plot = (points, color, weight) => {
      ctx.beginPath();
      points.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
      ctx.strokeStyle = color;
      ctx.lineWidth = weight;
      ctx.stroke();
    };
    let state = 10337;
    const rand = () => { state = (state * 1664525 + 1013904223) >>> 0; return state / 4294967296; };
    ctx.save();
    ctx.translate(400, 230);
    ctx.rotate(-.24);
    ctx.translate(-400, -230);
    for (let y = -92; y < 610; y += 22) {
      const nodes = [];
      for (let x = -99; x < 944; x += 31) nodes.push([x, y + Math.sin(x / 100 + y / 62) * 16 + rand() * 4]);
      plot(nodes, y % 66 === 40 ? '#668ab176' : '#54759c4d', y % 66 === 40 ? 1.7 : .85);
    }
    for (let x = -82; x < 937; x += 24) {
      const nodes = [];
      for (let y = -98; y < 608; y += 29) nodes.push([x + Math.sin(y / 82 + x / 45) * 12 + rand() * 4, y]);
      plot(nodes, x % 72 === 38 ? '#7093b27c' : '#4d75985a', x % 72 === 38 ? 1.7 : .9);
    }
    ctx.restore();
    for (let i = 0; i < 55; i++) {
      const x = rand() * 800;
      const y = rand() * 460;
      ctx.fillStyle = i % 5 ? '#9eb8d441' : '#abcbe08c';
      ctx.fillRect(x, y, i % 5 ? 1 : 2, i % 5 ? 1 : 2);
    }
    const river = (stroke, lineWidth) => {
      ctx.beginPath();
      ctx.moveTo(621, -52);
      ctx.bezierCurveTo(700, 11, 507, 73, 547, 165);
      ctx.bezierCurveTo(582, 244, 604, 251, 543, 302);
      ctx.bezierCurveTo(507, 331, 440, 338, 445, 386);
      ctx.bezierCurveTo(451, 445, 548, 465, 526, 510);
      ctx.strokeStyle = stroke;
      ctx.lineWidth = lineWidth;
      ctx.stroke();
    };
    river('#6287aa8a', 44); river('#182d4a', 40); river('#1b3455', 31);
    for (const nodes of [
      [[25, 246], [138, 221], [248, 201], [358, 166], [453, 150], [549, 148], [679, 164], [810, 222]],
      [[-5, 324], [99, 306], [208, 305], [301, 311], [425, 245], [514, 201], [594, 178], [690, 77], [762, -18]],
      [[61, 479], [151, 361], [238, 310], [270, 218], [248, 137], [290, 54], [359, -11]],
      [[167, -7], [201, 81], [254, 128], [383, 159], [439, 221], [445, 307], [496, 356], [625, 382], [791, 408]],
      [[809, 295], [674, 286], [613, 260], [541, 312], [445, 352], [374, 346], [290, 359], [208, 444]],
    ]) {
      plot(nodes, '#142439ba', 5);
      plot(nodes, '#7a9cbda8', 2.2);
    }
    ctx.fillStyle = '#a5b8d381';
    ctx.font = '700 13px Microsoft YaHei, sans-serif';
    for (const [label, x, y] of [['普陀',185,112],['长宁',102,291],['黄浦',450,234],['浦东',682,198],['杨浦',626,64],['徐汇',238,407],['黄浦江',464,407]]) ctx.fillText(label, x, y);
  }

  function renderStrategy(plan) {
    const { brief, rows, zones, options } = plan;
    $('strategy').innerHTML = '<h3>' + esc(brief.name) + '</h3><p>' + esc(brief.fact) + '</p><dl>'
      + [['目标受众', brief.audience], ['转化动作', brief.action], ['效果监测', brief.measure],
        ...options.types.map(type => [P.media[type], brief[type === 'bus' ? 'bus' : 'metro']])]
        .map(([label, body]) => '<dt>' + esc(label) + '</dt><dd>' + esc(body) + '</dd>').join('')
      + '</dl><p class="source-links">' + brief.sources.map(([label, link]) => '<a target="_blank" rel="noopener" href="' + esc(link) + '">' + esc(label) + ' ↗</a>').join('') + '</p>';
    $('map-pins').innerHTML = zones.map(zone => '<button class="pin' + (zone.xy[0] >= 44 ? ' left' : '') + '" type="button" data-zone="' + zone.id
      + '" data-name="' + esc(zone.name) + '" aria-label="' + esc(zone.name) + '" aria-pressed="' + (view.zone === zone.id) + '" style="left:' + zone.xy[0] + '%;top:' + zone.xy[1] + '%"></button>').join('');
    $('zone-list').innerHTML = zones.map(zone => {
      const related = rows.filter(row => row.zoneIds.includes(zone.id));
      const proof = related.filter(row => isVerified(row) && row.evidence.some(item => !item.stationLevel && item.anchor === zone.id)).length;
      return '<button class="zone" type="button" data-zone="' + zone.id + '" aria-pressed="' + (view.zone === zone.id) + '"><span><b>'
        + esc(zone.name) + '</b><small>' + esc(zone.address) + ' · ' + zone.radius + ' 米建议半径</small></span><span class="mini">'
        + (related.length ? related.length + ' 条关联' : '待配案') + (proof ? ' · ' + proof + ' 已匹配' : '') + '</span></button>';
    }).join('');
    $('zones-reset').hidden = !view.zone;
    $('zone-evidence').innerHTML = coverageEvidence(plan, view.zone);
  }

  function coverageEvidence(plan, id) {
    const zone = C.locations[id];
    if (!zone) {
      return '<p class="evidence-box muted">选择地标可查看对应资源、半径和已导入的覆盖证据。</p>';
    }
    const { options, rows } = plan;
    const proof = data.coverage.filter(item => item.anchor === zone.id && options.types.includes(item.type));
    const counts = rows.filter(row => row.zoneIds.includes(zone.id)).length;
    const links = [...new Set(proof.map(item => item.ai).filter(Boolean))];
    const seen = new Set();
    const traffic = proof.filter(item => {
      const key = [item.name, item.month, item.metric, item.footfall].join('|');
      if (item.footfall === null || seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, 6);
    return '<div class="evidence-box"><p><b>' + esc(zone.purpose) + '</b> · ' + counts
      + ' 条方案资源。 ' + (proof.length ? '覆盖分析记录 ' + proof.length + ' 条。' : '待导入该地标的媒体覆盖分析。') + '</p>'
      + traffic.map(item => '<p>' + esc(item.name + ' · ' + item.month + ' · ' + item.metric) + ' ' + int.format(item.footfall) + '</p>').join('')
      + (links.length ? '<p>' + links.map((url, index) => '<a target="_blank" rel="noopener" href="' + esc(url) + '">平台线路图 ' + (index + 1) + ' ↗</a>').join('　') + '</p>' : '')
      + '</div>';
  }

  function tableMarkup(rows) {
    return '<table class="resources-table"><thead><tr><th>线路 / 点位</th><th>关联地标</th><th>等级</th><th>数量</th><th>库存与覆盖</th><th class="money">报价小计</th></tr></thead><tbody>'
      + rows.map(row => '<tr data-type="' + row.type + '" data-zones="' + row.zoneIds.join(' ') + '"><td><button type="button" class="text-button resource-link" data-resource="' + esc(row.key) + '">'
        + esc(P.textName(row)) + '</button><div class="sub">' + esc(P.media[row.type] + (row.format ? ' · ' + row.format : '')) + '</div></td><td>'
        + row.zoneIds.map(id => esc(C.locations[id].name)).join('、') + '</td><td>' + esc(row.grade) + '</td><td>' + row.quantity + (row.type === 'bus' ? ' 辆' : ' 处')
        + '</td><td><span class="row-status' + (isVerified(row) ? ' good' : '') + '">' + rowStatus(row) + '</span></td><td class="money">' + money(row.quantity * row.cost.total) + '</td></tr>').join('')
      + '</tbody></table>';
  }

  function renderTable(plan) {
    const search = P.identity($('search').value).toLowerCase();
    for (const button of document.querySelectorAll('[data-list]')) button.setAttribute('aria-selected', String(button.dataset.list === view.type));
    const rows = plan.rows.filter(row => (view.type === 'all' || row.type === view.type) && (!view.zone || row.zoneIds.includes(view.zone))
      && (!search || P.identity([P.textName(row), row.grade, ...row.zoneIds.map(id => C.locations[id].name)].join(' ')).toLowerCase().includes(search)));
    $('resource-table').innerHTML = rows.length ? tableMarkup(rows) : '<p class="empty">'
      + (plan.rows.length ? '当前筛选无匹配资源。' : '当前条件下还没有可排入方案的资源。') + '</p>';
    const alternatives = plan.alternatives.slice(0, 12);
    const missing = plan.missingPrice.slice(0, 10);
    $('alternative-items').innerHTML = (alternatives.length
      ? '<p class="muted">从资源明细移除当前项目，提案台会按同一规则补配。候选受余量与证据约束。</p>'
        + alternatives.map(row => '<button class="button quiet" type="button" data-resource="' + esc(row.key) + '">' + esc(P.textName(row)) + ' · ' + money(row.cost.total) + '/单位</button>').join('')
      : '<p class="muted">当前无剩余可计价候选。</p>')
      + (missing.length ? '<p class="muted">缺刊例匹配或地铁实际面积（共 ' + plan.counts.missingPrice + ' 条）</p><p>'
        + missing.map(row => esc(P.textName(row) + ' · ' + row.grade)).join('、') + '</p>' : '')
      + (view.excluded.size ? '<p><button class="button quiet" data-clear-exclusions type="button">恢复已移除资源（' + view.excluded.size + '）</button></p>' : '');
  }

  function renderQuote(plan) {
    const { options, breakdown, total, low, high, rows, timeline, months } = plan;
    const dp = options.budget ? 100 / options.budget : 0;
    const scenario = { low: '低位', mid: '中值', high: '高位' }[options.priceMode];
    const duration = [options.start, options.end].join(' 至 ');
    $('quote').innerHTML = '<h3>预算分配</h3><dl>'
      + [['预算上限', money(options.budget)],
        ...options.types.map(type => [P.media[type] + ' · ' + breakdown[type].count + (type === 'bus' ? ' 辆' : ' 处'), money(breakdown[type].cost)]),
        ['发布及制作估算', rows.length ? money(total) : '待配案', 'sum'], ['剩余预算', money(options.budget - total), 'sum']]
        .map(([label, value, css]) => '<dt class="' + (css || '') + '">' + label + '</dt><dd class="' + (css || '') + '">' + value + '</dd>').join('')
      + '</dl><div class="allocation" aria-label="费用占预算比例"><span class="bus" style="width:' + dp * breakdown.bus.cost + '%"></span>'
      + '<span class="metro" style="width:' + dp * breakdown.metro.cost + '%"></span></div>'
      + (rows.length ? '<p><b>同组合刊例区间</b> ' + money(low) + ' 至 ' + money(high) + (high > options.budget ? '。高位超预算 ' + money(high - options.budget) : '') + '</p>' : '')
      + '<p class="muted">' + duration + ' · 按 ' + months + ' 个月计。月刊费 × 计费月 × ' + options.discount + '% ＋ 一次性制作费。使用刊例' + scenario + '。制作费按辆或点位面积计。</p>'
      + '<p class="muted">区间取自资料包 07。按起始日逐月计费，不足一月按一月测算。税费、安装及其他费用以最终口径为准。</p>';
    $('timeline').innerHTML = '<h3>执行节点</h3><ol>' + timeline.map(([stage, date, note]) =>
      '<li><time datetime="' + date + '">' + date + '</time><b>' + stage + '</b><p>' + note + '</p></li>').join('') + '</ol>';
    $('compares').innerHTML = budgets.map(budget => {
      const alternative = budget === options.budget ? plan : P.build({ ...options, budget }, data);
      return '<button class="compare" type="button" data-budget="' + budget + '" aria-pressed="' + (budget === options.budget) + '"><b>'
        + money(budget) + '</b><span>' + alternative.breakdown.bus.count + ' 辆公交 · ' + alternative.breakdown.metro.count + ' 处地铁</span><span>'
        + (alternative.rows.length ? '测算 ' + money(alternative.total) + ' · 关联 ' + alternative.covered.size + ' 圈' : '暂无可排资源') + '</span></button>';
    }).join('');
  }

  function render() {
    try {
      const plan = P.build(inputs(), data);
      view.plan = plan;
      $('proposal').hidden = false;
      $('input-error').hidden = true;
      $('export-html').disabled = false;
      renderOverview(plan);
      renderStrategy(plan);
      renderTable(plan);
      renderQuote(plan);
      $('footer').innerHTML = '<span>上海新云传媒 · 2027 户外媒体方案</span><span>库存依据导入时点。2023 年历史人流按各指标原口径展示。圈选数与历史人流均不用于承诺去重触达。</span>';
      requestAnimationFrame(paintMap);
    } catch (error) {
      view.plan = null;
      $('proposal').hidden = true;
      $('export-html').disabled = true;
      $('input-error').textContent = error.message;
      $('input-error').hidden = false;
    }
  }

  function openRow(key) {
    const row = [...view.plan.rows, ...view.plan.alternatives].find(item => item.key === key);
    if (!row) return;
    $('row-heading').textContent = P.textName(row);
    $('row-body').innerHTML = rowDetails(row)
      + (row.quantity ? '<div class="detail-actions"><button class="button quiet" type="button" data-exclude="' + esc(row.key) + '">移除此资源并重算</button></div>' : '');
    $('row-dialog').showModal();
  }

  function rowDetails(row) {
    const c = row.cost;
    let quantity = row.inventoryOK ? row.free + '（本档期快照）' : '待核验';
    if (!row.inventoryOK && row.type === 'bus') quantity += '，静态空位 ' + row.free + '（' + row.checked + '）';
    const details = [
      ['媒体与等级', [P.media[row.type], row.grade, row.format, row.operator].filter(Boolean).join(' · ')],
      ['资源 ID', row.id || '—'], ['资源状态', rowStatus(row)], ['库存数量', quantity],
      ['库存来源', row.source + (row.inventoryOK ? ' · ' + row.checked + ' 导出 · ' + row.start + ' 至 ' + row.end : '')],
      ['建议数量', row.quantity || '备选'],
      ['月刊区间', money(c.monthlyLow) + ' 至 ' + money(c.monthlyHigh) + ' / 单位'],
      ['折后发布费', money(c.release) + ' / 单位'],
      ['制作费', money(c.make) + ' / 单位' + (row.area ? ' · ' + row.area + ' ㎡' + (row.areaAssumed ? '（测算假设）' : '') : '')],
      ['计价来源', c.label], ['预算单价', money(c.total) + ' / 单位'],
    ];
    return '<dl class="detail-fields">' + details.map(([label, value]) =>
      '<dt>' + esc(label) + '</dt><dd>' + esc(value) + '</dd>').join('') + '<dt>覆盖依据</dt><dd>'
      + row.zoneIds.map(id => {
        const hits = row.evidence.filter(item => item.anchor === id);
        return '<div>' + esc(C.locations[id].name) + ' · ' + (hits.length ? hits.map(item => esc(item.radius + ' 米圈'
          + (item.stationLevel ? ' · 站级覆盖，待核出口位置' : '') + (item.distance === null ? '' : ' · 距 ' + item.distance + ' 米')
          + ' · ' + item.source)).join(' / ') : '策略关联，待平台核验') + '</div>';
      }).join('') + '</dd></dl>';
  }

  function renderData() {
    $('import-inventory').hidden = $('import-kind').value !== 'inventory';
    $('import-coverage').hidden = $('import-kind').value !== 'coverage';
    const chosen = $('import-anchor').value;
    const zones = view.plan?.zones || C.briefs.find(brief => brief.id === $('industry').value).zones.map(id => C.locations[id]);
    $('import-anchor').innerHTML = zones.map(zone => '<option value="' + zone.id + '">' + esc(zone.name) + '</option>').join('');
    if (zones.some(zone => zone.id === chosen)) $('import-anchor').value = chosen;
    $('import-radius').value = C.locations[$('import-anchor').value].radius;
    $('source-counts').textContent = '浏览器已载入 ' + data.inventory.length + ' 条档期库存 · ' + data.coverage.length + ' 条覆盖记录';
  }

  async function importFile(event) {
    event.preventDefault();
    const file = $('import-file').files[0];
    if (!file) return;
    const form = event.target;
    const kind = $('import-kind').value;
    const message = $('import-message');
    const submit = form.querySelector('button[type="submit"]');
    submit.disabled = true;
    message.hidden = false;
    try {
      if (file.size > 12 * 1024 * 1024) throw new Error('请将文件拆分至每份 12 MB 以内。');
      const defaults = { type: $('import-media').value, start: $('import-start').value, end: $('import-end').value,
        checked: $('import-checked').value, anchor: $('import-anchor').value, radius: $('import-radius').value };
      const { parsed, errors } = F.readRecords(await file.arrayBuffer(), kind, defaults, file.name);
      data[kind] = F.mergeRows(data[kind], parsed, kind);
      message.className = 'feedback full';
      message.textContent = '处理 ' + parsed.length + ' 条记录。' + (errors.length ? ' 跳过 ' + errors.length + ' 行，' + errors.slice(0, 2).join('；') : '');
      try { localStorage.setItem(storageKey, JSON.stringify(data)); }
      catch { message.textContent += ' 当前浏览器无法持久化导入数据，关闭页面前请保留源文件。'; }
      $('import-file').value = '';
      $('source-counts').textContent = '浏览器已载入 ' + data.inventory.length + ' 条档期库存 · ' + data.coverage.length + ' 条覆盖记录';
      render();
    } catch (error) {
      message.className = 'feedback full error';
      message.textContent = error.message;
    } finally { submit.disabled = false; }
  }

  function clientInteractions() {
    let currentType = 'all';
    let zone = '';
    const find = document.getElementById('search');
    const reset = document.getElementById('zones-reset');
    const show = () => {
      const search = find.value.replace(/\s+/g, '').toLowerCase();
      let shown = 0;
      for (const item of document.querySelectorAll('tr[data-type]')) {
        item.hidden = !(currentType === 'all' || item.dataset.type === currentType)
          || (zone && !item.dataset.zones.split(' ').includes(zone))
          || (search && !item.textContent.replace(/\s+/g, '').toLowerCase().includes(search));
        if (!item.hidden) shown++;
      }
      document.getElementById('client-empty').hidden = Boolean(shown);
      for (const item of document.querySelectorAll('[data-zone]')) item.setAttribute('aria-pressed', String(item.dataset.zone === zone));
      for (const item of document.querySelectorAll('[data-zone-evidence]')) item.hidden = item.dataset.zoneEvidence !== zone;
      reset.hidden = !zone;
    };
    document.addEventListener('click', event => {
      const control = event.target.closest('button');
      if (!control) return;
      if (control.dataset.list) {
        currentType = control.dataset.list;
        for (const tab of document.querySelectorAll('[data-list]')) tab.setAttribute('aria-selected', String(tab === control));
      } else if (control.dataset.zone) {
        zone = control.dataset.zone === zone ? '' : control.dataset.zone;
        if (control.classList.contains('pin')) document.getElementById('coverage').scrollIntoView();
      } else if (control === reset) zone = '';
      show();
    });
    find.addEventListener('input', show);
    show();
  }

  function exportHTML(plan) {
    const clone = $('proposal').cloneNode(true);
    clone.querySelector('#resource-table').innerHTML = tableMarkup(plan.rows) + '<p id="client-empty" class="empty">当前筛选无匹配资源。</p>';
    for (const button of clone.querySelectorAll('#resource-table [data-resource]')) {
      const row = plan.rows.find(item => item.key === button.dataset.resource);
      const details = document.createElement('details');
      details.className = 'client-resource';
      details.innerHTML = '<summary class="resource-link">' + esc(button.textContent) + '</summary>' + rowDetails(row);
      button.replaceWith(details);
    }
    for (const control of clone.querySelectorAll('.interactive:not(#zones-reset),#export-csv,#export-xlsx')) control.remove();
    clone.querySelector('#zones-reset').classList.remove('interactive');
    clone.querySelector('#zone-evidence').innerHTML = ['', ...plan.zones.map(zone => zone.id)]
      .map(id => '<div data-zone-evidence="' + id + '" ' + (id ? 'hidden' : '') + '>' + coverageEvidence(plan, id) + '</div>').join('');
    clone.querySelector('#search').value = '';
    for (const tab of clone.querySelectorAll('[data-list]')) tab.setAttribute('aria-selected', String(tab.dataset.list === 'all'));
    clone.querySelector('canvas').replaceWith(Object.assign(document.createElement('img'), {
      src: $('map-canvas').toDataURL(), alt: '', style: 'position:absolute;inset:0;width:100%;height:100%',
    }));
    const header = document.querySelector('.header').cloneNode(true);
    header.querySelector('.top-actions').remove();
    const html = '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>'
      + esc(plan.brief.name) + ' · 上海户外投放方案</title><style>' + $('app-style').textContent + '</style><body class="client">'
      + header.outerHTML + '<main class="frame page" id="top">' + clone.outerHTML + '</main><script>(' + clientInteractions.toString() + ')();</' + 'script></body></html>';
    F.download(html, outName(plan) + '.html', 'text/html;charset=utf-8');
  }

  function exportPlan(kind) {
    const plan = view.plan;
    if (!plan) return;
    try {
      if (kind === 'html') exportHTML(plan);
      if (kind === 'xlsx') F.download(F.xlsx(plan), outName(plan) + '.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      if (kind === 'csv') F.download(F.csv(F.planRows(plan)), outName(plan) + '.csv', 'text/csv;charset=utf-8');
      toast('已生成 ' + (kind === 'xlsx' ? 'Excel' : kind.toUpperCase()) + ' 下载');
    } catch (error) { toast('导出失败 · ' + error.message); }
  }

  $('industry').innerHTML = C.briefs.map(brief => '<option value="' + brief.id + '">' + esc(brief.industry + ' · ' + brief.name) + '</option>').join('');
  $('start').value = '2027-06-01';
  $('end').value = '2027-06-30';
  setBrief('food');
  $('brief-form').addEventListener('submit', event => event.preventDefault());
  $('brief-form').addEventListener('change', event => {
    if (event.target.id === 'industry') setBrief(event.target.value);
    if (event.target.name === 'type' && !document.querySelector('input[name="type"]:checked')) {
      event.target.checked = true;
      toast('至少选择一种媒体');
    }
    render();
  });
  document.querySelector('.mode').addEventListener('change', render);
  $('price-mode').addEventListener('change', render);
  $('discount').addEventListener('change', () => {
    const n = Number($('discount').value);
    $('discount').value = !n ? 100 : Math.max(1, Math.min(100, Math.round(n)));
    render();
  });
  $('search').addEventListener('input', () => renderTable(view.plan));
  $('zones-reset').addEventListener('click', () => { view.zone = ''; renderStrategy(view.plan); renderTable(view.plan); });
  $('data-open').addEventListener('click', () => {
    $('import-start').value = $('start').value;
    $('import-end').value = $('end').value;
    $('import-checked').value = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format(new Date());
    renderData();
    $('data-dialog').showModal();
  });
  $('data-close').addEventListener('click', () => $('data-dialog').close());
  $('row-close').addEventListener('click', () => $('row-dialog').close());
  $('import-kind').addEventListener('change', renderData);
  $('import-anchor').addEventListener('change', () => { $('import-radius').value = C.locations[$('import-anchor').value].radius; });
  $('import-form').addEventListener('submit', importFile);
  $('template').addEventListener('click', () => {
    const kind = $('import-kind').value;
    F.download(F.csv([F.headers[kind]]), (kind === 'inventory' ? '红豆档期库存' : '地标覆盖分析') + '导入模板.csv', 'text/csv;charset=utf-8');
  });
  for (const kind of ['html', 'csv', 'xlsx']) $('export-' + kind).addEventListener('click', () => exportPlan(kind));
  $('proposal').addEventListener('click', event => {
    const button = event.target.closest('button');
    if (!button) return;
    const { list, zone, resource, budget } = button.dataset;
    if (list) { view.type = list; renderTable(view.plan); }
    if (zone) {
      view.zone = zone === view.zone ? '' : zone;
      const map = button.classList.contains('pin');
      renderStrategy(view.plan);
      renderTable(view.plan);
      const next = document.querySelector((map ? '.pin' : '.zone') + '[data-zone="' + zone + '"]');
      next?.focus({ preventScroll: true });
      if (map) $('coverage').scrollIntoView({ behavior: 'smooth' });
    }
    if (resource) openRow(resource);
    if (budget) {
      document.querySelector('input[name="budget"][value="' + budget + '"]').checked = true;
      render();
      document.querySelector('[data-budget="' + budget + '"]')?.focus();
    }
    if (button.hasAttribute('data-clear-exclusions')) { view.excluded.clear(); render(); }
  });
  $('row-body').addEventListener('click', event => {
    const key = event.target.closest('button')?.dataset.exclude;
    if (!key) return;
    view.excluded.add(key);
    $('row-dialog').close();
    render();
    toast('已移除资源并重新配案');
  });
  new ResizeObserver(paintMap).observe($('map-canvas').parentElement);
  render();
})();
