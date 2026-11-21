const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const asScript = value => JSON.stringify(value).replace(/</g, '\\u003c');
const seedPath = path.join(root, 'data', 'verified.local.json');
const seed = fs.existsSync(seedPath) ? JSON.parse(fs.readFileSync(seedPath, 'utf8')) : { inventory: [], coverage: [] };
const slots = {
  CSS: read('src/style.css'),
  HERO_IMAGE: 'data:image/jpeg;base64,' + fs.readFileSync(path.join(root, 'src/assets/shanghai-skyline.jpg')).toString('base64'),
  XLSX: read('vendor/xlsx.full.min.js'),
  LEDGER: 'globalThis.XinyunLedger = ' + asScript(JSON.parse(read('data/ledger.json')))
    + ';\nglobalThis.XinyunSeed = ' + asScript(seed) + ';',
  CATALOG: read('src/catalog.js'),
  CAMPAIGN: read('src/campaign.js'),
  PLANNER: read('src/planner.js'),
  FILES: read('src/files.js'),
  APP: read('src/app.js'),
};
const html = read('src/index.html').replace(/\/\* BUILD: (\w+) \*\//g, (_, name) => {
  if (!(name in slots)) throw new Error('未知构建占位符 ' + name);
  return name === 'CSS' ? slots[name] : slots[name].replace(/<\/script/gi, '<\\/script');
});
fs.writeFileSync(path.join(root, '提案台.html'), html);
console.log('已生成 提案台.html');
