(() => {
  const goalProfiles = {
    认知: { media: -.08, contexts: /通勤|商圈|社区|换乘/, target: '让目标人群在通勤与日常活动路径重复接触品牌主题。',
      measure: '按投放圈统计活动页独立访客，配合投放前后同口径的品牌认知调查。' },
    到店: { media: .05, contexts: /旗舰|门店|到店|目的地|到院/, target: '把产生兴趣的客群导到线下承接点，缩短查地址和找到入口的过程。',
      measure: '按地标的独立二维码统计访问、路径点击和有效到店核销，按核销单去重。' },
    促销: { media: 0, contexts: /家庭|周末|到店|旗舰|目的地/, target: '让有消费意向的客群通过活动入口领券，并在线下完成核销。',
      measure: '按场景统计领券量与有效核销量，以同期未投放圈作对照。' },
    拉新: { media: .04, contexts: /商务|办公|家庭|旗舰|目的地/, target: '把有明确需求的客群导向预约或注册入口，沉淀可跟进的新线索。',
      measure: '按二维码来源统计有效预约或新增线索，以线索编号去重。' },
  };
  const industryWords = {
    bank: '网点 理财 银行 保险 开户 金融 企业服务 商务',
    food: '饮料 食品 咖啡 试饮 烘焙 饮品 限定 新品',
    health: '保健品 保健食品 滋补 营养 复购 药房 功效 银发',
    hospital: '医院 院区 医疗 体检 就诊 门诊 预约挂号 双语',
    park: '乐园 游园 亲子 门票 游客 暑期 到园 度假',
  };
  const goalWords = {
    认知: '认知 知晓 信任 形象 背书 品牌曝光 看见',
    到店: '到店 进店 到园 到院 店内 试饮 到访 路线 引流',
    促销: '促销 领券 特价 满减 优惠 体验价 核销 换购',
    拉新: '拉新 新客 预约 开户 咨询 线索 注册 新用户',
  };
  // Labeled examples teach the classifier which terms distinguish a class across related campaign briefs.
  const examples = {
    bank: ['银行网点新客开户理财', '金融保险线下咨询', '商务社区企业服务开户'],
    food: ['咖啡新品试饮到店', '连锁烘焙和季节限定饮品', '食品饮料商圈动销试饮'],
    health: ['保健食品与保健品合规功效咨询', '药房滋补营养日常复购', '社区银发服务和营养选购'],
    hospital: ['私立医院体检预约挂号', '长宁院区双语医疗服务', '就诊引导和门诊体检预约'],
    park: ['主题乐园门票销售与到园', '暑期亲子出游和度假', '游园新线路，按游客门票渠道看访问'],
    认知: ['目标品牌知晓和信任', '提升认知和行业背书', '增加品牌曝光，让通勤客群看见'],
    到店: ['门店到访进店试饮', '乐园到园路线引流', '医院到院，店内体验'],
    促销: ['优惠领券，门店核销', '特价换购和满减促销', '体验价带来有效核销'],
    拉新: ['新客拉新和注册', '预约了解，新增服务线索', '网点开户与咨询，新用户留资'],
  };
  function rank(text, profiles) {
    const vocabulary = [...new Set(Object.values(profiles).flatMap(words => words.split(' ')))];
    const training = Object.keys(profiles).flatMap(id => examples[id].map(sample => [id, sample]));
    const results = Object.entries(profiles).map(([id, words]) => {
      const hits = words.split(' ').filter(word => text.includes(word));
      const score = vocabulary.reduce((sum, word) => {
        if (!text.includes(word)) return sum;
        const inside = training.filter(([tag, sample]) => tag === id && sample.includes(word)).length;
        const outside = training.filter(([tag, sample]) => tag !== id && sample.includes(word)).length;
        return sum + Math.log((inside + 1) / (outside + 1)) + (hits.includes(word) ? .25 : 0);
      }, 0);
      return { id, hits, score };
    }).sort((a, b) => b.score - a.score);
    return results[0].hits.length && results[0].score - results[1].score > .2 ? results[0] : null;
  }

  function fromText(value) {
    const text = value.normalize('NFKC').slice(0, 600);
    const sector = rank(text, industryWords);
    const brands = globalThis.XinyunCatalog.briefs.flatMap(brief => {
      const match = [brief.name, brief.alias].find(term => text.toLowerCase().includes(term.toLowerCase()));
      return match ? [{ id: brief.id, hits: [match] }] : [];
    });
    const chosenSector = brands.length === 1 ? brands[0] : brands.length ? null : sector;
    const objective = rank(text, goalWords);
    const budgets = [...new Set([...text.matchAll(/(?<!\d)(100|200|500)\s*万/g)].map(match => Number(match[1]) * 10000))];
    const types = [/(公交|车身|巴士)/.test(text) && 'bus', /(地铁|轨交|出入口)/.test(text) && 'metro'].filter(Boolean);
    const days = [...text.matchAll(/2027[年./-](\d{1,2})[月./-](\d{1,2})日?/g)]
      .map(match => '2027-' + match[1].padStart(2, '0') + '-' + match[2].padStart(2, '0'));
    const period = days.length === 2 && globalThis.XinyunPlanner.rangeOK(days[0], days[1]) ? days : null;
    const explicitGoal = text.match(/(?:主目标|核心目标)\s*(?:为|是|[:：])?\s*(认知|到店|促销|拉新)/)?.[1];
    return { brief: chosenSector?.id, goal: explicitGoal || objective?.id, budget: budgets.length === 1 ? budgets[0] : undefined,
      types: /不投|不选|排除|不要|或/.test(text) ? [] : types,
      period, industryTerms: chosenSector?.hits || [], goalTerms: objective?.hits || [] };
  }

  function strategy(brief, goal) {
    const profile = goalProfiles[goal] || goalProfiles[brief.goal];
    const changed = goal !== brief.goal && profile === goalProfiles[goal];
    return { ...profile, goal: changed ? goal : brief.goal, business: changed ? profile.target : brief.business,
      measure: changed ? profile.measure : brief.measure };
  }

  globalThis.XinyunCampaign = { fromText, strategy, goals: Object.keys(goalProfiles) };
})();
